from __future__ import annotations

import hashlib
import json
import os
import re
import time
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend directory so OPENAI_API_KEY etc. are available
load_dotenv(Path(__file__).resolve().parent / ".env")

from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, HTMLResponse

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

REPORT_BASE_URL = os.environ.get("REPORT_BASE_URL", "http://localhost:3000")

app = FastAPI(title="Lease Deck Backend", version="0.1.0")

# Production origins for frontend; dev regex for localhost
_cors_origins = [
    "https://thecremodel.com",
    "https://www.thecremodel.com",
]
# Add Vercel preview/production if set
_vercel_url = os.environ.get("VERCEL_URL")
if _vercel_url:
    _cors_origins.append(f"https://{_vercel_url}")
    _cors_origins.append(f"https://www.{_vercel_url}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.include_router(webhooks_router)


@app.on_event("startup")
def startup_log() -> None:
    import logging
    port = os.environ.get("PORT", "8010")
    host = os.environ.get("HOST", "127.0.0.1")
    has_openai = bool(os.environ.get("OPENAI_API_KEY", "").strip())
    logging.getLogger("uvicorn.error").info(
        f"Backend starting on http://{host}:{port} (OPENAI_API_KEY configured: {has_openai})"
    )
    if not has_openai:
        logging.getLogger("uvicorn.error").warning(
            "OPENAI_API_KEY is not set. Extraction and AI features will not work."
        )
    print("Backend ready on http://127.0.0.1:8010", flush=True)
    if get_cached_extraction.__module__ == __name__:
        logging.getLogger("uvicorn.error").warning(
            "cache.disk_cache module not importable in runtime image; running with in-memory/no-op cache."
        )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


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


@app.post("/compute-canonical", response_model=CanonicalComputeResponse)
def compute_canonical_endpoint(lease: CanonicalLease) -> CanonicalComputeResponse:
    """
    Canonical compute: normalize CanonicalLease, run engine, return monthly/annual rows and metrics.
    Single source of truth for calculations and exports.
    """
    return compute_canonical(lease)


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


def _extract_fallback_lease_hints(text: str, filename: str) -> dict:
    """
    Best-effort hints for fallback review mode. Keeps extraction resilient when AI/OCR fails.
    Returns: rsf (float|None), building_name (str), suite (str).
    """
    hints = {"rsf": None, "building_name": "", "suite": ""}
    if not text:
        return hints

    # RSF is usually explicit in leases. Prefer values near RSF/SF keywords.
    rsf_patterns = [
        r"(?i)\b(?:rsf|rentable\s+square\s+feet|rentable\s+area)\b\s*[:#-]?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})",
        r"(?i)(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|r\.?s\.?f\.?|rentable\s+square\s+feet|square\s*feet|sf)\b",
    ]
    for pat in rsf_patterns:
        m = re.search(pat, text)
        if not m:
            continue
        value = _parse_number_token(m.group(1))
        if value is not None and 100 <= value <= 2_000_000:
            hints["rsf"] = value
            break

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    head = lines[:80]

    suite_patterns = [
        r"(?i)\b(?:suite|ste\.?|unit|space|premises)\b\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\- ]{0,40})",
    ]
    for ln in head:
        for pat in suite_patterns:
            m = re.search(pat, ln)
            if m:
                hints["suite"] = m.group(1).strip(" ,.-")
                break
        if hints["suite"]:
            break

    building_patterns = [
        r"(?i)\b(?:building|property|tower|project)\s*(?:name)?\s*[:#-]\s*([^,;\n]{3,80})",
    ]
    for ln in head:
        for pat in building_patterns:
            m = re.search(pat, ln)
            if m:
                hints["building_name"] = m.group(1).strip(" ,.-")
                break
        if hints["building_name"]:
            break

    # If a labeled building line wasn't found, fallback to filename stem as a practical default.
    if not hints["building_name"]:
        stem = Path(filename or "").stem.strip()
        if stem:
            hints["building_name"] = re.sub(r"[_\-]+", " ", stem)

    return hints


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

        extracted_hints = _extract_fallback_lease_hints(text, file.filename or "")

        if text.strip():
            try:
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
            except Exception as e:
                canonical = _dict_to_canonical({}, "", "")
                confidence_score = 0.4
                used_fallback = True
                warnings.append("Automatic extraction failed. We loaded a review template so you can continue.")
                warnings.append(_safe_extraction_warning(e))
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

        # Enrich fallback/manual review with deterministic hints that are usually present in leases.
        if canonical and isinstance(canonical, CanonicalLease):
            updates: dict = {}
            if (canonical.rsf or 0) <= 0 and extracted_hints.get("rsf"):
                updates["rsf"] = extracted_hints["rsf"]
            if extracted_hints.get("building_name") and not (canonical.address or "").strip():
                updates["address"] = str(extracted_hints["building_name"])
            if extracted_hints.get("suite") and not (canonical.premises_name or "").strip():
                updates["premises_name"] = str(extracted_hints["suite"])
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
        return NormalizerResponse(
            canonical_lease=canonical,
            confidence_score=min(1.0, confidence_score),
            field_confidence=field_confidence,
            missing_fields=missing,
            clarification_questions=questions,
            warnings=warnings,
        )

    if source_upper == "PASTED_TEXT":
        raw = (pasted_text or payload or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="pasted_text or payload required for PASTED_TEXT")
        try:
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
        except Exception as e:
            canonical = _dict_to_canonical({}, "", "")
            confidence_score = 0.4
            missing = ["lease_details"]
            questions = ["We could not parse the pasted text. Please check and try again or enter manually."]
        return NormalizerResponse(
            canonical_lease=canonical,
            confidence_score=min(1.0, confidence_score),
            field_confidence=field_confidence,
            missing_fields=missing,
            clarification_questions=questions,
            warnings=warnings,
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
    return NormalizerResponse(
        canonical_lease=canonical,
        confidence_score=min(1.0, confidence_score),
        field_confidence=field_confidence,
        missing_fields=missing,
        clarification_questions=questions,
        warnings=warnings,
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

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(url, wait_until="networkidle", timeout=30000)
        page.emulate_media(media="print")
        page.wait_for_timeout(1500)  # allow charts to render
        pdf_bytes = page.pdf(format="A4", print_background=True, margin={"top": "0.5in", "bottom": "0.5in", "left": "0.5in", "right": "0.5in"})
        browser.close()

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
