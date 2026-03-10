from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

from .corpus import HardeningCase, generate_synthetic_corpus, load_curated_corpus
from .evaluation import (
    EvaluationReport,
    coverage_gap_families,
    evaluate_cases,
    f1_macro,
    report_grade,
    summarize_top_failure_modes,
)
from .resolver import resolve_cases


@dataclass
class HardeningRun:
    name: str
    seed: int
    case_count: int
    report: EvaluationReport


def run_hardening_evaluation(
    *,
    total_cases: int = 3000,
    seed: int = 42,
    curated_path: str | Path | None = None,
    include_curated: bool = True,
) -> HardeningRun:
    synthetic_cases = generate_synthetic_corpus(total_cases=total_cases, seed=seed)
    cases: list[HardeningCase] = list(synthetic_cases)

    if include_curated and curated_path:
        path = Path(curated_path)
        if path.exists():
            cases.extend(load_curated_corpus(path))

    resolved = resolve_cases(cases)
    report = evaluate_cases(cases=cases, resolved=resolved)
    return HardeningRun(
        name=f"hardening-seed-{seed}",
        seed=seed,
        case_count=len(cases),
        report=report,
    )


def run_hardening_loop(
    *,
    iterations: int = 3,
    total_cases_per_iteration: int = 2500,
    base_seed: int = 42,
    curated_path: str | Path | None = None,
) -> dict[str, Any]:
    runs: list[HardeningRun] = []
    for i in range(max(1, iterations)):
        seed = base_seed + i
        runs.append(
            run_hardening_evaluation(
                total_cases=total_cases_per_iteration,
                seed=seed,
                curated_path=curated_path,
                include_curated=True,
            )
        )

    macro_vals = [f1_macro(run.report) for run in runs]
    controlling_vals = [run.report.controlling_term_accuracy for run in runs]
    calibration_vals = [run.report.confidence_calibration_mae for run in runs]

    aggregate = {
        "iterations": len(runs),
        "total_cases_evaluated": sum(run.case_count for run in runs),
        "macro_f1_mean": round(sum(macro_vals) / len(macro_vals), 4),
        "macro_f1_min": round(min(macro_vals), 4),
        "macro_f1_max": round(max(macro_vals), 4),
        "controlling_accuracy_mean": round(sum(controlling_vals) / len(controlling_vals), 4),
        "confidence_calibration_mae_mean": round(sum(calibration_vals) / len(calibration_vals), 4),
        "grades": [report_grade(run.report) for run in runs],
        "coverage_gaps": sorted({fam for run in runs for fam in coverage_gap_families(run.report)}),
        "top_failure_modes": [
            {
                "seed": run.seed,
                "modes": summarize_top_failure_modes(run.report, limit=6),
            }
            for run in runs
        ],
    }

    return {
        "aggregate": aggregate,
        "runs": [
            {
                "name": run.name,
                "seed": run.seed,
                "case_count": run.case_count,
                "report": run.report.to_dict(),
            }
            for run in runs
        ],
    }


def build_markdown_summary(payload: dict[str, Any]) -> str:
    agg = payload.get("aggregate") or {}
    lines = [
        "# Parser Hardening Report",
        "",
        f"- Iterations: {agg.get('iterations')}",
        f"- Total cases evaluated: {agg.get('total_cases_evaluated')}",
        f"- Macro F1 (mean/min/max): {agg.get('macro_f1_mean')} / {agg.get('macro_f1_min')} / {agg.get('macro_f1_max')}",
        f"- Controlling-term accuracy (mean): {agg.get('controlling_accuracy_mean')}",
        f"- Confidence calibration MAE (mean): {agg.get('confidence_calibration_mae_mean')}",
        f"- Run grades: {', '.join(agg.get('grades') or [])}",
    ]

    gaps = agg.get("coverage_gaps") or []
    if gaps:
        lines.append(f"- Coverage gaps: {', '.join(gaps)}")
    else:
        lines.append("- Coverage gaps: none")

    lines.append("")
    lines.append("## Top Failure Modes")
    for row in agg.get("top_failure_modes") or []:
        seed = row.get("seed")
        lines.append(f"- Seed {seed}:")
        for mode in row.get("modes") or []:
            lines.append(f"  - {mode}")

    return "\n".join(lines).strip() + "\n"


def write_hardening_artifacts(
    *,
    payload: dict[str, Any],
    output_dir: str | Path,
    prefix: str = "parser-hardening",
) -> dict[str, str]:
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{prefix}.json"
    md_path = out_dir / f"{prefix}.md"

    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    md_path.write_text(build_markdown_summary(payload), encoding="utf-8")

    return {"json": str(json_path), "markdown": str(md_path)}
