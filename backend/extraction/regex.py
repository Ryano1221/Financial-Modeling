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


def _normalize_keyword_spacing(line: str) -> str:
    """
    Normalize OCR-spaced keyword artifacts (e.g., "C o m m e n c e m e n t").
    Keeps original line for snippets but improves matching robustness.
    """
    out = str(line or "")
    for word in (
        "commencement",
        "expiration",
        "operating",
        "expenses",
        "term",
        "lease",
        "premises",
        "suite",
        "rent",
    ):
        pattern = r"(?i)\b" + r"\s+".join(list(word)) + r"\b"
        out = re.sub(pattern, word, out)
    return out


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


def _nearest_keyword_distance(line_low: str, idx: int, keywords: tuple[str, ...]) -> int | None:
    best: int | None = None
    for kw in keywords:
        start = 0
        while True:
            pos = line_low.find(kw, start)
            if pos < 0:
                break
            dist = abs(pos - idx)
            if best is None or dist < best:
                best = dist
            start = pos + 1
    return best


def _detect_opex_mode_from_line(line: str) -> tuple[str, float] | None:
    low = f" {line.lower()} "
    has_nnn = bool(re.search(r"(?i)\b(?:n\.?\s*n\.?\s*n\.?|nnn)\b", line or ""))
    has_strong_base_year = any(k in low for k in ("expense stop", "gross with stop", "modified gross", "mod gross"))
    has_base_year_phrase = "base year" in low or "base-year" in low

    if has_nnn and "not nnn" not in low and "no nnn" not in low:
        if has_strong_base_year and not any(k in low for k in ("pro rata share", "actual nnn operating expenses")):
            return "gross_with_stop", 0.8
        return "nnn", 0.83
    if has_strong_base_year:
        return "gross_with_stop", 0.8
    if has_base_year_phrase and re.search(r"(?i)\b(?:lease|expense|rent)\s*(?:type|structure|mode)\b", line or ""):
        return "gross_with_stop", 0.72
    if any(k in low for k in FULL_SERVICE_CUES):
        return "full_service", 0.78
    if re.search(r"(?i)\b(?:lease|expense|rent)\s*(?:type|structure|mode)\b[^\n]{0,40}\bgross\b", line or ""):
        return "full_service", 0.72
    return None


