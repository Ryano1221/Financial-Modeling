from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import re
import time
import traceback
import uuid
from datetime import date
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend directory so OPENAI_API_KEY etc. are available
load_dotenv(Path(__file__).resolve().parent / ".env")

from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from engine.compute import compute_cashflows
from generate_scenarios import generate_scenarios
from lease_extract import extract_lease
from models import (
    CanonicalComputeResponse,
    CanonicalLease,
    CashflowResult,
    CreateReportRequest,
    CreateReportResponse,
    ExtractionResponse,
    GenerateScenariosRequest,
    GenerateScenariosResponse,
    LeaseExtraction,
    NormalizerResponse,
    ReportRequest,
    Scenario,
)
from engine.canonical_compute import compute_canonical, normalize_canonical_lease
from scenario_extract import (
    extract_text_from_pdf,
    extract_text_from_pdf_with_ocr,
    extract_text_from_docx,
    extract_scenario_from_text,
    text_quality_requires_ocr,
)
from reports_store import load_report, save_report
from routes.api import router as api_router
from routes.webhooks import router as webhooks_router
from brands import get_brand, list_brands
from services.input_normalizer import (
    InputSource,
    _scenario_to_canonical,
    _dict_to_canonical,
    _compute_confidence_and_missing,
)
try:
    from cache.disk_cache import (
        get_cached_extraction,
        set_cached_extraction,
        get_cached_report,
        set_cached_report,
    )
except ModuleNotFoundError:
    try:
        from backend.cache.disk_cache import (
            get_cached_extraction,
            set_cached_extraction,
            get_cached_report,
            set_cached_report,
        )
    except ModuleNotFoundError:
        # Last-resort fallback so container startup is never blocked by optional cache packaging.
        def get_cached_extraction(*args, **kwargs):
            return None

        def set_cached_extraction(*args, **kwargs) -> None:
            return None

        def get_cached_report(*args, **kwargs):
            return None

        def set_cached_report(*args, **kwargs) -> None:
            return None

print("BOOT_VERSION", "health_v_2026_02_16_2055", flush=True)

REPORT_BASE_URL = os.environ.get(
    "REPORT_BASE_URL",
    "https://thecremodel.com" if os.environ.get("RENDER") else "http://localhost:3000",
)

# Version for /health and BOOT log (Render sets RENDER_GIT_COMMIT)
VERSION = (os.environ.get("RENDER_GIT_COMMIT") or "").strip() or "unknown"


def _ai_enabled() -> bool:
    key = os.getenv("OPENAI_API_KEY", "")
    return bool(key and key.strip())


app = FastAPI(title="Lease Deck Backend", version="0.1.0")

# CORS: use ALLOWED_ORIGINS env (comma-separated) if set, else default
_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _origins_env:
    ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]
else:
    ALLOWED_ORIGINS = [
        "https://thecremodel.com",
        "https://www.thecremodel.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        logging.getLogger("uvicorn.error").info(
            "request_id=%s method=%s path=%s status=%s duration_ms=%.0f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        response.headers["X-Request-Id"] = request_id
        return response


app.add_middleware(RequestLogMiddleware)
app.include_router(api_router)
app.include_router(webhooks_router)


# Deploy marker: change this string after each deploy so Render logs prove new code is running
DEPLOY_MARKER = "v4_2026_02_16_2215"


@app.on_event("startup")
async def _startup_log():
    commit = (os.getenv("RENDER_GIT_COMMIT") or "").strip() or "not-set"
    print("BOOT", {
        "health_v": "v3_2026_02_16_1900",
        "source_file": str(Path(__file__).resolve()),
        "render_git_commit": commit,
        "render_service_name": os.getenv("RENDER_SERVICE_NAME", ""),
    }, flush=True)
    _LOG.info("DEPLOY_MARKER %s commit=%s", DEPLOY_MARKER, commit)


@app.on_event("startup")
def startup_log() -> None:
    import logging
    ai_enabled = _ai_enabled()
    port = os.environ.get("PORT", "8010")
    host = os.environ.get("HOST", "127.0.0.1")
    logging.getLogger("uvicorn.error").info(
        "Backend starting on http://%s:%s (OPENAI_API_KEY configured: %s) version=%s",
        host, port, ai_enabled, VERSION,
    )
    if not ai_enabled:
        logging.getLogger("uvicorn.error").warning(
            "OPENAI_API_KEY is not set. Extraction and AI features will not work."
        )
    print("Backend ready on http://127.0.0.1:8010", flush=True)
    if get_cached_extraction.__module__ == __name__:
        logging.getLogger("uvicorn.error").warning(
            "cache.disk_cache module not importable in runtime image; running with in-memory/no-op cache."
        )


@app.get("/health")
def health():
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    ai_enabled = bool(key)
    openai_configured = bool(key)
    openai_key_prefix = (key[:7] if key else "") or None
    version = "health_v_2026_02_16_2055"
    print("HEALTH", {"version": version, "ai_enabled": ai_enabled}, flush=True)
    return {
        "status": "ok",
        "ai_enabled": ai_enabled,
        "openai_configured": openai_configured,
        "openai_key_prefix": openai_key_prefix,
        "version": version,
    }


@app.get("/health/pdf")
def health_pdf():
    """
    Runtime check for Playwright PDF dependencies.
    Returns 200 only when Chromium can launch successfully.
    """
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        raise HTTPException(status_code=503, detail="Playwright is not installed.")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            page = browser.new_page()
            page.set_content("<html><body>ok</body></html>")
            browser.close()
    except Exception as e:
        msg = str(e)
        if len(msg) > 500:
            msg = msg[:500]
        raise HTTPException(
            status_code=503,
            detail=f"Playwright runtime unavailable: {msg}",
        ) from e

    return {"status": "ok", "pdf_runtime": "ready"}


@app.get("/version")
def version():
    payload = {
        "version_v": "v4_2026_02_16_2045",
        "source_file": str(Path(__file__).resolve()),
        "render_git_commit": os.getenv("RENDER_GIT_COMMIT", ""),
        "render_service_name": os.getenv("RENDER_SERVICE_NAME", ""),
    }
    print("VERSION", payload, flush=True)
    return payload


@app.post("/extract", response_model=ExtractionResponse)
def extract_document(
    file: UploadFile = File(...),
    force_ocr: Optional[bool] = Form(None),
    ocr_pages: int = Form(5),
) -> ExtractionResponse:
    """
    Accept PDF or DOCX (multipart): extract text. For PDF, OCR runs when forced, or automatically
    when text quality is poor (short text, low alnum ratio, replacement chars, many short lines).
    force_ocr: true = always OCR, false = never OCR, omit = auto. Returns ocr_used and extraction_source.
    ocr_pages: max PDF pages to OCR when OCR runs (default 5).
    """
    filename = file.filename or "(no name)"
    content_type = getattr(file, "content_type", None) or ""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    fn = file.filename.lower()
    if not (fn.endswith(".pdf") or fn.endswith(".docx")):
        raise HTTPException(status_code=400, detail="File must be PDF or DOCX")
    try:
        contents = file.file.read()
    except Exception as e:
        print(f"[extract] Failed to read file: {e!s}")
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}") from e
    size = len(contents)
    print(f"[extract] filename={filename!r} content_type={content_type!r} size_bytes={size}")
    if size == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    cache_key: bool | str = "auto" if force_ocr is None else force_ocr
    cached = get_cached_extraction(contents, cache_key)
    if cached is not None:
        print(f"[extract] cache hit for {filename!r}")
        return ExtractionResponse.model_validate(cached)

    buf = BytesIO(contents)
    text = ""
    source = "docx"
    ocr_used = False
    extraction_source: str = "text"
    try:
        if fn.endswith(".pdf"):
            pages = 5
            try:
                pages = max(1, min(50, int(ocr_pages)))
            except (TypeError, ValueError):
                pass
            if force_ocr is True:
                text, source = extract_text_from_pdf_with_ocr(buf, force_ocr=True, ocr_pages=pages)
                ocr_used = source in ("ocr", "pdf_text+ocr")
                extraction_source = "ocr"
                print(f"[extract] path=pdf force_ocr=true source={source!r} text_len={len(text)}")
            elif force_ocr is False:
                text = extract_text_from_pdf(buf)
                source = "pdf_text"
                extraction_source = "text"
                print(f"[extract] path=pdf force_ocr=false text_len={len(text)}")
            else:
                # Auto: first pass without OCR, then OCR if quality is poor
                text = extract_text_from_pdf(buf)
                if text_quality_requires_ocr(text):
                    buf.seek(0)
                    text, source = extract_text_from_pdf_with_ocr(buf, force_ocr=True, ocr_pages=pages)
                    ocr_used = True
                    extraction_source = "auto_ocr"
                    print(f"[extract] path=pdf auto_ocr triggered source={source!r} text_len={len(text)}")
                else:
                    source = "pdf_text"
                    extraction_source = "text"
                    print(f"[extract] path=pdf auto no OCR text_len={len(text)}")
        else:
            text = extract_text_from_docx(buf)
            source = "docx"
            extraction_source = "text"
            print(f"[extract] path=docx text_len={len(text)}")
    except ValueError as e:
        print(f"[extract] ValueError: {e!s}")
        raise HTTPException(status_code=400, detail=str(e))
    except ImportError as e:
        print(f"[extract] ImportError: {e!s}")
        raise HTTPException(
            status_code=503,
            detail="OCR or DOCX support not available. Install pdf2image, pytesseract, and poppler (system) for OCR; python-docx for DOCX.",
        ) from e
    except Exception as e:
        print(f"[extract] Text extraction error: {e!s}")
        err_msg = str(e).lower()
        if "poppler" in err_msg or "tesseract" in err_msg:
            raise HTTPException(
                status_code=503,
                detail="OCR failed. Ensure poppler and tesseract are installed (e.g. brew install poppler tesseract).",
            ) from e
        raise HTTPException(status_code=500, detail=f"Text extraction failed: {e!s}") from e
    if not text.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from the document")
    try:
        response = extract_scenario_from_text(text, source=source)
        response = response.model_copy(update={"ocr_used": ocr_used, "extraction_source": extraction_source})
        set_cached_extraction(contents, cache_key, response.model_dump(mode="json"))
        return response
    except ValueError as e:
        print(f"[extract] LLM ValueError: {e!s}")
        if "OPENAI_API_KEY" in str(e):
            raise HTTPException(status_code=503, detail="OPENAI_API_KEY not configured.") from e
        if "rate" in str(e).lower() or "quota" in str(e).lower():
            raise HTTPException(status_code=429, detail="API rate limit or quota exceeded. Please try again later.") from e
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[extract] AI extraction error: {e!s}")
        err_lower = str(e).lower()
        if "rate" in err_lower or "quota" in err_lower:
            raise HTTPException(status_code=429, detail="API rate limit or quota exceeded. Please try again later.") from e
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {e!s}") from e


