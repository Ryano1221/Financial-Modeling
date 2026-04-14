from __future__ import annotations

import re
from datetime import date
from typing import Any

from .normalize import NormalizedDocument

# Supports: M/D/Y, M.D.Y, M-D-Y, "Jan 1, 2024", "January 1st, 2024", "1st day of January, 2024"
DATE_PATTERNS = [
    r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b",
    r"\b([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4})\b",
    r"\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?[A-Za-z]{3,9},?\s+\d{4})\b",
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


def _is_notice_or_party_context(line: str) -> bool:
    low = (line or "").lower()
    return any(
        token in low
        for token in (
            "address for notices",
            "addresses for notices",
            "notice:",
            "notices:",
            "attn:",
            "attention:",
            "c/o",
            "lessor",
            "lessee",
            "landlord legal entity",
            "legal entity",
            "address of",
            "with an address of",
            "property management",
            "registered office",
            "registered agent",
            "secretary of state",
            "wire transfer",
            "remit to",
        )
    )


def _clean_suite_candidate(raw: str) -> str:
    value = " ".join((raw or "").split()).strip(" ,.;:-")
    if not value:
        return ""
    if re.search(r"(?i),\s*[A-Za-z .'-]{2,40},\s*(?:[A-Z]{2}|[A-Za-z]{4,})(?:\s+\d{5}(?:-\d{4})?)?\b", value):
        value = value.split(",", 1)[0].strip(" ,.;:-")
    value = re.split(r"(?i)\b(?:rsf|rentable|square|commencement|expiration|term|address|city|state|zip)\b", value)[0]
    token_match = re.match(r"(?i)^([A-Za-z0-9][A-Za-z0-9\-]{0,14})", value.strip(" ,.;:-"))
    if not token_match:
        return ""
    token = token_match.group(1)
    # Reject tokens that are common English words, not suite identifiers.
    _COMMON_WORDS = {
        "the", "and", "for", "that", "this", "with", "from", "have", "will",
        "been", "were", "they", "their", "there", "said", "each", "some",
        "into", "upon", "such", "within", "shall", "both", "also", "only",
        "date", "time", "term", "days", "lease", "rent", "base", "area",
    }
    if token.lower() in _COMMON_WORDS:
        return ""
    # Reject purely alpha tokens of 5+ chars (likely prose words, not suite IDs)
    if re.fullmatch(r"(?i)[A-Za-z]{5,}", token):
        return ""
    return token.upper() if not token.isdigit() else (token.lstrip("0") or token)


def _normalize_keyword_spacing(line: str) -> str:
    """
    Normalize OCR-spaced keyword artifacts (e.g., "C o m m e n c e m e n t").
    Handles single-space and multi-space gaps between characters.
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


def _clause_excerpt(line: str, keyword_pattern: str, max_chars: int = 600) -> str:
    cleaned = " ".join(str(line or "").split()).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    match = re.search(keyword_pattern, cleaned, re.I)
    center = match.start() if match else 0
    start = max(0, center - 120)
    end = min(len(cleaned), start + max_chars)
    start = max(0, end - max_chars)
    return cleaned[start:end].strip(" ,.;:-")


def _rights_clause_context(lines: list[str], idx: int, follow_tokens: tuple[str, ...]) -> str:
    parts = [str(lines[idx] or "").strip()]
    for next_line in lines[idx + 1:min(len(lines), idx + 5)]:
        next_low = str(next_line or "").lower()
        current_low = " ".join(parts).lower()
        if any(token in next_low for token in follow_tokens) or (
            ("notice" in current_low or "notice" in next_low)
            and any(token in next_low for token in ("no later than", "not later than", "on or before", "between"))
        ):
            parts.append(str(next_line or "").strip())
            continue
        break
    return _normalize_keyword_spacing(" ".join(part for part in parts if part))


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


def _has_strong_ti_allowance_context(line: str) -> bool:
    return bool(
        re.search(
            r"(?i)\b(?:tenant\s+improvement(?:s)?\s+allowance|ti\s+allowance|tenant\s+allowance|subtenant\s+allowance|improvement\s+allowance|tia)\b",
            str(line or ""),
        )
    )


def _has_non_ti_allowance_context(line: str) -> bool:
    low = str(line or "").lower()
    excluded_cues = (
        "test fit",
        "test-fit",
        "moving allowance",
        "moving expenses",
        "moving cost",
        "relocation allowance",
        "relocation expense",
        "furniture allowance",
        "furniture package",
        "ff&e",
        "ffe",
        "signage allowance",
        "door signage",
        "building signage",
        "cabling allowance",
        "security network",
        "work letter",
        "landlord work",
        "landlord's work",
        # NOTE: turn-key IS a TI delivery method — do NOT exclude it
    )
    return any(cue in low for cue in excluded_cues)


def _parse_date_token(token: str) -> str | None:
    raw = str(token or "").strip()
    if not raw:
        return None
    # Strip ordinal suffixes: "January 1st, 2024" → "January 1, 2024"
    raw_clean = re.sub(r"\b(\d+)(?:st|nd|rd|th)\b", r"\1", raw)
    # Normalize "1st day of January, 2024" → "January 1, 2024"
    day_of_match = re.match(r"(?i)(\d{1,2})\s+day\s+of\s+([A-Za-z]+),?\s+(\d{4})", raw_clean)
    if day_of_match:
        raw_clean = f"{day_of_match.group(2)} {day_of_match.group(1)}, {day_of_match.group(3)}"
    # Numeric M/D/Y
    for sep in ["/", ".", "-"]:
        if sep in raw_clean and re.match(r"^\d{1,2}\%s\d{1,2}\%s\d{2,4}$" % (sep, sep), raw_clean.strip()):
            p = raw_clean.strip().split(sep)
            m, d, y = int(p[0]), int(p[1]), int(p[2])
            if y < 100:
                y += 2000
            try:
                return date(y, m, d).isoformat()
            except Exception:
                return None
    for fmt in ["%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y"]:
        try:
            from datetime import datetime
            return datetime.strptime(raw_clean.strip(), fmt).date().isoformat()
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
        for idx, ln in enumerate(lines):
            scan_line = _normalize_keyword_spacing(ln)
            low = scan_line.lower()
            renewal_scan_line = _rights_clause_context(
                lines,
                idx,
                ("renewal notice", "extension notice", "option to renew", "renewal option", "expiration date"),
            )
            renewal_low = renewal_scan_line.lower()
            termination_scan_line = _rights_clause_context(
                lines,
                idx,
                ("termination notice", "termination option", "early termination", "terminate this lease"),
            )
            termination_low = termination_scan_line.lower()

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

            # Term months — numeric ("60 months", "initial term of 36 months")
            tm = re.search(
                r"(?:initial\s+term|lease\s+term|term\s+length|term)\D{0,20}(\d{1,3})\s*(?:months?|mos?)",
                scan_line,
                flags=re.IGNORECASE,
            )
            if tm:
                out["term_months"].append(_mk_candidate("term_months", int(tm.group(1)), page.page_number, ln, "pdf_text_regex", 0.78))

            # Term months — year-based ("5-year term", "a 5 year lease term")
            yr_term = re.search(
                r"(?:initial\s+term|lease\s+term|term\s+of\s+(?:the\s+)?lease|lease\s+period|term)\D{0,20}(\d{1,2})\s*[-–]?\s*year\b",
                scan_line,
                flags=re.IGNORECASE,
            )
            if yr_term and not tm:
                years = int(yr_term.group(1))
                out["term_months"].append(
                    _mk_candidate("term_months", years * 12, page.page_number, ln, "pdf_text_regex", 0.76)
                )

            # Term months — word form with year context ("five-year lease term")
            if not tm and not yr_term:
                yr_word = re.search(
                    r"(?:initial\s+term|lease\s+term|term)\D{0,30}\b([a-z]+(?:-[a-z]+)?)\s*[-–]?\s*year\b",
                    scan_line,
                    flags=re.IGNORECASE,
                )
                if yr_word:
                    from .concessions import _word_token_to_int  # type: ignore[attr-defined]
                    word_years = _word_token_to_int(yr_word.group(1))
                    if word_years and 1 <= word_years <= 30:
                        out["term_months"].append(
                            _mk_candidate("term_months", word_years * 12, page.page_number, ln, "pdf_text_regex", 0.72)
                        )

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
                if _is_notice_or_party_context(scan_line):
                    suite = ""
                else:
                    suite = _clean_suite_candidate(suite_match.group(1))
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
                _WORD_TO_NUM = {
                    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
                    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
                    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
                }
                # Match numeric: "5 months", "(5) months", "( 5 ) months", "5) months"
                for free_match in re.finditer(r"(?i)\(?\s*(\d{1,2})\s*\)?\s+months?\b", scan_line):
                    months = int(free_match.group(1))
                    if 0 < months <= 24:
                        out["free_rent_months"].append(
                            _mk_candidate("free_rent_months", months, page.page_number, ln, "pdf_text_regex", 0.73)
                        )
                # Match spelled-out: "five months", "five (5) months", "seven months"
                for word, num in _WORD_TO_NUM.items():
                    if re.search(rf"(?i)\b{word}\b.{{0,20}}\bmonths?\b", scan_line):
                        out["free_rent_months"].append(
                            _mk_candidate("free_rent_months", num, page.page_number, ln, "pdf_text_regex", 0.70)
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

            _SF_UNIT = r"(?:/\s*(?:rsf|sf)|per\s+(?:rsf|sf|sq\.?\s*ft\.?))"
            ti_psf_match = re.search(
                r"(?i)(?:tenant\s+improvement(?:s)?|improvement\s+allowance|tia?|allowance)\D{0,40}\$\s*([0-9]+(?:\.[0-9]+)?)\s*" + _SF_UNIT,
                scan_line,
            )
            # Also catch turn-key / "cost not to exceed $X per sq ft" constructions
            _turnkey_psf_match = re.search(
                r"(?i)(?:turn.?key|build.?out|landlord.{0,20}work).{0,120}?(?:cost\s+not\s+to\s+exceed|at\s+a\s+cost\s+of|at\s+\$)\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*" + _SF_UNIT,
                scan_line,
            )
            if not ti_psf_match and _turnkey_psf_match:
                ti_psf_match = _turnkey_psf_match
            if (
                ti_psf_match
                and "operating" not in low
                and "opex" not in low
                and not (_has_non_ti_allowance_context(scan_line) and not _has_strong_ti_allowance_context(scan_line))
            ):
                out["ti_allowance_psf"].append(
                    _mk_candidate("ti_allowance_psf", float(ti_psf_match.group(1)), page.page_number, ln, "pdf_text_regex", 0.76)
                )

            ti_total_match = re.search(
                r"(?i)(?:tenant\s+improvement(?:s)?|improvement\s+allowance|tia?|allowance|buildout)\D{0,40}\$\s*([0-9]{1,3}(?:,[0-9]{3})+|\d{4,9})(?!\s*(?:/|per)\s*(?:rsf|sf))",
                scan_line,
            )
            if (
                ti_total_match
                and "operating" not in low
                and "opex" not in low
                and not (_has_non_ti_allowance_context(scan_line) and not _has_strong_ti_allowance_context(scan_line))
            ):
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

            # Renewal option — multiple pattern forms.
            # Form 1: "2 x 5 year renewal option"
            renewal_current = (
                "renewal option" in low
                or "extension option" in low
                or "option to renew" in low
                or "renewal notice" in low
            )
            renewal_match = None
            if renewal_current:
                renewal_match = re.search(r"(?i)(\d+)\s*x\s*(\d{1,2})\s*[-–]?\s*year\s+(?:renewal|extension)\s+option", renewal_scan_line)
            # Form 2: "option to renew for X years" or "X-year renewal/extension option"
            if renewal_current and not renewal_match:
                renewal_match = re.search(
                    r"(?i)(?:option\s+to\s+renew|renewal\s+option|extension\s+option)\b[^.\n]{0,180}?\b(?:\d{1,2}|[A-Za-z-]+\s*\(\s*\d{1,2}\s*\))\s*[-–]?\s*years?",
                    renewal_scan_line,
                )
            # Form 3: "renewal term of X years"
            if renewal_current and not renewal_match:
                renewal_match = re.search(
                    r"(?i)\brenewal\s+term\s+of\s+(\d{1,2})\s+years?\b",
                    renewal_scan_line,
                )
            if renewal_match:
                excerpt = _clause_excerpt(renewal_scan_line, r"(option\s+to\s+renew|renewal\s+option|extension\s+option|renewal\s+notice)")
                out["renewal_option"].append(
                    _mk_candidate("renewal_option", excerpt, page.page_number, excerpt, "pdf_text_regex", 0.76)
                )
            elif "no further renewal option" not in renewal_low and (
                renewal_current
                and (
                    "renewal option" in low
                    or "extension option" in low
                    or "option to renew" in low
                    or ("renewal notice" in low and "no later than" in renewal_low)
                    or ("renewal notice" in low and "between" in renewal_low)
                )
            ):
                excerpt = _clause_excerpt(renewal_scan_line, r"(option\s+to\s+renew|renewal\s+option|extension\s+option|renewal\s+notice)")
                out["renewal_option"].append(
                    _mk_candidate("renewal_option", excerpt, page.page_number, excerpt, "pdf_text_regex", 0.66)
                )

            if (
                "termination right" in low
                or "early termination" in low
                or "terminate this lease" in low
                or ("termination notice" in low and "no later than" in termination_low)
            ):
                excerpt = _clause_excerpt(termination_scan_line, r"(termination\s+right|early\s+termination|terminate\s+this\s+lease|termination\s+notice)")
                out["termination_right"].append(
                    _mk_candidate("termination_right", excerpt, page.page_number, excerpt, "pdf_text_regex", 0.68)
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

            # Capture lines that look like a branded building/project name.
            # Pattern 1: line contains classic property-type keywords.
            _bldg_keywords = ["building", "tower", "plaza", "center", "centre", "park", "commons", "campus",
                               "square", "pointe", "point", "place", "court", "exchange", "hub", "district",
                               "gateway", "heights", "ridge", "terrace", "atrium", "pavilion", "galleria"]
            if any(x in low for x in _bldg_keywords) and len(ln) < 120:
                out["building_name"].append(_mk_candidate("building_name", ln, page.page_number, ln, "pdf_text_regex", 0.58))
            # Pattern 2: "at THE NAME" / "lease at NAME" / "located at NAME" — picks up branded names
            # that don't contain structural keywords (e.g. "The Stratum", "The Domain Tower").
            import re as _re
            _at_name = _re.search(r'\b(?:at|lease\s+at|space\s+at|located\s+at)\s+((?:the\s+)?[A-Z][A-Za-z0-9 \-]{2,40})', ln)
            if _at_name and len(ln) < 160:
                candidate_name = _at_name.group(1).strip()
                # Exclude pure addresses (contains digits followed by a street word)
                if not _re.search(r'\d+\s+\w+\s+(?:blvd|st|ave|dr|rd|ln|way|pkwy|hwy)', candidate_name.lower()):
                    out["building_name"].append(_mk_candidate("building_name", candidate_name, page.page_number, ln, "pdf_text_regex", 0.72))

    return out
