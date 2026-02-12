"""Tests for auto OCR text quality and Scenario free_rent_months normalization."""
from datetime import date

import pytest

from models import OpexMode, RentStep, Scenario
from scenario_extract import text_quality_requires_ocr


# ---- text_quality_requires_ocr (auto OCR) ----

def test_text_quality_requires_ocr_empty_returns_true():
    assert text_quality_requires_ocr("") is True
    assert text_quality_requires_ocr("   \n  ") is True


def test_text_quality_requires_ocr_short_text_returns_true():
    text = "a" * 1199
    assert text_quality_requires_ocr(text) is True
    text = "a" * 1200
    assert text_quality_requires_ocr(text) is False  # only other checks could trigger


def test_text_quality_requires_ocr_low_alnum_ratio_returns_true():
    # Fewer than 40% alnum (non-ws): e.g. lots of symbols
    text = "x" * 600 + "#" * 900  # 600/1500 non-ws are alnum = 0.4 exactly; need < 0.4
    text = "x" * 500 + "#" * 1000  # 500/1500 = 0.33 < 0.40
    assert len(text.strip()) >= 1200
    assert text_quality_requires_ocr(text) is True


def test_text_quality_requires_ocr_high_alnum_passes():
    text = "The lease commences on January 1 2026 and expires December 31 2030. " * 30
    assert len(text.strip()) >= 1200
    assert text_quality_requires_ocr(text) is False


def test_text_quality_requires_ocr_bad_char_count_returns_true():
    text = "a" * 1300
    assert text_quality_requires_ocr(text) is False
    text = "a" * 1200 + "\uFFFD" * 6  # replacement char
    assert text_quality_requires_ocr(text) is True


def test_text_quality_requires_ocr_short_line_ratio_returns_true():
    # Many short lines: > 60% of non-empty lines have < 20 chars
    lines = ["ab"] * 70 + ["this is a much longer line of text here"] * 30
    text = "\n".join(lines)
    assert len(text.strip()) >= 1200
    assert text_quality_requires_ocr(text) is True


def test_text_quality_requires_ocr_good_text_returns_false():
    long_paragraph = "This lease agreement is made between the landlord and tenant. " * 40
    assert len(long_paragraph.strip()) >= 1200
    assert text_quality_requires_ocr(long_paragraph) is False


# ---- Scenario free_rent_months normalization ----

def test_scenario_free_rent_months_accepts_int():
    s = Scenario(
        name="Test",
        rsf=1000.0,
        commencement=date(2026, 1, 1),
        expiration=date(2031, 1, 1),
        rent_steps=[RentStep(start=0, end=59, rate_psf_yr=30.0)],
        free_rent_months=5,
        ti_allowance_psf=0.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=0.0,
        base_year_opex_psf_yr=0.0,
        opex_growth=0.0,
        discount_rate_annual=0.06,
    )
    assert s.free_rent_months == 5


def test_scenario_free_rent_months_accepts_list_normalizes_to_len():
    s = Scenario(
        name="Test",
        rsf=1000.0,
        commencement=date(2026, 1, 1),
        expiration=date(2031, 1, 1),
        rent_steps=[RentStep(start=0, end=59, rate_psf_yr=30.0)],
        free_rent_months=[1, 2, 3],  # type: ignore[arg-type]
        ti_allowance_psf=0.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=0.0,
        base_year_opex_psf_yr=0.0,
        opex_growth=0.0,
        discount_rate_annual=0.06,
    )
    assert s.free_rent_months == 3


def test_scenario_free_rent_months_accepts_empty_list_normalizes_to_zero():
    s = Scenario(
        name="Test",
        rsf=1000.0,
        commencement=date(2026, 1, 1),
        expiration=date(2031, 1, 1),
        rent_steps=[RentStep(start=0, end=59, rate_psf_yr=30.0)],
        free_rent_months=[],  # type: ignore[arg-type]
        ti_allowance_psf=0.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=0.0,
        base_year_opex_psf_yr=0.0,
        opex_growth=0.0,
        discount_rate_annual=0.06,
    )
    assert s.free_rent_months == 0


def test_scenario_free_rent_months_none_normalizes_to_zero():
    s = Scenario(
        name="Test",
        rsf=1000.0,
        commencement=date(2026, 1, 1),
        expiration=date(2031, 1, 1),
        rent_steps=[RentStep(start=0, end=59, rate_psf_yr=30.0)],
        free_rent_months=None,  # type: ignore[arg-type]
        ti_allowance_psf=0.0,
        opex_mode=OpexMode.NNN,
        base_opex_psf_yr=0.0,
        base_year_opex_psf_yr=0.0,
        opex_growth=0.0,
        discount_rate_annual=0.06,
    )
    assert s.free_rent_months == 0
