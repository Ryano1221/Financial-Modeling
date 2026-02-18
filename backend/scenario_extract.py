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
from typing import Any, BinaryIO

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
_RE_US_DATE = re.compile(r"\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](20\d{2})\b")
_RE_MONTH_DATE = re.compile(
    r"(?i)\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b"
)
_RE_COMM_LABEL = re.compile(
    r"(?i)\b(?:estimated\s+commencement(?:\s+date)?|commencement(?:\s+date)?|commencing|lease\s+commencement)\b[^A-Za-z0-9]{0,20}([^\n]{0,120})"
)
_RE_EXP_LABEL = re.compile(
    r"(?i)\b(?:estimated\s+(?:termination|expiration)\s+date|termination(?:\s+date)?|expiration(?:\s+date)?|expires?|expiring|lease\s+expiration)\b[^A-Za-z0-9]{0,20}([^\n]{0,120})"
)
_RE_BUILDING = re.compile(r"(?i)\b(?:building|property)\s*(?:name)?\s*[:#-]\s*([^\n,;]{3,80})")
_RE_SUITE = re.compile(r"(?i)\b(?:suite|ste\.?|unit|space|premises)\b\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\- ]{0,30})")
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
_RE_YEAR_RATE_INLINE = re.compile(
    r"(?i)\b(?:lease\s*)?years?\s*(\d{1,2})(?:\s*(?:-|to|through|thru|–|—)\s*(\d{1,2}))?"
    r"\b[^\n$]{0,120}\$?\s*([\d,]+(?:\.\d{1,4})?)"
)
_RE_YEAR_TABLE_HEADER = re.compile(r"(?i)\b(?:lease\s*)?years?\b.*\b(?:rent|rate|psf|/sf|per\s+sf)\b")
_RE_YEAR_TABLE_ROW = re.compile(
    r"^\s*(\d{1,2})(?:\s*(?:-|to|through|thru|–|—)\s*(\d{1,2}))?\s+\$?\s*([\d,]+(?:\.\d{1,4})?)\b"
)


def _parse_text_date_token(s: str) -> str | None:
    token = (s or "").strip()
    if not token:
        return None
    m = _RE_ISO_DATE.search(token)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    m = _RE_US_DATE.search(token)
    if m:
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    m = _RE_MONTH_DATE.search(token)
    if m:
        mon = m.group(1).lower()[:3]
        months = {
            "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
            "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
        }
        mo = months.get(mon)
        if mo:
            d = int(m.group(2))
            y = int(m.group(3))
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def _coerce_int_token(value: Any, default: int | None = None) -> int | None:
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        if value != value:
            return default
        return int(value)
    if isinstance(value, str):
        token = value.strip().replace(",", "")
        if not token:
            return default
        m = re.search(r"-?\d+", token)
        if m:
            try:
                return int(m.group(0))
            except ValueError:
                return default
    return default


def _coerce_float_token(value: Any, default: float | None = None) -> float | None:
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        if value != value:
            return default
        return float(value)
    if isinstance(value, str):
        token = value.strip().replace(",", "")
        if not token:
            return default
        m = re.search(r"-?\d+(?:\.\d+)?", token)
        if m:
            try:
                return float(m.group(0))
            except ValueError:
                return default
    return default


def _term_month_count(commencement: date, expiration: date) -> int:
    """
    Return lease term as month count.
    Example: 2026-01-01 to 2031-01-31 => 60 (months 0..59).
    """
    months = (expiration.year - commencement.year) * 12 + (expiration.month - commencement.month)
    if expiration.day < commencement.day:
        months -= 1
    return max(1, months)


