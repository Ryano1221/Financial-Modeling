"""
Build institutional report HTML from scenario + compute result + brand + meta.
Uses format_utils for all numbers. Renders to PDF via Playwright when available.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
from pathlib import Path
from typing import Any

from models import CashflowResult, Scenario

from .format_utils import format_currency, format_date, format_number, format_percent, format_psf
from .report_data import build_report_data

# Template path relative to this file
_TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"
_REPORT_HTML = (_TEMPLATE_DIR / "report.html").read_text(encoding="utf-8")

# In-memory cache for report_data (speeds preview). Capped by REPORT_DATA_CACHE_MAX.
_REPORT_DATA_CACHE: dict[str, dict[str, Any]] = {}
_REPORT_DATA_CACHE_ORDER: list[str] = []
_MAX_REPORT_DATA_CACHE = max(1, int(os.getenv("REPORT_DATA_CACHE_MAX", "16")))


def _report_data_cache_key(scenario_dict: dict, brand_id: str, meta: dict) -> str:
    payload = json.dumps(
        {"scenario": scenario_dict, "brand_id": brand_id, "meta": meta},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def get_report_data_cached(
    scenario: Scenario,
    compute_result: CashflowResult,
    brand_id: str,
    meta: dict,
    warnings: list[str] | None = None,
    confidence: dict[str, float] | None = None,
    evidence: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build report data with short-lived in-memory cache."""
    scenario_dict = scenario.model_dump(mode="json")
    key = _report_data_cache_key(scenario_dict, brand_id, meta)
    if key in _REPORT_DATA_CACHE:
        return _REPORT_DATA_CACHE[key]
    data = build_report_data(
        scenario, compute_result,
        warnings=warnings, confidence=confidence, evidence=evidence,
    )
    if len(_REPORT_DATA_CACHE) >= _MAX_REPORT_DATA_CACHE and _REPORT_DATA_CACHE_ORDER:
        oldest = _REPORT_DATA_CACHE_ORDER.pop(0)
        _REPORT_DATA_CACHE.pop(oldest, None)
    _REPORT_DATA_CACHE[key] = data
    _REPORT_DATA_CACHE_ORDER.append(key)
    return data


def _escape(s: str) -> str:
    return html.escape(str(s), quote=True)


def _build_key_terms_rows(key_terms: list[tuple[str, str]]) -> str:
    return "".join(
        f'<tr><td>{_escape(k)}</td><td>{_escape(v)}</td></tr>'
        for k, v in key_terms
    )


def _build_financial_summary_rows(fs: dict[str, Any]) -> str:
    rows = [
        ("Term (months)", format_number(fs["term_months"])),
        ("Rent (nominal)", format_currency(fs["rent_nominal"])),
        ("Opex (nominal)", format_currency(fs["opex_nominal"])),
        ("Total cost (nominal)", format_currency(fs["total_cost_nominal"])),
        ("NPV cost", format_currency(fs["npv_cost"])),
        ("Avg cost/year", format_currency(fs["avg_cost_year"])),
        ("Avg cost/SF/year", format_currency(fs["avg_cost_psf_year"], precision=2)),
    ]
    return "".join(f'<tr><td>{_escape(k)}</td><td class="num">{_escape(v)}</td></tr>' for k, v in rows)


def _build_rent_schedule_rows(rent_schedule: list[dict]) -> str:
    return "".join(
        f'<tr><td>{r["lease_year"]}</td><td class="num">{format_currency(r["rent_nominal"])}</td></tr>'
        for r in rent_schedule
    )


def _build_assumptions_list(assumptions: list[str]) -> str:
    return "".join(f"<li>{_escape(a)}</li>" for a in assumptions)


def _build_risk_list(risk_observations: list[str]) -> str:
    if not risk_observations:
        return "<li>None identified.</li>"
    return "".join(f"<li>{_escape(r)}</li>" for r in risk_observations)


