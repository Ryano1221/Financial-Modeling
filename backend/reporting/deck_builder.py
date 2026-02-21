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
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, TypeVar


DEFAULT_MONOCHROME = "#111111"
DEFAULT_REPORT_TITLE = "Lease Economics Comparison Deck"
DEFAULT_CONFIDENTIALITY = "Confidential"
MAX_LOGO_BYTES = 1_500_000
MIN_FONT_SCALE = 0.95

A4_PORTRAIT_MM = (210.0, 297.0)
A4_LANDSCAPE_MM = (297.0, 210.0)
PAGE_MARGIN_MM = 8.0
HEADER_HEIGHT_MM = 18.0
FOOTER_HEIGHT_MM = 12.0
CONTENT_PADDING_MM = 6.0


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


@dataclass
class DeckPage:
    body_html: str
    section_label: str
    include_frame: bool
    kind: str
    orientation: str = "portrait"


@dataclass
class DeckRenderPlan:
    font_scale: float = 1.0
    orientation_overrides: dict[str, str] = field(default_factory=dict)
    matrix_safety: int = 0
    notes_safety: int = 0
    monthly_safety: int = 0
    annual_safety: int = 0

    def orientation_for(self, kind: str, default: str) -> str:
        return self.orientation_overrides.get(kind, default)


def _safe_float(value: Any, default: float = 0.0) -> float:
    parsed = _numeric_or_none(value)
    if parsed is None:
        return default
    return parsed


def _is_landscape(orientation: str) -> bool:
    return str(orientation or "").strip().lower() == "landscape"


def _page_size_mm(orientation: str) -> tuple[float, float]:
    return A4_LANDSCAPE_MM if _is_landscape(orientation) else A4_PORTRAIT_MM


def _printable_area_mm(orientation: str) -> tuple[float, float]:
    w, h = _page_size_mm(orientation)
    return (w - (2.0 * PAGE_MARGIN_MM), h - (2.0 * PAGE_MARGIN_MM))


def _content_inner_height_mm(orientation: str) -> float:
    _, printable_h = _printable_area_mm(orientation)
    return max(
        40.0,
        printable_h - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM - (2.0 * CONTENT_PADDING_MM),
    )


def _content_inner_width_mm(orientation: str) -> float:
    printable_w, _ = _printable_area_mm(orientation)
    return max(80.0, printable_w - (2.0 * CONTENT_PADDING_MM))


def _auto_orientation_for_columns(total_column_mm: float) -> str:
    portrait_width = _content_inner_width_mm("portrait")
    return "landscape" if total_column_mm > portrait_width else "portrait"


