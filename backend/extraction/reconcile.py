from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from itertools import product
from typing import Any

SOURCE_WEIGHTS = {
    "table_parser": 0.45,
    "pdfplumber_table": 0.45,
    "textract_table": 0.55,
    "camelot": 0.42,
    "tabula": 0.40,
    "text_line_regex": 0.32,
    "pdf_text_regex": 0.30,
    "ocr_regex": 0.24,
    "llm": 0.28,
}

_TABLE_HEADER_CUES = (
    "base rent",
    "annual",
    "monthly",
    "$/sf",
    "psf",
    "lease year",
    "year",
)

_EXHIBIT_CUES = ("exhibit", "schedule", "appendix")
_DEFINITION_CUES = ("means", "defined as", "definition")
_HEADER_FOOTER_NOISE = ("page ", "confidential", "copyright", "all rights reserved")
_REVISED_CUES = (
    "amended to",
    "hereby amended",
    "replaced with",
    "superseded by",
    "revised to",
    "now reads",
    "is deleted and replaced",
)
_STRIKE_CUES = (
    "strikethrough",
    "stricken",
    "strike-through",
    "deleted",
    "~~",
)

_NNN_CUES = (
    "nnn",
    "triple net",
    "additional rent",
    "tenant's proportionate share",
    "tenant proportionate share",
    "cam",
    "common area maintenance",
)
_BASE_YEAR_CUES = (
    "base year",
    "expense stop",
    "modified gross",
    "gross with stop",
)
_FULL_SERVICE_CUES = (
    "full service",
    "full-service",
    "gross rent",
    "full service gross",
)
_INCLUDED_CUES = (
    "included in rent",
    "included in base rent",
    "landlord shall pay all operating expenses",
)


def _source_weight(source: str) -> float:
    src = (source or "").lower()
    for key, weight in SOURCE_WEIGHTS.items():
        if key in src:
            return weight
    return 0.22


def _parse_date(value: Any) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m.%d.%Y",
        "%m-%d-%Y",
        "%B %d, %Y",
        "%b %d, %Y",
    ):
        try:
            return datetime.strptime(raw, fmt).date()
        except Exception:
            continue
    return None


def _date_iso(value: Any) -> str | None:
    parsed = _parse_date(value)
    return parsed.isoformat() if parsed else None


def _month_diff(start: date, end: date) -> int:
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return max(0, months)


def _expiration_from_term_months(commencement: date, term_months: int) -> date:
    tm = max(1, int(term_months))
    total = (commencement.month - 1) + tm
    year = commencement.year + (total // 12)
    month = (total % 12) + 1
    anniv = date(year, month, min(commencement.day, 28))
    return anniv - timedelta(days=1)


def _commencement_from_term_months(expiration: date, term_months: int) -> date:
    tm = max(1, int(term_months))
    # Inverse of expiration_from_term_months approximation.
    anchor = expiration + timedelta(days=1)
    y = anchor.year
    m = anchor.month - tm
    while m <= 0:
        y -= 1
        m += 12
    return date(y, m, 1)


def _safe_float(value: Any, default: float | None = None) -> float | None:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int | None = None) -> int | None:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except Exception:
        return default


def _snippet_score_adjustment(snippet: str, source: str) -> float:
    low = (snippet or "").lower()
    score = 0.0
    if any(k in low for k in _TABLE_HEADER_CUES):
        score += 0.10
    if any(k in low for k in _EXHIBIT_CUES):
        score += 0.05
    if "base rent" in low and any(k in low for k in _DEFINITION_CUES):
        score += 0.05
    if any(k in low for k in _HEADER_FOOTER_NOISE):
        score -= 0.12
    if any(k in low for k in _REVISED_CUES):
        score += 0.10
    if _is_strike_only(snippet):
        score -= 0.35
    if "whereas" in low and "scheduled to expire" in low:
        score -= 0.10
    if "amendment" in low and ("extended" in low or "amended" in low):
        score += 0.07
    if "table" in (source or "").lower():
        score += 0.04
    return score


def _is_strike_only(snippet: str) -> bool:
    low = (snippet or "").lower()
    has_strike = any(k in low for k in _STRIKE_CUES)
    has_replacement = any(k in low for k in _REVISED_CUES)
    return has_strike and not has_replacement


def _candidate_score(candidate: dict[str, Any]) -> float:
    conf = float(candidate.get("source_confidence") or 0.0)
    source = str(candidate.get("source") or "")
    snippet = str(candidate.get("snippet") or "")
    score = (_source_weight(source) * 0.6) + (conf * 0.4)
    low_src = source.lower()
    if "::override::" in low_src or "::amendment::" in low_src or "::counter::" in low_src or "::redline::" in low_src:
        score += 0.08
    if "::base_lease::" in low_src and any(k in snippet.lower() for k in ("whereas", "scheduled to expire")):
        score -= 0.06
    score += _snippet_score_adjustment(snippet, source)
    return max(0.0, min(1.0, score))


