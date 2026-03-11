from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .normalize import NormalizedDocument

_HEADER_HINTS = {
    "base rent",
    "monthly",
    "annual",
    "$/sf",
    "lease year",
    "year",
    "rate",
}


@dataclass
class RentStepCandidate:
    start_month: int
    end_month: int
    rate_psf_annual: float
    page: int | None
    snippet: str
    bbox: tuple[float, float, float, float] | None
    source: str
    source_confidence: float


def _expand_year_range_token(token: str) -> tuple[int, int] | None:
    token_norm = str(token or "").strip().lower().replace("years", "year")
    m = re.search(r"year\s*(\d+)\s*[-–to]+\s*(\d+)", token_norm)
    if m:
        y1, y2 = int(m.group(1)), int(m.group(2))
        if y2 < y1:
            y1, y2 = y2, y1
        return y1, y2
    m2 = re.search(r"year\s*(\d+)", token_norm)
    if m2:
        y = int(m2.group(1))
        return y, y
    return None


def _year_to_month_range(start_year: int, end_year: int) -> tuple[int, int]:
    start = max(0, (start_year - 1) * 12)
    end = max(start, (end_year * 12) - 1)
    return start, end


def _parse_row_to_step(cells: list[str], page: int | None, source: str, bbox: tuple[float, float, float, float] | None) -> RentStepCandidate | None:
    row_txt = " | ".join(cells)
    rate = None
    months = None

    # Rate patterns (annual psf)
    for pat in [r"\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(?:/\s*sf|psf)", r"\$\s*([0-9]+(?:\.[0-9]+)?)"]:
        m = re.search(pat, row_txt, flags=re.IGNORECASE)
        if m:
            try:
                rate = float(m.group(1).replace(",", ""))
            except Exception:
                rate = None
            if rate is not None:
                break

    # explicit month ranges first
    mm = re.search(r"(?:m|month)\s*(\d+)\s*[-–to]+\s*(\d+)", row_txt, flags=re.IGNORECASE)
    if mm:
        s, e = int(mm.group(1)), int(mm.group(2))
        if e < s:
            s, e = e, s
        months = (max(0, s), max(0, e))

    if months is None:
        for c in cells:
            yr = _expand_year_range_token(c)
            if yr:
                months = _year_to_month_range(*yr)
                break

    if rate is None or months is None:
        return None

    return RentStepCandidate(
        start_month=months[0],
        end_month=months[1],
        rate_psf_annual=max(0.0, rate),
        page=page,
        snippet=row_txt[:300],
        bbox=bbox,
        source=source,
        source_confidence=0.75 if "textract" in source else 0.65,
    )


def _extract_from_pdfplumber_regions(normalized: NormalizedDocument) -> list[RentStepCandidate]:
    out: list[RentStepCandidate] = []
    for page in normalized.pages:
        for region in page.table_regions:
            if not region.rows:
                continue
            header = " ".join((" ".join(row) for row in region.rows[:2])).lower()
            hit_count = sum(1 for k in _HEADER_HINTS if k in header)
            if hit_count < 2:
                continue
            for row in region.rows[1:]:
                if not row:
                    continue
                step = _parse_row_to_step([str(c or "").strip() for c in row], page.page_number, region.source, region.bbox)
                if step:
                    out.append(step)
    return out


def _extract_from_text_lines(normalized: NormalizedDocument) -> list[RentStepCandidate]:
    out: list[RentStepCandidate] = []
    for page in normalized.pages:
        lines = [ln.strip() for ln in (page.text or "").splitlines() if ln.strip()]
        for ln in lines:
            # Anchor around likely rent schedule lines.
            if not re.search(r"year\s*\d+|rent|\$", ln, flags=re.IGNORECASE):
                continue
            step = _parse_row_to_step([ln], page.page_number, "text_line_regex", None)
            if step:
                out.append(step)
    return out


def _optional_camelot_tabula(file_path: str) -> list[RentStepCandidate]:
    candidates: list[RentStepCandidate] = []
    # Optional integrations only, safe no-op when missing.
    try:
        import camelot  # type: ignore

        for flavor, conf in (("lattice", 0.7), ("stream", 0.65)):
            try:
                tables = camelot.read_pdf(file_path, flavor=flavor, pages="1-end")
            except Exception:
                tables = []
            for table in tables:
                data = table.df.values.tolist() if hasattr(table, "df") else []
                if not data:
                    continue
                for row in data[1:]:
                    row_cells = [str(cell or "").strip() for cell in row]
                    step = _parse_row_to_step(row_cells, None, f"camelot_{flavor}", None)
                    if step:
                        step.source_confidence = conf
                        candidates.append(step)
    except Exception:
        pass

    try:
        import tabula  # type: ignore

        try:
            dfs = tabula.read_pdf(file_path, pages="all", lattice=False, stream=True) or []
        except Exception:
            dfs = []
        for df in dfs:
            try:
                rows = df.fillna("").values.tolist()
            except Exception:
                rows = []
            for row in rows:
                step = _parse_row_to_step([str(c or "").strip() for c in row], None, "tabula_stream", None)
                if step:
                    step.source_confidence = 0.62
                    candidates.append(step)
    except Exception:
        pass

    return candidates


def extract_rent_step_candidates(normalized: NormalizedDocument, file_path: str | None = None) -> list[dict[str, Any]]:
    candidates: list[RentStepCandidate] = []
    candidates.extend(_extract_from_pdfplumber_regions(normalized))
    candidates.extend(_extract_from_text_lines(normalized))
    if file_path:
        candidates.extend(_optional_camelot_tabula(file_path))

    dedup: dict[tuple[int, int, float], RentStepCandidate] = {}
    for c in candidates:
        key = (c.start_month, c.end_month, round(c.rate_psf_annual, 4))
        prev = dedup.get(key)
        if prev is None or c.source_confidence > prev.source_confidence:
            dedup[key] = c

    return [
        {
            "start_month": c.start_month,
            "end_month": c.end_month,
            "rate_psf_annual": c.rate_psf_annual,
            "page": c.page,
            "snippet": c.snippet,
            "bbox": list(c.bbox) if c.bbox else None,
            "source": c.source,
            "source_confidence": c.source_confidence,
        }
        for c in sorted(dedup.values(), key=lambda x: (x.start_month, x.end_month, x.rate_psf_annual))
    ]