@app.post("/upload_lease", response_model=LeaseExtraction)
def upload_lease(file: UploadFile = File(...)) -> LeaseExtraction:
    """
    Accept a PDF lease document, extract text, run LLM extraction, return LeaseExtraction
    with per-field value, confidence, and citation snippet.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    try:
        contents = file.file.read()
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file")
        from io import BytesIO
        return extract_lease(BytesIO(contents))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e!s}")


@app.post("/compute", response_model=CashflowResult)
def compute_scenario(scenario: Scenario) -> CashflowResult:
    """
    Compute tenant-side lease economics for a given scenario.
    """
    _, result = compute_cashflows(scenario)
    return result


COMPUTE_CANONICAL_EXPECTED = (
    "CanonicalLease JSON: scenario_id?, scenario_name?, premises_name?, address?, building_name?, suite?, floor?, rsf, "
    "commencement_date (YYYY-MM-DD), expiration_date (YYYY-MM-DD), term_months, "
    "rent_schedule: [{start_month, end_month, rent_psf_annual}], lease_type (e.g. NNN), "
    "expense_structure_type (nnn|base_year), free_rent_months?, discount_rate_annual?, etc."
)

# Same logger as middleware / normalize so Render shows all lines
_LOG = logging.getLogger("uvicorn.error")

# Map lowercase/variants to CanonicalLease.lease_type enum values (NNN, Gross, etc.)
_LEASE_TYPE_MAP = {
    "nnn": "NNN",
    "gross": "Gross",
    "modified gross": "Modified Gross",
    "modified_gross": "Modified Gross",
    "absolute nnn": "Absolute NNN",
    "absolute_nnn": "Absolute NNN",
    "full service": "Full Service",
    "full_service": "Full Service",
    "fs": "Full Service",
}


def _normalize_lease_type_body(value: str | None) -> str:
    """Accept lowercase and map to enum value so /compute-canonical never 422s on casing."""
    if value is None or not str(value).strip():
        return "NNN"
    s = str(value).strip()
    key = s.lower().replace("-", " ").replace("_", " ")
    if key in _LEASE_TYPE_MAP:
        return _LEASE_TYPE_MAP[key]
    if s in ("NNN", "Gross", "Modified Gross", "Absolute NNN", "Full Service"):
        return s
    return "NNN"


@app.post("/compute-canonical", response_model=CanonicalComputeResponse)
async def compute_canonical_endpoint(request: Request) -> CanonicalComputeResponse | JSONResponse:
    """
    Canonical compute: normalize CanonicalLease, run engine, return monthly/annual rows and metrics.
    Body: single JSON object (CanonicalLease), NOT wrapped in {"canonical_lease": ...}.
    """
    rid = (request.headers.get("x-request-id") or "").strip() or "no-rid"
    try:
        body = await request.json()
    except Exception as e:
        err = str(e)[:400]
        _LOG.info("CANONICAL_ERR rid=%s lease_type=parse_failed err=%s", rid, err)
        return JSONResponse(
            status_code=422,
            content={
                "error": "compute_validation_failed",
                "rid": rid,
                "details": err,
                "expected": "JSON body (CanonicalLease object)",
            },
        )
    # Shim: accept lowercase lease_type before Pydantic validation
    received_lease_type = body.get("lease_type") if isinstance(body, dict) else None
    if isinstance(body, dict) and "lease_type" in body:
        body["lease_type"] = _normalize_lease_type_body(body.get("lease_type"))
    _LOG.info("CANONICAL_START rid=%s lease_type=%s", rid, received_lease_type)
    try:
        lease = CanonicalLease.model_validate(body)
    except Exception as e:
        err = str(e)[:400]
        _LOG.info("CANONICAL_ERR rid=%s lease_type=%s err=%s", rid, received_lease_type, err)
        return JSONResponse(
            status_code=422,
            content={
                "error": "compute_validation_failed",
                "rid": rid,
                "details": err,
                "expected": COMPUTE_CANONICAL_EXPECTED,
            },
        )
    try:
        result = compute_canonical(lease)
        _LOG.info("CANONICAL_DONE rid=%s status=200", rid)
        return result
    except Exception as e:
        _LOG.info("CANONICAL_ERR rid=%s lease_type=%s err=%s", rid, getattr(lease, "lease_type", None), str(e)[:400])
        raise


def _extraction_confidence_to_field_confidence(extraction_confidence: dict) -> dict:
    """Map ExtractionResponse confidence keys to canonical field names."""
    key_map = {
        "rsf": "rsf",
        "commencement": "commencement_date",
        "expiration": "expiration_date",
        "rent_steps": "rent_schedule",
        "free_rent_months": "free_rent_months",
        "name": "premises_name",
    }
    out = {}
    for k, v in (extraction_confidence or {}).items():
        canonical_key = key_map.get(k, k)
        try:
            out[canonical_key] = float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            out[canonical_key] = 0.0
    return out


def _parse_number_token(raw: str) -> Optional[float]:
    try:
        return float(raw.replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _parse_lease_date(s: str) -> Optional[date]:
    """Parse date from strings like 'June 1 2026', '05/31/2036', '2026-06-01'."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()[:64]
    if not s:
        return None
    # ISO
    m = re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if m:
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return date(y, mo, d)
        except ValueError:
            pass
    # US month/day/year
    m = re.match(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", s)
    if m:
        try:
            mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return date(y, mo, d)
        except ValueError:
            pass
    # Month name + day + year (June 1 2026, May 31, 2036)
    months = {
        "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
        "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
        "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
        "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
    }
    parts = re.split(r"[\s,]+", s, maxsplit=3)
    if len(parts) >= 3:
        try:
            mon_str = parts[0].lower()
            day = int(parts[1].strip(","))
            year = int(parts[2].strip(","))
            if mon_str in months and 1 <= day <= 31 and 1900 <= year <= 2100:
                return date(year, months[mon_str], min(day, 28 if months[mon_str] == 2 else 31))
        except (ValueError, IndexError):
            pass
    return None


def _month_diff(commencement: date, expiration: date) -> int:
    """Lease term in full calendar months (e.g. June 1 2026 to May 31 2036 = 120)."""
    delta = (expiration - commencement).days
    if delta <= 0:
        return 0
    # Use average days per month so "10 years" June->May = 120
    return max(1, round(delta / 30.4375))


def _coerce_int_token(value: object, default: int = 0) -> int:
    if value is None:
        return int(default)
    try:
        return int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return int(default)


def _coerce_float_token(value: object, default: float = 0.0) -> float:
    if value is None:
        return float(default)
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return float(default)


def _normalize_suite_candidate(raw: str) -> str:
    v = " ".join((raw or "").split()).strip(" ,.;:-")
    if not v:
        return ""
    v = re.sub(r"(?i)^(?:suite|ste\.?|unit|space|premises)\s*[:#-]?\s*", "", v).strip(" ,.;:-")
    # Keep common suite formats like 110, 11C, A-210, PH-2
    token_match = re.match(r"(?i)^([A-Za-z0-9][A-Za-z0-9\-]{0,14})", v)
    if token_match:
        token = token_match.group(1)
        low = token.lower()
        # Reject common header/lease words that are not suites.
        if low in {
            "landlord", "tenant", "lease", "premises", "building", "property",
            "office", "floor", "term", "year", "month", "rent", "address",
            "located", "option", "renewal", "expiration", "commencement",
        }:
            return ""
        # Suites are typically numeric/alphanumeric short tokens; reject long words without digits.
        if len(token) == 1 and not token.isdigit():
            return ""
        if not re.search(r"\d", token):
            # Accept very short alpha suite codes (e.g. PH) but reject words like "PER".
            if not re.fullmatch(r"(?i)[A-Z]{1,2}", token):
                return ""
        if not re.search(r"\d", token) and len(token) > 6:
            return ""
        if re.fullmatch(r"(?i)\d+", token):
            return token.lstrip("0") or token
        return token.upper()
    return ""


def _normalize_floor_candidate(raw: str) -> str:
    v = " ".join((raw or "").split()).strip(" ,.;:-")
    if not v:
        return ""
    v = re.sub(r"(?i)^(?:floor|fl\.?|level)\s*[:#-]?\s*", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)(?:st|nd|rd|th)$", "", v).strip(" ,.;:-")
    token_match = re.match(r"(?i)^([A-Za-z0-9][A-Za-z0-9\-]{0,8})", v)
    if not token_match:
        return ""
    token = token_match.group(1)
    if re.fullmatch(r"(?i)\d+", token):
        return token.lstrip("0") or token
    if re.fullmatch(r"(?i)[A-Za-z]{1,3}", token):
        return token.upper()
    return token


def _is_notice_or_party_context(segment: str) -> bool:
    low = (segment or "").lower()
    return any(
        token in low
        for token in (
            "address for notices",
            "addresses for notices",
            "notice:",
            "notices:",
            "prior to occupancy",
            "after occupancy",
            "attn:",
            "attention:",
            "c/o",
            "sublessor",
            "sublessee",
            "lessor",
            "lessee",
        )
    )


def _iter_text_segments(lines: list[str], max_lines: int = 260) -> list[str]:
    upper = min(len(lines), max_lines)
    out: list[str] = []
    seen: set[str] = set()
    for i in range(upper):
        variants = [lines[i]]
        if i + 1 < upper:
            variants.append(f"{lines[i]} {lines[i+1]}")
        if i + 2 < upper:
            variants.append(f"{lines[i]} {lines[i+1]} {lines[i+2]}")
        for seg in variants:
            normalized = " ".join(seg.split()).strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            out.append(normalized)
    return out


def _extract_suite_from_text(text: str) -> str:
    if not text:
        return ""
    suite_patterns = [
        r"(?i)\b(?:suite|ste\.?|unit)\b\s*[:#-]?\s*(?:no\.?|#)?\s*([A-Za-z0-9][A-Za-z0-9\- ]{0,24})\b",
        r"(?i)\bspace\b\s*(?:no\.?|#)\s*([A-Za-z0-9][A-Za-z0-9\- ]{0,24})\b",
        r"(?i)\bpremises\s*(?:known as|is|:)?\s*(?:suite|ste\.?)\s*([A-Za-z0-9][A-Za-z0-9\- ]{0,24})",
        r"(?i)\bdesignated\s+as\s+suite\s+([A-Za-z0-9][A-Za-z0-9\- ]{0,24})",
        r"(?i)\bshall\s+refer\s+to\s+suite\s+([A-Za-z0-9][A-Za-z0-9\- ]{0,24})",
        r"(?i)\bat\s+suite\s+([A-Za-z0-9][A-Za-z0-9\- ]{0,24})",
        r"(?i)\bfloor\s+([A-Za-z0-9][A-Za-z0-9\-]{0,8})\s+suite\s+([A-Za-z0-9][A-Za-z0-9\-]{0,14})",
    ]
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    segments = _iter_text_segments(lines, max_lines=260)
    candidates: list[tuple[int, int, str]] = []
    for idx, ln in enumerate(segments):
        low = ln.lower()
        for pat in suite_patterns:
            for m in re.finditer(pat, ln):
                candidate_raw = m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)
                candidate = _normalize_suite_candidate(candidate_raw)
                if not candidate:
                    continue
                score = 1
                if any(k in low for k in ("premises", "located", "designated", "revised premises", "description of premises")):
                    score += 3
                if _is_notice_or_party_context(low):
                    score -= 3
                if re.search(rf"(?i)\bsuite\s*[:#-]?\s*{re.escape(candidate)}\b", ln):
                    score += 1
                if re.search(r"(?i)\b\d{1,6}\s+[A-Za-z0-9].*\b(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|way|plaza|parkway|pkwy\.?)\b", ln):
                    if not any(k in low for k in ("premises", "located", "designated")):
                        score -= 2
                candidates.append((score, idx, candidate))
    if not candidates:
        return ""
    candidates.sort(key=lambda x: (-x[0], x[1], 0 if re.search(r"\d", x[2]) else 1))
    return candidates[0][2]


