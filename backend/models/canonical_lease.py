"""
Canonical Lease Data Model — NON-NEGOTIABLE FOUNDATION.

All inputs (manual, PDF, Word, Excel, pasted text, JSON) must normalize into
this schema before any engine logic runs. No engine may read raw user input.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class LeaseType(str, Enum):
    NNN = "NNN"
    GROSS = "Gross"
    MODIFIED_GROSS = "Modified Gross"
    ABSOLUTE_NNN = "Absolute NNN"
    FULL_SERVICE = "Full Service"


def _coerce_lease_type(value: Any) -> "LeaseType":
    """Coerce casing so nnn/gross/etc never 422. Used by validator and endpoint shim."""
    if value is None:
        return LeaseType.NNN
    if isinstance(value, LeaseType):
        return value
    s = (str(value).strip() or "nnn").lower().replace("-", " ").replace("_", " ")
    if s == "nnn":
        return LeaseType.NNN
    if s == "gross":
        return LeaseType.GROSS
    if s in ("modified gross", "modified_gross"):
        return LeaseType.MODIFIED_GROSS
    if s in ("absolute nnn", "absolute_nnn"):
        return LeaseType.ABSOLUTE_NNN
    if s in ("full service", "full_service", "fs"):
        return LeaseType.FULL_SERVICE
    # Already correct
    for lt in LeaseType:
        if lt.value == value or lt.value.lower() == s:
            return lt
    return LeaseType.NNN


class EscalationType(str, Enum):
    FIXED = "fixed"
    PERCENT = "percent"
    CPI = "cpi"
    CUSTOM = "custom"


class ExpenseStructureType(str, Enum):
    NNN = "nnn"
    GROSS_WITH_STOP = "gross_with_stop"
    BASE_YEAR = "base_year"


# --- Rent schedule (unlimited step-ups) ---


class RentScheduleStep(BaseModel):
    """One step in the base rent schedule."""
    start_month: int = Field(ge=0, description="Start month index (0-based)")
    end_month: int = Field(ge=0, description="End month index (inclusive)")
    rent_psf_annual: float = Field(ge=0.0, description="Annual rent per RSF for this period")
    escalation_type: EscalationType = EscalationType.FIXED
    escalation_value: float = Field(ge=0.0, default=0.0, description="Percent (e.g. 0.03), CPI cap, or custom")

    @field_validator("end_month")
    @classmethod
    def end_ge_start(cls, v: int, info: Any) -> int:
        start = info.data.get("start_month")
        if start is not None and v < start:
            raise ValueError("end_month must be >= start_month")
        return v


class PhaseInStep(BaseModel):
    """One phase-in occupancy step (effective RSF by month range)."""
    start_month: int = Field(ge=0, description="Start month index (0-based)")
    end_month: int = Field(ge=0, description="End month index (inclusive)")
    rsf: float = Field(ge=0.0, description="Effective occupied RSF for this phase")

    @field_validator("end_month")
    @classmethod
    def end_ge_start(cls, v: int, info: Any) -> int:
        start = info.data.get("start_month")
        if start is not None and v < start:
            raise ValueError("end_month must be >= start_month")
        return v


# --- Concessions ---


class FreeRentPeriod(BaseModel):
    """A contiguous period of free rent."""
    start_month: int = Field(ge=0)
    end_month: int = Field(ge=0)

    @field_validator("end_month")
    @classmethod
    def end_ge_start(cls, v: int, info: Any) -> int:
        start = info.data.get("start_month")
        if start is not None and v < start:
            raise ValueError("end_month must be >= start_month")
        return v


class RentAbatement(BaseModel):
    """Rent abatement: month range + percentage (0-100)."""
    start_month: int = Field(ge=0)
    end_month: int = Field(ge=0)
    percent_abated: float = Field(ge=0.0, le=100.0, default=100.0)

    @field_validator("end_month")
    @classmethod
    def end_ge_start(cls, v: int, info: Any) -> int:
        start = info.data.get("start_month")
        if start is not None and v < start:
            raise ValueError("end_month must be >= start_month")
        return v


# --- Renewal / Options ---


class OptionRentStructure(BaseModel):
    """Rent structure for a renewal option (e.g. step-ups or fixed)."""
    steps: List[RentScheduleStep] = Field(default_factory=list)
    escalation_type: EscalationType = EscalationType.FIXED
    escalation_value: float = Field(ge=0.0, default=0.0)


class RenewalOption(BaseModel):
    """One renewal or extension option."""
    option_term_months: int = Field(ge=0)
    option_rent_structure: OptionRentStructure = Field(default_factory=OptionRentStructure)
    option_notes: str = ""


# --- Main canonical lease ---


class CanonicalLease(BaseModel):
    """
    Strict canonical internal lease schema.
    All input methods must convert into this before engine runs.
    """

    # --- Core Lease Info ---
    scenario_id: str = ""
    scenario_name: str = ""
    premises_name: str = ""  # Display label; set from building_name + " Suite " + suite when both exist
    address: str = ""
    building_name: str = ""
    suite: str = ""
    floor: str = ""
    # Allow 0 during low-confidence review flows; frontend enforces user confirmation before compute.
    rsf: float = Field(ge=0.0, description="Rentable square feet")
    lease_type: LeaseType = LeaseType.NNN
    commencement_date: date = Field(description="Lease commencement (YYYY-MM-DD)")
    expiration_date: date = Field(description="Lease expiration (YYYY-MM-DD)")
    term_months: int = Field(ge=0, description="Lease term in months")
    free_rent_months: int = Field(ge=0, default=0)
    discount_rate_annual: float = Field(ge=0.0, le=1.0, default=0.08)
    notes: str = ""

    # --- Base Rent Structure (unlimited step-ups) ---
    rent_schedule: List[RentScheduleStep] = Field(
        default_factory=list,
        description="Rent steps; must cover term from month 0",
    )
    phase_in_schedule: List[PhaseInStep] = Field(
        default_factory=list,
        description="Optional phased RSF occupancy schedule; when present, month-by-month costs use this RSF.",
    )

    # --- Operating Expenses ---
    opex_psf_year_1: float = Field(ge=0.0, default=0.0)
    opex_growth_rate: float = Field(ge=0.0, default=0.0)
    expense_stop_psf: float = Field(ge=0.0, default=0.0)
    base_year: Optional[int] = Field(default=None, ge=1)
    pro_rata_share: float = Field(ge=0.0, le=1.0, default=1.0)
    expense_structure_type: ExpenseStructureType = ExpenseStructureType.NNN

    # --- Parking ---
    parking_ratio: float = Field(ge=0.0, default=0.0, description="Per 1,000 RSF")
    parking_count: int = Field(ge=0, default=0)
    parking_rate_monthly: float = Field(ge=0.0, default=0.0)
    parking_escalation_rate: float = Field(ge=0.0, default=0.0)

    # --- TI + CapEx ---
    ti_allowance_psf: float = Field(ge=0.0, default=0.0)
    ti_total: float = Field(ge=0.0, default=0.0)
    landlord_work_value: float = Field(ge=0.0, default=0.0)
    tenant_capex_total: float = Field(ge=0.0, default=0.0)
    amortized_ti_flag: bool = False
    amortization_rate: float = Field(ge=0.0, default=0.0)
    amortization_term_months: int = Field(ge=0, default=0)

    # --- Concessions ---
    free_rent_periods: List[FreeRentPeriod] = Field(default_factory=list)
    rent_abatements: List[RentAbatement] = Field(default_factory=list)
    moving_allowance: float = Field(ge=0.0, default=0.0)
    other_concessions: List[dict] = Field(default_factory=list)

    # --- Renewal / Options ---
    renewal_options: List[RenewalOption] = Field(default_factory=list)

    @field_validator("lease_type", mode="before")
    @classmethod
    def coerce_lease_type(cls, v: Any) -> LeaseType:
        return _coerce_lease_type(v)

    @model_validator(mode="after")
    def set_premises_name_from_building_and_suite(self) -> "CanonicalLease":
        """Set premises_name from building + suite/floor fallback."""
        bn = (self.building_name or "").strip()
        su = (self.suite or "").strip()
        fl = (self.floor or "").strip()
        updates: dict[str, str] = {}
        if bn and su:
            updates["premises_name"] = f"{bn} Suite {su}"
        elif bn and fl:
            updates["premises_name"] = f"{bn} Floor {fl}"
        if updates:
            return self.model_copy(update=updates)
        return self

    @field_validator("rent_schedule")
    @classmethod
    def validate_rent_schedule_contiguous(cls, steps: List[RentScheduleStep]) -> List[RentScheduleStep]:
        if not steps:
            return steps
        sorted_steps = sorted(steps, key=lambda s: (s.start_month, s.end_month))
        expected = 0
        for s in sorted_steps:
            if s.start_month != expected:
                raise ValueError("rent_schedule must be contiguous starting at month 0")
            expected = s.end_month + 1
        return sorted_steps

    @field_validator("phase_in_schedule")
    @classmethod
    def validate_phase_in_schedule_contiguous(cls, steps: List[PhaseInStep]) -> List[PhaseInStep]:
        if not steps:
            return steps
        sorted_steps = sorted(steps, key=lambda s: (s.start_month, s.end_month))
        expected = 0
        for s in sorted_steps:
            if s.start_month != expected:
                raise ValueError("phase_in_schedule must be contiguous starting at month 0")
            expected = s.end_month + 1
        return sorted_steps

    class Config:
        use_enum_values = True
