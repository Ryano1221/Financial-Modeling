from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
import json
from pathlib import Path
import random
from typing import Any

DOC_FAMILIES = (
    "proposal",
    "loi",
    "counter",
    "counterproposal",
    "flyer",
    "floorplan",
    "lease",
    "amendment",
    "redline",
    "abstract",
    "deal_sheet",
    "broker_summary",
    "rent_schedule",
    "sublease_proposal",
    "sublandlord_package",
)

LAYOUT_STYLES = ("narrative", "table_pipe", "legal_clause", "broker_bullets", "short_form")
NOISE_PROFILES = ("none", "ocr_light", "ocr_medium", "spacing", "duplicate_headers", "reordered")

FIELD_SYNONYMS = {
    "property_name": ["Property", "Building", "Project", "Asset", "Location"],
    "building_address": ["Address", "Property Address", "Premises Address", "Site Address"],
    "premises": ["Premises", "Suite", "Demised Premises", "Contraction Premises", "Space"],
    "rsf": ["RSF", "Rentable Square Feet", "Rentable Area", "Premises Size"],
    "commencement_date": ["Commencement Date", "Lease Commencement", "Term Start", "Rental Commencement"],
    "expiration_date": ["Expiration Date", "Lease Expiration", "Term End", "Lease Through"],
    "term_months": ["Lease Term", "Term", "Initial Term", "Term Length"],
    "base_rent_psf": ["Base Rent", "Annual Rent", "Rental Rate", "Minimum Rent", "Fixed Rent"],
    "escalation_pct": ["Annual Escalation", "Escalation", "Annual Increase", "Rent Increase"],
    "op_ex_psf": ["Operating Expenses", "OpEx", "CAM", "Additional Rent", "NNN"],
    "op_ex_escalation_pct": ["OpEx Escalation", "CAM Increase", "Expense Growth", "Operating Expense Increase"],
    "free_rent_months": ["Free Rent", "Abatement", "Concession", "Rent Holiday"],
    "ti_allowance_psf": ["TI Allowance", "Improvement Allowance", "Buildout Allowance", "Turnkey Allowance"],
    "parking_spaces": ["Parking Spaces", "Reserved Spaces", "Allotted Spaces"],
    "parking_rate_month": ["Parking Rate", "Parking Charge", "Parking Cost/Spot/Month"],
    "security_deposit_months": ["Security Deposit", "Deposit", "Letter of Credit"],
    "tenant_name": ["Tenant", "Occupant", "Applicant", "Prospect"],
    "subtenant_name": ["Subtenant", "Proposed Subtenant", "Sublessee", "Prospective Subtenant"],
}


@dataclass(frozen=True)
class SyntheticDocument:
    doc_id: str
    family: str
    role: str
    text: str
    as_of_date: str | None
    rent_steps: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class HardeningCase:
    case_id: str
    family: str
    documents: list[SyntheticDocument]
    expected: dict[str, Any]
    controlling_fields: list[str]
    tags: list[str] = field(default_factory=list)


def _fmt_date(d: date, style: str) -> str:
    if style == "iso":
        return d.isoformat()
    if style == "slash":
        return d.strftime("%m/%d/%Y")
    if style == "dot":
        return d.strftime("%m.%d.%Y")
    if style == "month":
        return d.strftime("%B %d, %Y")
    return d.strftime("%m-%d-%Y")


def _fmt_money(v: float, style: str) -> str:
    if style == "tight":
        return f"${v:,.0f}"
    if style == "cents":
        return f"${v:,.2f}"
    if style == "plain":
        return f"{v:,.2f}"
    return f"$ {v:,.2f}"


def _fmt_pct(v: float, style: str) -> str:
    if style == "word":
        words = {
            2.0: "two percent",
            2.5: "two and one-half percent",
            3.0: "three percent",
            3.5: "three and one-half percent",
            4.0: "four percent",
        }
        key = round(v, 1)
        return words.get(key, f"{v:.2f} percent")
    if style == "tight":
        return f"{v:.2f}%"
    return f"{v:.2f} %"