def _extract_floor_from_text(text: str) -> str:
    if not text:
        return ""
    floor_patterns = [
        r"(?i)\bon\s+the\s+(\d{1,3})(?:st|nd|rd|th)?\s+floor\b",
        r"(?i)\b(\d{1,3})(?:st|nd|rd|th)?\s+floor\b",
        r"(?i)\bfloor\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-]{0,8})\b",
        r"(?i)\blevel\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-]{0,8})\b",
    ]
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    segments = _iter_text_segments(lines, max_lines=260)
    candidates: list[tuple[int, int, str]] = []
    for idx, ln in enumerate(segments):
        low = ln.lower()
        for pat in floor_patterns:
            for m in re.finditer(pat, ln):
                candidate = _normalize_floor_candidate(m.group(1))
                if not candidate:
                    continue
                score = 1
                if any(k in low for k in ("premises", "located", "floor of", "sublease premises")):
                    score += 3
                if _is_notice_or_party_context(low):
                    score -= 3
                if any(k in low for k in ("parking", "garage", "basement", "loading dock")):
                    score -= 2
                candidates.append((score, idx, candidate))
    if not candidates:
        return ""
    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][2]


def _clean_address_candidate(raw: str) -> str:
    v = " ".join((raw or "").split()).strip(" ,.;:-")
    if not v:
        return ""
    v = re.sub(r'(?i)\s*\((?:the\s+)?"?\s*(?:premises|lease premises|subleased premises).*$','', v).strip(" ,.;:-")
    v = re.sub(r'(?i),\s*(?:suite|ste\.?|unit|floor)\s*$', "", v).strip(" ,.;:-")
    v = re.sub(r'(?i)\s+and\s+located\s+at.*$', "", v).strip(" ,.;:-")
    return v


def _extract_address_from_text(text: str, suite_hint: str = "") -> str:
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return ""
    segments = _iter_text_segments(lines, max_lines=280)

    street_suffix = r"(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Plaza|Parkway|Pkwy\.?)"
    core_addr = rf"(\d{{1,6}}\s+[A-Za-z0-9\.\- ]{{2,100}}\b{street_suffix}\b(?:\s*,?\s*(?:Suite|Ste\.?|Unit|Floor)\s*[A-Za-z0-9\-]+)?(?:,\s*[A-Za-z0-9 .'-]{{2,50}}){{0,3}})"
    addr_patterns = [
        rf"(?i)\blocated\s+(?:on\s+the\s+\d+(?:st|nd|rd|th)\s+floor\s+of|at)\s+{core_addr}",
        rf"(?i)\bbuilding\s+located\s+at\s+{core_addr}",
        rf"(?i)\b(?:premises|leased premises)\s+(?:located\s+at|at)\s+{core_addr}",
        rf"(?i)\bfloor\s+of\s+{core_addr}",
        rf"(?i)\b{core_addr}",
    ]
    best = ""
    best_score = -1
    for seg in segments:
        low = seg.lower()
        for pat in addr_patterns:
            m = re.search(pat, seg)
            if not m:
                continue
            candidate = _clean_address_candidate(m.group(1))
            if not _looks_like_address(candidate):
                continue
            score = 1
            if any(k in low for k in ("located", "premises", "floor of", "leased")):
                score += 2
            if re.search(r"(?i)\b(austin|texas|tx|california|ca|new york|ny|florida|fl)\b", candidate):
                score += 1
            if _is_notice_or_party_context(low):
                score -= 3
            c_low = candidate.lower()
            if any(k in c_low for k in ("rsf", "cam", "reconciliation", "rent", "rate", "month", "year")):
                score -= 3
            if suite_hint:
                if re.search(rf"(?i)\b(?:suite|ste\.?|unit)\s*#?\s*{re.escape(suite_hint)}\b", candidate):
                    score += 2
                elif re.search(r"(?i)\b(?:suite|ste\.?|unit)\s*#?\s*[A-Za-z0-9\-]+\b", candidate):
                    score -= 3
            if score > best_score:
                best_score = score
                best = candidate
    return best


def _looks_like_address(value: str) -> bool:
    v = " ".join((value or "").split()).strip()
    if not v:
        return False
    if re.search(r"\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9\.\- ]{2,100}\b(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|road|rd\.?|lane|ln\.?|way|plaza|parkway|pkwy\.?)\b", v, re.I):
        low = v.lower()
        if any(k in low for k in ("rsf", "cam", "reconciliation", "rent", "rate per", "month", "year")):
            return False
        return True
    if "," in v and re.search(r"\b[A-Z]{2}\b|\b(?:Texas|California|New York|Florida|Illinois)\b", v, re.I):
        return True
    return False


def _clean_building_candidate(raw: str, suite_hint: str = "") -> str:
    v = " ".join((raw or "").split()).strip(" ,.;:-")
    if not v:
        return ""
    # Remove common leading labels.
    v = re.sub(r"(?i)^(?:premises|premises name|building|building name|property|property name|address)\s*[:#-]\s*", "", v).strip(" ,.;:-")
    # Remove suite tokens from candidate building names.
    v = re.sub(r"(?i)\b(?:suite|ste\.?|unit|space|floor)\s*#?\s*[A-Za-z0-9\-]+\b", "", v).strip(" ,.;:-")
    if suite_hint:
        v = re.sub(rf"(?i)\b{re.escape(suite_hint)}\b", "", v).strip(" ,.;:-")
    # Remove weak lead-ins.
    v = re.sub(r"(?i)^(?:at|located at|known as|the building located at|building located at)\s+", "", v).strip(" ,.;:-")
    v = re.sub(r'(?i)\s*\((?:the\s+)?"?\s*(?:premises|lease premises|subleased premises).*$','', v).strip(" ,.;:-")
    v = re.sub(r'(?i)\s+and\s+located\s+at.*$', "", v).strip(" ,.;:-")
    low = v.lower()
    if low in {"description of premises", "building size", "building", "premises"}:
        return ""
    if any(
        phrase in low
        for phrase in (
            "description of premises",
            "rentable area",
            "addresses for notices",
            "address for notices",
            "prior to occupancy",
            "after occupancy",
        )
    ):
        return ""
    # Reject legal-clause text that is not a building identifier.
    if any(
        bad in low
        for bad in (
            "hereby leases",
            "landlord",
            "tenant",
            "this lease",
            "agreement",
            "commencement",
            "expiration",
            "term of",
        )
    ):
        return ""
    # Keep values that are at least somewhat informative.
    if len(v) < 4:
        return ""
    return v


def _extract_building_name_from_text(text: str, suite_hint: str = "", address_hint: str = "") -> str:
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    segments = _iter_text_segments(lines, max_lines=280)
    state_token = r"(?:TX|Texas|CA|California|NY|New York|FL|Florida|IL|Illinois)"
    patterns: list[tuple[re.Pattern[str], int]] = [
        (re.compile(r"(?i)\bbuilding\s+commonly\s+known\s+as\s+(?:the\s+)?([^\n,;\.]{3,100})"), 5),
        (re.compile(r"(?i)\b(?:building|property)\s*(?:name)?\s*[:#-]\s*([^\n,;]{3,100})"), 4),
        (re.compile(r"(?i)\blocated\s+at\s+(?:suite|ste\.?|unit)\s*[A-Za-z0-9\-]+,\s*([^,\n]{3,100}(?:,\s*[A-Za-z .'-]{2,40}){1,2})"), 4),
        (re.compile(rf"(?i)\blocated\s+at\s+([^,\n]{{3,100}}(?:,\s*[A-Za-z .'-]{{2,40}}){{1,2}}(?:,\s*{state_token})?)"), 2),
    ]
    best = ""
    best_score = -999
    for seg in segments:
        low = seg.lower()
        for pat, base_score in patterns:
            m = pat.search(seg)
            if not m:
                continue
            candidate = _clean_building_candidate(m.group(1), suite_hint=suite_hint)
            if not candidate:
                continue
            score = base_score
            if any(token in low for token in ("premises", "located", "commonly known")):
                score += 1
            if any(token in candidate.lower() for token in ("center", "tower", "plaza", "building", "campus", "park")):
                score += 1
            if _looks_like_address(candidate):
                score += 1
            if _is_notice_or_party_context(low):
                score -= 3
            if score > best_score:
                best_score = score
                best = candidate
    if best:
        return best
    addr = _clean_building_candidate(address_hint, suite_hint=suite_hint)
    if _looks_like_address(addr):
        return addr
    return ""


def _derive_building_name_from_premises_or_address(premises_name: str, address: str, suite_hint: str = "") -> str:
    premise = _clean_building_candidate(premises_name, suite_hint)
    if premise and not re.fullmatch(r"(?i)suite\s*[A-Za-z0-9\-]+", premise):
        return premise
    addr = " ".join((address or "").split()).strip()
    if _looks_like_address(addr):
        return addr
    return ""


def _fallback_building_from_filename(filename: str) -> str:
    stem = re.sub(r"[_\-]+", " ", Path(filename or "").stem).strip()
    if not stem:
        return ""
    low = stem.lower()
    generic = {
        "lease", "leases", "agreement", "document", "doc", "scan", "scanned",
        "sample", "analysis", "report", "draft", "final", "copy", "pdf", "docx",
    }
    tokens = [t for t in re.split(r"\s+", low) if t]
    informative = [t for t in tokens if t not in generic and not re.fullmatch(r"\d+", t)]
    # Require at least two informative tokens to avoid weak names like "Lease 2".
    if len(informative) < 2:
        return ""
    return _clean_building_candidate(stem)


def _extract_first_date_token(text: str) -> Optional[date]:
    if not text:
        return None
    low_text = text.lower()
    if "e.g" in low_text or "example" in low_text:
        return None
    patterns = [
        r"(?i)\b(\w+\s+\d{1,2},?\s+\d{4})\b",
        r"\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b",
        r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            prefix = text[max(0, m.start() - 24):m.start()].lower()
            if "e.g" in prefix or "example" in prefix:
                continue
            d = _parse_lease_date(m.group(1))
            if d:
                return d
    return None


def _extract_term_months_from_text(text: str) -> Optional[int]:
    if not text:
        return None
    term_month_patterns = [
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,120}?\b(\d{1,3})\s*(?:calendar\s+)?months?\b",
        r"(?i)\bsublease\s+term\b[^.\n]{0,120}?\b(\d{1,3})\s*(?:calendar\s+)?months?\b",
    ]
    for pat in term_month_patterns:
        for m in re.finditer(pat, text):
            context = (m.group(0) or "").lower()
            if any(k in context for k in ("extension", "renewal", "option")):
                continue
            try:
                months = int(m.group(1))
                if 1 <= months <= 600:
                    return months
            except (TypeError, ValueError):
                continue

    # Handles "Term shall be ten (10) years ..." and "Term: 5 years"
    term_year_patterns = [
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,140}?\((\d{1,2})\)\s*years?\b",
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,140}?\b(\d{1,2})\s*years?\b",
        r"(?i)\bsublease\s+term\b[^.\n]{0,140}?\((\d{1,2})\)\s*years?\b",
        r"(?i)\bsublease\s+term\b[^.\n]{0,140}?\b(\d{1,2})\s*years?\b",
    ]
    for pat in term_year_patterns:
        for m in re.finditer(pat, text):
            context = (m.group(0) or "").lower()
            if any(k in context for k in ("extension", "renewal", "option", "additional term")):
                continue
            try:
                years = int(m.group(1))
                if 1 <= years <= 50:
                    return years * 12
            except (TypeError, ValueError):
                continue
    return None


def _looks_like_generated_report_document(text: str) -> bool:
    low = (text or "").lower()
    if not low:
        return False
    markers = [
        "lease economics comparison",
        "comparison matrix",
        "multi-scenario report generated",
        "avg cost/sf/year",
        "start month end month rate",
        "no clause notes extracted",
        "review rofr/rofo",
    ]
    hits = sum(1 for m in markers if m in low)
    return hits >= 3


