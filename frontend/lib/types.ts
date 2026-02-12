/** Matches backend Scenario / CashflowResult */

export type OpexMode = "nnn" | "base_year";

export interface RentStep {
  start: number;
  end: number;
  rate_psf_yr: number;
}

/** One-time cost item (backend). */
export interface OneTimeCost {
  name: string;
  amount: number;
  month: number;
}

/** Backend Scenario schema (no id). */
export interface ScenarioInput {
  name: string;
  rsf: number;
  commencement: string; // YYYY-MM-DD
  expiration: string;   // YYYY-MM-DD
  rent_steps: RentStep[];
  free_rent_months: number;
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
