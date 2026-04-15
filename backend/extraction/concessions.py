from __future__ import annotations

import re
from typing import Any


_NUMBER_WORDS: dict[str, int] = {
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
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
    # compound two-word numbers as single tokens (e.g. "twenty-four" after hyphen normalization)
    "twenty one": 21, "twenty two": 22, "twenty three": 23, "twenty four": 24,
    "twenty five": 25, "twenty six": 26, "twenty seven": 27, "twenty eight": 28, "twenty nine": 29,
    "thirty one": 31, "thirty two": 32, "thirty three": 33, "thirty four": 34,
    "thirty five": 35, "thirty six": 36,
    "forty eight": 48, "sixty": 60,
}


def _coerce_int_token(value: Any, default: int | None = None) -> int | None:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except Exception:
        return default


def _word_token_to_int(value: Any) -> int | None:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    # Normalize hyphens and whitespace: "twenty-five" → "twenty five"
    raw = re.sub(r"[-\s]+", " ", raw).strip()
    if raw.isdigit():
        return int(raw)
    # Check compound two-word lookup first (e.g. "twenty four")
    if raw in _NUMBER_WORDS:
        return _NUMBER_WORDS[raw]
    total = 0
    current = 0
    seen = False
    tokens = raw.split()
    i = 0
    while i < len(tokens):
        # Try two-token compound first
        if i + 1 < len(tokens):
            pair = tokens[i] + " " + tokens[i + 1]
            if pair in _NUMBER_WORDS:
                current += _NUMBER_WORDS[pair]
                seen = True
                i += 2
                continue
        token = tokens[i]
        if token not in _NUMBER_WORDS:
            return None
        seen = True
        number = _NUMBER_WORDS[token]
        if number == 100:
            current = max(1, current) * number
        else:
            current += number
        i += 1
    if not seen:
        return None
    total += current
    return total


def _normalize_scope_token(value: Any, default: str = "base") -> str:
    raw = str(value or "").strip().lower()
    if raw == "gross":
        return "gross"
    return "base" if default != "gross" else "gross"


def _analysis_scope_from_text(text: str, definitions_hint: str = "") -> str:
    low = f" {str(text or '').lower()} "
    if any(
        token in low
        for token in (
            "gross rent",
            "all rent",
            "base rent and operating expenses",
            "base rent plus operating expenses",
            "rent and operating expenses",
            "base rent and cam",
            "parking and rent",
        )
    ):
        return "gross_rent"
    if any(token in low for token in ("base rent only", "base-rent-only", "base rental only")):
        return "base_rent_only"
    if " base rent " in low and not any(token in low for token in ("operating", "cam", "gross", "all rent")):
        return "base_rent_only"
    if " rent " in low and "additional rent" in (definitions_hint or ""):
        return "gross_rent"
    return "unspecified"


def _extract_context(text: str, start: int, end: int, pad: int = 90) -> str:
    snippet = str(text or "")[max(0, start - pad): min(len(str(text or "")), end + pad)].strip()
    return re.sub(r"\s+", " ", snippet)


def _normalize_periods(periods: list[dict[str, Any]], *, term_months: int = 0) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[int, int, str]] = set()
    max_end = max(0, int(term_months) - 1) if int(term_months or 0) > 0 else None
    for period in periods:
        start_month = _coerce_int_token(period.get("start_month"), None)
        end_month = _coerce_int_token(period.get("end_month"), start_month)
        if start_month is None or end_month is None:
            continue
        start_i = max(0, int(start_month))
        end_i = max(start_i, int(end_month))
        if max_end is not None:
            if start_i > max_end:
                continue
            end_i = min(end_i, max_end)
        scope = _normalize_scope_token(period.get("scope"), default="base")
        key = (start_i, end_i, scope)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "start_month": start_i,
                "end_month": end_i,
                "scope": scope,
                "row_text": str(period.get("row_text") or ""),
            }
        )
    normalized.sort(key=lambda row: (int(row["start_month"]), int(row["end_month"]), str(row["scope"])))
    return normalized


