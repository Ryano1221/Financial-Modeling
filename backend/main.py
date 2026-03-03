from __future__ import annotations

import base64
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
from datetime import date, datetime, timedelta
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from dotenv import load_dotenv

# Load .env from backend directory so OPENAI_API_KEY etc. are available
load_dotenv(Path(__file__).resolve().parent / ".env")

from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, HTMLResponse, JSONResponse
from pydantic import BaseModel
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
    ParkingAbatementPeriod,
    PhaseInStep,
    ReportRequest,
    RentScheduleStep,
    Scenario,
)
from engine.canonical_compute import compute_canonical, normalize_canonical_lease
from scenario_extract import (
    extract_text_from_pdf,
    extract_text_from_pdf_with_ocr,
    extract_text_from_word,
    extract_scenario_from_text,
    extract_prefill_hints,
    text_quality_requires_ocr,
)
from reports_store import load_report, save_report, REPORTS_DIR
from routes.api import router as api_router
try:
    from routes.extract_lease import build_extract_response
except Exception:  # noqa: BLE001
    # Keep startup resilient if optional extraction route module is missing in a deploy image.
    def build_extract_response(*, file_bytes: bytes, filename: str, content_type: str, canonical_lease: CanonicalLease | None = None):
        raise RuntimeError("optional routes.extract_lease module unavailable")
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
        get_cached_report_deck,
        set_cached_report_deck,
    )
except ModuleNotFoundError:
    try:
        from backend.cache.disk_cache import (
            get_cached_extraction,
            set_cached_extraction,
            get_cached_report,
            set_cached_report,
            get_cached_report_deck,
            set_cached_report_deck,
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

        def get_cached_report_deck(*args, **kwargs):
            return None

        def set_cached_report_deck(*args, **kwargs) -> None:
            return None

print("BOOT_VERSION", "health_v_2026_02_16_2055", flush=True)

REPORT_BASE_URL = os.environ.get(
    "REPORT_BASE_URL",
    "https://thecremodel.com" if os.environ.get("RENDER") else "http://localhost:3000",
)

# Version for /health and BOOT log (Render sets RENDER_GIT_COMMIT)
VERSION = (os.environ.get("RENDER_GIT_COMMIT") or "").strip() or "unknown"
PUBLIC_BRANDING_ORG_ID = "public"
PUBLIC_BRANDING_MAX_LOGO_BYTES = 1_500_000
PUBLIC_BRANDING_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml"}
MAX_EXTRACT_UPLOAD_BYTES = int(os.environ.get("MAX_EXTRACT_UPLOAD_BYTES", str(15 * 1024 * 1024)))
MAX_NORMALIZE_UPLOAD_BYTES = int(os.environ.get("MAX_NORMALIZE_UPLOAD_BYTES", str(20 * 1024 * 1024)))
MAX_UPLOAD_LEASE_BYTES = int(os.environ.get("MAX_UPLOAD_LEASE_BYTES", str(15 * 1024 * 1024)))
MAX_EXTRACTION_ARTIFACTS_BYTES = int(os.environ.get("MAX_EXTRACTION_ARTIFACTS_BYTES", str(8 * 1024 * 1024)))
SAFE_OCR_MAX_PAGES = int(os.environ.get("SAFE_OCR_MAX_PAGES", "3"))
SKIP_OCR_ABOVE_BYTES = int(os.environ.get("SKIP_OCR_ABOVE_BYTES", str(8 * 1024 * 1024)))
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().rstrip("/")
SUPABASE_ANON_KEY = (os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "").strip()
SUPABASE_SERVICE_ROLE_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
SUPABASE_LOGOS_BUCKET = (os.environ.get("SUPABASE_LOGOS_BUCKET") or "logos").strip() or "logos"
DEFAULT_CREMODEL_BRAND_NAME = "The CRE Model"


def _public_branding_path() -> Path:
    configured = (os.environ.get("PUBLIC_BRANDING_PATH") or "").strip()
    if configured:
        return Path(configured)
    return REPORTS_DIR / "public_branding.json"


def _load_public_branding_state() -> dict[str, str | None]:
    path = _public_branding_path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        "logo_content_type": str(raw.get("logo_content_type") or "").strip() or None,
        "logo_filename": str(raw.get("logo_filename") or "").strip() or None,
        "logo_asset_bytes": str(raw.get("logo_asset_bytes") or "").strip() or None,
        "logo_sha256": str(raw.get("logo_sha256") or "").strip() or None,
        "logo_updated_at": str(raw.get("logo_updated_at") or "").strip() or None,
    }


def _save_public_branding_state(state: dict[str, str | None]) -> None:
    path = _public_branding_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _public_branding_payload() -> dict[str, str | bool | None]:
    state = _load_public_branding_state()
    logo_b64 = (state.get("logo_asset_bytes") or "").strip()
    content_type = (state.get("logo_content_type") or "image/png").strip() or "image/png"
    has_logo = bool(logo_b64)
    return {
        "organization_id": PUBLIC_BRANDING_ORG_ID,
        "has_logo": has_logo,
        "logo_content_type": content_type if has_logo else None,
        "logo_filename": state.get("logo_filename") if has_logo else None,
        "logo_data_url": f"data:{content_type};base64,{logo_b64}" if has_logo else None,
        "logo_asset_bytes": logo_b64 if has_logo else None,
        "theme_hash": state.get("logo_sha256") if has_logo else None,
        "logo_updated_at": state.get("logo_updated_at") if has_logo else None,
    }


class UserSettingsUpdateRequest(BaseModel):
    brokerage_name: Optional[str] = None


class ContactSubmissionRequest(BaseModel):
    name: str
    email: str
    message: str


def _validate_contact_submission(body: ContactSubmissionRequest) -> tuple[str, str, str]:
    name = str(body.name or "").strip()
    email = str(body.email or "").strip().lower()
    message = str(body.message or "").strip()

    if len(name) < 2 or len(name) > 120:
        raise HTTPException(status_code=400, detail="Name must be between 2 and 120 characters.")
    if len(email) < 5 or len(email) > 320:
        raise HTTPException(status_code=400, detail="Email must be between 5 and 320 characters.")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]{2,}", email):
        raise HTTPException(status_code=400, detail="Email format is invalid.")
    if len(message) < 10 or len(message) > 5000:
        raise HTTPException(status_code=400, detail="Message must be between 10 and 5000 characters.")

    return name, email, message


def _mask_email(value: str) -> str:
    email = (value or "").strip()
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if len(local) <= 1:
        masked_local = "*"
    elif len(local) == 2:
        masked_local = f"{local[0]}*"
    else:
        masked_local = f"{local[0]}***{local[-1]}"
    return f"{masked_local}@{domain}"


def _supabase_configured(require_service: bool = False) -> None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=503,
            detail="Supabase is not configured on backend (SUPABASE_URL / SUPABASE_ANON_KEY missing).",
        )
    if require_service and not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=503,
            detail="Supabase service role is not configured on backend.",
        )


def _extract_bearer_token(request: Request) -> str:
    raw = (request.headers.get("authorization") or "").strip()
    if not raw.lower().startswith("bearer "):
        return ""
    return raw.split(" ", 1)[1].strip()


def _http_json_request(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[dict[str, str]] = None,
    payload: Optional[dict] = None,
    timeout: float = 20.0,
) -> tuple[int, dict | list | None]:
    body = None
    req_headers: dict[str, str] = {"accept": "application/json"}
    if headers:
        req_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("content-type", "application/json")
    req = urllib_request.Request(url=url, data=body, headers=req_headers, method=method.upper())
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            status = int(resp.getcode() or 200)
            text = resp.read().decode("utf-8", errors="ignore")
    except urllib_error.HTTPError as e:
        status = int(e.code or 500)
        text = e.read().decode("utf-8", errors="ignore")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Supabase request failed: {e}") from e
    if not text.strip():
        return status, None
    try:
        return status, json.loads(text)
    except Exception:
        return status, {"raw": text}


def _http_bytes_request(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[dict[str, str]] = None,
    body: bytes | None = None,
    timeout: float = 20.0,
) -> tuple[int, bytes]:
    req_headers = dict(headers or {})
    req = urllib_request.Request(url=url, data=body, headers=req_headers, method=method.upper())
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            return int(resp.getcode() or 200), resp.read()
    except urllib_error.HTTPError as e:
        return int(e.code or 500), e.read()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Supabase request failed: {e}") from e


def _require_supabase_user(request: Request) -> dict[str, str]:
    _supabase_configured(require_service=False)
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    status, payload = _http_json_request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "authorization": f"Bearer {token}",
        },
    )
    data = payload if isinstance(payload, dict) else {}
    user_id = str(data.get("id") or "").strip()
    if status != 200 or not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired auth token")
    return {
        "id": user_id,
        "email": str(data.get("email") or "").strip(),
    }


def _try_supabase_user(request: Request) -> dict[str, str] | None:
    try:
        return _require_supabase_user(request)
    except HTTPException as exc:
        if exc.status_code == 401:
            logging.getLogger("uvicorn.error").info("auth_fallback_to_default reason=unauthenticated")
            return None
        raise


def _admin_headers() -> dict[str, str]:
    _supabase_configured(require_service=True)
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }


def _load_user_settings_with_presence(user_id: str) -> tuple[dict[str, str], bool]:
    encoded_user = urllib_parse.quote(user_id, safe="")
    status, payload = _http_json_request(
        (
            f"{SUPABASE_URL}/rest/v1/user_settings"
            f"?select=user_id,brokerage_name,brokerage_logo_url,created_at,updated_at"
            f"&user_id=eq.{encoded_user}"
        ),
        headers=_admin_headers(),
    )
    if status >= 400:
        raise HTTPException(status_code=503, detail="Failed to load user settings from Supabase")
    rows = payload if isinstance(payload, list) else []
    row_found = bool(rows)
    row = rows[0] if rows else {}
    if not isinstance(row, dict):
        row = {}
    settings = {
        "user_id": user_id,
        "brokerage_name": str(row.get("brokerage_name") or "").strip(),
        "brokerage_logo_url": str(row.get("brokerage_logo_url") or "").strip(),
        "created_at": str(row.get("created_at") or "").strip(),
        "updated_at": str(row.get("updated_at") or "").strip(),
    }
    return settings, row_found


def _load_user_settings(user_id: str) -> dict[str, str]:
    settings, _ = _load_user_settings_with_presence(user_id)
    return settings


def _upsert_user_settings(user_id: str, *, brokerage_name: Optional[str], brokerage_logo_url: Optional[str]) -> dict[str, str]:
    existing = _load_user_settings(user_id)
    payload = {
        "user_id": user_id,
        "brokerage_name": (brokerage_name if brokerage_name is not None else existing.get("brokerage_name") or "").strip() or None,
        "brokerage_logo_url": (brokerage_logo_url if brokerage_logo_url is not None else existing.get("brokerage_logo_url") or "").strip() or None,
    }
    status, _ = _http_json_request(
        f"{SUPABASE_URL}/rest/v1/user_settings",
        method="POST",
        headers={
            **_admin_headers(),
            "prefer": "resolution=merge-duplicates,return=representation",
        },
        payload=payload,
    )
    if status >= 400:
        raise HTTPException(status_code=503, detail="Failed to save user settings to Supabase")
    return _load_user_settings(user_id)


def _guess_extension(content_type: str, filename: str) -> str:
    ct = (content_type or "").lower().strip()
    fn = (filename or "").lower().strip()
    if ct == "image/png" or fn.endswith(".png"):
        return ".png"
    if ct in {"image/jpeg", "image/jpg"} or fn.endswith(".jpg") or fn.endswith(".jpeg"):
        return ".jpg"
    if ct == "image/svg+xml" or fn.endswith(".svg"):
        return ".svg"
    return ".png"


def _storage_upload_logo(user_id: str, filename: str, content_type: str, data: bytes) -> str:
    ext = _guess_extension(content_type, filename)
    object_path = f"logos/{user_id}/brokerage{ext}"
    encoded = urllib_parse.quote(object_path, safe="/")
    status, body = _http_bytes_request(
        f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_LOGOS_BUCKET}/{encoded}",
        method="POST",
        headers={
            **_admin_headers(),
            "content-type": content_type,
            "x-upsert": "true",
        },
        body=data,
        timeout=30.0,
    )
    if status >= 400:
        msg = body.decode("utf-8", errors="ignore")[:300]
        raise HTTPException(status_code=503, detail=f"Failed to upload logo to Supabase storage: {msg}")
    return object_path


def _storage_delete_logo(object_path: str) -> None:
    clean = (object_path or "").strip().lstrip("/")
    if not clean:
        return
    encoded = urllib_parse.quote(clean, safe="/")
    status, _ = _http_bytes_request(
        f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_LOGOS_BUCKET}/{encoded}",
        method="DELETE",
        headers=_admin_headers(),
    )
    if status not in (200, 204, 404):
        raise HTTPException(status_code=503, detail="Failed to delete logo from Supabase storage")


def _storage_signed_logo_url(object_path: str, expires_seconds: int = 3600) -> str | None:
    clean = (object_path or "").strip().lstrip("/")
    if not clean:
        return None
    encoded = urllib_parse.quote(clean, safe="/")
    status, payload = _http_json_request(
        f"{SUPABASE_URL}/storage/v1/object/sign/{SUPABASE_LOGOS_BUCKET}/{encoded}",
        method="POST",
        headers=_admin_headers(),
        payload={"expiresIn": max(60, int(expires_seconds))},
    )
    if status >= 400 or not isinstance(payload, dict):
        return None
    signed_path = str(payload.get("signedURL") or "").strip()
    if not signed_path:
        return None
    if signed_path.startswith("http://") or signed_path.startswith("https://"):
        return signed_path
    return f"{SUPABASE_URL}/storage/v1{signed_path}"


def _storage_download_logo_bytes(object_path: str) -> tuple[bytes | None, str | None]:
    clean = (object_path or "").strip().lstrip("/")
    if not clean:
        return None, None
    encoded = urllib_parse.quote(clean, safe="/")
    status, body = _http_bytes_request(
        f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_LOGOS_BUCKET}/{encoded}",
        method="GET",
        headers=_admin_headers(),
        timeout=30.0,
    )
    if status >= 400 or not body:
        return None, None
    content_type = "image/png"
    if clean.lower().endswith(".svg"):
        content_type = "image/svg+xml"
    elif clean.lower().endswith(".jpg") or clean.lower().endswith(".jpeg"):
        content_type = "image/jpeg"
    return body, content_type


@lru_cache(maxsize=1)
def _load_default_brokerage_logo_bytes() -> tuple[bytes | None, str | None]:
    base = Path(__file__).resolve().parents[1]
    candidates = [
        base / "frontend" / "public" / "brand" / "logo.svg",
        base / "frontend" / "public" / "logo.svg",
        base / "frontend" / "public" / "logo.png",
    ]
    for path in candidates:
        try:
            if not path.exists() or not path.is_file():
                continue
            raw = path.read_bytes()
            if not raw:
                continue
            suffix = path.suffix.lower()
            if suffix == ".svg":
                return raw, "image/svg+xml"
            if suffix in {".jpg", ".jpeg"}:
                return raw, "image/jpeg"
            return raw, "image/png"
        except Exception:
            continue
    return None, None


def _resolve_branding(request: Request, user: dict[str, str] | None = None) -> dict[str, str | bytes | None]:
    user = user or _try_supabase_user(request)
    default_logo_bytes, default_logo_content_type = _load_default_brokerage_logo_bytes()
    auth_present = bool(user)
    row_found = False
    logo_url_present = False

    if not user:
        resolved = {
            "user_id": None,
            "auth_present": "false",
            "user_settings_row_found": "false",
            "brokerage_logo_url_present": "false",
            "source": "default",
            "brokerage_name": DEFAULT_CREMODEL_BRAND_NAME,
            "logo_bytes": default_logo_bytes,
            "logo_content_type": default_logo_content_type,
            "logo_storage_path": None,
        }
    else:
        settings, row_found = _load_user_settings_with_presence(user["id"])
        brokerage_name = str(settings.get("brokerage_name") or "").strip() or DEFAULT_CREMODEL_BRAND_NAME
        logo_path = str(settings.get("brokerage_logo_url") or "").strip()
        logo_url_present = bool(logo_path)
        logo_bytes, logo_content_type = (None, None)
        source = "default"
        if logo_path:
            logo_bytes, logo_content_type = _storage_download_logo_bytes(logo_path)
            if logo_bytes:
                source = "user_settings"
        if not logo_bytes:
            logo_bytes = default_logo_bytes
            logo_content_type = default_logo_content_type
        resolved = {
            "user_id": user["id"],
            "auth_present": "true",
            "user_settings_row_found": "true" if row_found else "false",
            "brokerage_logo_url_present": "true" if logo_url_present else "false",
            "source": source,
            "brokerage_name": brokerage_name,
            "logo_bytes": logo_bytes,
            "logo_content_type": logo_content_type,
            "logo_storage_path": logo_path or None,
        }

    logging.getLogger("uvicorn.error").info(
        "branding_resolver auth_present=%s user_id=%s user_settings_row_found=%s brokerage_logo_url_present=%s resolved_branding_source=%s logo_bytes_length=%s",
        "true" if auth_present else "false",
        resolved.get("user_id") or "none",
        resolved.get("user_settings_row_found") or "false",
        resolved.get("brokerage_logo_url_present") or "false",
        resolved.get("source"),
        len(resolved.get("logo_bytes") or b""),
    )
    return resolved


def _user_branding_payload(user_id: str, settings: dict[str, str]) -> dict[str, str | bool | None]:
    logo_path = str(settings.get("brokerage_logo_url") or "").strip()
    logo_signed_url = _storage_signed_logo_url(logo_path) if logo_path else None
    logo_bytes, logo_content_type = _storage_download_logo_bytes(logo_path) if logo_path else (None, None)
    logo_b64 = base64.b64encode(logo_bytes).decode("ascii") if logo_bytes else None
    logo_data_url = (
        f"data:{logo_content_type or 'image/png'};base64,{logo_b64}"
        if logo_b64
        else logo_signed_url
    )
    return {
        "organization_id": user_id,
        "brokerage_name": str(settings.get("brokerage_name") or "").strip() or None,
        "has_logo": bool(logo_path and (logo_b64 or logo_signed_url)),
        "logo_filename": logo_path.split("/")[-1] if logo_path else None,
        "logo_content_type": logo_content_type,
        "logo_data_url": logo_data_url,
        "logo_asset_bytes": logo_b64,
        "logo_storage_path": logo_path or None,
        "theme_hash": hashlib.sha256(f"{user_id}:{logo_path}".encode("utf-8")).hexdigest() if logo_path else None,
        "logo_updated_at": settings.get("updated_at") or None,
    }


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


@app.get("/branding")
def get_public_branding(request: Request):
    """
    Backward-compatible alias to authenticated per-user branding.
    """
    user = _require_supabase_user(request)
    settings = _load_user_settings(user["id"])
    return _user_branding_payload(user["id"], settings)


@app.post("/branding/logo")
async def upload_public_branding_logo(request: Request, file: UploadFile = File(...)):
    user = _require_supabase_user(request)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    filename = file.filename.strip()
    filename_lower = filename.lower()
    content_type = (file.content_type or "").lower().strip()
    if content_type not in PUBLIC_BRANDING_ALLOWED_TYPES:
        if filename_lower.endswith(".png"):
            content_type = "image/png"
        elif filename_lower.endswith(".jpg") or filename_lower.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filename_lower.endswith(".svg"):
            content_type = "image/svg+xml"
    if content_type not in PUBLIC_BRANDING_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Logo must be PNG, JPG, or SVG")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > PUBLIC_BRANDING_MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo exceeds 1.5MB")
    object_path = _storage_upload_logo(user["id"], filename, content_type, raw)
    _upsert_user_settings(
        user["id"],
        brokerage_name=None,
        brokerage_logo_url=object_path,
    )
    settings = _load_user_settings(user["id"])
    return _user_branding_payload(user["id"], settings)


@app.delete("/branding/logo")
def delete_public_branding_logo(request: Request):
    user = _require_supabase_user(request)
    settings = _load_user_settings(user["id"])
    object_path = str(settings.get("brokerage_logo_url") or "").strip()
    if object_path:
        _storage_delete_logo(object_path)
    _upsert_user_settings(
        user["id"],
        brokerage_name=None,
        brokerage_logo_url="",
    )
    settings = _load_user_settings(user["id"])
    return _user_branding_payload(user["id"], settings)


@app.get("/auth/me")
def get_auth_me(request: Request):
    user = _require_supabase_user(request)
    return {"user_id": user["id"], "email": user.get("email") or None}


@app.post("/contact")
def submit_contact(body: ContactSubmissionRequest, request: Request):
    """
    Accepts support contact submissions.
    Logs minimal, sanitized metadata only (no raw message body).
    """
    name, email, message = _validate_contact_submission(body)

    message_sha = hashlib.sha256(message.encode("utf-8")).hexdigest()
    forwarded_for = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    source_ip = forwarded_for or (request.client.host if request.client else "")
    user_agent = (request.headers.get("user-agent") or "").strip()[:200]

    logging.getLogger("uvicorn.error").info(
        "CONTACT_SUBMISSION name=%s email=%s message_len=%s message_sha256=%s ip=%s ua=%s",
        name[:120],
        _mask_email(email),
        len(message),
        message_sha,
        source_ip[:64],
        user_agent,
    )
    return {"ok": True, "message": "Thanks for contacting us. We will follow up shortly."}


@app.get("/user-settings/branding")
def get_user_branding(request: Request):
    user = _require_supabase_user(request)
    settings = _load_user_settings(user["id"])
    return _user_branding_payload(user["id"], settings)


@app.patch("/user-settings")
def patch_user_settings(body: UserSettingsUpdateRequest, request: Request):
    user = _require_supabase_user(request)
    settings = _upsert_user_settings(
        user["id"],
        brokerage_name=(body.brokerage_name or "").strip() or None,
        brokerage_logo_url=None,
    )
    return {
        "user_id": user["id"],
        "brokerage_name": settings.get("brokerage_name") or "",
        "brokerage_logo_url": settings.get("brokerage_logo_url") or "",
        "updated_at": settings.get("updated_at") or None,
    }


@app.post("/user-settings/branding/logo")
async def upload_user_branding_logo(request: Request, file: UploadFile = File(...)):
    user = _require_supabase_user(request)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    filename = file.filename.strip()
    content_type = (file.content_type or "").lower().strip()
    if content_type not in PUBLIC_BRANDING_ALLOWED_TYPES:
        _ = _guess_extension(content_type, filename)  # normalize by extension
        if filename.lower().endswith(".png"):
            content_type = "image/png"
        elif filename.lower().endswith(".jpg") or filename.lower().endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filename.lower().endswith(".svg"):
            content_type = "image/svg+xml"
    if content_type not in PUBLIC_BRANDING_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Logo must be PNG, JPG, or SVG")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > PUBLIC_BRANDING_MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo exceeds 1.5MB")

    object_path = _storage_upload_logo(user["id"], filename, content_type, raw)
    _upsert_user_settings(
        user["id"],
        brokerage_name=None,
        brokerage_logo_url=object_path,
    )
    settings = _load_user_settings(user["id"])
    return _user_branding_payload(user["id"], settings)


@app.delete("/user-settings/branding/logo")
def delete_user_branding_logo(request: Request):
    user = _require_supabase_user(request)
    settings = _load_user_settings(user["id"])
    object_path = str(settings.get("brokerage_logo_url") or "").strip()
    if object_path:
        _storage_delete_logo(object_path)
    _upsert_user_settings(
        user["id"],
        brokerage_name=None,
        brokerage_logo_url="",
    )
    settings = _load_user_settings(user["id"])
    return _user_branding_payload(user["id"], settings)


