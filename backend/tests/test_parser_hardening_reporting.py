from __future__ import annotations

from pathlib import Path

from extraction.hardening.evaluation import failure_density, f1_macro
from extraction.hardening.framework import run_hardening_evaluation, run_hardening_loop, write_hardening_artifacts


def test_write_hardening_artifacts_emits_json_and_markdown(tmp_path: Path) -> None:
    payload = run_hardening_loop(iterations=1, total_cases_per_iteration=40, base_seed=11)
    paths = write_hardening_artifacts(payload=payload, output_dir=tmp_path, prefix="unit-hardening")

    json_path = Path(paths["json"])
    md_path = Path(paths["markdown"])
    assert json_path.exists()
    assert md_path.exists()
    assert "macro_f1_mean" in json_path.read_text(encoding="utf-8")
    assert "error_rate_mean" in json_path.read_text(encoding="utf-8")
    assert "Parser Hardening Report" in md_path.read_text(encoding="utf-8")


def test_hardening_evaluation_includes_curated_dataset_when_available() -> None:
    curated = Path(__file__).parent / "fixtures" / "parser_hardening" / "curated_cases.json"
    run = run_hardening_evaluation(total_cases=30, seed=7, curated_path=curated, include_curated=True)
    assert run.case_count >= 38
    assert run.report.total_cases == run.case_count


def test_hardening_regression_quality_gate() -> None:
    curated = Path(__file__).parent / "fixtures" / "parser_hardening" / "curated_cases.json"
    run = run_hardening_evaluation(total_cases=120, seed=29, curated_path=curated, include_curated=True)
    report = run.report

    # Quality gate tuned to protect parser behavior while allowing controlled variability.
    assert f1_macro(report) >= 0.74
    assert report.controlling_term_accuracy >= 0.78
    assert report.confidence_calibration_mae <= 0.45
    assert failure_density(report) <= 0.25

    for required_family in ("proposal", "loi", "counter", "lease", "amendment", "redline", "flyer", "floorplan"):
        assert int(report.family_coverage.get(required_family) or 0) > 0
