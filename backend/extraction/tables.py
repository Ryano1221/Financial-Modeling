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


@dataclass
class TypedCurrencySignal:
    kind: str
    value: float
    confidence: float


@dataclass
class RentRowReviewSignal:
    row_text: str
    issue_code: str
    message: str
    category: str
    page: int | None
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


def _has_annual_psf_context(text: str) -> bool:
    return bool(
        re.search(
            r"(?i)(?:annual|annually|per\s+annum|yearly)[^\n|]{0,24}(?:/\s*sf|psf|per\s+(?:rentable\s+)?square\s+foot)"
            r"|(?:/\s*sf|psf|per\s+(?:rentable\s+)?square\s+foot)[^\n|]{0,24}(?:annual|annually|per\s+annum|yearly)"
            r"|(?:annual\s+base\s+rent|base\s+rent)[^\n|]{0,20}(?:/\s*sf|psf)",
            text,
        )
    )


def _has_monthly_psf_context(text: str) -> bool:
    return bool(
        re.search(
            r"(?i)(?:monthly|month|/mo\b|per\s+month)[^\n|]{0,24}(?:/\s*sf|psf|per\s+(?:rentable\s+)?square\s+foot)"
            r"|(?:/\s*sf|psf|per\s+(?:rentable\s+)?square\s+foot)[^\n|]{0,24}(?:monthly|month|/mo\b|per\s+month)",
            text,
        )
    )


def classify_rent_currency_signal(text: str) -> TypedCurrencySignal | None:
    row = str(text or "").strip()
    if not row:
        return None

    annual_psf_patterns = [
        r"(?i)\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(?:/\s*sf|psf)\b",
        r"(?i)([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(?:/\s*sf|psf)\b",
        r"(?i)\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*per\s+(?:rentable\s+)?square\s+foot\b",
        r"(?i)([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*per\s+(?:rentable\s+)?square\s+foot\b",
    ]
    for pattern in annual_psf_patterns:
        match = re.search(pattern, row)
        if not match:
            continue
        try:
            value = float(match.group(1).replace(",", ""))
        except Exception:
            continue
        if value <= 0:
            continue
        if _has_monthly_psf_context(row):
            return TypedCurrencySignal("monthly_psf", value, 0.2)
        confidence = 0.94 if _has_annual_psf_context(row) else 0.82
        return TypedCurrencySignal("annual_psf", value, confidence)

    money_match = re.search(r"(?i)\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)", row)
    if not money_match:
        return None
    try:
        value = float(money_match.group(1).replace(",", ""))
    except Exception:
        return None
    if value <= 0:
        return None

    monthly_total_patterns = (
        r"(?i)\bmonthly\s+(?:base\s+)?rent\b",
        r"(?i)\bfixed\s+monthly\s+rent\b",
        r"(?i)\bper\s+month\b",
        r"(?i)\b/mo\b",
        r"(?i)\bmonth(?:ly)?\b[^\n|]{0,24}\$",
    )
    if any(re.search(pattern, row) for pattern in monthly_total_patterns):
        return TypedCurrencySignal("monthly_total", value, 0.9)

    annual_total_patterns = (
        r"(?i)\bannual\s+(?:base\s+)?rent\b",
        r"(?i)\bannual\s+total\b",
        r"(?i)\bper\s+year\b",
        r"(?i)\bannually\b",
    )
    if any(re.search(pattern, row) for pattern in annual_total_patterns):
        return TypedCurrencySignal("annual_total", value, 0.86)

    if re.search(r"(?i)\b(?:rent|base\s+rent)\b", row):
        return TypedCurrencySignal("ambiguous_currency", value, 0.35)
    return None


def extract_rent_time_span(cells: list[str], row_txt: str) -> tuple[int, int] | None:
    mm = re.search(r"(?i)(?:m|month)\s*(\d+)\s*[-–to]+\s*(\d+)", row_txt)
    if mm:
        s, e = int(mm.group(1)), int(mm.group(2))
        if e < s:
            s, e = e, s
        return max(0, s), max(0, e)

    for c in cells:
        yr = _expand_year_range_token(c)
        if yr:
            return _year_to_month_range(*yr)
    return None