@app.post("/extract", response_model=ExtractionResponse)
def extract_document(
    file: UploadFile = File(...),
    force_ocr: Optional[bool] = Form(None),
    ocr_pages: int = Form(3),
) -> ExtractionResponse:
    """
    Accept PDF, DOCX, or DOC (multipart): extract text. For PDF, OCR runs when forced, or automatically
    when text quality is poor (short text, low alnum ratio, replacement chars, many short lines).
    force_ocr: true = always OCR, false = never OCR, omit = auto. Returns ocr_used and extraction_source.
    ocr_pages: max PDF pages to OCR when OCR runs (default 5).
    """
    filename = file.filename or "(no name)"
    content_type = getattr(file, "content_type", None) or ""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    fn = file.filename.lower()
    if not (fn.endswith(".pdf") or fn.endswith(".docx") or fn.endswith(".doc")):
        raise HTTPException(status_code=400, detail="File must be PDF, DOCX, or DOC")
    try:
        contents = file.file.read()
    except Exception as e:
        print(f"[extract] Failed to read file: {e!s}")
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}") from e
    size = len(contents)
    print(f"[extract] filename={filename!r} content_type={content_type!r} size_bytes={size}")
    if size == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if size > MAX_EXTRACT_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large for extraction ({size} bytes). "
                f"Limit is {MAX_EXTRACT_UPLOAD_BYTES} bytes."
            ),
        )

    size_forces_no_ocr = fn.endswith(".pdf") and size > SKIP_OCR_ABOVE_BYTES and force_ocr is not False
    if size_forces_no_ocr:
        force_ocr = False

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
    ocr_skip_warning: str | None = (
        "OCR was skipped for this large PDF to prevent memory issues; using native PDF text extraction."
        if size_forces_no_ocr
        else None
    )
    try:
        if fn.endswith(".pdf"):
            pages = SAFE_OCR_MAX_PAGES
            try:
                pages = max(1, min(max(1, SAFE_OCR_MAX_PAGES), int(ocr_pages)))
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
            text, source = extract_text_from_word(buf, file.filename or "")
            extraction_source = "text"
            print(f"[extract] path=word source={source!r} text_len={len(text)}")
    except ValueError as e:
        print(f"[extract] ValueError: {e!s}")
        raise HTTPException(status_code=400, detail=str(e))
    except ImportError as e:
        print(f"[extract] ImportError: {e!s}")
        raise HTTPException(
            status_code=503,
            detail=(
                "OCR or Word support not available. Install pdf2image, pytesseract, and poppler (system) "
                "for OCR; python-docx for DOCX; and antiword/catdoc/LibreOffice for DOC."
            ),
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
        if ocr_skip_warning:
            warnings = list(response.warnings or [])
            warnings.append(ocr_skip_warning)
            response = response.model_copy(update={"warnings": warnings})
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
    Accept a PDF/DOCX/DOC lease document, extract text, run LLM extraction, return LeaseExtraction
    with per-field value, confidence, and citation snippet.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    lower_name = file.filename.lower()
    if not (lower_name.endswith(".pdf") or lower_name.endswith(".docx") or lower_name.endswith(".doc")):
        raise HTTPException(status_code=400, detail="File must be a PDF, DOCX, or DOC")
    try:
        contents = file.file.read()
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(contents) > MAX_UPLOAD_LEASE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"File too large for lease upload ({len(contents)} bytes). "
                    f"Limit is {MAX_UPLOAD_LEASE_BYTES} bytes."
                ),
            )
        from io import BytesIO
        return extract_lease(BytesIO(contents), filename=file.filename)
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
    "gross lease": "Gross",
    "modified gross": "Modified Gross",
    "modified_gross": "Modified Gross",
    "gross with stop": "Modified Gross",
    "expense stop": "Modified Gross",
    "base year": "Modified Gross",
    "absolute nnn": "Absolute NNN",
    "absolute_nnn": "Absolute NNN",
    "full service": "Full Service",
    "full_service": "Full Service",
    "full service gross": "Full Service",
    "full-service gross": "Full Service",
    "full service lease": "Full Service",
    "full-service lease": "Full Service",
    "fs": "Full Service",
    "fsg": "Full Service",
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
    s = re.sub(r"(?i)\b(\d{1,2})(st|nd|rd|th)\b", r"\1", s)
    s = re.sub(
        r"(?i)\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
        r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,\s*(\d{1,2})",
        r"\1 \2",
        s,
    )
    s = re.sub(r"\s+", " ", s).strip()
    # ISO
    m = re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if m:
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return date(y, mo, d)
        except ValueError:
            pass
    # US month/day/year with 2-digit year
    m = re.match(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2})$", s)
    if m:
        try:
            mo, d, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
            y = 2000 + yy if yy <= 69 else 1900 + yy
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


def _parking_count_from_ratio_per_1000(parking_ratio: object, rsf: object) -> int:
    ratio_val = max(0.0, _coerce_float_token(parking_ratio, 0.0) or 0.0)
    rsf_val = max(0.0, _coerce_float_token(rsf, 0.0) or 0.0)
    if ratio_val <= 0 or rsf_val <= 0:
        return 0
    return max(0, int(round((ratio_val * rsf_val) / 1000.0)))


def _parking_ratio_per_1000_from_count(parking_count: object, rsf: object) -> float:
    count_val = max(0, _coerce_int_token(parking_count, 0) or 0)
    rsf_val = max(0.0, _coerce_float_token(rsf, 0.0) or 0.0)
    if count_val <= 0 or rsf_val <= 0:
        return 0.0
    return float((float(count_val) * 1000.0) / rsf_val)


def _reconcile_parking_ratio_and_count(
    *,
    parking_ratio: object,
    parking_count: object,
    rsf: object,
    prefer: str = "ratio",
) -> tuple[float, int]:
    ratio_val = max(0.0, _coerce_float_token(parking_ratio, 0.0) or 0.0)
    count_val = max(0, _coerce_int_token(parking_count, 0) or 0)
    rsf_val = max(0.0, _coerce_float_token(rsf, 0.0) or 0.0)
    if rsf_val <= 0:
        return float(ratio_val), int(count_val)

    derived_count = _parking_count_from_ratio_per_1000(ratio_val, rsf_val) if ratio_val > 0 else 0
    derived_ratio = _parking_ratio_per_1000_from_count(count_val, rsf_val) if count_val > 0 else 0.0
    prefer_source = "count" if str(prefer or "").strip().lower() == "count" else "ratio"

    if ratio_val > 0 and count_val <= 0 and derived_count > 0:
        count_val = derived_count
    elif count_val > 0 and ratio_val <= 0 and derived_ratio > 0:
        ratio_val = derived_ratio
    elif ratio_val > 0 and count_val > 0 and derived_count > 0:
        # Allow one-space rounding drift; otherwise force ratio/count to agree.
        if abs(derived_count - count_val) > 1:
            if prefer_source == "count" and derived_ratio > 0:
                ratio_val = derived_ratio
            elif prefer_source == "ratio":
                count_val = derived_count

    return float(ratio_val), int(count_val)


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


def _first_day_of_month(value: date) -> date:
    return date(value.year, value.month, 1)


def _first_day_next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _remaining_obligation_rollforward(
    commencement: Optional[date],
    expiration: Optional[date],
    *,
    analysis_date: Optional[date] = None,
) -> Optional[tuple[date, int, int]]:
    if not isinstance(commencement, date) or not isinstance(expiration, date):
        return None
    anchor = analysis_date or date.today()
    analysis_start = _first_day_of_month(anchor)
    if anchor.day > 1:
        analysis_start = _first_day_next_month(analysis_start)
    if commencement >= analysis_start:
        return None
    if expiration < analysis_start:
        return None
    elapsed_months = max(0, (analysis_start.year - commencement.year) * 12 + (analysis_start.month - commencement.month))
    remaining_term = _month_diff(analysis_start, expiration)
    if remaining_term <= 0:
        return None
    return analysis_start, int(remaining_term), int(elapsed_months)


def _shift_rent_schedule_for_elapsed_months(
    rent_schedule: list,
    *,
    elapsed_months: int,
    remaining_term_months: int,
) -> list[dict]:
    if elapsed_months <= 0 or remaining_term_months <= 0:
        return []
    shifted: list[dict] = []
    max_end = max(0, int(remaining_term_months) - 1)
    for row in rent_schedule or []:
        if isinstance(row, dict):
            start_raw = row.get("start_month")
            end_raw = row.get("end_month")
            rate_raw = row.get("rent_psf_annual")
        else:
            start_raw = getattr(row, "start_month", None)
            end_raw = getattr(row, "end_month", None)
            rate_raw = getattr(row, "rent_psf_annual", None)
        start_i = _coerce_int_token(start_raw, None)
        end_i = _coerce_int_token(end_raw, start_i)
        rate = _coerce_float_token(rate_raw, 0.0)
        if start_i is None or end_i is None:
            continue
        if end_i < elapsed_months:
            continue
        new_start = max(0, int(start_i) - elapsed_months)
        new_end = min(max_end, int(end_i) - elapsed_months)
        if new_end < new_start:
            continue
        shifted.append(
            {
                "start_month": int(new_start),
                "end_month": int(new_end),
                "rent_psf_annual": max(0.0, float(rate)),
            }
        )
    if not shifted:
        return []
    shifted.sort(key=lambda item: (int(item["start_month"]), int(item["end_month"]), float(item["rent_psf_annual"])))
    merged: list[dict] = []
    for row in shifted:
        if not merged:
            merged.append(row)
            continue
        prev = merged[-1]
        prev_rate = round(float(prev["rent_psf_annual"]), 6)
        row_rate = round(float(row["rent_psf_annual"]), 6)
        if int(row["start_month"]) <= int(prev["end_month"]) + 1 and prev_rate == row_rate:
            prev["end_month"] = max(int(prev["end_month"]), int(row["end_month"]))
            continue
        if int(row["start_month"]) <= int(prev["end_month"]):
            row = {**row, "start_month": int(prev["end_month"]) + 1}
            if int(row["start_month"]) > int(row["end_month"]):
                continue
        merged.append(row)
    if merged and int(merged[-1]["end_month"]) < max_end:
        merged[-1] = {**merged[-1], "end_month": max_end}
    return merged


def _shift_abatement_periods_for_elapsed_months(
    periods: list,
    *,
    elapsed_months: int,
    remaining_term_months: int,
    include_scope: bool,
    fallback_scope: str = "base",
) -> list[dict]:
    if elapsed_months <= 0 or remaining_term_months <= 0:
        return []
    out: list[dict] = []
    max_end = max(0, int(remaining_term_months) - 1)
    for period in periods or []:
        if isinstance(period, dict):
            start_raw = period.get("start_month")
            end_raw = period.get("end_month")
            scope_raw = period.get("scope", fallback_scope)
        else:
            start_raw = getattr(period, "start_month", None)
            end_raw = getattr(period, "end_month", None)
            scope_raw = getattr(period, "scope", fallback_scope)
        start_i = _coerce_int_token(start_raw, None)
        end_i = _coerce_int_token(end_raw, start_i)
        if start_i is None or end_i is None:
            continue
        if end_i < elapsed_months:
            continue
        new_start = max(0, int(start_i) - elapsed_months)
        new_end = min(max_end, int(end_i) - elapsed_months)
        if new_end < new_start:
            continue
        row = {"start_month": int(new_start), "end_month": int(new_end)}
        if include_scope:
            scope = str(scope_raw or fallback_scope).strip().lower()
            if scope not in {"base", "gross"}:
                scope = fallback_scope
            row["scope"] = scope
        out.append(row)
    out.sort(key=lambda item: (int(item["start_month"]), int(item["end_month"])))
    deduped: list[dict] = []
    seen: set[tuple[int, int, str]] = set()
    for row in out:
        scope_key = str(row.get("scope", "")) if include_scope else ""
        key = (int(row["start_month"]), int(row["end_month"]), scope_key)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


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
            "in", "at", "on",
        }:
            return ""
        if re.fullmatch(
            r"(?i)(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|DC)",
            token,
        ):
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
    v = re.sub(r"(?i)\bto\b", "-", v)
    v = re.sub(r"\s*-\s*", "-", v)
    range_match = re.match(r"(?i)^(\d{1,3}-\d{1,3})\b", v)
    if range_match:
        start_s, end_s = range_match.group(1).split("-", 1)
        try:
            start_i = int(start_s)
            end_i = int(end_s)
        except ValueError:
            return ""
        if not (1 <= start_i <= 150 and 1 <= end_i <= 150):
            return ""
        if start_i > end_i:
            start_i, end_i = end_i, start_i
        return f"{start_i}-{end_i}"
    token_match = re.match(r"(?i)^([A-Za-z0-9][A-Za-z0-9\-]{0,8})", v)
    if not token_match:
        return ""
    token = token_match.group(1)
    if token.lower() in {"of", "the"}:
        return ""
    if "-" in token and not re.search(r"\d", token):
        return ""
    if re.fullmatch(r"(?i)[A-Za-z]{4,}", token):
        return ""
    if re.fullmatch(r"(?i)\d+", token):
        if int(token) > 150:
            return ""
        return token.lstrip("0") or token
    if re.fullmatch(r"(?i)[A-Za-z]{1,3}", token):
        return token.upper()
    if re.fullmatch(r"(?i)[A-Za-z]+", token):
        return ""
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
            "executive managing director",
            "office partner",
        )
    )


def _extract_floor_from_premises_blocks(text: str) -> str:
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return ""

    spelled_floor_pair_pat = re.compile(
        r"(?i)\bfloors?\b[^\n]{0,120}\((\d{1,2})\)[^\n]{0,60}(?:and|&|,)\s*[^\n]{0,60}\((\d{1,2})\)"
    )
    floor_triplet_paren_pat = re.compile(r"(?i)\((\d{1,2})\s*,\s*(\d{1,2})\s*(?:&|and|,)\s*(\d{1,2})\)")
    floor_number_pat = re.compile(r"(?i)\bfloor\s*(\d{1,2})\b")

    for idx, ln in enumerate(lines):
        low = ln.lower()
        if not any(k in low for k in ("premises", "leased premises", "sublease premises")):
            continue
        window_lines = lines[idx: idx + 10]
        window = " ".join(window_lines)
        low_window = window.lower()

        # 6xGuad-style ranges.
        range_match = re.search(r"(?i)\blocated\s+on\s+(\d{1,3}\s*(?:-|–|—|to)\s*\d{1,3})\b", window)
        if range_match:
            normalized = _normalize_floor_candidate(range_match.group(1))
            if normalized:
                return normalized

        # Summit-style "floors three (3) and four (4)".
        pair_match = spelled_floor_pair_pat.search(window)
        if pair_match:
            a = _coerce_int_token(pair_match.group(1), 0)
            b = _coerce_int_token(pair_match.group(2), 0)
            if 1 <= a <= 150 and 1 <= b <= 150:
                ordered = sorted({a, b})
                return ",".join(str(v) for v in ordered)

        # Zilker-style "(5, 6 & 7)" near floor language.
        triplet_match = floor_triplet_paren_pat.search(window)
        if triplet_match and "floor" in low_window:
            vals = [
                _coerce_int_token(triplet_match.group(1), 0),
                _coerce_int_token(triplet_match.group(2), 0),
                _coerce_int_token(triplet_match.group(3), 0),
            ]
            vals = [v for v in vals if 1 <= v <= 150]
            if len(vals) == 3:
                ordered = sorted(dict.fromkeys(vals))
                return ",".join(str(v) for v in ordered)

        # 300 W 6th-style enumerated floor rows directly under premises clause.
        floor_vals: list[int] = []
        for ln2 in window_lines:
            for m in floor_number_pat.finditer(ln2):
                v = _coerce_int_token(m.group(1), 0)
                if 1 <= v <= 150:
                    floor_vals.append(v)
        if floor_vals:
            deduped = list(dict.fromkeys(floor_vals))
            if len(deduped) >= 2:
                return ",".join(str(v) for v in deduped[:6])

    return ""


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
        for pat in suite_patterns:
            for m in re.finditer(pat, ln):
                candidate_raw = m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)
                candidate = _normalize_suite_candidate(candidate_raw)
                if not candidate:
                    continue
                local = ln[max(0, m.start() - 90): min(len(ln), m.end() + 90)]
                low = local.lower()
                score = 1
                if any(k in low for k in ("premises", "located", "designated", "revised premises", "description of premises")):
                    score += 3
                if _is_notice_or_party_context(low):
                    score -= 3
                if re.search(rf"(?i)\bsuite\s*[:#-]?\s*{re.escape(candidate)}\b", local):
                    score += 1
                if re.search(r"(?i)\b\d{1,6}\s+[A-Za-z0-9].*\b(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|way|plaza|parkway|pkwy\.?|expressway|expy\.?)\b", local):
                    if not any(k in low for k in ("premises", "located", "designated")):
                        score -= 8
                if any(k in low for k in ("re:", "dear ", "sincerely", "attention:", "attn:")) and "premises" not in low:
                    score -= 3
                candidates.append((score, idx, candidate))
    if not candidates:
        return ""
    candidates.sort(key=lambda x: (-x[0], x[1], 0 if re.search(r"\d", x[2]) else 1))
    if candidates[0][0] <= 0:
        return ""
    return candidates[0][2]


def _extract_floor_from_text(text: str) -> str:
    if not text:
        return ""
    premises_group_floor = _extract_floor_from_premises_blocks(text)
    if premises_group_floor:
        return premises_group_floor
    floor_patterns = [
        r"(?i)\blocated\s+on\s+(\d{1,3}\s*(?:-|–|—|to)\s*\d{1,3})\b",
        r"(?i)\bfloors?\s+(\d{1,3}\s*(?:-|–|—|to)\s*\d{1,3})\b",
        r"(?i)\bon\s+the\s+(\d{1,3})(?:st|nd|rd|th)?\s+floor\b",
        r"(?i)\b(\d{1,3})(?:st|nd|rd|th)?\s+floor\b",
        r"(?i)\bfloor\b\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-]{0,8})\b",
        r"(?i)\blevel\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-]{0,8})\b",
    ]
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    segments = _iter_text_segments(lines, max_lines=260)
    candidates: list[tuple[int, int, str]] = []
    for idx, ln in enumerate(segments):
        for pat in floor_patterns:
            for m in re.finditer(pat, ln):
                candidate = _normalize_floor_candidate(m.group(1))
                if not candidate:
                    continue
                local = ln[max(0, m.start() - 90): min(len(ln), m.end() + 90)]
                low = local.lower()
                score = 1
                if any(k in low for k in ("premises", "located", "floor of", "sublease premises")):
                    score += 3
                if "located on" in low:
                    score += 2
                if _is_notice_or_party_context(low):
                    score -= 3
                if any(k in low for k in ("parking", "garage", "basement", "loading dock")):
                    score -= 2
                if any(k in low for k in ("stories in total", "residential units", "office building")) and "premises" not in low:
                    score -= 3
                if any(k in low for k in ("security desk", "lobby", "expansion option", "right of first refusal", "additional space")):
                    score -= 4
                if any(k in low for k in ("across three full floors", "consisting of approximately")) and "rsf" in low:
                    score += 2
                if "premises will be defined at a later date to be located on" in low:
                    score += 2
                candidates.append((score, idx, candidate))
    if not candidates:
        return ""
    candidates.sort(key=lambda x: (-x[0], x[1]))
    if candidates[0][0] <= 0:
        return ""
    return candidates[0][2]


def _extract_opex_psf_from_text(text: str) -> tuple[Optional[float], Optional[int]]:
    """Extract OpEx $/SF/yr and optional source year from lease text."""
    if not text:
        return None, None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return None, None
    segments = _iter_text_segments(lines, max_lines=320)
    opex_kw = re.compile(r"(?i)\b(?:operating expenses?|opex|ope|cam|common area maintenance)\b")
    value_patterns = [
        re.compile(
            r"(?i)\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)\s*(?:rentable\s+)?(?:rsf|r\.?s\.?f\.?|sf|s\.?f\.?|square\s*feet?|sq\.?\s*ft)\s*(?:/|per)?\s*(?:year|yr|annum|annual)?\b"
        ),
        re.compile(r"(?i)\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:psf|p/?sf|r\.?s\.?f\.?|s\.?f\.?)\b"),
        re.compile(r"(?i)\$\s*([\d,]+(?:\.\d{1,4})?)\b"),
    ]
    candidates: list[tuple[int, int, float, Optional[int]]] = []
    for idx, seg in enumerate(segments):
        if not opex_kw.search(seg):
            continue
        low = seg.lower()
        opex_positions = [m.start() for m in opex_kw.finditer(seg)]
        for pat_idx, pat in enumerate(value_patterns):
            for m in pat.finditer(seg):
                value = _coerce_float_token(m.group(1), 0.0)
                if not (0 < value <= 150):
                    continue
                if pat_idx == 2 and value < 3.0:
                    continue
                local = seg[max(0, m.start() - 72): min(len(seg), m.end() + 72)]
                local_tight = seg[max(0, m.start() - 40): min(len(seg), m.end() + 40)]
                local_has_opex_kw = bool(
                    re.search(r"(?i)\b(?:operating expenses?|opex|cam|common area maintenance|additional rent)\b", local)
                )
                local_has_base_rent_kw = bool(
                    re.search(r"(?i)\b(?:initial\s+base\s+rent|base\s+rent|rental\s+rate|rent\s+schedule|rent\s+step)\b", local)
                )
                local_has_ti_kw = bool(
                    re.search(
                        r"(?i)\b(?:ti|tenant improvements?|allowance|test[\s-]?fit|ff&e|furniture|moving|cabling|security network)\b",
                        local_tight,
                    )
                )
                local_has_rent_schedule_cues = bool(
                    re.search(
                        r"(?i)\b(?:rent\s+schedule|annual\s+escalations?|with\s+\d+(?:\.\d+)?%\s+annual|months?\s*\d{1,3}\s*(?:-|to|through|thru|–|—)\s*\d{1,3})\b",
                        local,
                    )
                )
                nearest_opex_distance = min((abs(m.start() - pos) for pos in opex_positions), default=999)
                # Prevent false positives like "$42.00/RSF, net of operating" from base-rent lines.
                if local_has_base_rent_kw and not local_has_opex_kw:
                    continue
                if local_has_rent_schedule_cues and not local_has_opex_kw:
                    continue
                if local_has_ti_kw and not local_has_opex_kw:
                    continue
                # Avoid mixing values that are far away from the OpEx clause in long merged lines.
                if nearest_opex_distance > 100 and not local_has_opex_kw:
                    continue
                score = 1
                if "operating expense" in low or "common area maintenance" in low or "opex" in low or re.search(r"(?i)\bcam\b", seg):
                    score += 4
                if re.search(r"(?i)\bestimated\s+operating\s+expenses?\b|\boperating\s+expenses?\s+for\s+20\d{2}\b", seg):
                    score += 5
                if re.search(r"(?i)\bestimated\s+ope\b|\bope\s*[:\-]", seg):
                    score += 4
                if "base year" in low:
                    score += 2
                if re.search(r"(?i)\b(?:estimate|estimated|projected)\b", seg):
                    score += 1
                if re.search(r"(?i)\b(?:base rent|rental rate|rent schedule|rent step)\b", seg):
                    score -= 3
                if local_has_opex_kw:
                    score += 3
                if local_has_base_rent_kw:
                    score -= 8
                if re.search(r"(?i)\bnet\s+of\s+operating\b", local):
                    score -= 6
                if re.search(r"(?i)\b(?:parking)\b", seg):
                    score -= 2
                if re.search(r"(?i)\b(?:ti|tenant improvements?|allowance|furniture|cabling|ff&e)\b", seg):
                    score -= 8
                if local_has_ti_kw:
                    score -= 10
                if pat_idx == 2:
                    score -= 1
                year_match = re.search(r"(?i)\b(?:for|in|base year|as of)\s*(20\d{2})\b", local)
                if not year_match:
                    year_match = re.search(r"\b(20\d{2})\b", local)
                if not year_match:
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
        r"(?i)(?:\$\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)?\s*(?:rsf|sf|psf)?|([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)\s*(?:rsf|sf|psf))[^\n]{0,80}\b(20\d{2})\b"
    )
    table_pat = re.compile(
        r"(?i)^\s*(20\d{2})\s*(?:\||:|-|–|—)?\s*\$?\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)?\s*(?:rsf|sf|psf)?\s*$"
    )
    opex_kw = re.compile(r"(?i)\b(?:operating expenses?|opex|ope|cam|common area maintenance|additional rent)\b")

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
                if not (1990 <= year <= 2200 and 3 <= value <= 150):
                    continue
                results[int(year)] = float(round(value, 4))
        for m in rev_pat.finditer(line):
            value = _coerce_float_token(m.group(1), None)
            if value is None:
                value = _coerce_float_token(m.group(2), None)
            year = _coerce_int_token(m.group(3), None)
            if year is None or value is None:
                continue
            if not (1990 <= year <= 2200 and 3 <= value <= 150):
                continue
            results[int(year)] = float(round(value, 4))

    # Also capture cases where year and $/SF are split across adjacent lines.
    span_pat = re.compile(
        r"(?is)\b(?:operating expenses?|opex|cam|common area maintenance)\b"
        r"[^$]{0,220}\b(20\d{2})\b[^$]{0,220}\$\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)?\s*(?:rsf|sf|psf)\b"
    )
    for m in span_pat.finditer(text):
        span_text = (m.group(0) or "").lower()
        if any(tok in span_text for tok in ("allowance", "tenant improvement", "ti allowance", "improvement allowance")):
            continue
        year = _coerce_int_token(m.group(1), None)
        value = _coerce_float_token(m.group(2), None)
        if year is None or value is None:
            continue
        if not (1990 <= year <= 2200 and 3 <= value <= 150):
            continue
        results[int(year)] = float(round(value, 4))

    return dict(sorted(results.items()))


