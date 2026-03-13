import type { LeaseType } from "@/lib/lease-engine/canonical-schema";

export type RentInputType = "annual_psf" | "monthly_amount";
export type EscalationType = "percent" | "dollar";
export type AbatementType = "base" | "gross" | "custom";

export interface RateStep {
  startMonth: number;
  endMonth: number;
  annualRatePsf: number;
}

export interface AbatementWindow {
  startMonth: number;
  endMonth: number;
  type: "base" | "gross";
}

export interface PhaseInEvent {
  id: string;
  startDate: string; // YYYY-MM-DD
  rsfIncrease: number;
}

export type SubleaseScenarioSourceType = "manual" | "proposal_import";

export interface ImportedProposalFieldReview {
  key: string;
  label: string;
  value: string | number;
  confidence: number | null;
  sourceSnippet?: string;
  sourcePage?: number | null;
  needsReview: boolean;
  accepted: boolean;
}

export interface ImportedProposalMeta {
  parserConfidence: number;
  reviewTasks: Array<{
    fieldPath: string;
    severity: string;
    issueCode: string;
    message: string;
  }>;
  extractedFields: ImportedProposalFieldReview[];
}

export interface ExistingObligation {
  premises: string;
  rsf: number;
  commencementDate: string;
  expirationDate: string;
  leaseType: LeaseType;
  baseRentSchedule: RateStep[];
  baseOperatingExpense: number; // annual $/SF
  annualOperatingExpenseEscalation: number; // decimal
  parkingRatio: number;
  allottedParkingSpaces: number;
  reservedPaidSpaces: number;
  unreservedPaidSpaces: number;
  parkingCostPerSpace: number; // monthly
  annualParkingEscalation: number; // decimal
  parkingSalesTax: number; // decimal
  abatements: AbatementWindow[];
  phaseInEvents: PhaseInEvent[];
}

export interface SubleaseScenario {
  id: string;
  clientId?: string;
  name: string;
  source_document_id?: string;
  source_document_name?: string;
  subtenantName: string;
  subtenantLegalEntity?: string;
  dbaName?: string;
  guarantor?: string;
  brokerName?: string;
  industry?: string;
  subtenantNotes?: string;
  sourceType: SubleaseScenarioSourceType;
  sourceDocumentName?: string;
  sourceProposalName?: string;
  proposalDate?: string;
  proposalExpirationDate?: string;
  propertyName?: string;
  importedProposalMeta?: ImportedProposalMeta;
  downtimeMonths: number;
  subleaseCommencementDate: string;
  subleaseTermMonths: number;
  subleaseExpirationDate: string;
  rsf: number;
  leaseType: LeaseType;
  baseRent: number;
  rentInputType: RentInputType;
  annualBaseRentEscalation: number;
  rentEscalationType: EscalationType;
  baseOperatingExpense: number;
  annualOperatingExpenseEscalation: number;
  rentAbatementStartDate: string;
  rentAbatementMonths: number;
  rentAbatementType: AbatementType;
  customAbatementMonthlyAmount: number;
  commissionPercent: number;
  constructionBudget: number;
  tiAllowanceToSubtenant: number;
  legalMiscFees: number;
  otherOneTimeCosts: number;
  parkingRatio: number;
  allottedParkingSpaces: number;
  reservedPaidSpaces: number;
  unreservedPaidSpaces: number;
  parkingCostPerSpace: number;
  annualParkingEscalation: number;
  phaseInEvents: PhaseInEvent[];
  explicitBaseRentSchedule?: RateStep[];
  discountRate: number;
}

export interface SubleaseMonthlyRow {
  monthNumber: number;
  date: string;
  occupiedRsf: number;
  baseRent: number;
  operatingExpenses: number;
  parking: number;
  tiAmortization: number;
  grossMonthlyRent: number;
  abatementsOrCredits: number;
  netMonthlyRent: number;
  oneTimeCosts: number;
  subleaseRecovery: number;
  netObligation: number;
}

export interface SubleaseSummary {
  scenarioId: string;
  scenarioName: string;
  subtenantName: string;
  totalRemainingObligation: number;
  totalSubleaseRecovery: number;
  totalSubleaseCosts: number;
  netSubleaseRecovery: number;
  netObligation: number;
  recoveryPercent: number;
  recoveryPercentPerSf: number;
  averageTotalCostPerSfPerYear: number;
  averageTotalCostPerMonth: number;
  averageTotalCostPerYear: number;
  npv: number;
}

export interface SubleaseScenarioResult {
  scenario: SubleaseScenario;
  monthly: SubleaseMonthlyRow[];
  summary: SubleaseSummary;
}

export interface SensitivityMatrixCell {
  downtimeMonths: number;
  baseRent: number;
  netObligation: number;
  recoveryPercent: number;
}

export interface SensitivitySingleVariablePoint {
  label: string;
  netObligation: number;
  recoveryPercent: number;
}

export interface SensitivityResult {
  downtimeValues: number[];
  baseRentValues: number[];
  matrix: SensitivityMatrixCell[];
  termSensitivity: SensitivitySingleVariablePoint[];
  commissionSensitivity: SensitivitySingleVariablePoint[];
  tiLegalSensitivity: SensitivitySingleVariablePoint[];
  opexSensitivity: SensitivitySingleVariablePoint[];
}

export interface SubleaseRecoveryShareExisting {
  premises: string;
  rsf: number;
  commencementDate: string;
  expirationDate: string;
  leaseType: string;
}

export interface SubleaseRecoveryShareScenarioSummary {
  scenarioName: string;
  subtenantName: string;
  sourceType: SubleaseScenarioSourceType;
  sourceDocumentName: string;
  totalRemainingObligation: number;
  totalSubleaseRecovery: number;
  totalSubleaseCosts: number;
  netSubleaseRecovery: number;
  netObligation: number;
  recoveryPercent: number;
  npv: number;
}

export interface SubleaseRecoverySharePayload {
  existing: SubleaseRecoveryShareExisting;
  scenarios: SubleaseRecoveryShareScenarioSummary[];
}
