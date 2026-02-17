"""
Response models for canonical compute and normalize endpoints.
"""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, Field

from .canonical_lease import CanonicalLease


class MonthlyRow(BaseModel):
    """One month in the cash flow schedule."""
    month_index: int = Field(ge=0)
    date: str = Field(description="YYYY-MM-DD first day of period")
    base_rent: float = 0.0
    opex: float = 0.0
    parking: float = 0.0
    ti_amort: float = 0.0
    concessions: float = 0.0
    total_cost: float = 0.0
    cumulative_cost: float = 0.0
    discounted_value: float = 0.0


class AnnualRow(BaseModel):
    """One year rollup."""
    year_index: int = Field(ge=0)
    year_start_date: str = Field(description="YYYY-MM-DD")
    total_cost: float = 0.0
    avg_cost_psf_year: float = 0.0
    cumulative_cost: float = 0.0
    discounted_value: float = 0.0


class CanonicalMetrics(BaseModel):
    """Summary matrix and broker metrics; labels locked for export."""
    premises_name: str = ""
    address: str = ""
    building_name: str = ""
    suite: str = ""
    floor: str = ""
    rsf: float = 0.0
    lease_type: str = ""
    term_months: int = 0
    commencement_date: str = ""
    expiration_date: str = ""
    base_rent_total: float = 0.0
    base_rent_avg_psf_year: float = 0.0
    opex_total: float = 0.0
    opex_avg_psf_year: float = 0.0
    parking_total: float = 0.0
    parking_avg_psf_year: float = 0.0
    ti_value_total: float = 0.0
    free_rent_value_total: float = 0.0
    total_obligation_nominal: float = 0.0
    npv_cost: float = 0.0
    equalized_avg_cost_psf_year: float = 0.0
    avg_all_in_cost_psf_year: float = 0.0
    discount_rate_annual: float = 0.08
    notes: str = ""


class CanonicalComputeResponse(BaseModel):
    """Response from POST /compute-canonical."""
    normalized_canonical_lease: CanonicalLease
    monthly_rows: List[MonthlyRow] = Field(default_factory=list)
    annual_rows: List[AnnualRow] = Field(default_factory=list)
    metrics: CanonicalMetrics = Field(default_factory=CanonicalMetrics)
    warnings: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)


class NormalizerResponse(BaseModel):
    """Response from POST /normalize when confidence < threshold or missing fields."""
    canonical_lease: CanonicalLease
    confidence_score: float = Field(ge=0.0, le=1.0)
    field_confidence: Dict[str, float] = Field(default_factory=dict)
    missing_fields: List[str] = Field(default_factory=list)
    clarification_questions: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