def _clean_address_candidate(raw: str) -> str:
    v = " ".join((raw or "").split()).strip(" ,.;:-")
    if not v:
        return ""
    v = re.sub(r'(?i)\s*\((?:the\s+)?"?\s*(?:premises|lease premises|subleased premises).*$','', v).strip(" ,.;:-")
    v = re.sub(r'(?i),\s*(?:suite|ste\.?|unit|floor)\s*$', "", v).strip(" ,.;:-")
    v = re.sub(r'(?i)\s+and\s+located(?:\s+at)?\s+.*$', "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)\s+\b(?:contraction|contract)\s+premises\b.*$", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)\s+\b(?:premises|term|lease term)\b\s*[:#-].*$", "", v).strip(" ,.;:-")
    return v


def _extract_address_from_text(text: str, suite_hint: str = "") -> str:
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return ""
    segments = _iter_text_segments(lines, max_lines=280)

    street_suffix = r"(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Plaza|Parkway|Pkwy\.?|Expressway|Expy\.?|Highway|Hwy\.?|Circle|Cir\.?|Trail|Trl\.?)"
    core_addr = rf"(\d{{1,6}}\s+[A-Za-z0-9\.\- ]{{2,100}}\b{street_suffix}\b(?:\s*,?\s*(?:Suite|Ste\.?|Unit|Floor)\s*[A-Za-z0-9\-]+)?(?:,\s*[A-Za-z0-9 .'-]{{2,50}}){{0,3}})"
    addr_patterns = [
        rf"(?i)\baddress\s*[:#-]\s*{core_addr}",
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
            if any(k in low for k in ("re:", "executive managing director", "office partner")) and "premises" not in low:
                score -= 4
            c_low = candidate.lower()
            if any(k in c_low for k in ("rsf", "cam", "reconciliation", "rent", "rate", "month", "year")):
                score -= 3
            if suite_hint:
                if re.search(rf"(?i)\b(?:suite|ste\.?|unit)\s*#?\s*{re.escape(suite_hint)}\b", candidate):
                    score += 2
                elif re.search(r"(?i)\b(?:suite|ste\.?|unit)\s*#?\s*[A-Za-z0-9\-]+\b", candidate):
                    score -= 3
            if score > best_score or (score == best_score and len(candidate) > len(best)):
                best_score = score
                best = candidate
    return best


def _looks_like_address(value: str) -> bool:
    v = " ".join((value or "").split()).strip()
    if not v:
        return False
    if re.search(r"\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9\.\- ]{2,100}\b(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|road|rd\.?|lane|ln\.?|way|plaza|parkway|pkwy\.?|expressway|expy\.?|highway|hwy\.?|circle|cir\.?|trail|trl\.?)\b", v, re.I):
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
    v = re.sub(
        r"(?i)^(?:at|located at|known as|in the building known as|the building known as|the building located at|building located at)\s+",
        "",
        v,
    ).strip(" ,.;:-")
    v = re.sub(r"(?i)^lease\s+", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)^[A-Za-z0-9&' .-]{1,60}\s+for\s+office(?:\s+space)?\s+", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)^.*?\bfor\s+office(?:\s+space)?\s+at\s+", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)^.*?\bas\s+a\s+tenant\s+at\s+", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)\bhttps?://\S+", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)\s+located\s+at\s+\d[\dA-Za-z .,'-]{3,160}(?:\.\s*.*)?$", "", v).strip(" ,.;:-")
    # "Summit at Lantana 7171 Southwest Parkway" -> "Summit at Lantana".
    if not re.match(r"^\d", v) and " - " not in v:
        v = re.sub(
            r"(?i)\s+\d{1,6}\s+[A-Za-z0-9 .,'-]{2,120}\b(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|way|plaza|parkway|pkwy\.?|expressway|expy\.?)\b.*$",
            "",
            v,
        ).strip(" ,.;:-")
    v = re.sub(r'(?i)\s*\((?:the\s+)?"?\s*(?:premises|lease premises|subleased premises).*$','', v).strip(" ,.;:-")
    v = re.sub(r'(?i)\s+and\s+located(?:\s+at)?\s+.*$', "", v).strip(" ,.;:-")
    v = re.sub(
        r"(?i)\s+\b(?:premises|leased\s+premises|sublease\s+premises|lease\s+commencement|commencement\s+date|lease\s+term|term)\b.*$",
        "",
        v,
    ).strip(" ,.;:-")
    v = re.split(r"(?i)\b(?:it is understood and agreed|provided that|subject to|for the avoidance of doubt|shall refer to)\b", v, maxsplit=1)[0].strip(" ,.;:-")
    v = re.split(r"(?i)\b(?:additional information|can be found at|all other signage)\b", v, maxsplit=1)[0].strip(" ,.;:-")
    v = re.sub(r"(?i)\s+under\s+the\s+proposed\s+business\s+points.*$", "", v).strip(" ,.;:-")
    v = re.sub(r"(?i)\s+and$", "", v).strip(" ,.;:-")
    v = v.strip(" ,.;:-–—")
    low = v.lower()
    if re.search(r"(?i)\b(?:llc|l\.l\.c\.|inc|corp|corporation|limited partnership|limited liability)\b", v):
        return ""
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
            "entry off",
            "signage",
            "removed at",
            "prior to april",
            "rooftop terrace amenity",
            "fitness facility",
            "conference facility",
            "ground floor amenities",
            "present the following proposal",
            "opportunity to present",
            "continuing our relationship",
            "on behalf of the landlord",
            "basic terms and conditions",
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
            "proposal",
            "counterproposal",
        )
    ):
        return ""
    if re.search(r"[.!?]", v) and not _looks_like_address(v):
        return ""
    if len(v.split()) > 12 and not _looks_like_address(v):
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
        (re.compile(r"(?i)^\s*building\s*:\s*\|\s*([^|\n,;]{2,120})"), 16),
        (re.compile(r"(?i)^\s*building\s*:\s*([^|\n,;]{2,120})"), 15),
        (re.compile(r"(?i)\blease\s+space\s+at\s+([A-Za-z0-9][A-Za-z0-9&' .\-/]{2,80}?)(?:\s+under\b|[.,;:\n]|$)"), 12),
        (re.compile(r"(?i)\bfor\s+office\s+space\s+at\s+([A-Za-z0-9][A-Za-z0-9&' \-/]{2,80}?)(?:[.,;:\n]|$)"), 11),
        (re.compile(r"(?i)\bas\s+a\s+tenant\s+at\s+([A-Za-z0-9][A-Za-z0-9&' \-/]{2,80}?)(?:[.,;:\n]|$)"), 11),
        (re.compile(r"(?i)\bre:\s*[^\n]{0,220}[–-]\s*([A-Za-z0-9][A-Za-z0-9&' .\-/]{2,80})"), 11),
        (re.compile(r'(?i)^\s*re:\s*[^\n]{0,220}\(\s*["“]([A-Za-z0-9][A-Za-z0-9&\' .\-/]{1,40})["”]\s*\)'), 12),
        (re.compile(r"(?i)^\s*project\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9&' .\-/]{2,80})"), 11),
        (re.compile(r'(?i)\bre:\s*[^\n]{0,220}\(\s*["“]?([A-Za-z0-9][A-Za-z0-9&\' .\-/]{2,40})["”]?\s*\)'), 8),
        (re.compile(r"(?i)\bspace\s+located\s+at\s+([A-Za-z0-9][A-Za-z0-9&' .\-/]{2,60})\s*[–-]"), 7),
        (re.compile(r"(?i)\blease\s+(?:proposal|space|premises)\s+(?:to\s+[^\n]{1,60}\s+for\s+office\s+space\s+at|at)\s+([A-Za-z0-9&' .-]{3,80}?\s*[–-]\s*Building\s*[A-Za-z0-9]+)"), 6),
        (re.compile(r"(?i)\bin\s+the\s+building\s+known\s+as\s+([^\n,;\.]{3,100})"), 8),
        (re.compile(r"(?i)\bbuilding\s+commonly\s+known\s+as\s+(?:the\s+)?([^\n,;\.]{3,100})"), 5),
        (re.compile(r"(?i)^\s*(?:building|property)\s*(?:name)?\s*[:#-]\s*([^\n,;]{3,100})"), 6),
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
            if "|" in seg and base_score >= 15:
                short_from_pipe = re.match(
                    r"(?i)^(.+?)\s+[–-]\s+\d{1,6}\s+[A-Za-z0-9 .,'-]{2,120}\b(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|way|plaza|parkway|pkwy\.?|expressway|expy\.?|highway|hwy\.?)\b.*$",
                    candidate or "",
                )
                if short_from_pipe:
                    candidate = _clean_building_candidate(short_from_pipe.group(1), suite_hint=suite_hint)
            if not candidate:
                continue
            score = base_score
            if any(token in low for token in ("premises", "located", "commonly known")):
                score += 1
            if any(token in candidate.lower() for token in ("center", "tower", "plaza", "building", "campus", "park")):
                score += 1
            if re.search(r"(?i)\blamar\b", candidate):
                score += 1
            if re.search(r"(?i)[A-Za-z]*\d+[A-Za-z]+", candidate):
                score += 2
            if _looks_like_address(candidate):
                score += 1
            if any(token in candidate.lower() for token in ("amenity", "fitness facility", "conference facility", "ground floor")):
                score -= 7
            if any(token in candidate.lower() for token in ("additional information", "entry off", "all other signage")):
                score -= 6
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


def _extract_property_name_from_party_entities(text: str, suite_hint: str = "") -> str:
    if not text:
        return ""
    patterns = [
        re.compile(
            r"(?is)\bwhereas,\s*([A-Za-z0-9&' .,\-]{4,100}?)\s*\(\s*[\"“”']?\s*original\s+landlord\b"
        ),
        re.compile(
            r"(?is)\bwhereas,\s*([A-Za-z0-9&' .,\-]{4,100}?)\s*\(\s*[\"“”']?\s*landlord\b"
        ),
    ]
    for pat in patterns:
        for match in re.finditer(pat, text):
            raw = " ".join((match.group(1) or "").split()).strip(" ,.;:-")
            if not raw:
                continue
            # Strip common legal entity suffixes so property names remain.
            raw = re.sub(
                r"(?i),?\s*(?:a|an)\s+(?:delaware|texas|california|new\s+york)\s+"
                r"(?:limited\s+partnership|limited\s+liability\s+company|corporation)\b.*$",
                "",
                raw,
            ).strip(" ,.;:-")
            raw = re.sub(
                r"(?i),?\s*(?:l\.?\s*p\.?|l\.?\s*l\.?\s*c\.?|l\.?\s*l\.?\s*p\.?|inc\.?|corp\.?|co\.?|ltd\.?)\b.*$",
                "",
                raw,
            ).strip(" ,.;:-")
            # Drop short sponsor prefix patterns like "B&G Vista Ridge" -> "Vista Ridge".
            sponsor_prefix = re.match(r"(?i)^[A-Z](?:\s*&\s*[A-Z])+\.?\s+(.+)$", raw)
            if sponsor_prefix:
                raw = sponsor_prefix.group(1).strip(" ,.;:-")
            candidate = _clean_building_candidate(raw, suite_hint=suite_hint)
            if not candidate or _looks_like_address(candidate):
                continue
            if re.search(r"(?i)\b(?:landlord|tenant|amendment|agreement|lease)\b", candidate):
                continue
            return candidate
    return ""


def _extract_dated_rent_table_schedule_and_rsf(
    text: str,
    commencement_hint: Optional[date] = None,
) -> tuple[list[dict], Optional[float]]:
    """
    Parse amendment-style rent tables with date ranges and rent columns, e.g.
    "Sep 1, 2019 - Nov 30, 2020 $18.50 $186,498.50 $15,541.54".
    Returns (rent_schedule, inferred_rsf_from_annual_div_psf).
    When commencement_hint is provided, rows ending before that date are ignored and
    returned month offsets are aligned to that commencement.
    """
    if not text:
        return [], None
    month_token = (
        r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    )
    date_token = (
        rf"(?:{month_token}\s+\d{{1,2}},?\s+\d{{4}}|"
        r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|"
        r"\d{4}[-/]\d{1,2}[-/]\d{1,2})"
    )
    row_pattern = re.compile(
        rf"(?is)\b({date_token})\s*(?:-|–|—|to|through|thru)\s*({date_token})\b"
        r"[^\n$]{0,120}\$\s*([\d,]+(?:\.\d{1,4})?)"
        r"[^\n$]{0,80}\$\s*([\d,]+(?:\.\d{1,4})?)"
        r"[^\n$]{0,80}\$\s*([\d,]+(?:\.\d{1,4})?)"
    )
    anchor_pattern = re.compile(
        rf"(?is)\b(?:expansion\s+)?commencement\s+date\b[^\n]{{0,120}}?\b({date_token})\b"
    )
    reverse_anchor_pattern = re.compile(
        rf"(?is)\b({date_token})\b[^\n]{{0,120}}?\(\s*(?:the\s+)?[\"“”']*\s*(?:expansion\s+)?commencement\s+date\b"
    )
    range_rate_pattern = re.compile(
        rf"(?i)\b(.{{1,80}}?)\s*(?:-|–|—|to|through|thru)\s*({date_token})\b"
        r"[^\n$]{0,120}\$\s*([\d,]+(?:\.\d{1,4})?)\s*(?:/|per)\s*(?:rsf|sf|psf)\b"
        r"(?:[^\n$]{0,80}\$\s*([\d,]+(?:\.\d{1,4})?))?"
    )
    anchor_date = None
    m_rev_anchor = reverse_anchor_pattern.search(text)
    if m_rev_anchor:
        anchor_date = _parse_lease_date(m_rev_anchor.group(1))
    if anchor_date is None:
        m_anchor = anchor_pattern.search(text)
        if m_anchor:
            anchor_date = _parse_lease_date(m_anchor.group(1))
    rows: list[dict] = []
    for match in re.finditer(row_pattern, text):
        start_date = _parse_lease_date(match.group(1))
        end_date = _parse_lease_date(match.group(2))
        rate_psf = _parse_number_token(match.group(3))
        annual_total = _parse_number_token(match.group(4))
        monthly_total = _parse_number_token(match.group(5))
        if not start_date or not end_date or end_date < start_date:
            continue
        if rate_psf is None or annual_total is None or monthly_total is None:
            continue
        if not (1.0 <= float(rate_psf) <= 250.0):
            continue
        if float(annual_total) < 1_000 or float(monthly_total) < 100:
            continue
        # Basic sanity: annual should be roughly 12x monthly.
        annual_ratio = float(annual_total) / max(float(monthly_total), 1.0)
        if not (8.0 <= annual_ratio <= 16.0):
            continue
        context = text[max(0, match.start() - 180): min(len(text), match.end() + 180)].lower()
        if "base rent" not in context and "annual fixed rent" not in context and "per rentable" not in context:
            continue
        if any(tok in context for tok in ("operating expense", "opex", "cam", "reconciliation")):
            continue
        rows.append(
            {
                "start_date": start_date,
                "end_date": end_date,
                "rate_psf_annual": float(rate_psf),
                "annual_total": float(annual_total),
            }
        )

    # Handle charts that provide date-range + $/RSF and a single amount column
    # (often monthly base rent), including rows like:
    # "Expansion Commencement Date - 1/31/25  $40.00/RSF $4,790.00"
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for idx, line in enumerate(lines):
        m = range_rate_pattern.search(line)
        if not m:
            continue
        left_raw = " ".join((m.group(1) or "").split()).strip(" ,.;:-")
        end_raw = m.group(2)
        rate_psf = _parse_number_token(m.group(3))
        amount2 = _parse_number_token(m.group(4)) if m.group(4) is not None else None
        if rate_psf is None or not (1.0 <= float(rate_psf) <= 250.0):
            continue
        end_date = _parse_lease_date(end_raw)
        if not end_date:
            continue
        start_date = _parse_lease_date(left_raw)
        if not start_date and re.search(r"(?i)\bcommencement\s+date\b", left_raw):
            start_date = anchor_date
        if not start_date or end_date < start_date:
            continue
        local_context = " ".join(lines[max(0, idx - 6): min(len(lines), idx + 3)]).lower()
        if not any(tok in local_context for tok in ("base rent", "rental rate", "rent chart", "lease months")):
            continue
        if any(tok in local_context for tok in ("operating expense", "opex", "cam", "reconciliation")):
            continue
        annual_total = 0.0
        if amount2 is not None and float(amount2) > 1_000:
            # Keep as annual only when the implied RSF is plausible for annualized dollars.
            implied_rsf = float(amount2) / max(float(rate_psf), 1.0)
            if implied_rsf > 2_000:
                annual_total = float(amount2)
        rows.append(
            {
                "start_date": start_date,
                "end_date": end_date,
                "rate_psf_annual": float(rate_psf),
                "annual_total": annual_total,
            }
        )

    # OCR fallback for fragmented schedule tables where each value appears on its own line, e.g.:
    # 6/1/2028
    # 5/31/2029
    # $3,993,449
    # $30.96
    if len(rows) < 2:
        date_line_pattern = re.compile(r"^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*$")
        money_token_pattern = re.compile(r"(?i)[\$§S]\s*([\d][\d,]*(?:\.\d{1,4})?)")
        for idx in range(len(lines) - 1):
            if not date_line_pattern.match(lines[idx]):
                continue
            if not date_line_pattern.match(lines[idx + 1]):
                continue
            start_date = _parse_lease_date(lines[idx])
            end_date = _parse_lease_date(lines[idx + 1])
            if not start_date or not end_date or end_date < start_date:
                continue

            annual_total = 0.0
            rate_psf: Optional[float] = None
            for probe_idx in range(idx + 2, min(len(lines), idx + 10)):
                probe = lines[probe_idx]
                if date_line_pattern.match(probe):
                    break
                for token_match in money_token_pattern.finditer(probe):
                    raw_num = str(token_match.group(1) or "")
                    raw_val = _parse_number_token(raw_num)
                    if raw_val is None:
                        continue
                    value = float(raw_val)
                    if annual_total <= 0 and value >= 1_000:
                        annual_total = value
                        continue
                    candidate_rate = value
                    digits_only = re.sub(r"\D", "", raw_num)
                    if (
                        candidate_rate > 250
                        and "." not in raw_num
                        and "," not in raw_num
                        and 1 <= len(digits_only) <= 4
                    ):
                        candidate_rate = candidate_rate / 100.0
                    if 1.0 <= candidate_rate <= 250.0:
                        rate_psf = float(candidate_rate)
                        break
                if rate_psf is not None:
                    break
            if rate_psf is None:
                continue
            rows.append(
                {
                    "start_date": start_date,
                    "end_date": end_date,
                    "rate_psf_annual": float(rate_psf),
                    "annual_total": float(max(0.0, annual_total)),
                }
            )
    if len(rows) < 2:
        return [], None
    rows.sort(key=lambda row: (row["start_date"], row["end_date"]))
    commencement = commencement_hint or rows[0]["start_date"]
    rows = [row for row in rows if row["end_date"] >= commencement]
    if not rows:
        return [], None
    rows.sort(key=lambda row: (row["start_date"], row["end_date"]))
    if commencement_hint is None:
        commencement = rows[0]["start_date"]

    def month_index(base: date, value: date) -> int:
        months = (value.year - base.year) * 12 + (value.month - base.month)
        if value.day < base.day:
            months -= 1
        return max(0, months)

    schedule: list[dict] = []
    rsf_candidates: list[float] = []
    for row in rows:
        effective_start = row["start_date"] if row["start_date"] >= commencement else commencement
        start_month = month_index(commencement, effective_start)
        end_month = month_index(commencement, row["end_date"])
        if start_month < 0 or end_month < start_month:
            continue
        schedule.append(
            {
                "start_month": int(start_month),
                "end_month": int(end_month),
                "rent_psf_annual": float(round(row["rate_psf_annual"], 4)),
            }
        )
        rate = float(row["rate_psf_annual"])
        annual_total = float(row.get("annual_total") or 0.0)
        if rate > 0 and annual_total > 0:
            inferred_rsf = annual_total / rate
            if 300 <= inferred_rsf <= 2_000_000:
                rsf_candidates.append(inferred_rsf)
    if not schedule:
        return [], None
    # Dedupe by start/end/rate.
    deduped: list[dict] = []
    seen: set[tuple[int, int, float]] = set()
    for row in schedule:
        key = (int(row["start_month"]), int(row["end_month"]), float(row["rent_psf_annual"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    deduped.sort(key=lambda row: (int(row["start_month"]), int(row["end_month"])))
    inferred_rsf_value: Optional[float] = None
    if rsf_candidates:
        ordered = sorted(rsf_candidates)
        mid = len(ordered) // 2
        median = ordered[mid] if len(ordered) % 2 == 1 else (ordered[mid - 1] + ordered[mid]) / 2.0
        if median > 0:
            max_dev = max(abs(v - median) / median for v in ordered)
            if max_dev <= 0.2:
                inferred_rsf_value = float(round(median, 2))
    return deduped, inferred_rsf_value


def _extract_first_date_token(text: str) -> Optional[date]:
    if not text:
        return None
    low_text = text.lower()
    if "e.g" in low_text or "example" in low_text:
        return None
    patterns = [
        r"(?i)\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b",
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
    disqualifying_tokens = (
        "extension",
        "renewal",
        "option",
        "termination option",
        "advance notice",
        "month-to-month",
        "holdover",
        "prior to",
    )

    month_candidates: list[tuple[int, int, int]] = []

    # Handle explicit "150 month term" style language first.
    explicit_month_term_patterns = [
        r"(?i)\b(?:primary\s+lease\s+term|lease\s+term|sublease\s+term|initial\s+term|term)\b[^.\n]{0,180}?\b\(?(\d{1,3})\)?\s*(?:calendar\s+)?months?\s+term\b",
        r"(?i)\b\(?(\d{1,3})\)?\s*(?:calendar\s+)?months?\s+term\b",
        r"(?i)\bterm\b[^.\n]{0,180}?\b\(?(\d{1,3})\)?\s*(?:calendar\s+)?months?\b",
    ]
    for pat in explicit_month_term_patterns:
        for m in re.finditer(pat, text):
            context = (m.group(0) or "").lower()
            if any(k in context for k in disqualifying_tokens):
                continue
            months = _coerce_int_token(m.group(1), 0)
            if not (1 <= months <= 600):
                continue
            score = 8
            if "primary lease term" in context:
                score += 6
            elif re.search(r"(?i)\b(?:lease\s+term|sublease\s+term|initial\s+term)\b", context):
                score += 4
            if "month term" in context:
                score += 4
            if months >= 24:
                score += 2
            month_candidates.append((score, m.start(), int(months)))

    # Handle "12 years + 6 months" expressions in term clauses.
    composite_term_patterns = [
        r"(?i)\b(?:primary\s+lease\s+term|lease\s+term|sublease\s+term|initial\s+term|term)\b[^.\n]{0,180}?\b\(?(\d{1,2})\)?\s*years?\s*\+\s*\(?(\d{1,2})\)?\s*months?\b",
        r"(?i)\b\(?(\d{1,2})\)?\s*years?\s*\+\s*\(?(\d{1,2})\)?\s*months?\b[^.\n]{0,80}\bterm\b",
    ]
    for pat in composite_term_patterns:
        for m in re.finditer(pat, text):
            context = (m.group(0) or "").lower()
            if any(k in context for k in disqualifying_tokens):
                continue
            years = _coerce_int_token(m.group(1), 0)
            extra_months = _coerce_int_token(m.group(2), 0)
            if not (0 <= extra_months <= 11 and 1 <= years <= 50):
                continue
            total_months = years * 12 + extra_months
            score = 9
            if "primary lease term" in context:
                score += 6
            elif re.search(r"(?i)\b(?:lease\s+term|sublease\s+term|initial\s+term)\b", context):
                score += 4
            month_candidates.append((score, m.start(), int(total_months)))

    term_month_patterns = [
        r"(?i)\b(?:leased\s+premises\s+term|lease\s+term|sublease\s+term|initial\s+term|term)\s*[:\-]\s*[^.\n]{0,120}?\((\d{1,3})\)\s*(?:calendar\s+)?months?\b",
        r"(?i)\b(?:leased\s+premises\s+term|lease\s+term|sublease\s+term|initial\s+term|term)\s*[:\-]\s*[^.\n]{0,120}?\b(\d{1,3})\s*(?:calendar\s+)?months?\b",
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,120}?\((\d{1,3})\)\s*(?:calendar\s+)?months?\b",
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,120}?\b(\d{1,3})\s*(?:calendar\s+)?months?\b",
    ]
    for pat in term_month_patterns:
        for m in re.finditer(pat, text):
            context = (m.group(0) or "").lower()
            if any(k in context for k in disqualifying_tokens):
                continue
            months = _coerce_int_token(m.group(1), 0)
            if not (1 <= months <= 600):
                continue
            score = 1
            if re.search(r"(?i)\b(?:leased\s+premises\s+term|lease\s+term|sublease\s+term)\b", context):
                score += 6
            elif re.search(r"(?i)\bterm\s*[:\-]", context):
                score += 4
            if "month term" in context:
                score += 2
            if months >= 24:
                score += 2
            month_candidates.append((score, m.start(), int(months)))

    if month_candidates:
        month_candidates.sort(key=lambda row: (-row[0], -row[1], -row[2]))
        return month_candidates[0][2]

    # Handles "Term shall be ten (10) years ..." and "Term: 5 years"
    year_candidates: list[tuple[int, int, int]] = []
    term_year_patterns = [
        r"(?i)\b(?:leased\s+premises\s+term|lease\s+term|sublease\s+term|initial\s+term|term)\s*[:\-]\s*[^.\n]{0,140}?\((\d{1,2})\)\s*years?\b",
        r"(?i)\b(?:leased\s+premises\s+term|lease\s+term|sublease\s+term|initial\s+term|term)\s*[:\-]\s*[^.\n]{0,140}?\b(\d{1,2})\s*years?\b",
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,140}?\((\d{1,2})\)\s*years?\b",
        r"(?i)\b(?:initial\s+)?term\b[^.\n]{0,140}?\b(\d{1,2})\s*years?\b",
    ]
    for pat in term_year_patterns:
        for m in re.finditer(pat, text):
            context = (m.group(0) or "").lower()
            if any(k in context for k in disqualifying_tokens):
                continue
            years = _coerce_int_token(m.group(1), 0)
            if not (1 <= years <= 50):
                continue
            score = 1
            if re.search(r"(?i)\b(?:leased\s+premises\s+term|lease\s+term|sublease\s+term)\b", context):
                score += 5
            elif re.search(r"(?i)\bterm\s*[:\-]", context):
                score += 3
            year_candidates.append((score, m.start(), int(years)))

    if year_candidates:
        year_candidates.sort(key=lambda row: (-row[0], -row[1], -row[2]))
        return year_candidates[0][2] * 12
    return None


def _is_non_term_expiration_context(context: str) -> bool:
    low = (context or "").lower()
    if not low:
        return False
    # "proposal expires", "allowance expires", and similar clauses are not lease expiration dates.
    noisy_tokens = (
        "proposal",
        "letter",
        "valid for",
        "remain valid",
        "allowance",
        "ti allowance",
        "tenant improvement",
        "signage",
        "security deposit",
        "delivery date",
        "early access",
        "construction",
        "test-fit",
        "parking",
        "rofr",
        "right of first refusal",
    )
    return any(token in low for token in noisy_tokens)


def _is_historical_recital_context(context: str) -> bool:
    low = (context or "").lower()
    if not low:
        return False
    historical_markers = (
        "whereas",
        "entered into",
        "lease dated",
        "scheduled to expire",
        "original landlord",
        "original term",
        "formerly known as",
        "by mesne assignments",
    )
    extension_markers = (
        "hereby extended",
        "extend the term",
        "extended for the period",
        "for the period commencing",
        "amended as follows",
        "renewal term",
        "extension term",
    )
    if "scheduled to expire" in low:
        return True
    if any(marker in low for marker in historical_markers):
        return not any(marker in low for marker in extension_markers)
    return False


_WORD_UNITS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
}
_WORD_TENS = {
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}


