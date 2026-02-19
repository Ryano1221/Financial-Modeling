"""
File-hash disk cache for extraction and report generation.
Extraction: key = sha256(file_bytes + force_ocr) -> ExtractionResponse JSON.
Report: key = sha256(scenario_json + brand_id + meta_json) -> PDF bytes.
Report deck: key = sha256(report_payload + org_id + theme_hash) -> PDF bytes.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

# Cache directory under backend/cache
_CACHE_DIR = Path(__file__).resolve().parent
EXTRACTION_CACHE_DIR = _CACHE_DIR / "extraction"
REPORT_CACHE_DIR = _CACHE_DIR / "reports"
REPORT_DECK_CACHE_DIR = _CACHE_DIR / "report_decks"


def _ensure_dir(d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)


def _extraction_key(file_bytes: bytes, force_ocr: bool | str) -> str:
    """force_ocr: True, False, or 'auto' for auto-OCR decision."""
    h = hashlib.sha256(file_bytes).hexdigest()
    return hashlib.sha256((h + "|" + str(force_ocr)).encode()).hexdigest()


def get_cached_extraction(file_bytes: bytes, force_ocr: bool | str) -> dict[str, Any] | None:
    """Return cached ExtractionResponse as dict, or None."""
    _ensure_dir(EXTRACTION_CACHE_DIR)
    key = _extraction_key(file_bytes, force_ocr)
    path = EXTRACTION_CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def set_cached_extraction(file_bytes: bytes, force_ocr: bool | str, response_dict: dict[str, Any]) -> None:
    """Store ExtractionResponse dict in cache."""
    _ensure_dir(EXTRACTION_CACHE_DIR)
    key = _extraction_key(file_bytes, force_ocr)
    path = EXTRACTION_CACHE_DIR / f"{key}.json"
    path.write_text(json.dumps(response_dict, default=str), encoding="utf-8")


def _report_key(scenario_dict: dict, brand_id: str, meta: dict) -> str:
    payload = json.dumps(
        {"scenario": scenario_dict, "brand_id": brand_id, "meta": meta},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def get_cached_report(scenario_dict: dict, brand_id: str, meta: dict) -> bytes | None:
    """Return cached PDF bytes, or None."""
    _ensure_dir(REPORT_CACHE_DIR)
    key = _report_key(scenario_dict, brand_id, meta)
    path = REPORT_CACHE_DIR / f"{key}.pdf"
    if not path.exists():
        return None
    try:
        return path.read_bytes()
    except Exception:
        return None


def set_cached_report(scenario_dict: dict, brand_id: str, meta: dict, pdf_bytes: bytes) -> None:
    """Store PDF bytes in cache."""
    _ensure_dir(REPORT_CACHE_DIR)
    key = _report_key(scenario_dict, brand_id, meta)
    path = REPORT_CACHE_DIR / f"{key}.pdf"
    path.write_bytes(pdf_bytes)


def _report_deck_key(report_payload: dict, org_id: str, theme_hash: str) -> str:
    payload = json.dumps(
        {"report": report_payload, "org_id": org_id, "theme_hash": theme_hash},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def get_cached_report_deck(report_payload: dict, org_id: str, theme_hash: str) -> bytes | None:
    """Return cached deck PDF bytes, or None."""
    _ensure_dir(REPORT_DECK_CACHE_DIR)
    key = _report_deck_key(report_payload, org_id, theme_hash)
    path = REPORT_DECK_CACHE_DIR / f"{key}.pdf"
    if not path.exists():
        return None
    try:
        return path.read_bytes()
    except Exception:
        return None


def set_cached_report_deck(report_payload: dict, org_id: str, theme_hash: str, pdf_bytes: bytes) -> None:
    """Store deck PDF bytes keyed by report payload + org + theme hash."""
    _ensure_dir(REPORT_DECK_CACHE_DIR)
    key = _report_deck_key(report_payload, org_id, theme_hash)
    path = REPORT_DECK_CACHE_DIR / f"{key}.pdf"
    path.write_bytes(pdf_bytes)
