# Parser Hardening Framework

This package provides a durable extraction-quality program for CRE documents, covering:

- Synthetic corpus generation across proposals, LOIs, counters, leases, amendments, redlines, flyers, floorplans, abstracts, and sublease docs.
- Multi-document precedence resolution (base lease + amendment/counter/redline stacks).
- Field-level scoring and confidence calibration.
- Failure clustering and coverage reporting by document family.
- Curated regression suite support (gold-labeled real-world style cases).

## Components

- `corpus.py`
  - Generates thousands of document variants with permutations of layout, wording, date/currency formats, and OCR/redline artifacts.
  - Supports stacked-document scenarios with override language.

- `resolver.py`
  - Resolves single and stacked documents.
  - Applies precedence weighting and override-cue boosting to candidate confidence.
  - Produces controlling-term traces from provenance.

- `evaluation.py`
  - Calculates per-field precision/recall/F1/accuracy.
  - Scores controlling-term correctness.
  - Computes confidence calibration MAE.
  - Clusters recurring failures.

- `framework.py`
  - Orchestrates hardening runs and looped iterations.
  - Exports JSON + Markdown reports for trend tracking.

## Run

```bash
cd backend
.venv/bin/python scripts/run_parser_hardening.py --iterations 3 --cases 3000
```

Artifacts are written to `backend/cache/extraction/parser_hardening/`.

## Curated Gold Dataset

Curated cases live at:

- `backend/tests/fixtures/parser_hardening/curated_cases.json`

These are regression anchors for known failure classes (term mis-selection, override precedence, OCR spacing artifacts, rent-schedule conflicts).
They include survey-source families (`flyer`, `floorplan`) to keep those parsing paths protected.