def _word_token_to_int(token: str | None) -> Optional[int]:
    if not token:
        return None
    cleaned = re.sub(r"[^a-z\- ]", "", token.lower()).strip()
    if not cleaned:
        return None
    parts = [p for p in re.split(r"[-\s]+", cleaned) if p]
    if not parts:
        return None
    if len(parts) == 1:
        if parts[0] in _WORD_UNITS:
            return _WORD_UNITS[parts[0]]
        if parts[0] in _WORD_TENS:
            return _WORD_TENS[parts[0]]
        return None
    if len(parts) == 2 and parts[0] in _WORD_TENS and parts[1] in _WORD_UNITS:
        return _WORD_TENS[parts[0]] + _WORD_UNITS[parts[1]]
    return None


def _extract_option_blocks(section_text: str) -> list[tuple[str, str]]:
    if not section_text:
        return []
    pattern = re.compile(r"(?is)\boption\s*(one|1|a|two|2|b)\b\s*[:\-]?\s*")
    matches = list(pattern.finditer(section_text))
    if not matches:
        return []
    blocks: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(section_text)
        label = (m.group(1) or "").strip().lower()
        block = section_text[start:end].strip()
        if not block:
            continue
        blocks.append((label, block))
    return blocks


def _normalize_option_key(raw_label: str | None) -> str:
    value = (raw_label or "").strip().lower()
    if value in {"one", "1", "a"}:
        return "a"
    if value in {"two", "2", "b"}:
        return "b"
    return ""


def _option_sort_key(option_key: str) -> int:
    if option_key == "a":
        return 0
    if option_key == "b":
        return 1
    return 9


def _option_display_label(option_key: str) -> str:
    if option_key == "a":
        return "Option A"
    if option_key == "b":
        return "Option B"
    return "Option"


def _build_option_rent_schedule(*, term_months: int, base_rate_psf_yr: float, escalation_pct: float) -> list[dict]:
    option_schedule: list[dict] = []
    term = max(0, int(term_months))
    base_rate = max(0.0, float(base_rate_psf_yr))
    if term <= 0 or base_rate < 2.0:
        return option_schedule
    escalation = max(0.0, float(escalation_pct)) / 100.0
    for start_month in range(0, term, 12):
        end_month = min(term - 1, start_month + 11)
        lease_year = start_month // 12
        annual_rate = float(round(base_rate * ((1.0 + escalation) ** lease_year), 2))
        option_schedule.append(
            {
                "start_month": int(start_month),
                "end_month": int(end_month),
                "rent_psf_annual": annual_rate,
            }
        )
    return option_schedule


def _extract_term_month_candidates_from_option_block(block: str) -> list[int]:
    candidates: list[int] = []
    if not block:
        return candidates

    # Prefer explicit month terms (e.g., "87 Month Term", "sixty (60) months").
    for m in re.finditer(r"(?i)\b([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,3})\)?\s*months?\b", block):
        digit_val = _coerce_int_token(m.group(2), 0) or 0
        word_val = _word_token_to_int(m.group(1))
        value = max(digit_val, word_val or 0)
        if 1 <= value <= 240:
            candidates.append(value)

    # Handle year-based terms (e.g., "5.00 years", "5-yr term").
    for m in re.finditer(r"(?i)\b(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr)\b", block):
        try:
            years = float(m.group(1))
        except (TypeError, ValueError):
            continue
        months = int(round(years * 12.0))
        if 1 <= months <= 240:
            candidates.append(months)

    if not candidates or max(candidates) <= 12:
        for token in re.findall(r"\b(\d{1,3})\b", block):
            maybe_months = _coerce_int_token(token, 0) or 0
            if 1 <= maybe_months <= 240:
                candidates.append(maybe_months)
        for token in re.findall(r"(?i)\b([a-z]+(?:-[a-z]+)?)\b", block):
            maybe_months = _word_token_to_int(token) or 0
            if 1 <= maybe_months <= 240:
                candidates.append(maybe_months)

    return candidates


def _extract_free_rent_months_from_option_block(block: str) -> int | None:
    if not block:
        return None
    low = block.lower()
    if re.search(r"\bno\s+(?:free\s+rent|base\s+rental?\s+abatement|rent\s+abatement)\b", low):
        return 0

    month_candidates: list[int] = []
    patterns = [
        r"(?i)\b(?:with\s+)?([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,2})\)?\s*months?\s+(?:of\s+)?(?:base\s+)?(?:rent(?:al)?\s+)?(?:free\s+rent|abatement)\b",
        r"(?i)\b(?:free\s+rent|rent(?:al)?\s+abatement|abatement)\b[^\n]{0,80}\b([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,2})\)?\s*months?\b",
    ]
    for pattern in patterns:
        for m in re.finditer(pattern, block):
            digit_val = _coerce_int_token(m.group(2), 0) or 0
            word_val = _word_token_to_int(m.group(1))
            value = max(digit_val, word_val or 0)
            if 0 <= value <= 24:
                month_candidates.append(value)
    if month_candidates:
        return max(month_candidates)
    return None


def _extract_annual_rent_escalation_pct(block: str) -> float | None:
    if not block:
        return None
    candidates: list[tuple[int, float, int]] = []
    patterns: list[tuple[str, int, int]] = [
        (
            r"(?i)\b(\d+(?:\.\d+)?)%\s+"
            r"(?:(?:annual(?:ly)?\s+(?:(?:base\s+)?rent(?:al)?(?:\s+rate)?\s+)?)?(?:increase|increases|escalation|escalations|escalator)\b"
            r"|(?:increase|increases|escalation|escalations|escalator)\b[^\n]{0,60}\bannual(?:ly| anniversary)?\b)",
            1,
            4,
        ),
        (
            r"(?i)\bannual(?:\s+(?:base\s+)?rent(?:al)?(?:\s+rate)?)?\s+"
            r"(?:increase|increases|escalation|escalations|escalator)\b"
            r"(?:\s*[:|=]\s*|[^\n]{0,140}?)(\d+(?:\.\d+)?)\s*%",
            1,
            4,
        ),
        (
            r"(?i)\b(?:base\s+rent(?:al)?(?:\s+rate)?|rent(?:al)?\s+rate)\b[^\n]{0,120}?"
            r"\b(?:increase(?:s|d)?|escalat(?:e|ed|ion|ions)|escalator)\b[^\n%]{0,80}?"
            r"(\d+(?:\.\d+)?)\s*%\s*(?:per\s+year|annually|annual(?:ly)?)?",
            1,
            5,
        ),
        (
            r"(?i)\b(?:base\s+rent(?:al)?(?:\s+rate)?|rent(?:al)?\s+rate)\b[^\n]{0,180}?"
            r"(\d+(?:\.\d+)?)\s*%\s*(?:increase(?:s|d)?|escalat(?:e|ed|ion|ions)|escalator)\b"
            r"[^\n]{0,80}\bannual(?:ly| anniversary)?\b",
            1,
            6,
        ),
    ]
    for pattern, group_index, base_score in patterns:
        for m in re.finditer(pattern, block):
            pct = _coerce_float_token(m.group(group_index), None)
            if pct is None or pct <= 0 or pct > 25:
                continue
            segment = (m.group(0) or "").lower()
            score = base_score
            if any(tok in segment for tok in ("base rent", "rental rate", "rent escalation", "rent increase")):
                score += 4
            if any(tok in segment for tok in ("opex", "operating expense", "cam")):
                score -= 6
            candidates.append((score, float(pct), m.start()))
    if not candidates:
        return None
    candidates.sort(key=lambda row: (-row[0], row[2]))
    best_score, best_pct, _ = candidates[0]
    if best_score <= 0:
        return None
    return best_pct


def _extract_option_counter_terms(text: str) -> dict:
    if not text:
        return {}
    flat = " ".join((text or "").split())
    if "option" not in flat.lower():
        return {}

    term_matches = list(
        re.finditer(
            r"(?is)\bterm\s*:\s*(.+?)\b(?:base\s+rent(?:al)?(?:\s+rate)?|improvements?|operating\s+expenses|parking)\s*:",
            flat,
        )
    )
    term_section = term_matches[-1].group(1) if term_matches else flat
    base_matches = list(
        re.finditer(
            r"(?is)\bbase\s+rent(?:al)?(?:\s+rate)?\s*:\s*(.+?)\b(?:base\s+rent(?:al)?\s+abatement|improvements?|operating\s+expenses|parking|landlord\s+work)\s*:",
            flat,
        )
    )
    base_section = base_matches[-1].group(1) if base_matches else flat
    abatement_matches = list(
        re.finditer(
            r"(?is)\bbase\s+rent(?:al)?\s+abatement\s*:\s*(.+?)\b(?:improvements?|operating\s+expenses|parking|landlord\s+work|renewal\s+option)\s*:",
            flat,
        )
    )
    abatement_section = abatement_matches[-1].group(1) if abatement_matches else ""
    esc_default_from_base = _extract_annual_rent_escalation_pct(base_section)
    esc_default_from_flat = _extract_annual_rent_escalation_pct(flat)
    escalation_pct_default = float(
        esc_default_from_base if esc_default_from_base is not None else (esc_default_from_flat or 0.0)
    )

    option_data: dict[str, dict] = {}
    for raw_label, block in _extract_option_blocks(term_section):
        key = _normalize_option_key(raw_label)
        if not key:
            continue
        data = option_data.setdefault(key, {"option_key": key, "option_label": _option_display_label(key)})
        month_candidates = _extract_term_month_candidates_from_option_block(block)
        if month_candidates:
            strong_term_candidates = [m for m in month_candidates if m >= 24]
            data["term_months"] = max(strong_term_candidates or month_candidates)

        initial_free_match = re.search(
            r"(?i)\b(?:with\s+)?([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,2})\)?\s*months?\s+base\s+free\s+rent\b",
            block,
        )
        additional_free_match = re.search(
            r"(?i)\badditional\s+([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,2})\)?\s*months?\s+of\s+base\s+rent\s+abatement\b",
            block,
        )
        initial_free = 0
        additional_free = 0
        if initial_free_match:
            initial_free = max(
                _coerce_int_token(initial_free_match.group(2), 0) or 0,
                _word_token_to_int(initial_free_match.group(1)) or 0,
            )
        if additional_free_match:
            additional_free = max(
                _coerce_int_token(additional_free_match.group(2), 0) or 0,
                _word_token_to_int(additional_free_match.group(1)) or 0,
            )
        total_free = max(0, initial_free + additional_free)
        if total_free > 0:
            data["free_rent_months"] = total_free

    for raw_label, block in _extract_option_blocks(abatement_section):
        key = _normalize_option_key(raw_label)
        if not key:
            continue
        data = option_data.setdefault(key, {"option_key": key, "option_label": _option_display_label(key)})
        free_months = _extract_free_rent_months_from_option_block(block)
        if free_months is not None:
            data["free_rent_months"] = max(0, int(free_months))

    for raw_label, block in _extract_option_blocks(base_section):
        key = _normalize_option_key(raw_label)
        if not key:
            continue
        data = option_data.setdefault(key, {"option_key": key, "option_label": _option_display_label(key)})
        rate_match = re.search(
            r"(?i)\$\s*([\d,]+(?:\.\d{1,4})?)\s*(?:nnn|gross|full\s*service|modified\s*gross|/|per)\b",
            block,
        )
        if rate_match:
            rate = _coerce_float_token(rate_match.group(1), 0.0) or 0.0
            if 2.0 <= rate <= 500.0:
                data["base_rate_psf_yr"] = float(rate)
        block_escalation = _extract_annual_rent_escalation_pct(block)
        if block_escalation is not None:
            data["escalation_pct"] = block_escalation

    if not option_data:
        return {}

    options: list[dict] = []
    for key, raw in sorted(option_data.items(), key=lambda row: (_option_sort_key(row[0]), row[0])):
        term_months = _coerce_int_token(raw.get("term_months"), 0) or 0
        free_rent_months = _coerce_int_token(raw.get("free_rent_months"), 0) or 0
        base_rate_psf_yr = _coerce_float_token(raw.get("base_rate_psf_yr"), 0.0) or 0.0
        escalation_pct = _coerce_float_token(raw.get("escalation_pct"), escalation_pct_default) or escalation_pct_default
        option_entry = {
            "option_key": key,
            "option_label": str(raw.get("option_label") or _option_display_label(key)),
            "term_months": term_months,
            "free_rent_months": free_rent_months,
            "base_rate_psf_yr": base_rate_psf_yr,
            "escalation_pct": escalation_pct,
        }
        rent_schedule = _build_option_rent_schedule(
            term_months=term_months,
            base_rate_psf_yr=base_rate_psf_yr,
            escalation_pct=escalation_pct,
        )
        if rent_schedule:
            option_entry["rent_schedule"] = rent_schedule
        options.append(option_entry)

    if not options:
        return {}

    preferred_key = "b" if "b" in option_data else options[0]["option_key"]
    preferred = option_data.get(preferred_key) or {}
    if not preferred:
        return {}
    return {
        "selected_option": preferred_key,
        "term_months": _coerce_int_token(preferred.get("term_months"), 0) or 0,
        "free_rent_months": _coerce_int_token(preferred.get("free_rent_months"), 0) or 0,
        "base_rate_psf_yr": _coerce_float_token(preferred.get("base_rate_psf_yr"), 0.0) or 0.0,
        "escalation_pct": _coerce_float_token(preferred.get("escalation_pct"), escalation_pct_default) or escalation_pct_default,
        "options": options,
    }


def _build_option_variant_scenario_name(base_name: str, option_label: str) -> str:
    cleaned_base = " ".join((base_name or "").split()).strip()
    cleaned_label = " ".join((option_label or "").split()).strip() or "Option"
    if not cleaned_base:
        return cleaned_label
    if re.search(r"(?i)\boption\s*(?:one|1|a|two|2|b)\b", cleaned_base):
        return re.sub(
            r"(?i)\boption\s*(?:one|1|a|two|2|b)\b",
            cleaned_label,
            cleaned_base,
            count=1,
        )
    if cleaned_base.lower().endswith(cleaned_label.lower()):
        return cleaned_base
    return f"{cleaned_base} - {cleaned_label}"


def _build_canonical_option_variants(
    *,
    canonical: CanonicalLease,
    extracted_hints: dict,
    filename: str,
) -> list[CanonicalLease]:
    raw_variants = extracted_hints.get("option_variants")
    if not isinstance(raw_variants, list) or len(raw_variants) < 2:
        return []

    base_name = (
        str(canonical.scenario_name or "").strip()
        or str(canonical.premises_name or "").strip()
        or (
            f"{str(canonical.building_name or '').strip()} Suite {str(canonical.suite or '').strip()}".strip()
            if str(canonical.building_name or "").strip() and str(canonical.suite or "").strip()
            else (
                f"{str(canonical.building_name or '').strip()} Floor {str(canonical.floor or '').strip()}".strip()
                if str(canonical.building_name or "").strip() and str(canonical.floor or "").strip()
                else str(canonical.building_name or "").strip()
            )
        )
        or _fallback_building_from_filename(filename)
        or _clean_building_candidate(re.sub(r"[_\-]+", " ", Path(filename or "").stem))
        or "Extracted lease"
    )

    normalized_raw_variants: list[dict] = []
    seen_option_keys: set[str] = set()
    for raw in raw_variants:
        if not isinstance(raw, dict):
            continue
        option_key = _normalize_option_key(str(raw.get("option_key") or ""))
        if not option_key or option_key in seen_option_keys:
            continue
        seen_option_keys.add(option_key)
        normalized_raw_variants.append(raw)

    if len(normalized_raw_variants) < 2:
        return []

    canonical_variants: list[CanonicalLease] = []
    for raw in sorted(
        normalized_raw_variants,
        key=lambda v: _option_sort_key(_normalize_option_key(str(v.get("option_key") or ""))),
    ):
        option_key = _normalize_option_key(str(raw.get("option_key") or ""))
        if not option_key:
            continue
        option_label = str(raw.get("option_label") or _option_display_label(option_key)).strip() or _option_display_label(option_key)
        term_months = _coerce_int_token(raw.get("term_months"), 0) or 0
        if term_months <= 0:
            term_months = _coerce_int_token(canonical.term_months, 0) or 0
        if term_months <= 0:
            continue
        free_rent_months = max(0, _coerce_int_token(raw.get("free_rent_months"), 0) or 0)
        free_rent_scope = str(raw.get("free_rent_scope") or canonical.free_rent_scope or "base").strip().lower()
        if free_rent_scope not in {"base", "gross"}:
            free_rent_scope = "base"
        expiration_date = canonical.expiration_date
        try:
            expiration_date = _expiration_from_term_months(canonical.commencement_date, int(term_months))
        except Exception:
            expiration_date = canonical.expiration_date

        rent_schedule_raw = raw.get("rent_schedule")
        rent_schedule: list[RentScheduleStep] = []
        if isinstance(rent_schedule_raw, list):
            for step in rent_schedule_raw:
                if not isinstance(step, dict):
                    continue
                start_m = _coerce_int_token(step.get("start_month"), None)
                end_m = _coerce_int_token(step.get("end_month"), start_m)
                rate = _coerce_float_token(step.get("rent_psf_annual"), 0.0)
                if start_m is None or end_m is None:
                    continue
                start_i = max(0, int(start_m))
                end_i = min(max(start_i, int(end_m)), max(0, term_months - 1))
                rent_schedule.append(
                    RentScheduleStep(
                        start_month=start_i,
                        end_month=end_i,
                        rent_psf_annual=max(0.0, float(rate)),
                    )
                )
        if not rent_schedule:
            base_rate_psf_yr = _coerce_float_token(raw.get("base_rate_psf_yr"), 0.0) or 0.0
            escalation_pct = _coerce_float_token(raw.get("escalation_pct"), 0.0) or 0.0
            generated = _build_option_rent_schedule(
                term_months=int(term_months),
                base_rate_psf_yr=base_rate_psf_yr,
                escalation_pct=escalation_pct,
            )
            for step in generated:
                rent_schedule.append(
                    RentScheduleStep(
                        start_month=int(step["start_month"]),
                        end_month=int(step["end_month"]),
                        rent_psf_annual=float(step["rent_psf_annual"]),
                    )
                )
        if not rent_schedule:
            rent_schedule = list(canonical.rent_schedule or [])
        if rent_schedule:
            rent_schedule = sorted(rent_schedule, key=lambda s: (int(s.start_month), int(s.end_month)))
            target_end = max(0, int(term_months) - 1)
            rent_schedule = [s for s in rent_schedule if int(s.start_month) <= target_end]
            if rent_schedule:
                last = rent_schedule[-1]
                if int(last.end_month) != target_end:
                    rent_schedule[-1] = last.model_copy(update={"end_month": target_end})

        updates: dict = {
            "scenario_name": _build_option_variant_scenario_name(base_name, option_label),
            "term_months": int(term_months),
            "expiration_date": expiration_date,
            "free_rent_months": int(free_rent_months),
            "free_rent_scope": free_rent_scope,
            "free_rent_periods": (
                [FreeRentPeriod(start_month=0, end_month=max(0, int(free_rent_months) - 1), scope=free_rent_scope)]
                if free_rent_months > 0
                else []
            ),
        }
        if rent_schedule:
            updates["rent_schedule"] = rent_schedule
        variant = canonical.model_copy(update=updates)
        try:
            variant, _ = normalize_canonical_lease(variant)
        except Exception:
            pass
        canonical_variants.append(variant)

    return canonical_variants if len(canonical_variants) >= 2 else []


