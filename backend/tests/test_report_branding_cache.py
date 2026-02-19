from __future__ import annotations

import uuid

from cache.disk_cache import get_cached_report_deck, set_cached_report_deck


def test_report_deck_cache_isolation_by_org_and_theme_hash():
    payload = {
        "scenarios": [{"scenario": {"name": "Scenario A", "rsf": 1000}, "result": {"npv_cost": 100}}],
        "branding": {"brand_name": "Broker A"},
    }
    pdf_bytes = f"pdf-{uuid.uuid4()}".encode("utf-8")
    org_id = f"org-{uuid.uuid4()}"
    theme_hash = "theme-a"

    set_cached_report_deck(payload, org_id, theme_hash, pdf_bytes)

    assert get_cached_report_deck(payload, org_id, theme_hash) == pdf_bytes
    assert get_cached_report_deck(payload, f"{org_id}-other", theme_hash) is None
    assert get_cached_report_deck(payload, org_id, "theme-b") is None
