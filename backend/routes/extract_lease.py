from __future__ import annotations

from typing import Any

from models import CanonicalLease

from extraction import run_extraction_pipeline


def build_extract_response(
    *,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    canonical_lease: CanonicalLease | None = None,
) -> dict[str, Any]:
    return run_extraction_pipeline(
        file_bytes=file_bytes,
        filename=filename,
        content_type=content_type,
        canonical_lease=canonical_lease,
    )