def _build_confidence_table(confidence_table: list[dict]) -> str:
    if not confidence_table:
        return ""
    rows = "".join(
        f'<tr><td>{_escape(r.get("field", ""))}</td><td class="num">{format_percent(r.get("confidence", 0), precision=0)}</td><td>{_escape(r.get("evidence", ""))}</td></tr>'
        for r in confidence_table
    )
    return f'<table class="data"><thead><tr><th>Field</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table>'


def build_report_html(
    scenario: Scenario,
    compute_result: CashflowResult,
    brand: Any,
    meta: dict[str, Any],
    report_data: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
    confidence: dict[str, float] | None = None,
    evidence: dict[str, str] | None = None,
) -> str:
    """
    Produce full HTML string for the report. Uses format_* for all numbers.
    Uses in-memory cache for report_data when not provided (speeds repeated previews).
    """
    if report_data is None:
        brand_id = getattr(brand, "brand_id", "default")
        scenario_dict = scenario.model_dump(mode="json")
        report_data = get_report_data_cached(
            scenario, compute_result, brand_id, meta,
            warnings=warnings, confidence=confidence, evidence=evidence,
        )

    company_name = getattr(brand, "company_name", "Lease Deck")
    logo_url = getattr(brand, "logo_url", None) or ""
    primary_color = getattr(brand, "primary_color", "#1e3a5f")
    secondary_color = getattr(brand, "secondary_color", "#4a5568")
    font_family = getattr(brand, "font_family", "Georgia, 'Times New Roman', serif")
    header_text = getattr(brand, "header_text", None) or ""
    footer_text = getattr(brand, "footer_text", None) or "Confidential"
    disclaimer_text = getattr(brand, "disclaimer_text", "This analysis is for discussion purposes only.")
    cover_page_enabled = getattr(brand, "cover_page_enabled", True)
    watermark_text = getattr(brand, "watermark_text", None) or ""
    report_title_override = getattr(brand, "report_title_override", None) or ""
    include_confidence_section = getattr(brand, "include_confidence_section", False)
    include_methodology_section = getattr(brand, "include_methodology_section", True)
    table_density = getattr(brand, "table_density", "standard")

    report_title = report_title_override.strip() or "Lease Financial Analysis"
    font_family_css = font_family if font_family.startswith("'") or " " in font_family else f"'{font_family}', serif"
    header_suffix = f" · {_escape(header_text)}" if header_text else ""
    confidential = meta.get("confidential", True)
    footer_confidential = " · Confidential" if confidential else ""
    density_class = f"density-{table_density}"

    if watermark_text:
        watermark_html = f'<div class="watermark">{_escape(watermark_text)}</div>'
    else:
        watermark_html = ""

    if cover_page_enabled:
        proposal_name = meta.get("proposal_name", "")
        property_name = meta.get("property_name", "")
        tenant_name = meta.get("tenant_name", "")
        prepared_for = meta.get("prepared_for", "—")
        prepared_by = meta.get("prepared_by", "—")
        report_date = meta.get("report_date", "")
        report_date_str = format_date(report_date) if report_date else report_date
        logo_block = f'<img src="{_escape(logo_url)}" alt="{_escape(company_name)}" />' if logo_url else f'<div class="company-text">{_escape(company_name)}</div>'
        cover_html = f"""<div class="cover">
    <div class="logo-wrap">{logo_block}</div>
    <h1>{_escape(report_title)}</h1>
    {f'<p class="meta"><strong>Proposal:</strong> {_escape(proposal_name)}</p>' if proposal_name else ''}
    {f'<p class="meta"><strong>Property:</strong> {_escape(property_name)}</p>' if property_name else ''}
    {f'<p class="meta"><strong>Tenant:</strong> {_escape(tenant_name)}</p>' if tenant_name else ''}
    <p class="meta"><strong>Prepared for:</strong> {_escape(prepared_for)}</p>
    <p class="meta"><strong>Prepared by:</strong> {_escape(prepared_by)}</p>
    <p class="meta"><strong>Date:</strong> {_escape(report_date_str)}</p>
  </div>"""
    else:
        cover_html = ""

    key_terms_rows = _build_key_terms_rows(report_data["key_terms"])
    financial_summary_rows = _build_financial_summary_rows(report_data["financial_summary"])
    rent_schedule_rows = _build_rent_schedule_rows(report_data["rent_schedule"])
    assumptions_list = _build_assumptions_list(report_data["assumptions"])
    risk_observations_list = _build_risk_list(report_data["risk_observations"])
    notes_limitations_list = _build_assumptions_list(report_data.get("notes_limitations", []))
    executive_summary_paragraph = _escape(report_data.get("executive_summary_paragraph", ""))

    confidence_section_html = ""
    if include_confidence_section and report_data.get("confidence_table"):
        table_html = _build_confidence_table(report_data["confidence_table"])
        confidence_section_html = f'<section class="report-section page-break-before"><h2>Data Confidence</h2>{table_html}</section>'

    methodology_section_html = ""
    if include_methodology_section and report_data.get("methodology_html"):
        methodology_section_html = f'<section class="report-section page-break-before"><h2>Methodology</h2><div class="methodology">{report_data["methodology_html"]}</div></section>'

    footer_left = f"{_escape(company_name)} · {_escape(footer_text)}" if footer_text else f"{_escape(company_name)}{footer_confidential}"

    html_out = (
        _REPORT_HTML.replace("__PRIMARY_COLOR__", primary_color)
        .replace("__SECONDARY_COLOR__", secondary_color)
        .replace("__FONT_FAMILY_CSS__", font_family_css)
        .replace("__TABLE_DENSITY_CLASS__", density_class)
        .replace("__WATERMARK_HTML__", watermark_html)
        .replace("__COMPANY_NAME__", _escape(company_name))
        .replace("__REPORT_TITLE__", _escape(report_title))
        .replace("__HEADER_TEXT__", header_suffix)
        .replace("__COVER_HTML__", cover_html)
        .replace("__EXECUTIVE_SUMMARY_PARAGRAPH__", executive_summary_paragraph)
        .replace("__KEY_TERMS_ROWS__", key_terms_rows)
        .replace("__FINANCIAL_SUMMARY_ROWS__", financial_summary_rows)
        .replace("__RENT_SCHEDULE_ROWS__", rent_schedule_rows)
        .replace("__ASSUMPTIONS_LIST__", assumptions_list)
        .replace("__RISK_OBSERVATIONS_LIST__", risk_observations_list)
        .replace("__NOTES_LIMITATIONS_LIST__", notes_limitations_list)
        .replace("__CONFIDENCE_SECTION_HTML__", confidence_section_html)
        .replace("__METHODOLOGY_SECTION_HTML__", methodology_section_html)
        .replace("__DISCLAIMER_TEXT__", _escape(disclaimer_text))
        .replace("__FOOTER_LEFT__", footer_left)
    )
    return html_out