def _looks_like_generic_scenario_name(name: str) -> bool:
    low = " ".join((name or "").split()).strip().lower()
    if not low:
        return True
    bad_fragments = (
        "extract",
        "lease agreement",
        "hereby leases",
        "this lease",
        "agreement made",
        "by and between",
        "sample report",
        "comparison matrix",
        "analysis",
        "premises",
        "sublessee",
        "sublessor",
        "landlord",
        "tenant",
        "witnesseth",
        "whereas",
    )
    if any(x in low for x in bad_fragments):
        return True
    if len(low) > 80:
        return True
    if not re.search(r"[a-z]", low):
        return True
    if re.fullmatch(r"[A-Z\s]{4,}", (name or "").strip()) and len((name or "").split()) <= 4:
        return True
    if re.fullmatch(r"\d+\.\s*[a-z\s]+", low):
        return True
    if re.fullmatch(r"lease(?:\s+\d+)?", low):
        return True
    return False


def _should_override_rsf(
    current_rsf: Optional[float],
    candidate_rsf: Optional[float],
    candidate_score: int,
    current_confidence: float = 0.0,
) -> bool:
    if candidate_rsf is None:
        return False
    try:
        cand = float(candidate_rsf)
    except (TypeError, ValueError):
        return False
    if not (100 <= cand <= 2_000_000):
        return False
    cur = float(current_rsf or 0.0)
    if cur <= 0:
        return True
    if not (100 <= cur <= 2_000_000):
        return True
    ratio = cand / cur if cur > 0 else 1.0
    if candidate_score >= 1 and cand >= 2_000 and cur / max(cand, 1.0) >= 3.0:
        return True
    if candidate_score >= 6:
        return True
    if candidate_score >= 4 and 0.35 <= ratio <= 2.8:
        return True
    if candidate_score >= 3 and current_confidence < 0.5 and 0.30 <= ratio <= 3.2:
        return True
    return False


def _extract_lease_hints(text: str, filename: str, rid: str) -> dict:
    """
    Heuristic extraction: RSF (prefer premises/suite and avoid ratio/table values), term dates
    from commencement/expiration/ending/through language, term_months from text or dates, suite, address.
    Logs rsf_candidates and term_candidates with rid. Returns dict for merging into canonical.
    """
    hints = {
        "rsf": None,
        "_rsf_score": -999,
        "commencement_date": None,
        "expiration_date": None,
        "term_months": None,
        "suite": "",
        "floor": "",
        "building_name": "",
        "address": "",
        "lease_type": None,
        "parking_ratio": None,
        "parking_count": None,
        "parking_rate_monthly": None,
    }
    if not text:
        return hints

    suite_hint = _extract_suite_from_text(text)

    # ---- RSF: collect candidates with context-aware score ----
    rsf_patterns = [
        r"(?i)\b(?:rentable\s+area|rentable\s+square\s+feet|rsf)\b\s*[:#-]?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})",
        r"(?i)\b(?:premises|leased\s+premises|sublease\s+premises)[^.:\n]{0,140}?\b(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rentable\s+square\s+feet|square\s*feet|rsf)\b",
        r"(?i)(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|r\.?s\.?f\.?|rentable\s+square\s+feet|square\s*feet|sf)\b",
    ]
    rsf_candidates: list[dict] = []
    for pat in rsf_patterns:
        for m in re.finditer(pat, text):
            value = _parse_number_token(m.group(1))
            if value is None or not (100 <= value <= 2_000_000):
                continue
            value_token = re.escape(m.group(1))
            start = max(0, m.start() - 80)
            end = min(len(text), m.end() + 80)
            snippet = text[start:end].replace("\n", " ").strip()
            score = 0
            low = snippet.lower()
            if any(k in low for k in ("premises", "suite", "rentable square feet", "rentable area", "consisting of", "comprising", "description of premises")):
                score += 4
            if re.search(r"(?i)\bpremises\s*:\s*(?:suite|ste\.?|unit)?", low):
                score += 3
            if re.search(r"(?i)\brentable\s+area\s*:", low):
                score += 3
            if re.search(rf"(?i)\bsuite\s*[:#-]?\s*[A-Za-z0-9\-]+\s+{value_token}\s*(?:square\s*feet|rsf)\b", snippet):
                score += 5
            if re.search(rf"(?i)\brentable\s+area\s*[:#-]?\s*{value_token}\b", snippet):
                score += 4
            if re.search(r"(?i)\bconsisting\s+of\s+approximately\b", low):
                score += 3
            if any(k in low for k in ("approx", "approximately")):
                score += 1
            if 2_000 <= value <= 300_000:
                score += 1

            if re.search(r"(?i)\bper\s+1,?000\s+(?:rsf|sf|rentable\s+square\s+feet)\b|/1,?000\s*(?:rsf|sf)|ratio", low):
                score -= 9
            if re.search(r"(?i)\bper\s+\d[\d,]*\s*(?:rsf|sf|rentable\s+square\s+feet)\b", low):
                score -= 6
            if re.search(r"(?i)\(\s*\d[\d,]*\s*rsf\s*/\s*\d[\d,]*\s*rsf\s*\)", low):
                score -= 8
            if any(k in low for k in ("parking", "spaces per", "density", "work station", "workstation", "cam", "opex", "operating expenses", "taxes", "insurance")):
                score -= 4
            if any(k in low for k in ("shopping center contains", "center contains", "total rsf", "whole center", "entire center", "building contains approximately")):
                score -= 5
            if any(
                k in low
                for k in (
                    "right of first refusal",
                    "first refusal space",
                    "option to extend",
                    "extension period",
                    "third party proposal",
                    "fair market rent",
                )
            ):
                score -= 6
            if re.search(r"(?i)\$\s*\d[\d,]*(?:\.\d+)?\s*(?:/|per)\s*(?:sf|rsf)", low):
                score -= 2
            if value <= 1500 and re.search(r"(?i)\b(?:per|ratio|density|occup|person|people|work\s*station)\b", low):
                score -= 6
            if suite_hint:
                suite_match = re.search(r"(?i)\b(?:suite|ste\.?|unit)\s*#?\s*([A-Za-z0-9\-]+)\b", snippet)
                if suite_match:
                    cand_suite = _normalize_suite_candidate(suite_match.group(1))
                    if cand_suite and cand_suite != suite_hint:
                        score -= 8
                    elif cand_suite and cand_suite == suite_hint:
                        score += 3

            rsf_candidates.append(
                {
                    "value": value,
                    "snippet": snippet[:220],
                    "score": score,
                    "start": m.start(),
                }
            )

    chosen_rsf = None
    if rsf_candidates:
        # Dedupe by value, keep highest score and earliest position for that value.
        by_val: dict[float, dict] = {}
        for c in rsf_candidates:
            v = c["value"]
            if (
                v not in by_val
                or c["score"] > by_val[v]["score"]
                or (c["score"] == by_val[v]["score"] and c["start"] < by_val[v]["start"])
            ):
                by_val[v] = c
        candidates_sorted = sorted(by_val.values(), key=lambda x: (-x["score"], x["start"], -x["value"]))
        chosen_rsf = candidates_sorted[0]["value"]
        hints["rsf"] = chosen_rsf
        hints["_rsf_score"] = int(candidates_sorted[0]["score"])
        _LOG.info(
            "NORMALIZE_RSF_CANDIDATES rid=%s count=%s candidates=%s",
            rid,
            len(candidates_sorted),
            [(c["value"], c["score"], c["snippet"][:80]) for c in candidates_sorted],
        )
        _LOG.info(
            "NORMALIZE_RSF_CHOSEN rid=%s value=%s score=%s",
            rid,
            chosen_rsf,
            hints["_rsf_score"],
        )

    # ---- Term: commencement / expiration / ending / through ----
    term_candidates: dict[str, Optional[date]] = {"commencement": None, "expiration": None}
    date_token_capture = r"(\w+\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})"
    comm_direct_pats = [
        rf"(?i)\bcommenc(?:e|ing)?(?:\s+on)?(?:\s+the\s+later\s+to\s+occur\s+of)?\s+{date_token_capture}",
        rf"(?i)\b{date_token_capture}\s*\([^)]{{0,40}}\bcommencement\s+date\b",
    ]
    exp_direct_pats = [
        rf"(?i)\bexpir(?:e|ing|ation)\b(?:\s+on)?\s+{date_token_capture}",
        rf"(?i)\bending\s+on\s+{date_token_capture}",
        rf"(?i)\b(?:sublease\s+term|term)\b[^.\n]{{0,220}}\bthrough\b[^.\n]{{0,90}}?{date_token_capture}",
        rf"(?i)\b{date_token_capture}\s*\([^)]{{0,40}}\b(?:expiration|termination)\s+date\b",
    ]
    comm_context_pats = [
        r"(?i)\bestimated\s+commencement\s+date\b[^A-Za-z0-9]{0,20}([^\n]{0,140})",
        r"(?i)\bcommencement\s+date\b[^A-Za-z0-9]{0,20}([^\n]{0,140})",
    ]
    exp_context_pats = [
        r"(?i)\bestimated\s+(?:termination|expiration)\s+date\b[^A-Za-z0-9]{0,20}([^\n]{0,140})",
        r"(?i)\b(?:termination|expiration)\s+date\b[^A-Za-z0-9]{0,20}([^\n]{0,140})",
    ]

    for pat in comm_direct_pats:
        m = re.search(pat, text)
        if not m:
            continue
        if "e.g" in (m.group(0) or "").lower() or "example" in (m.group(0) or "").lower():
            continue
        d = _parse_lease_date(m.group(1))
        if d:
            term_candidates["commencement"] = d
            break
    if term_candidates["commencement"] is None:
        for pat in comm_context_pats:
            m = re.search(pat, text)
            if not m:
                continue
            candidate_text = m.group(1) or ""
            if "e.g" in candidate_text.lower() or "example" in candidate_text.lower():
                continue
            d = _extract_first_date_token(candidate_text)
            if d:
                term_candidates["commencement"] = d
                break

    for pat in exp_direct_pats:
        m = re.search(pat, text)
        if not m:
            continue
        if "e.g" in (m.group(0) or "").lower() or "example" in (m.group(0) or "").lower():
            continue
        d = _parse_lease_date(m.group(1))
        if d:
            term_candidates["expiration"] = d
            break
    if term_candidates["expiration"] is None:
        for pat in exp_context_pats:
            m = re.search(pat, text)
            if not m:
                continue
            candidate_text = m.group(1) or ""
            if "e.g" in candidate_text.lower() or "example" in candidate_text.lower():
                continue
            d = _extract_first_date_token(candidate_text)
            if d:
                term_candidates["expiration"] = d
                break

    # Some scanned/basic-provisions tables place the date on following lines.
    if term_candidates["commencement"] is None or term_candidates["expiration"] is None:
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
            if term_candidates["commencement"] is None and is_comm_label:
                for nxt in lines[idx + 1: idx + 8]:
                    if "e.g" in nxt.lower() or "example" in nxt.lower():
                        continue
                    d = _extract_first_date_token(nxt)
                    if d:
                        term_candidates["commencement"] = d
                        break
            if term_candidates["expiration"] is None and is_exp_label:
                for nxt in lines[idx + 1: idx + 8]:
                    if "e.g" in nxt.lower() or "example" in nxt.lower():
                        continue
                    d = _extract_first_date_token(nxt)
                    if d:
                        term_candidates["expiration"] = d
                        break
            if term_candidates["commencement"] is not None and term_candidates["expiration"] is not None:
                break

    if term_candidates["commencement"]:
        hints["commencement_date"] = term_candidates["commencement"]
    if term_candidates["expiration"]:
        hints["expiration_date"] = term_candidates["expiration"]
    term_from_text = _extract_term_months_from_text(text)
    if term_from_text is not None:
        hints["term_months"] = term_from_text
    if hints["commencement_date"] and hints["expiration_date"]:
        hints["term_months"] = _month_diff(hints["commencement_date"], hints["expiration_date"])

    _LOG.info(
        "NORMALIZE_TERM_CANDIDATES rid=%s commencement=%s expiration=%s term_months=%s",
        rid,
        term_candidates["commencement"],
        term_candidates["expiration"],
        hints.get("term_months"),
    )

    # ---- Suite ----
    hints["suite"] = suite_hint
    hints["floor"] = _extract_floor_from_text(text)
    hints["address"] = _extract_address_from_text(text, suite_hint=hints["suite"])

    # ---- Address / building (includes premises labels and located-at lines) ----
    hints["building_name"] = _extract_building_name_from_text(
        text,
        suite_hint=hints.get("suite", ""),
        address_hint=hints.get("address", ""),
    )
    if not hints["building_name"] and hints.get("address"):
        hints["building_name"] = str(hints["address"])

    # Lease type: "lease type is NNN" / "lease type: Gross"
    lease_type_pat = re.compile(
        r"(?i)\blease\s+type\s*[:\s]+(NNN|Gross|Modified\s+Gross|Absolute\s+NNN|Full\s+Service)\b",
        re.I,
    )
    m = lease_type_pat.search(text)
    if m:
        hints["lease_type"] = re.sub(r"\s+", " ", m.group(1).strip())

    # Parking ratio and economics
    parking_ratio_patterns = [
        r"(?i)\b(\d+(?:\.\d+)?)\s*(?:spaces?|stalls?)\s*(?:per|\/)\s*1,?000\s*(?:rsf|sf|square\s*feet)\b",
        r"(?i)\bparking\s+ratio\b[^.\n]{0,60}\b(\d+(?:\.\d+)?)\s*(?:\/|per)\s*1,?000\b",
        r"(?i)\b(\d+(?:\.\d+)?)\s*\/\s*1,?000\s*(?:rsf|sf)\b",
    ]
    for pat in parking_ratio_patterns:
        m = re.search(pat, text)
        if not m:
            continue
        ratio = _coerce_float_token(m.group(1), 0.0)
        if 0.1 <= ratio <= 30:
            hints["parking_ratio"] = ratio
            break

    parking_count_patterns = [
        r"(?i)\bparking\s+spaces?\s*[:\-]?\s*(\d{1,4})\b",
        r"(?i)\b(\d{1,4})\s+(?:reserved|unreserved|covered|surface|garage)?\s*parking\s+spaces?\b",
        r"(?i)\bentitled\s+to\s+(\d{1,4})\s+(?:parking\s+)?spaces?\b",
    ]
    for pat in parking_count_patterns:
        m = re.search(pat, text)
        if not m:
            continue
        count = _coerce_int_token(m.group(1), 0)
        if 1 <= count <= 10000:
            hints["parking_count"] = count
            break

    parking_rate_patterns = [
        r"(?i)\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|\/)\s*(?:space|stall)\s*(?:per|\/)\s*month\b",
        r"(?i)\bparking\b[^.\n]{0,80}\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|\/)\s*(?:month|mo\.?)\b",
    ]
    for pat in parking_rate_patterns:
        m = re.search(pat, text)
        if not m:
            continue
        rate = _coerce_float_token(m.group(1), 0.0)
        if 1 <= rate <= 10000:
            hints["parking_rate_monthly"] = rate
            break

    return hints


