from __future__ import annotations

import calendar
from datetime import date
from enum import Enum
from typing import Any, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


class OpexMode(str, Enum):
    NNN = "nnn"
    BASE_YEAR = "base_year"


class OneTimeCost(BaseModel):
    """One-time cost at a specific month (tenant POV: positive = cost)."""
    name: str = ""
    amount: float = Field(ge=0.0)
    month: int = Field(ge=0)


class TerminationOption(BaseModel):
    """Optional termination: at given month, fee with probability (expected cost = fee * probability)."""
    month: int = Field(ge=0)
    fee: float = Field(ge=0.0)
    probability: float = Field(ge=0.0, le=1.0)


class RentStep(BaseModel):
    """
    Rent step specified in months from lease commencement.

    - start: starting month index (0-based, inclusive)
    - end: ending month index (0-based, inclusive)
    - rate_psf_yr: annual rent per square foot for this period
    """

    start: int = Field(ge=0, description="Start month index (0-based, inclusive)")
    end: int = Field(ge=0, description="End month index (0-based, inclusive)")
    rate_psf_yr: float = Field(ge=0.0, description="Annual base rent per RSF")

    @field_validator("end")
    @classmethod
    def validate_range(cls, v: int, info):
        start = info.data.get("start")
        if start is not None and v < start:
            raise ValueError("end month must be >= start month")
        return v


class Scenario(BaseModel):
    """
    Core input scenario for a tenant lease analysis.

    All cashflows are modeled monthly from tenant's point of view
    (positive numbers are costs to the tenant).
    """

    name: str
    rsf: float = Field(gt=0, description="Rentable square footage")

    commencement: date
    expiration: date

    rent_steps: List[RentStep]
    free_rent_months: int = Field(ge=0)
    ti_allowance_psf: float = Field(ge=0.0)

    opex_mode: OpexMode
    base_opex_psf_yr: float = Field(
        ge=0.0,
        description="Current annual operating expenses per RSF (used as year 0 level)",
    )
    base_year_opex_psf_yr: float = Field(
        ge=0.0,
        description="Base year opex per RSF for base-year structures",
    )
    opex_growth: float = Field(
        ge=0.0,
        description="Expected annual opex growth rate (e.g. 0.03 for 3%)",
    )

    discount_rate_annual: float = Field(
        ge=0.0, description="Annual discount rate for NPV (as decimal)"
    )

    # Additional tenant economics (defaults keep existing payloads valid)
    parking_spaces: int = Field(ge=0, default=0)
    parking_cost_monthly_per_space: float = Field(ge=0.0, default=0.0)
    one_time_costs: List[OneTimeCost] = Field(default_factory=list)
    broker_fee: float = Field(ge=0.0, default=0.0)
    security_deposit_months: float = Field(ge=0.0, default=0.0)
    holdover_months: int = Field(ge=0, default=0)
    holdover_rent_multiplier: float = Field(ge=0.0, default=1.5)
    sublease_income_monthly: float = Field(ge=0.0, default=0.0)
    sublease_start_month: int = Field(ge=0, default=0)
    sublease_duration_months: int = Field(ge=0, default=0)
    termination_option: Optional[TerminationOption] = None

    @field_validator("free_rent_months", mode="before")
    @classmethod
    def normalize_free_rent_months(cls, v: int | List[int] | None) -> int:
        """Accept int or list[int] (e.g. [1,2,3]); normalize to int (len of list or value)."""
        if v is None:
            return 0
        if isinstance(v, list):
            return max(0, len(v))
        return max(0, int(v))

    @property
    def term_months(self) -> int:
        """
        Compute whole-month term between commencement and expiration.

        We count only fully elapsed calendar months. Any partial month,
        including when commencement and expiration are in the same calendar
        month, is treated as 0 additional months.
        """
        y_diff = self.expiration.year - self.commencement.year
        m_diff = self.expiration.month - self.commencement.month
        months = y_diff * 12 + m_diff
        # If expiration day is before commencement day, the final partial month
        # does not count as a full month.
        if self.expiration.day < self.commencement.day:
            months -= 1
        # Lease abstracts often express terms as full calendar months where
        # commencement is the 1st and expiration is month-end (e.g. 2027-01-01
        # to 2032-12-31 should be 72 months).
        if self.commencement.day == 1:
            month_end = calendar.monthrange(self.expiration.year, self.expiration.month)[1]
            if self.expiration.day == month_end:
                months += 1
        return max(months, 0)

    @field_validator("rent_steps")
    @classmethod
    def validate_rent_steps(cls, steps: List[RentStep], info):
        # Ensure steps cover contiguous ranges starting at 0 without gaps or overlaps.
        if not steps:
            raise ValueError("at least one rent step is required")

        sorted_steps = sorted(steps, key=lambda s: (s.start, s.end))
        expected_start = 0
        for step in sorted_steps:
            if step.start != expected_start:
                raise ValueError("rent steps must be contiguous and start at month 0")
            expected_start = step.end + 1

        scenario: Scenario | None = info.data.get("__root__")  # type: ignore[assignment]
        # If we know the term, ensure the steps cover it (best-effort).
        # This only works when the Scenario is fully constructed; we avoid strict enforcement here.
        return sorted_steps


class RenewalInput(BaseModel):
    """Input for generating a renewal scenario."""
    rent_steps: List[RentStep]
    free_rent_months: int = Field(ge=0)
    ti_allowance_psf: float = Field(ge=0.0)
    opex_mode: OpexMode
    base_opex_psf_yr: float = Field(ge=0.0)
    base_year_opex_psf_yr: float = Field(ge=0.0)
    opex_growth: float = Field(ge=0.0)
    parking_spaces: int = Field(ge=0, default=0)
    parking_cost_monthly_per_space: float = Field(ge=0.0, default=0.0)


