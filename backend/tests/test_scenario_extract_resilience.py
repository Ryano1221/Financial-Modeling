"""Resilience tests for extraction fallback paths."""

from scenario_extract import _apply_safe_defaults


def test_apply_safe_defaults_handles_non_object_raw() -> None:
    scenario, confidence, warnings = _apply_safe_defaults([], prefill={})
    assert scenario["rsf"] == 10000.0
    assert "rent_steps" in scenario and len(scenario["rent_steps"]) >= 1
    assert isinstance(confidence, dict)
    assert any("invalid" in w.lower() for w in warnings)


def test_apply_safe_defaults_infers_nnn_when_explicit_opex_present() -> None:
    scenario, _confidence, _warnings = _apply_safe_defaults(
        {"scenario": {"opex_mode": None, "base_opex_psf_yr": 14.5}},
        prefill={},
    )
    assert scenario["opex_mode"] == "nnn"
    assert scenario["base_opex_psf_yr"] == 14.5


def test_apply_safe_defaults_forces_zero_opex_for_full_service_mode() -> None:
    scenario, _confidence, _warnings = _apply_safe_defaults(
        {"scenario": {"opex_mode": "full_service", "base_opex_psf_yr": 12.0, "opex_growth": 0.03}},
        prefill={},
    )
    assert scenario["opex_mode"] == "full_service"
    assert scenario["base_opex_psf_yr"] == 0.0
    assert scenario["base_year_opex_psf_yr"] == 0.0
    assert scenario["opex_growth"] == 0.0
