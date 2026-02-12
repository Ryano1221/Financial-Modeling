"""
Store and retrieve report JSON files on disk.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

REPORTS_DIR = Path(__file__).resolve().parent / "reports"


def ensure_reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def save_report(data: dict) -> str:
    report_id = str(uuid.uuid4())
    ensure_reports_dir()
    path = REPORTS_DIR / f"{report_id}.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return report_id


def load_report(report_id: str) -> dict | None:
    path = REPORTS_DIR / f"{report_id}.json"
    if not path.is_file():
        return None
    with open(path) as f:
        return json.load(f)