def _evidence_from_candidates(cands: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for c in cands:
        key = (c.get("page"), c.get("snippet"), c.get("source"))
        if key in seen:
            continue
        seen.add(key)
        evidence.append(
            {
                "page": c.get("page"),
                "snippet": c.get("snippet"),
                "bbox": c.get("bbox"),
                "source": c.get("source"),
                "source_confidence": float(c.get("source_confidence") or 0.0),
            }
        )
        if len(evidence) >= limit:
            break
    return evidence


def _value_key(value: Any) -> tuple[str, str]:
    if isinstance(value, float):
        return ("float", f"{round(value, 6):.6f}")
    if isinstance(value, int):
        return ("int", str(value))
    if isinstance(value, str):
        return ("str", value)
    return (type(value).__name__, str(value))


def _collect_scalar_candidates(
    items: list[dict[str, Any]],
    *,
    normalizer,
    max_items: int = 8,
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for item in items or []:
        if _is_strike_only(str(item.get("snippet") or "")):
            continue
        normalized = normalizer(item.get("value"))
        if normalized is None:
            continue
        key = _value_key(normalized)
        score = _candidate_score(item)
        current = grouped.get(key)
        if current is None:
            grouped[key] = {
                "value": normalized,
                "score": score,
                "evidence": [item],
            }
        else:
            current["score"] = max(float(current["score"]), score)
            current["evidence"].append(item)

    ranked = sorted(
        grouped.values(),
        key=lambda x: (-float(x["score"]), _value_key(x["value"])),
    )
    return ranked[:max_items]


def _collect_term_sets(by_field: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    comm_cands = _collect_scalar_candidates(by_field.get("commencement_date", []), normalizer=_date_iso)
    exp_cands = _collect_scalar_candidates(by_field.get("expiration_date", []), normalizer=_date_iso)
    tm_cands = _collect_scalar_candidates(
        by_field.get("term_months", []),
        normalizer=lambda v: max(0, int(v)) if _safe_int(v, None) is not None else None,
    )

    # Derived candidates from observed pairs.
    for comm in comm_cands[:4]:
        d_comm = _parse_date(comm["value"])
        if not d_comm:
            continue
        for exp in exp_cands[:4]:
            d_exp = _parse_date(exp["value"])
            if not d_exp:
                continue
            implied = _month_diff(d_comm, d_exp)
            tm_cands.append(
                {
                    "value": implied,
                    "score": max(0.0, min(1.0, (comm["score"] + exp["score"]) / 2.0 + 0.05)),
                    "evidence": [*(comm.get("evidence") or []), *(exp.get("evidence") or [])],
                }
            )
            tm_cands.append(
                {
                    "value": implied + 1,
                    "score": max(0.0, min(1.0, (comm["score"] + exp["score"]) / 2.0 + 0.03)),
                    "evidence": [*(comm.get("evidence") or []), *(exp.get("evidence") or [])],
                }
            )

    # Deduplicate term months candidates.
    tm_dedup: dict[int, dict[str, Any]] = {}
    for c in tm_cands:
        v = _safe_int(c.get("value"), None)
        if v is None:
            continue
        v = max(0, v)
        prior = tm_dedup.get(v)
        if prior is None or float(c.get("score") or 0.0) > float(prior.get("score") or 0.0):
            tm_dedup[v] = {"value": v, "score": float(c.get("score") or 0.0), "evidence": list(c.get("evidence") or [])}
    tm_cands = sorted(tm_dedup.values(), key=lambda x: (-float(x["score"]), int(x["value"])))[:8]

    # Ensure minimum breadth for candidate generation.
    if not comm_cands:
        comm_cands = [{"value": None, "score": 0.0, "evidence": []}]
    if not exp_cands:
        exp_cands = [{"value": None, "score": 0.0, "evidence": []}]
    if not tm_cands:
        tm_cands = [{"value": 0, "score": 0.0, "evidence": []}]

    while len(comm_cands) < 3:
        comm_cands.append({"value": comm_cands[0]["value"], "score": max(0.0, float(comm_cands[0]["score"]) - 0.08), "evidence": list(comm_cands[0].get("evidence") or [])})
    while len(exp_cands) < 3:
        exp_cands.append({"value": exp_cands[0]["value"], "score": max(0.0, float(exp_cands[0]["score"]) - 0.08), "evidence": list(exp_cands[0].get("evidence") or [])})
    while len(tm_cands) < 3:
        tm_cands.append({"value": tm_cands[0]["value"], "score": max(0.0, float(tm_cands[0]["score"]) - 0.08), "evidence": list(tm_cands[0].get("evidence") or [])})

    term_sets: dict[tuple[str | None, str | None, int], dict[str, Any]] = {}
    for comm, exp, tm in product(comm_cands[:4], exp_cands[:4], tm_cands[:5]):
        comm_iso = comm.get("value")
        exp_iso = exp.get("value")
        term_months = max(0, _safe_int(tm.get("value"), 0) or 0)

        d_comm = _parse_date(comm_iso)
        d_exp = _parse_date(exp_iso)
        derived = False

        if d_comm and d_exp and term_months <= 0:
            term_months = max(0, _month_diff(d_comm, d_exp))
            derived = True
        if d_comm and not d_exp and term_months > 0:
            d_exp = _expiration_from_term_months(d_comm, term_months)
            exp_iso = d_exp.isoformat()
            derived = True
        if d_exp and not d_comm and term_months > 0:
            d_comm = _commencement_from_term_months(d_exp, term_months)
            comm_iso = d_comm.isoformat()
            derived = True
        if d_comm and d_exp and term_months <= 0:
            term_months = max(0, _month_diff(d_comm, d_exp))
            derived = True

        key = (comm_iso, exp_iso, term_months)
        score = (
            float(comm.get("score") or 0.0)
            + float(exp.get("score") or 0.0)
            + float(tm.get("score") or 0.0)
        ) / 3.0
        if derived:
            score = max(0.0, min(1.0, score + 0.04))

        evidence = [
            *(comm.get("evidence") or []),
            *(exp.get("evidence") or []),
            *(tm.get("evidence") or []),
        ]
        prev = term_sets.get(key)
        if prev is None or score > float(prev.get("score") or 0.0):
            term_sets[key] = {
                "commencement_date": comm_iso,
                "expiration_date": exp_iso,
                "term_months": term_months,
                "score": score,
                "evidence": evidence,
            }

    ranked = sorted(
        term_sets.values(),
        key=lambda x: (
            -float(x.get("score") or 0.0),
            str(x.get("commencement_date") or ""),
            str(x.get("expiration_date") or ""),
            int(x.get("term_months") or 0),
        ),
    )
    return ranked[:12] if ranked else [{"commencement_date": None, "expiration_date": None, "term_months": 0, "score": 0.0, "evidence": []}]


def _normalize_step(step: dict[str, Any]) -> dict[str, Any] | None:
    start = _safe_int(step.get("start_month", step.get("start")), None)
    end = _safe_int(step.get("end_month", step.get("end")), start)
    rate = _safe_float(step.get("rate_psf_annual", step.get("rate_psf_yr")), None)
    if start is None or end is None or rate is None:
        return None
    start = max(0, start)
    end = max(start, end)
    rate = max(0.0, float(rate))
    monthly = _safe_float(step.get("monthly_amount"), None)
    return {
        "start_month": int(start),
        "end_month": int(end),
        "rate_psf_annual": float(rate),
        "monthly_amount": float(monthly) if monthly is not None else None,
    }


def _looks_like_year_index_schedule(steps: list[dict[str, Any]], term_months: int) -> bool:
    if len(steps) < 2:
        return False
    max_end = max(int(s["end_month"]) for s in steps)
    max_span = max(int(s["end_month"]) - int(s["start_month"]) + 1 for s in steps)
    if max_end <= 20 and max_span <= 2 and term_months >= 24:
        return True
    return False


def _convert_year_index_to_months(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not steps:
        return []
    min_start = min(int(s["start_month"]) for s in steps)
    one_based = min_start >= 1
    out: list[dict[str, Any]] = []
    for s in sorted(steps, key=lambda x: (int(x["start_month"]), int(x["end_month"]))):
        start_y = int(s["start_month"]) - (1 if one_based else 0)
        end_y = int(s["end_month"]) - (1 if one_based else 0)
        start_y = max(0, start_y - min(0 if not one_based else 0, 0))
        end_y = max(start_y, end_y)
        out.append(
            {
                "start_month": start_y * 12,
                "end_month": ((end_y + 1) * 12) - 1,
                "rate_psf_annual": float(s["rate_psf_annual"]),
                "monthly_amount": s.get("monthly_amount"),
            }
        )
    return out


def _materialize_schedule(raw_steps: list[dict[str, Any]], term_months: int, *, repair: bool) -> list[dict[str, Any]]:
    if not raw_steps:
        if term_months <= 0:
            return [{"start_month": 0, "end_month": 0, "rate_psf_annual": 0.0}]
        return [{"start_month": 0, "end_month": max(0, term_months - 1), "rate_psf_annual": 0.0}]

    steps = [dict(s) for s in raw_steps]
    if _looks_like_year_index_schedule(steps, term_months):
        steps = _convert_year_index_to_months(steps)

    steps = sorted(steps, key=lambda s: (int(s["start_month"]), int(s["end_month"])))
    if not repair:
        return [
            {
                "start_month": int(s["start_month"]),
                "end_month": int(s["end_month"]),
                "rate_psf_annual": float(s["rate_psf_annual"]),
                **({"monthly_amount": float(s["monthly_amount"])} if s.get("monthly_amount") is not None else {}),
            }
            for s in steps
        ]

    fixed: list[dict[str, Any]] = []
    expected = 0
    for s in steps:
        start = max(0, int(s["start_month"]))
        end = max(start, int(s["end_month"]))
        rate = max(0.0, float(s["rate_psf_annual"]))
        if not fixed and start != 0:
            start = 0
        if start != expected:
            start = expected
            end = max(start, end)
        fixed.append(
            {
                "start_month": start,
                "end_month": end,
                "rate_psf_annual": rate,
                **({"monthly_amount": float(s["monthly_amount"])} if s.get("monthly_amount") is not None else {}),
            }
        )
        expected = end + 1

    if term_months > 0:
        target_end = max(0, term_months - 1)
        fixed = [s for s in fixed if int(s["start_month"]) <= target_end]
        if not fixed:
            fixed = [{"start_month": 0, "end_month": target_end, "rate_psf_annual": 0.0}]
        else:
            fixed[-1]["end_month"] = target_end
    return fixed


def _collect_rent_schedule_candidates(
    by_field: dict[str, list[dict[str, Any]]],
    llm_output: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in by_field.get("rent_steps", []) or []:
        source = str(c.get("source") or "")
        if _is_strike_only(str(c.get("snippet") or "")):
            continue
        if any(k in source.lower() for k in ("table", "camelot", "tabula", "textract")):
            family = "table"
        elif "text_line_regex" in source.lower() or "pdf_text_regex" in source.lower():
            family = "regex"
        else:
            family = "other"
        grouped[family].append(c)

    out: list[dict[str, Any]] = []
    for family, items in grouped.items():
        by_range: dict[tuple[int, int], tuple[dict[str, Any], float]] = {}
        for item in items:
            value = item.get("value") if isinstance(item.get("value"), dict) else item
            step = _normalize_step(value)
            if step:
                key = (int(step["start_month"]), int(step["end_month"]))
                score = _candidate_score(item)
                prev = by_range.get(key)
                if prev is None or score > prev[1]:
                    by_range[key] = (step, score)
        steps: list[dict[str, Any]] = [v[0] for v in by_range.values()]
        if not steps:
            continue
        score = 0.0
        for i in items:
            score = max(score, _candidate_score(i))
        out.append(
            {
                "label": f"{family}_raw",
                "raw_steps": steps,
                "repair": False,
                "score": max(0.0, min(1.0, score + (0.05 if family == "table" else 0.0))),
                "evidence": items,
            }
        )
        out.append(
            {
                "label": f"{family}_repaired",
                "raw_steps": steps,
                "repair": True,
                "score": max(0.0, min(1.0, score + 0.04)),
                "evidence": items,
            }
        )

    llm_steps_raw = None
    if isinstance(llm_output, dict) and isinstance(llm_output.get("rent_steps"), list):
        llm_steps_raw = llm_output.get("rent_steps")
    if llm_steps_raw:
        llm_steps: list[dict[str, Any]] = []
        for raw in llm_steps_raw:
            if not isinstance(raw, dict):
                continue
            step = _normalize_step(raw)
            if step:
                llm_steps.append(step)
        if llm_steps:
            ev = [
                {
                    "page": None,
                    "snippet": "llm_structured_output.rent_steps",
                    "bbox": None,
                    "source": "llm",
                    "source_confidence": 0.6,
                }
            ]
            out.append(
                {
                    "label": "llm_raw",
                    "raw_steps": llm_steps,
                    "repair": False,
                    "score": 0.58,
                    "evidence": ev,
                }
            )
            out.append(
                {
                    "label": "llm_repaired",
                    "raw_steps": llm_steps,
                    "repair": True,
                    "score": 0.62,
                    "evidence": ev,
                }
            )

    # Always include deterministic fallback candidate.
    out.append(
        {
            "label": "fallback_single_step",
            "raw_steps": [{"start_month": 0, "end_month": 0, "rate_psf_annual": 0.0}],
            "repair": True,
            "score": 0.05,
            "evidence": [],
        }
    )

    # Deduplicate by steps+repair signature.
    dedup: dict[tuple[Any, ...], dict[str, Any]] = {}
    for c in out:
        key = (
            c.get("repair"),
            tuple(
                (
                    int(s.get("start_month") or 0),
                    int(s.get("end_month") or 0),
                    round(float(s.get("rate_psf_annual") or 0.0), 4),
                )
                for s in sorted(c.get("raw_steps") or [], key=lambda x: (int(x.get("start_month") or 0), int(x.get("end_month") or 0)))
            ),
        )
        prev = dedup.get(key)
        if prev is None or float(c.get("score") or 0.0) > float(prev.get("score") or 0.0):
            dedup[key] = c

    ranked = sorted(dedup.values(), key=lambda x: (-float(x.get("score") or 0.0), str(x.get("label") or "")))
    # Generate at least 3 schedule interpretations.
    while len(ranked) < 3:
        ranked.append(
            {
                "label": f"synthetic_{len(ranked) + 1}",
                "raw_steps": [{"start_month": 0, "end_month": 0, "rate_psf_annual": 0.0}],
                "repair": True,
                "score": max(0.0, 0.03 - (0.005 * len(ranked))),
                "evidence": [],
            }
        )
    return ranked[:10]


def _extract_abatement_windows(snippet: str) -> list[dict[str, int]]:
    low = (snippet or "").lower()
    if not any(k in low for k in ("free rent", "abatement", "abated", "waived")):
        return []

    windows: list[dict[str, int]] = []
    for m in __import__("re").finditer(r"(?i)months?\s*(\d{1,3})\s*(?:-|to|through|thru|–|—)\s*(\d{1,3})", snippet or ""):
        s = max(1, int(m.group(1)))
        e = max(s, int(m.group(2)))
        windows.append({"start_month": s - 1, "end_month": e - 1})
    for m in __import__("re").finditer(r"(?i)\b(\d{1,2})\s+months?\b", snippet or ""):
        count = int(m.group(1))
        if 0 < count <= 24:
            windows.append({"start_month": 0, "end_month": count - 1})
    dedup: dict[tuple[int, int], dict[str, int]] = {}
    for w in windows:
        key = (int(w["start_month"]), int(w["end_month"]))
        dedup[key] = w
    return [dedup[k] for k in sorted(dedup)]


def _infer_abatement_scope(snippet: str, definitions_hint: str) -> str:
    low = f" {(snippet or '').lower()} "
    if any(k in low for k in ("gross rent", "all rent", "base rent and operating", "rent and operating expenses", "base rent plus operating", "base rent and cam")):
        return "gross_rent"
    if any(k in low for k in ("base rent only", "base-rent-only", "base rental only")):
        return "base_rent_only"
    if " base rent " in low and not any(k in low for k in ("operating", "cam", "gross", "all rent")):
        return "base_rent_only"
    if " rent " in low and "additional rent" in (definitions_hint or ""):
        return "gross_rent"
    return "unspecified"


def _collect_abatement_candidates(
    by_field: dict[str, list[dict[str, Any]]],
    llm_output: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], bool, float, list[dict[str, Any]]]:
    scope_items = list(by_field.get("abatement_scope", []) or [])
    class_items = list(by_field.get("abatement_classification", []) or [])
    phase_items = list(by_field.get("phase_in_detected", []) or [])
    definition_items = list(by_field.get("rent_definition_scope", []) or [])

    global_snippets = "\n".join(str(i.get("snippet") or "") for i in (scope_items + class_items + definition_items))
    def_hint = ""
    gl = global_snippets.lower()
    if any(str(i.get("value") or "").strip().lower() == "rent_includes_additional" for i in definition_items):
        def_hint = "additional rent"
    elif any(str(i.get("value") or "").strip().lower() == "rent_base_only" for i in definition_items):
        def_hint = "base rent only"
    if "rent means" in gl and ("additional rent" in gl or "operating expenses" in gl or "cam" in gl):
        def_hint = "additional rent"

    windows_pool: list[tuple[list[dict[str, int]], float, list[dict[str, Any]]]] = []
    for item in scope_items + class_items:
        snippet = str(item.get("snippet") or "")
        win = _extract_abatement_windows(snippet)
        if not win:
            continue
        windows_pool.append((win, _candidate_score(item), [item]))

    llm_abatements = []
    if isinstance(llm_output, dict) and isinstance(llm_output.get("abatements"), list):
        for raw in llm_output.get("abatements") or []:
            if not isinstance(raw, dict):
                continue
            s = _safe_int(raw.get("start_month"), None)
            e = _safe_int(raw.get("end_month"), s)
            if s is None or e is None:
                continue
            llm_abatements.append({"start_month": max(0, s), "end_month": max(max(0, s), e)})
    if llm_abatements:
        windows_pool.append(
            (
                llm_abatements,
                0.55,
                [
                    {
                        "page": None,
                        "snippet": "llm_structured_output.abatements",
                        "bbox": None,
                        "source": "llm",
                        "source_confidence": 0.6,
                    }
                ],
            )
        )

    if not windows_pool:
        windows_pool.append(([], 0.4, []))

    scope_values: list[tuple[str, float, list[dict[str, Any]]]] = []
    for item in scope_items:
        scope = str(item.get("value") or "").strip().lower()
        if not scope:
            continue
        if scope not in {"base_rent_only", "gross_rent", "unspecified"}:
            scope = _infer_abatement_scope(str(item.get("snippet") or ""), def_hint)
        if scope == "unspecified" and def_hint == "additional rent":
            snippet = str(item.get("snippet") or "").lower()
            if "rent abatement" in snippet or "free rent" in snippet:
                scope = "gross_rent"
        scope_values.append((scope, _candidate_score(item), [item]))

    if not scope_values:
        inferred = _infer_abatement_scope(global_snippets, def_hint)
        if inferred == "unspecified" and def_hint == "additional rent":
            inferred = "gross_rent"
        scope_values.append((inferred, 0.46, []))

    # Always provide multiple scope interpretations for solver.
    scope_values.extend([
        ("base_rent_only", 0.32, []),
        ("gross_rent", 0.32, []),
        ("unspecified", 0.20, []),
    ])

    dedup_scopes: dict[str, tuple[str, float, list[dict[str, Any]]]] = {}
    for scope, sc, ev in scope_values:
        prev = dedup_scopes.get(scope)
        if prev is None or sc > prev[1]:
            dedup_scopes[scope] = (scope, sc, ev)
    scope_values = sorted(dedup_scopes.values(), key=lambda row: (-row[1], row[0]))

    candidates: list[dict[str, Any]] = []
    for win, win_score, win_ev in windows_pool[:4]:
        for scope, scope_score, scope_ev in scope_values[:4]:
            abatements = []
            for w in win:
                abatements.append(
                    {
                        "start_month": int(w["start_month"]),
                        "end_month": int(w["end_month"]),
                        "scope": scope,
                        "classification": "rent_abatement",
                    }
                )
            candidates.append(
                {
                    "abatements": abatements,
                    "score": max(0.0, min(1.0, (float(win_score) + float(scope_score)) / 2.0)),
                    "evidence": [*win_ev, *scope_ev],
                }
            )

    # Include explicit no-abatement interpretation.
    candidates.append({"abatements": [], "score": 0.28, "evidence": []})

    dedup: dict[tuple[Any, ...], dict[str, Any]] = {}
    for c in candidates:
        key = tuple(
            (
                int(a.get("start_month") or 0),
                int(a.get("end_month") or 0),
                str(a.get("scope") or ""),
            )
            for a in c.get("abatements") or []
        )
        prev = dedup.get(key)
        if prev is None or float(c.get("score") or 0.0) > float(prev.get("score") or 0.0):
            dedup[key] = c

    phase_detected = any(bool(i.get("value")) for i in phase_items) or any(str(i.get("value") or "").strip().lower() == "phase_in" for i in class_items)
    phase_conf = 0.0
    for i in phase_items + class_items:
        if str(i.get("value") or "").strip().lower() in {"true", "1", "phase_in"} or bool(i.get("value")):
            phase_conf = max(phase_conf, _candidate_score(i))

    ranked = sorted(dedup.values(), key=lambda x: (-float(x.get("score") or 0.0), str(x.get("abatements") or "")))
    while len(ranked) < 3:
        ranked.append({"abatements": [], "score": max(0.0, 0.22 - 0.02 * len(ranked)), "evidence": []})

    analysis_evidence = [*scope_items[:4], *class_items[:4], *phase_items[:4], *definition_items[:4]]
    return ranked[:8], phase_detected, phase_conf, analysis_evidence


def _collect_opex_candidates(
    by_field: dict[str, list[dict[str, Any]]],
    llm_output: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], str]:
    mode_items = list(by_field.get("opex_mode", []) or [])
    base_items = list(by_field.get("opex_psf_year_1", []) or [])
    growth_items = list(by_field.get("opex_growth_rate", []) or [])

    snippets = "\n".join(str(i.get("snippet") or "") for i in (mode_items + base_items + growth_items)).lower()

    if isinstance(llm_output, dict) and isinstance(llm_output.get("opex"), dict):
        llm_opex = llm_output.get("opex") or {}
        if llm_opex.get("mode") not in (None, ""):
            mode_items.append(
                {
                    "field": "opex_mode",
                    "value": llm_opex.get("mode"),
                    "snippet": "llm_structured_output.opex.mode",
                    "source": "llm",
                    "source_confidence": 0.6,
                    "page": None,
                    "bbox": None,
                }
            )
        if llm_opex.get("base_psf_year_1") not in (None, ""):
            base_items.append(
                {
                    "field": "opex_psf_year_1",
                    "value": llm_opex.get("base_psf_year_1"),
                    "snippet": "llm_structured_output.opex.base_psf_year_1",
                    "source": "llm",
                    "source_confidence": 0.6,
                    "page": None,
                    "bbox": None,
                }
            )
        if llm_opex.get("growth_rate") not in (None, ""):
            growth_items.append(
                {
                    "field": "opex_growth_rate",
                    "value": llm_opex.get("growth_rate"),
                    "snippet": "llm_structured_output.opex.growth_rate",
                    "source": "llm",
                    "source_confidence": 0.6,
                    "page": None,
                    "bbox": None,
                }
            )

    mode_cands = _collect_scalar_candidates(
        mode_items,
        normalizer=lambda v: str(v).strip().lower().replace("-", "_").replace(" ", "_") if str(v or "").strip() else None,
    )
    base_cands = _collect_scalar_candidates(base_items, normalizer=lambda v: max(0.0, float(v)) if _safe_float(v, None) is not None else None)
    growth_cands = _collect_scalar_candidates(growth_items, normalizer=lambda v: max(0.0, float(v)) if _safe_float(v, None) is not None else None)

    inferred_mode = ""
    if any(k in snippets for k in _BASE_YEAR_CUES):
        inferred_mode = "base_year"
    elif any(k in snippets for k in _FULL_SERVICE_CUES):
        inferred_mode = "full_service"
    elif any(k in snippets for k in _NNN_CUES):
        inferred_mode = "nnn"

    if inferred_mode:
        mode_cands.append({"value": inferred_mode, "score": 0.54, "evidence": []})

    if not mode_cands:
        mode_cands = [{"value": "nnn", "score": 0.24, "evidence": []}]
    if not base_cands:
        base_cands = [{"value": None, "score": 0.0, "evidence": []}, {"value": 0.0, "score": 0.12, "evidence": []}]
    if not growth_cands:
        growth_cands = [{"value": 0.03, "score": 0.2, "evidence": []}]

    while len(mode_cands) < 3:
        mode_cands.append({"value": mode_cands[0]["value"], "score": max(0.0, float(mode_cands[0]["score"]) - 0.08), "evidence": list(mode_cands[0].get("evidence") or [])})

    candidates: list[dict[str, Any]] = []
    for mode, base, growth in product(mode_cands[:4], base_cands[:4], growth_cands[:3]):
        m = str(mode.get("value") or "").strip().lower()
        if m == "gross_with_stop":
            m = "base_year"
        if m not in {"nnn", "base_year", "full_service", ""}:
            continue
        score = (
            float(mode.get("score") or 0.0)
            + float(base.get("score") or 0.0)
            + float(growth.get("score") or 0.0)
        ) / 3.0
        candidates.append(
            {
                "mode": m or inferred_mode or "nnn",
                "base_psf_year_1": _safe_float(base.get("value"), None),
                "growth_rate": _safe_float(growth.get("value"), 0.03) or 0.03,
                "score": max(0.0, min(1.0, score)),
                "evidence": [
                    *(mode.get("evidence") or []),
                    *(base.get("evidence") or []),
                    *(growth.get("evidence") or []),
                ],
            }
        )

    dedup: dict[tuple[str, float | None, float], dict[str, Any]] = {}
    for c in candidates:
        key = (
            str(c.get("mode") or ""),
            None if c.get("base_psf_year_1") is None else round(float(c.get("base_psf_year_1") or 0.0), 4),
            round(float(c.get("growth_rate") or 0.0), 4),
        )
        prev = dedup.get(key)
        if prev is None or float(c.get("score") or 0.0) > float(prev.get("score") or 0.0):
            dedup[key] = c

    ranked = sorted(dedup.values(), key=lambda x: (-float(x.get("score") or 0.0), str(x.get("mode") or ""), str(x.get("base_psf_year_1"))))
    while len(ranked) < 3:
        ranked.append({"mode": inferred_mode or "nnn", "base_psf_year_1": 0.0, "growth_rate": 0.03, "score": max(0.0, 0.18 - 0.02 * len(ranked)), "evidence": []})
    return ranked[:10], snippets


def _check_rent_coverage(steps: list[dict[str, Any]], term_months: int) -> bool:
    if term_months <= 0:
        return bool(steps)
    if not steps:
        return False
    expected = 0
    for s in sorted(steps, key=lambda x: (int(x.get("start_month") or 0), int(x.get("end_month") or 0))):
        start = int(s.get("start_month") or 0)
        end = int(s.get("end_month") or start)
        if start != expected:
            return False
        if end < start:
            return False
        expected = end + 1
    return expected - 1 == term_months - 1


def _validate_candidate_set(
    *,
    term: dict[str, Any],
    rent_steps: list[dict[str, Any]],
    abatements: list[dict[str, Any]],
    opex: dict[str, Any],
    opex_cues: str,
    rsf: float | None,
) -> tuple[bool, list[str], float]:
    reasons: list[str] = []
    consistency = 0.0

    comm = _parse_date(term.get("commencement_date"))
    exp = _parse_date(term.get("expiration_date"))
    tm = max(0, _safe_int(term.get("term_months"), 0) or 0)

    if comm and exp:
        implied = _month_diff(comm, exp)
        if abs(implied - tm) > 1:
            reasons.append("term_mismatch")
        else:
            consistency += 0.35
    if tm <= 0:
        reasons.append("term_missing")

    if not _check_rent_coverage(rent_steps, tm):
        reasons.append("rent_coverage")
    else:
        consistency += 0.35

    if rsf and rsf > 0:
        monthly_checks = 0
        monthly_pass = 0
        for s in rent_steps:
            monthly = _safe_float(s.get("monthly_amount"), None)
            if monthly is None:
                continue
            monthly_checks += 1
            implied = (float(s.get("rate_psf_annual") or 0.0) * float(rsf)) / 12.0
            if implied <= 0:
                continue
            err = abs(monthly - implied) / implied
            if err <= 0.05:
                monthly_pass += 1
        if monthly_checks > 0:
            if monthly_pass != monthly_checks:
                reasons.append("rent_psf_monthly_tolerance")
            else:
                consistency += 0.15

    for a in abatements:
        s = int(a.get("start_month") or 0)
        e = int(a.get("end_month") or s)
        if e < s:
            reasons.append("abatement_range")
            break
        if tm > 0 and (s < 0 or e >= tm):
            reasons.append("abatement_outside_term")
            break
    if not any(r.startswith("abatement") for r in reasons):
        consistency += 0.10

    mode = str(opex.get("mode") or "").strip().lower().replace("-", "_").replace(" ", "_")
    base = _safe_float(opex.get("base_psf_year_1"), None)
    if mode not in {"nnn", "base_year", "full_service"}:
        reasons.append("opex_mode")
    else:
        nnn_cues = any(k in opex_cues for k in _NNN_CUES)
        base_year_cues = any(k in opex_cues for k in _BASE_YEAR_CUES)
        included_cues = any(k in opex_cues for k in _INCLUDED_CUES)

        if mode in {"nnn", "base_year"}:
            if (base is None or base <= 0.0) and not included_cues:
                if not (nnn_cues or base_year_cues):
                    reasons.append("opex_incomplete")
                else:
                    reasons.append("opex_nnn_missing_base")
            else:
                consistency += 0.20
        elif mode == "full_service":
            if base is None:
                consistency += 0.10
            elif base >= 0.0:
                consistency += 0.10

    ok = len(reasons) == 0
    return ok, reasons, consistency


def _select_scalar_sections(by_field: dict[str, list[dict[str, Any]]]) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    resolved: dict[str, Any] = {
        "premises": {},
        "opex": {},
        "concessions": {},
        "tenant_improvements": {},
        "parking": {},
        "rights_options": {},
    }
    provenance: dict[str, list[dict[str, Any]]] = {}

    field_mapping = {
        "building_name": ("premises", "building_name", lambda v: str(v).strip() if str(v or "").strip() else None),
        "suite": ("premises", "suite", lambda v: str(v).strip().upper() if str(v or "").strip() else None),
        "floor": ("premises", "floor", lambda v: str(v).strip() if str(v or "").strip() else None),
        "address": ("premises", "address", lambda v: str(v).strip() if str(v or "").strip() else None),
        "rsf": ("premises", "rsf", lambda v: max(0.0, float(v)) if _safe_float(v, None) is not None else None),
        "free_rent_months": ("concessions", "free_rent_months", lambda v: max(0, int(v)) if _safe_int(v, None) is not None else None),
        "ti_allowance_psf": ("tenant_improvements", "ti_allowance_psf", lambda v: max(0.0, float(v)) if _safe_float(v, None) is not None else None),
        "ti_allowance_total": ("tenant_improvements", "ti_allowance_total", lambda v: max(0.0, float(v)) if _safe_float(v, None) is not None else None),
        "parking_ratio": ("parking", "ratio_per_1000_rsf", lambda v: max(0.0, float(v)) if _safe_float(v, None) is not None else None),
        "parking_rate_monthly": ("parking", "rate_monthly_per_space", lambda v: max(0.0, float(v)) if _safe_float(v, None) is not None else None),
        "parking_spaces": ("parking", "spaces", lambda v: max(0, int(v)) if _safe_int(v, None) is not None else None),
        "renewal_option": ("rights_options", "renewal_option", lambda v: str(v).strip() if str(v or "").strip() else None),
        "termination_right": ("rights_options", "termination_right", lambda v: str(v).strip() if str(v or "").strip() else None),
        "expansion_option": ("rights_options", "expansion_option", lambda v: str(v).strip() if str(v or "").strip() else None),
        "contraction_option": ("rights_options", "contraction_option", lambda v: str(v).strip() if str(v or "").strip() else None),
        "rofr_rofo": ("rights_options", "rofr_rofo", lambda v: str(v).strip() if str(v or "").strip() else None),
    }

    for field, (bucket, key, normalizer) in field_mapping.items():
        cands = _collect_scalar_candidates(by_field.get(field, []), normalizer=normalizer, max_items=3)
        if not cands:
            continue
        chosen = cands[0]
        resolved[bucket][key] = chosen.get("value")
        provenance[f"{bucket}.{key}"] = _evidence_from_candidates(list(chosen.get("evidence") or []), limit=6)

    return resolved, provenance


def _resolve_from_candidate_set(
    *,
    term: dict[str, Any],
    premises: dict[str, Any],
    concessions: dict[str, Any],
    tenant_improvements: dict[str, Any],
    parking: dict[str, Any],
    rights_options: dict[str, Any],
    rent_steps: list[dict[str, Any]],
    abatements: list[dict[str, Any]],
    phase_detected: bool,
    phase_conf: float,
    opex: dict[str, Any],
) -> dict[str, Any]:
    has_abatement = bool(abatements)
    classification = "none"
    if phase_detected and has_abatement:
        classification = "mixed"
    elif phase_detected:
        classification = "phase_in"
    elif has_abatement:
        classification = "rent_abatement"

    free_rent_months = concessions.get("free_rent_months")
    if free_rent_months in (None, "") and abatements:
        free_rent_months = sum(max(0, int(a.get("end_month") or 0) - int(a.get("start_month") or 0) + 1) for a in abatements)

    return {
        "term": {
            "commencement_date": term.get("commencement_date"),
            "expiration_date": term.get("expiration_date"),
            "term_months": int(term.get("term_months") or 0),
        },
        "premises": {
            "building_name": premises.get("building_name"),
            "suite": premises.get("suite"),
            "floor": premises.get("floor"),
            "address": premises.get("address"),
            "rsf": premises.get("rsf"),
        },
        "rent_steps": [
            {
                "start_month": int(s.get("start_month") or 0),
                "end_month": int(s.get("end_month") or 0),
                "rate_psf_annual": float(s.get("rate_psf_annual") or 0.0),
            }
            for s in rent_steps
        ],
        "abatements": [
            {
                "start_month": int(a.get("start_month") or 0),
                "end_month": int(a.get("end_month") or 0),
                "scope": str(a.get("scope") or "unspecified"),
                "classification": "rent_abatement",
            }
            for a in abatements
        ],
        "abatement_analysis": {
            "classification": classification,
            "phase_in_detected": bool(phase_detected),
            "phase_in_confidence": round(float(phase_conf or 0.0), 4),
            "scope": (str(abatements[0].get("scope") or "unspecified") if abatements else None),
        },
        "concessions": {
            "free_rent_months": (None if free_rent_months in (None, "") else int(free_rent_months)),
        },
        "tenant_improvements": {
            "ti_allowance_psf": (None if tenant_improvements.get("ti_allowance_psf") is None else float(tenant_improvements.get("ti_allowance_psf") or 0.0)),
            "ti_allowance_total": (None if tenant_improvements.get("ti_allowance_total") is None else float(tenant_improvements.get("ti_allowance_total") or 0.0)),
        },
        "parking": {
            "ratio_per_1000_rsf": (None if parking.get("ratio_per_1000_rsf") is None else float(parking.get("ratio_per_1000_rsf") or 0.0)),
            "rate_monthly_per_space": (None if parking.get("rate_monthly_per_space") is None else float(parking.get("rate_monthly_per_space") or 0.0)),
            "spaces": (None if parking.get("spaces") is None else int(parking.get("spaces") or 0)),
        },
        "rights_options": {
            "renewal_option": rights_options.get("renewal_option"),
            "termination_right": rights_options.get("termination_right"),
            "expansion_option": rights_options.get("expansion_option"),
            "contraction_option": rights_options.get("contraction_option"),
            "rofr_rofo": rights_options.get("rofr_rofo"),
        },
        "opex": {
            "mode": str(opex.get("mode") or "nnn"),
            "base_psf_year_1": (None if opex.get("base_psf_year_1") is None else float(opex.get("base_psf_year_1") or 0.0)),
            "growth_rate": float(opex.get("growth_rate") or 0.03),
            "cues": [],
        },
    }


def reconcile(
    regex_candidates: dict[str, list[dict[str, Any]]],
    rent_step_candidates: list[dict[str, Any]],
    llm_output: dict[str, Any] | None,
) -> dict[str, Any]:
    by_field: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for field, items in (regex_candidates or {}).items():
        for item in items or []:
            if not isinstance(item, dict):
                continue
            by_field[field].append(item)

    for step in rent_step_candidates or []:
        if not isinstance(step, dict):
            continue
        by_field["rent_steps"].append(
            {
                "field": "rent_steps",
                "value": {
                    "start_month": _safe_int(step.get("start_month"), 0) or 0,
                    "end_month": _safe_int(step.get("end_month"), 0) or 0,
                    "rate_psf_annual": _safe_float(step.get("rate_psf_annual"), 0.0) or 0.0,
                    "monthly_amount": _safe_float(step.get("monthly_amount"), None),
                },
                "page": step.get("page"),
                "snippet": step.get("snippet"),
                "bbox": step.get("bbox"),
                "source": str(step.get("source") or "table_parser"),
                "source_confidence": float(step.get("source_confidence") or 0.7),
            }
        )

    if isinstance(llm_output, dict):
        if isinstance(llm_output.get("term"), dict):
            term_obj = llm_output.get("term") or {}
            for fld in ("commencement_date", "expiration_date", "rent_commencement_date", "term_months"):
                if term_obj.get(fld) in (None, ""):
                    continue
                by_field[fld].append(
                    {
                        "field": fld,
                        "value": term_obj.get(fld),
                        "page": None,
                        "snippet": f"llm_structured_output.term.{fld}",
                        "bbox": None,
                        "source": "llm",
                        "source_confidence": 0.6,
                    }
                )
        if isinstance(llm_output.get("premises"), dict):
            prem_obj = llm_output.get("premises") or {}
            for fld in ("building_name", "suite", "floor", "address", "rsf"):
                if prem_obj.get(fld) in (None, ""):
                    continue
                by_field[fld].append(
                    {
                        "field": fld,
                        "value": prem_obj.get(fld),
                        "page": None,
                        "snippet": f"llm_structured_output.premises.{fld}",
                        "bbox": None,
                        "source": "llm",
                        "source_confidence": 0.6,
                    }
                )
        for section, fields in {
            "concessions": ("free_rent_months",),
            "tenant_improvements": ("ti_allowance_psf", "ti_allowance_total"),
            "parking": ("parking_ratio", "parking_rate_monthly", "parking_spaces"),
            "rights_options": ("renewal_option", "termination_right", "expansion_option", "contraction_option", "rofr_rofo"),
        }.items():
            obj = llm_output.get(section)
            if not isinstance(obj, dict):
                continue
            for fld in fields:
                if obj.get(fld) in (None, ""):
                    continue
                by_field[fld].append(
                    {
                        "field": fld,
                        "value": obj.get(fld),
                        "page": None,
                        "snippet": f"llm_structured_output.{section}.{fld}",
                        "bbox": None,
                        "source": "llm",
                        "source_confidence": 0.6,
                    }
                )

    scalar_resolved, scalar_provenance = _select_scalar_sections(by_field)
    premises = scalar_resolved.get("premises") or {}
    concessions = scalar_resolved.get("concessions") or {}
    tenant_improvements = scalar_resolved.get("tenant_improvements") or {}
    parking = scalar_resolved.get("parking") or {}
    rights_options = scalar_resolved.get("rights_options") or {}
    rsf = _safe_float(premises.get("rsf"), None)

    term_sets = _collect_term_sets(by_field)
    rent_sets = _collect_rent_schedule_candidates(by_field, llm_output)
    abatement_sets, phase_detected, phase_conf, abatement_analysis_evidence = _collect_abatement_candidates(by_field, llm_output)
    opex_sets, opex_cues = _collect_opex_candidates(by_field, llm_output)

    best: dict[str, Any] | None = None
    relaxed_best: dict[str, Any] | None = None
    viable_scores: list[float] = []
    rejected: list[dict[str, Any]] = []

    for term_set, rent_set, abatement_set, opex_set in product(term_sets[:8], rent_sets[:8], abatement_sets[:8], opex_sets[:8]):
        tm = max(0, _safe_int(term_set.get("term_months"), 0) or 0)
        rent_steps = _materialize_schedule(
            list(rent_set.get("raw_steps") or []),
            tm,
            repair=bool(rent_set.get("repair")),
        )
        candidate_opex = dict(opex_set)
        if candidate_opex.get("mode") == "full_service" and candidate_opex.get("base_psf_year_1") is None:
            candidate_opex["base_psf_year_1"] = 0.0

        relaxed_evidence_score = (
            float(term_set.get("score") or 0.0)
            + float(rent_set.get("score") or 0.0)
            + float(abatement_set.get("score") or 0.0)
            + float(candidate_opex.get("score") or 0.0)
        ) / 4.0
        relaxed_soft = 0.0
        if tm > 0:
            relaxed_soft += 0.15
        d_comm = _parse_date(term_set.get("commencement_date"))
        d_exp = _parse_date(term_set.get("expiration_date"))
        if d_comm and d_exp and tm > 0 and abs(_month_diff(d_comm, d_exp) - tm) <= 1:
            relaxed_soft += 0.15
        if tm > 0 and _check_rent_coverage(rent_steps, tm):
            relaxed_soft += 0.15
        relaxed_entry = {
            "score": relaxed_evidence_score + relaxed_soft,
            "validation_score": 0.0,
            "evidence_score": relaxed_evidence_score,
            "consistency_score": relaxed_soft,
            "term": term_set,
            "rent": {**rent_set, "materialized_steps": rent_steps},
            "abatement": abatement_set,
            "opex": candidate_opex,
            "degraded": True,
        }
        if relaxed_best is None or float(relaxed_entry.get("score") or 0.0) > float(relaxed_best.get("score") or 0.0):
            relaxed_best = relaxed_entry

        ok, reasons, consistency = _validate_candidate_set(
            term=term_set,
            rent_steps=rent_steps,
            abatements=list(abatement_set.get("abatements") or []),
            opex=candidate_opex,
            opex_cues=opex_cues,
            rsf=rsf,
        )
        if not ok:
            rejected.append(
                {
                    "term": {
                        "commencement_date": term_set.get("commencement_date"),
                        "expiration_date": term_set.get("expiration_date"),
                        "term_months": term_set.get("term_months"),
                    },
                    "rent_label": rent_set.get("label"),
                    "abatement_count": len(abatement_set.get("abatements") or []),
                    "opex_mode": candidate_opex.get("mode"),
                    "reasons": reasons,
                }
            )
            continue

        evidence_score = (
            float(term_set.get("score") or 0.0)
            + float(rent_set.get("score") or 0.0)
            + float(abatement_set.get("score") or 0.0)
            + float(candidate_opex.get("score") or 0.0)
        ) / 4.0
        validation_score = 1.0
        total_score = validation_score + evidence_score + consistency
        viable_scores.append(float(total_score))

        entry = {
            "score": total_score,
            "validation_score": validation_score,
            "evidence_score": evidence_score,
            "consistency_score": consistency,
            "term": term_set,
            "rent": {**rent_set, "materialized_steps": rent_steps},
            "abatement": abatement_set,
            "opex": candidate_opex,
        }

        if best is None:
            best = entry
            continue

        prior_score = float(best.get("score") or 0.0)
        if total_score > prior_score:
            best = entry
        elif abs(total_score - prior_score) < 1e-9:
            # deterministic tie-break
            prior_key = (
                str((best.get("term") or {}).get("commencement_date") or ""),
                str((best.get("term") or {}).get("expiration_date") or ""),
                int((best.get("term") or {}).get("term_months") or 0),
                str((best.get("rent") or {}).get("label") or ""),
                str((best.get("opex") or {}).get("mode") or ""),
            )
            new_key = (
                str(term_set.get("commencement_date") or ""),
                str(term_set.get("expiration_date") or ""),
                int(term_set.get("term_months") or 0),
                str(rent_set.get("label") or ""),
                str(candidate_opex.get("mode") or ""),
            )
            if new_key < prior_key:
                best = entry

    if best is None:
        # Safe degraded fallback when no fully valid candidate set passes constraints.
        if relaxed_best is not None:
            best = relaxed_best
        else:
            fallback_term = term_sets[0] if term_sets else {"commencement_date": None, "expiration_date": None, "term_months": 0, "score": 0.0, "evidence": []}
            fallback_tm = max(0, _safe_int(fallback_term.get("term_months"), 0) or 0)
            fallback_rent_steps = _materialize_schedule([], fallback_tm, repair=True)
            fallback_abatement = {"abatements": [], "score": 0.0, "evidence": []}
            fallback_opex = {"mode": "nnn", "base_psf_year_1": 0.0, "growth_rate": 0.03, "score": 0.0, "evidence": []}
            best = {
                "score": 0.0,
                "validation_score": 0.0,
                "evidence_score": 0.0,
                "consistency_score": 0.0,
                "term": fallback_term,
                "rent": {"label": "fallback_single_step", "materialized_steps": fallback_rent_steps, "score": 0.0, "evidence": []},
                "abatement": fallback_abatement,
                "opex": fallback_opex,
                "degraded": True,
            }

    resolved = _resolve_from_candidate_set(
        term=best.get("term") or {},
        premises=premises,
        concessions=concessions,
        tenant_improvements=tenant_improvements,
        parking=parking,
        rights_options=rights_options,
        rent_steps=list((best.get("rent") or {}).get("materialized_steps") or []),
        abatements=list((best.get("abatement") or {}).get("abatements") or []),
        phase_detected=phase_detected,
        phase_conf=phase_conf,
        opex=best.get("opex") or {},
    )

    provenance: dict[str, list[dict[str, Any]]] = {}
    provenance.update(scalar_provenance)

    provenance["term.commencement_date"] = _evidence_from_candidates(list((best.get("term") or {}).get("evidence") or []), limit=8)
    provenance["term.expiration_date"] = provenance["term.commencement_date"]
    provenance["term.term_months"] = provenance["term.commencement_date"]

    provenance["rent_steps"] = _evidence_from_candidates(list((best.get("rent") or {}).get("evidence") or []), limit=16)
    provenance["abatements"] = _evidence_from_candidates(list((best.get("abatement") or {}).get("evidence") or []), limit=10)
    provenance["abatement_analysis"] = _evidence_from_candidates(list(abatement_analysis_evidence or []), limit=10)
    provenance["opex"] = _evidence_from_candidates(list((best.get("opex") or {}).get("evidence") or []), limit=10)

    # Compute reconcile margin from first two viable scores when available.
    reconcile_margin = 0.5
    ranked_scores = sorted(viable_scores, reverse=True)
    if len(ranked_scores) >= 2:
        reconcile_margin = max(0.0, min(1.0, ranked_scores[0] - ranked_scores[1]))

    solver_debug = {
        "term_candidates": len(term_sets),
        "rent_candidates": len(rent_sets),
        "abatement_candidates": len(abatement_sets),
        "opex_candidates": len(opex_sets),
        "selected": {
            "score": round(float(best.get("score") or 0.0), 6),
            "validation_score": round(float(best.get("validation_score") or 0.0), 6),
            "evidence_score": round(float(best.get("evidence_score") or 0.0), 6),
            "consistency_score": round(float(best.get("consistency_score") or 0.0), 6),
            "rent_label": str((best.get("rent") or {}).get("label") or ""),
            "term": {
                "commencement_date": (best.get("term") or {}).get("commencement_date"),
                "expiration_date": (best.get("term") or {}).get("expiration_date"),
                "term_months": (best.get("term") or {}).get("term_months"),
            },
            "opex_mode": (best.get("opex") or {}).get("mode"),
        },
        "rejected_preview": rejected[:20],
    }

    return {
        "resolved": resolved,
        "provenance": provenance,
        "reconcile_margin": max(0.0, min(1.0, float(reconcile_margin))),
        "solver_debug": solver_debug,
        "degraded": bool(best.get("degraded", False)),
    }