def mine_candidates(normalized: NormalizedDocument) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {
        "commencement_date": [],
        "expiration_date": [],
        "rent_commencement_date": [],
        "term_months": [],
        "abatement_scope": [],
        "abatement_classification": [],
        "free_rent_months": [],
        "rent_definition_scope": [],
        "phase_in_detected": [],
        "opex_mode": [],
        "opex_psf_year_1": [],
        "opex_growth_rate": [],
        "ti_allowance_psf": [],
        "ti_allowance_total": [],
        "parking_ratio": [],
        "parking_rate_monthly": [],
        "parking_spaces": [],
        "renewal_option": [],
        "termination_right": [],
        "expansion_option": [],
        "contraction_option": [],
        "rofr_rofo": [],
        "rsf": [],
        "suite": [],
        "floor": [],
        "building_name": [],
        "address": [],
    }

    for page in normalized.pages:
        lines = [ln.strip() for ln in (page.text or "").splitlines() if ln.strip()]
        for ln in lines:
            scan_line = _normalize_keyword_spacing(ln)
            low = scan_line.lower()

            # Date fields with keyword anchoring.
            for pat in DATE_PATTERNS:
                for m in re.finditer(pat, scan_line):
                    dt = _parse_date_token(m.group(1))
                    if not dt:
                        continue
                    idx = m.start()
                    comm_dist = _nearest_keyword_distance(
                        low,
                        idx,
                        (
                            "commenc",
                            "lease commencement",
                            "term commencement",
                            "term start",
                            "rental commencement",
                            "rent commencement",
                        ),
                    )
                    rent_comm_dist = _nearest_keyword_distance(low, idx, ("rent commenc", "rent start"))
                    exp_dist = _nearest_keyword_distance(
                        low,
                        idx,
                        ("expir", "terminat", "through", "ending", "term end", "lease through"),
                    )

                    if rent_comm_dist is not None and (exp_dist is None or rent_comm_dist <= exp_dist):
                        out["rent_commencement_date"].append(
                            _mk_candidate("rent_commencement_date", dt, page.page_number, ln, "pdf_text_regex", 0.74)
                        )
                    if comm_dist is not None and (exp_dist is None or comm_dist < exp_dist):
                        out["commencement_date"].append(
                            _mk_candidate("commencement_date", dt, page.page_number, ln, "pdf_text_regex", 0.75)
                        )
                    if exp_dist is not None and (comm_dist is None or exp_dist < comm_dist):
                        out["expiration_date"].append(
                            _mk_candidate("expiration_date", dt, page.page_number, ln, "pdf_text_regex", 0.75)
                        )
                    # Single-label lines fallback.
                    if comm_dist is None and exp_dist is None:
                        if "commenc" in low and "rent" not in low:
                            out["commencement_date"].append(
                                _mk_candidate("commencement_date", dt, page.page_number, ln, "pdf_text_regex", 0.70)
                            )
                        if "expir" in low or "terminat" in low:
                            out["expiration_date"].append(
                                _mk_candidate("expiration_date", dt, page.page_number, ln, "pdf_text_regex", 0.70)
                            )

            tm = re.search(
                r"(?:initial\s+term|lease\s+term|term\s+length|term)\D{0,20}(\d{1,3})\s*(?:months?|mos?)",
                scan_line,
                flags=re.IGNORECASE,
            )
            if tm:
                out["term_months"].append(_mk_candidate("term_months", int(tm.group(1)), page.page_number, ln, "pdf_text_regex", 0.78))

            rsf_match = re.search(
                r"([0-9]{1,3}(?:,[0-9]{3})+|\d{3,6})\s*(?:rsf|rentable\s+square\s+feet|rentable\s+area|square\s+feet)",
                scan_line,
                flags=re.IGNORECASE,
            )
            if rsf_match and "per 1,000" not in low:
                rsf = float(rsf_match.group(1).replace(",", ""))
                rsf_conf = 0.77
                if any(k in low for k in ("premises", "suite", "rentable")):
                    rsf_conf += 0.08
                if any(k in low for k in ("occupying only", "phase", "months 1", "first 14 months", "first year")):
                    rsf_conf -= 0.16
                rsf_conf = max(0.2, min(0.95, rsf_conf))
                out["rsf"].append(_mk_candidate("rsf", rsf, page.page_number, ln, "pdf_text_regex", rsf_conf))

            suite_match = re.search(
                r"\b(?:suite|ste\.?|unit)\s*[:#-]?\s*([a-z0-9][a-z0-9 ,/&-]{0,40})",
                scan_line,
                flags=re.IGNORECASE,
            )
            if suite_match:
                suite = re.split(r"(?i)\b(?:rsf|rentable|square|commencement|expiration|term)\b", suite_match.group(1))[0]
                suite = suite.strip(" ,.-").upper()
                if suite:
                    out["suite"].append(_mk_candidate("suite", suite, page.page_number, ln, "pdf_text_regex", 0.72))

            floor_match = re.search(r"\b(?:floor|fl\.?)[\s:#-]*([0-9]{1,2})\b", scan_line, flags=re.IGNORECASE)
            if floor_match:
                out["floor"].append(_mk_candidate("floor", floor_match.group(1), page.page_number, ln, "pdf_text_regex", 0.68))

            if _is_phase_in_context(scan_line):
                out["phase_in_detected"].append(
                    _mk_candidate("phase_in_detected", True, page.page_number, ln, "pdf_text_regex", 0.82)
                )
                out["abatement_classification"].append(
                    _mk_candidate("abatement_classification", "phase_in", page.page_number, ln, "pdf_text_regex", 0.79)
                )

            scope = _detect_abatement_scope_from_line(scan_line)
            if scope:
                scope_conf = 0.75 if scope == "gross_rent" else 0.72 if scope == "base_rent_only" else 0.52
                out["abatement_scope"].append(
                    _mk_candidate("abatement_scope", scope, page.page_number, ln, "pdf_text_regex", scope_conf)
                )
                out["abatement_classification"].append(
                    _mk_candidate("abatement_classification", "rent_abatement", page.page_number, ln, "pdf_text_regex", 0.76)
                )
                for free_match in re.finditer(r"(?i)\b(\d{1,2})\s+months?\b", scan_line):
                    months = int(free_match.group(1))
                    if 0 < months <= 24:
                        out["free_rent_months"].append(
                            _mk_candidate("free_rent_months", months, page.page_number, ln, "pdf_text_regex", 0.73)
                        )

            # Definitions: use for abatement scope disambiguation where "Rent" includes additional rent.
            if "rent" in low and ("means" in low or "defined as" in low):
                if any(k in low for k in ("additional rent", "operating expenses", "cam", "common area maintenance")):
                    out["rent_definition_scope"].append(
                        _mk_candidate("rent_definition_scope", "rent_includes_additional", page.page_number, ln, "pdf_text_regex", 0.74)
                    )
                elif "base rent" in low and "only" in low:
                    out["rent_definition_scope"].append(
                        _mk_candidate("rent_definition_scope", "rent_base_only", page.page_number, ln, "pdf_text_regex", 0.70)
                    )

            opex_mode = _detect_opex_mode_from_line(scan_line)
            if opex_mode:
                mode, conf = opex_mode
                out["opex_mode"].append(_mk_candidate("opex_mode", mode, page.page_number, ln, "pdf_text_regex", conf))

            opex_match = re.search(
                r"(?:opex|operating\s+expenses?|cam)\D{0,20}\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:/\s*sf|psf)",
                scan_line,
                flags=re.IGNORECASE,
            )
            if opex_match:
                out["opex_psf_year_1"].append(
                    _mk_candidate("opex_psf_year_1", float(opex_match.group(1)), page.page_number, ln, "pdf_text_regex", 0.73)
                )

            growth_match = re.search(
                r"(?:opex|operating\s+expenses?|cam).{0,40}?(\d{1,2}(?:\.\d+)?)\s*%",
                scan_line,
                flags=re.IGNORECASE,
            )
            if growth_match:
                out["opex_growth_rate"].append(
                    _mk_candidate("opex_growth_rate", float(growth_match.group(1)) / 100.0, page.page_number, ln, "pdf_text_regex", 0.69)
                )

            ti_psf_match = re.search(
                r"(?i)(?:tenant\s+improvement(?:s)?|improvement\s+allowance|tia?|allowance)\D{0,40}\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:/\s*(?:rsf|sf)|per\s+(?:rsf|sf))",
                scan_line,
            )
            if ti_psf_match and "operating" not in low and "opex" not in low:
                out["ti_allowance_psf"].append(
                    _mk_candidate("ti_allowance_psf", float(ti_psf_match.group(1)), page.page_number, ln, "pdf_text_regex", 0.76)
                )

            ti_total_match = re.search(
                r"(?i)(?:tenant\s+improvement(?:s)?|improvement\s+allowance|tia?|allowance|buildout)\D{0,40}\$\s*([0-9]{1,3}(?:,[0-9]{3})+|\d{4,9})(?!\s*(?:/|per)\s*(?:rsf|sf))",
                scan_line,
            )
            if ti_total_match and "operating" not in low and "opex" not in low:
                out["ti_allowance_total"].append(
                    _mk_candidate("ti_allowance_total", float(ti_total_match.group(1).replace(",", "")), page.page_number, ln, "pdf_text_regex", 0.7)
                )

            parking_ratio_match = re.search(
                r"(?i)(\d+(?:\.\d+)?)\s*(?:/\s*1,?000|per\s*1,?000)\s*(?:rsf|sf)?",
                scan_line,
            )
            if parking_ratio_match and "park" in low:
                out["parking_ratio"].append(
                    _mk_candidate("parking_ratio", float(parking_ratio_match.group(1)), page.page_number, ln, "pdf_text_regex", 0.78)
                )

            parking_rate_match = re.search(
                r"(?i)\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:/|per)\s*(?:space|stall)\s*(?:/|per)?\s*(?:month|mo)\b",
                scan_line,
            )
            if parking_rate_match and "park" in low:
                out["parking_rate_monthly"].append(
                    _mk_candidate("parking_rate_monthly", float(parking_rate_match.group(1)), page.page_number, ln, "pdf_text_regex", 0.78)
                )

            parking_spaces_match = re.search(r"(?i)\b(\d{1,3})\s+(?:parking\s+)?spaces\b", scan_line)
            if parking_spaces_match and "park" in low:
                out["parking_spaces"].append(
                    _mk_candidate("parking_spaces", int(parking_spaces_match.group(1)), page.page_number, ln, "pdf_text_regex", 0.68)
                )

            renewal_match = re.search(r"(?i)(\d+)\s*x\s*(\d{1,2})\s*year\s+(?:renewal|extension)\s+option", scan_line)
            if renewal_match:
                out["renewal_option"].append(
                    _mk_candidate("renewal_option", ln.strip(), page.page_number, ln, "pdf_text_regex", 0.74)
                )
            elif ("renewal option" in low or "extension option" in low) and len(scan_line) <= 220:
                out["renewal_option"].append(
                    _mk_candidate("renewal_option", ln.strip(), page.page_number, ln, "pdf_text_regex", 0.66)
                )

            if "termination right" in low or "early termination" in low or "terminate this lease" in low:
                out["termination_right"].append(
                    _mk_candidate("termination_right", ln.strip(), page.page_number, ln, "pdf_text_regex", 0.68)
                )
            if "expansion option" in low or "expand into" in low:
                out["expansion_option"].append(
                    _mk_candidate("expansion_option", ln.strip(), page.page_number, ln, "pdf_text_regex", 0.66)
                )
            if "contraction option" in low or "contraction right" in low or "reduce the premises" in low:
                out["contraction_option"].append(
                    _mk_candidate("contraction_option", ln.strip(), page.page_number, ln, "pdf_text_regex", 0.66)
                )
            if any(tok in low for tok in ("right of first refusal", "right of first offer", "rofr", "rofo")):
                out["rofr_rofo"].append(
                    _mk_candidate("rofr_rofo", ln.strip(), page.page_number, ln, "pdf_text_regex", 0.69)
                )

            if "premises" in low and ("located" in low or "at" in low):
                out["address"].append(_mk_candidate("address", ln, page.page_number, ln, "pdf_text_regex", 0.6))

            if any(x in low for x in ["building", "tower", "plaza", "center", "centre"]) and len(ln) < 120:
                out["building_name"].append(_mk_candidate("building_name", ln, page.page_number, ln, "pdf_text_regex", 0.58))

    return out
