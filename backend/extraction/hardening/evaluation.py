from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Any

from .corpus import DOC_FAMILIES, HardeningCase
from .resolver import ResolvedCase, normalize_suite_token


CORE_FIELDS = (
    "commencement_date",
    "expiration_date",
    "term_months",
    "rsf",
    "suite",
    "base_rent_psf",
    "op_ex_psf",
)


@dataclass
class FieldMetrics:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    @property
    def precision(self) -> float:
        denom = self.tp + self.fp
        return (self.tp / denom) if denom else 1.0

    @property
    def recall(self) -> float:
        denom = self.tp + self.fn
        return (self.tp / denom) if denom else 1.0

    @property
    def f1(self) -> float:
        p = self.precision
        r = self.recall
        if p + r == 0:
            return 0.0
        return (2 * p * r) / (p + r)

    @property
    def accuracy(self) -> float:
        denom = self.tp + self.fp + self.fn + self.tn
        return ((self.tp + self.tn) / denom) if denom else 1.0


@dataclass
class FailureDetail:
    case_id: str
    family: str
    field: str
    expected: Any
    actual: Any
    tags: list[str] = field(default_factory=list)


@dataclass
class EvaluationReport:
    total_cases: int
    field_metrics: dict[str, FieldMetrics]
    family_coverage: dict[str, int]
    controlling_term_accuracy: float
    confidence_calibration_mae: float
    failure_clusters: list[dict[str, Any]]
    failures: list[FailureDetail] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_cases": self.total_cases,
            "field_metrics": {
                f: {
                    "tp": m.tp,
                    "fp": m.fp,
                    "fn": m.fn,
                    "tn": m.tn,
                    "precision": round(m.precision, 4),
                    "recall": round(m.recall, 4),
                    "f1": round(m.f1, 4),
                    "accuracy": round(m.accuracy, 4),
                }
                for f, m in self.field_metrics.items()
            },
            "family_coverage": dict(self.family_coverage),
            "controlling_term_accuracy": round(self.controlling_term_accuracy, 4),
            "confidence_calibration_mae": round(self.confidence_calibration_mae, 4),
            "failure_clusters": list(self.failure_clusters),
            "failures": [
                {
                    "case_id": f.case_id,
                    "family": f.family,
                    "field": f.field,
                    "expected": f.expected,
                    "actual": f.actual,
                    "tags": list(f.tags),
                }
                for f in self.failures
            ],
        }


