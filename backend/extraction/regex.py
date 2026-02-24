from __future__ import annotations

import re
from datetime import date
from typing import Any

from .normalize import NormalizedDocument

DATE_PATTERNS = [
    r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b",
    r"\b([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b",
]

NNN_CUES = (
    " nnn ",
    "triple net",
    "triple-net",
    "net lease",
    "absolute nnn",
    "n.n.n",
)
BASE_YEAR_CUES = (
    "base year",
    "base-year",
    "expense stop",
    "gross with stop",
    "modified gross",
    "mod gross",
)
FULL_SERVICE_CUES = (
    "full service gross",
    "full-service gross",
    "full service lease",
    "full-service lease",
    "full service",
    "full-service",
    "gross lease",
    "fsg",
)


def _is_phase_in_context(line: str) -> bool:
    low = f" {line.lower()} "
    has_phase_token = any(
        token in low
        for token in (
            "phase in",
            "phase-in",
            "phase i",
            "phase ii",
            "phase iii",
            "phased",
            "ramp-up",
            "ramp up",
        )
    )
    if not has_phase_token:
        return False
    has_occupancy_signal = any(
        token in low
        for token in (
            "occup",
            "rsf",
            "rentable square",
            "premises",
            "suite",
            "delivered",
            "delivery",
            "expand",
            "increase",
        )
    )
    # Reduce false positives like generic "Phase I environmental"
    return has_occupancy_signal


def _detect_abatement_scope_from_line(line: str) -> str | None:
    low = f" {line.lower()} "
    has_abatement_word = any(k in low for k in ("free rent", "abatement", "abated", "waived"))
    if not has_abatement_word:
        return None

    gross_patterns = (
        "gross rent",
        "all rent",
        "base rent and operating expenses",
        "base rent plus operating expenses",
        "rent and opex",
        "rent and operating expenses",
        "base rent and cam",
        "all charges",
    )
    base_patterns = (
        "base rent only",
        "base-rent-only",
        "base rent shall be",
        "base rent is",
        "base rental only",
    )
    if any(k in low for k in gross_patterns):
        return "gross_rent"
    if any(k in low for k in base_patterns):
        return "base_rent_only"
    # If text names base rent without naming OpEx/CAM, default to base-only.
    if "base rent" in low and not any(k in low for k in ("operating expense", "opex", "cam", "gross rent", "all rent")):
        return "base_rent_only"
    return "unspecified"


def _parse_date_token(token: str) -> str | None:
    raw = str(token or "").strip()
    if not raw:
        return None
    for sep in ["/", ".", "-"]:
        if sep in raw and re.match(r"^\d{1,2}\%s\d{1,2}\%s\d{2,4}$" % (sep, sep), raw):
            p = raw.split(sep)
            m, d, y = int(p[0]), int(p[1]), int(p[2])
            if y < 100:
                y += 2000
            try:
                return date(y, m, d).isoformat()
            except Exception:
                return None
    for fmt in ["%B %d, %Y", "%b %d, %Y"]:
        try:
            from datetime import datetime

            return datetime.strptime(raw, fmt).date().isoformat()
        except Exception:
            continue
    return None


def _mk_candidate(field: str, value: Any, page: int | None, snippet: str, source: str, conf: float, bbox: list[float] | None = None) -> dict[str, Any]:
    return {
        "field": field,
        "value": value,
        "page": page,
        "snippet": snippet[:300],
        "bbox": bbox,
        "source": source,
        "source_confidence": conf,
    }


def _detect_opex_mode_from_line(line: str) -> tuple[str, float] | None:
    low = f" {line.lower()} "
    if any(k in low for k in BASE_YEAR_CUES):
        return "gross_with_stop", 0.8
    if any(k in low for k in FULL_SERVICE_CUES):
        return "full_service", 0.78
    if any(k in low for k in NNN_CUES) and "not nnn" not in low and "no nnn" not in low:
        return "nnn", 0.83
    if " gross " in low and "base year" not in low and "expense stop" not in low and "modified gross" not in low:
        return "full_service", 0.66
    return None


