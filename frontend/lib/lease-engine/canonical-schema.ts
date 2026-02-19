/**
 * Canonical LeaseScenario schema for the lease economics engine.
 * Single source of truth for any lease input method; supports broker-style analysis.
 */

/** Lease type for expense treatment */
export type LeaseType = "nnn" | "full_service" | "modified_gross" | "base_year" | "expense_stop";

/** Rent schedule: fixed per RSF with escalation, step ups, or blended */
export interface RentStepCanonical {
  /** Start month index (0-based from commencement) */
  startMonth: number;
  /** End month index (inclusive) */
  endMonth: number;
  /** Annual rent per RSF for this period */
  ratePsfYr: number;
}

export interface PhaseInStepCanonical {
  startMonth: number;
  endMonth: number;
  rsf: number;
}

/** Abatement/free rent */
export interface RentAbatement {
  startDate: string; // YYYY-MM-DD
  startMonth?: number; // 0-based, preferred for lease timeline math
  months: number;
  type: "full" | "partial";
  appliesTo?: "base" | "gross";
  /** If partial, effective rate as fraction of base (0-1) */
  partialRate?: number;
}

export interface RentScheduleCanonical {
  /** Primary: steps with explicit date ranges (covers step ups, blended) */
  steps: RentStepCanonical[];
  /** Annual escalation % applied after last step (e.g. 0.0325 = 3.25%) */
  annualEscalationPercent: number;
  /** Escalation effective date (first increase) YYYY-MM-DD */
  escalationEffectiveDate?: string;
  abatement?: RentAbatement;
  /** Pre-LCD total months free rent (legacy) */
  preLcdTotalMonths?: number;
}

/** Expense structure */
export type ExpenseCategory =
  | "taxes"
  | "insurance"
  | "utilities"
  | "cam"
  | "janitorial"
  | "management"
  | "other";

export interface ExpenseScheduleCanonical {
  leaseType: LeaseType;
  /** Base year or NNN: annual per RSF */
  baseOpexPsfYr: number;
  /** Base year (expense stop) per RSF - for base_year / expense_stop */
  baseYearOpexPsfYr?: number;
  annualEscalationPercent: number;
  /** Optional category breakdown annual per RSF */
  byCategory?: Partial<Record<ExpenseCategory, number>>;
}

/** Parking type and cost */
export interface ParkingSlotCanonical {
  type: "reserved" | "unreserved";
  count: number;
  costPerSpacePerMonth: number;
  /** Abatement months for this type */
  abatementMonths?: number;
}

export interface ParkingScheduleCanonical {
  /** Spaces per 1,000 RSF (ratio) */
  ratioPer1000Rsf?: number;
  /** Total spaces allotted */
  spacesAllotted?: number;
  slots: ParkingSlotCanonical[];
  annualEscalationPercent: number;
  salesTaxPercent?: number;
}

/** TI and amortization */
export interface TIScheduleCanonical {
  budgetTotal: number;
  allowanceFromLandlord: number;
  /** Out of pocket (budget - allowance), can be negative if allowance exceeds budget */
  outOfPocket: number;
  /** Gross TI out of pocket (e.g. before tenant contribution) */
  grossOutOfPocket?: number;
  amortizeOop: boolean;
  /** If amortize: interest rate annual (e.g. 0.08) */
  amortizationRateAnnual?: number;
  /** If amortize: term in months */
  amortizationTermMonths?: number;
  /** Reimbursement timing: "upfront" | "draw" | "monthly" */
  reimbursementTiming?: string;
}

/** One-time and misc */
export interface OtherCashFlowCanonical {
  oneTimeCosts: Array< { name: string; amount: number; month: number }>;
  recurringMonthly?: number;
  /** FF&E allowance (positive = credit) */
  ffeAllowance?: number;
  securityDepositMonths?: number;
  brokerFee?: number;
  /** Any other credits or reimbursements */
  notes?: string;
}

/** Party and premises */
export interface PartyAndPremisesCanonical {
  premisesName: string;
  premisesLabel?: string;
  floorsOrSuite?: string;
  rentableSqFt: number;
  leaseType: LeaseType;
}

/** Dates and term */
export interface DatesAndTermCanonical {
  leaseTermMonths: number;
  commencementDate: string; // YYYY-MM-DD
  expirationDate: string;
  rentEscalationDate?: string;
}

/** Full canonical LeaseScenario */
export interface LeaseScenarioCanonical {
  id: string;
  name: string;
  /** Global discount rate default 8%; overridden per option if set */
  discountRateAnnual?: number;
  partyAndPremises: PartyAndPremisesCanonical;
  datesAndTerm: DatesAndTermCanonical;
  rentSchedule: RentScheduleCanonical;
  phaseInSchedule?: PhaseInStepCanonical[];
  expenseSchedule: ExpenseScheduleCanonical;
  parkingSchedule: ParkingScheduleCanonical;
  tiSchedule: TIScheduleCanonical;
  otherCashFlows: OtherCashFlowCanonical;
  /** Option-specific notes for comparison matrix */
  notes?: string;
}

/** Confidence and source for parsed fields */
export interface FieldWithConfidence<T> {
  value: T;
  confidence: number;
  sourceSnippet?: string;
}

/** Parsed scenario with confidence (for extraction pipeline) */
export interface LeaseScenarioParsed {
  scenario: LeaseScenarioCanonical;
  fieldConfidence: Record<string, number>;
  warnings: string[];
}