class RelocationInput(BaseModel):
    """Input for generating a relocation scenario."""
    rent_steps: List[RentStep]
    free_rent_months: int = Field(ge=0)
    ti_allowance_psf: float = Field(ge=0.0)
    moving_costs_total: float = Field(ge=0.0, default=0.0)
    it_cabling_cost: float = Field(ge=0.0, default=0.0)
    signage_cost: float = Field(ge=0.0, default=0.0)
    ffe_cost: float = Field(ge=0.0, default=0.0)
    legal_cost: float = Field(ge=0.0, default=0.0)
    downtime_months: int = Field(ge=0, default=0)
    overlap_months: int = Field(ge=0, default=0)
    broker_fee: float = Field(ge=0.0, default=0.0)
    parking_spaces: int = Field(ge=0, default=0)
    parking_cost_monthly_per_space: float = Field(ge=0.0, default=0.0)
    # Opex required to build full Scenario (defaults for relocation)
    opex_mode: OpexMode = OpexMode.NNN
    base_opex_psf_yr: float = Field(ge=0.0, default=0.0)
    base_year_opex_psf_yr: float = Field(ge=0.0, default=0.0)
    opex_growth: float = Field(ge=0.0, default=0.0)


class GenerateScenariosRequest(BaseModel):
    """Request to generate renewal and relocation scenarios."""
    rsf: float = Field(gt=0)
    target_term_months: int = Field(gt=0)
    renewal: RenewalInput
    relocation: RelocationInput
    discount_rate_annual: float = Field(ge=0.0, default=0.06)
    commencement: Optional[date] = None  # default: 2026-01-01


class GenerateScenariosResponse(BaseModel):
    """Two scenarios: renewal and relocation."""
    renewal: Scenario
    relocation: Scenario


class ReportBranding(BaseModel):
    """Optional branding for PDF report."""
    client_name: Optional[str] = None
    logo_url: Optional[str] = None
    date: Optional[str] = None
    market: Optional[str] = None
    broker_name: Optional[str] = None


class ReportScenarioEntry(BaseModel):
    """One scenario with its computed result for a report."""
    scenario: dict  # Scenario as JSON (dates as strings)
    result: CashflowResult


class CreateReportRequest(BaseModel):
    """Request body for POST /reports."""
    scenarios: List[ReportScenarioEntry]
    branding: Optional[ReportBranding] = None


class CreateReportResponse(BaseModel):
    """Response from POST /reports."""
    report_id: str


# ---- Scenario extraction (PDF/DOCX -> Scenario with confidence) ----
# ExtractionResponse is defined AFTER Scenario (above).


ExtractionSource = Literal["text", "ocr", "auto_ocr"]


class ExtractionResponse(BaseModel):
    """Response from POST /extract: scenario for user review, field-level confidence, and warnings."""
    scenario: Scenario
    confidence: dict[str, float] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    source: str  # one of: "pdf_text", "ocr", "pdf_text+ocr", "docx"
    text_length: int
    ocr_used: bool = False
    extraction_source: ExtractionSource = "text"


# ---- Lease extraction (AI intake) ----


class ExtractedField(BaseModel):
    """Single extracted field with confidence and citation snippet."""
    value: Optional[Any] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    citation: str = ""


class LeaseExtraction(BaseModel):
    """Strict JSON schema for LLM lease extraction output. All fields have value, confidence, citation."""
    rsf: ExtractedField = Field(default_factory=ExtractedField)
    commencement: ExtractedField = Field(default_factory=ExtractedField)
    expiration: ExtractedField = Field(default_factory=ExtractedField)
    rent_steps_table: ExtractedField = Field(default_factory=ExtractedField)  # value: list of {start, end, rate_psf_yr}
    free_rent: ExtractedField = Field(default_factory=ExtractedField)
    ti_allowance: ExtractedField = Field(default_factory=ExtractedField)
    opex_terms: ExtractedField = Field(default_factory=ExtractedField)
    base_year_language: ExtractedField = Field(default_factory=ExtractedField)
    parking_terms: ExtractedField = Field(default_factory=ExtractedField)
    options: ExtractedField = Field(default_factory=ExtractedField)
    termination_clauses: ExtractedField = Field(default_factory=ExtractedField)


class CashflowResult(BaseModel):
    """
    Aggregated financial outputs for a scenario.
    """

    term_months: int

    rent_nominal: float
    opex_nominal: float
    total_cost_nominal: float

    npv_cost: float
    avg_cost_year: float
    avg_cost_psf_year: float

    # Additional nominal and NPV breakdown
    parking_nominal: float = 0.0
    one_time_nominal: float = 0.0
    broker_fee_nominal: float = 0.0
    deposit_nominal: float = 0.0
    sublease_income_nominal: float = 0.0
    npv_rent: float = 0.0
    npv_opex: float = 0.0
    npv_parking: float = 0.0
    npv_one_time: float = 0.0
    npv_total: float = 0.0


class ReportMeta(BaseModel):
    """Optional metadata for report cover and attribution."""
    proposal_name: Optional[str] = None
    tenant_name: Optional[str] = None
    property_name: Optional[str] = None
    prepared_for: str = "—"
    prepared_by: str = "—"
    report_date: str = ""
    confidential: bool = True


class ReportRequest(BaseModel):
    """Request body for POST /report and POST /report/preview."""
    brand_id: str = "default"
    scenario: Scenario
    meta: Optional[ReportMeta] = None