def _build_rent_row_review_signal(
    *,
    row_txt: str,
    reason: str,
    category: str,
    page: int | None,
    source: str,
    bbox: tuple[float, float, float, float] | None,
    confidence: float,
) -> RentRowReviewSignal:
    return RentRowReviewSignal(
        row_text=row_txt[:300],
        issue_code="RENT_ROW_REJECTED",
        message=reason,
        category=category,
        page=page,
        bbox=bbox,
        source=source,
        source_confidence=max(0.2, min(0.95, confidence)),
    )


def _classify_row_for_rent_step(
    cells: list[str],
    page: int | None,
    source: str,
    bbox: tuple[float, float, float, float] | None,
) -> tuple[RentStepCandidate | None, RentRowReviewSignal | None]:
    row_txt = " | ".join(cells)
    typed_signal = classify_rent_currency_signal(row_txt)
    months = extract_rent_time_span(cells, row_txt)
    has_currency = "$" in row_txt or bool(re.search(r"(?i)\b(?:rent|base\s+rent|annual|monthly)\b", row_txt))

    if months is None:
        if typed_signal and typed_signal.kind in {"annual_psf", "monthly_psf", "monthly_total", "annual_total", "ambiguous_currency"}:
            return None, _build_rent_row_review_signal(
                row_txt=row_txt,
                reason="Row looked like rent pricing but had no usable lease year or month range.",
                category="missing_time_span",
                page=page,
                source=source,
                bbox=bbox,
                confidence=typed_signal.confidence,
            )
        return None, None

    if typed_signal is None:
        if has_currency:
            return None, _build_rent_row_review_signal(
                row_txt=row_txt,
                reason="Row had a time span and rent-like currency but no clear annual PSF classification.",
                category="weak_context",
                page=page,
                source=source,
                bbox=bbox,
                confidence=0.35,
            )
        return None, None

    if typed_signal.kind != "annual_psf":
        reason_map = {
            "monthly_psf": "Row looked like monthly PSF rent, not annual PSF rent.",
            "monthly_total": "Row looked like monthly total rent, not annual PSF rent.",
            "annual_total": "Row looked like annual total rent dollars, not annual PSF rent.",
            "ambiguous_currency": "Row contained ambiguous rent currency without clear PSF context.",
        }
        return None, _build_rent_row_review_signal(
            row_txt=row_txt,
            reason=reason_map.get(typed_signal.kind, "Row was rejected because the rent type was ambiguous."),
            category=typed_signal.kind,
            page=page,
            source=source,
            bbox=bbox,
            confidence=typed_signal.confidence,
        )

    return RentStepCandidate(
        start_month=months[0],
        end_month=months[1],
        rate_psf_annual=max(0.0, typed_signal.value),
        page=page,
        snippet=row_txt[:300],
        bbox=bbox,
        source=source,
        source_confidence=max(0.55, 0.78 if "textract" in source else typed_signal.confidence),
    ), None


def _extract_from_pdfplumber_regions(normalized: NormalizedDocument) -> tuple[list[RentStepCandidate], list[RentRowReviewSignal]]:
    out: list[RentStepCandidate] = []
    review_signals: list[RentRowReviewSignal] = []
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
                step, review = _classify_row_for_rent_step(
                    [str(c or "").strip() for c in row],
                    page.page_number,
                    region.source,
                    region.bbox,
                )
                if step:
                    out.append(step)
                elif review:
                    review_signals.append(review)
    return out, review_signals


