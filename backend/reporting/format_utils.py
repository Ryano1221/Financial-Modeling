"""Consistent formatting for report numbers and dates. Never render raw floats."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any


def format_currency(value: float, precision: int = 0) -> str:
    if precision <= 0:
        return f"${value:,.0f}" if abs(value) >= 1 else f"${value:,.2f}"
    return f"${value:,.{precision}f}"


def format_number(value: float, precision: int = 0) -> str:
    if precision <= 0:
        return f"{value:,.0f}" if abs(value) >= 1 else f"{value:,.2f}"
    return f"{value:,.{precision}f}"


def format_percent(value: float, precision: int = 2) -> str:
    return f"{value * 100:,.{precision}f}%"


def format_date(d: Any) -> str:
    if d is None:
        return "—"
    if isinstance(d, date):
        return d.strftime("%d/%m/%Y")
    text = str(d).strip()
    if not text:
        return "—"
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            parsed = datetime.strptime(text[:10], fmt).date()
            return parsed.strftime("%d/%m/%Y")
        except ValueError:
            continue
    return text


def format_psf(value: float, precision: int = 2) -> str:
    return f"${value:,.{precision}f}/SF"
