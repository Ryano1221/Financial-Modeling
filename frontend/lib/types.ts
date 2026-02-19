/** Matches backend Scenario / CashflowResult */

export type OpexMode = "nnn" | "base_year";

export interface RentStep {
  start: number;
  end: number;
  rate_psf_yr: number;
}

export interface PhaseInStep {
  start_month: number;
  end_month: number;
  rsf: number;
}

export type FreeRentAbatementType = "base" | "gross";

/** One-time cost item (backend). */
export interface OneTimeCost {
  name: string;
  amount: number;
  month: number;
}

/** Backend Scenario schema (no id). */
export interface ScenarioInput {
  name: string;
  document_type_detected?: string;
  building_name?: string;
  suite?: string;
  floor?: string;
  address?: string;
  notes?: string;
  rsf: number;
  commencement: string; // YYYY-MM-DD
  expiration: string;   // YYYY-MM-DD
  rent_steps: RentStep[];
  phase_in_steps?: PhaseInStep[];
  free_rent_months: number;
  free_rent_start_month?: number; // 0-based
  free_rent_end_month?: number; // 0-based, inclusive
  free_rent_abatement_type?: FreeRentAbatementType;
  ti_allowance_psf: number;
  opex_mode: OpexMode;
  base_opex_psf_yr: number;
  base_year_opex_psf_yr: number;
  opex_growth: number;
  discount_rate_annual: number;
  parking_spaces?: number;
  parking_cost_monthly_per_space?: number;
  one_time_costs?: OneTimeCost[];
  broker_fee?: number;
  security_deposit_months?: number;
  holdover_months?: number;
  holdover_rent_multiplier?: number;
  sublease_income_monthly?: number;
  sublease_start_month?: number;
  sublease_duration_months?: number;
}

/** Alias for API payload (same as ScenarioInput). */
export type Scenario = ScenarioInput;

export interface ScenarioWithId extends ScenarioInput {
  id: string;
}

/** Request for POST /generate_scenarios */
export interface RenewalInput {
  rent_steps: RentStep[];
  free_rent_months: number;
  ti_allowance_psf: number;
  opex_mode: OpexMode;
  base_opex_psf_yr: number;
  base_year_opex_psf_yr: number;
  opex_growth: number;
  parking_spaces?: number;
  parking_cost_monthly_per_space?: number;
}

export interface RelocationInput {
  rent_steps: RentStep[];
  free_rent_months: number;
  ti_allowance_psf: number;
  moving_costs_total?: number;
  it_cabling_cost?: number;
  signage_cost?: number;
  ffe_cost?: number;
  legal_cost?: number;
  downtime_months?: number;
  overlap_months?: number;
  broker_fee?: number;
  parking_spaces?: number;
  parking_cost_monthly_per_space?: number;
  opex_mode?: OpexMode;
  base_opex_psf_yr?: number;
  base_year_opex_psf_yr?: number;
  opex_growth?: number;
}

export interface GenerateScenariosRequest {
  rsf: number;
  target_term_months: number;
  renewal: RenewalInput;
  relocation: RelocationInput;
  discount_rate_annual?: number;
  commencement?: string;
}

export interface GenerateScenariosResponse {
  renewal: ScenarioInput;
  relocation: ScenarioInput;
}

export interface CashflowResult {
  term_months: number;
  rent_nominal: number;
  opex_nominal: number;
  total_cost_nominal: number;
  npv_cost: number;
  avg_cost_year: number;
  avg_cost_psf_year: number;
}

/** Report branding for PDF deck */
export interface ReportBranding {
  client_name?: string;
  logo_url?: string;
  date?: string;
  market?: string;
  submarket?: string;
  broker_name?: string;
}

/** Brand config for white-label report (GET /brands item). */
export interface BrandConfig {
  brand_id: string;
  company_name: string;
  logo_url?: string | null;
  primary_color: string;
  secondary_color: string;
  font_family: string;
  header_text?: string | null;
  footer_text?: string | null;
  disclaimer_text: string;
  cover_page_enabled: boolean;
  watermark_text?: string | null;
  default_assumptions?: Record<string, unknown>;
  support_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  report_title_override?: string | null;
  executive_summary_template?: string | null;
  include_confidence_section?: boolean;
  include_methodology_section?: boolean;
  page_margin_mm?: number;
  table_density?: "compact" | "standard" | "spacious";
}

/** Optional metadata for report cover (POST /report). */
export interface ReportMeta {
  proposal_name?: string;
  tenant_name?: string;
  property_name?: string;
  prepared_for?: string;
  prepared_by?: string;
  report_date?: string;
  market?: string;
  submarket?: string;
  confidential?: boolean;
}

/** Request body for POST /report and POST /report/preview. */
export interface ReportRequest {
  brand_id: string;
  scenario: ScenarioInput;
  meta?: ReportMeta;
}

/** Stored report payload (GET /reports/{id}) */
export interface ReportData {
  scenarios: { scenario: ScenarioInput; result: CashflowResult }[];
  branding: ReportBranding;
}