def _rows_per_page_from_printable(
    orientation: str,
    *,
    header_mm: float,
    row_mm: float,
    safety_rows: int = 0,
) -> int:
    usable = _content_inner_height_mm(orientation) - max(0.0, header_mm)
    base = max(1, math.floor(usable / max(1.0, row_mm)))
    return max(1, base - max(0, safety_rows))


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
    kind: str = "general",
    orientation: str = "portrait",
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
    orientation_cls = "landscape" if _is_landscape(orientation) else "portrait"
    return f"""
    <section class="pdf-page {orientation_cls}" data-kind="{_esc(kind)}" data-orientation="{orientation_cls}">
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
        est = max(1, math.ceil(max([len(label), *(len(v) for v in values)]) / 46))
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
        f"<th><span class='matrix-head-text'>{_esc(e['name'])}</span></th>"
        for e in entries
    )

    body_parts: list[str] = []
    for label, values, style in metric_rows:
        tds = []
        for value in values:
            if style == "bullets":
                bullets = [v.strip() for v in value.split(" | ") if v.strip()]
                cell = "<ul class='bullet-mini'>" + "".join(f"<li>{_esc(b)}</li>" for b in bullets) + "</ul>"
            else:
                cell = f"<span class='matrix-cell-text'>{_esc(value)}</span>"
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


def _term_months_from_dates(commencement: date | None, expiration: date | None, fallback: int = 0) -> int:
    if not commencement or not expiration:
        return max(0, fallback)
    months = (expiration.year - commencement.year) * 12 + (expiration.month - commencement.month)
    if expiration.day < commencement.day:
        months -= 1
    if commencement.day == 1:
        month_end = (date(expiration.year, expiration.month, 1) + timedelta(days=31)).replace(day=1) - timedelta(days=1)
        if expiration.day == month_end.day:
            months += 1
    return max(months, fallback)


def _monthly_step_for_index(step_rows: list[dict[str, Any]], month_index: int) -> dict[str, Any] | None:
    for step in step_rows:
        if step["start"] <= month_index <= step["end"]:
            return step
    return None


def _scenario_monthly_cashflow_rows(entry: dict[str, Any]) -> list[dict[str, Any]]:
    scenario = entry["scenario"]
    result = entry["result"]
    steps = _extract_rent_steps(scenario)
    if not steps:
        return []
    month_base = _month_index_base(steps)
    commencement = _parse_date(scenario.get("commencement"))
    expiration = _parse_date(scenario.get("expiration"))
    term_months = _safe_int(result.get("term_months"), 0)
    term_months = _term_months_from_dates(commencement, expiration, fallback=term_months)
    if term_months <= 0:
        term_months = max(1, max(step["end"] for step in steps) - min(step["start"] for step in steps) + 1)

    phase_steps = _extract_phase_steps(scenario)
    free_range = _free_rent_range(scenario, month_base)
    free_type = str(scenario.get("free_rent_abatement_type") or "base").strip().lower()
    base_opex = _safe_float(scenario.get("base_opex_psf_yr"), 0.0)
    opex_growth = _safe_float(scenario.get("opex_growth"), 0.0)
    parking_spaces = max(0, _safe_int(scenario.get("parking_spaces"), 0))
    parking_per_spot = max(0.0, _safe_float(scenario.get("parking_cost_monthly_per_space"), 0.0))
    parking_tax_rate = max(0.0, _safe_float(scenario.get("parking_sales_tax_rate"), 0.0825))
    sublease_income = max(0.0, _safe_float(scenario.get("sublease_income_monthly"), 0.0))
    sublease_start = max(0, _safe_int(scenario.get("sublease_start_month"), 0))
    sublease_duration = max(0, _safe_int(scenario.get("sublease_duration_months"), 0))
    discount_rate_annual = max(0.0, _safe_float(scenario.get("discount_rate_annual"), 0.08))
    monthly_discount = (1.0 + discount_rate_annual) ** (1.0 / 12.0) - 1.0 if discount_rate_annual > 0 else 0.0

    rows: list[dict[str, Any]] = []
    cumulative_pv = 0.0
    for month_zero in range(term_months):
        month_index = month_zero if month_base == 0 else month_zero + 1
        step = _monthly_step_for_index(steps, month_index)
        if step is None:
            continue
        rsf = _rsf_for_month(month_index, scenario, phase_steps)
        rate_psf_yr = _safe_float(step.get("rate"), 0.0)
        base_rent = (rate_psf_yr * rsf) / 12.0

        month_start = _add_months(commencement, month_zero) if commencement else None
        month_end = (_add_months(month_start, 1) - timedelta(days=1)) if month_start else None
        year_diff = max(0, (month_start.year - commencement.year) if month_start and commencement else 0)
        opex_psf_yr = base_opex * ((1.0 + max(0.0, opex_growth)) ** year_diff)
        opex = (opex_psf_yr * rsf) / 12.0

        parking_pre_tax = parking_spaces * parking_per_spot
        parking_after_tax = parking_pre_tax * (1.0 + parking_tax_rate)
        other = 0.0
        if sublease_duration > 0:
            sublease_month = month_index
            sublease_end = sublease_start + sublease_duration - 1
            if sublease_start <= sublease_month <= sublease_end:
                other -= sublease_income

        if free_range is not None:
            free_start, free_end = free_range
            in_free = free_start <= month_index <= free_end
            if in_free:
                base_rent = 0.0
                if free_type == "gross":
                    opex = 0.0
                    parking_after_tax = 0.0

        gross = base_rent + opex + parking_after_tax + other
        discount_factor = (1.0 / ((1.0 + monthly_discount) ** (month_zero + 1))) if monthly_discount > 0 else 1.0
        present_value = gross * discount_factor
        cumulative_pv += present_value
        rows.append(
            {
                "lease_year": (month_zero // 12) + 1,
                "month_start": month_start,
                "month_end": month_end,
                "base_rent": base_rent,
                "opex": opex,
                "parking": parking_after_tax,
                "other": other,
                "gross": gross,
                "discount_factor": discount_factor,
                "present_value": present_value,
                "cumulative_pv": cumulative_pv,
            }
        )
    return rows


def _annualized_rows(monthly_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_year: dict[int, dict[str, float]] = {}
    for row in monthly_rows:
        year = _safe_int(row.get("lease_year"), 1)
        agg = by_year.setdefault(year, {"base_rent": 0.0, "opex": 0.0, "gross": 0.0, "months": 0.0})
        agg["base_rent"] += _safe_float(row.get("base_rent"), 0.0)
        agg["opex"] += _safe_float(row.get("opex"), 0.0)
        agg["gross"] += _safe_float(row.get("gross"), 0.0)
        agg["months"] += 1.0
    out: list[dict[str, Any]] = []
    for year in sorted(by_year):
        agg = by_year[year]
        months = max(1.0, agg["months"])
        out.append(
            {
                "lease_year": year,
                "base_rent": agg["base_rent"],
                "opex": agg["opex"],
                "gross_rent": agg["gross"],
                "annual_total": agg["gross"],
                "monthly_equivalent": agg["gross"] / months,
            }
        )
    return out


def _annualized_matrix_html(rows: list[dict[str, Any]]) -> str:
    table_rows = "".join(
        f"""
        <tr>
          <td>{_esc(_fmt_number(r.get("lease_year"), 0))}</td>
          <td>{_esc(_fmt_currency(r.get("base_rent")))}</td>
          <td>{_esc(_fmt_currency(r.get("opex")))}</td>
          <td>{_esc(_fmt_currency(r.get("gross_rent")))}</td>
          <td>{_esc(_fmt_currency(r.get("annual_total")))}</td>
          <td>{_esc(_fmt_currency(r.get("monthly_equivalent")))}</td>
        </tr>
        """
        for r in rows
    )
    return f"""
    <table class="detail-table annualized-table">
      <colgroup>
        <col style="width:12%" />
        <col style="width:17%" />
        <col style="width:17%" />
        <col style="width:18%" />
        <col style="width:18%" />
        <col style="width:18%" />
      </colgroup>
      <thead>
        <tr>
          <th>Lease year</th>
          <th>Base rent</th>
          <th>OpEx</th>
          <th>Gross rent</th>
          <th>Annual total</th>
          <th>Monthly equivalent</th>
        </tr>
      </thead>
      <tbody>{table_rows}</tbody>
    </table>
    """


def _monthly_appendix_table_html(rows: list[dict[str, Any]]) -> str:
    table_rows = "".join(
        f"""
        <tr>
          <td>{_esc(_fmt_date(r.get("month_start")))}</td>
          <td>{_esc(_fmt_date(r.get("month_end")))}</td>
          <td>{_esc(_fmt_currency(r.get("base_rent")))}</td>
          <td>{_esc(_fmt_currency(r.get("opex")))}</td>
          <td>{_esc(_fmt_currency(r.get("parking")))}</td>
          <td>{_esc(_fmt_currency(r.get("other")))}</td>
          <td>{_esc(_fmt_currency(r.get("gross")))}</td>
          <td>{_esc(_fmt_number(r.get("discount_factor"), 6))}</td>
          <td>{_esc(_fmt_currency(r.get("present_value")))}</td>
          <td>{_esc(_fmt_currency(r.get("cumulative_pv")))}</td>
        </tr>
        """
        for r in rows
    )
    return f"""
    <table class="detail-table monthly-table">
      <colgroup>
        <col style="width:10%" />
        <col style="width:10%" />
        <col style="width:10%" />
        <col style="width:10%" />
        <col style="width:10%" />
        <col style="width:9%" />
        <col style="width:10%" />
        <col style="width:8%" />
        <col style="width:11%" />
        <col style="width:12%" />
      </colgroup>
      <thead>
        <tr>
          <th>Month start</th>
          <th>Month end</th>
          <th>Base rent</th>
          <th>OpEx</th>
          <th>Parking</th>
          <th>Other</th>
          <th>Gross rent</th>
          <th>Disc. factor</th>
          <th>Present value</th>
          <th>Cumulative PV</th>
        </tr>
      </thead>
      <tbody>{table_rows}</tbody>
    </table>
    """


def _scenario_pre_commencement_amount(entry: dict[str, Any]) -> float:
    """
    Month 0 cash outflow using existing model concepts for upfront costs.
    Includes broker fee, security deposit outflow, month-0 one-time costs,
    and month-0 expected termination fee if present.
    """
    scenario = entry.get("scenario") if isinstance(entry.get("scenario"), dict) else {}
    result = entry.get("result") if isinstance(entry.get("result"), dict) else {}

    broker_fee = max(0.0, _safe_float(result.get("broker_fee_nominal"), _safe_float(scenario.get("broker_fee"), 0.0)))
    deposit = max(0.0, _safe_float(result.get("deposit_nominal"), 0.0))
    one_time_month0 = 0.0
    one_time_costs = scenario.get("one_time_costs")
    if isinstance(one_time_costs, list):
        for item in one_time_costs:
            if not isinstance(item, dict):
                continue
            month = _safe_int(item.get("month"), 0)
            if month <= 0:
                one_time_month0 += max(0.0, _safe_float(item.get("amount"), 0.0))

    termination_month0 = 0.0
    termination = scenario.get("termination_option")
    if isinstance(termination, dict) and _safe_int(termination.get("month"), -1) == 0:
        termination_month0 = max(0.0, _safe_float(termination.get("fee"), 0.0)) * max(
            0.0, min(1.0, _safe_float(termination.get("probability"), 0.0))
        )

    return broker_fee + deposit + one_time_month0 + termination_month0


def _scenario_monthly_window(entry: dict[str, Any]) -> dict[str, Any]:
    monthly_rows = _scenario_monthly_cashflow_rows(entry)
    by_month_start: dict[date, float] = {}
    for row in monthly_rows:
        m_start = _parse_date(row.get("month_start"))
        if m_start is None:
            continue
        key = date(m_start.year, m_start.month, 1)
        by_month_start[key] = _safe_float(row.get("gross"), 0.0)

    scenario = entry["scenario"]
    commencement = _parse_date(scenario.get("commencement"))
    expiration = _parse_date(scenario.get("expiration"))
    start_month = date(commencement.year, commencement.month, 1) if commencement else None
    end_month = date(expiration.year, expiration.month, 1) if expiration else None
    if by_month_start:
        start_month = start_month or min(by_month_start)
        end_month = end_month or max(by_month_start)

    return {
        "start_month": start_month,
        "end_month": end_month,
        "gross_by_month": by_month_start,
        "month0_value": _scenario_pre_commencement_amount(entry),
    }


def _consolidated_monthly_gross_rows(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    windows = [_scenario_monthly_window(entry) for entry in entries]
    starts = [w["start_month"] for w in windows if isinstance(w.get("start_month"), date)]
    ends = [w["end_month"] for w in windows if isinstance(w.get("end_month"), date)]
    if not starts or not ends:
        return []

    overall_start = min(starts)
    overall_end = max(ends)
    month_starts: list[date] = []
    cursor = overall_start
    while cursor <= overall_end:
        month_starts.append(cursor)
        cursor = _add_months(cursor, 1)

    rows: list[dict[str, Any]] = [
        {
            "month_no": "0",
            "date_text": "Pre Commencement",
            "values": [_fmt_currency(w.get("month0_value"), precision=0) for w in windows],
        }
    ]

    for idx, month_start in enumerate(month_starts, start=1):
        values: list[str] = []
        for window in windows:
            start_month = window.get("start_month")
            end_month = window.get("end_month")
            gross_map = window.get("gross_by_month") if isinstance(window.get("gross_by_month"), dict) else {}
            if isinstance(start_month, date) and month_start < start_month:
                values.append("—")
                continue
            if isinstance(end_month, date) and month_start > end_month:
                values.append("—")
                continue
            if month_start in gross_map:
                values.append(_fmt_currency(gross_map.get(month_start), precision=0))
            else:
                values.append(_fmt_currency(0.0, precision=0))
        rows.append(
            {
                "month_no": str(idx),
                "date_text": _fmt_date(month_start),
                "values": values,
            }
        )
    return rows


def _monthly_gross_matrix_table(entries: list[dict[str, Any]], rows: list[dict[str, Any]]) -> str:
    scenario_count = max(1, len(entries))
    month_col = 7.5
    date_col = 12.5
    scenario_col = max(9.0, (100.0 - month_col - date_col) / scenario_count)
    colgroup = (
        f'<col style="width:{month_col:.2f}%"/>'
        f'<col style="width:{date_col:.2f}%"/>'
        + "".join(f'<col style="width:{scenario_col:.2f}%"/>' for _ in entries)
    )

    head_cells = "".join(
        f"<th><span class='matrix-head-text'>{_esc(e['name'])}</span></th>"
        for e in entries
    )
    body_rows = "".join(
        "<tr>"
        f"<th><span class='matrix-row-label'>{_esc(row['month_no'])}</span></th>"
        f"<td><span class='matrix-cell-text'>{_esc(row['date_text'])}</span></td>"
        + "".join(f"<td><span class='matrix-cell-text'>{_esc(v)}</span></td>" for v in row["values"])
        + "</tr>"
        for row in rows
    )

    return f"""
    <table class="matrix-table monthly-gross-table">
      <colgroup>{colgroup}</colgroup>
      <thead>
        <tr>
          <th>Month #</th>
          <th>Date</th>
          {head_cells}
        </tr>
      </thead>
      <tbody>{body_rows}</tbody>
    </table>
    """


TChunk = TypeVar("TChunk")


def _chunk_list(items: list[TChunk], size: int) -> list[list[TChunk]]:
    if size <= 0:
        return [items]
    return [items[i : i + size] for i in range(0, len(items), size)]


def _monthly_gross_panel_size(orientation: str, font_scale: float) -> int:
    """
    Determine how many scenario columns can safely fit for the consolidated
    monthly matrix. If too wide, we split into panels (e.g. scenarios 1-3).
    """
    width = _content_inner_width_mm(orientation)
    fixed_cols_mm = 34.0
    scenario_col_mm = max(18.0, 26.0 * max(MIN_FONT_SCALE, min(1.0, font_scale)))
    capacity = int((width - fixed_cols_mm) // scenario_col_mm)
    return max(1, min(10, capacity))


def _monthly_gross_pages(entries: list[dict[str, Any]], plan: DeckRenderPlan) -> list[DeckPage]:
    if not entries:
        return []
    all_rows = _consolidated_monthly_gross_rows(entries)
    if not all_rows:
        return []

    estimated_width_mm = 34.0 + (len(entries) * 26.0)
    default_orientation = _auto_orientation_for_columns(estimated_width_mm)
    orientation = plan.orientation_for("monthly_gross_matrix", default_orientation)
    panel_size = _monthly_gross_panel_size(orientation, plan.font_scale)
    entry_panels = _chunk_list(entries, panel_size)

    row_mm = 6.2 * plan.font_scale
    rows_per_page = _rows_per_page_from_printable(
        orientation,
        header_mm=38.0,
        row_mm=row_mm,
        safety_rows=plan.monthly_safety + 1,
    )
    rows_per_page = max(2, rows_per_page)

    pages: list[DeckPage] = []
    total_panels = len(entry_panels)
    for panel_idx, panel_entries in enumerate(entry_panels, start=1):
        panel_offset = (panel_idx - 1) * panel_size
        row_chunks = _chunk_list(all_rows, rows_per_page)
        total_chunks = len(row_chunks)
        panel_start = panel_offset + 1
        panel_end = panel_start + len(panel_entries) - 1
        for chunk_idx, row_chunk in enumerate(row_chunks, start=1):
            panel_rows = [
                {
                    "month_no": row["month_no"],
                    "date_text": row["date_text"],
                    "values": row["values"][panel_offset : panel_offset + len(panel_entries)],
                }
                for row in row_chunk
            ]
            subtitle = (
                "Month 0 reflects pre-commencement outflows. Timeline spans earliest commencement to latest expiration."
                if chunk_idx == 1 and panel_idx == 1
                else (
                    "Monthly Gross Cash Flows (All Scenarios) continued"
                    f" · Panel {panel_idx}/{total_panels} (Options {panel_start}-{panel_end})"
                    f" · Page {chunk_idx}/{total_chunks}"
                )
            )
            body_html = f"""
                {SectionTitle("Cash flows", "Monthly Gross Cash Flows (All Scenarios)", subtitle)}
                {_monthly_gross_matrix_table(panel_entries, panel_rows)}
                """
            pages.append(
                DeckPage(
                    body_html=body_html,
                    section_label="Monthly gross cash flows",
                    include_frame=True,
                    kind="monthly_gross_matrix",
                    orientation=orientation,
                )
            )
    return pages


def _scenario_monthly_appendix_pages(entry: dict[str, Any], plan: DeckRenderPlan) -> list[DeckPage]:
    monthly_rows = _scenario_monthly_cashflow_rows(entry)
    if not monthly_rows:
        return []

    appendix_orientation_default = _auto_orientation_for_columns(236.0)
    appendix_orientation = plan.orientation_for("monthly_cashflow_appendix", appendix_orientation_default)
    rows_per_page = _rows_per_page_from_printable(
        appendix_orientation,
        header_mm=30.0,
        row_mm=6.0 * plan.font_scale,
        safety_rows=plan.monthly_safety + 1,
    )
    chunks = _chunk_list(monthly_rows, rows_per_page)
    total_chunks = len(chunks)
    pages: list[DeckPage] = []
    for idx, chunk in enumerate(chunks, start=1):
        subtitle = (
            "Detailed monthly line-item cash flows."
            if idx == 1
            else f"Scenario detail (continued) · page {idx} of {total_chunks}"
        )
        pages.append(
            DeckPage(
                body_html=f"""
                {SectionTitle("Appendix", f"Appendix — Monthly Cash Flows ({entry['name']})", subtitle)}
                {_monthly_appendix_table_html(chunk)}
                """,
                section_label="Appendix — monthly cash flows",
                include_frame=True,
                kind="monthly_cashflow_appendix",
                orientation=appendix_orientation,
            )
        )
    return pages


def ScenarioDetailSections(entry: dict[str, Any], plan: DeckRenderPlan) -> list[DeckPage]:
    scenario = entry["scenario"]
    result = entry["result"]
    monthly_rows = _scenario_monthly_cashflow_rows(entry)
    annual_rows = _annualized_rows(monthly_rows)

    summary_kpis = [
        ("Counterparty", str(scenario.get("name") or entry["name"])),
        ("Commencement", _fmt_date(scenario.get("commencement"))),
        ("Expiration", _fmt_date(scenario.get("expiration"))),
        ("RSF", f"{_fmt_number(scenario.get('rsf'))} SF"),
        ("Lease type", str(scenario.get("opex_mode") or "NNN").upper()),
        ("Discount rate", _fmt_percent(scenario.get("discount_rate_annual"), precision=2)),
        ("Avg gross rent/SF", _fmt_psf(result.get("equalized_avg_gross_rent_psf_year") or result.get("avg_cost_psf_year"))),
        ("Avg cost/SF", _fmt_psf(result.get("avg_cost_psf_year"))),
        ("Avg monthly cost", _fmt_currency(result.get("avg_cost_year", 0) / 12.0)),
        ("NPV", _fmt_currency(result.get("npv_cost"))),
        ("Total obligation", _fmt_currency(result.get("total_cost_nominal"))),
        ("Document type", str(entry.get("doc_type") or "Unknown").replace("_", " ").title()),
    ]
    eq_period_text = (
        f"{_fmt_date(result.get('equalized_start'))} – {_fmt_date(result.get('equalized_end'))}"
        if result.get("equalized_start") and result.get("equalized_end")
        else "No overlapping lease term for equalized comparison"
    )
    equalized_panel = f"""
      <article class="panel institutional-panel">
        <h3>Equalized Comparison</h3>
        <p class="axis-note">Equalized period: {_esc(eq_period_text)}</p>
        <table class="detail-table annualized-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Equalized avg gross rent/SF/year</td><td>{_esc(_fmt_psf(result.get("equalized_avg_gross_rent_psf_year")))}</td></tr>
            <tr><td>Equalized avg monthly cost</td><td>{_esc(_fmt_currency(result.get("equalized_avg_cost_month")))}</td></tr>
            <tr><td>Equalized avg cost/SF/year</td><td>{_esc(_fmt_psf(result.get("equalized_avg_cost_psf_year")))}</td></tr>
            <tr><td>Equalized total cost</td><td>{_esc(_fmt_currency(result.get("equalized_total_cost")))}</td></tr>
            <tr><td>Equalized NPV (t0=start)</td><td>{_esc(_fmt_currency(result.get("equalized_npv_cost")))}</td></tr>
          </tbody>
        </table>
      </article>
    """

    summary_html = f"""
      {SectionTitle("Scenario detail", entry["name"], "Scenario summary and annualized rent matrix.")}
      {KpiTilesRow(summary_kpis)}
      <article class="panel institutional-panel">
        <h3>Annualized Rent Matrix</h3>
        {_annualized_matrix_html(annual_rows)}
      </article>
      {equalized_panel}
    """

    summary_orientation = plan.orientation_for("scenario_summary", "portrait")
    pages: list[DeckPage] = [
        DeckPage(
            body_html=summary_html,
            section_label="Scenario detail",
            include_frame=True,
            kind="scenario_summary",
            orientation=summary_orientation,
        )
    ]

    return pages


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
    winner = ranking[0] if ranking else None
    winner_name = winner["name"] if winner else "N/A"
    winner_npv = _fmt_currency((winner["result"] if winner else {}).get("npv_cost"))
    winner_metrics = (
        f"{_fmt_currency((winner or {}).get('result', {}).get('npv_cost'))} NPV · "
        f"{_fmt_psf((winner or {}).get('result', {}).get('avg_cost_psf_year'))}"
        if winner
        else "—"
    )
    winner_reason = _cover_option_reason(winner, is_best=True) if winner else "Financially competitive under current assumptions."
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
    prepared_for_block = (
        f'<div class="prepared-for-block"><img class="prepared-for-logo" src="{_esc(theme.client_logo_src)}" alt="{_esc(theme.prepared_for)}" /></div>'
        if client_logo
        else f"<strong>{_esc(theme.prepared_for)}</strong>"
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
        ("Prepared for", prepared_for_block),
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
        </div>
        <div class="cover-meta-grid">
          {cover_meta_html}
        </div>
        <div class="cover-winner-strip">
          <div class="cover-option-rank">#1</div>
          <div class="cover-option-name">
            <span class="winner-label">Best Financial Outcome by NPV</span>
            <strong>{_esc(_truncate_text(winner_name, 68))}</strong>
          </div>
          <div class="cover-option-metrics">{_esc(winner_metrics)}</div>
          <div class="cover-option-why">{_esc(_truncate_text(winner_reason, 120))}</div>
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

    equalized_no_overlap = any(bool(e["result"].get("equalized_no_overlap")) for e in entries)
    if equalized_no_overlap:
        rows.append(
            (
                "Equalized",
                ["No overlapping lease term for equalized comparison"] * len(entries),
                "text",
            )
        )
        return rows

    equalized_starts = [str(e["result"].get("equalized_start") or "").strip() for e in entries]
    equalized_ends = [str(e["result"].get("equalized_end") or "").strip() for e in entries]
    if any(equalized_starts) and any(equalized_ends):
        rows.append(
            (
                "Equalized period",
                [
                    f"{_fmt_date(e['result'].get('equalized_start'))} – {_fmt_date(e['result'].get('equalized_end'))}"
                    for e in entries
                ],
                "text",
            )
        )
        rows.append(
            (
                "Equalized avg gross rent/SF/year",
                [_fmt_psf(e["result"].get("equalized_avg_gross_rent_psf_year")) for e in entries],
                "text",
            )
        )
        rows.append(
            (
                "Equalized avg gross rent/month",
                [_fmt_currency(e["result"].get("equalized_avg_gross_rent_month")) for e in entries],
                "text",
            )
        )
        rows.append(
            (
                "Equalized avg cost/SF/year",
                [_fmt_psf(e["result"].get("equalized_avg_cost_psf_year")) for e in entries],
                "text",
            )
        )
        rows.append(
            (
                "Equalized avg cost/month",
                [_fmt_currency(e["result"].get("equalized_avg_cost_month")) for e in entries],
                "text",
            )
        )
        rows.append(
            (
                "Equalized total cost",
                [_fmt_currency(e["result"].get("equalized_total_cost")) for e in entries],
                "text",
            )
        )
        rows.append(
            (
                "Equalized NPV (t0=start)",
                [_fmt_currency(e["result"].get("equalized_npv_cost")) for e in entries],
                "text",
            )
        )
    return rows


def _matrix_pages(entries: list[dict[str, Any]], plan: DeckRenderPlan) -> list[DeckPage]:
    def chunk(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
        if size <= 0:
            return [items]
        return [items[i : i + size] for i in range(0, len(items), size)]

    pages: list[DeckPage] = []
    # Keep up to 10 scenarios side-by-side per matrix page.
    option_chunks = chunk(entries, 10)
    for idx, option_chunk in enumerate(option_chunks):
        metric_rows = _metric_rows_for(option_chunk)
        estimated_table_width_mm = 56.0 + (len(option_chunk) * 42.0)
        default_orientation = _auto_orientation_for_columns(estimated_table_width_mm)
        orientation = plan.orientation_for("comparison_matrix", default_orientation)
        # Row budgets are derived from printable height so tables always split before clipping.
        row_mm = 7.2 * plan.font_scale
        max_units = _rows_per_page_from_printable(
            orientation,
            header_mm=37.0,
            row_mm=row_mm,
            safety_rows=plan.matrix_safety + (1 if len(option_chunk) >= 8 else 0),
        )
        metric_chunks = _chunk_rows_by_estimated_height(metric_rows, max_units=max_units)
        for midx, metrics_chunk in enumerate(metric_chunks):
            start = idx * 10 + 1
            end = idx * 10 + len(option_chunk)
            suffix = "" if len(metric_chunks) == 1 else f" · Table segment {midx + 1}/{len(metric_chunks)}"
            body_html = f"""
                {SectionTitle(
                    "Portfolio comparison",
                    "Comparison Matrix",
                    f"Options {start}-{end} of {len(entries)}{suffix}",
                )}
                {ComparisonMatrixTable(option_chunk, metrics_chunk)}
                """
            pages.append(
                DeckPage(
                    body_html=body_html,
                    section_label="Comparison matrix",
                    include_frame=True,
                    kind="comparison_matrix",
                    orientation=orientation,
                )
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


def _notes_pages(entries: list[dict[str, Any]], plan: DeckRenderPlan) -> list[DeckPage]:
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
    orientation = plan.orientation_for("notes", "portrait")
    max_units_per_page = _rows_per_page_from_printable(
        orientation,
        header_mm=44.0,
        row_mm=6.4 * plan.font_scale,
        safety_rows=plan.notes_safety + 6,
    )
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

    rendered_pages: list[DeckPage] = []
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
        body_html = f"""
            {SectionTitle("Notes", "Notes & Clause Highlights", subtitle)}
            <div class="notes-summary-grid">
              {''.join(card_html)}
            </div>
            """
        rendered_pages.append(
            DeckPage(
                body_html=body_html,
                section_label="Notes & clause highlights",
                include_frame=True,
                kind="notes",
                orientation=orientation,
            )
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


def _cost_visuals_pages(entries: list[dict[str, Any]], plan: DeckRenderPlan) -> list[DeckPage]:
    if not entries:
        return [
            DeckPage(
                body_html=_cost_visuals_page(entries),
                section_label="Cost visuals",
                include_frame=True,
                kind="cost_visuals",
                orientation=plan.orientation_for("cost_visuals", "landscape"),
            )
        ]
    chunk_size = 5
    pages: list[DeckPage] = []
    orientation = plan.orientation_for("cost_visuals", "landscape")
    for i in range(0, len(entries), chunk_size):
        subset = entries[i : i + chunk_size]
        pages.append(
            DeckPage(
                body_html=_average_costs_combo_page(subset),
                section_label="Cost visuals",
                include_frame=True,
                kind="cost_visuals",
                orientation=orientation,
            )
        )
        pages.append(
            DeckPage(
                body_html=
            _cost_visuals_page(subset).replace(
                "Horizontal bars use a shared per-metric scale to support clean visual ranking.",
                f"Options {i + 1}-{i + len(subset)} of {len(entries)}. Horizontal bars use a shared per-metric scale to support clean visual ranking.",
            ),
                section_label="Cost visuals",
                include_frame=True,
                kind="cost_visuals",
                orientation=orientation,
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


def _lease_abstract_pages(entries: list[dict[str, Any]], plan: DeckRenderPlan) -> list[DeckPage]:
    if not entries:
        return [
            DeckPage(
                body_html=_lease_abstracts_page(entries),
                section_label="Lease abstract highlights",
                include_frame=True,
                kind="lease_abstracts",
                orientation=plan.orientation_for("lease_abstracts", "portrait"),
            )
        ]
    pages: list[DeckPage] = []
    per_page = 2
    orientation = plan.orientation_for("lease_abstracts", "portrait")
    for i in range(0, len(entries), per_page):
        subset = entries[i : i + per_page]
        cards = "".join(LeaseAbstractBlock(entry) for entry in subset)
        body_html = f"""
            {SectionTitle("Lease abstracts", "Lease Abstract Highlights", f"Options {i + 1}-{i + len(subset)} of {len(entries)}. Categorized clause notes and financial context per option.")}
            <div class="abstract-stack">{cards}</div>
            """
        pages.append(
            DeckPage(
                body_html=body_html,
                section_label="Lease abstract highlights",
                include_frame=True,
                kind="lease_abstracts",
                orientation=orientation,
            )
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


def _deck_css(primary_color: str, font_scale: float = 1.0) -> str:
    return f"""
    @page portrait {{
      size: A4 portrait;
      margin: {PAGE_MARGIN_MM:.1f}mm;
    }}
    @page landscape {{
      size: A4 landscape;
      margin: {PAGE_MARGIN_MM:.1f}mm;
    }}
    @page {{
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
      display: flex;
      flex-direction: column;
      border: 1px solid #111;
      background: #fff;
      overflow: hidden;
      --font-scale: {max(MIN_FONT_SCALE, min(1.0, font_scale)):.3f};
      font-size: calc(1em * var(--font-scale));
    }}
    .pdf-page.portrait {{
      page: portrait;
      height: 281mm;
    }}
    .pdf-page.landscape {{
      page: landscape;
      height: 194mm;
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
      overflow: visible;
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
      height: 84mm;
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
    .institutional-panel {{
      margin-bottom: 2.8mm;
    }}
    .annualized-table,
    .monthly-table {{
      margin-top: 1mm;
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
      justify-content: flex-start;
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
    .prepared-for-block {{
      display: flex;
      align-items: center;
      min-height: 8mm;
    }}
    .prepared-by-logo {{
      width: 12mm;
      max-height: 8mm;
      object-fit: contain;
      flex: 0 0 auto;
      margin-top: 0.2mm;
    }}
    .prepared-for-logo {{
      width: auto;
      max-width: 46mm;
      max-height: 8mm;
      object-fit: contain;
      flex: 0 0 auto;
    }}
    .cover-winner-strip {{
      border: 1px solid #111;
      background: #111;
      color: #fff;
      padding: 2mm 2.6mm;
      display: grid;
      grid-template-columns: 8mm 1.55fr 1fr 1.7fr;
      align-items: center;
      gap: 2mm;
      min-height: 14mm;
    }}
    .cover-winner-strip .winner-label {{
      display: block;
      font-size: 8px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      opacity: 0.9;
      margin-bottom: 0.6mm;
    }}
    .cover-winner-strip .cover-option-name strong {{
      display: block;
      font-size: 11px;
      line-height: 1.2;
      color: #fff;
      overflow-wrap: anywhere;
    }}
    .cover-winner-strip .cover-option-rank,
    .cover-winner-strip .cover-option-metrics,
    .cover-winner-strip .cover-option-why {{
      color: #fff;
    }}
    .cover-winner-strip .cover-option-metrics {{
      white-space: normal;
      overflow-wrap: anywhere;
    }}
    .cover-options-stack {{
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.5mm;
      flex: 1;
      min-height: 0;
      align-content: stretch;
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
      white-space: normal;
      overflow-wrap: anywhere;
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


def build_report_deck_html(data: dict[str, Any], plan: DeckRenderPlan | None = None) -> str:
    entries = _extract_entries(data)
    if not entries:
        return "<!doctype html><html><body><h1>No scenarios found</h1></body></html>"
    active_plan = plan or DeckRenderPlan()
    branding = data.get("branding") if isinstance(data.get("branding"), dict) else {}
    theme = resolve_theme(branding if isinstance(branding, dict) else {})

    page_payloads: list[DeckPage] = []
    page_payloads.append(
        DeckPage(
            body_html=CoverPage(entries, theme),
            section_label="Cover",
            include_frame=False,
            kind="cover",
            orientation=active_plan.orientation_for("cover", "landscape"),
        )
    )
    page_payloads.append(
        DeckPage(
            body_html=_executive_summary_page(entries),
            section_label="Executive summary",
            include_frame=True,
            kind="executive_summary",
            orientation=active_plan.orientation_for("executive_summary", "portrait"),
        )
    )
    page_payloads.extend(_matrix_pages(entries, active_plan))
    page_payloads.extend(_monthly_gross_pages(entries, active_plan))
    page_payloads.extend(_notes_pages(entries, active_plan))
    page_payloads.extend(_cost_visuals_pages(entries, active_plan))
    page_payloads.extend(_lease_abstract_pages(entries, active_plan))
    for entry in entries:
        page_payloads.extend(ScenarioDetailSections(entry, active_plan))
    for entry in entries:
        page_payloads.extend(_scenario_monthly_appendix_pages(entry, active_plan))
    page_payloads.append(
        DeckPage(
            body_html=DisclaimerPage(theme),
            section_label="Disclaimer",
            include_frame=True,
            kind="disclaimer",
            orientation=active_plan.orientation_for("disclaimer", "portrait"),
        )
    )

    total_pages = len(page_payloads)
    page_html = []
    for i, payload in enumerate(page_payloads, start=1):
        page_html.append(
            _build_page_shell(
                body_html=payload.body_html,
                theme=theme,
                page_no=i,
                total_pages=total_pages,
                section_label=payload.section_label,
                include_frame=payload.include_frame,
                kind=payload.kind,
                orientation=payload.orientation,
            )
        )

    return f"""
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_esc(theme.report_title)}</title>
  <style>{_deck_css(theme.primary_color, font_scale=active_plan.font_scale)}</style>
</head>
<body>
  {''.join(page_html)}
</body>
</html>
    """.strip()


def _collect_overflow_issues(page: Any) -> list[dict[str, Any]]:
    return page.evaluate(
        """
        () => {
          const pages = Array.from(document.querySelectorAll(".pdf-page"));
          return pages.map((el, idx) => {
            const content = el.querySelector(".page-content");
            const inner = el.querySelector(".page-content-inner");
            const contentHeight = content ? content.clientHeight : 0;
            const innerHeight = inner ? inner.scrollHeight : 0;
            let tableOverflow = false;
            const tables = Array.from(el.querySelectorAll("table"));
            for (const t of tables) {
              const parent = t.parentElement;
              const maxWidth = parent ? parent.clientWidth : 0;
              if (maxWidth && t.scrollWidth > maxWidth + 1) {
                tableOverflow = true;
                break;
              }
            }
            return {
              index: idx,
              kind: el.getAttribute("data-kind") || "general",
              orientation: el.getAttribute("data-orientation") || "portrait",
              overflowPx: Math.max(0, innerHeight - contentHeight),
              tableOverflow,
            };
          });
        }
        """
    )


def _adjust_plan_for_overflow(plan: DeckRenderPlan, issues: list[dict[str, Any]]) -> bool:
    changed = False
    overflow = [i for i in issues if _safe_float(i.get("overflowPx"), 0.0) > 0.0 or bool(i.get("tableOverflow"))]
    if not overflow:
        return False

    for issue in overflow:
        kind = str(issue.get("kind") or "general")
        orientation = str(issue.get("orientation") or "portrait")
        if bool(issue.get("tableOverflow")) and not _is_landscape(orientation):
            plan.orientation_overrides[kind] = "landscape"
            changed = True
        elif _safe_float(issue.get("overflowPx"), 0.0) > 0.0 and not _is_landscape(orientation) and kind in {
            "comparison_matrix",
            "monthly_cashflow_appendix",
            "monthly_gross_matrix",
            "scenario_summary",
        }:
            plan.orientation_overrides[kind] = "landscape"
            changed = True

    if any(_safe_float(i.get("overflowPx"), 0.0) > 0.0 for i in overflow):
        if plan.font_scale > MIN_FONT_SCALE:
            plan.font_scale = max(MIN_FONT_SCALE, round(plan.font_scale - 0.01, 3))
            changed = True
        else:
            plan.matrix_safety += 1
            plan.notes_safety += 1
            plan.monthly_safety += 1
            plan.annual_safety += 1
            changed = True
    return changed


def render_report_deck_pdf(data: dict[str, Any]) -> bytes:
    from playwright.sync_api import sync_playwright

    plan = DeckRenderPlan()
    html_str = build_report_deck_html(data, plan=plan)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        max_attempts = 6
        for _ in range(max_attempts):
            page.set_content(html_str, wait_until="networkidle")
            page.emulate_media(media="print")
            issues = _collect_overflow_issues(page)
            if not any(_safe_float(i.get("overflowPx"), 0.0) > 0.0 or bool(i.get("tableOverflow")) for i in issues):
                break
            if not _adjust_plan_for_overflow(plan, issues):
                break
            html_str = build_report_deck_html(data, plan=plan)
        else:
            page.set_content(html_str, wait_until="networkidle")
            page.emulate_media(media="print")

        pdf_bytes = page.pdf(
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            margin={"top": "0in", "bottom": "0in", "left": "0in", "right": "0in"},
        )
        browser.close()
    return pdf_bytes
