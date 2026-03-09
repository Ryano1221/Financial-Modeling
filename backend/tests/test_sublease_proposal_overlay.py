from __future__ import annotations

import main
from services.input_normalizer import _dict_to_canonical


def _canonical() -> object:
    return _dict_to_canonical(
        {
            "scenario_name": "Imported Proposal",
            "building_name": "400 W 6th St",
            "suite": "26-28",
            "address": "400 W 6th St, Austin, TX",
            "rsf": 92982,
            "commencement_date": "2028-04-01",
            "expiration_date": "2036-10-31",
            "term_months": 103,
            "rent_schedule": [{"start_month": 0, "end_month": 102, "rent_psf_annual": 44}],
        }
    )


def test_extract_proposal_profile_parses_subtenant_identity() -> None:
    text = (
        "Date: March 6, 2026\n"
        "Counter Proposal\n"
        "Property: 400 W 6th St\n"
        "Proposed Subtenant: Meta Platforms, Inc.\n"
        "Guarantor: Meta Platforms Holdings LLC\n"
        "Broker: JLL\n"
    )
    profile = main._extract_proposal_profile_from_text(
        text=text,
        filename="meta-counter.docx",
        canonical=_canonical(),
    )

    proposal = profile.get("proposal") or {}
    assert proposal.get("subtenant_name") == "Meta Platforms, Inc."
    assert proposal.get("guarantor") == "Meta Platforms Holdings LLC"
    assert proposal.get("broker_name") == "JLL"
    assert proposal.get("proposal_name")


def test_extract_proposal_profile_flags_missing_subtenant() -> None:
    text = "Counter proposal for 400 W 6th St. Base rent starts at $44.00/SF."
    profile = main._extract_proposal_profile_from_text(
        text=text,
        filename="counter.docx",
        canonical=_canonical(),
    )

    tasks = profile.get("review_tasks") or []
    assert any(str(task.get("issue_code") or "") == "SUBTENANT_NAME_MISSING" for task in tasks)