def _extract_lease_note_highlights(text: str, max_items: int = 8) -> list[str]:
    """
    Build concise lease-clause notes from raw lease text.
    Focuses on rights/options and OpEx language used by broker reviews.
    """
    if not text:
        return []

    chunks: list[str] = []
    for line in text.splitlines():
        cleaned = " ".join(line.split()).strip()
        if len(cleaned) < 18:
            continue
        chunks.append(cleaned)

    # OCR text can be sparse; include sentence-like chunks as a fallback.
    if len(chunks) < 40:
        for sent in re.split(r"(?<=[\.;])\s+", text):
            cleaned = " ".join(sent.split()).strip()
            if len(cleaned) >= 24:
                chunks.append(cleaned)

    # Keep scan bounded for predictable latency.
    chunks = chunks[:900]

    clause_patterns: list[tuple[str, list[re.Pattern[str]]]] = [
        ("ROFR", [re.compile(r"\b(rofr|right of first refusal)\b", re.I)]),
        ("ROFO", [re.compile(r"\b(rofo|right of first offer)\b", re.I)]),
        (
            "Renewal option",
            [
                re.compile(r"\b(option to renew|option to extend|renewal option|extension option)\b", re.I),
                re.compile(r"\brenew(?:al|)\b.{0,40}\b(option|term|period)\b", re.I),
            ],
        ),
        (
            "Expansion option",
            [
                re.compile(r"\b(option to expand|expansion option|right to expand|additional premises)\b", re.I),
            ],
        ),
        (
            "Termination option",
            [
                re.compile(r"\b(termination option|early termination|right to terminate|cancel(?:lation)?)\b", re.I),
            ],
        ),
        (
            "Parking ratio",
            [
                re.compile(r"\b\d+(?:\.\d+)?\s*(?:spaces?|stalls?)\s*(?:per|/)\s*1,?000\s*(?:rsf|sf|square feet)\b", re.I),
                re.compile(r"\bparking ratio\b.{0,60}\b\d+(?:\.\d+)?\s*(?:per|/)\s*1,?000\b", re.I),
            ],
        ),
        (
            "Parking charges",
            [
                re.compile(r"\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:per|/)\s*(?:space|stall)\s*(?:per|/)\s*month\b", re.I),
                re.compile(r"\bparking\b.{0,90}\$\s*\d[\d,]*(?:\.\d{1,2})?\b", re.I),
            ],
        ),
        (
            "OpEx exclusions",
            [
                re.compile(
                    r"\b(operating expenses?|opex|cam|common area maintenance)\b.{0,120}\b(exclude|excluding|exclusion|excluded|not include|shall not include)\b",
                    re.I,
                ),
                re.compile(r"\bexcluded from\b.{0,90}\b(operating expenses?|opex|cam)\b", re.I),
            ],
        ),
        (
            "OpEx cap",
            [
                re.compile(r"\b(cap|capped|ceiling)\b.{0,60}\b(cam|opex|operating expenses?)\b", re.I),
                re.compile(r"\bcontrollable\b.{0,50}\b(cam|opex|operating expenses?)\b", re.I),
            ],
        ),
        (
            "Audit rights",
            [
                re.compile(r"\b(audit|inspect)\b.{0,70}\b(records|books|operating expenses?|cam)\b", re.I),
            ],
        ),
        (
            "Assignment/Sublease",
            [
                re.compile(r"\b(assign(?:ment)?|sublet|sublease)\b.{0,90}\b(consent|permitted|not be unreasonably withheld|restriction)\b", re.I),
            ],
        ),
        (
            "Use restrictions",
            [
                re.compile(r"\b(use\s+clause|permitted use|exclusive use)\b", re.I),
                re.compile(r"\bshall\s+use\s+the\s+premises\b", re.I),
            ],
        ),
        (
            "Holdover",
            [
                re.compile(r"\bholdover\b.{0,70}\b(rent|rate|percent|%)\b", re.I),
            ],
        ),
    ]

    notes: list[str] = []
    seen: set[str] = set()
    for label, patterns in clause_patterns:
        match_chunk = None
        for chunk in chunks:
            if any(p.search(chunk) for p in patterns):
                match_chunk = chunk
                break
        if not match_chunk:
            continue
        snippet = match_chunk[:220].rstrip(" ,;.")
        note = f"{label}: {snippet}"
        if note in seen:
            continue
        seen.add(note)
        notes.append(note)
        if len(notes) >= max_items:
            break
    return notes


def _safe_extraction_warning(err: Exception | str) -> str:
    """
    Map low-level extraction errors to safe, actionable messages for UI warnings.
    """
    msg = str(err or "").lower()
    if not msg:
        return "AI extraction fallback was used for this upload."
    if "openai_api_key" in msg or ("api key" in msg and "openai" in msg):
        return "AI extraction is not configured on backend (OPENAI_API_KEY missing)."
    if "quota" in msg or "rate limit" in msg or "429" in msg:
        return "AI extraction is temporarily limited (rate limit/quota)."
    if "tesseract" in msg or "poppler" in msg or "pdf2image" in msg or "pytesseract" in msg:
        return "OCR dependencies are missing on backend (poppler/tesseract)."
    if "timeout" in msg or "timed out" in msg:
        return "AI extraction timed out. Please retry in a moment."
    if "connection" in msg or "network" in msg:
        return "Backend could not reach the extraction provider."
    return "AI extraction fallback was used for this upload."


@app.post("/normalize", response_model=NormalizerResponse)
def normalize_endpoint(
    request: Request,
    source: str = Form(..., description="MANUAL, PASTED_TEXT, PDF, WORD, or JSON"),
    payload: Optional[str] = Form(None, description="JSON string for MANUAL/JSON"),
    pasted_text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
) -> NormalizerResponse:
    """
    Universal input normalizer. Returns CanonicalLease + confidence_score, field_confidence,
    missing_fields, clarification_questions, warnings. Frontend must enforce Review and Confirm
    when confidence_score < 0.85 or missing_fields not empty.
    """
    rid = (request.headers.get("x-request-id") or "").strip() or "no-rid"
    _LOG.info(
        "NORMALIZE_START rid=%s content_type=%s len=%s",
        rid,
        request.headers.get("content-type"),
        request.headers.get("content-length"),
    )
    start = time.perf_counter()
    try:
        result, used_ai = _normalize_impl(rid, source, payload, pasted_text, file)
        duration_ms = (time.perf_counter() - start) * 1000
        c = result.canonical_lease
        _LOG.info(
            "NORMALIZE_DONE rid=%s lease_type=%s rsf=%s commencement=%s expiration=%s",
            rid,
            getattr(c, "lease_type", None),
            getattr(c, "rsf", None),
            getattr(c, "commencement_date", None),
            getattr(c, "expiration_date", None),
        )
        _LOG.info("normalize finished rid=%s duration_ms=%.0f", rid, duration_ms)
        return result
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)[:400]
        _LOG.info("NORMALIZE_ERR rid=%s err=%s", rid, err_msg)
        return JSONResponse(
            status_code=500,
            content={"error": "normalize_failed", "rid": rid, "details": err_msg},
        )


