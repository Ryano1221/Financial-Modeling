"""
Deterministic multi-scenario lease deck builder.

This module renders a premium, print-safe HTML deck and converts it to PDF via
Playwright. It is intentionally self-contained and avoids frontend runtime JS.
"""
from __future__ import annotations

import base64
import binascii
import html
import math
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


DEFAULT_MONOCHROME = "#111111"
DEFAULT_REPORT_TITLE = "Lease Economics Comparison Deck"
DEFAULT_CONFIDENTIALITY = "Confidential"
MAX_LOGO_BYTES = 1_500_000


@dataclass(frozen=True)
class DeckTheme:
    brand_name: str
    logo_src: str
    client_logo_src: str
    primary_color: str
    header_text: str
    footer_text: str
    prepared_by_name: str
    prepared_by_title: str
    prepared_by_company: str
    prepared_by_email: str
    prepared_by_phone: str
    disclaimer_text: str
    cover_photo: str
    prepared_for: str
    report_date: str
    market: str
    submarket: str
    report_title: str
    confidentiality_line: str


def _safe_float(value: Any, default: float = 0.0) -> float:
    parsed = _numeric_or_none(value)
    if parsed is None:
        return default
    return parsed


def _numeric_or_none(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        if math.isnan(parsed):
            return None
        return parsed
    text = str(value).strip()
    if not text:
        return None
    # Handles common display forms: "$1,234.56", "8%", "45/SF"
    match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return default


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def _fmt_currency(value: Any, precision: int = 0) -> str:
    n = _numeric_or_none(value)
    if n is None:
        return "—"
    v = n
    if precision <= 0:
        return f"${v:,.0f}"
    return f"${v:,.{precision}f}"


def _fmt_number(value: Any, precision: int = 0) -> str:
    n = _numeric_or_none(value)
    if n is None:
        return "—"
    v = n
    if precision <= 0:
        return f"{v:,.0f}"
    return f"{v:,.{precision}f}"


def _fmt_psf(value: Any, precision: int = 2) -> str:
    money = _fmt_currency(value, precision=precision)
    if money == "—":
        return "—"
    return f"{money}/SF"


def _fmt_percent(value: Any, precision: int = 2) -> str:
    n = _numeric_or_none(value)
    if n is None:
        return "—"
    v = n * 100.0
    return f"{v:,.{precision}f}%"


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    for candidate in (text, text[:10]):
        try:
            return datetime.fromisoformat(candidate).date()
        except ValueError:
            continue
    for fmt in (
        "%m.%d.%Y",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%d.%m.%Y",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y/%m/%d",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _fmt_date(value: Any) -> str:
    d = _parse_date(value)
    if d is None:
        return "—"
    return d.strftime("%m.%d.%Y")


def _truncate_text(value: str, max_len: int = 88) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = ((d.month - 1 + months) % 12) + 1
    # day=1 to avoid month-end pitfalls in month arithmetic for schedules
    return date(y, m, 1)


def _month_start_end_dates(commencement: date, start_offset: int, end_offset: int) -> tuple[str, str]:
    start_date = _add_months(commencement, max(0, start_offset))
    end_date = _add_months(commencement, max(0, end_offset) + 1) - timedelta(days=1)
    return start_date.strftime("%m.%d.%Y"), end_date.strftime("%m.%d.%Y")


def _pick(branding: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        if key in branding and branding.get(key) not in (None, ""):
            return str(branding.get(key)).strip()
    return default


def _blank_if_na(value: str) -> str:
    text = str(value or "").strip()
    if text.lower() in {"n/a", "na", "none", "null", "-", "—"}:
        return ""
    return text


def _hex_color_or_default(color: str, default: str = DEFAULT_MONOCHROME) -> str:
    raw = (color or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{3,8}", raw):
        return raw
    return default


def _safe_media_url(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    if len(value) > 4096:
        return ""
    if value.startswith("https://") or value.startswith("http://"):
        return value
    if value.startswith("data:image/"):
        return value
    return ""


def _logo_src_from_base64(logo_b64: str) -> str:
    text = (logo_b64 or "").strip()
    if not text:
        return ""
    if len(text) > 2_000_000:
        return ""
    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        return ""
    if not raw or len(raw) > MAX_LOGO_BYTES:
        return ""
    # Minimal MIME sniffing for safe image embedding.
    mime = "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif raw.startswith(b"GIF8"):
        mime = "image/gif"
    elif raw.startswith(b"<svg") or raw.startswith(b"<?xml"):
        mime = "image/svg+xml"
    elif raw[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    return f"data:{mime};base64,{text}"


def _default_thecremodel_logo_src() -> str:
    env_logo = _safe_media_url(os.environ.get("DEFAULT_BRAND_LOGO_URL", ""))
    if env_logo:
        return env_logo
    root = Path(__file__).resolve().parents[2]
    candidates = [
        root / "frontend" / "public" / "logo.svg",
        root / "frontend" / "public" / "brand" / "logo.svg",
    ]
    for path in candidates:
        try:
            if not path.exists() or not path.is_file():
                continue
            raw = path.read_bytes()
            if not raw:
                continue
            encoded = base64.b64encode(raw).decode("ascii")
            return f"data:image/svg+xml;base64,{encoded}"
        except Exception:
            continue
    return ""


def resolve_theme(branding: dict[str, Any]) -> DeckTheme:
    prepared_by_name = _pick(
        branding,
        "prepared_by_name",
        "preparedByName",
        "broker_name",
        "prepared_by",
        "preparedBy",
        default="theCREmodel",
    )
    brand_name = _pick(
        branding,
        "brand_name",
        "brandName",
        "prepared_by_company",
        "preparedByCompany",
        "broker_name",
        default="theCREmodel",
    ) or "theCREmodel"

    logo_src = (
        _logo_src_from_base64(_pick(branding, "logo_asset_bytes", "logoAssetBytes", "logoAssetBase64"))
        or _safe_media_url(_pick(branding, "logo_asset_url", "logoAssetUrl", "logo_url"))
        or _default_thecremodel_logo_src()
    )
    client_logo_src = (
        _logo_src_from_base64(
            _pick(branding, "client_logo_asset_bytes", "clientLogoAssetBytes", "clientLogoAssetBase64")
        )
        or _safe_media_url(_pick(branding, "client_logo_asset_url", "clientLogoAssetUrl", "client_logo_url"))
    )
    cover_photo = _safe_media_url(_pick(branding, "cover_photo", "coverPhoto"))

    report_date = _fmt_date(_pick(branding, "date", "report_date", "reportDate", default=date.today().isoformat()))
    if report_date == "—":
        report_date = _fmt_date(date.today())

    return DeckTheme(
        brand_name=brand_name,
        logo_src=logo_src,
        client_logo_src=client_logo_src,
        primary_color=_hex_color_or_default(_pick(branding, "primary_color", "primaryColor", default=DEFAULT_MONOCHROME)),
        header_text=_pick(branding, "header_text", "headerText"),
        footer_text=_pick(branding, "footer_text", "footerText"),
        prepared_by_name=prepared_by_name,
        prepared_by_title=_pick(branding, "prepared_by_title", "preparedByTitle"),
        prepared_by_company=_pick(branding, "prepared_by_company", "preparedByCompany", default=brand_name),
        prepared_by_email=_pick(branding, "prepared_by_email", "preparedByEmail"),
        prepared_by_phone=_pick(branding, "prepared_by_phone", "preparedByPhone"),
        disclaimer_text=_pick(
            branding,
            "disclaimer_override",
            "disclaimerOverride",
            default=(
                "This report is for discussion purposes only. Figures are based on supplied assumptions and "
                "extracted lease language. Validate all terms against executed documents."
            ),
        ),
        cover_photo=cover_photo,
        prepared_for=_pick(branding, "client_name", "prepared_for", "preparedFor", default="Client"),
        report_date=report_date,
        market=_blank_if_na(_pick(branding, "market")),
        submarket=_blank_if_na(_pick(branding, "submarket")),
        report_title=_pick(branding, "report_title", "reportTitle", default=DEFAULT_REPORT_TITLE),
        confidentiality_line=_pick(branding, "confidentiality_line", "confidentialityLine", default=DEFAULT_CONFIDENTIALITY),
    )


def _scenario_display_name(scenario: dict[str, Any], fallback: str) -> str:
    building = str(scenario.get("building_name") or "").strip()
    suite = str(scenario.get("suite") or "").strip()
    floor = str(scenario.get("floor") or "").strip()
    if building and suite:
        return f"{building} Suite {suite}"
    if building and floor:
        return f"{building} Floor {floor}"
    return building or fallback


def _extract_entries(data: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    scenarios = data.get("scenarios")
    if not isinstance(scenarios, list):
        return out
    for idx, entry in enumerate(scenarios):
        if not isinstance(entry, dict):
            continue
        scenario = entry.get("scenario") if isinstance(entry.get("scenario"), dict) else {}
        result = entry.get("result") if isinstance(entry.get("result"), dict) else {}
        fallback_name = str(scenario.get("name") or f"Scenario {idx + 1}")
        out.append(
            {
                "scenario": scenario,
                "result": result,
                "name": _scenario_display_name(scenario, fallback_name),
                "doc_type": str(
                    scenario.get("document_type_detected")
                    or scenario.get("document_type")
                    or "Unknown"
                ),
            }
        )
    return out


def _build_page_shell(
    *,
    body_html: str,
    theme: DeckTheme,
    page_no: int,
    total_pages: int,
    section_label: str,
    include_frame: bool = True,
) -> str:
    logo = (
        f'<img class="brand-logo" src="{_esc(theme.logo_src)}" alt="{_esc(theme.brand_name)}" />'
        if theme.logo_src
        else f'<div class="brand-wordmark">{_esc(theme.brand_name)}</div>'
    )
    header = (
        ""
        if not include_frame
        else (
            f"""
            <header class="page-header">
              <div class="header-left">{logo}</div>
              <div class="header-right">
                <div class="header-report-title">{_esc(theme.report_title)}</div>
                <div class="header-sub">{_esc(theme.header_text or section_label)}</div>
              </div>
            </header>
            """
        )
    )
    footer = (
        ""
        if not include_frame
        else (
            f"""
            <footer class="page-footer">
              <span>{_esc(theme.report_date)} · {_esc(theme.confidentiality_line)}</span>
              <span>{_esc(theme.footer_text or theme.brand_name)}</span>
              <span>Page {page_no} of {total_pages}</span>
            </footer>
            """
        )
    )
    return f"""
    <section class="pdf-page">
      {header}
      <div class="page-content"><div class="page-content-inner">{body_html}</div></div>
      {footer}
    </section>
    """.strip()


def SectionTitle(kicker: str, title: str, subtitle: str = "") -> str:
    return f"""
    <div class="section-title-wrap">
      <p class="kicker">{_esc(kicker)}</p>
      <h2 class="section-title">{_esc(title)}</h2>
      {f'<p class="section-subtitle">{_esc(subtitle)}</p>' if subtitle else ""}
    </div>
    """


def KpiTilesRow(items: list[tuple[str, str]]) -> str:
    tiles = "".join(
        f"""
        <div class="kpi-tile">
          <div class="kpi-label">{_esc(label)}</div>
          <div class="kpi-value">{_esc(value)}</div>
        </div>
        """
        for label, value in items
    )
    return f'<div class="kpi-grid">{tiles}</div>'


def _chunk_rows_by_estimated_height(
    rows: list[tuple[str, list[str], str]],
    max_units: int = 24,
) -> list[list[tuple[str, list[str], str]]]:
    chunks: list[list[tuple[str, list[str], str]]] = []
    current: list[tuple[str, list[str], str]] = []
    units = 0
    for row in rows:
        label, values, style = row
        est = max(1, math.ceil(max([len(label), *(len(v) for v in values)]) / 54))
        est += 1 if style == "bullets" else 0
        if current and units + est > max_units:
            chunks.append(current)
            current = []
            units = 0
        current.append(row)
        units += est
    if current:
        chunks.append(current)
    return chunks


def ComparisonMatrixTable(
    entries: list[dict[str, Any]],
    metric_rows: list[tuple[str, list[str], str]],
) -> str:
    option_count = max(1, len(entries))
    metric_width = 18 if option_count >= 8 else 24
    col_width = f"{(100 - metric_width) / option_count:.2f}%"
    colgroup = f'<col style="width:{metric_width}%"/>' + "".join(
        f'<col style="width:{col_width}"/>' for _ in entries
    )
    table_class = "matrix-table matrix-compact" if option_count > 6 else "matrix-table"
    head_cells = "".join(
        f"<th><span class='matrix-head-text'>{_esc(_truncate_text(e['name'], 42))}</span></th>"
        for e in entries
    )

    body_parts: list[str] = []
    for label, values, style in metric_rows:
        tds = []
        for value in values:
            if style == "bullets":
                bullets = [v.strip() for v in value.split(" | ") if v.strip()]
                cell = "<ul class='bullet-mini'>" + "".join(f"<li>{_esc(_truncate_text(b, 120))}</li>" for b in bullets[:3]) + "</ul>"
            else:
                cell = f"<span class='matrix-cell-text'>{_esc(_truncate_text(value, 60))}</span>"
            tds.append(f"<td>{cell}</td>")
        body_parts.append(f"<tr><th><span class='matrix-row-label'>{_esc(label)}</span></th>{''.join(tds)}</tr>")

    return f"""
    <table class="{table_class}">
      <colgroup>{colgroup}</colgroup>
      <thead>
        <tr>
          <th>Metric</th>
          {head_cells}
        </tr>
      </thead>
      <tbody>
        {''.join(body_parts)}
      </tbody>
    </table>
    """


def ChartBlock(title: str, rows: list[tuple[str, float, str]]) -> str:
    max_value = max([r[1] for r in rows], default=1.0) or 1.0
    bars = []
    for name, value, value_label in rows:
        width_pct = max(0.0, min(100.0, (value / max_value) * 100.0))
        bars.append(
            f"""
            <div class="bar-row">
              <div class="bar-row-head">
                <span class="bar-label">{_esc(name)}</span>
                <span class="bar-value">{_esc(value_label)}</span>
              </div>
              <div class="bar-track"><div class="bar-fill" style="width:{width_pct:.3f}%"></div></div>
            </div>
            """
        )
    return f"""
    <article class="chart-block">
      <h3>{_esc(title)}</h3>
      <p class="axis-note">Scale: relative to highest scenario value in this metric.</p>
      {''.join(bars)}
    </article>
    """


def _notes_by_category(raw: str) -> dict[str, list[str]]:
    categories: list[tuple[str, re.Pattern[str]]] = [
        ("Renewal / Extension", re.compile(r"\brenew|extend|option\b", re.I)),
        ("ROFR / ROFO", re.compile(r"\brofr\b|\brofo\b|right of first", re.I)),
        ("Termination", re.compile(r"\btermination|cancel\b", re.I)),
        ("Operating Expenses", re.compile(r"\bopex|operating expense|expense cap|controllable\b", re.I)),
        ("Parking", re.compile(r"\bparking|spaces?\b", re.I)),
        ("Use / Restrictions", re.compile(r"\bpermitted use|use clause|restriction\b", re.I)),
        ("Assignment / Sublease", re.compile(r"\bassignment|sublease|sub-sublease\b", re.I)),
    ]
    parts = [p.strip() for p in re.split(r"\n+|;\s+|\.\s+", raw or "") if p.strip()]
    out: dict[str, list[str]] = {}
    for part in parts:
        matched = False
        for category, pattern in categories:
            if pattern.search(part):
                out.setdefault(category, []).append(part)
                matched = True
                break
        if not matched:
            out.setdefault("General", []).append(part)
    return out


def LeaseAbstractBlock(entry: dict[str, Any]) -> str:
    scenario = entry["scenario"]
    result = entry["result"]
    notes = str(scenario.get("notes") or "")
    categorized = _notes_by_category(notes)

    bullets = [
        f"Document type: {entry['doc_type']}.",
        (
            f"Financial profile: {_fmt_currency(result.get('npv_cost'))} NPV, "
            f"{_fmt_psf(result.get('avg_cost_psf_year'))} average cost/SF/year, "
            f"{_fmt_currency(result.get('total_cost_nominal'))} total obligation."
        ),
        (
            f"Term & area: {_fmt_number(scenario.get('rsf'))} RSF, "
            f"{_fmt_date(scenario.get('commencement'))} to {_fmt_date(scenario.get('expiration'))}."
        ),
    ]

    section_blocks = []
    for category, lines in list(categorized.items())[:4]:
        lis = "".join(f"<li>{_esc(_truncate_text(line, 180))}</li>" for line in lines[:2])
        section_blocks.append(f"<div class='abstract-category'><h4>{_esc(category)}</h4><ul>{lis}</ul></div>")

    if not section_blocks:
        section_blocks.append(
            "<div class='abstract-category'><h4>General</h4><ul><li>No clause notes were extracted. Manually verify options, ROFR/ROFO, termination, and OpEx exclusions.</li></ul></div>"
        )

    return f"""
    <article class="abstract-card">
      <h3>{_esc(entry['name'])}</h3>
      <ul class="abstract-highlights">
        {''.join(f"<li>{_esc(item)}</li>" for item in bullets)}
      </ul>
      <div class="abstract-grid">
        {''.join(section_blocks)}
      </div>
      <p class="verification-note">Verification note: AI-assisted extraction and summary may miss nuanced legal language. Validate all clauses against executed lease documents.</p>
    </article>
    """


def _month_index_base(step_rows: list[dict[str, Any]]) -> int:
    starts = [_safe_int(r.get("start", 0), 0) for r in step_rows]
    return 0 if any(v == 0 for v in starts) else 1


def _extract_rent_steps(scenario: dict[str, Any]) -> list[dict[str, Any]]:
    steps = scenario.get("rent_steps")
    if not isinstance(steps, list):
        return []
    out = []
    for idx, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        out.append(
            {
                "idx": idx + 1,
                "start": _safe_int(step.get("start"), 0),
                "end": _safe_int(step.get("end"), 0),
                "rate": _safe_float(step.get("rate_psf_yr"), 0.0),
            }
        )
    return sorted(out, key=lambda s: (s["start"], s["end"]))


def _extract_phase_steps(scenario: dict[str, Any]) -> list[dict[str, Any]]:
    phase = scenario.get("phase_in_steps")
    if not isinstance(phase, list):
        return []
    out = []
    for item in phase:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "start": _safe_int(item.get("start_month"), 0),
                "end": _safe_int(item.get("end_month"), 0),
                "rsf": _safe_float(item.get("rsf"), 0),
            }
        )
    return sorted(out, key=lambda r: (r["start"], r["end"]))


def _free_rent_range(scenario: dict[str, Any], month_base: int) -> tuple[int, int] | None:
    free_months = max(0, _safe_int(scenario.get("free_rent_months"), 0))
    if free_months <= 0:
        return None
    start = scenario.get("free_rent_start_month")
    end = scenario.get("free_rent_end_month")
    if start is None:
        start = 0 if month_base == 0 else 1
    start_i = _safe_int(start, 0 if month_base == 0 else 1)
    end_i = _safe_int(end, start_i + free_months - 1)
    if end_i < start_i:
        end_i = start_i
    return start_i, end_i


def _rsf_for_month(month_idx: int, scenario: dict[str, Any], phase_steps: list[dict[str, Any]]) -> float:
    for step in phase_steps:
        if step["start"] <= month_idx <= step["end"]:
            return max(0.0, _safe_float(step["rsf"], 0.0))
    return max(0.0, _safe_float(scenario.get("rsf"), 0.0))


def _split_by_calendar_year(
    start_m: int,
    end_m: int,
    commencement: date | None,
    month_base: int,
) -> list[tuple[int, int]]:
    if commencement is None:
        return [(start_m, end_m)]
    ranges: list[tuple[int, int]] = []
    cursor = start_m
    while cursor <= end_m:
        offset = cursor if month_base == 0 else cursor - 1
        d = _add_months(commencement, max(0, offset))
        # Find month index that starts next Jan 1.
        next_jan = date(d.year + 1, 1, 1)
        delta_months = (next_jan.year - d.year) * 12 + (next_jan.month - d.month)
        split_start = cursor + max(1, delta_months)
        seg_end = min(end_m, split_start - 1)
        ranges.append((cursor, seg_end))
        cursor = seg_end + 1
    return ranges


def _scenario_rent_rows(entry: dict[str, Any]) -> list[dict[str, str]]:
    scenario = entry["scenario"]
    steps = _extract_rent_steps(scenario)
    if not steps:
        return [], 0

    month_base = _month_index_base(steps)
    free_range = _free_rent_range(scenario, month_base)
    free_type = str(scenario.get("free_rent_abatement_type") or "base").strip().lower()
    phase_steps = _extract_phase_steps(scenario)
    commencement = _parse_date(scenario.get("commencement"))
    base_opex = _safe_float(scenario.get("base_opex_psf_yr"), 0.0)
    opex_growth = _safe_float(scenario.get("opex_growth"), 0.0)

    expanded: list[dict[str, str]] = []
    for step in steps:
        cuts = {step["start"], step["end"] + 1}
        if free_range is not None:
            fs, fe = free_range
            cuts.add(max(step["start"], fs))
            cuts.add(min(step["end"] + 1, fe + 1))
        for phase in phase_steps:
            cuts.add(max(step["start"], phase["start"]))
            cuts.add(min(step["end"] + 1, phase["end"] + 1))
        split_points = sorted(c for c in cuts if step["start"] <= c <= step["end"] + 1)
        if split_points[0] != step["start"]:
            split_points.insert(0, step["start"])
        if split_points[-1] != step["end"] + 1:
            split_points.append(step["end"] + 1)

        for i in range(len(split_points) - 1):
            seg_start = split_points[i]
            seg_end = split_points[i + 1] - 1
            if seg_end < seg_start:
                continue
            for cal_start, cal_end in _split_by_calendar_year(seg_start, seg_end, commencement, month_base):
                in_free = free_range is not None and not (cal_end < free_range[0] or cal_start > free_range[1])
                display_start = cal_start + (1 if month_base == 0 else 0)
                display_end = cal_end + (1 if month_base == 0 else 0)
                start_date, end_date = ("—", "—")
                if commencement is not None:
                    start_offset = cal_start if month_base == 0 else cal_start - 1
                    end_offset = cal_end if month_base == 0 else cal_end - 1
                    start_date, end_date = _month_start_end_dates(commencement, start_offset, end_offset)

                base_rate = step["rate"]
                note_bits: list[str] = []
                if in_free:
                    if free_type == "gross":
                        base_rate = 0.0
                        note_bits.append("Gross rent abatement")
                    else:
                        base_rate = 0.0
                        note_bits.append("Base-rent abatement")

                rsf_for_segment = _rsf_for_month(cal_start, scenario, phase_steps)
                if phase_steps:
                    note_bits.append("Phase-in occupancy")

                opex_rate = 0.0
                if not (in_free and free_type == "gross"):
                    if commencement is not None:
                        seg_start_offset = cal_start if month_base == 0 else cal_start - 1
                        seg_year = _add_months(commencement, max(0, seg_start_offset)).year
                        year_diff = max(0, seg_year - commencement.year)
                        opex_rate = base_opex * ((1.0 + max(0.0, opex_growth)) ** year_diff)
                    else:
                        opex_rate = base_opex
                if opex_growth > 0:
                    note_bits.append(f"OpEx escalated {opex_growth*100:.2f}% YoY estimate")

                expanded.append(
                    {
                        "step": str(step["idx"]),
                        "start_month": str(display_start),
                        "end_month": str(display_end),
                        "start_date": start_date,
                        "end_date": end_date,
                        "rate_psf_yr": _fmt_number(base_rate, 2),
                        "opex_psf_yr": _fmt_number(opex_rate, 2),
                        "rsf": _fmt_number(rsf_for_segment, 0),
                        "note": " | ".join(dict.fromkeys(note_bits)),
                    }
                )

    return expanded


_DETAIL_CELL_CHAR_BUDGET: dict[str, int] = {
    "step": 7,
    "start_month": 9,
    "end_month": 9,
    "start_date": 12,
    "end_date": 12,
    "rate_psf_yr": 14,
    "opex_psf_yr": 12,
    "rsf": 11,
    "note": 54,
}


def _wrap_line_count(value: str, budget: int) -> int:
    text = str(value or "").strip()
    if not text:
        return 1
    return max(1, math.ceil(len(text) / max(1, budget)))


def _split_note_into_segments(note: str, max_chars: int = 150) -> list[str]:
    cleaned = " ".join(str(note or "").replace("\n", " ").split()).strip()
    if not cleaned:
        return [""]

    parts = [p.strip() for p in cleaned.split("|") if p.strip()]
    if not parts:
        parts = [cleaned]

    segments: list[str] = []
    current: list[str] = []
    current_len = 0
    for part in parts:
        chunk_len = len(part) + (3 if current else 0)
        if current and current_len + chunk_len > max_chars:
            segments.append(" | ".join(current))
            current = [part]
            current_len = len(part)
        else:
            current.append(part)
            current_len += chunk_len
    if current:
        segments.append(" | ".join(current))

    final_segments: list[str] = []
    for segment in segments:
        if len(segment) <= max_chars:
            final_segments.append(segment)
            continue
        start = 0
        while start < len(segment):
            end = min(len(segment), start + max_chars)
            if end < len(segment):
                split_at = segment.rfind(" ", start, end)
                if split_at > start + 24:
                    end = split_at
            final_segments.append(segment[start:end].strip())
            start = end

    return [seg for seg in final_segments if seg] or [""]


def _normalize_detail_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Split oversized notes into continuation rows so no single table row can
    become taller than a printable page segment.
    """
    normalized: list[dict[str, str]] = []
    for row in rows:
        segments = _split_note_into_segments(str(row.get("note") or ""), max_chars=150)
        if len(segments) <= 1:
            item = dict(row)
            item["note"] = segments[0]
            normalized.append(item)
            continue

        for idx, segment in enumerate(segments):
            item = dict(row)
            item["note"] = segment
            if idx > 0:
                item["step"] = f"{row.get('step', '')} (cont.)"
            normalized.append(item)
    return normalized


def _estimate_detail_row_units(row: dict[str, str]) -> int:
    counts = [
        _wrap_line_count(str(row.get("step") or ""), _DETAIL_CELL_CHAR_BUDGET["step"]),
        _wrap_line_count(str(row.get("start_month") or ""), _DETAIL_CELL_CHAR_BUDGET["start_month"]),
        _wrap_line_count(str(row.get("end_month") or ""), _DETAIL_CELL_CHAR_BUDGET["end_month"]),
        _wrap_line_count(str(row.get("start_date") or ""), _DETAIL_CELL_CHAR_BUDGET["start_date"]),
        _wrap_line_count(str(row.get("end_date") or ""), _DETAIL_CELL_CHAR_BUDGET["end_date"]),
        _wrap_line_count(str(row.get("rate_psf_yr") or ""), _DETAIL_CELL_CHAR_BUDGET["rate_psf_yr"]),
        _wrap_line_count(str(row.get("opex_psf_yr") or ""), _DETAIL_CELL_CHAR_BUDGET["opex_psf_yr"]),
        _wrap_line_count(str(row.get("rsf") or ""), _DETAIL_CELL_CHAR_BUDGET["rsf"]),
        _wrap_line_count(str(row.get("note") or ""), _DETAIL_CELL_CHAR_BUDGET["note"]),
    ]
    # Base unit + wrapped lines in the tallest cell.
    return 1 + max(counts)


def _chunk_detail_rows(rows: list[dict[str, str]], max_units: int = 44) -> list[list[dict[str, str]]]:
    """
    Deterministic pagination for long segmented rent schedules.
    Chunks rows conservatively to avoid clipping and preserves all rows.
    """
    normalized = _normalize_detail_rows(rows)
    chunks: list[list[dict[str, str]]] = []
    current: list[dict[str, str]] = []
    units = 0
    for row in normalized:
        row_units = _estimate_detail_row_units(row)
        if current and units + row_units > max_units:
            chunks.append(current)
            current = []
            units = 0
        current.append(row)
        units += row_units
    if current:
        chunks.append(current)
    return chunks


def _detail_table_html(rows: list[dict[str, str]]) -> str:
    table_rows = "".join(
        f"""
        <tr>
          <td class="detail-step">{_esc(r['step'])}</td>
          <td>{_esc(r['start_month'])}</td>
          <td>{_esc(r['end_month'])}</td>
          <td>{_esc(r['start_date'])}</td>
          <td>{_esc(r['end_date'])}</td>
          <td>{_esc(r['rate_psf_yr'])}</td>
          <td>{_esc(r['opex_psf_yr'])}</td>
          <td>{_esc(r['rsf'])}</td>
          <td class="detail-note">{_esc(r['note'])}</td>
        </tr>
        """
        for r in rows
    )
    return f"""
    <table class="detail-table">
      <colgroup>
        <col style="width:7%" />
        <col style="width:8%" />
        <col style="width:8%" />
        <col style="width:11%" />
        <col style="width:11%" />
        <col style="width:11%" />
        <col style="width:10%" />
        <col style="width:9%" />
        <col style="width:25%" />
      </colgroup>
      <thead>
        <tr>
          <th>Step</th>
          <th>Start month</th>
          <th>End month</th>
          <th>Start date</th>
          <th>End date</th>
          <th>Base rent ($/SF/yr)</th>
          <th>OpEx ($/SF/yr)</th>
          <th>RSF</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {table_rows}
      </tbody>
    </table>
    """


def ScenarioDetailSections(entry: dict[str, Any]) -> list[str]:
    scenario = entry["scenario"]
    result = entry["result"]
    rows = _scenario_rent_rows(entry)
    chunks = _chunk_detail_rows(rows, max_units=44)
    if not chunks:
        chunks = [[]]
    kpis = [
        ("Document type", entry["doc_type"]),
        ("RSF", f"{_fmt_number(scenario.get('rsf'))} SF"),
        ("Term", f"{_fmt_number(result.get('term_months'))} months"),
        ("NPV cost", _fmt_currency(result.get("npv_cost"))),
        ("Avg cost/SF/year", _fmt_psf(result.get("avg_cost_psf_year"))),
        ("Total obligation", _fmt_currency(result.get("total_cost_nominal"))),
    ]
    out: list[str] = []
    total_chunks = len(chunks)
    for idx, chunk in enumerate(chunks):
        subtitle = (
            "Full segmented rent schedule with no clipped rows."
            if total_chunks == 1
            else f"Rent schedule continued — page {idx + 1} of {total_chunks}."
        )
        kpi_html = KpiTilesRow(kpis) if idx == 0 else ""
        continuation = (
            ""
            if idx == 0
            else f"<p class='table-footnote'>Rent schedule continued for {_esc(entry['name'])}.</p>"
        )
        out.append(
            f"""
            {SectionTitle("Scenario detail", entry["name"], subtitle)}
            {kpi_html}
            {_detail_table_html(chunk)}
            {continuation}
            """
        )
    return out


def _cover_option_reason(entry: dict[str, Any], *, is_best: bool) -> str:
    result = entry.get("result") if isinstance(entry.get("result"), dict) else {}
    scenario = entry.get("scenario") if isinstance(entry.get("scenario"), dict) else {}
    reason_bits: list[str] = []
    if is_best:
        reason_bits.append("Lowest NPV profile")
    avg_psf = _fmt_psf(result.get("avg_cost_psf_year"))
    if avg_psf != "—":
        reason_bits.append(f"{avg_psf} avg cost/SF/year")
    total = _fmt_currency(result.get("total_cost_nominal"))
    if total != "—":
        reason_bits.append(f"{total} total obligation")
    lease_type = str(scenario.get("opex_mode") or "").strip().upper()
    if lease_type:
        reason_bits.append(f"{lease_type} rent structure")
    return " · ".join(reason_bits[:3]) or "Financially competitive under current assumptions."


def CoverPage(entries: list[dict[str, Any]], theme: DeckTheme) -> str:
    ranking = sorted(entries, key=lambda e: _safe_float(e["result"].get("npv_cost"), 0.0))
    winner_name = ranking[0]["name"] if ranking else "N/A"
    winner_npv = _fmt_currency((ranking[0]["result"] if ranking else {}).get("npv_cost"))
    top_options = ranking[1 : min(3, len(ranking))]

    logo = (
        f'<img class="cover-logo" src="{_esc(theme.logo_src)}" alt="{_esc(theme.brand_name)}" />'
        if theme.logo_src
        else f'<div class="cover-brand-wordmark">{_esc(theme.brand_name)}</div>'
    )
    client_logo = (
        f'<img class="cover-client-logo" src="{_esc(theme.client_logo_src)}" alt="{_esc(theme.prepared_for)}" />'
        if theme.client_logo_src
        else ""
    )
    cover_media = (
        f'<div class="cover-photo" style="background-image:url(\'{_esc(theme.cover_photo)}\');"></div>'
        if theme.cover_photo
        else '<div class="cover-pattern"></div>'
    )
    # Cover meta card requirement: show only logo + person name in Prepared by.
    prepared_by_name = str(theme.prepared_by_name or "").strip() or "theCREmodel"
    prepared_by_html = _esc(prepared_by_name)
    prepared_by_logo = (
        f'<img class="prepared-by-logo" src="{_esc(theme.logo_src)}" alt="{_esc(theme.brand_name)}" />'
        if theme.logo_src
        else ""
    )
    prepared_by_block = (
        f'<div class="prepared-by-block">{prepared_by_logo}<strong>{prepared_by_html}</strong></div>'
        if prepared_by_logo
        else f"<strong>{prepared_by_html}</strong>"
    )

    top_options_html = "".join(
        f"""
        <div class="cover-option-strip">
          <div class="cover-option-rank">#{i + 2}</div>
          <div class="cover-option-name">{_esc(_truncate_text(entry["name"], 68))}</div>
          <div class="cover-option-metrics">{_esc(_fmt_currency(entry["result"].get("npv_cost")))} NPV · {_esc(_fmt_psf(entry["result"].get("avg_cost_psf_year")))}</div>
          <div class="cover-option-why">{_esc(_truncate_text(_cover_option_reason(entry, is_best=False), 94))}</div>
        </div>
        """
        for i, entry in enumerate(top_options)
    )

    cover_meta_cards: list[tuple[str, str]] = [
        ("Prepared for", f"<strong>{_esc(theme.prepared_for)}</strong>"),
        ("Prepared by", prepared_by_block),
        ("Report date", f"<strong>{_esc(theme.report_date)}</strong>"),
    ]
    if theme.market:
        cover_meta_cards.append(("Market", f"<strong>{_esc(theme.market)}</strong>"))
    if theme.submarket:
        cover_meta_cards.append(("Submarket", f"<strong>{_esc(theme.submarket)}</strong>"))
    cover_meta_cards.append(("Scenarios", f"<strong>{len(entries)}</strong>"))
    cover_meta_html = "".join(
        f"<div><span>{_esc(label)}</span>{value}</div>"
        for label, value in cover_meta_cards
    )

    return f"""
    <div class="cover-wrap">
      {cover_media}
      <div class="cover-content">
        <div class="cover-hero-strip">
          <p class="kicker">Investor Financial Analysis</p>
          <h1>Lease Economics Comparison Deck</h1>
          <p class="cover-subtitle">Institutional-grade multi-scenario comparison prepared for client decision-making.</p>
        </div>
        <div class="cover-brand-row">
          <div>{logo}</div>
          <div>{client_logo}</div>
        </div>
        <div class="cover-meta-grid">
          {cover_meta_html}
        </div>
        <div class="cover-winner-strip">
          <span>Best Financial Outcome by NPV</span>
          <strong>{_esc(winner_name)}</strong>
          <p>{_esc(winner_npv)} NPV cost</p>
        </div>
        {"<div class='cover-options-stack'>" + top_options_html + "</div>" if top_options_html else ""}
      </div>
    </div>
    """


def _metric_rows_for(entries: list[dict[str, Any]]) -> list[tuple[str, list[str], str]]:
    rows: list[tuple[str, list[str], str]] = []
    for metric_label in [
        "Document type",
        "Building name",
        "Suite / Floor",
        "Street address",
        "RSF",
        "Commencement",
        "Expiration",
        "Lease type",
        "Term (months)",
        "Rent (nominal)",
        "OpEx (nominal)",
        "Total obligation",
        "NPV cost",
        "Avg cost/year",
        "Avg cost/SF/year",
        "Discount rate",
    ]:
        values: list[str] = []
        style = "text"
        for e in entries:
            scenario = e["scenario"]
            result = e["result"]
            if metric_label == "Document type":
                values.append(str(e["doc_type"] or "Unknown").replace("_", " ").title())
            elif metric_label == "Building name":
                values.append(str(scenario.get("building_name") or "—"))
            elif metric_label == "Suite / Floor":
                values.append(str(scenario.get("suite") or scenario.get("floor") or "—"))
            elif metric_label == "Street address":
                values.append(str(scenario.get("address") or "—"))
            elif metric_label == "RSF":
                values.append(f"{_fmt_number(scenario.get('rsf'))} SF")
            elif metric_label == "Commencement":
                values.append(_fmt_date(scenario.get("commencement")))
            elif metric_label == "Expiration":
                values.append(_fmt_date(scenario.get("expiration")))
            elif metric_label == "Lease type":
                values.append(str(scenario.get("opex_mode") or "NNN").upper())
            elif metric_label == "Term (months)":
                values.append(f"{_fmt_number(result.get('term_months'))} months")
            elif metric_label == "Rent (nominal)":
                values.append(_fmt_currency(result.get("rent_nominal")))
            elif metric_label == "OpEx (nominal)":
                values.append(_fmt_currency(result.get("opex_nominal")))
            elif metric_label == "Total obligation":
                values.append(_fmt_currency(result.get("total_cost_nominal")))
            elif metric_label == "NPV cost":
                values.append(_fmt_currency(result.get("npv_cost")))
            elif metric_label == "Avg cost/year":
                values.append(_fmt_currency(result.get("avg_cost_year")))
            elif metric_label == "Avg cost/SF/year":
                values.append(_fmt_psf(result.get("avg_cost_psf_year")))
            elif metric_label == "Discount rate":
                values.append(_fmt_percent(scenario.get("discount_rate_annual"), precision=2))
        rows.append((metric_label, values, style))
    return rows


def _matrix_pages(entries: list[dict[str, Any]]) -> list[str]:
    def chunk(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
        if size <= 0:
            return [items]
        return [items[i : i + size] for i in range(0, len(items), size)]

    pages: list[str] = []
    # Keep up to 10 scenarios side-by-side per matrix page.
    option_chunks = chunk(entries, 10)
    for idx, option_chunk in enumerate(option_chunks):
        metric_rows = _metric_rows_for(option_chunk)
        max_units = 16 if len(option_chunk) >= 8 else 24
        metric_chunks = _chunk_rows_by_estimated_height(metric_rows, max_units=max_units)
        for midx, metrics_chunk in enumerate(metric_chunks):
            start = idx * 10 + 1
            end = idx * 10 + len(option_chunk)
            suffix = "" if len(metric_chunks) == 1 else f" · Table segment {midx + 1}/{len(metric_chunks)}"
            pages.append(
                f"""
                {SectionTitle(
                    "Portfolio comparison",
                    "Comparison Matrix",
                    f"Options {start}-{end} of {len(entries)}{suffix}",
                )}
                {ComparisonMatrixTable(option_chunk, metrics_chunk)}
                <p class="matrix-footnote">Table headers repeat across pages. Numeric units are normalized for side-by-side review.</p>
                """
            )
    return pages


def _estimate_note_units(text: str) -> int:
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        return 1
    return max(1, math.ceil(len(cleaned) / 120))


def _split_note_lines(lines: list[str], *, max_units: int = 20) -> list[list[str]]:
    chunks: list[list[str]] = []
    current: list[str] = []
    units = 0
    for line in lines:
        est = _estimate_note_units(line)
        if current and units + est > max_units:
            chunks.append(current)
            current = []
            units = 0
        current.append(line)
        units += est
    if current:
        chunks.append(current)
    return chunks or [[]]


def _notes_pages(entries: list[dict[str, Any]]) -> list[str]:
    if not entries:
        return []

    cards: list[dict[str, Any]] = []
    for entry in entries:
        scenario = entry["scenario"]
        raw_notes = str(scenario.get("notes") or "").strip()
        categorized = _notes_by_category(raw_notes)
        bullet_lines: list[str] = []
        for category, lines in categorized.items():
            for line in lines:
                cleaned = " ".join(str(line or "").split())
                if cleaned:
                    bullet_lines.append(f"{category}: {cleaned}")

        if not bullet_lines:
            bullet_lines = [
                "No clause notes were extracted. Review ROFR/ROFO, renewal rights, termination rights, and OpEx exclusions manually.",
            ]

        parts = _split_note_lines(bullet_lines, max_units=20)
        for idx, part in enumerate(parts, start=1):
            title = entry["name"] if idx == 1 else f'{entry["name"]} (cont. {idx})'
            est_units = 4 + sum(_estimate_note_units(line) for line in part)
            cards.append(
                {
                    "title": title,
                    "doc_type": str(entry.get("doc_type") or "Unknown"),
                    "lines": part,
                    "units": est_units,
                }
            )

    pages: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    units = 0
    max_units_per_page = 38
    for card in cards:
        card_units = _safe_int(card.get("units"), 6)
        if current and units + card_units > max_units_per_page:
            pages.append(current)
            current = []
            units = 0
        current.append(card)
        units += card_units
    if current:
        pages.append(current)

    rendered_pages: list[str] = []
    total_pages = len(pages)
    for page_idx, page_cards in enumerate(pages, start=1):
        card_html = []
        for card in page_cards:
            bullets_html = "".join(f"<li>{_esc(line)}</li>" for line in card["lines"])
            card_html.append(
                f"""
                <article class="notes-summary-card">
                  <h3>{_esc(card["title"])}</h3>
                  <p class="axis-note">Document type: {_esc(card["doc_type"])}</p>
                  <ul class="bullet-list notes-bullets">{bullets_html}</ul>
                </article>
                """
            )

        subtitle = (
            "All scenario notes are fully listed below with bullets."
            if page_idx == 1
            else f"Notes & Clause Highlights continued ({page_idx}/{total_pages})."
        )
        rendered_pages.append(
            f"""
            {SectionTitle("Notes", "Notes & Clause Highlights", subtitle)}
            <div class="notes-summary-grid">
              {''.join(card_html)}
            </div>
            """
        )

    return rendered_pages


def _cost_visuals_page(entries: list[dict[str, Any]]) -> str:
    def rows(metric_key: str, formatter) -> list[tuple[str, float, str]]:
        out = []
        for e in entries:
            value = _safe_float(e["result"].get(metric_key), 0.0)
            out.append((e["name"], value, formatter(value)))
        return out

    charts = [
        ChartBlock("Avg cost $/SF/year", rows("avg_cost_psf_year", lambda v: _fmt_psf(v))),
        ChartBlock("NPV cost", rows("npv_cost", lambda v: _fmt_currency(v))),
        ChartBlock("Avg cost/year", rows("avg_cost_year", lambda v: _fmt_currency(v))),
        ChartBlock("Total obligation", rows("total_cost_nominal", lambda v: _fmt_currency(v))),
    ]
    return f"""
    {SectionTitle("Cost visuals", "Scenario Cost Comparison", "Horizontal bars use a shared per-metric scale to support clean visual ranking.")}
    <div class="chart-grid">
      {''.join(charts)}
    </div>
    """


def _nice_axis_max(value: float, *, steps: int = 5) -> float:
    if value <= 0:
        return 1.0
    rough = value / max(1, steps)
    magnitude = 10 ** math.floor(math.log10(max(rough, 1e-9)))
    for factor in (1, 2, 5, 10):
        candidate = factor * magnitude
        if candidate >= rough:
            return candidate * steps
    return rough * steps


def _split_label_lines(label: str, max_chars: int = 28) -> list[str]:
    words = [w for w in str(label or "").split() if w]
    if not words:
        return ["Option"]
    lines: list[str] = []
    current = ""
    for w in words:
        next_text = f"{current} {w}".strip()
        if current and len(next_text) > max_chars:
            lines.append(current)
            current = w
            if len(lines) >= 2:
                break
        else:
            current = next_text
    if current and len(lines) < 2:
        lines.append(current)
    if not lines:
        lines = [_truncate_text(label, max_chars)]
    return lines


def ComboAverageCostsChart(entries: list[dict[str, Any]]) -> str:
    if not entries:
        return "<article class='chart-block'><h3>Average Costs</h3><p class='axis-note'>No scenarios available.</p></article>"
    values_year = [_safe_float(e["result"].get("avg_cost_year"), 0.0) for e in entries]
    values_psf = [_safe_float(e["result"].get("avg_cost_psf_year"), 0.0) for e in entries]
    max_year = _nice_axis_max(max(values_year) if values_year else 1.0, steps=5)
    max_psf = _nice_axis_max(max(values_psf) if values_psf else 1.0, steps=5)

    w, h = 1120, 390
    left, right, top, bottom = 92, 92, 54, 116
    plot_w = w - left - right
    plot_h = h - top - bottom
    count = max(1, len(entries))
    slot = plot_w / count
    bar_w = min(180, slot * 0.54)

    grid_lines: list[str] = []
    left_ticks: list[str] = []
    right_ticks: list[str] = []
    tick_count = 5
    for i in range(tick_count + 1):
        frac = i / tick_count
        y = top + plot_h - (frac * plot_h)
        yv_year = frac * max_year
        yv_psf = frac * max_psf
        grid_lines.append(
            f'<line x1="{left}" y1="{y:.2f}" x2="{w-right}" y2="{y:.2f}" stroke="#d4d4d8" stroke-width="1" />'
        )
        left_ticks.append(
            f'<text x="{left-12}" y="{y+4:.2f}" text-anchor="end" class="combo-axis">{_esc(_fmt_currency(yv_year))}</text>'
        )
        right_ticks.append(
            f'<text x="{w-right+12}" y="{y+4:.2f}" text-anchor="start" class="combo-axis">{_esc(_fmt_currency(yv_psf, 2))}</text>'
        )

    bars: list[str] = []
    line_points: list[str] = []
    line_labels: list[str] = []
    x_labels: list[str] = []
    for idx, entry in enumerate(entries):
        cx = left + (slot * idx) + (slot / 2)
        year_val = values_year[idx]
        psf_val = values_psf[idx]
        bar_h = (year_val / max_year) * plot_h if max_year > 0 else 0
        bar_x = cx - (bar_w / 2)
        bar_y = top + plot_h - bar_h
        bars.append(
            f'<rect x="{bar_x:.2f}" y="{bar_y:.2f}" width="{bar_w:.2f}" height="{bar_h:.2f}" fill="#111111" />'
        )
        bars.append(
            f'<text x="{cx:.2f}" y="{top + plot_h - 8:.2f}" text-anchor="middle" class="combo-bar-label">{_esc(_fmt_currency(year_val))}</text>'
        )
        py = top + plot_h - ((psf_val / max_psf) * plot_h if max_psf > 0 else 0)
        line_points.append(f"{cx:.2f},{py:.2f}")
        line_label_y = py - 10
        line_label_on_bar = line_label_y >= (bar_y + 2) and line_label_y <= (bar_y + bar_h - 2)
        line_label_class = "combo-line-label-onbar" if line_label_on_bar else "combo-line-label"
        line_labels.append(
            f'<circle cx="{cx:.2f}" cy="{py:.2f}" r="4" fill="#4b5563" />'
            f'<text x="{cx:.2f}" y="{line_label_y:.2f}" text-anchor="middle" class="{line_label_class}">{_esc(_fmt_currency(psf_val, 2))}</text>'
        )
        label_lines = _split_label_lines(entry["name"], max_chars=30)
        for lidx, line in enumerate(label_lines):
            x_labels.append(
                f'<text x="{cx:.2f}" y="{top + plot_h + 24 + (lidx * 14):.2f}" text-anchor="middle" class="combo-x-label">{_esc(line)}</text>'
            )

    polyline = (
        f'<polyline points="{" ".join(line_points)}" fill="none" stroke="#4b5563" stroke-width="4" />'
        if len(line_points) >= 2
        else ""
    )
    legend_width = 520
    legend_start_x = (w - legend_width) / 2
    legend = (
        f'<rect x="{legend_start_x + 0:.2f}" y="16" width="26" height="10" fill="#111111" />'
        f'<text x="{legend_start_x + 34:.2f}" y="25" class="combo-x-label" text-anchor="start" style="font-weight:700;">AVERAGE COST/YEAR</text>'
        f'<line x1="{legend_start_x + 272:.2f}" y1="21" x2="{legend_start_x + 298:.2f}" y2="21" stroke="#4b5563" stroke-width="4" />'
        f'<circle cx="{legend_start_x + 285:.2f}" cy="21" r="4" fill="#4b5563" />'
        f'<text x="{legend_start_x + 306:.2f}" y="25" class="combo-x-label" text-anchor="start" style="font-weight:700;">AVERAGE COST/SF/YEAR</text>'
    )

    return f"""
    <article class="chart-block combo-chart-block">
      <h3>Average Costs</h3>
      <p class="axis-note">Bars show average cost/year. Line shows average cost/SF/year.</p>
      <svg viewBox="0 0 {w} {h}" class="combo-chart" role="img" aria-label="Average costs by scenario">
        {legend}
        {''.join(grid_lines)}
        {''.join(left_ticks)}
        {''.join(right_ticks)}
        {''.join(bars)}
        {polyline}
        {''.join(line_labels)}
        {''.join(x_labels)}
      </svg>
    </article>
    """


def _average_costs_combo_page(entries: list[dict[str, Any]]) -> str:
    return f"""
    {SectionTitle("Cost visuals", "Average Costs", "Dual-axis view for average annual cost and average cost per SF/year.")}
    {ComboAverageCostsChart(entries)}
    """


def _cost_visuals_pages(entries: list[dict[str, Any]]) -> list[str]:
    if not entries:
        return [_cost_visuals_page(entries)]
    chunk_size = 5
    pages: list[str] = []
    for i in range(0, len(entries), chunk_size):
        subset = entries[i : i + chunk_size]
        pages.append(_average_costs_combo_page(subset))
        pages.append(
            _cost_visuals_page(subset).replace(
                "Horizontal bars use a shared per-metric scale to support clean visual ranking.",
                f"Options {i + 1}-{i + len(subset)} of {len(entries)}. Horizontal bars use a shared per-metric scale to support clean visual ranking.",
            )
        )
    return pages


def _executive_summary_page(entries: list[dict[str, Any]]) -> str:
    ranking = sorted(entries, key=lambda e: _safe_float(e["result"].get("npv_cost"), 0.0))
    ranking_display = ranking[:8]
    ranking_items = "".join(
        f"""
        <li>
          <strong>{_esc(e['name'])}</strong>
          <span>{_esc(_fmt_currency(e['result'].get('npv_cost')))} NPV</span>
          <span>{_esc(_fmt_psf(e['result'].get('avg_cost_psf_year')))} avg cost/SF/year</span>
        </li>
        """
        for e in ranking_display
    )
    omitted = max(0, len(ranking) - len(ranking_display))
    omitted_line = f"<p class='matrix-footnote'>+ {omitted} additional option(s) are ranked in the comparison matrix.</p>" if omitted else ""
    return f"""
    {SectionTitle("Executive summary", "Decision Snapshot", "Ranking is based on lowest NPV cost (tenant cost perspective).")}
    <div class="summary-grid">
      <article class="panel">
        <h3>Ranking by NPV</h3>
        <ol class="ranking-list">{ranking_items}</ol>
        {omitted_line}
      </article>
      <article class="panel">
        <h3>Key decision points</h3>
        <ul class="bullet-list">
          <li>Confirm legal option rights: renewal/extension, ROFR/ROFO, termination, assignment/sublease.</li>
          <li>Validate OpEx mechanics: exclusions, expense caps, and NNN vs. base-year interpretation.</li>
          <li>Reconcile free-rent and TI economics with occupancy timing and capital availability.</li>
          <li>Confirm parking terms and non-rent charges that may materially affect all-in occupancy costs.</li>
        </ul>
      </article>
    </div>
    """


def _lease_abstracts_page(entries: list[dict[str, Any]]) -> str:
    cards = "".join(LeaseAbstractBlock(entry) for entry in entries)
    return f"""
    {SectionTitle("Lease abstracts", "Lease Abstract Highlights", "Categorized clause notes and financial context per option.")}
    <div class="abstract-stack">{cards}</div>
    """


def _lease_abstract_pages(entries: list[dict[str, Any]]) -> list[str]:
    if not entries:
        return [_lease_abstracts_page(entries)]
    pages: list[str] = []
    per_page = 2
    for i in range(0, len(entries), per_page):
        subset = entries[i : i + per_page]
        cards = "".join(LeaseAbstractBlock(entry) for entry in subset)
        pages.append(
            f"""
            {SectionTitle("Lease abstracts", "Lease Abstract Highlights", f"Options {i + 1}-{i + len(subset)} of {len(entries)}. Categorized clause notes and financial context per option.")}
            <div class="abstract-stack">{cards}</div>
            """
        )
    return pages


def DisclaimerPage(theme: DeckTheme) -> str:
    return f"""
    {SectionTitle("Disclaimer", "Important Limitations", "Read before making legal or investment decisions.")}
    <article class="panel">
      <p>{_esc(theme.disclaimer_text)}</p>
      <p>
        This report is generated from structured assumptions and extracted document language. It is not legal,
        tax, accounting, or investment advice. Verify all figures, rights, and obligations against executed documents.
      </p>
      <p>
        Contact: {_esc(theme.prepared_by_name)}
        {f" · {_esc(theme.prepared_by_email)}" if theme.prepared_by_email else ""}
        {f" · {_esc(theme.prepared_by_phone)}" if theme.prepared_by_phone else ""}
      </p>
    </article>
    """


def _deck_css(primary_color: str) -> str:
    return f"""
    @page {{
      size: A4 landscape;
      margin: 8mm;
    }}
    * {{ box-sizing: border-box; }}
    html, body {{
      margin: 0;
      padding: 0;
      font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
      color: #111;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }}
    .pdf-page {{
      break-after: page;
      page-break-after: always;
      height: 190mm;
      max-height: 190mm;
      display: flex;
      flex-direction: column;
      border: 1px solid #111;
      background: #fff;
      overflow: hidden;
    }}
    .page-header {{
      height: 18mm;
      border-bottom: 1px solid #111;
      padding: 4mm 6mm;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4mm;
    }}
    .header-left {{ display: flex; align-items: center; }}
    .brand-logo {{ max-height: 10mm; max-width: 42mm; object-fit: contain; }}
    .brand-wordmark {{ font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }}
    .header-right {{ text-align: right; }}
    .header-report-title {{ font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }}
    .header-sub {{ font-size: 9px; color: #444; }}
    .page-content {{
      padding: 6mm;
      display: block;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }}
    .page-content::before {{
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(15, 23, 42, 0.055) 1px, transparent 1px) 0 0 / 18px 18px,
        linear-gradient(0deg, rgba(15, 23, 42, 0.05) 1px, transparent 1px) 0 0 / 18px 18px,
        linear-gradient(45deg, rgba(15, 23, 42, 0.022) 1px, transparent 1px) 0 0 / 18px 18px;
      pointer-events: none;
    }}
    .page-content-inner {{
      width: 100%;
      transform-origin: top left;
      position: relative;
      z-index: 1;
    }}
    .page-footer {{
      height: 12mm;
      border-top: 1px solid #111;
      padding: 3mm 6mm;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 3mm;
      font-size: 9px;
      color: #444;
    }}
    .kicker {{
      margin: 0 0 2mm 0;
      font-size: 9px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #444;
    }}
    .section-title-wrap {{ margin-bottom: 4mm; }}
    .section-title {{
      margin: 0;
      font-size: 24px;
      line-height: 1.08;
      letter-spacing: -0.01em;
      color: #111;
    }}
    .section-subtitle {{
      margin: 2mm 0 0 0;
      font-size: 11px;
      line-height: 1.45;
      color: #333;
    }}
    .summary-grid, .chart-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4mm;
    }}
    .chart-grid {{ grid-template-rows: auto auto; }}
    .panel, .chart-block, .abstract-card {{
      border: 1px solid #111;
      padding: 4mm;
      background: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
    }}
    .panel h3, .chart-block h3, .abstract-card h3 {{
      margin: 0 0 2mm 0;
      font-size: 14px;
      line-height: 1.2;
      letter-spacing: -0.01em;
      color: #111;
    }}
    .ranking-list, .bullet-list, .abstract-highlights {{
      margin: 0;
      padding-left: 5mm;
      font-size: 10px;
      line-height: 1.45;
      color: #1f1f1f;
    }}
    .ranking-list li {{ margin: 0 0 1.5mm 0; display: grid; gap: 0.5mm; }}
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 2mm;
      margin: 0 0 4mm 0;
    }}
    .kpi-tile {{
      border: 1px solid #111;
      padding: 2.5mm;
      min-height: 22mm;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
    }}
    .kpi-label {{
      margin: 0 0 1.5mm 0;
      font-size: 8px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #555;
    }}
    .kpi-value {{
      margin: 0;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      color: #111;
      word-break: break-word;
    }}
    .matrix-table, .detail-table {{
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid #111;
      font-size: 9px;
    }}
    .matrix-table {{
      margin-top: 1mm;
    }}
    .matrix-table.matrix-compact {{
      font-size: 7px;
    }}
    .matrix-table thead th, .detail-table thead th {{
      background: #f2f2f2;
      border: 1px solid #111;
      padding: 2mm 1.6mm;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 8px;
      text-align: left;
    }}
    .matrix-table tbody th, .matrix-table tbody td,
    .detail-table tbody td {{
      border: 1px solid #bcbcbc;
      padding: 1.6mm;
      vertical-align: top;
      line-height: 1.35;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: normal;
    }}
    .detail-table tbody tr {{
      break-inside: avoid;
      page-break-inside: avoid;
    }}
    .detail-step {{
      white-space: nowrap;
    }}
    .detail-note {{
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.42;
    }}
    .matrix-table.matrix-compact thead th {{
      padding: 1.1mm 0.9mm;
      font-size: 6.5px;
      letter-spacing: 0.04em;
      line-height: 1.2;
    }}
    .matrix-table.matrix-compact tbody th,
    .matrix-table.matrix-compact tbody td {{
      padding: 1mm 0.9mm;
      line-height: 1.2;
    }}
    .matrix-head-text,
    .matrix-row-label,
    .matrix-cell-text {{
      display: block;
      overflow-wrap: anywhere;
      hyphens: auto;
    }}
    .matrix-head-text {{
      white-space: normal;
      word-break: break-word;
      font-weight: 700;
    }}
    .matrix-row-label {{
      font-weight: 700;
    }}
    .matrix-table tbody tr:nth-child(even),
    .detail-table tbody tr:nth-child(even) {{
      background: #fbfbfb;
    }}
    .matrix-table thead {{ display: table-header-group; }}
    .matrix-footnote, .table-footnote {{
      margin: 2mm 0 0 0;
      font-size: 8px;
      color: #555;
    }}
    .bullet-mini {{
      margin: 0;
      padding-left: 4mm;
    }}
    .bullet-mini li {{
      margin: 0 0 1mm 0;
      line-height: 1.3;
    }}
    .matrix-table.matrix-compact .bullet-mini {{
      padding-left: 2.8mm;
    }}
    .matrix-table.matrix-compact .bullet-mini li {{
      margin: 0 0 0.5mm 0;
      line-height: 1.15;
    }}
    .axis-note {{
      margin: 0 0 2mm 0;
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
    }}
    .bar-row {{
      margin: 0 0 2.2mm 0;
    }}
    .bar-row-head {{
      display: flex;
      justify-content: space-between;
      gap: 3mm;
      margin-bottom: 1mm;
      font-size: 9px;
      color: #222;
    }}
    .bar-label {{
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}
    .bar-track {{
      border: 1px solid #111;
      height: 4mm;
      background: #f3f4f6;
    }}
    .bar-fill {{
      height: 100%;
      background: {primary_color};
    }}
    .combo-chart-block {{
      padding: 3.2mm;
    }}
    .combo-chart {{
      width: 100%;
      height: 92mm;
      border: 1px solid #111;
      background: #fafafa;
      display: block;
    }}
    .combo-axis {{
      font-size: 12px;
      fill: #555;
      font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    }}
    .combo-bar-label {{
      font-size: 13px;
      fill: #fff;
      font-weight: 700;
      font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    }}
    .combo-line-label {{
      font-size: 13px;
      fill: #4b5563;
      font-weight: 700;
      font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    }}
    .combo-line-label-onbar {{
      font-size: 13px;
      fill: #ffffff;
      font-weight: 700;
      font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
      paint-order: stroke;
      stroke: #111111;
      stroke-width: 1.1px;
      stroke-linejoin: round;
    }}
    .combo-x-label {{
      font-size: 12px;
      fill: #111;
      font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    }}
    .abstract-stack {{
      display: grid;
      grid-template-columns: 1fr;
      gap: 3mm;
    }}
    .notes-summary-grid {{
      display: grid;
      grid-template-columns: 1fr;
      gap: 2.4mm;
    }}
    .notes-summary-card {{
      border: 1px solid #111;
      background: #fff;
      padding: 2.6mm;
      break-inside: avoid;
      page-break-inside: avoid;
    }}
    .notes-summary-card h3 {{
      margin: 0 0 1.2mm 0;
      font-size: 12px;
      line-height: 1.2;
      letter-spacing: -0.01em;
      color: #111;
      overflow-wrap: anywhere;
    }}
    .notes-summary-card .notes-bullets {{
      font-size: 9px;
      line-height: 1.35;
      margin-top: 0.6mm;
      padding-left: 4mm;
    }}
    .notes-summary-card .notes-bullets li {{
      margin: 0 0 0.8mm 0;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal;
    }}
    .abstract-grid {{
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2mm;
      margin-top: 2mm;
    }}
    .abstract-category {{
      border: 1px solid #c8c8c8;
      padding: 2mm;
      background: #fcfcfc;
    }}
    .abstract-category h4 {{
      margin: 0 0 1mm 0;
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .abstract-category ul {{
      margin: 0;
      padding-left: 4mm;
      font-size: 9px;
      line-height: 1.35;
    }}
    .verification-note {{
      margin: 2mm 0 0 0;
      font-size: 8px;
      color: #555;
    }}
    .cover-wrap {{
      position: relative;
      height: 100%;
      min-height: 0;
      border: 1px solid #111;
      overflow: hidden;
      background: #fff;
      display: flex;
      flex-direction: column;
    }}
    .cover-pattern {{
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(0,0,0,0.055) 1px, transparent 1px) 0 0 / 18px 18px,
        linear-gradient(0deg, rgba(0,0,0,0.055) 1px, transparent 1px) 0 0 / 18px 18px,
        linear-gradient(45deg, rgba(0,0,0,0.022) 1px, transparent 1px) 0 0 / 18px 18px;
    }}
    .cover-photo {{
      position: absolute;
      inset: 0;
      background-position: center;
      background-size: cover;
      opacity: 0.18;
      filter: grayscale(100%);
    }}
    .cover-content {{
      position: relative;
      z-index: 2;
      padding: 6mm;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 2.2mm;
    }}
    .cover-hero-strip {{
      border: 1px solid #111;
      background: #111;
      color: #fff;
      padding: 3mm 3.5mm;
    }}
    .cover-hero-strip .kicker {{
      color: #cfcfcf;
      margin-bottom: 1.2mm;
    }}
    .cover-content h1 {{
      margin: 0;
      font-size: 27px;
      line-height: 1.04;
      letter-spacing: -0.015em;
      color: #fff;
    }}
    .cover-subtitle {{
      margin: 1.4mm 0 0 0;
      font-size: 10px;
      max-width: 182mm;
      color: #e8e8e8;
      line-height: 1.35;
    }}
    .cover-brand-row {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6mm;
    }}
    .cover-logo {{ max-height: 13mm; max-width: 54mm; object-fit: contain; }}
    .cover-brand-wordmark {{
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }}
    .cover-client-logo {{ max-height: 12mm; max-width: 54mm; object-fit: contain; }}
    .cover-meta-grid {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2mm;
    }}
    .cover-meta-grid > div {{
      border: 1px solid #111;
      padding: 1.8mm 2.2mm;
      min-height: 12mm;
      background: rgba(255,255,255,0.88);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
    }}
    .cover-meta-grid span {{
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #555;
      margin-bottom: 1mm;
    }}
    .cover-meta-grid strong {{
      font-size: 9px;
      line-height: 1.25;
      color: #111;
      word-break: break-word;
    }}
    .prepared-by-block {{
      display: flex;
      align-items: flex-start;
      gap: 2mm;
    }}
    .prepared-by-logo {{
      width: 12mm;
      max-height: 8mm;
      object-fit: contain;
      flex: 0 0 auto;
      margin-top: 0.2mm;
    }}
    .cover-winner-strip {{
      border: 1px solid #111;
      background: #111;
      color: #fff;
      padding: 2mm 2.6mm;
      display: grid;
      grid-template-columns: 1.4fr 1.7fr 1.1fr;
      align-items: center;
      gap: 2mm;
    }}
    .cover-winner-strip span {{
      font-size: 8px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      opacity: 0.9;
    }}
    .cover-winner-strip strong {{
      font-size: 12px;
      line-height: 1.2;
      text-align: center;
    }}
    .cover-winner-strip p {{
      margin: 0;
      font-size: 10px;
      opacity: 0.95;
      text-align: right;
      white-space: nowrap;
    }}
    .cover-options-stack {{
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.5mm;
    }}
    .cover-option-strip {{
      border: 1px solid #111;
      background: rgba(255,255,255,0.94);
      padding: 1.6mm 2mm;
      display: grid;
      grid-template-columns: 8mm 1.55fr 1fr 1.7fr;
      gap: 2mm;
      align-items: center;
      min-height: 12mm;
    }}
    .cover-option-rank {{
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .cover-option-name {{
      font-size: 9px;
      font-weight: 700;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }}
    .cover-option-metrics {{
      font-size: 8.5px;
      line-height: 1.2;
      color: #222;
      white-space: nowrap;
    }}
    .cover-option-why {{
      font-size: 8.2px;
      line-height: 1.2;
      color: #333;
      overflow-wrap: anywhere;
    }}
    @media print {{
      .pdf-page:last-child {{ break-after: auto; page-break-after: auto; }}
    }}
    """


def build_report_deck_html(data: dict[str, Any]) -> str:
    entries = _extract_entries(data)
    if not entries:
        return "<!doctype html><html><body><h1>No scenarios found</h1></body></html>"
    branding = data.get("branding") if isinstance(data.get("branding"), dict) else {}
    theme = resolve_theme(branding if isinstance(branding, dict) else {})

    page_payloads: list[tuple[str, str, bool]] = []
    page_payloads.append((CoverPage(entries, theme), "Cover", False))
    page_payloads.append((_executive_summary_page(entries), "Executive summary", True))
    for matrix_html in _matrix_pages(entries):
        page_payloads.append((matrix_html, "Comparison matrix", True))
    for notes_html in _notes_pages(entries):
        page_payloads.append((notes_html, "Notes & clause highlights", True))
    for visuals_html in _cost_visuals_pages(entries):
        page_payloads.append((visuals_html, "Cost visuals", True))
    for abstracts_html in _lease_abstract_pages(entries):
        page_payloads.append((abstracts_html, "Lease abstract highlights", True))
    for entry in entries:
        for detail_html in ScenarioDetailSections(entry):
            page_payloads.append((detail_html, "Scenario detail", True))
    page_payloads.append((DisclaimerPage(theme), "Disclaimer", True))

    total_pages = len(page_payloads)
    page_html = []
    for i, (body_html, section_label, include_frame) in enumerate(page_payloads, start=1):
        page_html.append(
            _build_page_shell(
                body_html=body_html,
                theme=theme,
                page_no=i,
                total_pages=total_pages,
                section_label=section_label,
                include_frame=include_frame,
            )
        )

    return f"""
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_esc(theme.report_title)}</title>
  <style>{_deck_css(theme.primary_color)}</style>
</head>
<body>
  {''.join(page_html)}
  <script>
    (function () {{
      try {{
        const pages = Array.from(document.querySelectorAll(".pdf-page"));
        for (const page of pages) {{
          const content = page.querySelector(".page-content");
          const inner = page.querySelector(".page-content-inner");
          if (!content || !inner) continue;
          const rawHeight = inner.scrollHeight || 0;
          const limitHeight = content.clientHeight || 0;
          if (!rawHeight || !limitHeight) continue;
          if (rawHeight <= limitHeight) continue;
          const targetScale = Math.max(0.58, Math.min(1, (limitHeight - 1) / rawHeight));
          if (targetScale < 0.999) {{
            inner.style.transform = `scale(${{targetScale}})`;
            inner.style.width = `${{(100 / targetScale).toFixed(4)}}%`;
          }}
        }}
      }} catch (_err) {{
        // no-op; static layout still renders
      }} finally {{
        window.__deckLayoutReady = true;
      }}
    }})();
  </script>
</body>
</html>
    """.strip()


def render_report_deck_pdf(data: dict[str, Any]) -> bytes:
    html_str = build_report_deck_html(data)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html_str, wait_until="networkidle")
        try:
            page.wait_for_function("window.__deckLayoutReady === true", timeout=2500)
        except Exception:
            # Layout guard is best-effort; continue with static output if script timing fails.
            pass
        page.emulate_media(media="print")
        pdf_bytes = page.pdf(
            format="A4",
            landscape=True,
            print_background=True,
            prefer_css_page_size=True,
            margin={"top": "0in", "bottom": "0in", "left": "0in", "right": "0in"},
        )
        browser.close()
    return pdf_bytes
