from __future__ import annotations

from pathlib import Path

from extraction.hardening.corpus import DOC_FAMILIES, HardeningCase, SyntheticDocument, family_coverage, generate_synthetic_corpus, load_curated_corpus
from extraction.hardening.evaluation import evaluate_cases
from extraction.hardening.framework import run_hardening_loop
from extraction.hardening.resolver import resolve_case, resolve_cases, trace_contains_override


def _curated_path() -> Path:
    return Path(__file__).parent / "fixtures" / "parser_hardening" / "curated_cases.json"


def test_generate_synthetic_corpus_supports_thousands_and_family_coverage() -> None:
    cases = generate_synthetic_corpus(total_cases=2600, seed=17)
    assert len(cases) == 2600

    coverage = family_coverage(cases)
    for family in DOC_FAMILIES:
        assert coverage.get(family, 0) > 0, f"missing family coverage for {family}"


def test_stack_resolver_prefers_override_terms_and_trace() -> None:
    case = HardeningCase(
        case_id="override-1",
        family="amendment",
        documents=[
            SyntheticDocument(
                doc_id="lease-v1",
                family="lease",
                role="base_lease",
                text=(
                    "Lease\n"
                    "Premises: Suite 210\n"
                    "Rentable Square Feet: 15,000 RSF\n"
                    "Commencement Date: 01/01/2026\n"
                    "Expiration Date: 12/31/2030\n"
                    "Lease Term: 60 months\n"
                    "Base Rent: $40.00 / SF"
                ),
                as_of_date="2026-01-01",
                rent_steps=[{"start_month": 0, "end_month": 59, "rate_psf_annual": 40.0}],
            ),
            SyntheticDocument(
                doc_id="amend-v2",
                family="amendment",
                role="override",
                text=(
                    "First Amendment\n"
                    "Notwithstanding the Lease, Section 2 is hereby amended and replaced.\n"
                    "Lease Term: 84 months.\n"
                    "Expiration Date: 12/31/2032.\n"
                    "Base Rent: $43.00 / SF"
                ),
                as_of_date="2027-02-01",
                rent_steps=[{"start_month": 0, "end_month": 83, "rate_psf_annual": 43.0}],
            ),
        ],
        expected={
            "commencement_date": "2026-01-01",
            "expiration_date": "2032-12-31",
            "term_months": 84,
            "rsf": 15000,
            "suite": "210",
            "base_rent_psf": 43.0,
        },
        controlling_fields=["term_months", "expiration_date", "base_rent_psf"],
        tags=["unit", "override"],
    )

    resolved = resolve_case(case)
    assert resolved.predicted["term_months"] == 84
    assert str(resolved.predicted["expiration_date"]) == "2032-12-31"
    assert abs(float(resolved.predicted["base_rent_psf"] or 0.0) - 43.0) < 1e-6
    assert trace_contains_override(resolved.controlling_trace, "term.term_months")


def test_curated_gold_regressions_score_strongly_on_controlling_fields() -> None:
    cases = load_curated_corpus(_curated_path())
    resolved = resolve_cases(cases)
    report = evaluate_cases(cases=cases, resolved=resolved)

    assert report.total_cases >= 8
    assert report.controlling_term_accuracy >= 0.82

    by_case = {r.case_id: r for r in resolved}
    atx = by_case["curated-atx-tower-2026"]
    ibc = by_case["curated-ibc-bank-plaza-2026"]
    flyer = by_case["curated-domain-place-flyer"]
    floorplan = by_case["curated-eastlake-floorplan"]

    assert atx.predicted["term_months"] == 91
    assert str(atx.predicted["commencement_date"]) == "2026-10-01"
    assert abs(float(atx.predicted["rsf"] or 0.0) - 5618.0) <= 1.0

    assert ibc.predicted["term_months"] == 88
    assert str(ibc.predicted["expiration_date"]) == "2034-01-31"
    assert abs(float(ibc.predicted["base_rent_psf"] or 0.0) - 46.0) <= 0.1

    assert abs(float(flyer.predicted["rsf"] or 0.0) - 22473.0) <= 1.0
    assert str(flyer.predicted["suite"] or "").strip().endswith("600")
    assert abs(float(floorplan.predicted["rsf"] or 0.0) - 13750.0) <= 1.0


def test_hardening_loop_emits_metrics_and_failure_clusters() -> None:
    payload = run_hardening_loop(
        iterations=2,
        total_cases_per_iteration=160,
        base_seed=19,
        curated_path=_curated_path(),
    )
    aggregate = payload.get("aggregate") or {}

    assert int(aggregate.get("iterations") or 0) == 2
    assert int(aggregate.get("total_cases_evaluated") or 0) >= 320
    assert float(aggregate.get("macro_f1_mean") or 0.0) >= 0.68
    assert float(aggregate.get("controlling_accuracy_mean") or 0.0) >= 0.72
    assert float(aggregate.get("confidence_calibration_mae_mean") or 1.0) <= 0.5
    assert isinstance(aggregate.get("top_failure_modes"), list)