def _extract_from_text_lines(normalized: NormalizedDocument) -> tuple[list[RentStepCandidate], list[RentRowReviewSignal]]:
    out: list[RentStepCandidate] = []
    review_signals: list[RentRowReviewSignal] = []
    for page in normalized.pages:
        lines = [ln.strip() for ln in (page.text or "").splitlines() if ln.strip()]
        for ln in lines:
            # Free-form text lines need stricter anchors than table rows to avoid false positives.
            if not re.search(r"(?i)year\s*\d+|month\s*\d+\s*[-–to]+\s*\d+", ln):
                continue
            if not re.search(r"(?i)(/\s*sf|psf|per\s+(?:rentable\s+)?square\s+foot|\$|rent)", ln):
                continue
            step, review = _classify_row_for_rent_step([ln], page.page_number, "text_line_regex", None)
            if step:
                out.append(step)
            elif review:
                review_signals.append(review)
    return out, review_signals


def _optional_camelot_tabula(file_path: str) -> tuple[list[RentStepCandidate], list[RentRowReviewSignal]]:
    candidates: list[RentStepCandidate] = []
    review_signals: list[RentRowReviewSignal] = []
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
                    step, review = _classify_row_for_rent_step(row_cells, None, f"camelot_{flavor}", None)
                    if step:
                        step.source_confidence = conf
                        candidates.append(step)
                    elif review:
                        review.source_confidence = conf
                        review_signals.append(review)
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
                step, review = _classify_row_for_rent_step([str(c or "").strip() for c in row], None, "tabula_stream", None)
                if step:
                    step.source_confidence = 0.62
                    candidates.append(step)
                elif review:
                    review.source_confidence = 0.62
                    review_signals.append(review)
    except Exception:
        pass

    return candidates, review_signals


def _serialize_rent_row_review_signal(signal: RentRowReviewSignal) -> dict[str, Any]:
    specific_issue_code = f"RENT_ROW_REJECTED_{signal.category.upper()}"
    return {
        "field_path": "rent_steps",
        "severity": "warn",
        "issue_code": specific_issue_code,
        "message": signal.message,
        "candidates": [
            {
                "row_text": signal.row_text,
                "category": signal.category,
                "reason": signal.message,
                "source": signal.source,
            }
        ],
        "recommended_value": None,
        "evidence": [
            {
                "page": signal.page,
                "snippet": signal.row_text,
                "bbox": list(signal.bbox) if signal.bbox else None,
                "source": signal.source,
                "source_confidence": signal.source_confidence,
            }
        ],
        "metadata": {
            "row_text": signal.row_text,
            "rejection_reason": signal.message,
            "rejection_category": signal.category,
            "base_issue_code": signal.issue_code,
        },
    }


def extract_rent_step_candidates_with_review(normalized: NormalizedDocument, file_path: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    candidates: list[RentStepCandidate] = []
    review_signals: list[RentRowReviewSignal] = []

    region_candidates, region_reviews = _extract_from_pdfplumber_regions(normalized)
    text_candidates, text_reviews = _extract_from_text_lines(normalized)
    candidates.extend(region_candidates)
    candidates.extend(text_candidates)
    review_signals.extend(region_reviews)
    review_signals.extend(text_reviews)
    if file_path:
        optional_candidates, optional_reviews = _optional_camelot_tabula(file_path)
        candidates.extend(optional_candidates)
        review_signals.extend(optional_reviews)

    dedup: dict[tuple[int, int, float], RentStepCandidate] = {}
    for c in candidates:
        key = (c.start_month, c.end_month, round(c.rate_psf_annual, 4))
        prev = dedup.get(key)
        if prev is None or c.source_confidence > prev.source_confidence:
            dedup[key] = c

    serialized_candidates = [
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

    seen_reviews: set[tuple[str, str, str]] = set()
    serialized_reviews: list[dict[str, Any]] = []
    for signal in review_signals:
        key = (signal.issue_code, signal.category, signal.row_text)
        if key in seen_reviews:
            continue
        seen_reviews.add(key)
        serialized_reviews.append(_serialize_rent_row_review_signal(signal))

    return serialized_candidates, serialized_reviews


def extract_rent_step_candidates(normalized: NormalizedDocument, file_path: str | None = None) -> list[dict[str, Any]]:
    candidates, _review_tasks = extract_rent_step_candidates_with_review(normalized, file_path=file_path)
    return candidates