/** How extraction was produced: text-only, forced OCR, or auto-triggered OCR */
export type ExtractionSource = "text" | "ocr" | "auto_ocr";

/** Response from POST /extract (PDF/DOCX extraction) */
export interface ExtractionResponse {
  scenario: ScenarioInput;
  confidence: Record<string, number>;
  warnings: string[];
  source: "pdf_text" | "ocr" | "pdf_text+ocr" | "docx";
  text_length: number;
  /** Present when backend supports auto OCR (default false for old responses). */
  ocr_used?: boolean;
  /** Present when backend supports auto OCR (default "text"). */
  extraction_source?: ExtractionSource;
}

/** Per-field extraction from AI (value, confidence, citation). */
export interface ExtractedField<T = unknown> {
  value: T | null;
  confidence: number;
  citation: string;
}

/** Lease extraction schema from POST /upload_lease. */
export interface LeaseExtraction {
  rsf: ExtractedField<number>;
  commencement: ExtractedField<string>;
  expiration: ExtractedField<string>;
  rent_steps_table: ExtractedField<RentStep[]>;
  free_rent: ExtractedField<number>;
  ti_allowance: ExtractedField<number>;
  opex_terms: ExtractedField<string>;
  base_year_language: ExtractedField<string>;
  parking_terms: ExtractedField<string>;
  options: ExtractedField<string>;
  termination_clauses: ExtractedField<string>;
}

/** Backend canonical lease (POST /normalize, POST /compute-canonical). Single source of truth. */
export interface BackendRentScheduleStep {
  start_month: number;
  end_month: number;
  rent_psf_annual: number;
}

export interface BackendPhaseInStep {
  start_month: number;
  end_month: number;
  rsf: number;
}

export interface BackendCanonicalLease {
  scenario_id?: string;
  scenario_name?: string;
  premises_name?: string;
  address?: string;
  building_name?: string;
  suite?: string;
  floor?: string;
  rsf: number;
  lease_type?: string;
  commencement_date: string;
  expiration_date: string;
  term_months: number;
  free_rent_months: number;
  free_rent_scope?: FreeRentAbatementType;
  free_rent_periods?: Array<{ start_month: number; end_month: number }>;
  discount_rate_annual: number;
  rent_schedule: BackendRentScheduleStep[];
  phase_in_schedule?: BackendPhaseInStep[];
  opex_psf_year_1?: number;
  opex_by_calendar_year?: Record<string, number>;
  opex_growth_rate?: number;
  expense_stop_psf?: number;
  expense_structure_type?: string;
  parking_count?: number;
  parking_rate_monthly?: number;
  ti_allowance_psf?: number;
  notes?: string;
  document_type_detected?: string;
  [key: string]: unknown;
}

export interface ExtractionSummary {
  document_type_detected: string;
  key_terms_found: string[];
  key_terms_missing: string[];
  sections_searched: string[];
}

/** Response from POST /normalize. Enforce Review when confidence_score < 0.85 or missing_fields.length > 0. */
export interface NormalizerResponse {
  canonical_lease: BackendCanonicalLease;
  confidence_score: number;
  field_confidence: Record<string, number>;
  missing_fields: string[];
  clarification_questions: string[];
  warnings: string[];
  extraction_summary?: ExtractionSummary;
}

/** One month from POST /compute-canonical monthly_rows. */
export interface CanonicalMonthlyRow {
  month_index: number;
  date: string;
  base_rent: number;
  opex: number;
  parking: number;
  ti_amort: number;
  concessions: number;
  total_cost: number;
  cumulative_cost: number;
  discounted_value: number;
}

/** One year from POST /compute-canonical annual_rows. */
export interface CanonicalAnnualRow {
  year_index: number;
  year_start_date: string;
  total_cost: number;
  avg_cost_psf_year: number;
  cumulative_cost: number;
  discounted_value: number;
}

/** Metrics from POST /compute-canonical (Summary Matrix + Broker Metrics). */
export interface CanonicalMetrics {
  premises_name: string;
  address?: string;
  building_name?: string;
  suite?: string;
  floor?: string;
  rsf: number;
  lease_type: string;
  term_months: number;
  commencement_date: string;
  expiration_date: string;
  base_rent_total: number;
  base_rent_avg_psf_year: number;
  opex_total: number;
  opex_avg_psf_year: number;
  parking_total: number;
  parking_avg_psf_year: number;
  ti_value_total: number;
  free_rent_value_total: number;
  total_obligation_nominal: number;
  npv_cost: number;
  equalized_avg_cost_psf_year: number;
  avg_all_in_cost_psf_year: number;
  discount_rate_annual: number;
  notes: string;
}

/** Response from POST /compute-canonical. */
export interface CanonicalComputeResponse {
  normalized_canonical_lease: BackendCanonicalLease;
  monthly_rows: CanonicalMonthlyRow[];
  annual_rows: CanonicalAnnualRow[];
  metrics: CanonicalMetrics;
  warnings: string[];
  assumptions: string[];
}