def _expiration_from_term(commencement: date, term_months: int) -> date:
    tm = max(1, int(term_months))
    total = (commencement.month - 1) + tm
    year = commencement.year + (total // 12)
    month = (total % 12) + 1
    anniv = date(year, month, min(commencement.day, 28))
    return anniv - timedelta(days=1)


def _annual_steps(term_months: int, base_rent_psf: float, escalation_pct: float) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    idx = 0
    year = 0
    while idx < term_months:
        end = min(term_months - 1, idx + 11)
        rate = round(base_rent_psf * ((1.0 + (escalation_pct / 100.0)) ** year), 2)
        steps.append({"start_month": idx, "end_month": end, "rate_psf_annual": rate})
        idx += 12
        year += 1
    return steps


def _random_truth(rng: random.Random, family: str, index: int) -> dict[str, Any]:
    base_date = date(2025 + (index % 6), rng.randint(1, 12), 1)
    term = rng.randint(24, 132)
    exp = _expiration_from_term(base_date, term)
    rsf = float(rng.randint(3000, 150000))
    base_rent = round(rng.uniform(22.0, 68.0), 2)
    escal = rng.choice([2.5, 2.75, 3.0, 3.25, 3.5, 4.0])
    opex = round(rng.uniform(8.5, 38.0), 2)
    opex_escal = rng.choice([2.0, 2.5, 3.0, 3.5, 4.0])
    free_rent = rng.randint(0, 10)
    ti = round(rng.uniform(0.0, 120.0), 2)
    spaces = rng.randint(0, max(1, int(rsf / 9000)))
    parking_rate = round(rng.uniform(85.0, 350.0), 2)
    suite = f"Suite {rng.choice(["120", "450", "950", "1550", "26-28", "100,200,300"])}"

    property_name = rng.choice([
        "IBC Bank Plaza",
        "ATX Tower",
        "Lamar Central",
        "Eastlake Logistics Center",
        "Domain Place",
        "Aspen Lake Three",
        "400 W 6th Street",
    ])
    address = rng.choice([
        "321 W 6th St, Austin, TX",
        "400 W 6th St, Austin, TX",
        "6231 E Stassney Ln, Austin, TX",
        "900 Congress Ave, Austin, TX",
        "9600 N Mopac Expy, Austin, TX",
    ])

    tenant = rng.choice([
        "Prologis, Inc.",
        "Meta Platforms, Inc.",
        "Rand Construction, LLC",
        "Confidential Tech Tenant",
        "SWI Group",
    ])
    subtenant = rng.choice([
        "Confidential Tech Tenant",
        "Project Northstar",
        "Meta Platforms, Inc.",
        "IBC Operations",
    ])

    lease_type = rng.choice(["NNN", "Modified Gross", "Base Year", "Full Service"])

    return {
        "property_name": property_name,
        "building_address": address,
        "tenant_name": tenant,
        "subtenant_name": subtenant if family in {"sublease_proposal", "sublandlord_package"} else None,
        "premises": suite,
        "rsf": rsf,
        "commencement_date": base_date.isoformat(),
        "expiration_date": exp.isoformat(),
        "term_months": term,
        "base_rent_psf": base_rent,
        "escalation_pct": escal,
        "op_ex_psf": opex,
        "op_ex_escalation_pct": opex_escal,
        "free_rent_months": free_rent,
        "ti_allowance_psf": ti,
        "parking_spaces": spaces,
        "parking_rate_month": parking_rate,
        "security_deposit_months": rng.choice([0, 1, 2, 3, 6]),
        "lease_type": lease_type,
        "rent_steps": _annual_steps(term, base_rent, escal),
    }


def _pick_label(rng: random.Random, field: str) -> str:
    return rng.choice(FIELD_SYNONYMS[field])


def _render_doc_text(
    *,
    truth: dict[str, Any],
    family: str,
    style: str,
    noise: str,
    rng: random.Random,
    include_override: bool = False,
) -> str:
    date_style = rng.choice(["slash", "dot", "month", "dash", "iso"])
    pct_style = rng.choice(["tight", "spaced", "word"])
    money_style = rng.choice(["tight", "cents", "spaced"])

    comm = date.fromisoformat(str(truth["commencement_date"]))
    exp = date.fromisoformat(str(truth["expiration_date"]))

    rows = [
        (_pick_label(rng, "property_name"), truth["property_name"]),
        (_pick_label(rng, "building_address"), truth["building_address"]),
        (_pick_label(rng, "premises"), truth["premises"]),
        (_pick_label(rng, "rsf"), f"{int(truth['rsf']):,} RSF"),
        (_pick_label(rng, "commencement_date"), _fmt_date(comm, date_style)),
        (_pick_label(rng, "expiration_date"), _fmt_date(exp, date_style)),
        (_pick_label(rng, "term_months"), f"{int(truth['term_months'])} months"),
        (_pick_label(rng, "base_rent_psf"), f"{_fmt_money(float(truth['base_rent_psf']), money_style)} / SF / YR"),
        (_pick_label(rng, "escalation_pct"), _fmt_pct(float(truth["escalation_pct"]), pct_style)),
        (_pick_label(rng, "op_ex_psf"), f"{_fmt_money(float(truth['op_ex_psf']), money_style)} / SF"),
        (_pick_label(rng, "op_ex_escalation_pct"), _fmt_pct(float(truth["op_ex_escalation_pct"]), pct_style)),
        (_pick_label(rng, "free_rent_months"), f"{int(truth['free_rent_months'])} months"),
        (_pick_label(rng, "ti_allowance_psf"), f"{_fmt_money(float(truth['ti_allowance_psf']), money_style)} per RSF"),
        (_pick_label(rng, "parking_spaces"), str(int(truth["parking_spaces"]))),
        (_pick_label(rng, "parking_rate_month"), f"{_fmt_money(float(truth['parking_rate_month']), money_style)} per space per month"),
        (_pick_label(rng, "security_deposit_months"), f"{int(truth['security_deposit_months'])} months of Base Rent"),
        ("Lease Type", str(truth["lease_type"])),
        (_pick_label(rng, "tenant_name"), truth["tenant_name"]),
    ]
    if truth.get("subtenant_name"):
        rows.append((_pick_label(rng, "subtenant_name"), truth["subtenant_name"]))

    heading = f"{family.replace('_', ' ').title()} Summary"
    if family == "flyer":
        heading = "Marketing Flyer"
    elif family == "floorplan":
        heading = "Floor Plan / Stacking Plan"

    if style == "table_pipe":
        body = "\n".join(f"{k} | {v}" for k, v in rows)
    elif style == "broker_bullets":
        body = "\n".join(f"- {k}: {v}" for k, v in rows)
    elif style == "short_form":
        body = "\n".join(f"{k}: {v}" for k, v in rows[:9]) + "\n" + " ".join(f"{k}={v};" for k, v in rows[9:])
    elif style == "legal_clause":
        body = (
            f"THIS {family.upper()} sets forth economics for {truth['property_name']}.\n"
            + "\n".join(f"Section {i+1}. {k} shall be {v}." for i, (k, v) in enumerate(rows))
        )
    else:
        body = (
            f"{heading}\n"
            f"For the premises at {truth['property_name']}, the parties agree to the following business points.\n"
            + "\n".join(f"{k}: {v}" for k, v in rows)
        )

    schedule_lines = []
    for i, step in enumerate(truth.get("rent_steps") or []):
        start = int(step["start_month"]) + 1
        end = int(step["end_month"]) + 1
        rate = float(step["rate_psf_annual"])
        schedule_lines.append(f"Lease Year {i+1}: Months {start}-{end} at ${rate:.2f}/SF.")
    schedule_block = "\n".join(schedule_lines[: min(8, len(schedule_lines))])

    override = ""
    if include_override:
        old_term = max(12, int(truth["term_months"]) - 12)
        override = (
            "\nNotwithstanding anything to the contrary, Section Term is hereby amended and replaced.\n"
            f"Prior text (stricken): ~~Lease Term: {old_term} months~~\n"
            f"Controlling replacement: Lease Term: {int(truth['term_months'])} months.\n"
        )

    text = f"{body}\n\nRENT SCHEDULE\n{schedule_block}{override}\n"

    if noise == "ocr_light":
        text = text.replace("Lease", "Lea5e", 1).replace("Operating", "0perating", 1)
    elif noise == "ocr_medium":
        text = text.replace("month", "m0nth").replace("Base", "8ase", 1)
        text = text.replace("/", " / ")
    elif noise == "spacing":
        text = text.replace("Commencement", "C o m m e n c e m e n t")
        text = text.replace("Expiration", "E x p i r a t i o n")
    elif noise == "duplicate_headers":
        text = (
            "CONFIDENTIAL DRAFT\nPage 1 of 7\n"
            "TERM SHEET\nTERM SHEET\n"
            + text
            + "\nPage 2 of 7\nCONFIDENTIAL"
        )
    elif noise == "reordered":
        parts = text.split("\n")
        head = parts[:8]
        tail = parts[8:]
        rng.shuffle(tail)
        text = "\n".join(head + tail)

    return text


def _make_single_case(rng: random.Random, family: str, idx: int) -> HardeningCase:
    truth = _random_truth(rng, family, idx)
    style = rng.choice(LAYOUT_STYLES)
    noise = rng.choice(NOISE_PROFILES)
    text = _render_doc_text(truth=truth, family=family, style=style, noise=noise, rng=rng)
    doc = SyntheticDocument(
        doc_id=f"{family}-{idx}-v1",
        family=family,
        role="primary",
        text=text,
        as_of_date=truth["commencement_date"],
        rent_steps=list(truth.get("rent_steps") or []),
        metadata={"layout": style, "noise": noise},
    )
    expected = {
        "commencement_date": truth["commencement_date"],
        "expiration_date": truth["expiration_date"],
        "term_months": int(truth["term_months"]),
        "rsf": float(truth["rsf"]),
        "suite": str(truth["premises"]).replace("Suite", "").strip(),
        "base_rent_psf": float(truth["base_rent_psf"]),
        "op_ex_psf": float(truth["op_ex_psf"]),
    }
    return HardeningCase(
        case_id=f"single-{family}-{idx}",
        family=family,
        documents=[doc],
        expected=expected,
        controlling_fields=["commencement_date", "expiration_date", "term_months", "rsf", "base_rent_psf"],
        tags=["synthetic", "single", style, noise],
    )


def _make_stack_case(rng: random.Random, family: str, idx: int) -> HardeningCase:
    base = _random_truth(rng, family, idx)
    override = dict(base)
    override["term_months"] = max(24, int(base["term_months"]) + rng.choice([-18, -12, 12, 18]))
    comm = date.fromisoformat(str(base["commencement_date"]))
    override["expiration_date"] = _expiration_from_term(comm, int(override["term_months"])).isoformat()
    override["base_rent_psf"] = round(float(base["base_rent_psf"]) + rng.choice([-3.5, -2.0, 2.0, 4.0]), 2)
    override["rent_steps"] = _annual_steps(int(override["term_months"]), float(override["base_rent_psf"]), float(base["escalation_pct"]))

    base_doc = SyntheticDocument(
        doc_id=f"{family}-{idx}-lease-v1",
        family="lease",
        role="base_lease",
        text=_render_doc_text(truth=base, family="lease", style=rng.choice(LAYOUT_STYLES), noise=rng.choice(NOISE_PROFILES), rng=rng),
        as_of_date=base["commencement_date"],
        rent_steps=list(base["rent_steps"]),
        metadata={"stack_position": 1},
    )
    amend_family = rng.choice(["amendment", "counter", "counterproposal", "redline", "sublease_proposal"])
    amend_doc = SyntheticDocument(
        doc_id=f"{family}-{idx}-{amend_family}-v2",
        family=amend_family,
        role="override",
        text=_render_doc_text(
            truth=override,
            family=amend_family,
            style=rng.choice(LAYOUT_STYLES),
            noise=rng.choice(NOISE_PROFILES),
            rng=rng,
            include_override=True,
        ),
        as_of_date=override["commencement_date"],
        rent_steps=list(override["rent_steps"]),
        metadata={"stack_position": 2, "overrides": ["term", "expiration", "base_rent"]},
    )

    expected = {
        "commencement_date": override["commencement_date"],
        "expiration_date": override["expiration_date"],
        "term_months": int(override["term_months"]),
        "rsf": float(override["rsf"]),
        "base_rent_psf": float(override["base_rent_psf"]),
    }

    return HardeningCase(
        case_id=f"stack-{family}-{idx}",
        family=family,
        documents=[base_doc, amend_doc],
        expected=expected,
        controlling_fields=["term_months", "expiration_date", "base_rent_psf"],
        tags=["synthetic", "stack", amend_family],
    )


def generate_synthetic_corpus(
    *,
    total_cases: int = 5000,
    seed: int = 42,
    include_stack_ratio: float = 0.38,
) -> list[HardeningCase]:
    rng = random.Random(seed)
    cases: list[HardeningCase] = []
    families = list(DOC_FAMILIES)
    if total_cases <= 0:
        return []

    for idx in range(total_cases):
        family = families[idx % len(families)]
        if rng.random() < include_stack_ratio:
            cases.append(_make_stack_case(rng, family, idx))
        else:
            cases.append(_make_single_case(rng, family, idx))

    return cases


def load_curated_corpus(json_path: str | Path) -> list[HardeningCase]:
    payload = json.loads(Path(json_path).read_text(encoding="utf-8"))
    out: list[HardeningCase] = []
    for item in payload:
        docs = [
            SyntheticDocument(
                doc_id=str(d.get("doc_id") or "doc"),
                family=str(d.get("family") or "proposal"),
                role=str(d.get("role") or "primary"),
                text=str(d.get("text") or ""),
                as_of_date=d.get("as_of_date"),
                rent_steps=list(d.get("rent_steps") or []),
                metadata=dict(d.get("metadata") or {}),
            )
            for d in list(item.get("documents") or [])
        ]
        out.append(
            HardeningCase(
                case_id=str(item.get("case_id") or "case"),
                family=str(item.get("family") or "proposal"),
                documents=docs,
                expected=dict(item.get("expected") or {}),
                controlling_fields=list(item.get("controlling_fields") or []),
                tags=list(item.get("tags") or []),
            )
        )
    return out


def family_coverage(cases: list[HardeningCase]) -> dict[str, int]:
    counts: dict[str, int] = {family: 0 for family in DOC_FAMILIES}
    for case in cases:
        counts[case.family] = counts.get(case.family, 0) + 1
    return counts