def html_to_pdf(html_content: str, page_margin_mm: int = 18) -> bytes:
    """Render HTML to PDF using Playwright. Uses page_margin_mm for margins."""
    from playwright.sync_api import sync_playwright

    margin_in = f"{page_margin_mm / 25.4:.2f}in"
    margin = {"top": margin_in, "bottom": margin_in, "left": margin_in, "right": margin_in}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html_content, wait_until="networkidle")
        page.emulate_media(media="print")
        pdf_bytes = page.pdf(
            format="A4",
            print_background=True,
            margin=margin,
        )
        browser.close()
    return pdf_bytes


def build_report_pdf(
    scenario: Scenario,
    compute_result: CashflowResult,
    brand: Any,
    meta: dict[str, Any],
    report_data: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
    confidence: dict[str, float] | None = None,
    evidence: dict[str, str] | None = None,
) -> bytes:
    """Build report data, render HTML, then PDF. Returns PDF bytes."""
    if report_data is None:
        report_data = build_report_data(
            scenario, compute_result,
            warnings=warnings, confidence=confidence, evidence=evidence,
        )
    page_margin_mm = getattr(brand, "page_margin_mm", 18)
    html_str = build_report_html(scenario, compute_result, brand, meta, report_data=report_data)
    return html_to_pdf(html_str, page_margin_mm=page_margin_mm)