def _convert_year_index_steps_to_month_steps(steps: list[dict[str, float | int]], one_based: bool) -> list[dict[str, float | int]]:
    offset = 1 if one_based else 0
    normalized_years: list[dict[str, float | int]] = []
    for step in sorted(steps, key=lambda s: (int(s["start"]), int(s["end"]))):
        year_start = max(0, int(step["start"]) - offset)
        year_end = max(year_start, int(step["end"]) - offset)
        normalized_years.append(
            {
                "start": year_start,
                "end": year_end,
                "rate_psf_yr": float(step["rate_psf_yr"]),
            }
        )
    if not normalized_years:
        return []
    # Some proposals use absolute lease-year labels (e.g. "Years 12-13").
    # Rebase to the first detected year so the extracted schedule always starts at month 0.
    min_year = min(int(step["start"]) for step in normalized_years)
    converted: list[dict[str, float | int]] = []
    for step in normalized_years:
        rebased_start = max(0, int(step["start"]) - min_year)
        rebased_end = max(rebased_start, int(step["end"]) - min_year)
        converted.append(
            {
                "start": rebased_start * 12,
                "end": ((rebased_end + 1) * 12) - 1,
                "rate_psf_yr": float(step["rate_psf_yr"]),
            }
        )
    return converted


def _looks_like_year_index_steps(steps: list[dict[str, float | int]], term_month_count: int) -> bool:
    """
    Detect common extraction mistakes where "Year 1, Year 2..." was interpreted
    as months 0,1,... instead of month ranges.
    """
    if len(steps) < 2:
        return False
    max_end = max(int(s["end"]) for s in steps)
    max_span = max((int(s["end"]) - int(s["start"]) + 1) for s in steps)
    # Strong signal: many tiny contiguous buckets like 0-0,1-1,2-2 (or 1-1,2-2...).
    if len(steps) >= 3 and max_end <= 12 and max_span <= 2:
        return True
    if term_month_count < 24:
        return False
    if max_end > 30 or max_span > 6:
        return False
    # If interpreted as months, schedule covers too little of the term.
    if (max_end + 1) >= max(18, term_month_count // 2):
        return False
    # If interpreted as years, coverage should be close to total term.
    years_coverage_months = (max_end + 1) * 12
    return years_coverage_months >= max(24, term_month_count - 24)


def _repair_and_extend_month_steps(
    steps: list[dict[str, float | int]], term_month_count: int
) -> list[dict[str, float | int]]:
    if not steps:
        return []
    ordered = sorted(steps, key=lambda s: (int(s["start"]), int(s["end"])))
    normalized: list[dict[str, float | int]] = []
    for raw in ordered:
        start = max(0, int(raw["start"]))
        end = max(start, int(raw["end"]))
        rate = max(0.0, float(raw["rate_psf_yr"]))
        if not normalized:
            if start != 0:
                start = 0
            normalized.append({"start": start, "end": end, "rate_psf_yr": rate})
            continue
        prev = normalized[-1]
        expected = int(prev["end"]) + 1
        if start > expected:
            prev["end"] = start - 1
        elif start < expected:
            start = expected
            if end < start:
                end = start
        normalized.append({"start": start, "end": end, "rate_psf_yr": rate})
    target_end = max(0, term_month_count - 1)
    if normalized[-1]["end"] < target_end:
        normalized[-1]["end"] = target_end
    return normalized


def _normalize_rent_steps(
    raw_steps: Any,
    term_month_count: int,
    prefill: dict | None = None,
) -> tuple[list[dict[str, float | int]], list[str]]:
    parsed: list[dict[str, float | int]] = []
    notes: list[str] = []
    for step in raw_steps or []:
        if not isinstance(step, dict):
            continue
        start = _coerce_int_token(step.get("start"), 0)
        end = _coerce_int_token(step.get("end"), start)
        rate = _coerce_float_token(step.get("rate_psf_yr"), 30.0)
        if start is None or end is None or rate is None:
            continue
        if end < start:
            end = start
        parsed.append({"start": start, "end": end, "rate_psf_yr": max(0.0, float(rate))})

    if not parsed:
        return (
            [{"start": 0, "end": max(0, term_month_count - 1), "rate_psf_yr": 30.0}],
            ["Rent steps missing; default single step applied."],
        )

    basis = str((prefill or {}).get("_rent_steps_basis") or "").strip().lower()
    year_base_hint = _coerce_int_token((prefill or {}).get("_rent_steps_year_base"), None)
    looks_like_years = basis == "year_index" or _looks_like_year_index_steps(parsed, term_month_count)
    if looks_like_years:
        one_based = year_base_hint == 1
        if year_base_hint is None:
            min_year_index = min(min(int(s["start"]), int(s["end"])) for s in parsed)
            one_based = min_year_index >= 1
        parsed = _convert_year_index_steps_to_month_steps(parsed, one_based=one_based)
        notes.append("Rent schedule interpreted as lease years and converted to month ranges (Year 1 = months 0-11).")

    return _repair_and_extend_month_steps(parsed, term_month_count), notes


def _extract_year_table_rent_steps(text: str) -> list[dict[str, float | int]]:
    """
    Parse common proposal tables like:
      Year 1: $45.00
      Years 2-3: $46.35
    and convert to month-index rent steps.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    year_rows: list[tuple[int, int, float]] = []
    header_window = 0
    for line in lines[:800]:
        if _RE_YEAR_TABLE_HEADER.search(line):
            header_window = 30
        if header_window > 0:
            m = _RE_YEAR_TABLE_ROW.search(line)
            if m:
                y1 = _coerce_int_token(m.group(1), None)
                y2 = _coerce_int_token(m.group(2), y1)
                rate = _coerce_float_token(m.group(3), None)
                if y1 is not None and y2 is not None and rate is not None and 2 <= rate <= 500:
                    if y2 < y1:
                        y1, y2 = y2, y1
                    year_rows.append((y1, y2, float(rate)))
            header_window -= 1

        for m in _RE_YEAR_RATE_INLINE.finditer(line):
            y1 = _coerce_int_token(m.group(1), None)
            y2 = _coerce_int_token(m.group(2), y1)
            rate = _coerce_float_token(m.group(3), None)
            if y1 is None or y2 is None or rate is None:
                continue
            matched = line[m.start():m.end()]
            if "$" not in matched and not re.search(r"(?i)\b(?:rent|rate|psf|/sf|per\s+sf)\b", line):
                continue
            if not (2 <= rate <= 500):
                continue
            if y2 < y1:
                y1, y2 = y2, y1
            year_rows.append((y1, y2, float(rate)))

    if not year_rows:
        return []

    deduped: list[tuple[int, int, float]] = []
    seen: set[tuple[int, int, float]] = set()
    for y1, y2, rate in sorted(year_rows, key=lambda x: (x[0], x[1], x[2])):
        key = (int(y1), int(y2), round(float(rate), 4))
        if key in seen:
            continue
        seen.add(key)
        deduped.append((int(y1), int(y2), float(rate)))

    min_year = min(y1 for y1, _, _ in deduped)
    one_based = min_year >= 1
    raw_steps = [{"start": y1, "end": y2, "rate_psf_yr": rate} for y1, y2, rate in deduped]
    month_steps = _convert_year_index_steps_to_month_steps(raw_steps, one_based=one_based)
    if not month_steps:
        return []
    derived_term_months = max(int(step["end"]) for step in month_steps) + 1
    return _repair_and_extend_month_steps(month_steps, term_month_count=max(12, derived_term_months))


def _regex_prefill(text: str) -> dict:
    """Fast regex pass to prefill scenario fields. Returns dict of field -> value (or None)."""
    prefill = {}
    def _in_example_context(raw_text: str, idx: int) -> bool:
        prefix = raw_text[max(0, idx - 28):idx].lower()
        return ("e.g" in prefix) or ("example" in prefix)

    # RSF: score all matches; avoid ratio/rate contexts (e.g., "per 1,000 RSF").
    rsf_best: tuple[int, int, float] | None = None  # (score, start, value)
    for m in _RE_RSF.finditer(text):
        nums = _RE_NUM.findall(m.group(0))
        if not nums:
            continue
        try:
            value = float(nums[0].replace(",", ""))
        except ValueError:
            continue
        if not (100 <= value <= 2_000_000):
            continue
        start = max(0, m.start() - 140)
        end = min(len(text), m.end() + 140)
        snippet = text[start:end].replace("\n", " ").lower()
        score = 0
        if any(k in snippet for k in ("premises", "suite", "rentable", "square feet", "consisting of")):
            score += 4
        if 2_000 <= value <= 300_000:
            score += 1
        if re.search(r"(?i)\bper\s+1,?000\s+rsf\b|/1,?000\s*rsf|ratio", snippet):
            score -= 9
        if re.search(r"(?i)\(\s*\d[\d,]*\s*rsf\s*/\s*\d[\d,]*\s*rsf\s*\)", snippet):
            score -= 8
        if any(k in snippet for k in ("cam", "opex", "operating expenses", "taxes", "insurance", "parking")):
            score -= 4
        if any(k in snippet for k in ("shopping center contains", "total rsf", "entire center")):
            score -= 5
        if re.search(r"(?i)\$\s*\d[\d,]*(?:\.\d+)?\s*(?:/|per)\s*(?:sf|rsf)", snippet):
            score -= 4
        candidate = (score, m.start(), value)
        if rsf_best is None or candidate[0] > rsf_best[0] or (candidate[0] == rsf_best[0] and candidate[1] < rsf_best[1]):
            rsf_best = candidate
    if rsf_best is not None:
        prefill["rsf"] = rsf_best[2]
    # Dates: prefer labeled commencement/expiration first, then generic first-two date fallback.
    comm = None
    exp = None
    m = _RE_COMM_LABEL.search(text)
    if m:
        comm = _parse_text_date_token(m.group(1))
    if not comm:
        m = re.search(r"(?i)\bcommenc(?:e|ing|ement)\b[^\n]{0,140}", text)
        if m and "e.g" not in (m.group(0) or "").lower():
            comm = _parse_text_date_token(m.group(0))
    m = _RE_EXP_LABEL.search(text)
    if m:
        exp = _parse_text_date_token(m.group(1))
    if not exp:
        m = re.search(r"(?i)\bending\s+on\b[^\n]{0,120}", text)
        if m and "e.g" not in (m.group(0) or "").lower():
            exp = _parse_text_date_token(m.group(0))
    if not exp:
        m = re.search(r"(?i)\b(?:sublease\s+term|term)\b[^\n]{0,200}\bthrough\b[^\n]{0,120}", text)
        if m and "e.g" not in (m.group(0) or "").lower():
            exp = _parse_text_date_token(m.group(0))
    if not comm or not exp:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for idx, ln in enumerate(lines):
            low_ln = ln.lower()
            is_comm_label = bool(
                "estimated commencement date" in low_ln
                or re.search(r"(?i)\bcommencement\s+date\s*[:\-]\s*$", low_ln)
            )
            is_exp_label = bool(
                "estimated termination date" in low_ln
                or "estimated expiration date" in low_ln
                or re.search(r"(?i)\b(?:expiration|termination)\s+date\s*[:\-]\s*$", low_ln)
            )
            if not comm and is_comm_label:
                for nxt in lines[idx + 1: idx + 8]:
                    if "e.g" in nxt.lower() or "example" in nxt.lower():
                        continue
                    parsed = _parse_text_date_token(nxt)
                    if parsed:
                        comm = parsed
                        break
            if not exp and is_exp_label:
                for nxt in lines[idx + 1: idx + 8]:
                    if "e.g" in nxt.lower() or "example" in nxt.lower():
                        continue
                    parsed = _parse_text_date_token(nxt)
                    if parsed:
                        exp = parsed
                        break
            if comm and exp:
                break
    if not comm or not exp:
        generic_dates: list[str] = []
        for hit in _RE_ISO_DATE.finditer(text):
            if _in_example_context(text, hit.start()):
                continue
            iso = _parse_text_date_token(hit.group(0))
            if iso:
                generic_dates.append(iso)
        for hit in _RE_US_DATE.finditer(text):
            if _in_example_context(text, hit.start()):
                continue
            iso = _parse_text_date_token(hit.group(0))
            if iso:
                generic_dates.append(iso)
        for hit in _RE_MONTH_DATE.finditer(text):
            if _in_example_context(text, hit.start()):
                continue
            iso = _parse_text_date_token(hit.group(0))
            if iso:
                generic_dates.append(iso)
        # de-duplicate while preserving order
        seen = set()
        ordered = []
        for d in generic_dates:
            if d in seen:
                continue
            seen.add(d)
            ordered.append(d)
        if not comm and len(ordered) >= 1:
            comm = ordered[0]
        if not exp and len(ordered) >= 2:
            exp = ordered[1]
    if comm:
        prefill["commencement"] = comm
    if exp:
        prefill["expiration"] = exp
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
    year_table_steps = _extract_year_table_rent_steps(text)
    if year_table_steps:
        inferred_term_from_dates = None
        if comm and exp:
            inferred_term_from_dates = _term_month_count(_safe_date(comm), _safe_date(exp))
        year_table_term = max(int(step["end"]) for step in year_table_steps) + 1
        # Guardrail: in amendment/sublease files, master-lease year tables can appear
        # and be wildly out of range for the current document's term.
        if not (
            inferred_term_from_dates
            and inferred_term_from_dates <= 36
            and year_table_term > inferred_term_from_dates * 4
        ):
            prefill["rent_steps"] = year_table_steps
            prefill["_rent_steps_basis"] = "month_index"
            prefill["_rent_steps_source"] = "year_table_regex"
    # Opex mode
    low = text.lower()
    if "base year" in low or "expense stop" in low:
        prefill["opex_mode"] = "base_year"
    elif " nnn" in f" {low}" or "triple net" in low:
        prefill["opex_mode"] = "nnn"
    # Scenario name from building/suite if possible
    building = None
    suite = None
    m = _RE_BUILDING.search(text)
    if m:
        building = m.group(1).strip(" ,.-")
    m = _RE_SUITE.search(text)
    if m:
        suite = m.group(1).strip(" ,.-")
    if building and suite:
        prefill["name"] = f"{building} Suite {suite}"
    elif building:
        prefill["name"] = building
    elif suite:
        prefill["name"] = f"Suite {suite}"
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
    timeout_sec = 45.0
    try:
        timeout_env = float((os.environ.get("OPENAI_EXTRACT_TIMEOUT_SEC") or "45").strip())
        if timeout_env > 0:
            timeout_sec = timeout_env
    except (TypeError, ValueError, AttributeError):
        pass
    client = OpenAI(api_key=api_key, timeout=timeout_sec)

    prefill_for_model = {k: v for k, v in (prefill or {}).items() if not str(k).startswith("_")}
    prefill_hint = ""
    if prefill_for_model:
        prefill_hint = f"\nPre-extracted values (use these when confident, else null + warning): {json.dumps(prefill_for_model)}"

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
            for k, v in prefill_for_model.items():
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
    labeled_patterns = [
        re.compile(r"(?i)\b(?:building|property)\s*(?:name)?\s*[:#-]\s*([^\n,;]{3,80})"),
        re.compile(r"(?i)\bpremises\s*[:#-]\s*(?:suite|ste\.?|unit)?\s*([A-Za-z0-9][A-Za-z0-9\- ]{1,40})"),
    ]
    for ln in lines[:80]:
        for pat in labeled_patterns:
            m = pat.search(ln)
            if not m:
                continue
            candidate = " ".join(m.group(1).split()).strip(" ,.;:-")
            if candidate and 2 <= len(candidate) <= 80:
                return candidate

    banned_fragments = (
        "hereby leases",
        "landlord",
        "tenant",
        "this lease",
        "agreement made",
        "commencement",
        "expiration",
        "term",
        "rent",
        "operating expenses",
        "table of contents",
    )
    for ln in lines[:40]:
        if len(ln) > 90:
            continue
        # Skip headings that are usually generic
        low = ln.lower()
        if any(k in low for k in ("lease", "agreement", "exhibit", "table of contents", "page ")):
            continue
        if any(k in low for k in banned_fragments):
            continue
        if re.fullmatch(r"[\d\W_]+", ln):
            continue
        # Avoid picking long legal clauses as scenario names.
        if "," in ln and len(ln.split()) > 9:
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
    term_month_count = _term_month_count(_safe_date(commencement), _safe_date(expiration))
    prefill_steps = prefill.get("rent_steps") if isinstance(prefill.get("rent_steps"), list) else None
    if prefill_steps:
        rent_steps, rent_step_notes = _normalize_rent_steps(prefill_steps, term_month_count=term_month_count, prefill=prefill)
    else:
        rent_steps, rent_step_notes = _normalize_rent_steps(
            [{"start": 0, "end": max(0, term_month_count - 1), "rate_psf_yr": rate}],
            term_month_count=term_month_count,
            prefill=prefill,
        )

    scenario = {
        "name": _infer_scenario_name(text),
        "rsf": rsf,
        "commencement": commencement,
        "expiration": expiration,
        "rent_steps": rent_steps,
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
    warnings.extend(rent_step_notes)
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


def _apply_safe_defaults(raw: dict, prefill: dict | None = None) -> tuple[dict, dict[str, float], list[str]]:
    """Apply safe defaults to raw LLM output; return (scenario_dict, confidence, warnings)."""
    scenario = raw.get("scenario") or {}
    confidence = dict(raw.get("confidence") or {})
    warnings = list(raw.get("warnings") or [])

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
    commencement_date = commencement if isinstance(commencement, date) else _safe_date(commencement if isinstance(commencement, str) else None)
    scenario["commencement"] = commencement_date
    if not commencement:
        warnings.append("Commencement date missing; default 2026-01-01 applied.")
        confidence.setdefault("commencement", 0.0)

    expiration = scenario.get("expiration")
    expiration_date = expiration if isinstance(expiration, date) else _safe_date(expiration if isinstance(expiration, str) else None)
    scenario["expiration"] = expiration_date
    if not expiration:
        warnings.append("Expiration date missing; default 2031-01-31 applied.")
        confidence.setdefault("expiration", 0.0)

    term_month_count = _term_month_count(commencement_date, expiration_date)
    rent_steps_input = scenario.get("rent_steps")
    had_explicit_rent_steps = isinstance(rent_steps_input, list) and len(rent_steps_input) > 0
    if not isinstance(rent_steps_input, list) or len(rent_steps_input) == 0:
        rent_steps_input = (prefill or {}).get("rent_steps") if isinstance((prefill or {}).get("rent_steps"), list) else []
        if rent_steps_input:
            warnings.append("Rent steps inferred from rent schedule table in the uploaded file.")
    normalized_steps, rent_step_notes = _normalize_rent_steps(
        rent_steps_input,
        term_month_count=term_month_count,
        prefill=prefill,
    )
    scenario["rent_steps"] = normalized_steps
    warnings.extend(rent_step_notes)
    if not had_explicit_rent_steps:
        confidence.setdefault("rent_steps", 0.0)

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
    raw: dict | None = None
    llm_error: Exception | None = None
    try:
        raw = _llm_extract_scenario(text_for_llm, prefill=prefill)
    except Exception as e:
        llm_error = e
        logger.warning("[extract] AI extraction failed; using deterministic fallback. err=%s", str(e)[:280])
        print("AI_EXTRACT_FAIL", {"err": str(e)[:400], "type": type(e).__name__}, flush=True)

    if raw is None:
        fallback_scenario, fallback_confidence, fallback_warnings = _heuristic_extract_scenario(
            text,
            prefill=prefill,
            llm_error=llm_error,
        )
        fallback_raw = {
            "scenario": fallback_scenario,
            "confidence": fallback_confidence,
            "warnings": fallback_warnings,
        }
        scenario_dict, confidence, warnings = _apply_safe_defaults(fallback_raw, prefill=prefill)
    else:
        scenario_dict, confidence, warnings = _apply_safe_defaults(raw, prefill=prefill)

    warnings = extra_warnings + warnings
    scenario = Scenario.model_validate(scenario_dict)
    return ExtractionResponse(
        scenario=scenario,
        confidence=confidence,
        warnings=warnings,
        source=source,
        text_length=original_length,
    )
