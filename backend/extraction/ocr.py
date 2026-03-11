from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
from typing import Any

from .normalize import NormalizedDocument, PageData, WordToken

CACHE_ROOT = Path(__file__).resolve().parents[1] / "cache" / "extraction_ocr"
ENGINE_VERSION = "v1"


def _cache_path(doc_sha: str, page_no: int, engine: str) -> Path:
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(f"{doc_sha}:{page_no}:{engine}:{ENGINE_VERSION}".encode("utf-8")).hexdigest()
    return CACHE_ROOT / f"{key}.json"


def _load_cache(doc_sha: str, page_no: int, engine: str) -> dict[str, Any] | None:
    p = _cache_path(doc_sha, page_no, engine)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_cache(doc_sha: str, page_no: int, engine: str, payload: dict[str, Any]) -> None:
    p = _cache_path(doc_sha, page_no, engine)
    try:
        p.write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        return


def _ocr_with_textract(pdf_bytes: bytes, page_no: int) -> dict[str, Any] | None:
    if not os.environ.get("AWS_REGION"):
        return None
    try:
        import boto3  # type: ignore
    except Exception:
        return None

    try:
        client = boto3.client("textract")
        resp = client.analyze_document(
            Document={"Bytes": pdf_bytes},
            FeatureTypes=["TABLES", "FORMS", "SIGNATURES", "LAYOUT"],
        )
    except Exception:
        return None

    blocks = resp.get("Blocks") or []
    lines: list[dict[str, Any]] = []
    for b in blocks:
        if b.get("BlockType") != "LINE":
            continue
        txt = str(b.get("Text") or "").strip()
        if not txt:
            continue
        geom = b.get("Geometry") or {}
        bb = geom.get("BoundingBox") or {}
        left = float(bb.get("Left") or 0)
        top = float(bb.get("Top") or 0)
        width = float(bb.get("Width") or 0)
        height = float(bb.get("Height") or 0)
        lines.append(
            {
                "text": txt,
                "bbox": [left, top, left + width, top + height],
            }
        )

    if not lines:
        return None
    return {"engine": "textract", "page": page_no, "lines": lines}


def _ocr_with_tesseract(pdf_bytes: bytes, page_no: int) -> dict[str, Any] | None:
    try:
        from pdf2image import convert_from_bytes  # type: ignore
        import pytesseract  # type: ignore
    except Exception:
        return None

    try:
        images = convert_from_bytes(pdf_bytes, first_page=page_no, last_page=page_no, dpi=200)
    except Exception:
        return None
    if not images:
        return None

    img = images[0]
    try:
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    except Exception:
        return None

    n = len(data.get("text") or [])
    words: list[dict[str, Any]] = []
    for i in range(n):
        txt = str((data.get("text") or [""])[i] or "").strip()
        if not txt:
            continue
        x = int((data.get("left") or [0])[i] or 0)
        y = int((data.get("top") or [0])[i] or 0)
        w = int((data.get("width") or [0])[i] or 0)
        h = int((data.get("height") or [0])[i] or 0)
        conf = float((data.get("conf") or [0])[i] or 0)
        words.append({"text": txt, "bbox": [x, y, x + w, y + h], "conf": conf})

    if not words:
        return None
    return {"engine": "tesseract", "page": page_no, "words": words}


def apply_ocr_fallback(normalized: NormalizedDocument, pdf_bytes: bytes | None = None) -> NormalizedDocument:
    if pdf_bytes is None:
        return normalized

    updated_pages: list[PageData] = []
    for page in normalized.pages:
        if not page.needs_ocr:
            updated_pages.append(page)
            continue

        cached = _load_cache(normalized.sha256, page.page_number, "textract")
        if cached is None:
            cached = _ocr_with_textract(pdf_bytes, page.page_number)
            if cached:
                _write_cache(normalized.sha256, page.page_number, "textract", cached)
        if cached is None:
            cached = _load_cache(normalized.sha256, page.page_number, "tesseract")
            if cached is None:
                cached = _ocr_with_tesseract(pdf_bytes, page.page_number)
                if cached:
                    _write_cache(normalized.sha256, page.page_number, "tesseract", cached)

        if not cached:
            updated_pages.append(page)
            continue

        if cached.get("engine") == "textract":
            lines = cached.get("lines") or []
            text = "\n".join(str(l.get("text") or "") for l in lines if str(l.get("text") or "").strip())
            words = [
                WordToken(
                    text=str(l.get("text") or "").strip(),
                    page=page.page_number,
                    bbox=tuple(l.get("bbox") or [0, 0, 0, 0]),  # type: ignore[arg-type]
                    source="textract",
                )
                for l in lines
                if str(l.get("text") or "").strip()
            ]
        else:
            words_raw = cached.get("words") or []
            words = [
                WordToken(
                    text=str(w.get("text") or "").strip(),
                    page=page.page_number,
                    bbox=tuple(w.get("bbox") or [0, 0, 0, 0]),  # type: ignore[arg-type]
                    source="tesseract",
                )
                for w in words_raw
                if str(w.get("text") or "").strip()
            ]
            text = " ".join(w.text for w in words)

        updated_pages.append(
            PageData(
                page_number=page.page_number,
                text=text or page.text,
                words=words or page.words,
                table_regions=page.table_regions,
                needs_ocr=False,
            )
        )

    return NormalizedDocument(
        sha256=normalized.sha256,
        filename=normalized.filename,
        content_type=normalized.content_type,
        pages=updated_pages,
        full_text="\n\n".join(p.text or "" for p in updated_pages),
    )