def _parse_date(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m.%d.%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except Exception:
            continue
    return None


def _norm_num(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _eq(field: str, expected: Any, actual: Any) -> bool:
    if expected in (None, "") and actual in (None, ""):
        return True
    if field in {"commencement_date", "expiration_date"}:
        return _parse_date(expected) == _parse_date(actual)
    if field == "suite":
        return normalize_suite_token(expected) == normalize_suite_token(actual)
    if field == "term_months":
        try:
            return int(float(expected)) == int(float(actual))
        except Exception:
            return False
    if field == "rsf":
        e = _norm_num(expected)
        a = _norm_num(actual)
        if e is None or a is None:
            return False
        return abs(e - a) <= 2.0
    if field in {"base_rent_psf", "op_ex_psf"}:
        e = _norm_num(expected)
        a = _norm_num(actual)
        if e is None or a is None:
            return False
        return abs(e - a) <= 0.15
    return str(expected).strip() == str(actual).strip()


def _cluster_failures(failures: list[FailureDetail]) -> list[dict[str, Any]]:
    clusters: dict[tuple[str, str, str], dict[str, Any]] = {}
    for f in failures:
        expected_kind = "missing_expected" if f.expected in (None, "") else "value_expected"
        key = (f.family, f.field, expected_kind)
        bucket = clusters.setdefault(
            key,
            {
                "family": f.family,
                "field": f.field,
                "expected_kind": expected_kind,
                "count": 0,
                "examples": [],
            },
        )
        bucket["count"] += 1
        if len(bucket["examples"]) < 4:
            bucket["examples"].append(
                {
                    "case_id": f.case_id,
                    "expected": f.expected,
                    "actual": f.actual,
                    "tags": list(f.tags),
                }
            )
    ranked = sorted(clusters.values(), key=lambda row: (-int(row["count"]), row["family"], row["field"]))
    return ranked[:30]


def _selected_confidence(resolved: ResolvedCase) -> float:
    solver = (resolved.extraction.get("solver_debug") or {}).get("selected") or {}
    score = float(solver.get("score") or 0.0)
    return max(0.0, min(1.0, score / 3.0))


def evaluate_cases(
    *,
    cases: list[HardeningCase],
    resolved: list[ResolvedCase],
    fields: tuple[str, ...] = CORE_FIELDS,
) -> EvaluationReport:
    by_case = {c.case_id: c for c in cases}
    metrics = {f: FieldMetrics() for f in fields}
    coverage = {family: 0 for family in DOC_FAMILIES}
    failures: list[FailureDetail] = []

    controlling_hits = 0
    controlling_total = 0

    conf_errors: list[float] = []

    for row in resolved:
        case = by_case[row.case_id]
        coverage[case.family] = coverage.get(case.family, 0) + 1

        all_control_ok = True
        control_checks = 0
        control_hits = 0
        for field in case.controlling_fields:
            if field not in fields:
                continue
            controlling_total += 1
            control_checks += 1
            if not _eq(field, case.expected.get(field), row.predicted.get(field)):
                all_control_ok = False
            else:
                controlling_hits += 1
                control_hits += 1

        case_correct = True
        field_checks = 0
        field_hits = 0
        for field in fields:
            exp = case.expected.get(field)
            act = row.predicted.get(field)
            m = metrics[field]
            if exp in (None, "") and act in (None, ""):
                m.tn += 1
                continue
            field_checks += 1
            if exp in (None, "") and act not in (None, ""):
                m.fp += 1
                case_correct = False
                failures.append(FailureDetail(case_id=case.case_id, family=case.family, field=field, expected=exp, actual=act, tags=case.tags))
                continue
            if exp not in (None, "") and act in (None, ""):
                m.fn += 1
                case_correct = False
                failures.append(FailureDetail(case_id=case.case_id, family=case.family, field=field, expected=exp, actual=act, tags=case.tags))
                continue

            if _eq(field, exp, act):
                m.tp += 1
                field_hits += 1
            else:
                m.fp += 1
                m.fn += 1
                case_correct = False
                failures.append(FailureDetail(case_id=case.case_id, family=case.family, field=field, expected=exp, actual=act, tags=case.tags))

        confidence = _selected_confidence(row)
        observed_field = (field_hits / field_checks) if field_checks else 1.0
        observed_control = (control_hits / control_checks) if control_checks else 1.0
        observed = (observed_field * 0.7) + (observed_control * 0.3)
        if case_correct and all_control_ok:
            observed = 1.0
        conf_errors.append(abs(confidence - observed))

    calibration_mae = (sum(conf_errors) / len(conf_errors)) if conf_errors else 0.0
    clusters = _cluster_failures(failures)

    return EvaluationReport(
        total_cases=len(cases),
        field_metrics=metrics,
        family_coverage=coverage,
        controlling_term_accuracy=(controlling_hits / controlling_total) if controlling_total else 1.0,
        confidence_calibration_mae=calibration_mae,
        failure_clusters=clusters,
        failures=failures,
    )


def summarize_top_failure_modes(report: EvaluationReport, *, limit: int = 8) -> list[str]:
    lines: list[str] = []
    for cluster in report.failure_clusters[:limit]:
        lines.append(
            f"{cluster['family']}::{cluster['field']} ({cluster['count']} misses; expected={cluster['expected_kind']})"
        )
    return lines


def report_grade(report: EvaluationReport) -> str:
    core = [report.field_metrics[f].f1 for f in CORE_FIELDS if f in report.field_metrics]
    avg = sum(core) / len(core) if core else 1.0
    controlling = report.controlling_term_accuracy
    calibration = max(0.0, 1.0 - report.confidence_calibration_mae)
    score = (avg * 0.6) + (controlling * 0.3) + (calibration * 0.1)
    if score >= 0.9:
        return "A"
    if score >= 0.8:
        return "B"
    if score >= 0.7:
        return "C"
    if score >= 0.6:
        return "D"
    return "F"


def f1_macro(report: EvaluationReport, fields: tuple[str, ...] = CORE_FIELDS) -> float:
    vals = [report.field_metrics[f].f1 for f in fields if f in report.field_metrics]
    if not vals:
        return 1.0
    return sum(vals) / len(vals)


def coverage_gap_families(report: EvaluationReport) -> list[str]:
    return [fam for fam, count in report.family_coverage.items() if count <= 0]


def failure_density(report: EvaluationReport) -> float:
    denom = max(1, report.total_cases * len(report.field_metrics))
    return len(report.failures) / denom
