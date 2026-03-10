from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from extraction.hardening.corpus import generate_synthetic_corpus


def _case_to_dict(case) -> dict:
    return {
        "case_id": case.case_id,
        "family": case.family,
        "documents": [
            {
                "doc_id": d.doc_id,
                "family": d.family,
                "role": d.role,
                "as_of_date": d.as_of_date,
                "text": d.text,
                "rent_steps": d.rent_steps,
                "metadata": d.metadata,
            }
            for d in case.documents
        ],
        "expected": case.expected,
        "controlling_fields": case.controlling_fields,
        "tags": case.tags,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate synthetic parser hardening corpus + gold truth.")
    parser.add_argument("--count", type=int, default=5000, help="Number of synthetic cases.")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed.")
    parser.add_argument(
        "--out",
        type=str,
        default=str(Path("cache/extraction/parser_hardening/synthetic_corpus.json")),
        help="Output JSON file path.",
    )
    args = parser.parse_args()

    cases = generate_synthetic_corpus(total_cases=max(1, int(args.count)), seed=int(args.seed))
    payload = [_case_to_dict(case) for case in cases]

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload), encoding="utf-8")

    print(f"Generated corpus cases: {len(cases)}")
    print(f"Output: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
