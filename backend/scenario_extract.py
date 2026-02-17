"""
Extract text from PDF (pypdf + OCR fallback) or DOCX (python-docx),
then run LLM to produce ExtractionResponse (Scenario + confidence + warnings).
User must always review before running financial model.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import date
from io import BytesIO
from typing import BinaryIO

from models import ExtractionResponse, Scenario, RentStep, OpexMode

logger = logging.getLogger(__name__)

# Early exit: skip OCR if PDF text is at least this long and high quality
OCR_EARLY_EXIT_MIN_CHARS = 1500
# When OCR runs, only process this many pages (default)
DEFAULT_OCR_PAGES = 5
# Snippet pack cap
SNIPPET_PACK_MAX_CHARS = 12_000
# Fallback truncation when snippet pack too small
FALLBACK_HEAD_CHARS = 20_000
FALLBACK_TAIL_CHARS = 20_000
# Lines of context around keyword matches for snippet pack
SNIPPET_CONTEXT_LINES = 20

FOCUS_KEYWORDS = [
    "rent", "base rent", "rental rate", "term", "commencement", "expiration",
    "operating expenses", "CAM", "NNN", "base year", "TI", "tenant improvement",
    "allowance", "abatement", "free rent", "parking", "option", "renewal", "termination",
]
SNIPPET_MIN_CHARS = 500  # if snippet pack smaller than this, use fallback truncation


def extract_text_from_pdf(file: BinaryIO) -> str:
    """Extract raw text from a PDF using pypdf."""
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ImportError("pypdf required: pip install pypdf")
    reader = PdfReader(file)
    parts = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            parts.append(text)
    return "\n\n".join(parts) if parts else ""


def _text_looks_high_quality(text: str) -> bool:
    """True if text has reasonable alphanumeric ratio (not scanned gibberish)."""
    if not text or len(text.strip()) < 100:
        return False
    alnum = sum(1 for c in text if c.isalnum() or c.isspace())
    return (alnum / len(text)) >= 0.6


def text_quality_requires_ocr(text: str) -> bool:
    """
    Return True if extracted text quality is poor and OCR should be run automatically.
    Uses: text length, alnum ratio, replacement-char count, short-line ratio.
    """
    t = (text or "").strip()
    text_len = len(t)
    if text_len == 0:
        return True
    non_ws = [c for c in t if not c.isspace()]
    non_ws_count = len(non_ws)
    alnum_count = sum(1 for c in non_ws if c.isalnum())
    alnum_ratio = alnum_count / max(1, non_ws_count)
    bad_char_count = t.count("\uFFFD")  # replacement character
    lines = [ln for ln in t.splitlines() if ln.strip()]
    short_lines = sum(1 for ln in lines if len(ln) < 20)
    short_line_ratio = short_lines / max(1, len(lines))

    if text_len < 1200:
        return True
    if alnum_ratio < 0.40:
        return True
    if bad_char_count > 5:
        return True
    if short_line_ratio > 0.60:
        return True
    return False


def _run_ocr_on_pdf(file: BinaryIO, max_pages: int = DEFAULT_OCR_PAGES) -> str:
    """Run OCR on first max_pages of PDF using pdf2image + pytesseract."""
    try:
        import pdf2image
        import pytesseract
    except ImportError as e:
        raise ImportError(
            "OCR requires pdf2image and pytesseract. "
            "Install: pip install pdf2image pytesseract. "
            "Also install system deps: poppler (e.g. brew install poppler) and tesseract (e.g. brew install tesseract)."
        ) from e
    t0 = time.perf_counter()
    try:
        pdf_bytes = file.read()
        images = pdf2image.convert_from_bytes(
            pdf_bytes,
            first_page=1,
            last_page=max_pages,
        )
    except Exception as e:
        raise ValueError(f"OCR failed (is poppler installed?): {e}") from e
    texts = []
    for img in images:
        text = pytesseract.image_to_string(img)
        if text:
            texts.append(text)
    elapsed = time.perf_counter() - t0
    logger.info("[extract] OCR duration=%.2fs pages=%d", elapsed, len(images))
    return "\n\n".join(texts) if texts else ""


def extract_text_from_pdf_with_ocr(
    file: BinaryIO,
    force_ocr: bool = False,
    ocr_pages: int = DEFAULT_OCR_PAGES,
) -> tuple[str, str]:
    """
    Extract text from PDF. Run OCR only when needed; limit to first ocr_pages.
    Returns (combined_text, source_string).
    """
    t0 = time.perf_counter()
    pdf_text = extract_text_from_pdf(file)
    elapsed = time.perf_counter() - t0
    logger.info("[extract] PDF text extraction duration=%.2fs len=%d", elapsed, len(pdf_text))

    # Early exit: enough text and high quality -> no OCR
    if not force_ocr and len(pdf_text.strip()) >= OCR_EARLY_EXIT_MIN_CHARS and _text_looks_high_quality(pdf_text):
        return (pdf_text or "").strip(), "pdf_text"

    run_ocr = force_ocr or len(pdf_text.strip()) < OCR_EARLY_EXIT_MIN_CHARS or not _text_looks_high_quality(pdf_text)
    if not run_ocr:
        return (pdf_text or "").strip(), "pdf_text"

    file.seek(0)
    ocr_text = _run_ocr_on_pdf(file, max_pages=ocr_pages)
    if not pdf_text.strip():
        return (ocr_text or "").strip(), "ocr"
    combined = "=== PDF TEXT ===\n\n" + pdf_text.strip() + "\n\n=== OCR TEXT ===\n\n" + (ocr_text or "").strip()
    return combined.strip(), "pdf_text+ocr"


def extract_text_from_docx(file: BinaryIO) -> str:
    """Extract text from a DOCX file using python-docx."""
    try:
        from docx import Document
    except ImportError:
        raise ImportError("python-docx required: pip install python-docx")
    try:
        doc = Document(file)
        parts = [p.text for p in doc.paragraphs if p.text]
        return "\n\n".join(parts) if parts else ""
    except Exception as e:
        raise ValueError(f"Failed to read DOCX: {e}") from e


def _build_snippet_pack(text: str) -> tuple[str, bool]:
    """
    Build snippet pack: lines within +/- SNIPPET_CONTEXT_LINES of keyword matches.
    Dedupe and cap at SNIPPET_PACK_MAX_CHARS. Returns (pack_text, True if used).
    """
    t0 = time.perf_counter()
    lines = text.splitlines()
    keywords_lower = [k.lower() for k in FOCUS_KEYWORDS]
    match_indices = set()
    for i, line in enumerate(lines):
        ll = line.lower()
        if any(kw in ll for kw in keywords_lower):
            for j in range(
                max(0, i - SNIPPET_CONTEXT_LINES),
                min(len(lines), i + SNIPPET_CONTEXT_LINES + 1),
            ):
                match_indices.add(j)
    if not match_indices:
        elapsed = time.perf_counter() - t0
        logger.info("[extract] snippet build duration=%.2fs (no matches, fallback)", elapsed)
        return text, False
    # Build paragraphs (contiguous line blocks), dedupe by content
    seen = set()
    chunks = []
    for idx in sorted(match_indices):
        block = lines[idx].strip()
        if not block:
            continue
        if block in seen:
            continue
        seen.add(block)
        chunks.append(block)
    pack = "\n\n".join(chunks)
    if len(pack) > SNIPPET_PACK_MAX_CHARS:
        pack = pack[:SNIPPET_PACK_MAX_CHARS] + "\n\n...[snippet pack truncated]..."
    elapsed = time.perf_counter() - t0
    logger.info("[extract] snippet build duration=%.2fs chars=%d", elapsed, len(pack))
    if len(pack) < SNIPPET_MIN_CHARS:
        return text, False
    return pack, True


def _truncate_fallback(text: str) -> tuple[str, list[str]]:
    """First 20k + last 20k with separator. Returns (text, extra_warnings)."""
    warnings = []
    if len(text) <= FALLBACK_HEAD_CHARS + FALLBACK_TAIL_CHARS:
        return text, warnings
    head = text[:FALLBACK_HEAD_CHARS]
    tail = text[-FALLBACK_TAIL_CHARS:] if len(text) > FALLBACK_TAIL_CHARS else ""
    truncated = head + "\n\n...[truncated]...\n\n" + tail
    warnings.append("Input text truncated for extraction.")
    return truncated, warnings


def _prepare_text_for_llm(text: str) -> tuple[str, list[str]]:
    """Snippet pack first; if too small, fallback truncation. Returns (text_for_llm, extra_warnings)."""
    snippet, used = _build_snippet_pack(text)
    if used:
        return _truncate_fallback(snippet)
    return _truncate_fallback(text)


# ---- Regex pre-extraction ----
_RE_RSF = re.compile(
    r"\b(?:rsf|rentable\s+square\s+feet?|sq\.?\s*ft\.?)\b[ \t:]*[\d,]+\.?\d*|[\d,]+\.?\d*[ \t]*(?:rsf|sf|sq\.?\s*ft\.?)\b",
    re.I,
)
_RE_NUM = re.compile(r"[\d,]+\.?\d*")
_RE_ISO_DATE = re.compile(r"\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b")
_RE_TI = re.compile(
    r"\b(?:ti\s+allowance|tenant\s+improvement|improvement\s+allowance)\s*[:\s]*\$?\s*[\d,]+\.?\d*",
    re.I,
)
_RE_FREE_RENT = re.compile(
    r"\b(?:free\s+rent|rent\s+abatement|abatement)\s*(?:of\s*)?(\d+)\s*(?:months?)?",
    re.I,
)
_RE_BASE_OPEX = re.compile(
    r"\b(?:base\s+year\s+)?(?:opex|operating\s+expenses?|cam|nnn)\s*[:\s]*\$?\s*[\d,]+\.?\d*\s*(?:/?\s*sf|psf)?",
    re.I,
)
_RE_BASE_RENT = re.compile(
    r"\b(?:base\s+rent|rental\s+rate|annual\s+rent)\b[^\n$]{0,40}\$?\s*([\d,]+\.?\d*)",
    re.I,
)


def _regex_prefill(text: str) -> dict:
    """Fast regex pass to prefill scenario fields. Returns dict of field -> value (or None)."""
    prefill = {}
    # RSF: look for number in first match
    m = _RE_RSF.search(text)
    if m:
        nums = _RE_NUM.findall(m.group(0))
        if nums:
            try:
                prefill["rsf"] = float(nums[0].replace(",", ""))
            except ValueError:
                pass
    # Dates: first two ISO-like dates often commencement / expiration
    dates = _RE_ISO_DATE.findall(text)
    if len(dates) >= 1:
        y, mo, d = dates[0]
        prefill["commencement"] = f"{y}-{int(mo):02d}-{int(d):02d}"
    if len(dates) >= 2:
        y, mo, d = dates[1]
        prefill["expiration"] = f"{y}-{int(mo):02d}-{int(d):02d}"
    # TI allowance ($/sf)
    m = _RE_TI.search(text)
    if m:
        nums = _RE_NUM.findall(m.group(0))
        if nums:
            try:
                prefill["ti_allowance_psf"] = float(nums[0].replace(",", ""))
            except ValueError:
                pass
    # Free rent months
    m = _RE_FREE_RENT.search(text)
    if m:
        try:
            prefill["free_rent_months"] = int(m.group(1))
        except (ValueError, IndexError):
            pass
    # Base opex $/sf
    m = _RE_BASE_OPEX.search(text)
    if m:
        nums = _RE_NUM.findall(m.group(0))
        if nums:
            try:
                prefill["base_opex_psf_yr"] = float(nums[0].replace(",", ""))
            except ValueError:
                pass
    # Base rent ($/sf/yr)
    m = _RE_BASE_RENT.search(text)
    if m:
        try:
            v = float(m.group(1).replace(",", ""))
            # Keep plausible psf/year range
            if 5 <= v <= 500:
                prefill["rate_psf_yr"] = v
        except ValueError:
            pass
    return prefill


def _safe_date(s: str | None) -> date:
    if not s:
        return date(2026, 1, 1)
    try:
        return date.fromisoformat(s.strip()[:10])
    except (ValueError, TypeError):
        return date(2026, 1, 1)


def _llm_extract_scenario(text: str, prefill: dict) -> dict:
    """Call LLM to fill gaps and validate; prefill contains regex-extracted values."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or not str(api_key).strip():
        raise ValueError("OPENAI_API_KEY not configured")
    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai required: pip install openai")
    client = OpenAI(api_key=api_key)

    prefill_hint = ""
    if prefill:
        prefill_hint = f"\nPre-extracted values (use these when confident, else null + warning): {json.dumps(prefill)}"

    prompt = f"""Extract lease terms as JSON only. No markdown, no prose.
- Output a single JSON object: {{ "scenario": {{ ... }}, "confidence": {{ "rsf": 0.9, ... }}, "warnings": [] }}
- rent_steps: month-index only: [{{"start": 0, "end": 59, "rate_psf_yr": number}}, ...]
- Do not invent values. Use null and add a warning when unknown.
- Apply safe defaults only for required fields; add warning for each default.
{prefill_hint}

Text:
---
{text}
---

JSON:"""

    configured = (os.environ.get("OPENAI_LEASE_MODEL") or "").strip()
    models = [m.strip() for m in configured.split(",") if m.strip()] if configured else ["gpt-4o-mini", "gpt-4.1-mini"]
    last_error: Exception | None = None
    for model in models:
        try:
            t0 = time.perf_counter()
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
            )
            elapsed = time.perf_counter() - t0
            logger.info("[extract] LLM call duration=%.2fs model=%s", elapsed, model)

            raw = response.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```\w*\n?", "", raw)
                raw = re.sub(r"\n?```\s*$", "", raw)
            out = json.loads(raw)
            # Merge prefill into scenario so LLM doesn't have to repeat
            scenario = out.get("scenario") or {}
            for k, v in prefill.items():
                if v is not None and (scenario.get(k) is None or scenario.get(k) == ""):
                    scenario[k] = v
            out["scenario"] = scenario
            return out
        except Exception as e:
            last_error = e
            logger.warning("[extract] model failed model=%s error=%s", model, e)
            continue
    if last_error is not None:
        raise last_error
    raise RuntimeError("No OpenAI model candidates configured")