def _count_unique_months(periods: list[dict[str, Any]]) -> int:
    covered: set[int] = set()
    for period in periods or []:
        start_i = int(period.get("start_month") or 0)
        end_i = int(period.get("end_month") or start_i)
        for month_idx in range(start_i, end_i + 1):
            covered.add(month_idx)
    return len(covered)


def _looks_like_distribution_window(snippet: str) -> bool:
    low = str(snippet or "").lower()
    if not any(token in low for token in ("abatement", "abated", "abate", "free rent")):
        return False
    if not any(
        token in low
        for token in (
            "spread",
            "installment",
            "installments",
            "throughout",
            "amortiz",
            "pro rata",
            "prorata",
            "over the first",
            "over first",
        )
    ):
        return False
    return bool(
        re.search(
            r"(?i)\bfirst\s+(?:[a-z\-]+\s*)?\(?\d{1,3}\)?\s+months?\b|\bmonths?\s+1\s*(?:-|to|through|thru|–|—)\s*\d{1,3}\b",
            low,
        )
    )


def parse_concession_text(
    text: str,
    *,
    term_months_hint: int = 0,
    definitions_hint: str = "",
) -> dict[str, Any]:
    raw_text = str(text or "")
    cleaned = " ".join(raw_text.split())
    low = raw_text.lower()
    term_cap = max(0, int(term_months_hint or 0))

    has_concession_language = bool(re.search(r"(?i)\b(?:free\s+rent|rent\s+abatement|abatement|abated|waived)\b", raw_text))
    scope_analysis = _analysis_scope_from_text(raw_text, definitions_hint=definitions_hint)
    default_scope = "gross" if scope_analysis == "gross_rent" else "base"

    periods: list[dict[str, Any]] = []
    signals: list[dict[str, str]] = []
    parking_periods: list[dict[str, Any]] = []

    def add_signal(category: str, reason: str, row_text: str) -> None:
        row = re.sub(r"\s+", " ", str(row_text or "")).strip()
        if not row:
            row = re.sub(r"\s+", " ", raw_text).strip()[:240]
        key = (category, reason, row)
        if key in {(s["category"], s["reason"], s["row_text"]) for s in signals}:
            return
        signals.append({"category": category, "reason": reason, "row_text": row[:280]})

    def add_period(start_month: int, month_count: int, scope: str, row_text: str) -> None:
        count = max(0, int(month_count))
        if count <= 0:
            return
        start_i = max(0, int(start_month))
        end_i = max(start_i, start_i + count - 1)
        periods.append({"start_month": start_i, "end_month": end_i, "scope": scope, "row_text": row_text})

    # ── Compound sequential abatement ─────────────────────────────────────────
    # Pattern: "X months of [Gross|Base] Rent abatement, followed by Y months of [Base|Gross] Rent abatement"
    # Detects the "followed by" divider and parses each half independently.
    _SEQ_DIVIDER = re.compile(
        r"(?i)\b(?:followed\s+by|then(?:\s+followed\s+by)?|,\s*then|;\s*followed\s+by)\b"
    )
    _HALF_ABATE = re.compile(
        r"(?i)"
        r"(?:([a-z][a-z\-\s]+?)\s*\((\d{1,3})\)|(\d{1,3}))"   # count: "three (3)" or "3"
        r"\s+months?\s+(?:of\s+)?"
        r"(?:(gross|base)\s+(?:rent\s+)?)?"                      # optional scope before keyword
        r"(?:free\s+rent|rent\s+abatement|abatement|abated\b)"
        r"|"
        r"(?:free\s+rent|rent\s+abatement|abatement|abated)\s+"
        r"(?:(gross|base)\s+(?:rent\s+)?)?"                      # scope after keyword
        r"(?:([a-z][a-z\-\s]+?)\s*\((\d{1,3})\)|(\d{1,3}))"    # count after keyword
        r"\s+months?"
    )

    def _extract_half(snippet: str) -> tuple[int | None, str]:
        """Return (count, scope) from a half-sentence like '3 months of abated Gross Rent'."""
        m = _HALF_ABATE.search(snippet)
        if not m:
            return None, default_scope
        g = m.groups()
        # Pattern A groups (count before keyword): g[0]=word, g[1]=paren, g[2]=plain, g[3]=scope
        # Pattern B groups (count after keyword):  g[4]=scope, g[5]=word, g[6]=paren, g[7]=plain
        if g[2] or g[1] or g[0]:  # Pattern A
            raw = g[2] if g[2] else (g[1] if g[1] else g[0])
            cnt = _coerce_int_token(raw, None)
            if cnt is None and g[0]:
                cnt = _word_token_to_int(str(g[0]).strip())
            sc_raw = str(g[3] or "").lower()
        else:  # Pattern B
            raw = g[7] if g[7] else (g[6] if g[6] else g[5])
            cnt = _coerce_int_token(raw, None)
            if cnt is None and g[5]:
                cnt = _word_token_to_int(str(g[5]).strip())
            sc_raw = str(g[4] or "").lower()
        # If scope still unspecified, scan full snippet for gross/base keywords
        if not sc_raw:
            snip_low = snippet.lower()
            if "gross" in snip_low:
                sc_raw = "gross"
            elif "base" in snip_low:
                sc_raw = "base"
        scope = "gross" if "gross" in sc_raw else ("base" if "base" in sc_raw else default_scope)
        return cnt, scope

    for div_match in _SEQ_DIVIDER.finditer(raw_text):
        # Find the sentence/clause containing this divider
        line_start = raw_text.rfind("\n", 0, div_match.start())
        line_start = line_start + 1 if line_start >= 0 else max(0, div_match.start() - 200)
        line_end = raw_text.find("\n", div_match.end())
        if line_end < 0:
            line_end = min(len(raw_text), div_match.end() + 200)
        full_clause = raw_text[line_start:line_end]
        low_clause = full_clause.lower()
        if not any(tok in low_clause for tok in ("abatement", "abated", "free rent")):
            continue
        before = raw_text[line_start:div_match.start()]
        after = raw_text[div_match.end():line_end]
        count1, scope1 = _extract_half(before)
        count2, scope2 = _extract_half(after)
        if not count1 or count1 <= 0 or not count2 or count2 <= 0:
            continue
        ctx = _extract_context(raw_text, line_start, line_end)
        add_period(0, count1, scope1, ctx)
        add_period(count1, count2, scope2, ctx)

    for match in re.finditer(
        r"(?i)\b(?:free\s+rent|rent\s+abatement|abatement)\b[^\n]{0,120}\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b",
        raw_text,
    ):
        start_1 = _coerce_int_token(match.group(1), 0) or 0
        end_1 = _coerce_int_token(match.group(2), 0) or 0
        if start_1 <= 0 or end_1 < start_1:
            continue
        periods.append(
            {
                "start_month": start_1 - 1,
                "end_month": end_1 - 1,
                "scope": default_scope,
                "row_text": _extract_context(raw_text, match.start(), match.end()),
            }
        )
    for match in re.finditer(
        r"(?i)\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b[^\n]{0,120}\b(?:free\s+rent|rent\s+abatement|abatement)\b",
        raw_text,
    ):
        start_1 = _coerce_int_token(match.group(1), 0) or 0
        end_1 = _coerce_int_token(match.group(2), 0) or 0
        if start_1 <= 0 or end_1 < start_1:
            continue
        periods.append(
            {
                "start_month": start_1 - 1,
                "end_month": end_1 - 1,
                "scope": default_scope,
                "row_text": _extract_context(raw_text, match.start(), match.end()),
            }
        )

    for line in [ln.strip() for ln in raw_text.splitlines() if ln.strip()]:
        low_line = line.lower()
        if not any(token in low_line for token in ("free rent", "abatement", "abated", "abate")):
            continue
        list_match = re.search(r"(?i)\bfollowing\s+months?\b[^:\n]{0,60}[:\-]\s*([0-9,\s]+)\b", line)
        if not list_match:
            list_match = re.search(r"(?i)\bmonths?\b[^:\n]{0,30}[:\-]\s*([0-9,\s]+)\b", line)
        if not list_match:
            continue
        month_vals = sorted(
            {
                int(val)
                for val in re.findall(r"\b(\d{1,3})\b", list_match.group(1))
                if 1 <= int(val) <= (term_cap if term_cap > 0 else 600)
            }
        )
        if len(month_vals) < 2:
            continue
        for month_1 in month_vals:
            periods.append(
                {
                    "start_month": int(month_1 - 1),
                    "end_month": int(month_1 - 1),
                    "scope": default_scope,
                    "row_text": line,
                }
            )

    front_cursor = 0
    front_block = re.split(r"(?i)\ban?\s+additional\b", cleaned, maxsplit=1)[0]

    # Pattern A: digit present, optional word prefix — "five (5) months free rent", "(5) months free rent"
    front_pattern = re.compile(
        r"(?i)(?:the\s+first\s+|initial\s+)?([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,2})\)?\s*months?\s*(?:of\s+)?"
        r"(?:(gross|base)\s+(?:rent\s+)?)?(?:free\s+rent|rent\s+abatement|abatement)\b"
    )
    _front_digit_matched = False
    for match in front_pattern.finditer(front_block):
        local = _extract_context(front_block, match.start(), match.end())
        if _looks_like_distribution_window(local):
            continue
        digit_val = _coerce_int_token(match.group(2), 0) or 0
        word_val = _word_token_to_int(match.group(1)) or 0
        count = max(digit_val, word_val)
        if count <= 0:
            continue
        local_scope = _normalize_scope_token(match.group(3), default=default_scope)
        add_period(front_cursor, count, local_scope, local)
        front_cursor += count
        _front_digit_matched = True

    # Pattern B: word-only month counts — "five months free rent", "six months of free rent"
    # Only run if Pattern A found nothing, to avoid double-counting.
    if not _front_digit_matched:
        word_only_pattern = re.compile(
            r"(?i)(?:the\s+first\s+|initial\s+)?([a-z]+(?:-[a-z]+)?)\s+months?\s*(?:of\s+)?"
            r"(?:(gross|base)\s+(?:rent\s+)?)?(?:free\s+rent|rent\s+abatement|abatement)\b"
        )
        for match in word_only_pattern.finditer(front_block):
            local = _extract_context(front_block, match.start(), match.end())
            if _looks_like_distribution_window(local):
                continue
            word_val = _word_token_to_int(match.group(1)) or 0
            if word_val <= 0:
                continue
            scope_token = match.group(2) if match.lastindex and match.lastindex >= 2 else None
            local_scope = _normalize_scope_token(scope_token, default=default_scope)
            add_period(front_cursor, word_val, local_scope, local)
            front_cursor += word_val

    additional_pattern = re.compile(
        r"(?is)\ban?\s+additional\s+([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,2})\)?\s*months?\s*(?:of\s+)?"
        r"(?:(gross|base)\s+(?:rent\s+)?)?(?:free\s+rent|rent\s+abatement|abatement)\b"
    )
    for match in additional_pattern.finditer(cleaned):
        digit_val = _coerce_int_token(match.group(2), 0) or 0
        word_val = _word_token_to_int(match.group(1)) or 0
        count_total = max(digit_val, word_val)
        if count_total <= 0:
            continue
        local_scope = _normalize_scope_token(match.group(3), default=default_scope)
        tail = cleaned[match.end():]
        boundary = re.search(r"(?is)\ban?\s+additional\b|\boption\s*(?:one|1|a|two|2|b)\b", tail)
        alloc_text = tail[:boundary.start()] if boundary else tail[:420]
        allocated = 0
        for alloc in re.finditer(
            r"(?i)([a-z]+(?:-[a-z]+)?)?\s*\(?(\d{1,2})\)?\s*months?\s+in\s+the\s+beginning\s+of\s+(?:lease\s+)?year\s+(\d{1,2}|[a-z]+(?:-[a-z]+)?)\b",
            alloc_text,
        ):
            local = _extract_context(alloc_text, alloc.start(), alloc.end())
            alloc_digit = _coerce_int_token(alloc.group(2), 0) or 0
            alloc_word = _word_token_to_int(alloc.group(1)) or 0
            alloc_count = max(alloc_digit, alloc_word)
            lease_year = _coerce_int_token(alloc.group(3), 0) or _word_token_to_int(alloc.group(3)) or 0
            if alloc_count <= 0 or lease_year <= 0:
                continue
            add_period(max(0, (lease_year - 1) * 12), alloc_count, local_scope, local)
            allocated += alloc_count
        if allocated <= 0:
            add_period(front_cursor, count_total, local_scope, _extract_context(cleaned, match.start(), match.end()))
            front_cursor += count_total

    if not periods:
        free_count_candidates: list[tuple[int, int, str]] = []
        for line in [ln.strip() for ln in raw_text.splitlines() if ln.strip()]:
            low_line = line.lower()
            if not any(token in low_line for token in ("free rent", "abatement", "abated", "abate")):
                continue
            for pattern, score in (
                (r"(?i)\brent\s+abatement\s*\(months?\)\s*[:\-]?\s*(\d{1,3})\b", 20),
                (r"(?i)\bfree\s+rent\s*\(months?\)\s*[:\-]?\s*(\d{1,3})\b", 20),
                (r"(?i)\bwith\s+(?:[a-z\-]+\s*\((\d{1,3})\)|\(?(\d{1,3})\)?)\s+months?\s+(?:(gross|base)\s+)?(?:free\s+rent|rent\s+abatement|abatement)\b", 18),
                (r"(?i)\b(?:\(?(\d{1,3})\)?|[a-z\-]+\s*\((\d{1,3})\))\s+months?\b[^\n]{0,70}\b(?:(gross|base)\s+)?(?:free\s+rent|rent\s+abatement|abatement)\b", 15),
                (r"(?i)\b(?:(gross|base)\s+)?(?:free\s+rent|rent\s+abatement|abatement)\b[^\n]{0,70}\b(?:\(?(\d{1,3})\)?|[a-z\-]+\s*\((\d{1,3})\))\s+months?\b", 14),
                # Word-only fallback: "six months of free rent"
                (r"(?i)\b([a-z]+(?:-[a-z]+)?)\s+months?\s+(?:of\s+)?(?:(gross|base)\s+)?(?:free\s+rent|rent\s+abatement|abatement)\b", 12),
            ):
                for match in re.finditer(pattern, line):
                    local = _extract_context(line, match.start(), match.end())
                    if _looks_like_distribution_window(local):
                        continue
                    groups = [match.group(i) if i <= (match.lastindex or 0) else None for i in range(1, (match.lastindex or 0) + 1)]
                    nums = [_coerce_int_token(group, None) for group in groups if group and re.search(r"\d", group)]
                    word_nums = [_word_token_to_int(group) for group in groups if group and not re.search(r"\d", group)]
                    count = max([n for n in [*(nums or []), *(word_nums or [])] if n is not None], default=0)
                    scope_token = "gross" if "gross" in local.lower() else "base" if "base" in local.lower() else default_scope
                    if count > 0:
                        free_count_candidates.append((score, count, scope_token))
        if free_count_candidates:
            free_count_candidates.sort(key=lambda row: (-row[0], row[1]))
            _, free_count, scope_token = free_count_candidates[0]
            add_period(0, free_count, scope_token, raw_text[:240])

    periods = _normalize_periods(periods, term_months=term_cap)
    if has_concession_language and not periods:
        add_signal("timing_incomplete", "concession language detected without a confident abatement window", raw_text)

    if periods and scope_analysis == "unspecified":
        add_signal("scope_incomplete", "abatement timing was parsed but rent scope remains unspecified", periods[0].get("row_text") or raw_text)

    for match in re.finditer(
        r"(?i)\b(?:parking(?:\s+charges?|\s+costs?|\s+rent|\s+fees?)?[^\n]{0,120}?(?:abated|abatement|waived|free))\b[^\n]{0,120}\bmonths?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})\b",
        raw_text,
    ):
        start_1 = _coerce_int_token(match.group(1), 0) or 0
        end_1 = _coerce_int_token(match.group(2), 0) or 0
        if start_1 <= 0 or end_1 < start_1:
            continue
        parking_periods.append(
            {
                "start_month": start_1 - 1,
                "end_month": end_1 - 1,
                "row_text": _extract_context(raw_text, match.start(), match.end()),
            }
        )
    if not parking_periods:
        for match in re.finditer(
            r"(?i)\b(?:first\s+)?(\d{1,3})\s+months?\b[^\n]{0,100}\bparking(?:\s+charges?|\s+costs?|\s+rent|\s+fees?)?[^\n]{0,40}\b(?:abated|abatement|waived|free)\b",
            raw_text,
        ):
            count = _coerce_int_token(match.group(1), 0) or 0
            if count <= 0:
                continue
            parking_periods.append({"start_month": 0, "end_month": max(0, count - 1), "row_text": _extract_context(raw_text, match.start(), match.end())})

    # Forward-order pattern: "first N months of parking costs shall be abated"
    # The months appear BEFORE "parking" — this is the most natural English construction.
    if not parking_periods:
        _PARK_FORWARD = re.compile(
            r"(?i)\b(?:first|initial)\s+"
            r"(?:([a-z][a-z\-\s]+?)\s*\((\d{1,3})\)|(\d{1,3}))"   # count: "twenty four (24)" or "24"
            r"\s+months?\s+(?:of\s+)?parking"
            r"[^\n]{0,120}\b(?:abated|abatement|waived|free|shall\s+be\s+abated)\b"
        )
        for match in re.finditer(_PARK_FORWARD, raw_text):
            g = match.groups()
            # g[0]=word, g[1]=paren-digit, g[2]=plain-digit
            raw_count = g[2] if g[2] else (g[1] if g[1] else g[0])
            count = _coerce_int_token(raw_count, None)
            if count is None and g[0]:
                count = _word_token_to_int(str(g[0]).strip())
            if not count or count <= 0:
                continue
            parking_periods.append({"start_month": 0, "end_month": max(0, count - 1), "row_text": _extract_context(raw_text, match.start(), match.end())})

    # Handle written-out numbers with optional parenthetical digit:
    # "abated parking during the initial twenty four (24) months"
    # "parking shall be free for the first twelve (12) months"
    if not parking_periods:
        _PARK_WRITTEN = (
            r"(?i)\b(?:parking(?:\s+(?:charges?|costs?|rent|fees?))?"
            r"[^\n]{0,160}?"
            r"(?:abated|abatement|waived|free|no\s+charge)"
            r"|(?:abated|abatement|waived|free|no\s+charge)[^\n]{0,80}?"
            r"parking(?:\s+(?:charges?|costs?|rent|fees?))?)"
            r"[^\n]{0,80}?"
            r"\b(?:initial\s+|first\s+)?([a-z][a-z\-\s]+?)\s*\((\d{1,3})\)\s*months?"
        )
        for match in re.finditer(_PARK_WRITTEN, raw_text):
            word_part = str(match.group(1) or "").strip()
            digit_part = match.group(2)
            count = _coerce_int_token(digit_part, None)
            if count is None:
                count = _word_token_to_int(word_part)
            if not count or count <= 0:
                continue
            parking_periods.append({"start_month": 0, "end_month": max(0, count - 1), "row_text": _extract_context(raw_text, match.start(), match.end())})
    # Also handle plain "initial X months" parking abatement where X is written-out only
    if not parking_periods:
        _PARK_WORD_ONLY = (
            r"(?i)\b(?:parking(?:\s+(?:charges?|costs?|rent|fees?))?"
            r"[^\n]{0,160}?"
            r"(?:abated|abatement|waived|free)"
            r"|(?:abated|abatement|waived|free)[^\n]{0,80}?"
            r"parking(?:\s+(?:charges?|costs?|rent|fees?))?)"
            r"[^\n]{0,80}?"
            r"\b(?:initial\s+|first\s+)?((?:twenty|thirty|forty|fifty|sixty)\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)?)"
            r"\s+months?"
        )
        for match in re.finditer(_PARK_WORD_ONLY, raw_text):
            count = _word_token_to_int(match.group(1))
            if not count or count <= 0:
                continue
            parking_periods.append({"start_month": 0, "end_month": max(0, count - 1), "row_text": _extract_context(raw_text, match.start(), match.end())})

    parking_reference = bool(
        re.search(
            r"(?is)\bparking(?:\s+costs?|\s+charges?|\s+rent|\s+fees?)?\b[\s\S]{0,220}\b(?:abated|abatement|waived|free)\b",
            raw_text,
        )
    )
    references_abatement_period = bool(
        re.search(
            r"(?is)\bparking(?:\s+costs?|\s+charges?|\s+rent|\s+fees?)?\b[\s\S]{0,220}\b(?:abated|abatement|waived|free)\b[\s\S]{0,220}\babatement\s+period\b",
            raw_text,
        )
        or re.search(r"(?is)\bgross\s+rent\b[\s\S]{0,80}\bparking\s+abatement\b", raw_text)
    )
    if parking_reference and not parking_periods and periods:
        parking_periods = [
            {"start_month": int(period["start_month"]), "end_month": int(period["end_month"]), "row_text": str(period.get("row_text") or raw_text[:240])}
            for period in periods
        ]
    elif parking_reference and not parking_periods and references_abatement_period:
        add_signal("parking_period_incomplete", "parking abatement referenced an abatement period, but rent-abatement timing was unresolved", raw_text)

    deduped_parking: list[dict[str, Any]] = []
    seen_parking: set[tuple[int, int]] = set()
    max_end = max(0, term_cap - 1) if term_cap > 0 else None
    for period in parking_periods:
        start_i = max(0, int(period.get("start_month") or 0))
        end_i = max(start_i, int(period.get("end_month") or start_i))
        if max_end is not None:
            if start_i > max_end:
                continue
            end_i = min(end_i, max_end)
        key = (start_i, end_i)
        if key in seen_parking:
            continue
        seen_parking.add(key)
        deduped_parking.append({"start_month": start_i, "end_month": end_i, "row_text": str(period.get("row_text") or "")})
    deduped_parking.sort(key=lambda row: (int(row["start_month"]), int(row["end_month"])))

    return {
        "concession_detected": has_concession_language,
        "scope": scope_analysis,
        "abatements": [
            {
                "start_month": int(period["start_month"]),
                "end_month": int(period["end_month"]),
                "scope": "gross_rent" if str(period.get("scope") or "base") == "gross" else "base_rent_only",
                "classification": "rent_abatement",
                "row_text": str(period.get("row_text") or ""),
            }
            for period in periods
        ],
        "free_rent_months": _count_unique_months(periods) if periods else None,
        "parking_abatements": deduped_parking,
        "signals": signals,
    }
