from __future__ import annotations

from pathlib import Path

from extraction.hardening.framework import run_hardening_evaluation, run_hardening_loop, write_hardening_artifacts


def test_write_hardening_artifacts_emits_json_and_markdown(tmp_path: Path) -> None:
    payload = run_hardening_loop(iterations=1, total_cases_per_iteration=40, base_seed=11)
    paths = write_hardening_artifacts(payload=payload, output_dir=tmp_path, prefix="unit-hardening")

    json_path = Path(paths["json"])
    md_path = Path(paths["markdown"])
    assert json_path.exists()
    assert md_path.exists()
    assert "macro_f1_mean" in json_path.read_text(encoding="utf-8")
    assert "Parser Hardening Report" in md_path.read_text(encoding="utf-8")


def test_hardening_evaluation_includes_curated_dataset_when_available() -> None:
    curated = Path(__file__).parent / "fixtures" / "parser_hardening" / "curated_cases.json"
    run = run_hardening_evaluation(total_cases=30, seed=7, curated_path=curated, include_curated=True)
    assert run.case_count >= 36
    assert run.report.total_cases == run.case_count
