from __future__ import annotations

import hashlib
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
    """Parse date from strings like 'June 1 2026', 'May 31, 2036', '2026-06-01'."""
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
        if not re.search(r"\d", token) and len(token) > 6:
            return ""
        if re.fullmatch(r"(?i)\d+", token):
            return token.lstrip("0") or token
        return token.upper()
    return ""


def _extract_suite_from_text(text: str) -> str:
    if not text:
        return ""
    suite_patterns = [
        r"(?i)\b(?:suite|ste\.?|unit|space)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\- ]{0,24})",
        r"(?i)\bpremises\s*(?:known as|is|:)?\s*(?:suite|ste\.?)\s*([A-Za-z0-9][A-Za-z0-9\- ]{0,24})",
        r"(?i)\bat\s+suite\s+([A-Za-z0-9][A-Za-z0-9\- ]{0,24})",
        r"(?i)\bfloor\s+([A-Za-z0-9][A-Za-z0-9\-]{0,8})\s+suite\s+([A-Za-z0-9][A-Za-z0-9\-]{0,14})",
    ]
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    search_lines = lines[:220]
    for ln in search_lines:
        for pat in suite_patterns:
            m = re.search(pat, ln)
            if not m:
                continue
            candidate_raw = m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)
            candidate = _normalize_suite_candidate(candidate_raw)
            if candidate:
                return candidate
    return ""


def _looks_like_address(value: str) -> bool:
    v = " ".join((value or "").split()).strip()
    if not v:
        return False
    if re.search(r"\b\d{1,6}\s+[A-Za-z0-9].*\b(?:st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|way|plaza|pkwy|parkway)\b", v, re.I):
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
    v = re.sub(r"(?i)^(?:at|located at|known as)\s+", "", v).strip(" ,.;:-")
    # Keep values that are at least somewhat informative.
    if len(v) < 4:
        return ""
    return v


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