def mine_candidates(normalized: NormalizedDocument) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {
        "commencement_date": [],
        "expiration_date": [],
        "rent_commencement_date": [],
        "term_months": [],
        "abatement_scope": [],
        "abatement_classification": [],
        "phase_in_detected": [],
        "opex_mode": [],
        "opex_psf_year_1": [],
        "opex_growth_rate": [],
        "rsf": [],
        "suite": [],
        "floor": [],
        "building_name": [],
        "address": [],
    }

    for page in normalized.pages:
        lines = [ln.strip() for ln in (page.text or "").splitlines() if ln.strip()]
        for ln in lines:
            low = ln.lower()

            # Date fields with keyword anchoring.
            for pat in DATE_PATTERNS:
                for m in re.finditer(pat, ln):
                    dt = _parse_date_token(m.group(1))
                    if not dt:
                        continue
                    if "commenc" in low and "rent" not in low:
                        out["commencement_date"].append(_mk_candidate("commencement_date", dt, page.page_number, ln, "pdf_text_regex", 0.74))
                    if "rent commenc" in low or "rent start" in low:
                        out["rent_commencement_date"].append(_mk_candidate("rent_commencement_date", dt, page.page_number, ln, "pdf_text_regex", 0.74))
                    if "expir" in low or "terminat" in low:
                        out["expiration_date"].append(_mk_candidate("expiration_date", dt, page.page_number, ln, "pdf_text_regex", 0.74))

            tm = re.search(r"(?:term|lease term)[^\d]{0,20}(\d{1,3})\s*(?:months?|mos?)", ln, flags=re.IGNORECASE)
            if tm:
                out["term_months"].append(_mk_candidate("term_months", int(tm.group(1)), page.page_number, ln, "pdf_text_regex", 0.78))

            rsf_match = re.search(r"([0-9]{1,3}(?:,[0-9]{3})+|\d{3,6})\s*(?:rsf|rentable\s+square\s+feet|square\s+feet)", ln, flags=re.IGNORECASE)
            if rsf_match and "per 1,000" not in low:
                rsf = float(rsf_match.group(1).replace(",", ""))
                out["rsf"].append(_mk_candidate("rsf", rsf, page.page_number, ln, "pdf_text_regex", 0.77))

            suite_match = re.search(r"\b(?:suite|ste\.?|unit)\s*[:#-]?\s*([a-z0-9-]+)", ln, flags=re.IGNORECASE)
            if suite_match:
                out["suite"].append(_mk_candidate("suite", suite_match.group(1).upper(), page.page_number, ln, "pdf_text_regex", 0.72))

            floor_match = re.search(r"\b(?:floor|fl\.?)[\s:#-]*([0-9]{1,2})\b", ln, flags=re.IGNORECASE)
            if floor_match:
                out["floor"].append(_mk_candidate("floor", floor_match.group(1), page.page_number, ln, "pdf_text_regex", 0.68))

            if _is_phase_in_context(ln):
                out["phase_in_detected"].append(
                    _mk_candidate("phase_in_detected", True, page.page_number, ln, "pdf_text_regex", 0.82)
                )
                out["abatement_classification"].append(
                    _mk_candidate("abatement_classification", "phase_in", page.page_number, ln, "pdf_text_regex", 0.79)
                )

            scope = _detect_abatement_scope_from_line(ln)
            if scope:
                scope_conf = 0.75 if scope == "gross_rent" else 0.72 if scope == "base_rent_only" else 0.52
                out["abatement_scope"].append(
                    _mk_candidate("abatement_scope", scope, page.page_number, ln, "pdf_text_regex", scope_conf)
                )
                out["abatement_classification"].append(
                    _mk_candidate("abatement_classification", "rent_abatement", page.page_number, ln, "pdf_text_regex", 0.76)
                )

            opex_mode = _detect_opex_mode_from_line(ln)
            if opex_mode:
                mode, conf = opex_mode
                out["opex_mode"].append(_mk_candidate("opex_mode", mode, page.page_number, ln, "pdf_text_regex", conf))

            opex_match = re.search(r"(?:opex|operating\s+expenses?)\D{0,20}\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:/\s*sf|psf)", ln, flags=re.IGNORECASE)
            if opex_match:
                out["opex_psf_year_1"].append(
                    _mk_candidate("opex_psf_year_1", float(opex_match.group(1)), page.page_number, ln, "pdf_text_regex", 0.73)
                )

            growth_match = re.search(r"(?:opex|operating\s+expenses?).{0,30}?(\d{1,2}(?:\.\d+)?)\s*%", ln, flags=re.IGNORECASE)
            if growth_match:
                out["opex_growth_rate"].append(
                    _mk_candidate("opex_growth_rate", float(growth_match.group(1)) / 100.0, page.page_number, ln, "pdf_text_regex", 0.69)
                )

            if "premises" in low and ("located" in low or "at" in low):
                out["address"].append(_mk_candidate("address", ln, page.page_number, ln, "pdf_text_regex", 0.6))

            if any(x in low for x in ["building", "tower", "plaza", "center", "centre"]) and len(ln) < 120:
                out["building_name"].append(_mk_candidate("building_name", ln, page.page_number, ln, "pdf_text_regex", 0.58))

    return out
