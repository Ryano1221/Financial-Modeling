"""Consistent formatting for report numbers and dates. Never render raw floats."""
from __future__ import annotations

from datetime import date
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
    if hasattr(d, "isoformat"):
        return d.isoformat()
    return str(d)


def format_psf(value: float, precision: int = 2) -> str:
    return f"${value:,.{precision}f}/SF"