def _infer_scenario_name(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines[:40]:
        if len(ln) > 90:
            continue
        # Skip headings that are usually generic
        low = ln.lower()
        if any(k in low for k in ("lease", "agreement", "exhibit", "table of contents", "page ")):
            continue
        if re.search(r"[A-Za-z]", ln):
            return ln
    return "Extracted lease"


def _heuristic_extract_scenario(text: str, prefill: dict, llm_error: Exception | None = None) -> tuple[dict, dict[str, float], list[str]]:
    """
    Deterministic fallback when LLM extraction is unavailable.
    Returns scenario dict compatible with Scenario model + confidence + warnings.
    """
    low = text.lower()
    opex_mode = "base_year" if "base year" in low else "nnn"
    rsf = float(prefill.get("rsf", 10000.0) or 10000.0)
    rate = float(prefill.get("rate_psf_yr", 30.0) or 30.0)
    commencement = str(prefill.get("commencement") or "2026-01-01")
    expiration = str(prefill.get("expiration") or "2031-01-31")

    scenario = {
        "name": _infer_scenario_name(text),
        "rsf": rsf,
        "commencement": commencement,
        "expiration": expiration,
        "rent_steps": [{"start": 0, "end": 59, "rate_psf_yr": rate}],
        "free_rent_months": int(prefill.get("free_rent_months", 0) or 0),
        "ti_allowance_psf": float(prefill.get("ti_allowance_psf", 0.0) or 0.0),
        "opex_mode": opex_mode,
        "base_opex_psf_yr": float(prefill.get("base_opex_psf_yr", 10.0) or 10.0),
        "base_year_opex_psf_yr": float(prefill.get("base_opex_psf_yr", 10.0) or 10.0),
        "opex_growth": 0.03,
        "discount_rate_annual": 0.06,
        "parking_spaces": 0,
        "parking_cost_monthly_per_space": 0.0,
    }

    confidence = {
        "rsf": 0.7 if "rsf" in prefill else 0.0,
        "commencement": 0.6 if "commencement" in prefill else 0.0,
        "expiration": 0.6 if "expiration" in prefill else 0.0,
        "rent_steps": 0.5 if "rate_psf_yr" in prefill else 0.2,
        "ti_allowance_psf": 0.6 if "ti_allowance_psf" in prefill else 0.0,
        "free_rent_months": 0.6 if "free_rent_months" in prefill else 0.0,
    }
    warnings = [
        "AI extraction was unavailable; used deterministic fallback extraction.",
        "Please review lease terms before running analysis.",
    ]
    if llm_error:
        msg = str(llm_error).lower()
        if "openai_api_key" in msg:
            warnings.append("OPENAI_API_KEY is not configured on backend.")
        elif "invalid api key" in msg or "incorrect api key" in msg or "unauthorized" in msg or "authentication" in msg:
            warnings.append("OPENAI_API_KEY is invalid for this backend service.")
        elif "model" in msg and ("not found" in msg or "does not exist" in msg or "not have access" in msg):
            warnings.append("Configured OpenAI model is unavailable for this API key.")
        elif "rate" in msg or "quota" in msg or "429" in msg:
            warnings.append("AI provider rate limit/quota reached.")
        elif "timeout" in msg:
            warnings.append("AI extraction timed out.")
        elif "connection" in msg or "network" in msg or "api connection" in msg:
            warnings.append("Backend could not connect to OpenAI API.")
        warnings.append(f"Extractor detail: {str(llm_error)[:160]}")
    return scenario, confidence, warnings


def _apply_safe_defaults(raw: dict) -> tuple[dict, dict[str, float], list[str]]:
    """Apply safe defaults to raw LLM output; return (scenario_dict, confidence, warnings)."""
    scenario = raw.get("scenario") or {}
    confidence = dict(raw.get("confidence") or {})
    warnings = list(raw.get("warnings") or [])

    default_rent_step = [{"start": 0, "end": 59, "rate_psf_yr": 30.0}]

    name = scenario.get("name")
    if not name or not str(name).strip():
        name = "Extracted lease"
        warnings.append("Scenario name missing; default applied.")
    scenario["name"] = str(name).strip()

    rsf = scenario.get("rsf")
    if rsf is None or (isinstance(rsf, (int, float)) and (rsf <= 0 or rsf != rsf)):
        scenario["rsf"] = 10000.0
        if "rsf" not in confidence:
            confidence["rsf"] = 0.0
        warnings.append("RSF missing or invalid; default 10,000 applied.")
    else:
        scenario["rsf"] = float(rsf)

    commencement = scenario.get("commencement")
    scenario["commencement"] = _safe_date(commencement if isinstance(commencement, str) else None)
    if not commencement:
        warnings.append("Commencement date missing; default 2026-01-01 applied.")
        confidence.setdefault("commencement", 0.0)

    expiration = scenario.get("expiration")
    scenario["expiration"] = _safe_date(expiration if isinstance(expiration, str) else None)
    if not expiration:
        warnings.append("Expiration date missing; default 2031-01-31 applied.")
        confidence.setdefault("expiration", 0.0)

    rent_steps = scenario.get("rent_steps")
    if not rent_steps or not isinstance(rent_steps, list) or len(rent_steps) == 0:
        scenario["rent_steps"] = default_rent_step
        warnings.append("Rent steps missing; default single step applied.")
        confidence.setdefault("rent_steps", 0.0)
    else:
        normalized = []
        for step in rent_steps:
            if not isinstance(step, dict):
                continue
            normalized.append({
                "start": int(step.get("start", 0)),
                "end": int(step.get("end", 59)),
                "rate_psf_yr": float(step.get("rate_psf_yr", 30.0)),
            })
        if not normalized:
            scenario["rent_steps"] = default_rent_step
            warnings.append("Rent steps invalid; default applied.")
        else:
            scenario["rent_steps"] = normalized

    scenario.setdefault("free_rent_months", 0)
    scenario.setdefault("ti_allowance_psf", 0.0)
    opex = scenario.get("opex_mode")
    if opex not in ("nnn", "base_year"):
        scenario["opex_mode"] = "nnn"
        warnings.append("Opex mode missing; default NNN applied.")
    scenario.setdefault("base_opex_psf_yr", 10.0)
    scenario.setdefault("base_year_opex_psf_yr", 10.0)
    scenario.setdefault("opex_growth", 0.03)
    scenario.setdefault("discount_rate_annual", 0.06)
    scenario.setdefault("parking_spaces", 0)
    scenario.setdefault("parking_cost_monthly_per_space", 0.0)
    scenario.setdefault("broker_fee", 0.0)
    scenario.setdefault("security_deposit_months", 0.0)
    scenario.setdefault("holdover_months", 0)
    scenario.setdefault("holdover_rent_multiplier", 1.5)
    scenario.setdefault("sublease_income_monthly", 0.0)
    scenario.setdefault("sublease_start_month", 0)
    scenario.setdefault("sublease_duration_months", 0)
    if "one_time_costs" not in scenario:
        scenario["one_time_costs"] = []
    if "termination_option" not in scenario:
        scenario["termination_option"] = None

    for k in list(confidence):
        try:
            confidence[k] = float(confidence[k])
        except (TypeError, ValueError):
            confidence[k] = 0.0

    return scenario, confidence, warnings


def extract_scenario_from_text(text: str, source: str) -> ExtractionResponse:
    """
    Regex prefill + snippet pack + LLM; return ExtractionResponse.
    """
    original_length = len(text)
    if not text or len(text.strip()) < 50:
        scenario = Scenario(
            name="Extracted lease",
            rsf=10000.0,
            commencement=date(2026, 1, 1),
            expiration=date(2031, 1, 31),
            rent_steps=[RentStep(start=0, end=59, rate_psf_yr=30.0)],
            free_rent_months=0,
            ti_allowance_psf=0.0,
            opex_mode=OpexMode.NNN,
            base_opex_psf_yr=10.0,
            base_year_opex_psf_yr=10.0,
            opex_growth=0.03,
            discount_rate_annual=0.06,
        )
        return ExtractionResponse(
            scenario=scenario,
            confidence={},
            warnings=["Document text too short or empty; all values are defaults. Please review."],
            source=source,
            text_length=original_length,
        )

    prefill = _regex_prefill(text)
    text_for_llm, extra_warnings = _prepare_text_for_llm(text)
    try:
        raw = _llm_extract_scenario(text_for_llm, prefill=prefill)
        scenario_dict, confidence, warnings = _apply_safe_defaults(raw)
        warnings = extra_warnings + warnings
    except Exception as e:
        print("AI_EXTRACT_FAIL", {"err": str(e)[:400], "type": type(e).__name__}, flush=True)
        raise
    scenario = Scenario.model_validate(scenario_dict)
    return ExtractionResponse(
        scenario=scenario,
        confidence=confidence,
        warnings=warnings,
        source=source,
        text_length=original_length,
    )
