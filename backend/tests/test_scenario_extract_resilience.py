"""Resilience tests for extraction fallback paths."""

from scenario_extract import _apply_safe_defaults


def test_apply_safe_defaults_handles_non_object_raw() -> None:
    scenario, confidence, warnings = _apply_safe_defaults([], prefill={})
    assert scenario["rsf"] == 10000.0
    assert "rent_steps" in scenario and len(scenario["rent_steps"]) >= 1
    assert isinstance(confidence, dict)
    assert any("invalid" in w.lower() for w in warnings)