def _normalize_impl(
    rid: str,
    source: str,
    payload: Optional[str],
    pasted_text: Optional[str],
    file: Optional[UploadFile],
) -> tuple[NormalizerResponse, bool]:
    source_upper = (source or "").strip().upper()
    if source_upper not in ("MANUAL", "PASTED_TEXT", "PDF", "WORD", "JSON"):
        raise HTTPException(status_code=400, detail="source must be one of: MANUAL, PASTED_TEXT, PDF, WORD, JSON")

    warnings: list = []
    canonical: Optional[CanonicalLease] = None
    field_confidence: dict = {}
    confidence_score = 0.5
    missing: list = []
    questions: list = []

    if source_upper in ("PDF", "WORD"):
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="File required for PDF/WORD")
        fn = file.filename.lower()
        if source_upper == "PDF" and not fn.endswith(".pdf"):
            raise HTTPException(status_code=400, detail="File must be PDF")
        if source_upper == "WORD" and not fn.endswith(".docx"):
            raise HTTPException(status_code=400, detail="File must be DOCX")
        try:
            contents = file.file.read()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read file: {e}") from e
        _LOG.info("NORMALIZE_FILE rid=%s filename=%s size=%s", rid, file.filename or "", len(contents))
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file")
        buf = BytesIO(contents)
        text = ""
        ocr_used = False
        used_fallback = False
        try:
            if fn.endswith(".pdf"):
                text = extract_text_from_pdf(buf)
                if text_quality_requires_ocr(text):
                    buf.seek(0)
                    pages = max(1, min(50, 5))
                    try:
                        text, _ = extract_text_from_pdf_with_ocr(buf, force_ocr=True, ocr_pages=pages)
                        ocr_used = True
                        warnings.append("OCR was used because extracted text was short or low quality.")
                    except Exception:
                        # OCR dependencies may be unavailable in local/dev; continue with text extraction fallback.
                        warnings.append("OCR was unavailable; continued with standard PDF text extraction.")
            else:
                text = extract_text_from_docx(buf)
        except Exception as e:
            text = ""
            warnings.append(_safe_extraction_warning(e))

        extracted_hints = _extract_lease_hints(text, file.filename or "", rid)
        note_highlights = _extract_lease_note_highlights(text)
        is_generated_report_doc = bool(text.strip() and _looks_like_generated_report_document(text))

        if is_generated_report_doc:
            canonical = _dict_to_canonical({}, "", "")
            confidence_score = 0.25
            used_fallback = True
            warnings.append(
                "This file appears to be a generated analysis/report PDF, not an original lease/proposal. "
                "Upload the source lease/proposal/amendment document."
            )

        if canonical is not None:
            pass
        elif text.strip():
            try:
                extraction = extract_scenario_from_text(text, "pdf_text" if fn.endswith(".pdf") else "docx")
            except Exception as e:
                fallback_comm = extracted_hints.get("commencement_date") or date(2026, 1, 1)
                fallback_exp = extracted_hints.get("expiration_date") or date(2031, 1, 31)
                fallback_term = _coerce_int_token(extracted_hints.get("term_months"), 0) or _month_diff(fallback_comm, fallback_exp)
                fallback_term = max(12, fallback_term)
                fallback_suite = str(extracted_hints.get("suite") or extracted_hints.get("floor") or "").strip()
                fallback_building = str(extracted_hints.get("building_name") or "").strip() or _fallback_building_from_filename(file.filename or "")
                fallback_address = str(extracted_hints.get("address") or "").strip()
                fallback_rsf = _coerce_float_token(extracted_hints.get("rsf"), 0.0) or 10000.0
                fallback_payload = {
                    "scenario_name": f"{fallback_building} Suite {fallback_suite}".strip() if fallback_building or fallback_suite else "Extracted lease",
                    "building_name": fallback_building,
                    "suite": fallback_suite,
                    "floor": str(extracted_hints.get("floor") or "").strip(),
                    "address": fallback_address,
                    "premises_name": f"{fallback_building} Suite {fallback_suite}".strip() if fallback_building and fallback_suite else (fallback_building or f"Suite {fallback_suite}" if fallback_suite else "Extracted lease"),
                    "rsf": fallback_rsf,
                    "commencement_date": fallback_comm,
                    "expiration_date": fallback_exp,
                    "term_months": fallback_term,
                    "rent_schedule": [{"start_month": 0, "end_month": max(0, fallback_term - 1), "rent_psf_annual": 30.0}],
                    "expense_structure_type": "nnn",
                    "opex_psf_year_1": 10.0,
                    "expense_stop_psf": 10.0,
                    "opex_growth_rate": 0.03,
                    "discount_rate_annual": 0.08,
                }
                canonical = _dict_to_canonical(fallback_payload, "", "")
                field_confidence = {
                    "rsf": 0.75 if extracted_hints.get("rsf") else 0.25,
                    "commencement_date": 0.75 if extracted_hints.get("commencement_date") else 0.25,
                    "expiration_date": 0.75 if extracted_hints.get("expiration_date") else 0.25,
                    "rent_schedule": 0.65,
                    "building_name": 0.8 if fallback_building else 0.2,
                    "suite": 0.8 if fallback_suite else 0.2,
                }
                confidence_score = 0.7
                used_fallback = True
                warnings.append("AI extraction failed once; deterministic extraction populated the scenario.")
                safe_warning = _safe_extraction_warning(e)
                if safe_warning and safe_warning != "Automatic extraction failed due to a backend processing issue.":
                    warnings.append(safe_warning)
            else:
                if extraction and extraction.scenario:
                    canonical = _scenario_to_canonical(extraction.scenario, "", "")
                    field_confidence = _extraction_confidence_to_field_confidence(extraction.confidence)
                    confidence_score = max((sum(field_confidence.values()) / max(1, len(field_confidence))), 0.82) if field_confidence else 0.82
                    warnings.extend(extraction.warnings or [])
                else:
                    canonical = _dict_to_canonical({}, "", "")
                    confidence_score = 0.4
                    used_fallback = True
                    warnings.append("We could not confidently parse this lease. Please review extracted fields.")
            if ocr_used:
                warnings.append("OCR was used for this document.")
        else:
            canonical = _dict_to_canonical({}, "", "")
            confidence_score = 0.35
            used_fallback = True
            warnings.append("No text could be extracted from this file. Please review and fill required fields.")

        if canonical is None:
            canonical = _dict_to_canonical({}, "", "")
            confidence_score = 0.35
            used_fallback = True
            warnings.append("We could not process this file automatically. Please review and fill required fields.")

        # Apply heuristic overrides: prefer premises-scoped RSF and term dates from commencing/expiring.
        if canonical and isinstance(canonical, CanonicalLease) and not is_generated_report_doc:
            updates: dict = {}
            # RSF override is score-gated to avoid pulling ratio values (e.g. "per 1,000 RSF").
            hinted_rsf = extracted_hints.get("rsf")
            hinted_rsf_score = int(extracted_hints.get("_rsf_score", -999) or -999)
            rsf_conf = 0.0
            try:
                rsf_conf = float(field_confidence.get("rsf", 0.0) or 0.0)
            except (TypeError, ValueError, AttributeError):
                rsf_conf = 0.0
            if _should_override_rsf(canonical.rsf, hinted_rsf, hinted_rsf_score, rsf_conf):
                updates["rsf"] = hinted_rsf
            if extracted_hints.get("commencement_date"):
                updates["commencement_date"] = extracted_hints["commencement_date"]
            if extracted_hints.get("expiration_date"):
                updates["expiration_date"] = extracted_hints["expiration_date"]
            if extracted_hints.get("term_months") is not None:
                updates["term_months"] = extracted_hints["term_months"]
            suite_val = str(extracted_hints.get("suite") or canonical.suite or "").strip()
            if not suite_val:
                suite_val = _extract_suite_from_text(str(canonical.premises_name or ""))
            floor_val = str(extracted_hints.get("floor") or canonical.floor or "").strip()
            if floor_val and not (canonical.floor or "").strip():
                updates["floor"] = floor_val
            if not suite_val and floor_val:
                suite_val = floor_val
                warnings.append("Suite was not found; using premises floor as suite fallback.")
            address_val = str(extracted_hints.get("address") or canonical.address or "").strip()
            if address_val and not (canonical.address or "").strip():
                updates["address"] = address_val
            building_val = str(extracted_hints.get("building_name") or "").strip()
            if not building_val:
                building_val = _derive_building_name_from_premises_or_address(
                    premises_name=str(canonical.premises_name or ""),
                    address=address_val,
                    suite_hint=suite_val,
                )
            if not building_val:
                building_val = _fallback_building_from_filename(file.filename or "")
            if not building_val:
                building_val = _clean_building_candidate(re.sub(r"[_\-]+", " ", Path(file.filename or "").stem))
            if not building_val:
                building_val = "Extracted premises"
            if building_val:
                updates["building_name"] = building_val
                # If this is actually an address and address is blank, keep both populated.
                if not (canonical.address or "").strip() and _looks_like_address(building_val):
                    updates["address"] = building_val
            if suite_val:
                updates["suite"] = suite_val
            if building_val and suite_val:
                updates["premises_name"] = f"{building_val} Suite {suite_val}"
            elif suite_val and not (canonical.premises_name or "").strip():
                updates["premises_name"] = f"Suite {suite_val}"
            scenario_name_val = str(canonical.scenario_name or "").strip()
            if _looks_like_generic_scenario_name(scenario_name_val):
                if building_val and suite_val:
                    updates["scenario_name"] = f"{building_val} Suite {suite_val}"
                elif building_val:
                    updates["scenario_name"] = building_val
                elif suite_val:
                    updates["scenario_name"] = f"Suite {suite_val}"
            if extracted_hints.get("lease_type"):
                updates["lease_type"] = str(extracted_hints["lease_type"])

            hinted_parking_ratio = _coerce_float_token(extracted_hints.get("parking_ratio"), 0.0)
            if hinted_parking_ratio > 0:
                updates["parking_ratio"] = hinted_parking_ratio
            hinted_parking_rate = _coerce_float_token(extracted_hints.get("parking_rate_monthly"), 0.0)
            if hinted_parking_rate > 0:
                updates["parking_rate_monthly"] = hinted_parking_rate
            hinted_parking_count = _coerce_int_token(extracted_hints.get("parking_count"), 0)
            if hinted_parking_count > 0:
                updates["parking_count"] = hinted_parking_count
            elif hinted_parking_ratio > 0:
                existing_count = _coerce_int_token(updates.get("parking_count", canonical.parking_count), 0)
                effective_rsf = _coerce_float_token(updates.get("rsf", canonical.rsf), 0.0)
                if existing_count <= 0 and effective_rsf > 0:
                    inferred_count = int(round((hinted_parking_ratio * effective_rsf) / 1000.0))
                    if inferred_count > 0:
                        updates["parking_count"] = inferred_count

            target_term_months = _coerce_int_token(updates.get("term_months"), _coerce_int_token(canonical.term_months, 0)) or 0
            if target_term_months > 0 and canonical.rent_schedule:
                adjusted_schedule = sorted(
                    canonical.rent_schedule,
                    key=lambda s: (int(getattr(s, "start_month", 0)), int(getattr(s, "end_month", 0))),
                )
                expected_start = 0
                rewritten = []
                for step in adjusted_schedule:
                    start_m = int(getattr(step, "start_month", 0))
                    end_m = int(getattr(step, "end_month", start_m))
                    if start_m < expected_start:
                        start_m = expected_start
                    if start_m > expected_start:
                        start_m = expected_start
                    if end_m < start_m:
                        end_m = start_m
                    expected_start = end_m + 1
                    rewritten.append(step.model_copy(update={"start_month": start_m, "end_month": end_m}))
                target_end = max(0, target_term_months - 1)
                trimmed = [s for s in rewritten if int(getattr(s, "start_month", 0)) <= target_end]
                if trimmed:
                    last = trimmed[-1]
                    last_end = int(getattr(last, "end_month", target_end))
                    if last_end != target_end:
                        trimmed[-1] = last.model_copy(update={"end_month": target_end})
                    updates["rent_schedule"] = trimmed
            if note_highlights:
                updates["notes"] = " | ".join(note_highlights)[:1600]
            elif text.strip() and not (canonical.notes or "").strip():
                updates["notes"] = (
                    "No ROFR/ROFO/renewal/OpEx-exclusion clauses were confidently detected. "
                    "Review lease clauses manually."
                )
            if updates:
                canonical = canonical.model_copy(update=updates)

        try:
            canonical, norm_warnings = normalize_canonical_lease(canonical)
            warnings.extend(norm_warnings)
        except Exception:
            canonical = _dict_to_canonical({}, "", "")
            confidence_score = 0.3
            used_fallback = True
            warnings.append("Lease normalization failed. A review template was loaded so you can continue.")
        conf_from_missing, missing, questions = _compute_confidence_and_missing(canonical)
        if used_fallback:
            confidence_score = min(confidence_score, conf_from_missing)
            if not questions:
                questions = [
                    "Please confirm lease name, RSF, commencement, expiration, and base rent schedule.",
                ]
        else:
            confidence_score = max(confidence_score, conf_from_missing)
        return (
            NormalizerResponse(
                canonical_lease=canonical,
                confidence_score=min(1.0, confidence_score),
                field_confidence=field_confidence,
                missing_fields=missing,
                clarification_questions=questions,
                warnings=warnings,
            ),
            not used_fallback,
        )

    if source_upper == "PASTED_TEXT":
        raw = (pasted_text or payload or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="pasted_text or payload required for PASTED_TEXT")
        # No try/except: let AI extraction failures propagate (503 from endpoint).
        extraction = extract_scenario_from_text(raw, "pasted_text")
        if extraction and extraction.scenario:
            canonical = _scenario_to_canonical(extraction.scenario, "", "")
            field_confidence = _extraction_confidence_to_field_confidence(extraction.confidence)
            confidence_score = max((sum(field_confidence.values()) / max(1, len(field_confidence))), 0.82) if field_confidence else 0.82
            warnings.extend(extraction.warnings or [])
        else:
            canonical = _dict_to_canonical({}, "", "")
            confidence_score = 0.5
        canonical, norm_warnings = normalize_canonical_lease(canonical)
        warnings.extend(norm_warnings)
        conf_from_missing, missing, questions = _compute_confidence_and_missing(canonical)
        confidence_score = max(confidence_score, conf_from_missing)
        return (
            NormalizerResponse(
                canonical_lease=canonical,
                confidence_score=min(1.0, confidence_score),
                field_confidence=field_confidence,
                missing_fields=missing,
                clarification_questions=questions,
                warnings=warnings,
            ),
            True,  # used_ai
        )

    # MANUAL or JSON
    raw_payload = (payload or "").strip()
    if not raw_payload:
        raise HTTPException(status_code=400, detail="payload (JSON string) required for MANUAL/JSON")
    try:
        data = json.loads(raw_payload)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {e}") from e
    canonical = _dict_to_canonical(data if isinstance(data, dict) else {}, "", "")
    canonical, norm_warnings = normalize_canonical_lease(canonical)
    warnings.extend(norm_warnings)
    confidence_score, missing, questions = _compute_confidence_and_missing(canonical)
    return (
        NormalizerResponse(
            canonical_lease=canonical,
            confidence_score=min(1.0, confidence_score),
            field_confidence=field_confidence,
            missing_fields=missing,
            clarification_questions=questions,
            warnings=warnings,
        ),
        False,  # used_ai: MANUAL/JSON does not use AI
    )