def _looks_like_generated_report_document(text: str) -> bool:
    low = (text or "").lower()
    if not low:
        return False
    strong_markers = [
        "financial analysis",
        "cash flow summary",
        "total estimated obligation",
        "this analysis is not to be used for accounting purposes",
        "existing obligation",
        "landlord renewal proposal",
        "comparison matrix",
        "equalized comparison",
        "lease economics comparison",
    ]
    soft_markers = [
        "multi-scenario report generated",
        "avg cost/sf/year",
        "average cost/sf/year",
        "average gross rent/sf/year",
        "start month end month rate",
        "npv @ 8%",
        "no clause notes extracted",
        "review rofr/rofo",
    ]
    strong_hits = sum(1 for marker in strong_markers if marker in low)
    soft_hits = sum(1 for marker in soft_markers if marker in low)
    if strong_hits >= 4:
        return True
    if strong_hits >= 2 and soft_hits >= 1:
        return True
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
        "present the following proposal",
        "continuing our relationship",
        "opportunity to present",
        "basic terms and conditions",
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
    if re.fullmatch(r"(suite|ste\.?|unit|space)\s*[a-z0-9\-]+", low):
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
        "parking_reserved_count": None,
        "parking_unreserved_count": None,
        "parking_reserved_rate_monthly": None,
        "parking_unreserved_rate_monthly": None,
        "opex_psf_year_1": None,
        "opex_source_year": None,
        "opex_by_calendar_year": {},
        "ti_allowance_psf": None,
        "ti_allowance_total": None,
        "ti_budget_psf": None,
        "ti_budget_total": None,
        "free_rent_scope": None,
        "free_rent_start_month": None,
        "free_rent_end_month": None,
        "parking_abatement_periods": [],
        "phase_in_schedule": [],
        "rent_schedule": [],
        "option_variants": [],
    }
    if not text:
        return hints
    if _looks_like_generated_report_document(text):
        return hints

    suite_hint = _extract_suite_from_text(text)

    # ---- RSF: collect candidates with context-aware score ----
    rsf_patterns = [
        r"(?i)\blocated\s+on\s+\d{1,3}(?:\s*(?:-|–|—|to)\s*\d{1,3})?[^\n]{0,40}\(\s*(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|rentable\s+square\s+feet)\s*\)",
        r"(?i)\b(?:rentable\s+area|rentable\s+square\s+feet|rsf)\b\s*[:#-]?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})",
        r"(?i)\b(?:premises|leased\s+premises|sublease\s+premises)[^.:\n]{0,140}?\b(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rentable\s+square\s+feet|rentable\s+(?:sf|s\.?f\.?)|square\s*feet|rsf)\b",
        r"(?i)(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|r\.?s\.?f\.?|rentable\s+square\s+feet|rentable\s+(?:sf|s\.?f\.?)|square\s*feet|sf|s\.?f\.?)\b",
    ]
    rsf_candidates: list[dict] = []
    strong_total_match = re.search(
        r"(?i)\bamended\s+to\s+reflect\s+a\s+total\s+of\s+(\d{1,3}(?:,\d{3})+|\d{3,7})\s+rentable\s+square\s+feet\b",
        text,
    )
    if strong_total_match:
        value = _parse_number_token(strong_total_match.group(1))
        if value is not None and 100 <= value <= 2_000_000:
            rsf_candidates.append(
                {
                    "value": value,
                    "snippet": "amended to reflect a total of rentable square feet",
                    "score": 20,
                    "start": strong_total_match.start(),
                }
            )
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
            if re.search(rf"(?i)\blocated\s+on\s+\d{{1,3}}(?:\s*(?:-|–|—|to)\s*\d{{1,3}})?[^\n]{{0,40}}\(\s*{value_token}\s*(?:rsf|rentable\s+square\s+feet)\s*\)", snippet):
                score += 8
            if re.search(r"(?i)\bconsisting\s+of\s+approximately\b", low):
                score += 3
            if any(k in low for k in ("total of", "amended to reflect a total", "expanded premises", "total premises")):
                score += 6
            if any(k in low for k in ("initial leased premises", "initial premises", "original premises")):
                score -= 8
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
            if "defined at a later date" in low:
                score -= 6
            if "pending a mutually agreeable architectural test fit" in low:
                score -= 4
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
    month_token = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    date_token_value = rf"(?:{month_token}\s*,?\s*\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}|\d{{4}}[-/]\d{{1,2}}[-/]\d{{1,2}}|\d{{1,2}}[/-]\d{{1,2}}[/-]\d{{4}})"
    date_token_capture = rf"({date_token_value})"
    paired_term_pats = [
        rf"(?i)\b(?:the\s+period\s+)?commenc(?:ing|ement|e)\s+on\s+({date_token_value})\s*(?:,|\s)+and\s+ending\s+on\s+({date_token_value})",
        rf"(?i)\b(?:from|commencing)\s+({date_token_value})\s+(?:to|through|until)\s+({date_token_value})",
    ]
    comm_direct_pats = [
        rf"(?i)\bcommenc(?:ement|e|ing)(?:\s+date)?(?:\s+on)?(?:\s+the\s+later\s+to\s+occur\s+of)?(?:\s*[:\-]\s*|\s+){date_token_capture}",
        rf"(?i)\b(?:lease\s+)?commencement\b[^.\n]{{0,120}}?\bestimated\s+to\s+be\s+{date_token_capture}",
        rf"(?i)\bfrom\s+{date_token_capture}\s+through\s+the\s+commencement\s+date\b",
        rf"(?i)\b{date_token_capture}\s*\([^)]{{0,40}}\bcommencement\s+date\b",
    ]
    exp_direct_pats = [
        rf"(?i)\bexpir(?:e|ing|ation)\b(?:\s+date)?(?:\s+on)?(?:\s*[:\-]\s*|\s+){date_token_capture}",
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

    for pat in paired_term_pats:
        for m in re.finditer(pat, text):
            local = text[max(0, m.start() - 120): min(len(text), m.end() + 120)]
            if _is_historical_recital_context(local):
                continue
            comm_d = _parse_lease_date(m.group(1))
            exp_d = _parse_lease_date(m.group(2))
            if comm_d and exp_d and exp_d > comm_d:
                term_candidates["commencement"] = comm_d
                term_candidates["expiration"] = exp_d
                break
        if term_candidates["commencement"] is not None and term_candidates["expiration"] is not None:
            break

    if term_candidates["commencement"] is None:
        for pat in comm_direct_pats:
            for m in re.finditer(pat, text):
                if "e.g" in (m.group(0) or "").lower() or "example" in (m.group(0) or "").lower():
                    continue
                local = text[max(0, m.start() - 120): min(len(text), m.end() + 120)]
                if _is_historical_recital_context(local):
                    continue
                d = _parse_lease_date(m.group(1))
                if d:
                    term_candidates["commencement"] = d
                    break
            if term_candidates["commencement"] is not None:
                break
    if term_candidates["commencement"] is None:
        for pat in comm_context_pats:
            m = re.search(pat, text)
            if not m:
                continue
            candidate_text = m.group(1) or ""
            if "e.g" in candidate_text.lower() or "example" in candidate_text.lower():
                continue
            if _is_historical_recital_context(candidate_text):
                continue
            d = _extract_first_date_token(candidate_text)
            if d:
                term_candidates["commencement"] = d
                break

    if term_candidates["expiration"] is None:
        for pat in exp_direct_pats:
            for m in re.finditer(pat, text):
                if "e.g" in (m.group(0) or "").lower() or "example" in (m.group(0) or "").lower():
                    continue
                local = text[max(0, m.start() - 120): min(len(text), m.end() + 120)]
                if _is_non_term_expiration_context(local):
                    continue
                if _is_historical_recital_context(local):
                    continue
                d = _parse_lease_date(m.group(1))
                if d:
                    term_candidates["expiration"] = d
                    break
            if term_candidates["expiration"] is not None:
                break
    if term_candidates["expiration"] is None:
        for pat in exp_context_pats:
            m = re.search(pat, text)
            if not m:
                continue
            candidate_text = m.group(1) or ""
            if "e.g" in candidate_text.lower() or "example" in candidate_text.lower():
                continue
            if _is_non_term_expiration_context(candidate_text):
                continue
            if _is_historical_recital_context(candidate_text):
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
            is_term_label = bool(
                re.search(r"(?i)\b(?:lease|sublease|leased\s+premises)?\s*term\s*[:\-]\s*$", low_ln)
            )
            if term_candidates["commencement"] is None and is_comm_label:
                for nxt in lines[idx + 1: idx + 8]:
                    if "e.g" in nxt.lower() or "example" in nxt.lower():
                        continue
                    if _is_historical_recital_context(f"{ln} {nxt}"):
                        continue
                    d = _extract_first_date_token(nxt)
                    if d:
                        term_candidates["commencement"] = d
                        break
            if term_candidates["expiration"] is None and is_exp_label:
                for nxt in lines[idx + 1: idx + 8]:
                    if "e.g" in nxt.lower() or "example" in nxt.lower():
                        continue
                    local = f"{ln} {nxt}"
                    if _is_non_term_expiration_context(local):
                        continue
                    if _is_historical_recital_context(local):
                        continue
                    d = _extract_first_date_token(nxt)
                    if d:
                        term_candidates["expiration"] = d
                        break
            if term_candidates["expiration"] is None and is_term_label:
                for nxt in lines[idx + 1: idx + 8]:
                    if "e.g" in nxt.lower() or "example" in nxt.lower():
                        continue
                    local = f"{ln} {nxt}"
                    if _is_non_term_expiration_context(local):
                        continue
                    if _is_historical_recital_context(local):
                        continue
                    if not re.search(r"(?i)\b(?:through|until|ending\s+on|to)\b", nxt):
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
        if hints["expiration_date"] <= hints["commencement_date"]:
            if term_from_text is not None and term_from_text > 0:
                hints["term_months"] = int(term_from_text)
                try:
                    hints["expiration_date"] = _expiration_from_term_months(
                        hints["commencement_date"],
                        int(term_from_text),
                    )
                except Exception:
                    hints["expiration_date"] = None
            else:
                hints["expiration_date"] = None
                hints["term_months"] = None
        term_from_dates = (
            _month_diff(hints["commencement_date"], hints["expiration_date"])
            if hints["expiration_date"] is not None
            else 0
        )
        if hints["expiration_date"] is not None and (
            term_from_text is not None
            and (term_from_dates <= 0 or abs(int(term_from_dates) - int(term_from_text)) >= 6)
        ):
            hints["term_months"] = int(term_from_text)
            try:
                hints["expiration_date"] = _expiration_from_term_months(
                    hints["commencement_date"],
                    int(term_from_text),
                )
            except Exception:
                pass
        elif hints["expiration_date"] is not None:
            hints["term_months"] = term_from_dates
    elif hints["commencement_date"] and hints.get("term_months"):
        try:
            hints["expiration_date"] = _expiration_from_term_months(
                hints["commencement_date"],
                int(hints["term_months"]),
            )
        except Exception:
            pass

    # Option-aware fallback for counter proposals that provide Option One/Two economics.
    option_hints = _extract_option_counter_terms(text)
    raw_option_variants = option_hints.get("options") if isinstance(option_hints.get("options"), list) else []
    has_multiple_option_variants = len(raw_option_variants) >= 2
    option_term = _coerce_int_token(option_hints.get("term_months"), 0) or 0
    if option_term > 0 and (not hints.get("term_months") or has_multiple_option_variants):
        hints["term_months"] = option_term
        if hints.get("commencement_date"):
            try:
                hints["expiration_date"] = _expiration_from_term_months(
                    hints["commencement_date"],
                    int(option_term),
                )
            except Exception:
                pass

    table_rent_schedule, table_rsf = _extract_dated_rent_table_schedule_and_rsf(
        text,
        commencement_hint=hints.get("commencement_date"),
    )
    if table_rent_schedule:
        current_hint_schedule = hints.get("rent_schedule") if isinstance(hints.get("rent_schedule"), list) else []
        if not current_hint_schedule or len(table_rent_schedule) > len(current_hint_schedule):
            hints["rent_schedule"] = table_rent_schedule
        if not hints.get("term_months"):
            hints["term_months"] = int(table_rent_schedule[-1]["end_month"]) + 1
        if table_rsf and (
            hints.get("rsf") is None or int(hints.get("_rsf_score", -999) or -999) < 7
        ):
            hints["rsf"] = float(table_rsf)
            hints["_rsf_score"] = max(int(hints.get("_rsf_score", -999) or -999), 8)

    # ---- Free rent / abatement scope + month range ----
    lower_text = text.lower()
    if re.search(
        r"(?i)\b(?:gross\s+rent\s+abatement|gross\s+abatement|abate\s+base\s+rent\s+and\s+operating\s+expenses|base\s+rent\s+and\s+operating\s+expenses\s+abated)\b",
        text,
    ) or re.search(r"(?i)\bmonths?\b[^\n]{0,80}\bof\s+gross\s+rent\b[^\n]{0,80}\babated\b", text):
        hints["free_rent_scope"] = "gross"
    elif re.search(r"(?i)\b(?:base\s+rent\s+abatement|base-only\s+abatement|base\s+abatement|base\s+free\s+rent)\b", text) or re.search(
        r"(?i)\bmonths?\b[^\n]{0,80}\bof\s+base\s+rent(?:\s+only)?\b[^\n]{0,80}\babated\b",
        text,
    ) or re.search(r"(?i)\b(?:annual\s+)?base\s+rent\b[^\n]{0,80}\b(?:shall\s+be\s+)?abated\b", text):
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
        free_count_candidates: list[tuple[int, int]] = []
        # Parse line-by-line to avoid grabbing term month counts from "TERM AND FREE RENT" clauses.
        for line in [ln.strip() for ln in text.splitlines() if ln.strip()]:
            low_line = line.lower()
            if "free rent" not in low_line and "abatement" not in low_line and "abated" not in low_line:
                continue
            # Strong, label-aware captures.
            for pattern, score in (
                (r"(?i)\brent\s+abatement\s*\(months?\)\s*[:\-]?\s*(\d{1,3})\b", 20),
                (r"(?i)\bfree\s+rent\s*\(months?\)\s*[:\-]?\s*(\d{1,3})\b", 20),
                (r"(?i)\bwith\s+(?:[a-z\-]+\s*\((\d{1,3})\)|\(?(\d{1,3})\)?)\s+months?\s+(?:base\s+)?free\s+rent\b", 18),
                (r"(?i)\b(?:base\s+)?free\s+rent\b[^\n]{0,40}\b(?:for\s+)?(?:the\s+first\s+)?(?:[a-z\-]+\s*\((\d{1,3})\)|\(?(\d{1,3})\)?)\s+months?\b", 17),
                (r"(?i)\b(?:\(?(\d{1,3})\)?|[a-z\-]+\s*\((\d{1,3})\))\s+months?\b[^\n]{0,70}\b(?:base\s+)?free\s+rent\b", 15),
                (r"(?i)\b(?:\(?(\d{1,3})\)?|[a-z\-]+\s*\((\d{1,3})\))\s+months?\b[^\n]{0,70}\b(?:rent\s+abatement|abatement|abated)\b", 13),
                (r"(?i)\b(?:rent\s+abatement|abatement|abated)\b[^\n]{0,70}\b(?:\(?(\d{1,3})\)?|[a-z\-]+\s*\((\d{1,3})\))\s+months?\b", 12),
            ):
                for match in re.finditer(pattern, line):
                    count = _coerce_int_token(match.group(1), 0) or _coerce_int_token(match.group(2), 0) or 0
                    if count <= 0:
                        continue
                    local_score = score
                    if "term and free rent" in low_line:
                        local_score += 2
                    if "base free rent" in low_line:
                        local_score += 2
                    if count >= 60:
                        local_score -= 6
                    free_count_candidates.append((local_score, count))

        free_count = 0
        if free_count_candidates:
            free_count_candidates.sort(key=lambda row: (-row[0], row[1]))
            free_count = int(free_count_candidates[0][1])
        if free_count <= 0:
            free_word_match = re.search(
                r"(?i)\b(?:the\s+)?first\s+([a-z\-]+)\s+months?\b[^\n]{0,120}\b(?:base\s+rent|annual\s+base\s+rent|rent)\b[^\n]{0,80}\b(?:abated|abatement|free)\b",
                text,
            )
            if not free_word_match:
                free_word_match = re.search(
                    r"(?i)\b(?:base\s+rent|annual\s+base\s+rent|rent)\b[^\n]{0,120}\b(?:abated|abatement|free)\b[^\n]{0,80}\bfirst\s+([a-z\-]+)\s+months?\b",
                    text,
                )
            if free_word_match:
                free_count = _word_token_to_int(free_word_match.group(1)) or 0
        if free_count and free_count > 0:
            hints["free_rent_start_month"] = 0
            hints["free_rent_end_month"] = max(0, int(free_count) - 1)
            if hints["free_rent_scope"] is None and ("gross" in lower_text):
                hints["free_rent_scope"] = "gross"
            elif hints["free_rent_scope"] is None and "base free rent" in lower_text:
                hints["free_rent_scope"] = "base"

    # Guardrail: reject accidental full-term abatement unless explicitly stated.
    hinted_term = _coerce_int_token(hints.get("term_months"), 0) or 0
    free_start = _coerce_int_token(hints.get("free_rent_start_month"), None)
    free_end = _coerce_int_token(hints.get("free_rent_end_month"), None)
    if hinted_term > 0 and free_start is not None and free_end is not None:
        free_months = max(0, free_end - free_start + 1)
        if free_months >= hinted_term:
            explicit_full_term = bool(
                re.search(
                    r"(?i)\b(?:entire(?:ty)?\s+of\s+the\s+term|for\s+the\s+full\s+term|throughout\s+the\s+term)\b[^\n]{0,120}\b(?:free|abated|abatement|at\s+no\s+cost)\b",
                    text,
                )
            )
            if not explicit_full_term:
                hints["free_rent_start_month"] = None
                hints["free_rent_end_month"] = None

    option_free_months = _coerce_int_token(option_hints.get("free_rent_months"), 0) or 0
    if option_free_months > 0:
        hints["free_rent_scope"] = "base"
        hints["free_rent_start_month"] = 0
        hints["free_rent_end_month"] = max(0, option_free_months - 1)
    elif has_multiple_option_variants:
        # In multi-option proposals, generic abatement language may belong to a different option.
        # Use the selected option's explicit abatement (including zero free rent) as source of truth.
        hints["free_rent_scope"] = "base"
        hints["free_rent_start_month"] = None
        hints["free_rent_end_month"] = None

    # ---- Parking abatement range ----
    parking_abatement_ranges: list[tuple[int, int]] = []
    parking_range_patterns = [
        r"(?i)\b(?:parking(?:\s+charges?|\s+rent|\s+fees?)?[^\n]{0,120}?(?:abated|abatement|waived|free))\b[^\n]{0,120}\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b",
        r"(?i)\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b[^\n]{0,120}\b(?:parking(?:\s+charges?|\s+rent|\s+fees?)?[^\n]{0,40}(?:abated|abatement|waived|free))\b",
    ]
    for pattern in parking_range_patterns:
        for match in re.finditer(pattern, text):
            start_1 = _coerce_int_token(match.group(1), 0)
            end_1 = _coerce_int_token(match.group(2), 0)
            if start_1 > 0 and end_1 >= start_1:
                parking_abatement_ranges.append((start_1 - 1, end_1 - 1))

    if not parking_abatement_ranges:
        parking_abatement_count_patterns = [
            r"(?i)\b(?:first\s+)?(\d{1,3})\s+months?\b[^\n]{0,100}\bparking(?:\s+charges?|\s+rent|\s+fees?)?[^\n]{0,40}\b(?:abated|abatement|waived|free)\b",
            r"(?i)\bparking(?:\s+charges?|\s+rent|\s+fees?)?[^\n]{0,80}\b(?:abated|abatement|waived|free)\b[^\n]{0,60}\b(\d{1,3})\s+months?\b",
        ]
        for pattern in parking_abatement_count_patterns:
            m = re.search(pattern, text)
            if not m:
                continue
            free_count = _coerce_int_token(m.group(1), 0)
            if free_count > 0:
                parking_abatement_ranges.append((0, max(0, free_count - 1)))
                break

    if parking_abatement_ranges:
        deduped = sorted({(max(0, s), max(max(0, s), e)) for s, e in parking_abatement_ranges}, key=lambda row: (row[0], row[1]))
        hints["parking_abatement_periods"] = [
            {"start_month": start, "end_month": end}
            for start, end in deduped
        ]

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
    prefill_ti_allowance = _coerce_float_token(prefill_hints.get("ti_allowance_psf"), 0.0) or 0.0
    if prefill_ti_allowance > 0:
        hints["ti_allowance_psf"] = float(round(prefill_ti_allowance, 4))
    prefill_ti_allowance_total = _coerce_float_token(prefill_hints.get("ti_allowance_total"), 0.0) or 0.0
    if prefill_ti_allowance_total > 0:
        hints["ti_allowance_total"] = float(round(prefill_ti_allowance_total, 2))
        if not (_coerce_float_token(hints.get("ti_allowance_psf"), 0.0) or 0.0):
            rsf_for_ti = _coerce_float_token(hints.get("rsf"), 0.0) or 0.0
            if rsf_for_ti > 0:
                hints["ti_allowance_psf"] = float(round(prefill_ti_allowance_total / rsf_for_ti, 4))
    prefill_ti_budget_total = _coerce_float_token(prefill_hints.get("ti_budget_total"), 0.0) or 0.0
    if prefill_ti_budget_total > 0:
        hints["ti_budget_total"] = float(round(prefill_ti_budget_total, 2))
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

    option_base_rate = _coerce_float_token(option_hints.get("base_rate_psf_yr"), 0.0) or 0.0
    option_escalation_pct = _coerce_float_token(option_hints.get("escalation_pct"), 0.0) or 0.0
    option_term = _coerce_int_token(hints.get("term_months"), 0) or 0
    if option_base_rate >= 2.0 and option_term > 0:
        option_schedule = _build_option_rent_schedule(
            term_months=int(option_term),
            base_rate_psf_yr=float(option_base_rate),
            escalation_pct=float(option_escalation_pct),
        )
        if option_schedule:
            hints["rent_schedule"] = option_schedule

    option_variants: list[dict] = []
    for raw_variant in raw_option_variants:
        if not isinstance(raw_variant, dict):
            continue
        option_key = _normalize_option_key(str(raw_variant.get("option_key") or ""))
        if not option_key:
            continue
        variant_term = _coerce_int_token(raw_variant.get("term_months"), 0) or 0
        if variant_term <= 0:
            continue
        variant_free_months = max(0, _coerce_int_token(raw_variant.get("free_rent_months"), 0) or 0)
        variant_base_rate = _coerce_float_token(raw_variant.get("base_rate_psf_yr"), 0.0) or 0.0
        variant_escalation_pct = _coerce_float_token(raw_variant.get("escalation_pct"), 0.0) or 0.0
        variant_rent_schedule = raw_variant.get("rent_schedule") if isinstance(raw_variant.get("rent_schedule"), list) else []
        if not variant_rent_schedule:
            variant_rent_schedule = _build_option_rent_schedule(
                term_months=int(variant_term),
                base_rate_psf_yr=float(variant_base_rate),
                escalation_pct=float(variant_escalation_pct),
            )
        variant_entry: dict = {
            "option_key": option_key,
            "option_label": str(raw_variant.get("option_label") or _option_display_label(option_key)).strip() or _option_display_label(option_key),
            "term_months": int(variant_term),
            "free_rent_months": int(variant_free_months),
            "free_rent_scope": "base",
            "base_rate_psf_yr": float(variant_base_rate),
            "escalation_pct": float(variant_escalation_pct),
            "rent_schedule": variant_rent_schedule,
        }
        if hints.get("commencement_date"):
            try:
                variant_entry["expiration_date"] = _expiration_from_term_months(
                    hints["commencement_date"],
                    int(variant_term),
                )
            except Exception:
                pass
        option_variants.append(variant_entry)
    if len(option_variants) >= 2:
        deduped_option_variants: dict[str, dict] = {}
        for variant in option_variants:
            key = _normalize_option_key(str(variant.get("option_key") or ""))
            if not key:
                continue
            deduped_option_variants[key] = variant
        hints["option_variants"] = [
            deduped_option_variants[key]
            for key in sorted(deduped_option_variants.keys(), key=_option_sort_key)
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
    building_info_match = re.search(
        r"(?i)\bbuilding\s+information\s*:\s*([A-Za-z0-9][A-Za-z0-9 &\-\./]{1,100}?)\s+is\b",
        text,
    )
    if building_info_match:
        building_info_name = _clean_building_candidate(building_info_match.group(1), suite_hint=hints.get("suite", ""))
        if building_info_name and (
            not hints["building_name"] or _looks_like_address(str(hints["building_name"] or ""))
        ):
            hints["building_name"] = building_info_name
    if not hints["building_name"]:
        premises_building_match = re.search(
            r"(?i)\bpremises\s*:\s*([A-Za-z0-9][A-Za-z0-9 &\-\./]{1,80}?)\s+(?:suite|ste\.?|unit|space)\b",
            text,
        )
        if premises_building_match:
            hints["building_name"] = _clean_building_candidate(premises_building_match.group(1))
    project_match = re.search(r"(?i)\bproject\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9 &\-\./']{2,80})", text)
    if project_match:
        project_name = _clean_building_candidate(project_match.group(1), suite_hint=hints.get("suite", ""))
        if project_name and (
            not hints["building_name"]
            or len(str(hints["building_name"] or "")) > 60
            or any(tok in str(hints["building_name"]).lower() for tok in ("signage", "entry off", "additional information"))
        ):
            hints["building_name"] = project_name
    re_to_match = re.search(r"(?i)\bre:\s*[^\n]{0,180}\bto\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 &\-\./']{2,80})", text)
    if re_to_match and (
        not hints["building_name"]
        or len(str(hints["building_name"] or "")) > 60
    ):
        re_to_name = _clean_building_candidate(re_to_match.group(1), suite_hint=hints.get("suite", ""))
        if re_to_name:
            hints["building_name"] = re_to_name
    party_entity_name = _extract_property_name_from_party_entities(text, suite_hint=hints.get("suite", ""))
    if party_entity_name and (
        not hints["building_name"] or _looks_like_address(str(hints["building_name"] or ""))
    ):
        hints["building_name"] = party_entity_name
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
    elif re.search(r"(?i)\b(?:n\.?\s*n\.?\s*n\.?|nnn)\b", text):
        hints["lease_type"] = "NNN"
    elif re.search(r"(?i)\b(?:base\s+annual\s+)?net\s+rental\s+rate\b|\bnet\s+rent(?:al)?\b", text):
        hints["lease_type"] = "NNN"

    # Parking ratio and economics
    parking_ratio_evidence = False
    parking_count_evidence = False
    parking_ratio_patterns = [
        r"(?i)\b(\d+(?:\.\d+)?)\s*(?:(?:reserved|unreserved|covered|surface|garage)\s+){0,2}(?:spaces?|stalls?|passes?)\s*(?:per|\/)\s*1,?000\s*(?:rsf|sf|square\s*feet)\b",
        r"(?i)\b(\d+(?:\.\d+)?)\s*(?:permits?)\s*(?:per|\/)\s*1,?000\s*(?:rsf|sf|square\s*feet)\b",
        r"(?i)\bparking\s+ratio\b[^.\n]{0,60}\b(\d+(?:\.\d+)?)\s*(?:\/|per)\s*1,?000\b",
        r"(?i)\bparking\s+ratio\b[^\n]{0,80}\(\s*per\s*1,?000\s*(?:rsf|sf)\s*\)\s*[:\-]?\s*(\d+(?:\.\d+)?)\b",
        r"(?i)\bparking\s+ratio\b[^\n]{0,80}\b1,?000\s*(?:rsf|sf)\b[^\n]{0,16}?[:\-]?\s*(\d+(?:\.\d+)?)\b",
        r"(?i)\bparking\s+ratio\s*(?:\([^)]*1,?000\s*(?:rsf|sf)[^)]*\))?\s*(?:per|\/)?\s*1,?000\s*(?:rsf|sf)?\s*[:\-]?\s*(\d+(?:\.\d+)?)\b",
        r"(?i)\b(\d+(?:\.\d+)?)\s*\/\s*1,?000\s*(?:rsf|sf|parking|spaces?|permits?)\b",
        r"(?i)\b(?:parking\s+ratio|ratio\s+of)\b[^.\n]{0,80}\b(\d+(?:\.\d+)?)\s*(?:licenses?|spaces?|stalls?|passes?|permits?)\s*(?:per|\/|:)\s*1,?000\s*(?:rsf|sf)\b",
        r"(?i)\b(?:up\s+to\s+)?(\d+(?:\.\d+)?)\s*(?:per|\/|:)\s*1,?000\s*(?:parking|spaces?|stalls?|passes?|permits?|rsf|sf)\b",
        r"(?i)\b(\d+(?:\.\d+)?)\s*:\s*1,?000\s*(?:rsf|sf|parking|spaces?|permits?)\b",
        r"(?i)\b(?:parking|transportation)[^.\n]{0,120}\bratio[^.\n]{0,40}\b(\d+(?:\.\d+)?)\s*:\s*1,?000\b",
    ]
    parking_ratio_candidates: list[tuple[int, int, float]] = []
    for pat in parking_ratio_patterns:
        for m in re.finditer(pat, text):
            ratio = _coerce_float_token(m.group(1), 0.0)
            if not (0.1 <= ratio <= 30):
                continue
            local = text[max(0, m.start() - 90): min(len(text), m.end() + 90)].lower()
            score = 1
            if any(k in local for k in ("parking", "transportation", "permit", "garage", "spaces", "stalls", "passes")):
                score += 4
            if "ratio" in local:
                score += 1
            if any(k in local for k in ("density", "desk", "workstation", "occupancy")):
                score -= 6
            if "density limitation" in local:
                score -= 8
            parking_ratio_candidates.append((score, m.start(), float(ratio)))
    if parking_ratio_candidates:
        parking_ratio_candidates.sort(key=lambda row: (-row[0], -row[1], row[2]))
        if parking_ratio_candidates[0][0] > 0:
            hints["parking_ratio"] = parking_ratio_candidates[0][2]
            parking_ratio_evidence = True

    parking_count_patterns = [
        r"(?i)\bparking\s+spaces?\s*[:\-]?\s*(\d{1,4})\b",
        r"(?i)\b(\d{1,4})\s+(?:reserved|unreserved|covered|surface|garage)?\s*parking\s+spaces?\b",
        r"(?i)\bentitled\s+to\s+(\d{1,4})\s+(?:parking\s+)?spaces?\b",
        r"(?i)\b(?:up to\s+)?[a-z][a-z\-]*\s*\((\d{1,4})\)\s+(?:reserved|unreserved|covered|surface|garage)?\s*parking\s+spaces?\b",
    ]
    for pat in parking_count_patterns:
        m = re.search(pat, text)
        if not m:
            continue
        count = _coerce_int_token(m.group(1), 0)
        if 1 <= count <= 10000:
            hints["parking_count"] = count
            parking_count_evidence = True
            break

    # Reserved / unreserved parking detail (from proposals with separate parking input rows).
    reserved_count_match = re.search(r"(?i)\b#?\s*reserved\s+(?:paid\s+)?spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)", text)
    unreserved_count_match = re.search(r"(?i)\b#?\s*unreserved\s+(?:paid\s+)?spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)", text)
    if reserved_count_match:
        reserved_count = _coerce_int_token(reserved_count_match.group(1), 0) or 0
        if reserved_count >= 0:
            hints["parking_reserved_count"] = int(reserved_count)
            parking_count_evidence = True
    if unreserved_count_match:
        unreserved_count = _coerce_int_token(unreserved_count_match.group(1), 0) or 0
        if unreserved_count >= 0:
            hints["parking_unreserved_count"] = int(unreserved_count)
            parking_count_evidence = True

    reserved_rate_match = re.search(
        r"(?im)^\s*reserved\b[^\n]{0,100}\b(?:cost\s+per\s+space|per\s+space|per\s+month|monthly\s+cost)\b[^\n$]{0,60}\$?\s*([\d,]+(?:\.\d{1,2})?)",
        text,
    )
    unreserved_rate_match = re.search(
        r"(?im)^\s*unreserved\b[^\n]{0,100}\b(?:cost\s+per\s+space|per\s+space|per\s+month|monthly\s+cost)\b[^\n$]{0,60}\$?\s*([\d,]+(?:\.\d{1,2})?)",
        text,
    )
    if reserved_rate_match:
        reserved_rate = _coerce_float_token(reserved_rate_match.group(1), 0.0) or 0.0
        if reserved_rate >= 0:
            hints["parking_reserved_rate_monthly"] = float(reserved_rate)
    if unreserved_rate_match:
        unreserved_rate = _coerce_float_token(unreserved_rate_match.group(1), 0.0) or 0.0
        if unreserved_rate >= 0:
            hints["parking_unreserved_rate_monthly"] = float(unreserved_rate)

    parking_rate_patterns = [
        r"(?i)\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|\/)\s*(?:(?:reserved|unreserved|covered|surface|garage)\s+)?(?:space|stall)\s*(?:per|\/)\s*month\b",
        r"(?i)\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|\/)\s*(?:(?:reserved|unreserved|covered|surface|garage)\s+)?(?:permit)\s*(?:per|\/)\s*month\b",
        r"(?i)\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|\/)\s*(?:month|mo\.?)\s*(?:for\s+)?(?:unreserved|reserved)?\s*parking\b",
        r"(?i)\bparking\b[^.\n]{0,80}\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|\/)\s*(?:month|mo\.?)\b",
    ]
    parking_rate_candidates: list[tuple[int, int, float]] = []
    for pat in parking_rate_patterns:
        for m in re.finditer(pat, text):
            rate = _coerce_float_token(m.group(1), 0.0)
            if not (1 <= rate <= 10000):
                continue
            local = text[max(0, m.start() - 120): min(len(text), m.end() + 120)].lower()
            local_tight = text[max(0, m.start() - 45): min(len(text), m.end() + 45)].lower()
            score = 1
            if "parking" in local:
                score += 2
            if any(k in local_tight for k in ("unreserved", "must take", "must pay", "permit")):
                score += 4
            if "reserved" in local_tight and "unreserved" not in local_tight:
                score -= 5
            if "by comparison" in local:
                score -= 6
            if any(k in local for k in ("first 3 years", "first three years", "yr 4", "year 4", "thereafter")):
                score -= 1
            if "market rates" in local and "unreserved" in local_tight:
                score += 1
            parking_rate_candidates.append((score, m.start(), float(rate)))
    if parking_rate_candidates:
        parking_rate_candidates.sort(key=lambda row: (-row[0], row[1], row[2]))
        if parking_rate_candidates[0][0] > -4:
            hints["parking_rate_monthly"] = parking_rate_candidates[0][2]

    # Consolidate parking totals if reserved/unreserved values exist.
    reserved_count = _coerce_int_token(hints.get("parking_reserved_count"), None)
    unreserved_count = _coerce_int_token(hints.get("parking_unreserved_count"), None)
    reserved_rate = _coerce_float_token(hints.get("parking_reserved_rate_monthly"), None)
    unreserved_rate = _coerce_float_token(hints.get("parking_unreserved_rate_monthly"), None)
    if reserved_count is not None or unreserved_count is not None:
        total_spaces = max(0, int(reserved_count or 0)) + max(0, int(unreserved_count or 0))
        if total_spaces > 0:
            hints["parking_count"] = int(total_spaces)
            parking_count_evidence = True
        # If both rates exist, compute weighted average; otherwise prefer non-zero unreserved then reserved.
        if total_spaces > 0 and (reserved_rate is not None or unreserved_rate is not None):
            weighted_total = (float(reserved_rate or 0.0) * max(0, int(reserved_count or 0))) + (
                float(unreserved_rate or 0.0) * max(0, int(unreserved_count or 0))
            )
            if weighted_total > 0:
                hints["parking_rate_monthly"] = float(weighted_total / float(total_spaces))
            elif unreserved_rate is not None and float(unreserved_rate) >= 0:
                hints["parking_rate_monthly"] = float(unreserved_rate)
            elif reserved_rate is not None and float(reserved_rate) >= 0:
                hints["parking_rate_monthly"] = float(reserved_rate)

    # Backfill parking hints from deterministic prefill extraction and reconcile
    # count from ratio when inline "must-take" counts are materially lower.
    prefill_parking_ratio = _coerce_float_token(
        prefill_hints.get("parking_ratio_per_1000_rsf", prefill_hints.get("parking_ratio")),
        0.0,
    ) or 0.0
    prefill_parking_count = _coerce_int_token(prefill_hints.get("parking_spaces"), 0) or 0
    prefill_parking_rate = _coerce_float_token(
        prefill_hints.get("parking_cost_monthly_per_space", prefill_hints.get("parking_rate_monthly")),
        0.0,
    ) or 0.0

    existing_ratio = _coerce_float_token(hints.get("parking_ratio"), 0.0) or 0.0
    if prefill_parking_ratio > 0 and existing_ratio <= 0:
        hints["parking_ratio"] = float(prefill_parking_ratio)
        parking_ratio_evidence = True

    existing_rate = _coerce_float_token(hints.get("parking_rate_monthly"), 0.0) or 0.0
    if prefill_parking_rate > 0 and existing_rate <= 0:
        hints["parking_rate_monthly"] = float(prefill_parking_rate)

    existing_count = _coerce_int_token(hints.get("parking_count"), 0) or 0
    if prefill_parking_count > 0 and (
        existing_count <= 0 or prefill_parking_count >= int(round(existing_count * 1.5))
    ):
        hints["parking_count"] = int(prefill_parking_count)
        parking_count_evidence = True

    rsf_score_for_parking = int(hints.get("_rsf_score", -999) or -999)
    rsf_for_parking_alignment = hints.get("rsf") if rsf_score_for_parking >= -8 else None
    aligned_parking_ratio, aligned_parking_count = _reconcile_parking_ratio_and_count(
        parking_ratio=hints.get("parking_ratio"),
        parking_count=hints.get("parking_count"),
        rsf=rsf_for_parking_alignment,
        prefer="count" if parking_count_evidence and not parking_ratio_evidence else "ratio",
    )
    if aligned_parking_ratio > 0:
        hints["parking_ratio"] = float(aligned_parking_ratio)
    if aligned_parking_count > 0:
        hints["parking_count"] = int(aligned_parking_count)

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


def _split_note_fragments(raw: str) -> list[str]:
    text = str(raw or "").replace("\r", "\n")
    if not text.strip():
        return []
    parts = re.split(r"\s*\|\s*|\n+|[•\u2022]", text)
    out: list[str] = []
    for part in parts:
        cleaned = re.sub(r"\s+", " ", part).strip(" \t,;|")
        if cleaned and _is_meaningful_note_fragment(cleaned):
            out.append(cleaned)
    return out


_NOTE_PREFIX_PATTERN = re.compile(
    r"(?i)^\s*(?:"
    r"assignment\s*(?:/|and)\s*sublease|sublease|assignment|"
    r"renewal\s*(?:option|/?\s*extension)?|option\s+to\s+renew|"
    r"general|operating\s*expenses?|"
    r"parking\s*(?:charges|ratio)?|"
    r"expense\s*caps?\s*/\s*exclusions|opex\s*(?:exclusions?|cap)|audit\s*rights?|"
    r"use\s*restrictions?|termination\s*option|expansion\s*option|holdover|"
    r"rofr|rofo|right\s+of\s+first\s+refusal|right\s+of\s+first\s+offer|"
    r"right|sublease"
    r")\s*:\s*"
)


def _strip_note_prefix_noise(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip(" \t,;|")
    if not cleaned:
        return ""
    for _ in range(4):
        next_val = _NOTE_PREFIX_PATTERN.sub("", cleaned).strip()
        if next_val == cleaned:
            break
        cleaned = next_val
    return cleaned


def _is_meaningful_note_fragment(text: str) -> bool:
    cleaned = _strip_note_prefix_noise(str(text or "")).strip()
    if not cleaned:
        return False
    low = cleaned.lower()
    if low in {"n/a", "na", "none", "null", "-", "--", "general"}:
        return False
    if re.fullmatch(r"\d+(?:\.\d+)?", low):
        return False
    if re.fullmatch(r"[\W_]+", cleaned):
        return False
    if not re.search(r"[a-zA-Z]", cleaned):
        return False
    if len(cleaned) < 8 and not re.search(r"[a-zA-Z]{2,}", cleaned):
        return False
    return True


_SIMPLE_NUMBER_WORDS: dict[int, str] = {
    0: "zero",
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
    11: "eleven",
    12: "twelve",
    13: "thirteen",
    14: "fourteen",
    15: "fifteen",
    16: "sixteen",
    17: "seventeen",
    18: "eighteen",
    19: "nineteen",
    20: "twenty",
    30: "thirty",
    40: "forty",
    50: "fifty",
    60: "sixty",
    70: "seventy",
    80: "eighty",
    90: "ninety",
}


def _title_case_number_word(text: str) -> str:
    chunks = re.split(r"([-\s])", str(text or "").strip())
    out: list[str] = []
    for chunk in chunks:
        if chunk in {"-", " "}:
            out.append(chunk)
        elif chunk:
            out.append(chunk[:1].upper() + chunk[1:].lower())
    return "".join(out).strip()


def _int_to_words(num: int) -> str:
    n = int(num)
    if n in _SIMPLE_NUMBER_WORDS:
        return _SIMPLE_NUMBER_WORDS[n]
    if n < 0:
        return ""
    if n < 100:
        tens = (n // 10) * 10
        ones = n % 10
        tens_word = _SIMPLE_NUMBER_WORDS.get(tens, "")
        if ones == 0:
            return tens_word
        ones_word = _SIMPLE_NUMBER_WORDS.get(ones, "")
        if tens_word and ones_word:
            return f"{tens_word}-{ones_word}"
        return tens_word or ones_word
    if n < 1000:
        hundreds = n // 100
        rem = n % 100
        head = f"{_SIMPLE_NUMBER_WORDS.get(hundreds, str(hundreds))} hundred"
        if rem == 0:
            return head
        tail = _int_to_words(rem)
        return f"{head} {tail}".strip()
    return str(n)


def _word_to_int(word: str) -> Optional[int]:
    token = str(word or "").strip().lower()
    if not token:
        return None
    if token.isdigit():
        try:
            return int(token)
        except ValueError:
            return None
    token = token.replace("_", "-").replace(" ", "-")
    if token in _SIMPLE_NUMBER_WORDS.values():
        for k, v in _SIMPLE_NUMBER_WORDS.items():
            if v == token:
                return int(k)
    parts = [part for part in token.split("-") if part]
    if len(parts) == 2:
        left = _word_to_int(parts[0])
        right = _word_to_int(parts[1])
        if left is not None and right is not None and left >= 20 and right < 10:
            return left + right
    return None


def _summarize_note_clause(text: str, max_chars: int = 190) -> str:
    cleaned = _strip_note_prefix_noise(text)
    low = cleaned.lower()
    if not cleaned:
        return ""

    # Assignment/sublease
    if any(k in low for k in ("assign", "assignment", "sublet", "sublease")):
        if "may not assign" in low or "without the prior written consent" in low:
            summary = "Assignment/sublease requires landlord consent"
        else:
            summary = "Assignment/sublease rights included"
        if "all or any portion" in low:
            summary += " for all or part of premises"
        if re.search(r"(?i)\bnot\s+(?:be\s+)?unreasonably\s+withheld\b", cleaned):
            summary += "; consent not unreasonably withheld"
        if "conditioned or delayed" in low:
            summary += ", conditioned, or delayed"
        return _condense_note_text(summary.rstrip(" ,;."), max_chars=max_chars, max_sentences=1)

    # Renewal
    if "renew" in low or "extension" in low:
        option_number: Optional[int] = None
        option_word = ""
        m_opt_num_word = re.search(
            r"(?i)\b(\d{1,2})\s*\(\s*([A-Za-z-]+)\s*\)\s+(?:renewal\s+)?(?:option|options)\b",
            cleaned,
        )
        m_opt_word_num = re.search(
            r"(?i)\b([A-Za-z-]+)\s*\(\s*(\d{1,2})\s*\)\s+(?:renewal\s+)?(?:option|options)\b",
            cleaned,
        )
        m_opt_plain = re.search(r"(?i)\b(\d{1,3}|[A-Za-z-]+)\s+(?:renewal\s+)?(?:option|options)\b", cleaned)
        if m_opt_num_word:
            option_number = _coerce_int_token(m_opt_num_word.group(1), None)
            option_word = _title_case_number_word(m_opt_num_word.group(2))
        elif m_opt_word_num:
            option_number = _coerce_int_token(m_opt_word_num.group(2), None)
            option_word = _title_case_number_word(m_opt_word_num.group(1))
        elif m_opt_plain:
            option_number = _coerce_int_token(m_opt_plain.group(1), None)
            if option_number is None:
                option_number = _word_to_int(m_opt_plain.group(1))
        if option_number is None and re.search(r"(?i)\brenewal\s+option\b", cleaned):
            option_number = 1

        duration_amount: Optional[int] = None
        duration_word = ""
        duration_unit = ""
        m_year_num_word = re.search(
            r"(?i)\b(\d{1,3})\s*\(\s*([A-Za-z-]+)\s*\)\s*(years?|yrs?)\b",
            cleaned,
        )
        m_year_word_num = re.search(
            r"(?i)\b([A-Za-z-]+)\s*\(\s*(\d{1,3})\s*\)\s*(years?|yrs?)\b",
            cleaned,
        )
        m_month_num_word = re.search(
            r"(?i)\b(\d{1,3})\s*\(\s*([A-Za-z-]+)\s*\)\s*(months?|mos?)\b",
            cleaned,
        )
        m_month_word_num = re.search(
            r"(?i)\b([A-Za-z-]+)\s*\(\s*(\d{1,3})\s*\)\s*(months?|mos?)\b",
            cleaned,
        )
        m_year_plain = re.search(r"(?i)\b(\d{1,3}|[A-Za-z-]+)\s*(years?|yrs?)\b", cleaned)
        m_month_plain = re.search(r"(?i)\b(\d{1,3}|[A-Za-z-]+)\s*(months?|mos?)\b", cleaned)
        if m_year_num_word:
            duration_amount = _coerce_int_token(m_year_num_word.group(1), None)
            duration_word = _title_case_number_word(m_year_num_word.group(2))
            duration_unit = "years"
        elif m_year_word_num:
            duration_amount = _coerce_int_token(m_year_word_num.group(2), None)
            duration_word = _title_case_number_word(m_year_word_num.group(1))
            duration_unit = "years"
        elif m_month_num_word:
            duration_amount = _coerce_int_token(m_month_num_word.group(1), None)
            duration_word = _title_case_number_word(m_month_num_word.group(2))
            duration_unit = "months"
        elif m_month_word_num:
            duration_amount = _coerce_int_token(m_month_word_num.group(2), None)
            duration_word = _title_case_number_word(m_month_word_num.group(1))
            duration_unit = "months"
        elif m_year_plain:
            duration_amount = _coerce_int_token(m_year_plain.group(1), None)
            if duration_amount is None:
                duration_amount = _word_to_int(m_year_plain.group(1))
            duration_unit = "years"
        elif m_month_plain:
            duration_amount = _coerce_int_token(m_month_plain.group(1), None)
            if duration_amount is None:
                duration_amount = _word_to_int(m_month_plain.group(1))
            duration_unit = "months"

        if duration_amount is None:
            return ""

        if not duration_word:
            duration_word = _title_case_number_word(_int_to_words(duration_amount))
        if not duration_word:
            duration_word = str(duration_amount)
        duration_text = f"{duration_amount} ({duration_word}) {duration_unit}"

        if option_number is None:
            option_number = 1
        if not option_word:
            option_word = _title_case_number_word(_int_to_words(option_number)) or str(option_number)
        option_plural = "" if option_number == 1 else "s"
        option_text = f"{option_number} ({option_word}) renewal option{option_plural}"

        summary = f"{option_text} for {duration_text}"
        if "fair market" in low or "fmv" in low:
            summary += " at FMV"
        return _condense_note_text(summary, max_chars=max_chars, max_sentences=1)

    # Parking
    if "parking" in low or "permit" in low or "reserved paid spaces" in low or "unreserved paid spaces" in low:
        parts: list[str] = []
        ratio_match = re.search(
            r"(?i)\b(\d+(?:\.\d+)?)\s*(?:permits?|spaces?|stalls?)?\s*(?:per|/)\s*1,?000\s*(?:rsf|sf|square feet)?\b",
            cleaned,
        )
        if ratio_match:
            parts.append(f"{ratio_match.group(1)}/1,000 RSF")
        if re.search(r"(?i)\bmust[-\s]*take\b[^\n]{0,40}\bmust[-\s]*pay\b", cleaned):
            parts.append("must-take-and-pay")
        total_spaces_match = re.search(r"(?i)\btotal\s+#?\s*paid\s+spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)", cleaned)
        reserved_count_match = re.search(r"(?i)\b#?\s*reserved\s+(?:paid\s+)?spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)", cleaned)
        unreserved_count_match = re.search(r"(?i)\b#?\s*unreserved\s+(?:paid\s+)?spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)", cleaned)
        generic_count_match = re.search(
            r"(?i)\b(?:[a-z\-]+\s*\((\d{1,3})\)|(\d{1,3}))\s+parking\s+spaces?\b",
            cleaned,
        )
        reserved_rate_match = re.search(
            r"(?i)\breserved\b[^\n]{0,100}\b(?:cost\s+per\s+space|per\s+space|per\s+month|monthly\s+cost)\b[^\n$]{0,60}\$?\s*([\d,]+(?:\.\d{1,2})?)",
            cleaned,
        )
        unreserved_rate_match = re.search(
            r"(?i)\bunreserved\b[^\n]{0,100}\b(?:cost\s+per\s+space|per\s+space|per\s+month|monthly\s+cost)\b[^\n$]{0,60}\$?\s*([\d,]+(?:\.\d{1,2})?)",
            cleaned,
        )
        generic_rate_match = re.search(
            r"(?i)\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|/)\s*(?:space|stall|permit|month)\b",
            cleaned,
        )
        total_spaces = _coerce_int_token(total_spaces_match.group(1), None) if total_spaces_match else None
        reserved_spaces = _coerce_int_token(reserved_count_match.group(1), None) if reserved_count_match else None
        unreserved_spaces = _coerce_int_token(unreserved_count_match.group(1), None) if unreserved_count_match else None
        generic_spaces = (
            _coerce_int_token(generic_count_match.group(1), None) or _coerce_int_token(generic_count_match.group(2), None)
            if generic_count_match
            else None
        )
        if total_spaces is None and (reserved_spaces is not None or unreserved_spaces is not None):
            total_spaces = max(0, int(reserved_spaces or 0)) + max(0, int(unreserved_spaces or 0))
        if total_spaces is None and generic_spaces is not None:
            total_spaces = generic_spaces
        if reserved_spaces is not None or unreserved_spaces is not None:
            parts.append(
                f"reserved {int(reserved_spaces or 0)}, unreserved {int(unreserved_spaces or 0)}"
            )
        if total_spaces is not None:
            parts.append(f"total {int(total_spaces)} spaces")
        reserved_rate = _coerce_float_token(reserved_rate_match.group(1), None) if reserved_rate_match else None
        unreserved_rate = _coerce_float_token(unreserved_rate_match.group(1), None) if unreserved_rate_match else None
        generic_rate = _coerce_float_token(generic_rate_match.group(1), None) if generic_rate_match else None
        if reserved_rate is not None or unreserved_rate is not None:
            rate_bits: list[str] = []
            if reserved_rate is not None:
                rate_bits.append(f"reserved ${float(reserved_rate):,.0f}/mo")
            if unreserved_rate is not None:
                rate_bits.append(f"unreserved ${float(unreserved_rate):,.0f}/mo")
            if rate_bits:
                parts.append(", ".join(rate_bits))
        elif generic_rate is not None and generic_rate >= 0:
            parts.append(f"${float(generic_rate):,.0f}/mo per space")
        convert_match = re.search(r"(?i)\bup to\s*(\d{1,3})\s*%[^.]{0,140}\breserved\b", cleaned)
        if convert_match:
            parts.append(f"up to {convert_match.group(1)}% convertible to reserved")
        if not parts:
            return _condense_note_text("Parking terms included.", max_chars=max_chars, max_sentences=1)
        return _condense_note_text(f"Parking: {', '.join(parts)}.", max_chars=max_chars, max_sentences=1)

    # Expense caps / audit / exclusions
    if any(k in low for k in ("cap", "controllable", "management fee", "audit", "exclude", "exclusion")):
        cont_cap = re.search(r"(?i)\b(\d+(?:\.\d+)?)\s*%\b[^.]{0,80}\bcontrollable\b", cleaned)
        mgmt_cap = re.search(r"(?i)\b(\d+(?:\.\d+)?)\s*%\b[^.]{0,80}\bmanagement\b", cleaned)
        if cont_cap or mgmt_cap:
            bits = []
            if cont_cap:
                bits.append(f"{cont_cap.group(1)}% controllable-expense cap")
            if mgmt_cap:
                bits.append(f"{mgmt_cap.group(1)}% management-fee cap")
            return _condense_note_text("; ".join(bits) + ".", max_chars=max_chars, max_sentences=1)
        return _condense_note_text("Expense caps/exclusions or audit rights included.", max_chars=max_chars, max_sentences=1)

    return _condense_note_text(cleaned, max_chars=max_chars, max_sentences=1)


def _condense_note_text(text: str, max_chars: int = 320, max_sentences: int = 2) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip(" \t,;|")
    if not cleaned:
        return ""
    if max_chars <= 0:
        return ""
    if len(cleaned) <= max_chars:
        return cleaned

    sentences = [
        re.sub(r"\s+", " ", frag).strip(" \t,;|")
        for frag in re.split(r"(?<=[\.\!\?;:])\s+", cleaned)
        if frag and frag.strip()
    ]
    if sentences:
        selected: list[str] = []
        total = 0
        for sentence in sentences:
            extra = len(sentence) + (1 if selected else 0)
            if total + extra > max_chars:
                break
            selected.append(sentence)
            total += extra
            if len(selected) >= max_sentences:
                break
        joined = " ".join(selected).strip()
        if joined and len(joined) >= min(80, max_chars):
            return joined

    word_budget = max(12, max_chars - 3)
    words = cleaned.split()
    compact_words: list[str] = []
    total_len = 0
    for word in words:
        extra = len(word) + (1 if compact_words else 0)
        if total_len + extra > word_budget:
            break
        compact_words.append(word)
        total_len += extra
    if not compact_words:
        return cleaned[:word_budget].rstrip(" ,;:.") + "..."
    return " ".join(compact_words).rstrip(" ,;:.") + "..."


def _condense_note_line(line: str, max_chars: int = 320) -> str:
    cleaned = re.sub(r"^\s*(?:[-*]|\u2022|•)\s*", "", str(line or "")).strip()
    if not cleaned:
        return ""
    if not _is_meaningful_note_fragment(cleaned):
        return ""
    if len(cleaned) <= max_chars:
        return _strip_note_prefix_noise(cleaned)

    labeled = re.match(r"^([A-Za-z][A-Za-z0-9/\- ]{1,45}):\s*(.+)$", cleaned)
    if labeled:
        label = labeled.group(1).strip()
        body = labeled.group(2).strip()
        body_budget = max(60, max_chars - len(label) - 2)
        compact_body = _summarize_note_clause(body, max_chars=body_budget)
        combined = f"{label}: {compact_body}".strip()
        if len(combined) <= max_chars:
            return combined
    return _summarize_note_clause(cleaned, max_chars=max_chars)


def _note_dedupe_key(line: str) -> str:
    base = _strip_note_prefix_noise(str(line or ""))
    base = base.lower().replace("...", "")
    base = re.sub(r"[^a-z0-9]+", " ", base).strip()
    tokens = [token for token in base.split() if token]
    return " ".join(tokens[:24])


def _pack_notes_for_storage(
    note_lines: list[str],
    *,
    extra_note_lines: list[str] | None = None,
    existing_notes: str = "",
    max_total_chars: int = 1600,
    max_line_chars: int = 320,
    max_items: int = 12,
) -> str:
    merged: list[str] = []
    merged.extend(_split_note_fragments(existing_notes))
    merged.extend(note_lines or [])
    merged.extend(extra_note_lines or [])

    packed: list[str] = []
    seen: set[str] = set()
    total = 0
    for raw in merged:
        line = _condense_note_line(raw, max_chars=max_line_chars)
        if not line:
            continue
        if not _is_meaningful_note_fragment(line):
            continue
        dedupe_key = _note_dedupe_key(line)
        if dedupe_key in seen:
            continue

        sep_len = 3 if packed else 0
        projected = total + sep_len + len(line)
        if projected > max_total_chars:
            remaining = max_total_chars - total - sep_len
            if remaining < 40:
                break
            line = _condense_note_line(line, max_chars=remaining)
            if not line or len(line) > remaining:
                break
            dedupe_key = _note_dedupe_key(line)
            if dedupe_key in seen:
                continue
            projected = total + sep_len + len(line)
            if projected > max_total_chars:
                break

        packed.append(line)
        seen.add(dedupe_key)
        total = projected
        if len(packed) >= max_items:
            break
    return " | ".join(packed)


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
            "Parking allocation",
            [
                re.compile(r"\b#?\s*reserved\s+(?:paid\s+)?spaces?\b", re.I),
                re.compile(r"\b#?\s*unreserved\s+(?:paid\s+)?spaces?\b", re.I),
                re.compile(r"\btotal\s+#?\s*paid\s+spaces?\b", re.I),
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
        snippet = _condense_note_line(match_chunk, max_chars=320)
        if re.match(rf"(?i)^{re.escape(label)}\s*:", snippet) or (
            label.lower().startswith("parking") and re.match(r"(?i)^parking\s*:", snippet)
        ):
            note = snippet
        else:
            note = f"{label}: {snippet}"
        if not _is_meaningful_note_fragment(note):
            continue
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
    if getattr(canonical, "parking_abatement_periods", None):
        found.append(f"Parking abatement periods: {len(getattr(canonical, 'parking_abatement_periods', []))}")

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
        "parking_abatement_periods": ["Parking"],
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


def _append_review_task(
    tasks: list[dict],
    *,
    field_path: str,
    severity: str,
    issue_code: str,
    message: str,
    recommended_value: object = None,
) -> None:
    sev = (severity or "").strip().lower()
    if sev not in {"info", "warn", "blocker"}:
        sev = "warn"
    for existing in tasks:
        if not isinstance(existing, dict):
            continue
        if (
            str(existing.get("field_path") or "").strip().lower() == field_path.strip().lower()
            and str(existing.get("issue_code") or "").strip().lower() == issue_code.strip().lower()
        ):
            return
    tasks.append(
        {
            "field_path": field_path,
            "severity": sev,
            "issue_code": issue_code,
            "message": message,
            "candidates": [],
            "recommended_value": recommended_value,
            "evidence": [],
        }
    )


def _merge_review_tasks(primary: list[dict], supplemental: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for source in (primary or [], supplemental or []):
        for task in source:
            if not isinstance(task, dict):
                continue
            field_path = str(task.get("field_path") or "").strip().lower()
            issue_code = str(task.get("issue_code") or "").strip().lower()
            key = (field_path, issue_code)
            if key in seen:
                continue
            seen.add(key)
            merged.append(task)
    return merged


def _building_name_is_suspicious(value: str) -> bool:
    v = " ".join((value or "").split()).strip().lower()
    if not v:
        return False
    if len(v) > 90:
        return True
    noisy_tokens = (
        "it is understood and agreed",
        "additional information",
        "entry off",
        "all other signage",
        "tenant shall",
        "landlord shall",
        "premises:",
        "lease term",
        "commencement date",
        "https://",
        "http://",
    )
    return any(token in v for token in noisy_tokens)


def _rent_schedule_coverage_issues(lease: CanonicalLease) -> tuple[bool, str]:
    term = _coerce_int_token(getattr(lease, "term_months", 0), 0) or 0
    schedule = list(getattr(lease, "rent_schedule", []) or [])
    if term <= 0 or not schedule:
        return False, ""
    rows: list[tuple[int, int]] = []
    for step in schedule:
        start = _coerce_int_token(getattr(step, "start_month", None), None)
        end = _coerce_int_token(getattr(step, "end_month", start), start)
        if start is None or end is None:
            continue
        s = max(0, int(start))
        e = max(s, int(end))
        rows.append((s, e))
    if not rows:
        return True, "Rent schedule has no valid month windows."
    rows.sort(key=lambda row: (row[0], row[1]))
    expected_start = 0
    for s, e in rows:
        if s > expected_start:
            return True, f"Rent schedule gap found before month {s + 1}."
        if s < expected_start:
            s = expected_start
        expected_start = max(expected_start, e + 1)
    required_end = max(0, term - 1)
    if expected_start - 1 < required_end:
        return True, f"Rent schedule ends at month {expected_start} but term requires month {required_end + 1}."
    return False, ""


def _supplemental_quality_checks(
    *,
    canonical: CanonicalLease,
    text: str,
    extracted_hints: dict,
) -> dict:
    tasks: list[dict] = []
    warnings: list[str] = []
    missing: list[str] = []
    questions: list[str] = []
    penalty = 0.0
    lower_text = (text or "").lower()

    comm = canonical.commencement_date
    exp = canonical.expiration_date
    term = _coerce_int_token(canonical.term_months, 0) or 0
    rsf = _coerce_float_token(canonical.rsf, 0.0) or 0.0
    building = str(canonical.building_name or "").strip()
    suite = str(canonical.suite or "").strip()
    floor = str(canonical.floor or "").strip()
    opex = _coerce_float_token(canonical.opex_psf_year_1, 0.0) or 0.0
    ti_allowance = _coerce_float_token(canonical.ti_allowance_psf, 0.0) or 0.0
    parking_ratio = _coerce_float_token(canonical.parking_ratio, 0.0) or 0.0
    parking_count = _coerce_int_token(canonical.parking_count, 0) or 0
    parking_rate = _coerce_float_token(canonical.parking_rate_monthly, 0.0) or 0.0

    if comm and exp and exp <= comm:
        _append_review_task(
            tasks,
            field_path="term",
            severity="blocker",
            issue_code="TERM_DATE_ORDER",
            message="Expiration date is on/before commencement date. Confirm lease dates.",
        )
        penalty += 0.25
        warnings.append("Lease dates are inconsistent (expiration is on/before commencement).")

    if comm and exp and term > 0:
        term_from_dates = _month_diff(comm, exp)
        if term_from_dates > 0 and abs(term_from_dates - term) >= 3:
            _append_review_task(
                tasks,
                field_path="term_months",
                severity="warn",
                issue_code="TERM_DATES_MISMATCH",
                message=(
                    f"Term months ({term}) differs from commencement/expiration implied months "
                    f"({term_from_dates}). Review term and expiration."
                ),
            )
            penalty += 0.08
            warnings.append("Lease term and date-derived term do not align. Review term/expiration.")

    if rsf <= 0:
        missing.append("rsf")
        questions.append("Please confirm rentable square footage (RSF).")
    elif rsf < 300 or rsf > 2_000_000:
        _append_review_task(
            tasks,
            field_path="rsf",
            severity="warn",
            issue_code="RSF_OUTLIER",
            message=f"RSF value ({rsf:,.0f}) is an outlier. Confirm premises area.",
        )
        penalty += 0.06

    if not building and not str(canonical.address or "").strip():
        missing.append("building_name")
        questions.append("Please confirm building/property name.")
        if any(token in lower_text for token in ("project:", "building:", "premises:", "re:")):
            _append_review_task(
                tasks,
                field_path="building_name",
                severity="warn",
                issue_code="BUILDING_MISSING",
                message="Building name was not confidently extracted from document headers/premises section.",
            )
            penalty += 0.06
    elif building and _building_name_is_suspicious(building):
        _append_review_task(
            tasks,
            field_path="building_name",
            severity="warn",
            issue_code="BUILDING_NOISY",
            message="Building name looks noisy/overlong and may include non-name clause text.",
            recommended_value=_clean_building_candidate(building, suite_hint=suite),
        )
        penalty += 0.07

    if not suite and not floor and any(token in lower_text for token in ("suite", "floor", "premises")):
        _append_review_task(
            tasks,
            field_path="suite",
            severity="warn",
            issue_code="LOCATION_MISSING",
            message="Suite/floor location was not confidently extracted from premises language.",
        )
        penalty += 0.05

    rent_issue, rent_msg = _rent_schedule_coverage_issues(canonical)
    if rent_issue:
        _append_review_task(
            tasks,
            field_path="rent_schedule",
            severity="blocker" if term > 0 else "warn",
            issue_code="RENT_SCHEDULE_COVERAGE",
            message=rent_msg or "Rent schedule does not cover the lease term.",
        )
        penalty += 0.18 if term > 0 else 0.08
        warnings.append("Rent schedule coverage needs manual review.")

    if opex > 0 and ti_allowance > 0 and abs(opex - ti_allowance) < 0.01:
        _append_review_task(
            tasks,
            field_path="opex_psf_year_1",
            severity="blocker",
            issue_code="OPEX_EQUALS_TIA",
            message=(
                "Operating expenses match TI allowance exactly, which often indicates a field mix-up."
            ),
        )
        penalty += 0.2
        warnings.append("OpEx may be contaminated by TI allowance values. Review OpEx.")

    text_has_opex = any(token in lower_text for token in ("operating expense", "opex", "cam"))
    if text_has_opex and opex <= 0:
        _append_review_task(
            tasks,
            field_path="opex_psf_year_1",
            severity="warn",
            issue_code="OPEX_MISSING",
            message="Document references OpEx/CAM but no year-1 OpEx value was confidently extracted.",
        )
        penalty += 0.07

    text_has_parking = "parking" in lower_text or "transportation:" in lower_text
    if text_has_parking and parking_ratio <= 0 and parking_count <= 0 and parking_rate <= 0:
        _append_review_task(
            tasks,
            field_path="parking",
            severity="warn",
            issue_code="PARKING_MISSING",
            message="Document references parking terms but ratio/count/rate were not confidently extracted.",
        )
        penalty += 0.07
    if parking_ratio > 15:
        _append_review_task(
            tasks,
            field_path="parking_ratio",
            severity="warn",
            issue_code="PARKING_RATIO_OUTLIER",
            message=f"Parking ratio ({parking_ratio:.2f}/1,000) looks unusually high. Confirm ratio.",
        )
        penalty += 0.05
    if parking_rate > 0 and parking_rate > 1500:
        _append_review_task(
            tasks,
            field_path="parking_rate_monthly",
            severity="warn",
            issue_code="PARKING_RATE_OUTLIER",
            message=f"Parking rate (${parking_rate:,.2f}/month) looks unusually high. Confirm value.",
        )
        penalty += 0.05

    # If extracted hints disagree strongly with final canonical values, mark for review.
    hinted_rsf = _coerce_float_token(extracted_hints.get("rsf"), 0.0) or 0.0
    if hinted_rsf > 0 and rsf > 0 and abs(hinted_rsf - rsf) / max(hinted_rsf, rsf) > 0.3:
        _append_review_task(
            tasks,
            field_path="rsf",
            severity="warn",
            issue_code="RSF_HINT_CONFLICT",
            message=f"RSF candidates conflict ({hinted_rsf:,.0f} vs {rsf:,.0f}). Confirm RSF.",
        )
        penalty += 0.06

    penalty = max(0.0, min(0.75, penalty))
    return {
        "review_tasks": tasks,
        "warnings": warnings,
        "missing": list(dict.fromkeys(missing)),
        "questions": list(dict.fromkeys(questions)),
        "penalty": penalty,
    }


def _derive_field_confidence(
    *,
    existing: dict,
    canonical: CanonicalLease,
    extracted_hints: dict,
) -> dict:
    out: dict[str, float] = {}
    for k, v in (existing or {}).items():
        try:
            out[str(k)] = max(0.0, min(1.0, float(v)))
        except (TypeError, ValueError):
            continue

    def set_if_missing(key: str, value: float, *, replace_weak: bool = True) -> None:
        candidate = max(0.0, min(1.0, value))
        if key not in out:
            out[key] = candidate
            return
        if replace_weak:
            try:
                current = float(out.get(key, 0.0) or 0.0)
            except (TypeError, ValueError):
                current = 0.0
            if current <= 0.05:
                out[key] = candidate

    rsf = _coerce_float_token(canonical.rsf, 0.0) or 0.0
    hinted_rsf = _coerce_float_token(extracted_hints.get("rsf"), 0.0) or 0.0
    if rsf <= 0:
        set_if_missing("rsf", 0.2)
    elif hinted_rsf > 0 and abs(rsf - hinted_rsf) / max(rsf, hinted_rsf) < 0.1:
        set_if_missing("rsf", 0.95)
    else:
        set_if_missing("rsf", 0.75)

    for key in ("commencement_date", "expiration_date"):
        cv = getattr(canonical, key, None)
        hv = extracted_hints.get(key)
        if cv and hv and str(cv) == str(hv):
            set_if_missing(key, 0.92)
        elif cv:
            set_if_missing(key, 0.75)
        else:
            set_if_missing(key, 0.2)

    term = _coerce_int_token(canonical.term_months, 0) or 0
    hinted_term = _coerce_int_token(extracted_hints.get("term_months"), 0) or 0
    if term <= 0:
        set_if_missing("term_months", 0.2)
    elif hinted_term > 0 and abs(term - hinted_term) <= 2:
        set_if_missing("term_months", 0.9)
    else:
        set_if_missing("term_months", 0.72)

    building = str(canonical.building_name or "").strip()
    if not building:
        set_if_missing("building_name", 0.2)
    elif _building_name_is_suspicious(building):
        set_if_missing("building_name", 0.35)
    else:
        set_if_missing("building_name", 0.88)

    suite = str(canonical.suite or "").strip()
    floor = str(canonical.floor or "").strip()
    set_if_missing("suite", 0.85 if suite else 0.35)
    set_if_missing("floor", 0.85 if floor else 0.35)
    set_if_missing("address", 0.82 if str(canonical.address or "").strip() else 0.4)

    opex = _coerce_float_token(canonical.opex_psf_year_1, 0.0) or 0.0
    set_if_missing("opex_psf_year_1", 0.84 if opex > 0 else 0.35)
    ti_allowance = _coerce_float_token(canonical.ti_allowance_psf, 0.0) or 0.0
    set_if_missing("ti_allowance_psf", 0.84 if ti_allowance > 0 else 0.7)
    free_rent_months = _coerce_int_token(canonical.free_rent_months, 0) or 0
    set_if_missing("free_rent_months", 0.84 if free_rent_months > 0 else 0.7)
    parking_ratio = _coerce_float_token(canonical.parking_ratio, 0.0) or 0.0
    parking_count = _coerce_int_token(canonical.parking_count, 0) or 0
    parking_rate = _coerce_float_token(canonical.parking_rate_monthly, 0.0) or 0.0
    set_if_missing("parking_ratio", 0.82 if parking_ratio > 0 else 0.35)
    set_if_missing("parking_rate_monthly", 0.82 if parking_rate > 0 else 0.35)
    set_if_missing("parking_count", 0.82 if parking_count > 0 else 0.7)
    set_if_missing("parking_sales_tax_rate", 0.82)
    rent_steps = list(getattr(canonical, "rent_schedule", []) or [])
    set_if_missing("rent_schedule", 0.88 if rent_steps else 0.2)
    return out


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


def _empty_extraction_artifacts() -> dict:
    return {
        "canonical_extraction": {},
        "provenance": {},
        "review_tasks": [],
        "export_allowed": True,
        "extraction_confidence": {},
    }


def _canonical_opex_mode_for_extraction(canonical: CanonicalLease) -> str:
    lease_type = str(canonical.lease_type.value if hasattr(canonical.lease_type, "value") else canonical.lease_type).strip().lower()
    expense_type = str(
        canonical.expense_structure_type.value
        if hasattr(canonical.expense_structure_type, "value")
        else canonical.expense_structure_type
    ).strip().lower()
    if expense_type in {"base_year", "gross_with_stop"} or any(k in lease_type for k in ("modified gross", "base year", "expense stop")):
        return "base_year"
    if any(k in lease_type for k in ("full service", "gross")) and "modified" not in lease_type:
        return "full_service"
    return "nnn"


def _canonical_only_extraction(canonical: CanonicalLease, *, doc_type: str = "unknown") -> dict:
    return {
        "document": {
            "doc_type": doc_type,
            "doc_role": "unknown",
            "confidence": 0.55,
            "evidence_spans": [],
        },
        "term": {
            "commencement_date": str(canonical.commencement_date),
            "expiration_date": str(canonical.expiration_date),
            "rent_commencement_date": str(canonical.commencement_date),
            "term_months": int(canonical.term_months),
        },
        "premises": {
            "building_name": canonical.building_name or None,
            "suite": canonical.suite or None,
            "floor": canonical.floor or None,
            "address": canonical.address or None,
            "rsf": float(canonical.rsf),
        },
        "rent_steps": [
            {
                "start_month": int(step.start_month),
                "end_month": int(step.end_month),
                "rate_psf_annual": float(step.rent_psf_annual),
                "source": "canonical_normalizer",
                "source_confidence": 0.9,
            }
            for step in canonical.rent_schedule
        ],
        "abatements": [
            {
                "start_month": int(p.start_month),
                "end_month": int(p.end_month),
                "scope": "gross_rent" if str(canonical.free_rent_scope).lower().startswith("gross") else "base_rent_only",
                "source": "canonical_normalizer",
            }
            for p in canonical.free_rent_periods
        ],
        "parking_abatements": [
            {
                "start_month": int(p.start_month),
                "end_month": int(p.end_month),
                "scope": "parking_only",
                "source": "canonical_normalizer",
            }
            for p in getattr(canonical, "parking_abatement_periods", []) or []
        ],
        "opex": {
            "mode": _canonical_opex_mode_for_extraction(canonical),
            "base_psf_year_1": float(canonical.opex_psf_year_1),
            "growth_rate": float(canonical.opex_growth_rate),
            "cues": [],
        },
        "provenance": {},
        "review_tasks": [],
        "evidence": [],
        "confidence": {
            "overall": 0.8,
            "status": "yellow",
            "export_allowed": True,
            "validation_pass_rate": 1.0,
            "reconcile_margin": 1.0,
        },
        "export_allowed": True,
    }


def _run_extraction_artifacts(
    *,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    canonical: CanonicalLease,
) -> dict:
    if len(file_bytes) > MAX_EXTRACTION_ARTIFACTS_BYTES:
        _LOG.warning(
            "extraction_pipeline_skipped_large_file file=%s size=%d limit=%d",
            filename,
            len(file_bytes),
            MAX_EXTRACTION_ARTIFACTS_BYTES,
        )
        return {
            "canonical_extraction": _canonical_only_extraction(canonical, doc_type="unknown"),
            "provenance": {},
            "review_tasks": [
                {
                    "field_path": "pipeline",
                    "severity": "warn",
                    "issue_code": "PIPELINE_SKIPPED_LARGE_FILE",
                    "message": (
                        "Deep extraction checks were skipped for a large file to keep memory usage stable."
                    ),
                    "candidates": [],
                    "recommended_value": None,
                    "evidence": [],
                }
            ],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.7, "status": "yellow", "export_allowed": True},
        }

    try:
        extraction = build_extract_response(
            file_bytes=file_bytes,
            filename=filename,
            content_type=content_type,
            canonical_lease=canonical,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("extraction_pipeline_failed file=%s err=%s", filename, exc)
        return {
            "canonical_extraction": _canonical_only_extraction(canonical, doc_type="unknown"),
            "provenance": {},
            "review_tasks": [
                {
                    "field_path": "pipeline",
                    "severity": "warn",
                    "issue_code": "PIPELINE_FALLBACK",
                    "message": "Extraction pipeline fallback was used due to a backend processing issue.",
                    "candidates": [],
                    "recommended_value": None,
                    "evidence": [],
                }
            ],
            "export_allowed": True,
            "extraction_confidence": {"overall": 0.55, "status": "yellow", "export_allowed": True},
        }

    return {
        "canonical_extraction": extraction,
        "provenance": extraction.get("provenance") or {},
        "review_tasks": extraction.get("review_tasks") or [],
        "export_allowed": bool(extraction.get("export_allowed", True)),
        "extraction_confidence": extraction.get("confidence") or {},
    }


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
    extraction_artifacts: dict = _empty_extraction_artifacts()
    extraction_text_for_summary = ""
    extraction_filename_for_summary = ""
    doc_type_hint = "unknown"
    option_variants: list[CanonicalLease] = []

    if source_upper in ("PDF", "WORD"):
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="File required for PDF/WORD")
        extraction_filename_for_summary = file.filename or ""
        fn = file.filename.lower()
        if source_upper == "PDF" and not fn.endswith(".pdf"):
            raise HTTPException(status_code=400, detail="File must be PDF")
        if source_upper == "WORD" and not (fn.endswith(".docx") or fn.endswith(".doc")):
            raise HTTPException(status_code=400, detail="File must be DOCX or DOC")
        try:
            contents = file.file.read()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read file: {e}") from e
        _LOG.info("NORMALIZE_FILE rid=%s filename=%s size=%s", rid, file.filename or "", len(contents))
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(contents) > MAX_NORMALIZE_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"File too large for normalization ({len(contents)} bytes). "
                    f"Limit is {MAX_NORMALIZE_UPLOAD_BYTES} bytes."
                ),
            )
        buf = BytesIO(contents)
        text = ""
        word_source = "docx"
        ocr_used = False
        used_fallback = False
        try:
            if fn.endswith(".pdf"):
                text = extract_text_from_pdf(buf)
                allow_ocr = len(contents) <= SKIP_OCR_ABOVE_BYTES
                if allow_ocr and text_quality_requires_ocr(text):
                    buf.seek(0)
                    pages = max(1, SAFE_OCR_MAX_PAGES)
                    try:
                        text, _ = extract_text_from_pdf_with_ocr(buf, force_ocr=True, ocr_pages=pages)
                        ocr_used = True
                        warnings.append("OCR was used because extracted text was short or low quality.")
                    except Exception:
                        # OCR dependencies may be unavailable in local/dev; continue with text extraction fallback.
                        warnings.append("OCR was unavailable; continued with standard PDF text extraction.")
                elif not allow_ocr:
                    warnings.append(
                        "OCR was skipped for this large PDF to keep processing stable; native PDF text extraction was used."
                    )
            else:
                text, word_source = extract_text_from_word(buf, file.filename or "")
        except Exception as e:
            text = ""
            warnings.append(_safe_extraction_warning(e))
        extraction_text_for_summary = text or ""
        doc_type_hint = _detect_document_type(text, file.filename or "") if text.strip() else "unknown"

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
                extraction = extract_scenario_from_text(text, "pdf_text" if fn.endswith(".pdf") else word_source)
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
                    if any("fallback" in str(w).lower() for w in (extraction.warnings or [])):
                        used_fallback = True
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
            else:
                current_rsf_val = _coerce_float_token(updates.get("rsf", canonical.rsf), 0.0) or 0.0
                rsf_has_explicit_evidence = bool(
                    re.search(
                        r"(?i)\b\d{1,3}(?:,\d{3})+\s*(?:rsf|rentable\s+square\s+feet|square\s*feet|sf)\b",
                        text,
                    )
                )
                if (
                    current_rsf_val > 0
                    and hinted_rsf is None
                    and doc_type_hint in {"amendment", "lease"}
                    and not rsf_has_explicit_evidence
                ):
                    warnings.append(
                        "RSF was not explicitly stated in this document; retained inferred RSF value."
                    )
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
            hint_parking_periods = extracted_hints.get("parking_abatement_periods")
            if isinstance(hint_parking_periods, list) and hint_parking_periods:
                parking_periods: list[ParkingAbatementPeriod] = []
                for period in hint_parking_periods:
                    if not isinstance(period, dict):
                        continue
                    start_month = _coerce_int_token(period.get("start_month"), None)
                    end_month = _coerce_int_token(period.get("end_month"), start_month)
                    if start_month is None or end_month is None:
                        continue
                    start_i = max(0, int(start_month))
                    end_i = max(start_i, int(end_month))
                    if term_for_free > 0:
                        term_max = max(0, term_for_free - 1)
                        start_i = min(start_i, term_max)
                        end_i = min(end_i, term_max)
                    parking_periods.append(ParkingAbatementPeriod(start_month=start_i, end_month=end_i))
                if parking_periods:
                    updates["parking_abatement_periods"] = parking_periods
            suite_hint_val = str(extracted_hints.get("suite") or "").strip()
            floor_hint_val = str(extracted_hints.get("floor") or "").strip()
            suite_val = suite_hint_val or str(canonical.suite or "").strip()
            force_suite_blank = bool(floor_hint_val and not suite_hint_val)
            if force_suite_blank:
                # Floors-only premises should not retain letterhead/notice suites from weak extraction.
                updates["suite"] = ""
                suite_val = ""
            if not suite_val and not force_suite_blank:
                suite_val = _extract_suite_from_text(str(canonical.premises_name or ""))
            suite_val = _normalize_suite_candidate(suite_val)
            floor_val = _normalize_floor_candidate(floor_hint_val or str(canonical.floor or "").strip())
            if floor_val and (floor_hint_val or not (canonical.floor or "").strip() or not suite_val):
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
                scenario_name_fallback = str(canonical.scenario_name or "").strip()
                if scenario_name_fallback and not _looks_like_generic_scenario_name(scenario_name_fallback):
                    scenario_name_fallback = re.sub(
                        r"(?i)\s+(?:suite|ste\.?|unit|space|floor)\s+[A-Za-z0-9\-]+.*$",
                        "",
                        scenario_name_fallback,
                    ).strip(" ,.-")
                    building_val = _clean_building_candidate(scenario_name_fallback, suite_hint=suite_val)
            if not building_val:
                building_val = _fallback_building_from_filename(file.filename or "")
            if not building_val:
                building_val = _clean_building_candidate(re.sub(r"[_\-]+", " ", Path(file.filename or "").stem))
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
            should_replace_scenario_name = _looks_like_generic_scenario_name(scenario_name_val)
            if (
                not should_replace_scenario_name
                and re.search(r"(?i)\bin\s+the\s+building\s+known\s+as\b", scenario_name_val)
            ):
                should_replace_scenario_name = True
            if not should_replace_scenario_name and suite_val:
                scenario_suite = _extract_suite_from_text(scenario_name_val)
                if scenario_suite and _normalize_suite_candidate(scenario_suite) != suite_val:
                    should_replace_scenario_name = True
            if (
                not should_replace_scenario_name
                and floor_hint_val
                and not suite_hint_val
                and re.search(r"(?i)\bsuite\b", scenario_name_val)
            ):
                should_replace_scenario_name = True
            if (
                not should_replace_scenario_name
                and not suite_val
                and re.search(r"(?i)\bsuite\s+[A-Za-z]{3,}\b", scenario_name_val)
            ):
                should_replace_scenario_name = True
            if should_replace_scenario_name:
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
            elif doc_type_hint in {"amendment", "lease"}:
                existing_opex = _coerce_float_token(updates.get("opex_psf_year_1", canonical.opex_psf_year_1), 0.0) or 0.0
                opex_has_explicit_evidence = bool(
                    re.search(r"(?i)\b(?:operating\s+expenses?|opex|cam|common\s+area\s+maintenance)\b", text)
                )
                if existing_opex > 0 and not opex_has_explicit_evidence:
                    warnings.append(
                        "OpEx was not explicitly stated in this document; retained inferred OpEx value."
                    )
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
                                f"OpEx table provided through {prior_year}; using ${year_rate:,.2f}/SF as the starting OpEx."
                            )
            hinted_ti_allowance = _coerce_float_token(extracted_hints.get("ti_allowance_psf"), 0.0) or 0.0
            if hinted_ti_allowance <= 0:
                hinted_ti_allowance_total = _coerce_float_token(extracted_hints.get("ti_allowance_total"), 0.0) or 0.0
                effective_rsf_for_ti = _coerce_float_token(updates.get("rsf", canonical.rsf), 0.0) or 0.0
                if hinted_ti_allowance_total > 0 and effective_rsf_for_ti > 0:
                    hinted_ti_allowance = hinted_ti_allowance_total / effective_rsf_for_ti
            if hinted_ti_allowance > 0:
                updates["ti_allowance_psf"] = hinted_ti_allowance
                updates["ti_source_of_truth"] = "psf"

            hinted_parking_ratio = _coerce_float_token(extracted_hints.get("parking_ratio"), 0.0)
            hinted_parking_count = _coerce_int_token(extracted_hints.get("parking_count"), 0)
            ratio_evidence = bool(hinted_parking_ratio and hinted_parking_ratio > 0)
            count_evidence = bool(hinted_parking_count and hinted_parking_count > 0)
            if hinted_parking_ratio > 0:
                updates["parking_ratio"] = hinted_parking_ratio
            hinted_parking_rate = _coerce_float_token(extracted_hints.get("parking_rate_monthly"), 0.0)
            if hinted_parking_rate > 0:
                updates["parking_rate_monthly"] = hinted_parking_rate
            if hinted_parking_count > 0:
                updates["parking_count"] = hinted_parking_count

            effective_rsf = _coerce_float_token(updates.get("rsf", canonical.rsf), 0.0)
            parking_rsf_score = hinted_rsf_score if extracted_hints.get("_rsf_score") is not None else 0
            rsf_for_parking_alignment = (
                effective_rsf if parking_rsf_score >= -8 or rsf_conf >= 0.75 else 0.0
            )
            current_ratio = _coerce_float_token(updates.get("parking_ratio", canonical.parking_ratio), 0.0)
            current_count = _coerce_int_token(updates.get("parking_count", canonical.parking_count), 0)
            prefer_source = "count" if count_evidence and not ratio_evidence else "ratio"
            if not ratio_evidence and not count_evidence and (current_count or 0) > 0 and (current_ratio or 0.0) <= 0:
                prefer_source = "count"
            aligned_parking_ratio, aligned_parking_count = _reconcile_parking_ratio_and_count(
                parking_ratio=current_ratio,
                parking_count=current_count,
                rsf=rsf_for_parking_alignment,
                prefer=prefer_source,
            )
            if aligned_parking_ratio > 0:
                updates["parking_ratio"] = aligned_parking_ratio
            if aligned_parking_count > 0:
                updates["parking_count"] = aligned_parking_count

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
                updates["notes"] = _pack_notes_for_storage(
                    note_highlights,
                    max_total_chars=1600,
                    max_line_chars=190,
                )
            elif text.strip() and not (canonical.notes or "").strip():
                updates["notes"] = (
                    "No ROFR/ROFO/renewal/OpEx-exclusion clauses were confidently detected. "
                    "Review lease clauses manually."
                )
            if extra_note_lines:
                updates["notes"] = _pack_notes_for_storage(
                    [],
                    extra_note_lines=extra_note_lines,
                    existing_notes=str(updates.get("notes") or canonical.notes or "").strip(),
                    max_total_chars=1600,
                    max_line_chars=190,
                )
            current_discount = _coerce_float_token(
                updates.get("discount_rate_annual"),
                _coerce_float_token(canonical.discount_rate_annual, 0.0),
            )
            # Default discount should be 8% unless explicitly set otherwise.
            if current_discount <= 0 or abs(current_discount - 0.06) < 1e-9:
                updates["discount_rate_annual"] = 0.08
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
        option_variants = _build_canonical_option_variants(
            canonical=canonical,
            extracted_hints=extracted_hints,
            filename=file.filename or "",
        )
        conf_from_missing, missing, questions = _compute_confidence_and_missing(canonical)
        if used_fallback:
            confidence_score = min(confidence_score, conf_from_missing)
            if not questions:
                questions = [
                    "Please confirm lease name, RSF, commencement, expiration, and base rent schedule.",
                ]
        else:
            confidence_score = max(confidence_score, conf_from_missing)
        supplemental_checks = _supplemental_quality_checks(
            canonical=canonical,
            text=extraction_text_for_summary,
            extracted_hints=extracted_hints,
        )
        supplemental_missing = list(supplemental_checks.get("missing") or [])
        supplemental_questions = list(supplemental_checks.get("questions") or [])
        for f in supplemental_missing:
            if f and f not in missing:
                missing.append(f)
        for q in supplemental_questions:
            if q and q not in questions:
                questions.append(q)
        for w in list(supplemental_checks.get("warnings") or []):
            if w and w not in warnings:
                warnings.append(w)
        confidence_score = max(0.0, min(1.0, float(confidence_score) - float(supplemental_checks.get("penalty") or 0.0)))
        field_confidence = _derive_field_confidence(
            existing=field_confidence,
            canonical=canonical,
            extracted_hints=extracted_hints,
        )
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
        extraction_artifacts = _run_extraction_artifacts(
            file_bytes=contents,
            filename=file.filename or "uploaded.pdf",
            content_type=(
                "application/pdf"
                if fn.endswith(".pdf")
                else ("application/msword" if fn.endswith(".doc") else "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            ),
            canonical=canonical,
        )
        merged_review_tasks = _merge_review_tasks(
            list(extraction_artifacts.get("review_tasks") or []),
            list(supplemental_checks.get("review_tasks") or []),
        )
        extraction_artifacts["review_tasks"] = merged_review_tasks
        blockers = [
            t for t in merged_review_tasks
            if str((t or {}).get("severity") or "").lower() == "blocker"
        ]
        warns = [
            t for t in merged_review_tasks
            if str((t or {}).get("severity") or "").lower() == "warn"
        ]
        if blockers:
            extraction_artifacts["export_allowed"] = False
        if blockers:
            warnings.append(f"Extraction produced {len(blockers)} blocker(s); manual review is required.")
        extraction_confidence_payload = dict(extraction_artifacts.get("extraction_confidence") or {})
        base_overall = _coerce_float_token(extraction_confidence_payload.get("overall"), confidence_score) or confidence_score
        overall = max(0.0, min(1.0, min(float(base_overall), float(confidence_score))))
        status = "red" if blockers else ("yellow" if warns or overall < 0.85 else "green")
        extraction_confidence_payload["overall"] = round(overall, 4)
        extraction_confidence_payload["status"] = status
        extraction_confidence_payload["export_allowed"] = bool(extraction_artifacts.get("export_allowed", True))
        extraction_artifacts["extraction_confidence"] = extraction_confidence_payload
        return (
            NormalizerResponse(
                canonical_lease=canonical,
                option_variants=option_variants,
                confidence_score=min(1.0, confidence_score),
                field_confidence=field_confidence,
                missing_fields=missing,
                clarification_questions=questions,
                warnings=warnings,
                extraction_summary=extraction_summary,
                provenance=extraction_artifacts.get("provenance") or {},
                review_tasks=extraction_artifacts.get("review_tasks") or [],
                export_allowed=bool(extraction_artifacts.get("export_allowed", True)),
                extraction_confidence=extraction_artifacts.get("extraction_confidence") or {},
                canonical_extraction=extraction_artifacts.get("canonical_extraction") or {},
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
        pasted_checks = _supplemental_quality_checks(
            canonical=canonical,
            text=raw,
            extracted_hints={},
        )
        for f in list(pasted_checks.get("missing") or []):
            if f and f not in missing:
                missing.append(f)
        for q in list(pasted_checks.get("questions") or []):
            if q and q not in questions:
                questions.append(q)
        for w in list(pasted_checks.get("warnings") or []):
            if w and w not in warnings:
                warnings.append(w)
        confidence_score = max(0.0, min(1.0, confidence_score - float(pasted_checks.get("penalty") or 0.0)))
        field_confidence = _derive_field_confidence(existing=field_confidence, canonical=canonical, extracted_hints={})
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
        extraction_artifacts = {
            "canonical_extraction": _canonical_only_extraction(canonical, doc_type=doc_type),
            "provenance": {},
            "review_tasks": list(pasted_checks.get("review_tasks") or []),
            "export_allowed": not any(
                str((t or {}).get("severity") or "").lower() == "blocker"
                for t in list(pasted_checks.get("review_tasks") or [])
            ),
            "extraction_confidence": {
                "overall": min(1.0, confidence_score),
                "status": "red"
                if any(str((t or {}).get("severity") or "").lower() == "blocker" for t in list(pasted_checks.get("review_tasks") or []))
                else "yellow",
                "export_allowed": not any(
                    str((t or {}).get("severity") or "").lower() == "blocker"
                    for t in list(pasted_checks.get("review_tasks") or [])
                ),
            },
        }
        return (
            NormalizerResponse(
                canonical_lease=canonical,
                confidence_score=min(1.0, confidence_score),
                field_confidence=field_confidence,
                missing_fields=missing,
                clarification_questions=questions,
                warnings=warnings,
                extraction_summary=extraction_summary,
                provenance=extraction_artifacts.get("provenance") or {},
                review_tasks=extraction_artifacts.get("review_tasks") or [],
                export_allowed=bool(extraction_artifacts.get("export_allowed", True)),
                extraction_confidence=extraction_artifacts.get("extraction_confidence") or {},
                canonical_extraction=extraction_artifacts.get("canonical_extraction") or {},
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
    manual_checks = _supplemental_quality_checks(
        canonical=canonical,
        text=raw_payload,
        extracted_hints={},
    )
    for f in list(manual_checks.get("missing") or []):
        if f and f not in missing:
            missing.append(f)
    for q in list(manual_checks.get("questions") or []):
        if q and q not in questions:
            questions.append(q)
    for w in list(manual_checks.get("warnings") or []):
        if w and w not in warnings:
            warnings.append(w)
    confidence_score = max(0.0, min(1.0, confidence_score - float(manual_checks.get("penalty") or 0.0)))
    field_confidence = _derive_field_confidence(existing=field_confidence, canonical=canonical, extracted_hints={})
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
    extraction_artifacts = {
        "canonical_extraction": _canonical_only_extraction(canonical, doc_type=doc_type),
        "provenance": {},
        "review_tasks": list(manual_checks.get("review_tasks") or []),
        "export_allowed": not any(
            str((t or {}).get("severity") or "").lower() == "blocker"
            for t in list(manual_checks.get("review_tasks") or [])
        ),
        "extraction_confidence": {
            "overall": min(1.0, confidence_score),
            "status": "red"
            if any(str((t or {}).get("severity") or "").lower() == "blocker" for t in list(manual_checks.get("review_tasks") or []))
            else "yellow",
            "export_allowed": not any(
                str((t or {}).get("severity") or "").lower() == "blocker"
                for t in list(manual_checks.get("review_tasks") or [])
            ),
        },
    }
    return (
        NormalizerResponse(
            canonical_lease=canonical,
            confidence_score=min(1.0, confidence_score),
            field_confidence=field_confidence,
            missing_fields=missing,
            clarification_questions=questions,
            warnings=warnings,
            extraction_summary=extraction_summary,
            provenance=extraction_artifacts.get("provenance") or {},
            review_tasks=extraction_artifacts.get("review_tasks") or [],
            export_allowed=bool(extraction_artifacts.get("export_allowed", True)),
            extraction_confidence=extraction_artifacts.get("extraction_confidence") or {},
            canonical_extraction=extraction_artifacts.get("canonical_extraction") or {},
        ),
        False,  # used_ai: MANUAL/JSON does not use AI
    )


@app.post("/api/extract-lease")
async def extract_lease_canonical(request: Request):
    """
    Authenticated binary extractor endpoint.
    Accepts raw PDF/DOCX/DOC bytes and returns canonical extraction JSON with provenance,
    review tasks, confidence, and export_allowed gating.
    """
    user = _require_supabase_user(request)
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Request body is empty")

    content_type = (request.headers.get("content-type") or "application/pdf").split(";", 1)[0].strip().lower()
    if content_type not in {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "application/octet-stream",
    }:
        raise HTTPException(
            status_code=415,
            detail="Unsupported content-type. Use application/pdf, DOCX mime type, or application/msword.",
        )

    filename_header = (request.headers.get("x-filename") or "").strip()
    if filename_header:
        filename = filename_header
    elif "wordprocessingml" in content_type:
        filename = "upload.docx"
    elif content_type == "application/msword":
        filename = "upload.doc"
    else:
        filename = "upload.pdf"

    extraction = build_extract_response(
        file_bytes=body,
        filename=filename,
        content_type=content_type,
        canonical_lease=None,
    )

    blockers = [t for t in extraction.get("review_tasks", []) if str(t.get("severity") or "").lower() == "blocker"]
    _LOG.info(
        "extract_lease_complete user_id=%s doc_type=%s doc_role=%s gated_fields=%s export_allowed=%s validation_status=%s",
        user.get("id") or "",
        ((extraction.get("document") or {}).get("doc_type") or "unknown"),
        ((extraction.get("document") or {}).get("doc_role") or "unknown"),
        len(blockers),
        extraction.get("export_allowed"),
        ((extraction.get("confidence") or {}).get("status") or "unknown"),
    )

    return {
        "canonical_extraction": extraction,
        "provenance": extraction.get("provenance") or {},
        "review_tasks": extraction.get("review_tasks") or [],
        "confidence": extraction.get("confidence") or {},
        "export_allowed": bool(extraction.get("export_allowed", False)),
    }


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
def create_report(req: CreateReportRequest, request: Request) -> CreateReportResponse:
    """
    Store a report (scenarios + results + optional branding) and return reportId.
    """
    user = _require_supabase_user(request)
    user_id = user["id"]
    resolved_branding = _resolve_branding(request, user)
    logging.getLogger("uvicorn.error").info(
        "export_branding auth_present=%s user_id=%s user_settings_row_found=%s brokerage_logo_url_present=%s resolved_branding_source=%s resolved_logo_bytes_length=%s",
        resolved_branding.get("auth_present") or "true",
        resolved_branding.get("user_id") or user_id,
        resolved_branding.get("user_settings_row_found") or "false",
        resolved_branding.get("brokerage_logo_url_present") or "false",
        resolved_branding.get("source") or "default",
        len(resolved_branding.get("logo_bytes") or b""),
    )

    branding = req.branding.model_dump(exclude_none=True) if req.branding else {}
    # Never trust brokerage/org branding keys from client.
    for key in (
        "org_id",
        "orgId",
        "brand_name",
        "brandName",
        "broker_name",
        "brokerName",
        "prepared_by_company",
        "preparedByCompany",
        "logo_asset_bytes",
        "logoAssetBytes",
        "logoAssetBase64",
        "logo_asset_url",
        "logoAssetUrl",
        "logo_url",
        "logo_storage_path",
        "logoStoragePath",
    ):
        branding.pop(key, None)

    effective_brokerage_name = str(resolved_branding.get("brokerage_name") or "").strip() or DEFAULT_CREMODEL_BRAND_NAME
    branding["org_id"] = user_id
    branding["brand_name"] = effective_brokerage_name
    branding["broker_name"] = effective_brokerage_name
    branding["prepared_by_company"] = effective_brokerage_name

    logo_bytes = resolved_branding.get("logo_bytes")
    if isinstance(logo_bytes, (bytes, bytearray)) and logo_bytes:
        branding["logo_asset_bytes"] = base64.b64encode(bytes(logo_bytes)).decode("ascii")
    logo_path = str(resolved_branding.get("logo_storage_path") or "").strip()
    if logo_path:
        branding["logo_storage_path"] = logo_path

    if not branding.get("theme_hash"):
        branding["theme_hash"] = _branding_theme_hash(branding)

    data = {
        "scenarios": [{"scenario": e.scenario, "result": e.result.model_dump()} for e in req.scenarios],
        "branding": branding,
        "owner_user_id": user_id,
    }
    report_id = save_report(data)
    return CreateReportResponse(report_id=report_id)


@app.get("/reports/{report_id}")
def get_report(report_id: str, request: Request):
    """
    Return stored report JSON for the report page to consume.
    """
    user = _require_supabase_user(request)
    data = load_report(report_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Report not found")
    owner_user_id = str((data or {}).get("owner_user_id") or "").strip()
    if owner_user_id and owner_user_id != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    return data


@app.get("/reports/{report_id}/preview", response_class=HTMLResponse)
def get_report_preview(report_id: str, request: Request):
    """
    Return a print-friendly multi-scenario deck HTML from stored report payload.
    Useful as a fallback when PDF rendering is unavailable.
    """
    user = _require_supabase_user(request)
    data = load_report(report_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Report not found")
    owner_user_id = str((data or {}).get("owner_user_id") or "").strip()
    if owner_user_id and owner_user_id != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    from reporting.deck_builder import build_report_deck_html

    return HTMLResponse(
        build_report_deck_html(data),
        headers={"Cache-Control": "no-store"},
    )


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
    from reporting.deck_builder import build_report_deck_html

    return build_report_deck_html(data)

    entries = data.get("scenarios") if isinstance(data, dict) else []
    if not isinstance(entries, list):
        entries = []
    if not entries:
        return """<!doctype html><html><body><h1>No scenarios found</h1></body></html>"""

    branding = data.get("branding") if isinstance(data, dict) and isinstance(data.get("branding"), dict) else {}
    prepared_for = str(branding.get("client_name") or "Client")
    prepared_by = str(branding.get("broker_name") or "The CRE Model")
    report_date = str(branding.get("date") or date.today().isoformat())
    market = str(branding.get("market") or "N/A")
    submarket = str(branding.get("submarket") or "N/A")

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
    .kpis {{ display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }}
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
      <div class="kpi"><p class="kpi-label">Prepared for</p><p class="kpi-value">{html.escape(prepared_for)}</p></div>
      <div class="kpi"><p class="kpi-label">Prepared by</p><p class="kpi-value">{html.escape(prepared_by)}</p></div>
      <div class="kpi"><p class="kpi-label">Report date</p><p class="kpi-value">{html.escape(report_date)}</p></div>
      <div class="kpi"><p class="kpi-label">Market</p><p class="kpi-value">{html.escape(market)}</p></div>
      <div class="kpi"><p class="kpi-label">Submarket</p><p class="kpi-value">{html.escape(submarket)}</p></div>
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


def _branding_theme_hash(branding: dict) -> str:
    payload = {
        "org_id": branding.get("org_id") or branding.get("orgId") or "",
        "brand_name": branding.get("brand_name") or branding.get("brandName") or "",
        "logo_asset_bytes": branding.get("logo_asset_bytes") or branding.get("logoAssetBytes") or "",
        "logo_asset_url": branding.get("logo_asset_url") or branding.get("logoAssetUrl") or branding.get("logo_url") or "",
        "primary_color": branding.get("primary_color") or branding.get("primaryColor") or "",
        "header_text": branding.get("header_text") or branding.get("headerText") or "",
        "footer_text": branding.get("footer_text") or branding.get("footerText") or "",
    }
    encoded = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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


@app.post("/report/deck")
def build_report_deck_pdf_endpoint(req: CreateReportRequest) -> Response:
    """
    Build multi-scenario deck PDF directly from payload (no persisted report_id hop).
    """
    data = {
        "scenarios": [{"scenario": entry.scenario, "result": entry.result.model_dump()} for entry in req.scenarios],
        "branding": req.branding.model_dump(exclude_none=True) if req.branding else {},
    }
    branding = data.get("branding") if isinstance(data.get("branding"), dict) else {}
    org_id = str(branding.get("org_id") or branding.get("orgId") or "public")
    theme_hash = str(branding.get("theme_hash") or branding.get("themeHash") or _branding_theme_hash(branding))

    cached_deck_pdf = get_cached_report_deck(data, org_id, theme_hash)
    if cached_deck_pdf is not None:
        return Response(
            content=cached_deck_pdf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'inline; filename="lease-deck.pdf"',
                "Cache-Control": "no-store",
            },
        )

    try:
        from reporting.deck_builder import render_report_deck_pdf
        pdf_bytes = render_report_deck_pdf(data)
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Playwright not installed. Run: pip install playwright && playwright install chromium",
        )
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
                    "Install Playwright system libraries in Docker image."
                ),
            )
        raise HTTPException(
            status_code=500,
            detail="Deck PDF generation failed. Use /report/preview or /reports/{report_id}/preview to inspect rendered HTML.",
        ) from e

    set_cached_report_deck(data, org_id, theme_hash, pdf_bytes)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="lease-deck.pdf"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/reports/{report_id}/pdf")
def get_report_pdf(report_id: str, request: Request):
    """
    Render a deterministic, template-based multi-scenario deck PDF.
    """
    user = _require_supabase_user(request)
    data = load_report(report_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Report not found")
    owner_user_id = str((data or {}).get("owner_user_id") or "").strip()
    if owner_user_id and owner_user_id != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    branding = data.get("branding") if isinstance(data, dict) and isinstance(data.get("branding"), dict) else {}
    org_id = str(branding.get("org_id") or branding.get("orgId") or "public")
    theme_hash = str(branding.get("theme_hash") or branding.get("themeHash") or _branding_theme_hash(branding))

    cached_deck_pdf = get_cached_report_deck(data, org_id, theme_hash)
    if cached_deck_pdf is not None:
        return Response(
            content=cached_deck_pdf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="lease-deck-{report_id[:8]}.pdf"',
                "Cache-Control": "no-store",
            },
        )

    try:
        from reporting.deck_builder import render_report_deck_pdf
        pdf_bytes = render_report_deck_pdf(data)
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Playwright not installed. Run: pip install playwright && playwright install chromium",
        )
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
                    "Install Playwright system libraries in Docker image."
                ),
            )
        raise HTTPException(
            status_code=500,
            detail="Deck PDF generation failed. Use /reports/{report_id}/preview to inspect rendered HTML.",
        ) from e

    set_cached_report_deck(data, org_id, theme_hash, pdf_bytes)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="lease-deck-{report_id[:8]}.pdf"',
            "Cache-Control": "no-store",
        },
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