def _extract_lease_hints(text: str, filename: str, rid: str) -> dict:
    """
    Heuristic extraction: RSF (prefer premises/suite, downrank center/total), term dates
    from 'commencing'/'expiring', term_months from dates, suite, address.
    Logs rsf_candidates and term_candidates with rid. Returns dict for merging into canonical.
    """
    hints = {
        "rsf": None,
        "commencement_date": None,
        "expiration_date": None,
        "term_months": None,
        "suite": "",
        "building_name": "",
        "lease_type": None,
    }
    if not text:
        return hints

    # ---- RSF: collect all candidates with snippet and score ----
    rsf_patterns = [
        r"(?i)\b(?:rsf|rentable\s+square\s+feet|rentable\s+area)\b\s*[:#-]?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})",
        r"(?i)(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|r\.?s\.?f\.?|rentable\s+square\s+feet|square\s*feet|sf)\b",
    ]
    rsf_candidates: list[dict] = []
    for pat in rsf_patterns:
        for m in re.finditer(pat, text):
            value = _parse_number_token(m.group(1))
            if value is None or not (100 <= value <= 2_000_000):
                continue
            start = max(0, m.start() - 120)
            end = min(len(text), m.end() + 120)
            snippet = text[start:end].replace("\n", " ").strip()
            score = 0
            low = snippet.lower()
            if any(k in low for k in ("premises", "suite", "rentable square feet", "rentable area", " at ")):
                score += 2
            if any(k in low for k in ("shopping center", "center contains", "total rsf", "entire center", "total square feet", "whole center")):
                score -= 2
            rsf_candidates.append({"value": value, "snippet": snippet[:200], "score": score})

    chosen_rsf = None
    if rsf_candidates:
        # Dedupe by value, keep max score per value
        by_val: dict[float, dict] = {}
        for c in rsf_candidates:
            v = c["value"]
            if v not in by_val or c["score"] > by_val[v]["score"]:
                by_val[v] = c
        candidates_sorted = sorted(by_val.values(), key=lambda x: (-x["score"], x["value"]))
        chosen_rsf = candidates_sorted[0]["value"]
        hints["rsf"] = chosen_rsf
        _LOG.info(
            "NORMALIZE_RSF_CANDIDATES rid=%s count=%s candidates=%s",
            rid,
            len(candidates_sorted),
            [(c["value"], c["score"], c["snippet"][:80]) for c in candidates_sorted],
        )
        _LOG.info("NORMALIZE_RSF_CHOSEN rid=%s value=%s", rid, chosen_rsf)

    # ---- Term: commencing / expiring (do not use lease "as of" as commencement) ----
    term_candidates: dict[str, Optional[date]] = {"commencement": None, "expiration": None}
    # Commencing June 1 2026 / commencing 2026-06-01
    comm_pats = [
        r"(?i)\bcommenc(?:e|ing)?\s+(\w+\s+\d{1,2},?\s+\d{4})",
        r"(?i)\bcommenc(?:e|ing)?\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})",
        r"(?i)\bterm\s+[^.]*?commenc(?:e|ing)?\s+(\w+\s+\d{1,2},?\s+\d{4})",
    ]
    for pat in comm_pats:
        m = re.search(pat, text)
        if m:
            d = _parse_lease_date(m.group(1))
            if d:
                term_candidates["commencement"] = d
                break
    exp_pats = [
        r"(?i)\bexpir(?:e|ing)?\s+(\w+\s+\d{1,2},?\s+\d{4})",
        r"(?i)\bexpir(?:e|ing)?\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})",
        r"(?i)\bexpir(?:e|ing)?\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
    ]
    for pat in exp_pats:
        m = re.search(pat, text)
        if m:
            d = _parse_lease_date(m.group(1))
            if d:
                term_candidates["expiration"] = d
                break

    if term_candidates["commencement"]:
        hints["commencement_date"] = term_candidates["commencement"]
    if term_candidates["expiration"]:
        hints["expiration_date"] = term_candidates["expiration"]
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
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    head = lines[:120]
    hints["suite"] = _extract_suite_from_text(text)

    # ---- Address / building (includes premises labels and located-at lines) ----
    building_patterns = [
        r"(?i)\b(?:building|property|tower|project)\s*(?:name)?\s*[:#-]\s*([^,;\n]{3,80})",
        r"(?i)\bpremises(?:\s+name)?\s*[:#-]\s*([^\n]{5,120})",
        r"(?i)(?:premises|located at)\s+[^.]*?([A-Za-z0-9][A-Za-z0-9\s,\.\-]{10,80}(?:Texas|TX|California|CA)[^.]*)",
        r"(?i)at\s+suite\s+[A-Za-z0-9\-]+\s*,?\s*([^.\n]{5,80})",
        r"(?i)\bleased\s+premises\s+(?:is|are|shall be)\s*[:#-]?\s*([^\n]{8,120})",
    ]
    for ln in head:
        for pat in building_patterns:
            m = re.search(pat, ln)
            if m:
                candidate = _clean_building_candidate(m.group(1), hints.get("suite", ""))
                if len(candidate) >= 5:
                    hints["building_name"] = candidate
                    break
        if hints["building_name"]:
            break

    # Lease type: "lease type is NNN" / "lease type: Gross"
    lease_type_pat = re.compile(
        r"(?i)\blease\s+type\s*[:\s]+(NNN|Gross|Modified\s+Gross|Absolute\s+NNN|Full\s+Service)\b",
        re.I,
    )
    m = lease_type_pat.search(text)
    if m:
        hints["lease_type"] = re.sub(r"\s+", " ", m.group(1).strip())

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
        return "Automatic extraction failed due to a backend processing issue."
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
    return "Automatic extraction failed due to a backend processing issue."


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

        if text.strip():
            # No try/except: let AI extraction failures propagate (503 from endpoint).
            extraction = extract_scenario_from_text(text, "pdf_text" if fn.endswith(".pdf") else "docx")
            if extraction and extraction.scenario:
                canonical = _scenario_to_canonical(extraction.scenario, "", "")
                field_confidence = _extraction_confidence_to_field_confidence(extraction.confidence)
                confidence_score = min(field_confidence.values()) if field_confidence else 0.78
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
        if canonical and isinstance(canonical, CanonicalLease):
            updates: dict = {}
            # RSF: use heuristic when missing or when heuristic found premises-scoped value (we logged chosen).
            if extracted_hints.get("rsf") is not None:
                if (canonical.rsf or 0) <= 0 or extracted_hints["rsf"] < (canonical.rsf or 0):
                    updates["rsf"] = extracted_hints["rsf"]
            if extracted_hints.get("commencement_date"):
                updates["commencement_date"] = extracted_hints["commencement_date"]
            if extracted_hints.get("expiration_date"):
                updates["expiration_date"] = extracted_hints["expiration_date"]
            if extracted_hints.get("term_months") is not None:
                updates["term_months"] = extracted_hints["term_months"]
            suite_val = str(extracted_hints.get("suite") or canonical.suite or "").strip()
            if not suite_val:
                suite_val = _extract_suite_from_text(str(canonical.premises_name or ""))
            building_val = str(extracted_hints.get("building_name") or "").strip()
            if not building_val:
                building_val = _derive_building_name_from_premises_or_address(
                    premises_name=str(canonical.premises_name or ""),
                    address=str(canonical.address or ""),
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
            if extracted_hints.get("lease_type"):
                updates["lease_type"] = str(extracted_hints["lease_type"])
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
            confidence_score = min(field_confidence.values()) if field_confidence else 0.78
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
        )
    except Exception as e:
        print(f"[report] PDF generation failed: {e!s}")
        raise HTTPException(
            status_code=500,
            detail=f"PDF generation failed: {e!s}. Use POST /report/preview to get HTML instead.",
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
            page.wait_for_timeout(1500)  # allow charts to render
            pdf_bytes = page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "0.5in", "bottom": "0.5in", "left": "0.5in", "right": "0.5in"},
            )
            browser.close()
    except Exception as e:
        # Fallback: generate report PDF directly from stored first scenario.
        try:
            entries = data.get("scenarios") if isinstance(data, dict) else None
            if not isinstance(entries, list) or not entries:
                raise ValueError("No scenarios in stored report payload.")
            first = entries[0] if isinstance(entries[0], dict) else {}
            scenario_raw = first.get("scenario")
            result_raw = first.get("result")
            if not isinstance(scenario_raw, dict) or not isinstance(result_raw, dict):
                raise ValueError("Invalid stored report payload shape.")
            scenario = Scenario.model_validate(scenario_raw)
            compute_result = CashflowResult.model_validate(result_raw)
            brand = get_brand("default")
            if brand is None:
                raise ValueError("Default brand not found.")
            from reporting.report_builder import build_report_pdf
            pdf_bytes = build_report_pdf(scenario, compute_result, brand, meta={})
        except Exception as fallback_err:
            raise HTTPException(
                status_code=500,
                detail=f"Deck PDF failed via URL ({e!s}) and direct fallback ({fallback_err!s}).",
            ) from fallback_err

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
