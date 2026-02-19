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
from calendar import monthrange
from datetime import date, timedelta
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
    FreeRentPeriod,
    PhaseInStep,
    ReportRequest,
    RentScheduleStep,
    Scenario,
)
from engine.canonical_compute import compute_canonical, normalize_canonical_lease
from scenario_extract import (
    extract_text_from_pdf,
    extract_text_from_pdf_with_ocr,
    extract_text_from_docx,
    extract_scenario_from_text,
    extract_prefill_hints,
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


def _expiration_from_term_months(commencement: date, term_months: int) -> date:
    tm = max(1, int(term_months))
    total = (commencement.month - 1) + tm
    year = commencement.year + (total // 12)
    month = (total % 12) + 1
    day = min(commencement.day, monthrange(year, month)[1])
    anniv = date(year, month, day)
    return anniv - timedelta(days=1)


def _coerce_int_token(value: object, default: Optional[int] = 0) -> Optional[int]:
    if value is None:
        return int(default) if default is not None else None
    try:
        return int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return int(default) if default is not None else None


def _coerce_float_token(value: object, default: Optional[float] = 0.0) -> Optional[float]:
    if value is None:
        return float(default) if default is not None else None
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return float(default) if default is not None else None


def _window_to_month_bounds(
    start_value: object,
    end_value: object,
    term_months: int,
) -> tuple[Optional[int], Optional[int]]:
    start = _coerce_int_token(start_value, None)
    end = _coerce_int_token(end_value, start)
    if start is None or end is None:
        return None, None
    start_i = max(0, int(start))
    end_i = max(start_i, int(end))
    if term_months > 0:
        max_end = max(0, term_months - 1)
        if start_i > max_end:
            return None, None
        end_i = min(end_i, max_end)
    return start_i, end_i


def _month_index_to_calendar_year(commencement: date, month_index: int) -> int:
    total = (commencement.month - 1) + max(0, int(month_index))
    return commencement.year + (total // 12)


def _split_rent_schedule_by_boundaries(
    rent_schedule: list,
    term_months: int,
    phase_in_schedule: list,
    free_rent_periods: list,
    commencement_date: Optional[date] = None,
) -> list[dict]:
    if not rent_schedule:
        return []

    boundaries: set[int] = set()
    normalized_steps: list[tuple[int, int, float]] = []
    for step in rent_schedule:
        if isinstance(step, dict):
            start_raw = step.get("start_month")
            end_raw = step.get("end_month")
            rate_raw = step.get("rent_psf_annual")
        else:
            start_raw = getattr(step, "start_month", None)
            end_raw = getattr(step, "end_month", None)
            rate_raw = getattr(step, "rent_psf_annual", None)
        start_i, end_i = _window_to_month_bounds(start_raw, end_raw, term_months)
        if start_i is None or end_i is None:
            continue
        normalized_steps.append((start_i, end_i, max(0.0, _coerce_float_token(rate_raw, 0.0))))
        boundaries.add(start_i)
        boundaries.add(end_i + 1)

    for phase in phase_in_schedule or []:
        if isinstance(phase, dict):
            start_raw = phase.get("start_month")
            end_raw = phase.get("end_month")
        else:
            start_raw = getattr(phase, "start_month", None)
            end_raw = getattr(phase, "end_month", None)
        start_i, end_i = _window_to_month_bounds(start_raw, end_raw, term_months)
        if start_i is None or end_i is None:
            continue
        boundaries.add(start_i)
        boundaries.add(end_i + 1)

    for period in free_rent_periods or []:
        if isinstance(period, dict):
            start_raw = period.get("start_month")
            end_raw = period.get("end_month")
        else:
            start_raw = getattr(period, "start_month", None)
            end_raw = getattr(period, "end_month", None)
        start_i, end_i = _window_to_month_bounds(start_raw, end_raw, term_months)
        if start_i is None or end_i is None:
            continue
        boundaries.add(start_i)
        boundaries.add(end_i + 1)

    if term_months > 0:
        boundaries.add(0)
        boundaries.add(term_months)
    if commencement_date and term_months > 1:
        prev_year = _month_index_to_calendar_year(commencement_date, 0)
        for month_idx in range(1, term_months):
            curr_year = _month_index_to_calendar_year(commencement_date, month_idx)
            if curr_year != prev_year:
                boundaries.add(month_idx)
                prev_year = curr_year

    if not normalized_steps:
        return []
    if len(boundaries) <= 2:
        return [
            {
                "start_month": s,
                "end_month": e,
                "rent_psf_annual": round(r, 6),
            }
            for s, e, r in sorted(normalized_steps, key=lambda row: (row[0], row[1]))
        ]

    ordered_bounds = sorted(boundaries)
    intervals: list[tuple[int, int]] = []
    for idx in range(len(ordered_bounds) - 1):
        lo = ordered_bounds[idx]
        hi_exclusive = ordered_bounds[idx + 1]
        if hi_exclusive <= lo:
            continue
        hi = hi_exclusive - 1
        if term_months > 0:
            max_end = term_months - 1
            if lo > max_end:
                continue
            hi = min(hi, max_end)
        if hi < lo:
            continue
        intervals.append((lo, hi))

    split_rows: list[dict] = []
    for start_i, end_i, rate in sorted(normalized_steps, key=lambda row: (row[0], row[1])):
        for int_start, int_end in intervals:
            if int_end < start_i or int_start > end_i:
                continue
            row_start = max(start_i, int_start)
            row_end = min(end_i, int_end)
            if row_end < row_start:
                continue
            split_rows.append(
                {
                    "start_month": int(row_start),
                    "end_month": int(row_end),
                    "rent_psf_annual": round(float(rate), 6),
                }
            )

    if not split_rows:
        return []

    deduped: list[dict] = []
    seen: set[tuple[int, int, float]] = set()
    for row in sorted(split_rows, key=lambda r: (int(r["start_month"]), int(r["end_month"]))):
        key = (
            int(row["start_month"]),
            int(row["end_month"]),
            round(float(row["rent_psf_annual"]), 6),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _rent_schedule_rows_equal(left_rows: list, right_rows: list) -> bool:
    def _normalize(rows: list) -> list[tuple[int, int, float]]:
        normalized: list[tuple[int, int, float]] = []
        for step in rows or []:
            if isinstance(step, dict):
                start_raw = step.get("start_month")
                end_raw = step.get("end_month")
                rate_raw = step.get("rent_psf_annual")
            else:
                start_raw = getattr(step, "start_month", None)
                end_raw = getattr(step, "end_month", None)
                rate_raw = getattr(step, "rent_psf_annual", None)
            start_i = _coerce_int_token(start_raw, None)
            end_i = _coerce_int_token(end_raw, None)
            if start_i is None or end_i is None:
                continue
            normalized.append(
                (
                    int(start_i),
                    int(end_i),
                    round(_coerce_float_token(rate_raw, 0.0), 6),
                )
            )
        return sorted(normalized, key=lambda row: (row[0], row[1], row[2]))

    return _normalize(left_rows) == _normalize(right_rows)


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
    if token.lower() in {"of", "the"}:
        return ""
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


def _extract_opex_psf_from_text(text: str) -> tuple[Optional[float], Optional[int]]:
    """Extract OpEx $/SF/yr and optional source year from lease text."""
    if not text:
        return None, None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return None, None
    segments = _iter_text_segments(lines, max_lines=320)
    opex_kw = re.compile(r"(?i)\b(?:operating expenses?|opex|cam|common area maintenance)\b")
    value_patterns = [
        re.compile(
            r"(?i)\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)\s*(?:rsf|sf|square\s*feet?|sq\.?\s*ft)\s*(?:/|per)?\s*(?:year|yr|annum|annual)?\b"
        ),
        re.compile(r"(?i)\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:psf|p/?sf)\b"),
        re.compile(r"(?i)\$\s*([\d,]+(?:\.\d{1,4})?)\b"),
    ]
    candidates: list[tuple[int, int, float, Optional[int]]] = []
    for idx, seg in enumerate(segments):
        if not opex_kw.search(seg):
            continue
        low = seg.lower()
        for pat_idx, pat in enumerate(value_patterns):
            for m in pat.finditer(seg):
                value = _coerce_float_token(m.group(1), 0.0)
                if not (0 < value <= 150):
                    continue
                if pat_idx == 2 and value < 3.0:
                    continue
                score = 1
                if "operating expense" in low or "common area maintenance" in low or "opex" in low or re.search(r"(?i)\bcam\b", seg):
                    score += 4
                if re.search(r"(?i)\bestimated\s+operating\s+expenses?\b|\boperating\s+expenses?\s+for\s+20\d{2}\b", seg):
                    score += 5
                if "base year" in low:
                    score += 2
                if re.search(r"(?i)\b(?:estimate|estimated|projected)\b", seg):
                    score += 1
                if re.search(r"(?i)\b(?:base rent|rental rate|rent schedule|rent step)\b", seg):
                    score -= 3
                if re.search(r"(?i)\b(?:parking)\b", seg):
                    score -= 2
                if re.search(r"(?i)\b(?:ti|tenant improvements?|allowance|furniture|cabling|ff&e)\b", seg):
                    score -= 8
                if pat_idx == 2:
                    score -= 1
                year_match = re.search(r"(?i)\b(?:for|in|base year|as of)\s*(20\d{2})\b", seg)
                if not year_match:
                    year_match = re.search(r"\b(20\d{2})\b", seg)
                source_year: Optional[int] = int(year_match.group(1)) if year_match else None
                if source_year is not None and not (1990 <= source_year <= 2100):
                    source_year = None
                candidates.append((score, idx, float(round(value, 4)), source_year))
    if not candidates:
        return None, None
    candidates.sort(key=lambda x: (-x[0], x[1], x[2]))
    _, _, best_value, best_year = candidates[0]
    return best_value, best_year


def _extract_opex_by_calendar_year_from_text(text: str) -> dict[int, float]:
    """Extract explicit calendar-year OpEx rows, e.g. 2026 $12.50/SF, 2027 $12.88/SF."""
    if not text:
        return {}
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return {}

    results: dict[int, float] = {}
    row_pat = re.compile(
        r"(?i)\b(20\d{2})\b[^\n$]{0,60}\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)?\s*(?:rsf|sf|psf)?\b"
    )
    rev_pat = re.compile(
        r"(?i)\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)?\s*(?:rsf|sf|psf)?[^\n]{0,80}\b(20\d{2})\b"
    )
    table_pat = re.compile(
        r"(?i)^\s*(20\d{2})\s*(?:\||:|-|–|—)?\s*\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)?\s*(?:rsf|sf|psf)?\s*$"
    )
    opex_kw = re.compile(r"(?i)\b(?:operating expenses?|opex|cam|common area maintenance|additional rent)\b")

    for idx, line in enumerate(lines[:1200]):
        context = " ".join(
            lines[max(0, idx - 1): min(len(lines), idx + 2)]
        )
        if not opex_kw.search(context):
            continue
        for pat in (table_pat, row_pat):
            for m in pat.finditer(line):
                year = _coerce_int_token(m.group(1), None)
                value = _coerce_float_token(m.group(2), None)
                if year is None or value is None:
                    continue
                if not (1990 <= year <= 2200 and 0 < value <= 150):
                    continue
                results[int(year)] = float(round(value, 4))
        for m in rev_pat.finditer(line):
            value = _coerce_float_token(m.group(1), None)
            year = _coerce_int_token(m.group(2), None)
            if year is None or value is None:
                continue
            if not (1990 <= year <= 2200 and 0 < value <= 150):
                continue
            results[int(year)] = float(round(value, 4))

    return dict(sorted(results.items()))


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
        (re.compile(r"(?i)\blease\s+(?:proposal|space|premises)\s+(?:to\s+[^\n]{1,60}\s+for\s+office\s+space\s+at|at)\s+([A-Za-z0-9&' .-]{3,80}?\s*[–-]\s*Building\s*[A-Za-z0-9]+)"), 6),
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
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,120}?\((\d{1,3})\)\s*(?:calendar\s+)?months?\b",
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,120}?\b(\d{1,3})\s*(?:calendar\s+)?months?\b",
        r"(?i)\blease\s+term\b[^.\n]{0,120}?\((\d{1,3})\)\s*(?:calendar\s+)?months?\b",
        r"(?i)\blease\s+term\b[^.\n]{0,120}?\b(\d{1,3})\s*(?:calendar\s+)?months?\b",
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


def _extract_phase_in_schedule(text: str, term_months_hint: Optional[int] = None) -> list[dict]:
    """
    Extract phase-in occupancy rows such as:
      "Months 1-12 | 3,300 RSF"
      "Months 13-24 | 4,600 RSF"
      "Phase II ... (Month 19) ... Additional 8,500 RSF ... Total Premises ... 21,000 RSF"
    Returns canonical month-index steps (0-based).
    """
    if not text:
        return []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    phase_line_idx = [
        i for i, ln in enumerate(lines)
        if re.search(r"(?i)\bphase(?:\s*[- ]?\s*in)?\b", ln)
    ]
    if not phase_line_idx:
        return []

    # DOCX table rows are often emitted after paragraph text; scan all lines once phase language exists.
    candidates = lines

    row_pattern = re.compile(
        r"(?i)\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b"
        r"[^\n\r]{0,140}?\b(\d{1,3}(?:,\d{3})+|\d{3,7})(?:\.\d+)?\s*(?:rsf|sf|square\s*feet)\b"
    )

    parsed: list[dict] = []
    for ln in candidates:
        m = row_pattern.search(ln)
        if not m:
            continue
        start_month_1 = _coerce_int_token(m.group(1), 0)
        end_month_1 = _coerce_int_token(m.group(2), 0)
        rsf = _coerce_float_token(m.group(3), 0.0)
        if start_month_1 <= 0 or end_month_1 <= 0 or rsf <= 0:
            continue
        start = start_month_1 - 1
        end = max(start, end_month_1 - 1)
        if term_months_hint and term_months_hint > 0:
            if start >= term_months_hint:
                continue
            end = min(end, term_months_hint - 1)
        parsed.append(
            {
                "start_month": int(start),
                "end_month": int(end),
                "rsf": float(rsf),
            }
        )

    # If row-form parsing failed, support phase-block patterns where months and RSF
    # are not in the same line.
    if len(parsed) < 2:
        month_range_pat = re.compile(
            r"(?i)\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b"
        )
        month_single_pat = re.compile(r"(?i)\bmonth\s*(\d{1,3})\b")
        total_rsf_pat = re.compile(
            r"(?i)\btotal\s+premises(?:\s+after\s+\w+)?\b[^\n]{0,120}?\b(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|sf|square\s*feet)\b"
        )
        additional_rsf_pat = re.compile(
            r"(?i)\badditional\b[^\n]{0,80}?\b(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|sf|square\s*feet)\b"
        )
        generic_rsf_pat = re.compile(
            r"(?i)\b(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|sf|square\s*feet)\b"
        )
        phase_header_pat = re.compile(r"(?i)^\s*phase\s+(?:[ivx]+|\d+)\b")

        def _month_window_from_text(s: str) -> tuple[Optional[int], Optional[int], bool]:
            m = month_range_pat.search(s)
            if m:
                start_1 = _coerce_int_token(m.group(1), 0)
                end_1 = _coerce_int_token(m.group(2), 0)
                if start_1 > 0 and end_1 >= start_1:
                    return start_1, end_1, True
            m = month_single_pat.search(s)
            if m:
                start_1 = _coerce_int_token(m.group(1), 0)
                if start_1 > 0:
                    # "Month 19" typically means starts in month 19; infer end from next phase.
                    return start_1, None, False
            return None, None, False

        def _extract_rsf_from_block(block_lines: list[str], prev_total: Optional[float]) -> Optional[float]:
            block_text = "\n".join(block_lines)
            m_total = total_rsf_pat.search(block_text)
            if m_total:
                val = _coerce_float_token(m_total.group(1), 0.0)
                if val and val > 0:
                    return float(val)

            m_add = additional_rsf_pat.search(block_text)
            add_val = _coerce_float_token(m_add.group(1), 0.0) if m_add else 0.0
            if add_val and add_val > 0 and prev_total and prev_total > 0:
                return float(prev_total + add_val)

            for ln in block_lines:
                low = ln.lower()
                if any(x in low for x in ("$","per rsf","/rsf","parking ratio","licenses per 1000","per 1000")):
                    continue
                for m in generic_rsf_pat.finditer(ln):
                    val = _coerce_float_token(m.group(1), 0.0)
                    if not val or val <= 0:
                        continue
                    if 500 <= val <= 2_000_000:
                        return float(val)

            if add_val and add_val > 0:
                return float(add_val)
            return prev_total if prev_total and prev_total > 0 else None

        phase_indices = []
        for i, ln in enumerate(lines):
            if not phase_header_pat.search(ln):
                continue
            low_ln = ln.lower()
            # Skip non-occupancy "phase" blocks (security/credit/admin language).
            if any(
                bad in low_ln
                for bad in (
                    "security deposit",
                    "letter of credit",
                    "burn down",
                    "performance",
                    "accelerat",
                )
            ):
                continue
            phase_indices.append(i)
        if phase_indices:
            steps_raw: list[dict] = []
            prev_total_rsf: Optional[float] = None
            for pos, idx in enumerate(phase_indices):
                next_idx = phase_indices[pos + 1] if pos + 1 < len(phase_indices) else len(lines)
                block = lines[idx:next_idx]
                if not block:
                    continue

                start_1, end_1, has_explicit_end = _month_window_from_text(block[0])
                if start_1 is None:
                    for ln in block[:6]:
                        start_1, end_1, has_explicit_end = _month_window_from_text(ln)
                        if start_1 is not None:
                            break
                if start_1 is None:
                    continue

                rsf_total = _extract_rsf_from_block(block, prev_total_rsf)
                if rsf_total is None or rsf_total <= 0:
                    continue
                prev_total_rsf = rsf_total
                steps_raw.append(
                    {
                        "start_1": int(start_1),
                        "end_1": int(end_1) if end_1 is not None else None,
                        "explicit_end": bool(has_explicit_end),
                        "rsf": float(rsf_total),
                    }
                )

            if len(steps_raw) >= 2:
                parsed = []
                for i, step in enumerate(steps_raw):
                    start_1 = int(step["start_1"])
                    next_start_1 = int(steps_raw[i + 1]["start_1"]) if i + 1 < len(steps_raw) else None
                    end_1_val = step["end_1"]
                    if end_1_val is None:
                        if next_start_1 is not None and next_start_1 > start_1:
                            end_1 = next_start_1 - 1
                        elif term_months_hint and term_months_hint > 0:
                            end_1 = int(term_months_hint)
                        else:
                            end_1 = start_1
                    else:
                        end_1 = int(end_1_val)
                    if next_start_1 is not None and end_1 >= next_start_1:
                        end_1 = max(start_1, next_start_1 - 1)
                    start = max(0, start_1 - 1)
                    end = max(start, end_1 - 1)
                    if term_months_hint and term_months_hint > 0:
                        if start >= term_months_hint:
                            continue
                        end = min(end, term_months_hint - 1)
                    parsed.append(
                        {
                            "start_month": int(start),
                            "end_month": int(end),
                            "rsf": float(step["rsf"]),
                        }
                    )

    if len(parsed) < 2:
        return []

    parsed = sorted(parsed, key=lambda s: (int(s["start_month"]), int(s["end_month"])))
    deduped: list[dict] = []
    seen_step: set[tuple[int, int, float]] = set()
    for step in parsed:
        key = (
            int(step["start_month"]),
            int(step["end_month"]),
            round(float(step["rsf"]), 4),
        )
        if key in seen_step:
            continue
        seen_step.add(key)
        deduped.append(step)
    if len(deduped) < 2:
        return []

    # Force month-0 baseline to keep canonical validation happy.
    if deduped[0]["start_month"] > 0:
        deduped[0] = {**deduped[0], "start_month": 0}

    expected = 0
    for i, step in enumerate(deduped):
        start = int(step["start_month"])
        end = int(step["end_month"])
        if i > 0 and start > expected:
            deduped[i - 1] = {**deduped[i - 1], "end_month": start - 1}
            expected = start
        if start < expected:
            start = expected
            deduped[i] = {**deduped[i], "start_month": start}
        if end < start:
            end = start
            deduped[i] = {**deduped[i], "end_month": end}
        expected = end + 1

    if term_months_hint and term_months_hint > 0 and deduped[-1]["end_month"] < (term_months_hint - 1):
        deduped[-1] = {
            **deduped[-1],
            "end_month": int(term_months_hint - 1),
        }

    unique_rsf = {round(float(step["rsf"]), 4) for step in deduped}
    if len(unique_rsf) < 2:
        return []
    return deduped


def _extract_phase_rent_schedule(text: str, term_months_hint: Optional[int] = None) -> list[dict]:
    """
    Extract base-rent schedule from phase blocks such as:
      "Phase I ... (Months 1-18) ... Base Rent: $48.00/RSF"
      "Phase II ... (Month 19) ... Base Rent: $50.00/RSF"
    Returns canonical month-index steps (0-based).
    """
    if not text:
        return []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    phase_header_pat = re.compile(r"(?i)^\s*phase\s+(?:[ivx]+|\d+)\b")
    month_range_pat = re.compile(
        r"(?i)\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b"
    )
    month_single_pat = re.compile(r"(?i)\bmonth\s*(\d{1,3})\b")
    rent_rate_patterns = [
        re.compile(
            r"(?i)\b(?:base\s+rent|rental\s+rate)\b[^\n$]{0,70}\$\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)\s*(?:rsf|sf|psf)\b"
        ),
        re.compile(r"(?i)\$\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)\s*(?:rsf|sf|psf)\b"),
    ]

    def _month_window_from_text(s: str) -> tuple[Optional[int], Optional[int]]:
        m = month_range_pat.search(s)
        if m:
            start_1 = _coerce_int_token(m.group(1), 0)
            end_1 = _coerce_int_token(m.group(2), 0)
            if start_1 > 0 and end_1 >= start_1:
                return int(start_1), int(end_1)
        m = month_single_pat.search(s)
        if m:
            start_1 = _coerce_int_token(m.group(1), 0)
            if start_1 > 0:
                return int(start_1), None
        return None, None

    def _extract_rate_from_block(block_lines: list[str]) -> Optional[float]:
        candidates: list[tuple[int, float, int]] = []
        for idx, ln in enumerate(block_lines):
            low = ln.lower()
            if any(
                bad in low
                for bad in (
                    "security deposit",
                    "letter of credit",
                    "ti allowance",
                    "tenant improvement allowance",
                    "parking",
                    "operating expense",
                    "cam",
                    "market rate",
                )
            ):
                continue
            for pat_idx, pat in enumerate(rent_rate_patterns):
                for m in pat.finditer(ln):
                    rate = _coerce_float_token(m.group(1), 0.0)
                    if not (2.0 <= rate <= 500.0):
                        continue
                    score = 1
                    if "base rent" in low or "rental rate" in low:
                        score += 4
                    if pat_idx == 0:
                        score += 2
                    if rate >= 15:
                        score += 1
                    elif rate < 8:
                        score -= 1
                    candidates.append((score, float(rate), idx))
        if not candidates:
            return None
        # If score ties, prefer higher rate to avoid selecting OpEx-like values
        # over base-rent values from the same phase block.
        candidates.sort(key=lambda x: (-x[0], -x[1], x[2]))
        return candidates[0][1]

    phase_indices: list[int] = []
    for i, ln in enumerate(lines):
        if not phase_header_pat.search(ln):
            continue
        low_ln = ln.lower()
        if any(
            bad in low_ln
            for bad in (
                "security deposit",
                "letter of credit",
                "burn down",
                "performance",
                "accelerat",
            )
        ):
            continue
        phase_indices.append(i)
    if not phase_indices:
        return []

    phase_blocks: list[dict] = []
    for pos, idx in enumerate(phase_indices):
        next_idx = phase_indices[pos + 1] if pos + 1 < len(phase_indices) else len(lines)
        block = lines[idx:next_idx]
        if not block:
            continue
        start_1, end_1 = _month_window_from_text(block[0])
        if start_1 is None:
            for ln in block[:6]:
                start_1, end_1 = _month_window_from_text(ln)
                if start_1 is not None:
                    break
        if start_1 is None:
            continue
        phase_blocks.append(
            {
                "start_1": int(start_1),
                "end_1": int(end_1) if end_1 is not None else None,
                "block": block,
            }
        )
    if not phase_blocks:
        return []

    rated_steps: list[dict] = []
    for i, phase in enumerate(phase_blocks):
        rate = _extract_rate_from_block(phase["block"])
        if rate is None:
            continue
        start_1 = int(phase["start_1"])
        end_1_val = phase["end_1"]
        next_start_1 = int(phase_blocks[i + 1]["start_1"]) if i + 1 < len(phase_blocks) else None
        if end_1_val is not None:
            end_1 = int(end_1_val)
        elif next_start_1 is not None and next_start_1 > start_1:
            end_1 = next_start_1 - 1
        elif term_months_hint and term_months_hint > 0:
            end_1 = int(term_months_hint)
        else:
            end_1 = start_1
        if next_start_1 is not None and end_1 >= next_start_1:
            end_1 = max(start_1, next_start_1 - 1)
        start = max(0, start_1 - 1)
        end = max(start, end_1 - 1)
        if term_months_hint and term_months_hint > 0:
            if start >= term_months_hint:
                continue
            end = min(end, term_months_hint - 1)
        rated_steps.append(
            {
                "start_month": int(start),
                "end_month": int(end),
                "rent_psf_annual": float(round(rate, 4)),
            }
        )
    if not rated_steps:
        return []

    rated_steps = sorted(rated_steps, key=lambda s: (int(s["start_month"]), int(s["end_month"])))
    normalized: list[dict] = []
    expected = 0
    for step in rated_steps:
        start = int(step["start_month"])
        end = int(step["end_month"])
        rate = float(step["rent_psf_annual"])
        if not normalized and start > 0:
            start = 0
        if start > expected and normalized:
            normalized[-1] = {**normalized[-1], "end_month": start - 1}
        if start < expected:
            start = expected
        if end < start:
            end = start
        normalized.append({"start_month": start, "end_month": end, "rent_psf_annual": rate})
        expected = end + 1

    if term_months_hint and term_months_hint > 0 and normalized[-1]["end_month"] < (term_months_hint - 1):
        normalized[-1] = {**normalized[-1], "end_month": int(term_months_hint - 1)}

    merged: list[dict] = []
    for step in normalized:
        if (
            merged
            and round(float(merged[-1]["rent_psf_annual"]), 4) == round(float(step["rent_psf_annual"]), 4)
            and int(step["start_month"]) <= int(merged[-1]["end_month"]) + 1
        ):
            merged[-1] = {**merged[-1], "end_month": max(int(merged[-1]["end_month"]), int(step["end_month"]))}
        else:
            merged.append(step)
    return merged


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
        "opex_psf_year_1": None,
        "opex_source_year": None,
        "opex_by_calendar_year": {},
        "free_rent_scope": None,
        "free_rent_start_month": None,
        "free_rent_end_month": None,
        "phase_in_schedule": [],
        "rent_schedule": [],
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
        rf"(?i)\b(?:lease\s+)?commencement\b[^.\n]{{0,120}}?\bestimated\s+to\s+be\s+{date_token_capture}",
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
    elif hints["commencement_date"] and hints.get("term_months"):
        try:
            hints["expiration_date"] = _expiration_from_term_months(
                hints["commencement_date"],
                int(hints["term_months"]),
            )
        except Exception:
            pass

    # ---- Free rent / abatement scope + month range ----
    lower_text = text.lower()
    if re.search(r"(?i)\b(?:gross\s+rent\s+abatement|gross\s+abatement|abate\s+base\s+rent\s+and\s+operating\s+expenses|base\s+rent\s+and\s+operating\s+expenses\s+abated)\b", text):
        hints["free_rent_scope"] = "gross"
    elif re.search(r"(?i)\b(?:base\s+rent\s+abatement|base-only\s+abatement|base\s+abatement)\b", text):
        hints["free_rent_scope"] = "base"

    free_range_match = re.search(
        r"(?i)\b(?:free\s+rent|rent\s+abatement|abatement)\b[^\n]{0,100}\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b",
        text,
    )
    if not free_range_match:
        free_range_match = re.search(
            r"(?i)\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b[^\n]{0,80}\b(?:free\s+rent|rent\s+abatement|abatement)\b",
            text,
        )
    if free_range_match:
        start_1 = _coerce_int_token(free_range_match.group(1), 0)
        end_1 = _coerce_int_token(free_range_match.group(2), 0)
        if start_1 > 0 and end_1 >= start_1:
            hints["free_rent_start_month"] = start_1 - 1
            hints["free_rent_end_month"] = end_1 - 1
    else:
        free_count_match = re.search(
            r"(?i)\b(\d{1,3})\s+months?\b[^\n]{0,60}\b(?:free\s+rent|rent\s+abatement|abatement)\b",
            text,
        )
        if not free_count_match:
            free_count_match = re.search(
                r"(?i)\b(?:free\s+rent|rent\s+abatement|abatement)\b[^\n]{0,60}\b(\d{1,3})\s+months?\b",
                text,
            )
        free_count = _coerce_int_token(free_count_match.group(1), 0) if free_count_match else 0
        if free_count and free_count > 0:
            hints["free_rent_start_month"] = 0
            hints["free_rent_end_month"] = max(0, int(free_count) - 1)
            if hints["free_rent_scope"] is None and ("gross" in lower_text):
                hints["free_rent_scope"] = "gross"

    phase_schedule = _extract_phase_in_schedule(text, term_months_hint=_coerce_int_token(hints.get("term_months"), 0))
    if phase_schedule:
        hints["phase_in_schedule"] = phase_schedule
        phase_rsf = max(float(step.get("rsf", 0.0) or 0.0) for step in phase_schedule)
        if phase_rsf > 0:
            hints["rsf"] = phase_rsf
            hints["_rsf_score"] = max(int(hints.get("_rsf_score", -999) or -999), 10)
        if not hints.get("term_months"):
            hints["term_months"] = int(phase_schedule[-1]["end_month"]) + 1

    phase_rent_schedule = _extract_phase_rent_schedule(
        text,
        term_months_hint=_coerce_int_token(hints.get("term_months"), 0),
    )
    if phase_rent_schedule:
        hints["rent_schedule"] = phase_rent_schedule
        if not hints.get("term_months"):
            hints["term_months"] = int(phase_rent_schedule[-1]["end_month"]) + 1

    # Reuse broad regex prefill rent-table parsing to support more lease/proposal formats.
    try:
        prefill_hints = extract_prefill_hints(text)
    except Exception:
        prefill_hints = {}
    prefill_rent_steps = prefill_hints.get("rent_steps") if isinstance(prefill_hints.get("rent_steps"), list) else []
    prefill_base_rate = _coerce_float_token(prefill_hints.get("rate_psf_yr"), 0.0) or 0.0
    normalized_prefill_rent: list[dict] = []
    for step in prefill_rent_steps:
        if not isinstance(step, dict):
            continue
        start_m = _coerce_int_token(step.get("start"), None)
        end_m = _coerce_int_token(step.get("end"), start_m)
        rate = _coerce_float_token(step.get("rate_psf_yr"), 0.0)
        if start_m is None or end_m is None:
            continue
        start_i = max(0, int(start_m))
        end_i = max(start_i, int(end_m))
        normalized_prefill_rent.append(
            {
                "start_month": start_i,
                "end_month": end_i,
                "rent_psf_annual": max(0.0, float(rate)),
            }
        )
    if normalized_prefill_rent:
        current = hints.get("rent_schedule") if isinstance(hints.get("rent_schedule"), list) else []
        current_rates_raw = [
            round(float(s.get("rent_psf_annual", 0.0)), 4)
            for s in current
            if isinstance(s, dict)
        ]
        current_rate_count = len(
            set(current_rates_raw)
        )
        prefill_rate_count = len(
            {
                round(float(s.get("rent_psf_annual", 0.0)), 4)
                for s in normalized_prefill_rent
            }
        )
        current_rate_max = max(current_rates_raw) if current_rates_raw else 0.0
        low_flat_schedule = bool(current_rates_raw) and current_rate_max <= 10.0 and current_rate_count <= 1
        prefill_has_stronger_base = prefill_base_rate >= 12.0 and prefill_base_rate > (current_rate_max + 4.0)
        should_replace = (
            not current
            or len(normalized_prefill_rent) > len(current)
            or prefill_rate_count > current_rate_count
            or (low_flat_schedule and prefill_has_stronger_base)
        )
        if should_replace:
            hints["rent_schedule"] = normalized_prefill_rent
            if not hints.get("term_months"):
                hints["term_months"] = int(normalized_prefill_rent[-1]["end_month"]) + 1
    elif prefill_base_rate >= 12.0:
        current = hints.get("rent_schedule") if isinstance(hints.get("rent_schedule"), list) else []
        current_rates = [
            round(float(s.get("rent_psf_annual", 0.0)), 4)
            for s in current
            if isinstance(s, dict)
        ]
        current_rate_max = max(current_rates) if current_rates else 0.0
        if current_rates and len(set(current_rates)) <= 1 and current_rate_max <= 10.0:
            term_hint = _coerce_int_token(hints.get("term_months"), 0) or 0
            if term_hint > 0:
                hints["rent_schedule"] = [
                    {
                        "start_month": 0,
                        "end_month": max(0, term_hint - 1),
                        "rent_psf_annual": float(round(prefill_base_rate, 4)),
                    }
                ]

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

    hinted_opex, hinted_opex_year = _extract_opex_psf_from_text(text)
    opex_by_year = _extract_opex_by_calendar_year_from_text(text)
    if opex_by_year:
        hints["opex_by_calendar_year"] = opex_by_year
        if hinted_opex is None:
            first_year = min(opex_by_year.keys())
            hints["opex_psf_year_1"] = float(opex_by_year[first_year])
            hints["opex_source_year"] = int(first_year)
    if hinted_opex is not None and hinted_opex > 0:
        hints["opex_psf_year_1"] = hinted_opex
    if hinted_opex_year is not None:
        hints["opex_source_year"] = hinted_opex_year

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


def _detect_document_type(text: str, filename: str = "") -> str:
    """Best-effort document type detection across leases, proposals, LOIs, amendments, etc."""
    corpus = f"{filename}\n{text[:6000]}".lower()
    score: dict[str, int] = {
        "rfp": 0,
        "loi": 0,
        "proposal": 0,
        "counter": 0,
        "subsublease": 0,
        "sublease": 0,
        "amendment": 0,
        "renewal": 0,
        "term_sheet": 0,
        "lease": 0,
    }
    patterns: list[tuple[str, list[str]]] = [
        ("rfp", [r"\brfp\b", r"request for proposal", r"submission requirements"]),
        ("loi", [r"\bloi\b", r"letter of intent"]),
        ("proposal", [r"\bproposal\b", r"economic proposal", r"business terms proposal"]),
        ("counter", [r"\bcounter\b", r"counter proposal", r"redline"]),
        ("subsublease", [r"\bsub[- ]?sublease\b", r"\bsubsublease\b"]),
        ("sublease", [r"\bsublease\b", r"\bsublessor\b", r"\bsublessee\b"]),
        ("amendment", [r"\bamendment\b", r"first amendment", r"second amendment", r"addendum"]),
        ("renewal", [r"\brenewal\b", r"renewal term", r"extension term", r"exercise (?:its )?option"]),
        ("term_sheet", [r"term sheet", r"deal points", r"summary of terms"]),
        ("lease", [r"\blease\b", r"lease agreement", r"landlord hereby leases", r"demised premises"]),
    ]
    for kind, pats in patterns:
        for pat in pats:
            hits = len(re.findall(pat, corpus, flags=re.I))
            if hits > 0:
                score[kind] += hits

    # Prefer more specific document types over generic lease if both appear.
    if score["counter"] > 0:
        return "counter_proposal"
    if score["subsublease"] > 0:
        return "subsublease"
    if score["sublease"] > 0:
        return "sublease"
    if score["amendment"] > 0:
        return "amendment"
    if score["renewal"] > 0 and score["proposal"] > 0:
        return "renewal_proposal"
    ordered = sorted(score.items(), key=lambda kv: kv[1], reverse=True)
    if not ordered or ordered[0][1] <= 0:
        return "unknown"
    top = ordered[0][0]
    return {
        "rfp": "rfp",
        "loi": "loi",
        "proposal": "proposal",
        "counter": "counter_proposal",
        "subsublease": "subsublease",
        "sublease": "sublease",
        "amendment": "amendment",
        "renewal": "renewal_or_extension",
        "term_sheet": "term_sheet",
        "lease": "lease",
    }.get(top, "unknown")


def _extract_sections_searched(text: str) -> list[str]:
    if not text:
        return []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    sections: list[str] = []
    section_rules: list[tuple[str, re.Pattern[str]]] = [
        ("Premises/Property", re.compile(r"(?i)\b(premises|property|building|suite|address|location)\b")),
        ("Term", re.compile(r"(?i)\b(term|commencement|expiration|expiration date|lease term)\b")),
        ("Rent Schedule", re.compile(r"(?i)\b(base rent|rent schedule|rental rate|lease year|annual rent)\b")),
        ("Operating Expenses", re.compile(r"(?i)\b(opex|operating expenses?|cam|common area maintenance|base year)\b")),
        ("Concessions", re.compile(r"(?i)\b(free rent|abatement|concession)\b")),
        ("Parking", re.compile(r"(?i)\b(parking|spaces per 1,?000|parking ratio)\b")),
        ("Options/Rights", re.compile(r"(?i)\b(renewal|extension|rofr|rofo|termination option|right of first)\b")),
    ]
    scanned = lines[:1200]
    for label, pat in section_rules:
        if any(pat.search(ln) for ln in scanned):
            sections.append(label)
    return sections


def _build_extraction_summary(
    *,
    text: str,
    filename: str,
    canonical: CanonicalLease,
    missing_fields: list[str],
    warnings: list[str],
) -> dict:
    doc_type = _detect_document_type(text, filename)
    sections = _extract_sections_searched(text)
    found: list[str] = []
    if (canonical.building_name or "").strip():
        found.append(f"Building: {canonical.building_name.strip()}")
    if (canonical.suite or "").strip():
        found.append(f"Suite: {canonical.suite.strip()}")
    elif (canonical.floor or "").strip():
        found.append(f"Floor: {canonical.floor.strip()}")
    if float(canonical.rsf or 0.0) > 0:
        found.append(f"RSF: {int(round(float(canonical.rsf))):,}")
    if canonical.commencement_date:
        found.append(f"Commencement: {canonical.commencement_date.isoformat()}")
    if canonical.expiration_date:
        found.append(f"Expiration: {canonical.expiration_date.isoformat()}")
    if int(canonical.term_months or 0) > 0:
        found.append(f"Term: {int(canonical.term_months)} months")
    if canonical.rent_schedule:
        found.append(f"Rent periods: {len(canonical.rent_schedule)}")
    if float(canonical.opex_psf_year_1 or 0.0) > 0:
        found.append(f"OpEx: ${float(canonical.opex_psf_year_1):.2f}/SF/yr")
    if getattr(canonical, "opex_by_calendar_year", {}):
        found.append(f"OpEx table years: {len(getattr(canonical, 'opex_by_calendar_year', {}))}")
    if int(canonical.free_rent_months or 0) > 0:
        found.append(f"Abatement: {int(canonical.free_rent_months)} months ({canonical.free_rent_scope})")

    section_map: dict[str, list[str]] = {
        "building_name": ["Premises/Property"],
        "suite": ["Premises/Property"],
        "rsf": ["Premises/Property", "Rent Schedule"],
        "commencement_date": ["Term"],
        "expiration_date": ["Term"],
        "term_months": ["Term"],
        "rent_schedule": ["Rent Schedule"],
        "opex_psf_year_1": ["Operating Expenses"],
        "opex_growth_rate": ["Operating Expenses"],
        "parking_ratio": ["Parking"],
        "parking_count": ["Parking"],
    }
    missing_pretty: list[str] = []
    for field in missing_fields:
        looked = section_map.get(field, sections or ["Document body"])
        label = field.replace("_", " ").strip().title()
        missing_pretty.append(f"{label} (searched: {', '.join(looked)})")
    if not sections:
        sections = ["Document body"]
    if any("fallback" in str(w).lower() for w in warnings):
        found.append("Extraction mode: fallback heuristics")
    return {
        "document_type_detected": doc_type,
        "key_terms_found": found[:16],
        "key_terms_missing": missing_pretty[:16],
        "sections_searched": sections[:16],
    }


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
    extraction_text_for_summary = ""
    extraction_filename_for_summary = ""

    if source_upper in ("PDF", "WORD"):
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="File required for PDF/WORD")
        extraction_filename_for_summary = file.filename or ""
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
        extraction_text_for_summary = text or ""

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
                fallback_suite = str(extracted_hints.get("suite") or "").strip()
                fallback_floor = str(extracted_hints.get("floor") or "").strip()
                fallback_building = str(extracted_hints.get("building_name") or "").strip() or _fallback_building_from_filename(file.filename or "")
                fallback_address = str(extracted_hints.get("address") or "").strip()
                fallback_rsf = _coerce_float_token(extracted_hints.get("rsf"), 0.0) or 0.0
                fallback_loc = f"Suite {fallback_suite}" if fallback_suite else (f"Floor {fallback_floor}" if fallback_floor else "")
                fallback_name = f"{fallback_building} {fallback_loc}".strip() if (fallback_building or fallback_loc) else "Extracted lease"
                hinted_rent_schedule = extracted_hints.get("rent_schedule") if isinstance(extracted_hints.get("rent_schedule"), list) else []
                fallback_rent_schedule: list[dict] = []
                for step in hinted_rent_schedule:
                    if not isinstance(step, dict):
                        continue
                    start_m = _coerce_int_token(step.get("start_month"), None)
                    end_m = _coerce_int_token(step.get("end_month"), start_m)
                    rate = _coerce_float_token(step.get("rent_psf_annual"), 0.0)
                    if start_m is None or end_m is None:
                        continue
                    fallback_rent_schedule.append(
                        {
                            "start_month": max(0, int(start_m)),
                            "end_month": max(max(0, int(start_m)), int(end_m)),
                            "rent_psf_annual": max(0.0, float(rate)),
                        }
                    )
                if not fallback_rent_schedule:
                    fallback_rent_schedule = [
                        {
                            "start_month": 0,
                            "end_month": max(0, fallback_term - 1),
                            "rent_psf_annual": 0.0,
                        }
                    ]
                fallback_payload = {
                    "scenario_name": fallback_name,
                    "building_name": fallback_building,
                    "suite": fallback_suite,
                    "floor": fallback_floor,
                    "address": fallback_address,
                    "premises_name": fallback_name,
                    "rsf": fallback_rsf,
                    "commencement_date": fallback_comm,
                    "expiration_date": fallback_exp,
                    "term_months": fallback_term,
                    "rent_schedule": fallback_rent_schedule,
                    "expense_structure_type": "nnn",
                    "opex_psf_year_1": 0.0,
                    "expense_stop_psf": 0.0,
                    "opex_growth_rate": 0.03,
                    "discount_rate_annual": 0.08,
                }
                if isinstance(extracted_hints.get("phase_in_schedule"), list) and extracted_hints["phase_in_schedule"]:
                    fallback_payload["phase_in_schedule"] = extracted_hints["phase_in_schedule"]
                canonical = _dict_to_canonical(fallback_payload, "", "")
                field_confidence = {
                    "rsf": 0.75 if extracted_hints.get("rsf") else 0.25,
                    "commencement_date": 0.75 if extracted_hints.get("commencement_date") else 0.25,
                    "expiration_date": 0.75 if extracted_hints.get("expiration_date") else 0.25,
                    "rent_schedule": 0.75 if hinted_rent_schedule else 0.25,
                    "building_name": 0.8 if fallback_building else 0.2,
                    "suite": 0.8 if fallback_suite else 0.2,
                    "floor": 0.8 if fallback_floor else 0.2,
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
            extra_note_lines: list[str] = []
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
                if not extracted_hints.get("expiration_date"):
                    comm_for_term = updates.get("commencement_date", canonical.commencement_date)
                    if isinstance(comm_for_term, date):
                        try:
                            derived_exp = _expiration_from_term_months(comm_for_term, int(extracted_hints["term_months"]))
                            updates["expiration_date"] = derived_exp
                            warnings.append(
                                f"Expiration inferred from {int(extracted_hints['term_months'])}-month lease term and commencement date."
                            )
                        except Exception:
                            pass
            hint_free_scope = str(extracted_hints.get("free_rent_scope") or "").strip().lower()
            if hint_free_scope in {"base", "gross"}:
                updates["free_rent_scope"] = hint_free_scope
            hint_free_start = _coerce_int_token(extracted_hints.get("free_rent_start_month"), None)
            hint_free_end = _coerce_int_token(extracted_hints.get("free_rent_end_month"), None)
            term_for_free = _coerce_int_token(updates.get("term_months"), _coerce_int_token(canonical.term_months, 0)) or 0
            if hint_free_start is not None and hint_free_end is not None:
                free_start = max(0, int(hint_free_start))
                free_end = max(free_start, int(hint_free_end))
                if term_for_free > 0:
                    term_max = max(0, term_for_free - 1)
                    free_start = min(free_start, term_max)
                    free_end = min(free_end, term_max)
                updates["free_rent_periods"] = [FreeRentPeriod(start_month=free_start, end_month=free_end)]
                updates["free_rent_months"] = max(0, free_end - free_start + 1)
            elif (not canonical.free_rent_periods) and _coerce_int_token(canonical.free_rent_months, 0) > 0:
                existing_months = _coerce_int_token(canonical.free_rent_months, 0) or 0
                existing_end = max(0, existing_months - 1)
                if term_for_free > 0:
                    existing_end = min(existing_end, max(0, term_for_free - 1))
                updates["free_rent_periods"] = [FreeRentPeriod(start_month=0, end_month=existing_end)]
            suite_val = str(extracted_hints.get("suite") or canonical.suite or "").strip()
            if not suite_val:
                suite_val = _extract_suite_from_text(str(canonical.premises_name or ""))
            floor_val = str(extracted_hints.get("floor") or canonical.floor or "").strip()
            if floor_val and not (canonical.floor or "").strip():
                updates["floor"] = floor_val
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
                # Floor is only a fallback when suite is unavailable.
                updates["floor"] = ""
            location_label = f"Suite {suite_val}" if suite_val else (f"Floor {floor_val}" if floor_val else "")
            if building_val and location_label:
                updates["premises_name"] = f"{building_val} {location_label}"
            elif location_label and not (canonical.premises_name or "").strip():
                updates["premises_name"] = location_label
            scenario_name_val = str(canonical.scenario_name or "").strip()
            if _looks_like_generic_scenario_name(scenario_name_val):
                if building_val and location_label:
                    updates["scenario_name"] = f"{building_val} {location_label}"
                elif building_val:
                    updates["scenario_name"] = building_val
                elif location_label:
                    updates["scenario_name"] = location_label
            if extracted_hints.get("lease_type"):
                updates["lease_type"] = str(extracted_hints["lease_type"])

            hinted_opex = _coerce_float_token(extracted_hints.get("opex_psf_year_1"), 0.0)
            hinted_opex_by_year_raw = extracted_hints.get("opex_by_calendar_year")
            hinted_opex_by_year: dict[int, float] = {}
            if isinstance(hinted_opex_by_year_raw, dict):
                for y, v in hinted_opex_by_year_raw.items():
                    y_i = _coerce_int_token(y, None)
                    v_f = _coerce_float_token(v, None)
                    if y_i is None or v_f is None:
                        continue
                    if 1900 <= y_i <= 2200 and v_f >= 0:
                        hinted_opex_by_year[int(y_i)] = float(round(v_f, 4))
            if hinted_opex_by_year:
                updates["opex_by_calendar_year"] = dict(sorted(hinted_opex_by_year.items()))
            if hinted_opex > 0:
                updates["opex_psf_year_1"] = hinted_opex
                if _coerce_float_token(canonical.expense_stop_psf, 0.0) <= 0:
                    updates["expense_stop_psf"] = hinted_opex
            opex_source_year = _coerce_int_token(extracted_hints.get("opex_source_year"), 0)
            commencement_for_opex = updates.get("commencement_date", canonical.commencement_date)
            commencement_year = commencement_for_opex.year if isinstance(commencement_for_opex, date) else 0
            if hinted_opex_by_year and commencement_year >= 1900:
                if commencement_year in hinted_opex_by_year:
                    year_rate = float(hinted_opex_by_year[commencement_year])
                    updates["opex_psf_year_1"] = year_rate
                    updates["expense_stop_psf"] = year_rate
                else:
                    prior_years = [y for y in hinted_opex_by_year if y <= commencement_year]
                    if prior_years:
                        prior_year = max(prior_years)
                        year_rate = float(hinted_opex_by_year[prior_year])
                        updates["opex_psf_year_1"] = year_rate
                        updates["expense_stop_psf"] = year_rate
                        if prior_year < commencement_year:
                            extra_note_lines.append(
                                f"OpEx table provided through {prior_year}; carried forward ${year_rate:,.2f}/SF "
                                f"for {commencement_year}+ until updated values are provided."
                            )
            if (
                hinted_opex > 0
                and not hinted_opex_by_year
                and opex_source_year >= 1900
                and commencement_year >= 1900
                and opex_source_year < commencement_year
            ):
                years_forward = commencement_year - opex_source_year
                escalated_opex = round(hinted_opex * (1.03 ** years_forward), 4)
                updates["opex_psf_year_1"] = escalated_opex
                updates["expense_stop_psf"] = escalated_opex
                updates["opex_growth_rate"] = 0.03
                estimate_note = (
                    f"OpEx estimate: source year {opex_source_year} value ${hinted_opex:,.2f}/SF escalated "
                    f"3% YoY to {commencement_year} (${escalated_opex:,.2f}/SF), then 3% YoY thereafter."
                )
                extra_note_lines.append(estimate_note)
                warnings.append(
                    f"OpEx estimated at 3% YoY from {opex_source_year} to {commencement_year}; "
                    "using 3% annual escalation thereafter."
                )

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
            hinted_rent_schedule = extracted_hints.get("rent_schedule")
            if isinstance(hinted_rent_schedule, list) and hinted_rent_schedule:
                normalized_hint: list[dict] = []
                expected = 0
                hint_steps = [s for s in hinted_rent_schedule if isinstance(s, dict)]
                for raw_step in sorted(
                    hint_steps,
                    key=lambda s: (
                        int(_coerce_int_token((s or {}).get("start_month"), 0) or 0),
                        int(_coerce_int_token((s or {}).get("end_month"), 0) or 0),
                    ),
                ):
                    start_m = _coerce_int_token(raw_step.get("start_month"), 0)
                    end_m = _coerce_int_token(raw_step.get("end_month"), start_m)
                    rate = _coerce_float_token(raw_step.get("rent_psf_annual"), 0.0)
                    if start_m is None or end_m is None or rate is None:
                        continue
                    start_m = max(0, int(start_m))
                    end_m = max(start_m, int(end_m))
                    if start_m > expected and normalized_hint:
                        normalized_hint[-1] = {**normalized_hint[-1], "end_month": start_m - 1}
                    if start_m < expected:
                        start_m = expected
                    if end_m < start_m:
                        end_m = start_m
                    normalized_hint.append(
                        {
                            "start_month": start_m,
                            "end_month": end_m,
                            "rent_psf_annual": max(0.0, float(rate)),
                        }
                    )
                    expected = end_m + 1

                if normalized_hint:
                    if target_term_months > 0:
                        target_end = max(0, target_term_months - 1)
                        normalized_hint = [s for s in normalized_hint if int(s["start_month"]) <= target_end]
                        if normalized_hint:
                            normalized_hint[-1] = {
                                **normalized_hint[-1],
                                "end_month": target_end,
                            }
                    current_rent_schedule = updates.get("rent_schedule", canonical.rent_schedule) or []
                    current_rates: set[float] = set()
                    for step in current_rent_schedule:
                        if isinstance(step, dict):
                            current_rates.add(round(_coerce_float_token(step.get("rent_psf_annual"), 0.0) or 0.0, 4))
                        else:
                            current_rates.add(round(float(getattr(step, "rent_psf_annual", 0.0) or 0.0), 4))
                    hinted_rates = {round(float(s["rent_psf_annual"]), 4) for s in normalized_hint}

                    should_override_rent = False
                    if not current_rent_schedule:
                        should_override_rent = True
                    elif len(current_rent_schedule) == 1 and len(normalized_hint) > 1:
                        should_override_rent = True
                    elif len(current_rates) <= 1 and len(hinted_rates) > len(current_rates) and len(normalized_hint) > 1:
                        should_override_rent = True
                    elif len(current_rent_schedule) == 1:
                        only = next(iter(current_rates), 0.0)
                        if abs(float(only) - 0.0) < 0.01 and len(normalized_hint) >= 1:
                            should_override_rent = True

                    if should_override_rent:
                        updates["rent_schedule"] = [RentScheduleStep(**step) for step in normalized_hint]
                        warnings.append("Rent schedule extracted from phased rent terms in the uploaded document.")
            phase_schedule_hint = extracted_hints.get("phase_in_schedule")
            if isinstance(phase_schedule_hint, list) and phase_schedule_hint:
                normalized_phase = []
                for step in phase_schedule_hint:
                    if not isinstance(step, dict):
                        continue
                    start_m = _coerce_int_token(step.get("start_month"), 0)
                    end_m = _coerce_int_token(step.get("end_month"), start_m)
                    rsf_m = _coerce_float_token(step.get("rsf"), 0.0)
                    if end_m < start_m or rsf_m <= 0:
                        continue
                    normalized_phase.append(
                        {
                            "start_month": start_m,
                            "end_month": end_m,
                            "rsf": rsf_m,
                        }
                    )
                if normalized_phase:
                    updates["phase_in_schedule"] = [PhaseInStep(**step) for step in normalized_phase]
                    max_phase_rsf = max(float(s["rsf"]) for s in normalized_phase)
                    if _should_override_rsf(
                        _coerce_float_token(updates.get("rsf", canonical.rsf), 0.0),
                        max_phase_rsf,
                        10,
                        rsf_conf,
                    ):
                        updates["rsf"] = max_phase_rsf
                    if target_term_months <= 0:
                        updates["term_months"] = int(normalized_phase[-1]["end_month"]) + 1
                    warnings.append("Phase-in occupancy schedule detected and applied to monthly calculations.")
            effective_term = _coerce_int_token(
                updates.get("term_months"),
                _coerce_int_token(canonical.term_months, 0),
            ) or 0
            effective_rent = updates.get("rent_schedule", canonical.rent_schedule) or []
            effective_phase = updates.get("phase_in_schedule", canonical.phase_in_schedule) or []
            effective_free_periods = updates.get("free_rent_periods", canonical.free_rent_periods) or []
            if (
                not effective_free_periods
                and _coerce_int_token(updates.get("free_rent_months"), _coerce_int_token(canonical.free_rent_months, 0))
            ):
                free_months = _coerce_int_token(
                    updates.get("free_rent_months"),
                    _coerce_int_token(canonical.free_rent_months, 0),
                ) or 0
                if free_months > 0:
                    free_start = _coerce_int_token(updates.get("free_rent_start_month"), 0) or 0
                    free_end = max(free_start, free_start + free_months - 1)
                    if effective_term > 0:
                        free_end = min(free_end, max(0, effective_term - 1))
                    effective_free_periods = [FreeRentPeriod(start_month=free_start, end_month=free_end)]

            segmented_rent = _split_rent_schedule_by_boundaries(
                rent_schedule=list(effective_rent),
                term_months=int(effective_term),
                phase_in_schedule=list(effective_phase),
                free_rent_periods=list(effective_free_periods),
                commencement_date=updates.get("commencement_date", canonical.commencement_date),
            )
            if segmented_rent and not _rent_schedule_rows_equal(segmented_rent, list(effective_rent)):
                updates["rent_schedule"] = [RentScheduleStep(**step) for step in segmented_rent]
            if note_highlights:
                updates["notes"] = " | ".join(note_highlights)[:1600]
            elif text.strip() and not (canonical.notes or "").strip():
                updates["notes"] = (
                    "No ROFR/ROFO/renewal/OpEx-exclusion clauses were confidently detected. "
                    "Review lease clauses manually."
                )
            if extra_note_lines:
                existing_notes = str(updates.get("notes") or canonical.notes or "").strip()
                for line in extra_note_lines:
                    if not line or line in existing_notes:
                        continue
                    existing_notes = f"{existing_notes} | {line}".strip(" |") if existing_notes else line
                updates["notes"] = existing_notes[:1600]
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
        extraction_summary = _build_extraction_summary(
            text=extraction_text_for_summary,
            filename=extraction_filename_for_summary,
            canonical=canonical,
            missing_fields=missing,
            warnings=warnings,
        )
        doc_type = str(extraction_summary.get("document_type_detected") or "unknown")
        doc_type_note = f"Document type detected: {doc_type}."
        if not any("document type detected:" in str(w).lower() for w in warnings):
            warnings.insert(0, doc_type_note)
        return (
            NormalizerResponse(
                canonical_lease=canonical,
                confidence_score=min(1.0, confidence_score),
                field_confidence=field_confidence,
                missing_fields=missing,
                clarification_questions=questions,
                warnings=warnings,
                extraction_summary=extraction_summary,
            ),
            not used_fallback,
        )

    if source_upper == "PASTED_TEXT":
        raw = (pasted_text or payload or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="pasted_text or payload required for PASTED_TEXT")
        extraction_text_for_summary = raw
        extraction_filename_for_summary = "pasted_text.txt"
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
        extraction_summary = _build_extraction_summary(
            text=extraction_text_for_summary,
            filename=extraction_filename_for_summary,
            canonical=canonical,
            missing_fields=missing,
            warnings=warnings,
        )
        doc_type = str(extraction_summary.get("document_type_detected") or "unknown")
        doc_type_note = f"Document type detected: {doc_type}."
        if not any("document type detected:" in str(w).lower() for w in warnings):
            warnings.insert(0, doc_type_note)
        return (
            NormalizerResponse(
                canonical_lease=canonical,
                confidence_score=min(1.0, confidence_score),
                field_confidence=field_confidence,
                missing_fields=missing,
                clarification_questions=questions,
                warnings=warnings,
                extraction_summary=extraction_summary,
            ),
            True,  # used_ai
        )

    # MANUAL or JSON
    raw_payload = (payload or "").strip()
    if not raw_payload:
        raise HTTPException(status_code=400, detail="payload (JSON string) required for MANUAL/JSON")
    extraction_text_for_summary = raw_payload
    extraction_filename_for_summary = "manual.json"
    try:
        data = json.loads(raw_payload)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {e}") from e
    canonical = _dict_to_canonical(data if isinstance(data, dict) else {}, "", "")
    canonical, norm_warnings = normalize_canonical_lease(canonical)
    warnings.extend(norm_warnings)
    confidence_score, missing, questions = _compute_confidence_and_missing(canonical)
    extraction_summary = _build_extraction_summary(
        text=extraction_text_for_summary,
        filename=extraction_filename_for_summary,
        canonical=canonical,
        missing_fields=missing,
        warnings=warnings,
    )
    doc_type = str(extraction_summary.get("document_type_detected") or "unknown")
    doc_type_note = f"Document type detected: {doc_type}."
    if not any("document type detected:" in str(w).lower() for w in warnings):
        warnings.insert(0, doc_type_note)
    return (
        NormalizerResponse(
            canonical_lease=canonical,
            confidence_score=min(1.0, confidence_score),
            field_confidence=field_confidence,
            missing_fields=missing,
            clarification_questions=questions,
            warnings=warnings,
            extraction_summary=extraction_summary,
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
