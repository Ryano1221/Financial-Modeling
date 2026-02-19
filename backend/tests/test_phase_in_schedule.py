from datetime import date

from backend.engine.canonical_compute import compute_canonical
from backend.main import _extract_phase_in_schedule
from backend.models import CanonicalLease, PhaseInStep, RentScheduleStep


def test_extract_phase_in_schedule_from_text_rows() -> None:
    text = """
    Phase-In: Tenant shall pay Base Rent and Operating Expenses based on the following RSF.
    Months 1 – 12 | 3,300 RSF
    Months 13 – 24 | 4,600 RSF
    Months 25 – 48 | 5,900 RSF (Entire Premises)
    """
    steps = _extract_phase_in_schedule(text, term_months_hint=48)
    assert steps == [
        {"start_month": 0, "end_month": 11, "rsf": 3300.0},
        {"start_month": 12, "end_month": 23, "rsf": 4600.0},
        {"start_month": 24, "end_month": 47, "rsf": 5900.0},
    ]


def test_extract_phase_in_schedule_from_phase_blocks() -> None:
    text = """
    Term: 84 Months
    Phase I – Initial Occupancy (Months 1–18)
    12,500 RSF
    Base Rent: $48.00/RSF NNN
    Phase II – Expansion Premises (Month 19)
    Additional 8,500 RSF contiguous space
    Total Premises after expansion: 21,000 RSF
    Phase III – Optional Future Expansion (Months 24–48)
    Additional 10,000 RSF
    Total Premises after expansion: 31,000 RSF
    """
    steps = _extract_phase_in_schedule(text, term_months_hint=84)
    assert steps == [
        {"start_month": 0, "end_month": 17, "rsf": 12500.0},
        {"start_month": 18, "end_month": 22, "rsf": 21000.0},
        {"start_month": 23, "end_month": 83, "rsf": 31000.0},
    ]


def test_extract_phase_in_schedule_from_ocrish_phase_lines() -> None:
    text = """
    PHASE I - INITIAL OCCUPANCY MONTHS 1-18
    12,500 RSF
    BASE RENT 48.00/RSF
    PHASE II - EXPANSION PREMISES MONTH 19
    ADDITIONAL 8,500 RSF
    TOTAL PREMISES AFTER EXPANSION 21,000 RSF
    PHASE III - OPTIONAL FUTURE EXPANSION MONTHS 24-48
    ADDITIONAL 10,000 RSF
    TOTAL PREMISES AFTER EXPANSION 31,000 RSF
    PHASE I: 300,000 LETTER OF CREDIT
    """
    steps = _extract_phase_in_schedule(text, term_months_hint=84)
    assert steps == [
        {"start_month": 0, "end_month": 17, "rsf": 12500.0},
        {"start_month": 18, "end_month": 22, "rsf": 21000.0},
        {"start_month": 23, "end_month": 83, "rsf": 31000.0},
    ]


def test_compute_canonical_applies_phase_in_rsf_to_monthly_costs() -> None:
    lease = CanonicalLease(
        scenario_id="phase-1",
        scenario_name="Eastlake Phase In",
        premises_name="Eastlake Suite 1100",
        building_name="Eastlake",
        suite="1100",
        rsf=5900,
        commencement_date=date(2026, 1, 1),
        expiration_date=date(2029, 12, 31),
        term_months=48,
        free_rent_months=4,
        rent_schedule=[RentScheduleStep(start_month=0, end_month=47, rent_psf_annual=38)],
        phase_in_schedule=[
            PhaseInStep(start_month=0, end_month=11, rsf=3300),
            PhaseInStep(start_month=12, end_month=23, rsf=4600),
            PhaseInStep(start_month=24, end_month=47, rsf=5900),
        ],
        opex_psf_year_1=22.0,
        opex_growth_rate=0.0,
        expense_structure_type="nnn",
        discount_rate_annual=0.08,
    )

    out = compute_canonical(lease)
    assert len(out.monthly_rows) == 48

    # Month 1 (index 0) rent is abated.
    assert out.monthly_rows[0].base_rent == 0

    # Month 5 (index 4): post-abatement at 3,300 RSF.
    assert round(out.monthly_rows[4].base_rent, 2) == round((38.0 / 12.0) * 3300.0, 2)

    # Month 13 (index 12): phase 2 uses 4,600 RSF.
    assert round(out.monthly_rows[12].base_rent, 2) == round((38.0 / 12.0) * 4600.0, 2)

    # Month 25 (index 24): phase 3 uses 5,900 RSF.
    assert round(out.monthly_rows[24].base_rent, 2) == round((38.0 / 12.0) * 5900.0, 2)

    # Opex also scales by phase-in RSF.
    assert round(out.monthly_rows[24].opex, 2) == round((22.0 / 12.0) * 5900.0, 2)

    # Total base rent should reflect phased occupancy, not full-term 5,900 RSF.
    assert round(out.metrics.base_rent_total, 2) == 706800.0
    assert any("Phase-in RSF schedule applied" in a for a in out.assumptions)