@app.post("/generate_scenarios", response_model=GenerateScenariosResponse)
def generate_scenarios_endpoint(req: GenerateScenariosRequest):
    """
    Generate Renewal and Relocation scenarios from a single request.
    Returns two full Scenario objects for comparison.
    """
    return generate_scenarios(req)


@app.post("/debug_cashflows")
def debug_cashflows(scenario: Scenario) -> dict:
    """
    Return monthly cashflows array for debugging (same scenario body as /compute).
    """
    cashflows, _ = compute_cashflows(scenario)
    return {"cashflows": cashflows}


@app.post("/reports", response_model=CreateReportResponse)
def create_report(req: CreateReportRequest) -> CreateReportResponse:
    """
    Store a report (scenarios + results + optional branding) and return reportId.
    """
    data = {
        "scenarios": [{"scenario": e.scenario, "result": e.result.model_dump()} for e in req.scenarios],
        "branding": req.branding.model_dump() if req.branding else {},
    }
    report_id = save_report(data)
    return CreateReportResponse(report_id=report_id)


@app.get("/reports/{report_id}")
def get_report(report_id: str):
    """
    Return stored report JSON for the report page to consume.
    """
    data = load_report(report_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return data


@app.get("/reports/{report_id}/preview", response_class=HTMLResponse)
def get_report_preview(report_id: str):
    """
    Return a print-friendly multi-scenario deck HTML from stored report payload.
    Useful as a fallback when PDF rendering is unavailable.
    """
    data = load_report(report_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return HTMLResponse(_build_report_deck_preview_html(data))


def _safe_float(value, default: float = 0.0) -> float:
    try:
        out = float(value)
        if out != out:  # NaN guard
            return default
        return out
    except (TypeError, ValueError):
        return default


def _fmt_money(value) -> str:
    v = _safe_float(value, 0.0)
    return f"${v:,.0f}"


def _fmt_money_2(value) -> str:
    v = _safe_float(value, 0.0)
    return f"${v:,.2f}"


def _fmt_psf(value) -> str:
    v = _safe_float(value, 0.0)
    return f"${v:,.2f}/SF"


def _build_report_deck_preview_html(data: dict) -> str:
    """
    Build a print-friendly multi-scenario deck HTML from stored /reports payload.
    This does not depend on frontend runtime JS, so Playwright can render it reliably.
    """
    entries = data.get("scenarios") if isinstance(data, dict) else []
    if not isinstance(entries, list):
        entries = []
    if not entries:
        return """<!doctype html><html><body><h1>No scenarios found</h1></body></html>"""

    scenario_rows: list[dict] = []
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        scenario = entry.get("scenario") if isinstance(entry.get("scenario"), dict) else {}
        result = entry.get("result") if isinstance(entry.get("result"), dict) else {}
        scenario_rows.append({"scenario": scenario, "result": result, "name": str(scenario.get("name") or f"Scenario {i + 1}")})

    def _fmt_int(value) -> str:
        return f"{int(round(_safe_float(value, 0))):,}"

    def _fmt_percent(value) -> str:
        return f"{_safe_float(value, 0) * 100:.2f}%"

    def _chunk(items: list, size: int) -> list[list]:
        if size <= 0:
            return [items]
        return [items[i:i + size] for i in range(0, len(items), size)]

    clause_patterns: list[tuple[str, re.Pattern[str]]] = [
        ("Renewal options", re.compile(r"\brenew(al)?\b|\bextend\b", re.I)),
        ("ROFR", re.compile(r"\brofr\b|right of first refusal", re.I)),
        ("ROFO", re.compile(r"\brofo\b|right of first offer", re.I)),
        ("Termination rights", re.compile(r"\btermination\b|early termination", re.I)),
        ("Assignment/sublease", re.compile(r"\bassignment\b|\bsublease\b", re.I)),
        ("OpEx exclusions", re.compile(r"\bopex exclusion\b|excluded from opex|operating expense exclusion", re.I)),
        ("Expense caps", re.compile(r"\bexpense cap\b|cap on controllable|controllable expenses", re.I)),
    ]

    def _extract_clause_bullets(text: str) -> list[str]:
        raw = (text or "").strip()
        if not raw:
            return []
        parts = [p.strip() for p in re.split(r"\n+|;\s+|\.\s+", raw) if p.strip()]
        out: list[str] = []
        for part in parts:
            for category, pattern in clause_patterns:
                if pattern.search(part):
                    out.append(f"{category}: {part}")
                    break
        if out:
            return out[:12]
        return parts[:8]

    metric_defs: list[tuple[str, str, str]] = [
        ("Building", "scenario.building_name", "text"),
        ("Suite", "scenario.suite", "text"),
        ("Premises", "scenario.name", "text"),
        ("RSF", "scenario.rsf", "int"),
        ("Commencement", "scenario.commencement", "text"),
        ("Expiration", "scenario.expiration", "text"),
        ("Lease type", "scenario.opex_mode", "text"),
        ("Term (months)", "result.term_months", "int"),
        ("Rent (nominal)", "result.rent_nominal", "money"),
        ("OpEx (nominal)", "result.opex_nominal", "money"),
        ("Total obligation", "result.total_cost_nominal", "money"),
        ("NPV cost", "result.npv_cost", "money"),
        ("Avg cost/year", "result.avg_cost_year", "money2"),
        ("Avg cost/SF/year", "result.avg_cost_psf_year", "psf"),
        ("Discount rate", "scenario.discount_rate_annual", "percent"),
    ]

    def _resolve(row: dict, key_path: str):
        node = row
        for k in key_path.split("."):
            if not isinstance(node, dict):
                return None
            node = node.get(k)
        return node

    def _format(value, style: str) -> str:
        if style == "money":
            return _fmt_money(value)
        if style == "money2":
            return _fmt_money_2(value)
        if style == "psf":
            return _fmt_psf(value)
        if style == "int":
            return _fmt_int(value)
        if style == "percent":
            return _fmt_percent(value)
        return str(value or "")

    scenario_chunks = _chunk(scenario_rows, 3)
    metric_chunks = _chunk(metric_defs, 11)

    matrix_sections: list[str] = []
    for s_idx, s_chunk in enumerate(scenario_chunks):
        for m_idx, m_chunk in enumerate(metric_chunks):
            start_opt = s_idx * 3 + 1
            end_opt = start_opt + len(s_chunk) - 1
            start_metric = m_idx * 11 + 1
            end_metric = start_metric + len(m_chunk) - 1
            header_cells = "".join(f"<th>{html.escape(str(r['name']))}</th>" for r in s_chunk)
            body_rows = []
            for label, key_path, style in m_chunk:
                tds = []
                for row in s_chunk:
                    val = _resolve(row, key_path)
                    tds.append(f"<td>{html.escape(_format(val, style))}</td>")
                body_rows.append(f"<tr><th>{html.escape(label)}</th>{''.join(tds)}</tr>")
            matrix_sections.append(
                """
                <section class="page">
                  <h2>Comparison Matrix</h2>
                  <p class="subhead">Options {start_opt}-{end_opt} of {total_opts} | Metrics {start_metric}-{end_metric} of {total_metrics}</p>
                  <table>
                    <thead><tr><th class="metric-col">Metric</th>{header_cells}</tr></thead>
                    <tbody>{body_rows}</tbody>
                  </table>
                </section>
                """.format(
                    start_opt=start_opt,
                    end_opt=end_opt,
                    total_opts=len(scenario_rows),
                    start_metric=start_metric,
                    end_metric=end_metric,
                    total_metrics=len(metric_defs),
                    header_cells=header_cells,
                    body_rows="".join(body_rows),
                )
            )

    ranking = sorted(
        scenario_rows,
        key=lambda r: _safe_float(((r.get("result") or {}).get("npv_cost")), 0),
    )
    ranking_rows = "".join(
        "<li><strong>{name}</strong>: {npv} NPV, {avg_psf} average cost/SF/year, {total} total obligation.</li>".format(
            name=html.escape(str(r.get("name") or "")),
            npv=html.escape(_fmt_money((r.get("result") or {}).get("npv_cost"))),
            avg_psf=html.escape(_fmt_psf((r.get("result") or {}).get("avg_cost_psf_year"))),
            total=html.escape(_fmt_money((r.get("result") or {}).get("total_cost_nominal"))),
        )
        for r in ranking[:8]
    )

    abstract_cards = []
    for idx, row in enumerate(scenario_rows):
        scenario = row.get("scenario") if isinstance(row.get("scenario"), dict) else {}
        result = row.get("result") if isinstance(row.get("result"), dict) else {}
        notes = str(scenario.get("notes") or "")
        bullets = [
            "{}: {} RSF, {} to {}, {} lease.".format(
                row.get("name") or f"Scenario {idx + 1}",
                _fmt_int(scenario.get("rsf")),
                scenario.get("commencement") or "",
                scenario.get("expiration") or "",
                str(scenario.get("opex_mode") or "NNN").upper(),
            ),
            "Financial profile: {} NPV, {} average cost/SF/year, {} total obligation.".format(
                _fmt_money(result.get("npv_cost")),
                _fmt_psf(result.get("avg_cost_psf_year")),
                _fmt_money(result.get("total_cost_nominal")),
            ),
        ]
        free_rent = int(round(_safe_float(scenario.get("free_rent_months"), 0)))
        if free_rent > 0:
            bullets.append(f"Free rent: {free_rent} month(s).")
        ti = _safe_float(scenario.get("ti_allowance_psf"), 0)
        if ti > 0:
            bullets.append(f"TI allowance: {_fmt_money_2(ti)}/SF.")
        clause_bullets = _extract_clause_bullets(notes)
        if clause_bullets:
            bullets.extend(clause_bullets)
        else:
            bullets.append("No clause notes extracted. Manually verify ROFR/ROFO, renewal rights, termination language, and OpEx exclusions.")
        abstract_cards.append(
            "<article class='card'><h3>{name}</h3><ul>{items}</ul></article>".format(
                name=html.escape(str(row.get("name") or f"Scenario {idx + 1}")),
                items="".join(f"<li>{html.escape(b)}</li>" for b in bullets[:14]),
            )
        )

    return f"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Lease Economics Comparison Deck</title>
  <style>
    @page {{ size: A4 landscape; margin: 12mm; }}
    body {{ font-family: Inter, Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; margin: 0; background: #f8fafc; }}
    .page {{ break-after: page; page-break-after: always; padding: 8mm 9mm; }}
    .cover {{ background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); }}
    h1 {{ font-size: 34px; margin: 0 0 8px 0; line-height: 1.1; }}
    h2 {{ font-size: 24px; margin: 0 0 6px 0; }}
    h3 {{ font-size: 15px; margin: 0 0 5px 0; }}
    p {{ color: #374151; margin: 0 0 10px 0; }}
    .kpis {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }}
    .kpi {{ border: 1px solid #d1d5db; border-radius: 8px; background: #fff; padding: 8px; }}
    .kpi-label {{ color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 4px 0; }}
    .kpi-value {{ color: #111827; font-size: 13px; font-weight: 700; margin: 0; }}
    .winner {{ border: 1px solid #a7f3d0; background: #ecfdf5; border-radius: 10px; padding: 10px; margin-top: 10px; }}
    .subhead {{ color: #6b7280; margin: 2px 0 8px 0; font-size: 10px; }}
    table {{ width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }}
    th, td {{ border: 1px solid #d1d5db; padding: 6px; vertical-align: top; word-break: break-word; }}
    thead th {{ background: #f3f4f6; text-align: left; }}
    .metric-col {{ width: 190px; }}
    ul {{ margin: 6px 0 0 14px; padding: 0; }}
    li {{ margin: 0 0 4px 0; }}
    .grid-2 {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }}
    .panel {{ border: 1px solid #d1d5db; border-radius: 8px; background: #fff; padding: 10px; }}
    .card {{ border: 1px solid #d1d5db; border-radius: 8px; background: #fff; padding: 10px; margin-bottom: 10px; break-inside: avoid; page-break-inside: avoid; }}
  </style>
</head>
<body>
  <section class="page cover">
    <p style="text-transform:uppercase; letter-spacing:0.25em; color:#6b7280; margin-bottom:10px;">Investor Financial Analysis</p>
    <h1>Lease Economics Comparison Deck</h1>
    <p>Institutional-grade side-by-side comparison across {len(scenario_rows)} scenario{"s" if len(scenario_rows) != 1 else ""}, designed for client presentation and investment committee review.</p>
    <div class="kpis">
      <div class="kpi"><p class="kpi-label">Prepared for</p><p class="kpi-value">Client</p></div>
      <div class="kpi"><p class="kpi-label">Prepared by</p><p class="kpi-value">The CRE Model</p></div>
      <div class="kpi"><p class="kpi-label">Report date</p><p class="kpi-value">{date.today().isoformat()}</p></div>
      <div class="kpi"><p class="kpi-label">Scenarios</p><p class="kpi-value">{len(scenario_rows)}</p></div>
    </div>
    <div class="winner">
      <p style="margin:0; color:#065f46; text-transform:uppercase; letter-spacing:0.1em; font-size:10px;">Best financial outcome by NPV</p>
      <p style="margin:3px 0 0 0; font-size:20px; font-weight:700; color:#064e3b;">{html.escape(str((ranking[0].get("name") if ranking else "N/A") or "N/A"))}</p>
      <p style="margin:4px 0 0 0; color:#064e3b;">{html.escape(_fmt_money((ranking[0].get("result") or {}).get("npv_cost")) if ranking else "$0")} NPV</p>
    </div>
  </section>

  <section class="page">
    <h2>Executive Summary</h2>
    <div class="grid-2">
      <div class="panel">
        <h3>Ranking by NPV</h3>
        <ul>{ranking_rows}</ul>
      </div>
      <div class="panel">
        <h3>Key decision points</h3>
        <ul>
          <li>Validate legal rights and options: ROFR, ROFO, renewal/extension, termination, and assignment/sublease terms.</li>
          <li>Confirm OpEx treatment: exclusions, controllable caps, and base-year or NNN definitions.</li>
          <li>Reconcile TI, free-rent economics, and capex timing against occupancy and cashflow priorities.</li>
          <li>Review parking and non-rent charges that can materially affect blended occupancy cost.</li>
        </ul>
      </div>
    </div>
  </section>

  {''.join(matrix_sections)}

  <section class="page">
    <h2>Lease Abstract Highlights</h2>
    <p>Bullet-point lease abstract for each scenario. Verify all legal terms against final lease language.</p>
    {''.join(abstract_cards)}
  </section>

  <section style="padding: 8mm 9mm;">
    <h2>Disclaimer</h2>
    <p>This analysis is for discussion purposes only. Figures are based on provided assumptions and do not constitute legal, accounting, or investment advice.</p>
  </section>
</body>
</html>
    """.strip()


@app.options("/brands")
def brands_options():
    """CORS preflight; ensure OPTIONS /brands returns 200."""
    return Response(status_code=200)


@app.get("/brands")
def get_brands_list():
    """Return list of available brands for UI dropdown."""
    return [b.model_dump() for b in list_brands()]


def _report_id(brand_id: str, scenario_dict: dict, meta_dict: dict) -> str:
    """Generate a unique report ID for headers."""
    scenario_hash = hashlib.sha256(json.dumps(scenario_dict, sort_keys=True, default=str).encode()).hexdigest()[:16]
    meta_hash = hashlib.sha256(json.dumps(meta_dict, sort_keys=True, default=str).encode()).hexdigest()[:16]
    payload = f"{brand_id}{scenario_hash}{meta_hash}{time.time():.3f}"
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _pdf_filename(meta_dict: dict) -> str:
    """Clean filename from proposal_name or default."""
    name = (meta_dict.get("proposal_name") or "").strip()
    if name:
        name = re.sub(r"[^\w\s-]", "", name)[:50].strip() or "lease-analysis"
        name = re.sub(r"[-\s]+", "-", name)
    else:
        name = "lease-financial-analysis"
    return f"{name}.pdf"


@app.post("/report")
def build_report_pdf_endpoint(req: ReportRequest) -> Response:
    """
    Build institutional report PDF: run compute, then generate PDF with brand.
    Validates brand_id (400) and scenario (422). Returns X-Report-ID header.
    Uses cache when same scenario+brand+meta; does not regenerate PDF.
    """
    brand = get_brand(req.brand_id)
    if brand is None:
        raise HTTPException(status_code=400, detail=f"Unknown brand_id: {req.brand_id}")

    meta_dict = req.meta.model_dump() if req.meta else {}
    scenario_dict = req.scenario.model_dump(mode="json")
    report_id = _report_id(req.brand_id, scenario_dict, meta_dict)
    base_headers = {"X-Report-ID": report_id}

    _, compute_result = compute_cashflows(req.scenario)

    cached_pdf = get_cached_report(scenario_dict, req.brand_id, meta_dict)
    if cached_pdf is not None:
        filename = _pdf_filename(meta_dict)
        return Response(
            content=cached_pdf,
            media_type="application/pdf",
            headers={
                **base_headers,
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    try:
        from reporting.report_builder import build_report_pdf
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Report module not available. Use POST /report/preview for HTML.",
            headers=base_headers,
        )
    try:
        pdf_bytes = build_report_pdf(
            req.scenario,
            compute_result,
            brand,
            meta_dict,
        )
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Playwright is required for PDF. Install: pip install playwright && playwright install chromium. Use POST /report/preview for HTML without Playwright.",
            headers=base_headers,
        )
    except Exception as e:
        print(f"[report] PDF generation failed: {e!s}")
        raise HTTPException(
            status_code=503,
            detail=f"PDF generation runtime unavailable. Use POST /report/preview to get HTML instead.",
            headers=base_headers,
        ) from e

    set_cached_report(scenario_dict, req.brand_id, meta_dict, pdf_bytes)
    filename = _pdf_filename(meta_dict)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            **base_headers,
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@app.post("/report/preview", response_class=HTMLResponse)
def build_report_preview(req: ReportRequest) -> str:
    """
    Return report as HTML (no Playwright required). Same request body as POST /report.
    Validates brand_id (400) and scenario (422). Returns X-Report-ID header.
    """
    brand = get_brand(req.brand_id)
    if brand is None:
        raise HTTPException(status_code=400, detail=f"Unknown brand_id: {req.brand_id}")

    meta_dict = req.meta.model_dump() if req.meta else {}
    scenario_dict = req.scenario.model_dump(mode="json")
    report_id = _report_id(req.brand_id, scenario_dict, meta_dict)

    _, compute_result = compute_cashflows(req.scenario)

    from reporting.report_builder import build_report_html
    html_str = build_report_html(req.scenario, compute_result, brand, meta_dict)
    return HTMLResponse(html_str, headers={"X-Report-ID": report_id})


@app.get("/reports/{report_id}/pdf")
def get_report_pdf(report_id: str):
    """
    Load report page in Playwright and return PDF stream.
    """
    data = load_report(report_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Report not found")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Playwright not installed. Run: pip install playwright && playwright install chromium",
        )

    url = f"{REPORT_BASE_URL}/report?reportId={report_id}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.emulate_media(media="print")
            page.wait_for_timeout(2800)  # allow charts and tables to render before PDF snapshot
            pdf_bytes = page.pdf(
                format="A4",
                landscape=True,
                print_background=True,
                margin={"top": "0.5in", "bottom": "0.5in", "left": "0.5in", "right": "0.5in"},
            )
            browser.close()
    except Exception as e:
        launch_msg = str(e).lower()
        missing_runtime_libs = any(
            token in launch_msg
            for token in (
                "error while loading shared libraries",
                "libatk",
                "libgtk",
                "libx11",
                "libnss",
                "exitcode=127",
            )
        )
        if missing_runtime_libs:
            raise HTTPException(
                status_code=503,
                detail=(
                    "PDF runtime dependencies are missing on backend. "
                    "Install Playwright system libraries in Docker image, "
                    "or use /reports/{report_id}/preview as fallback."
                ),
            )
        # Fallback: render multi-scenario deck from stored payload HTML (still side-by-side).
        try:
            html_str = _build_report_deck_preview_html(data)
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page()
                page.set_content(html_str, wait_until="load", timeout=30000)
                page.emulate_media(media="print")
                page.wait_for_timeout(400)
                pdf_bytes = page.pdf(
                    format="A4",
                    landscape=True,
                    print_background=True,
                    margin={"top": "0.5in", "bottom": "0.5in", "left": "0.5in", "right": "0.5in"},
                )
                browser.close()
        except Exception:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Deck PDF generation failed in both URL render and HTML render paths. "
                    "Use /reports/{report_id}/preview to download HTML and print to PDF."
                ),
            )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="lease-deck-{report_id[:8]}.pdf"'},
    )


def get_app() -> FastAPI:
    """
    Convenience accessor for ASGI servers.
    """
    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8010,
        reload=True,
    )
