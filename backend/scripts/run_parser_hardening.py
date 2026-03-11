from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from extraction.hardening.framework import run_hardening_loop, write_hardening_artifacts


def main() -> int:
    parser = argparse.ArgumentParser(description="Run large-scale parser hardening evaluation.")
    parser.add_argument("--iterations", type=int, default=3, help="Number of loop iterations (different seeds).")
    parser.add_argument("--cases", type=int, default=3000, help="Synthetic cases per iteration.")
    parser.add_argument("--seed", type=int, default=42, help="Base RNG seed.")
    parser.add_argument(
        "--curated",
        type=str,
        default=str(Path("tests/fixtures/parser_hardening/curated_cases.json")),
        help="Path to curated regression gold dataset JSON.",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=str(Path("cache/extraction/parser_hardening")),
        help="Output directory for JSON + markdown report.",
    )

    args = parser.parse_args()

    payload = run_hardening_loop(
        iterations=max(1, int(args.iterations)),
        total_cases_per_iteration=max(1, int(args.cases)),
        base_seed=int(args.seed),
        curated_path=args.curated,
    )
    paths = write_hardening_artifacts(
        payload=payload,
        output_dir=args.out,
        prefix=f"parser-hardening-i{int(args.iterations)}-n{int(args.cases)}-s{int(args.seed)}",
    )

    aggregate = payload.get("aggregate") or {}
    print("Parser hardening run complete")
    print(f"Iterations: {aggregate.get('iterations')}")
    print(f"Total evaluated: {aggregate.get('total_cases_evaluated')}")
    print(f"Macro F1 mean: {aggregate.get('macro_f1_mean')}")
    print(f"Error rate mean: {aggregate.get('error_rate_mean')}")
    print(f"Controlling accuracy mean: {aggregate.get('controlling_accuracy_mean')}")
    print(f"Controlling error rate mean: {aggregate.get('controlling_error_rate_mean')}")
    print(f"Confidence calibration MAE mean: {aggregate.get('confidence_calibration_mae_mean')}")
    print(f"Failure density mean: {aggregate.get('failure_density_mean')}")
    print(f"JSON report: {paths['json']}")
    print(f"Markdown report: {paths['markdown']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
