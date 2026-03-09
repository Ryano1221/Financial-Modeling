import type { LeaseType } from "@/lib/lease-engine/canonical-schema";
import { inferRentEscalationPercentFromSteps } from "@/lib/rent-escalation";
import type { ScenarioWithId } from "@/lib/types";
import type {
  ExistingObligation,
  PhaseInEvent,
  SensitivityResult,
  SubleaseMonthlyRow,
  SubleaseScenario,
  SubleaseScenarioResult,
  SubleaseSummary,
} from "./types";

const DEFAULT_DISCOUNT_RATE = 0.08;

function parseIsoDate(value: string): Date {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(Date.UTC(2026, 0, 1));
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(value: Date): string {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addMonths(dateIso: string, months: number): string {
  const date = parseIsoDate(dateIso);
  const day = date.getUTCDate();
  const dt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const monthEnd = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, monthEnd));
  return formatIsoDate(dt);
}

function endDateFromStartAndTerm(startIso: string, termMonths: number): string {
  const start = parseIsoDate(startIso);
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + termMonths, start.getUTCDate()));
  endExclusive.setUTCDate(endExclusive.getUTCDate() - 1);
  return formatIsoDate(endExclusive);
}

export function monthCountInclusive(startIso: string, endIso: string): number {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() >= start.getUTCDate()) months += 1;
  return Math.max(1, months);
}

function monthIndexForDate(startIso: string, targetIso: string): number {
  return Math.max(0, monthCountInclusive(startIso, targetIso) - 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function toDecimalPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1 ? value / 100 : value;
}

function normalizeLeaseType(input: ScenarioWithId["opex_mode"] | LeaseType): LeaseType {
  if (input === "full_service") return "full_service";
  if (input === "base_year") return "base_year";
  if (input === "modified_gross") return "modified_gross";
  if (input === "expense_stop") return "expense_stop";
  return "nnn";
}

function leaseYearIndex(monthIndex: number): number {
  return Math.max(0, Math.floor(monthIndex / 12));
}

function escalationValue(base: number, escalation: number, escalationType: "percent" | "dollar", year: number): number {
  const safeBase = Math.max(0, Number(base) || 0);
  const safeEsc = Math.max(0, Number(escalation) || 0);
  if (escalationType === "dollar") return Math.max(0, safeBase + safeEsc * year);
  return Math.max(0, safeBase * Math.pow(1 + safeEsc, year));
}

function occupiedRsfAtMonth(baseRsf: number, timelineDateIso: string, events: PhaseInEvent[]): number {
  const atDate = parseIsoDate(timelineDateIso).getTime();
  const increase = events.reduce((sum, event) => {
    const eventDate = parseIsoDate(event.startDate).getTime();
    if (eventDate <= atDate) return sum + Math.max(0, Number(event.rsfIncrease) || 0);
    return sum;
  }, 0);
  return Math.max(0, (Number(baseRsf) || 0) + increase);
}

function selectAnnualBaseRateForMonth(existing: ExistingObligation, month: number): number {
  const step = existing.baseRentSchedule.find((entry) => month >= entry.startMonth && month <= entry.endMonth);
  if (!step) return 0;
  return Math.max(0, Number(step.annualRatePsf) || 0);
}

function existingOpexPerMonth(existing: ExistingObligation, occupiedRsf: number, month: number): number {
  if (existing.leaseType === "full_service") return 0;
  const year = leaseYearIndex(month);
  const annualPsf = Math.max(0, existing.baseOperatingExpense) * Math.pow(1 + Math.max(0, existing.annualOperatingExpenseEscalation), year);
  return (annualPsf * Math.max(0, occupiedRsf)) / 12;
}

function existingParkingPerMonth(existing: ExistingObligation, occupiedRsf: number, month: number): number {
  const escalation = Math.pow(1 + Math.max(0, existing.annualParkingEscalation), leaseYearIndex(month));
  const explicitSpaces = Math.max(0, existing.reservedPaidSpaces + existing.unreservedPaidSpaces);
  const derivedSpaces = explicitSpaces > 0
    ? explicitSpaces
    : (existing.allottedParkingSpaces > 0
        ? existing.allottedParkingSpaces
        : Math.max(0, Math.round((Math.max(0, occupiedRsf) / 1000) * Math.max(0, existing.parkingRatio))));
  const monthlyPerSpace = Math.max(0, existing.parkingCostPerSpace) * escalation;
  const preTax = derivedSpaces * monthlyPerSpace;
  return preTax * (1 + Math.max(0, existing.parkingSalesTax));
}

function existingAbatementForMonth(existing: ExistingObligation, month: number, baseRent: number, gross: number): number {
  const hit = existing.abatements.find((window) => month >= window.startMonth && month <= window.endMonth);
  if (!hit) return 0;
  return hit.type === "gross" ? gross : baseRent;
}

interface ExistingMonthBreakout {
  date: string;
  occupiedRsf: number;
  baseRent: number;
  operatingExpenses: number;
  parking: number;
  grossMonthlyRent: number;
  abatementsOrCredits: number;
  netMonthlyRent: number;
}

function buildExistingMonthly(existing: ExistingObligation): ExistingMonthBreakout[] {
  const term = monthCountInclusive(existing.commencementDate, existing.expirationDate);
  const rows: ExistingMonthBreakout[] = [];
  for (let m = 0; m < term; m += 1) {
    const date = addMonths(existing.commencementDate, m);
    const occupiedRsf = occupiedRsfAtMonth(existing.rsf, date, existing.phaseInEvents);
    const annualRatePsf = selectAnnualBaseRateForMonth(existing, m);
    const baseRent = (annualRatePsf * occupiedRsf) / 12;
    const operatingExpenses = existingOpexPerMonth(existing, occupiedRsf, m);
    const parking = existingParkingPerMonth(existing, occupiedRsf, m);
    const grossMonthlyRent = baseRent + operatingExpenses + parking;
    const abatementsOrCredits = existingAbatementForMonth(existing, m, baseRent, grossMonthlyRent);
    const netMonthlyRent = Math.max(0, grossMonthlyRent - abatementsOrCredits);
    rows.push({
      date,
      occupiedRsf,
      baseRent: round2(baseRent),
      operatingExpenses: round2(operatingExpenses),
      parking: round2(parking),
      grossMonthlyRent: round2(grossMonthlyRent),
      abatementsOrCredits: round2(abatementsOrCredits),
      netMonthlyRent: round2(netMonthlyRent),
    });
  }
  return rows;
}

function scenarioActiveRange(existing: ExistingObligation, scenario: SubleaseScenario): { start: number; end: number; activeMonths: number } {
  const totalMonths = monthCountInclusive(existing.commencementDate, existing.expirationDate);
  const byDate = monthIndexForDate(existing.commencementDate, scenario.subleaseCommencementDate);
  const start = clamp(byDate, 0, Math.max(0, totalMonths - 1));
  const byTerm = start + Math.max(0, Math.floor(scenario.subleaseTermMonths)) - 1;
  const byExpiration = monthIndexForDate(existing.commencementDate, scenario.subleaseExpirationDate);
  const end = clamp(Math.min(byTerm, byExpiration), start - 1, totalMonths - 1);
  const activeMonths = end >= start ? (end - start + 1) : 0;
  return { start, end, activeMonths };
}

function scenarioParkingPerMonth(scenario: SubleaseScenario, occupiedRsf: number, monthsIntoSublease: number): number {
  const escalation = Math.pow(1 + Math.max(0, scenario.annualParkingEscalation), leaseYearIndex(monthsIntoSublease));
  const configuredSpaces = Math.max(0, scenario.reservedPaidSpaces + scenario.unreservedPaidSpaces);
  const fallbackSpaces = scenario.allottedParkingSpaces > 0
    ? scenario.allottedParkingSpaces
    : Math.max(0, Math.round((Math.max(0, occupiedRsf) / 1000) * Math.max(0, scenario.parkingRatio)));
  const spaces = configuredSpaces > 0 ? configuredSpaces : fallbackSpaces;
  return round2(spaces * Math.max(0, scenario.parkingCostPerSpace) * escalation);
}

function scenarioProjectedGrossOverTerm(existing: ExistingObligation, scenario: SubleaseScenario): number {
  const existingMonthly = buildExistingMonthly(existing);
  const { start, end, activeMonths } = scenarioActiveRange(existing, scenario);
  if (activeMonths <= 0) return 0;
  let projected = 0;
  for (let m = start; m <= end; m += 1) {
    const monthOffset = m - start;
    const date = existingMonthly[m].date;
    const occupiedRsf = occupiedRsfAtMonth(scenario.rsf, date, scenario.phaseInEvents);
    const year = leaseYearIndex(monthOffset);
    const baseEscalated = escalationValue(
      scenario.baseRent,
      scenario.annualBaseRentEscalation,
      scenario.rentEscalationType,
      year,
    );
    const baseRent = scenario.rentInputType === "annual_psf"
      ? (baseEscalated * occupiedRsf) / 12
      : baseEscalated;
    const annualOpex = escalationValue(
      scenario.baseOperatingExpense,
      scenario.annualOperatingExpenseEscalation,
      "percent",
      year,
    );
    const opex = scenario.leaseType === "full_service" ? 0 : (annualOpex * occupiedRsf) / 12;
    const parking = scenarioParkingPerMonth(scenario, occupiedRsf, monthOffset);
    projected += baseRent + opex + parking;
  }
  return Math.max(0, projected);
}

function scenarioAbatementAmountForMonth(
  existing: ExistingObligation,
  scenario: SubleaseScenario,
  monthIndex: number,
  scenarioBaseRent: number,
  scenarioGross: number,
): number {
  const startMonth = monthIndexForDate(existing.commencementDate, scenario.rentAbatementStartDate);
  const endMonth = startMonth + Math.max(0, Math.floor(scenario.rentAbatementMonths)) - 1;
  if (monthIndex < startMonth || monthIndex > endMonth) return 0;
  if (scenario.rentAbatementType === "gross") return scenarioGross;
  if (scenario.rentAbatementType === "custom") {
    return Math.min(Math.max(0, scenario.customAbatementMonthlyAmount), scenarioGross);
  }
  return scenarioBaseRent;
}

function summaryFromMonthly(
  existing: ExistingObligation,
  scenario: SubleaseScenario,
  monthly: SubleaseMonthlyRow[],
): SubleaseSummary {
  const months = Math.max(1, monthly.length);
  const years = Math.max(1 / 12, months / 12);
  const totalRemainingObligation = monthly.reduce((sum, row) => sum + row.netMonthlyRent, 0);
  const totalSubleaseRecovery = monthly.reduce((sum, row) => sum + row.subleaseRecovery, 0);
  const totalSubleaseCosts = monthly.reduce((sum, row) => sum + row.oneTimeCosts + row.tiAmortization, 0);
  const netSubleaseRecovery = totalSubleaseRecovery - totalSubleaseCosts;
  const netObligation = monthly.reduce((sum, row) => sum + row.netObligation, 0);
  const recoveryPercent = totalRemainingObligation > 0 ? netSubleaseRecovery / totalRemainingObligation : 0;
  const existingPerSf = existing.rsf > 0 ? totalRemainingObligation / existing.rsf : 0;
  const scenarioPerSf = scenario.rsf > 0 ? netSubleaseRecovery / scenario.rsf : 0;
  const recoveryPercentPerSf = existingPerSf > 0 ? scenarioPerSf / existingPerSf : 0;
  const averageTotalCostPerSfPerYear = existing.rsf > 0 ? netObligation / existing.rsf / years : 0;
  const averageTotalCostPerMonth = netObligation / months;
  const averageTotalCostPerYear = netObligation / years;
  const discountRate = Math.max(0, Number(scenario.discountRate) || DEFAULT_DISCOUNT_RATE);
  const npv = monthly.reduce((sum, row, idx) => {
    const factor = Math.pow(1 + discountRate, (idx + 1) / 12);
    return sum + row.netObligation / factor;
  }, 0);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    totalRemainingObligation: round2(totalRemainingObligation),
    totalSubleaseRecovery: round2(totalSubleaseRecovery),
    totalSubleaseCosts: round2(totalSubleaseCosts),
    netSubleaseRecovery: round2(netSubleaseRecovery),
    netObligation: round2(netObligation),
    recoveryPercent,
    recoveryPercentPerSf,
    averageTotalCostPerSfPerYear: round2(averageTotalCostPerSfPerYear),
    averageTotalCostPerMonth: round2(averageTotalCostPerMonth),
    averageTotalCostPerYear: round2(averageTotalCostPerYear),
    npv: round2(npv),
  };
}

export function runSubleaseRecoveryScenario(existing: ExistingObligation, scenario: SubleaseScenario): SubleaseScenarioResult {
  const existingMonthly = buildExistingMonthly(existing);
  const { start, end, activeMonths } = scenarioActiveRange(existing, scenario);
  const commissionRate = toDecimalPercent(scenario.commissionPercent);
  const projectedGross = scenarioProjectedGrossOverTerm(existing, scenario);
  const commissionAmount = projectedGross * commissionRate;
  const oneTimeAtStart = Math.max(0, commissionAmount + scenario.legalMiscFees + scenario.otherOneTimeCosts);
  const tiPool = Math.max(0, scenario.constructionBudget + scenario.tiAllowanceToSubtenant);
  const tiAmortizationPerMonth = activeMonths > 0 ? tiPool / activeMonths : 0;

  const monthly: SubleaseMonthlyRow[] = existingMonthly.map((existingRow, idx) => {
    const isActive = idx >= start && idx <= end;
    const monthsIntoSublease = isActive ? idx - start : 0;
    const occupiedRsf = isActive
      ? occupiedRsfAtMonth(scenario.rsf, existingRow.date, scenario.phaseInEvents)
      : 0;

    const year = leaseYearIndex(monthsIntoSublease);
    const baseEscalated = escalationValue(
      scenario.baseRent,
      scenario.annualBaseRentEscalation,
      scenario.rentEscalationType,
      year,
    );
    const scenarioBaseRent = isActive
      ? (scenario.rentInputType === "annual_psf"
        ? (baseEscalated * occupiedRsf) / 12
        : baseEscalated)
      : 0;

    const annualOpex = escalationValue(
      scenario.baseOperatingExpense,
      scenario.annualOperatingExpenseEscalation,
      "percent",
      year,
    );
    const scenarioOpex = isActive && scenario.leaseType !== "full_service"
      ? (annualOpex * occupiedRsf) / 12
      : 0;

    const scenarioParking = isActive
      ? scenarioParkingPerMonth(scenario, occupiedRsf, monthsIntoSublease)
      : 0;

    const scenarioGross = scenarioBaseRent + scenarioOpex + scenarioParking;
    const scenarioAbatement = isActive
      ? scenarioAbatementAmountForMonth(existing, scenario, idx, scenarioBaseRent, scenarioGross)
      : 0;
    const subleaseRecovery = isActive ? Math.max(0, scenarioGross - scenarioAbatement) : 0;

    const tiAmortization = isActive ? tiAmortizationPerMonth : 0;
    const oneTimeCosts = idx === start && activeMonths > 0 ? oneTimeAtStart : 0;
    const netObligation = existingRow.netMonthlyRent + tiAmortization + oneTimeCosts - subleaseRecovery;

    return {
      monthNumber: idx + 1,
      date: existingRow.date,
      occupiedRsf: round2(isActive ? occupiedRsf : existingRow.occupiedRsf),
      baseRent: round2(existingRow.baseRent),
      operatingExpenses: round2(existingRow.operatingExpenses),
      parking: round2(existingRow.parking),
      tiAmortization: round2(tiAmortization),
      grossMonthlyRent: round2(existingRow.grossMonthlyRent),
      abatementsOrCredits: round2(existingRow.abatementsOrCredits),
      netMonthlyRent: round2(existingRow.netMonthlyRent),
      oneTimeCosts: round2(oneTimeCosts),
      subleaseRecovery: round2(subleaseRecovery),
      netObligation: round2(netObligation),
    };
  });

  const summary = summaryFromMonthly(existing, scenario, monthly);
  return { scenario, monthly, summary };
}

export function runSubleaseRecoveryPortfolio(existing: ExistingObligation, scenarios: SubleaseScenario[]): SubleaseScenarioResult[] {
  return scenarios.map((scenario) => runSubleaseRecoveryScenario(existing, scenario));
}

export function buildSensitivity(existing: ExistingObligation, baseScenario: SubleaseScenario): SensitivityResult {
  const baselineTerm = Math.max(1, Math.floor(baseScenario.subleaseTermMonths));
  const baselineCommission = Math.max(0, baseScenario.commissionPercent);
  const baselineBaseRent = Math.max(0, baseScenario.baseRent);
  const baselineOpex = Math.max(0, baseScenario.baseOperatingExpense);

  const downtimeValues = Array.from(new Set([
    Math.max(0, baseScenario.downtimeMonths - 3),
    Math.max(0, baseScenario.downtimeMonths),
    Math.max(0, baseScenario.downtimeMonths + 3),
  ])).sort((a, b) => a - b);

  const baseRentValues = Array.from(new Set([
    round2(baselineBaseRent * 0.85),
    round2(baselineBaseRent),
    round2(baselineBaseRent * 1.15),
  ])).sort((a, b) => a - b);

  const matrix = downtimeValues.flatMap((downtime) =>
    baseRentValues.map((rent) => {
      const adjusted: SubleaseScenario = {
        ...baseScenario,
        downtimeMonths: downtime,
        baseRent: rent,
        subleaseCommencementDate: addMonths(existing.commencementDate, downtime),
      };
      const res = runSubleaseRecoveryScenario(existing, adjusted);
      return {
        downtimeMonths: downtime,
        baseRent: rent,
        netObligation: res.summary.netObligation,
        recoveryPercent: res.summary.recoveryPercent,
      };
    })
  );

  const mkPoint = (label: string, scenario: SubleaseScenario) => {
    const res = runSubleaseRecoveryScenario(existing, scenario);
    return {
      label,
      netObligation: res.summary.netObligation,
      recoveryPercent: res.summary.recoveryPercent,
    };
  };

  const termSensitivity = [
    mkPoint("Low", { ...baseScenario, subleaseTermMonths: Math.max(1, baselineTerm - 12) }),
    mkPoint("Base", baseScenario),
    mkPoint("High", { ...baseScenario, subleaseTermMonths: baselineTerm + 12 }),
  ];

  const commissionSensitivity = [
    mkPoint("Low", { ...baseScenario, commissionPercent: Math.max(0, baselineCommission - 0.01) }),
    mkPoint("Base", baseScenario),
    mkPoint("High", { ...baseScenario, commissionPercent: baselineCommission + 0.01 }),
  ];

  const tiLegalSensitivity = [
    mkPoint("Low", {
      ...baseScenario,
      constructionBudget: round2(baseScenario.constructionBudget * 0.8),
      tiAllowanceToSubtenant: round2(baseScenario.tiAllowanceToSubtenant * 0.8),
      legalMiscFees: round2(baseScenario.legalMiscFees * 0.8),
    }),
    mkPoint("Base", baseScenario),
    mkPoint("High", {
      ...baseScenario,
      constructionBudget: round2(baseScenario.constructionBudget * 1.2),
      tiAllowanceToSubtenant: round2(baseScenario.tiAllowanceToSubtenant * 1.2),
      legalMiscFees: round2(baseScenario.legalMiscFees * 1.2),
    }),
  ];

  const opexSensitivity = [
    mkPoint("Low", { ...baseScenario, baseOperatingExpense: round2(baselineOpex * 0.8) }),
    mkPoint("Base", baseScenario),
    mkPoint("High", { ...baseScenario, baseOperatingExpense: round2(baselineOpex * 1.2) }),
  ];

  return {
    downtimeValues,
    baseRentValues,
    matrix,
    termSensitivity,
    commissionSensitivity,
    tiLegalSensitivity,
    opexSensitivity,
  };
}

function premisesLabelFromScenario(source: ScenarioWithId): string {
  const building = String(source.building_name || "").trim();
  const suite = String(source.suite || "").trim();
  const floor = String(source.floor || "").trim();
  const pieces = [building];
  if (suite) pieces.push(`Suite ${suite}`);
  if (!suite && floor) pieces.push(`Floor ${floor}`);
  const label = pieces.filter(Boolean).join(" ").trim();
  return label || String(source.name || "Existing Obligation").trim();
}

export function buildExistingObligationFromScenario(source: ScenarioWithId | null): ExistingObligation {
  if (!source) {
    return {
      premises: "Existing Obligation",
      rsf: 10000,
      commencementDate: "2026-01-01",
      expirationDate: "2031-01-31",
      leaseType: "nnn",
      baseRentSchedule: [{ startMonth: 0, endMonth: 60, annualRatePsf: 40 }],
      baseOperatingExpense: 12,
      annualOperatingExpenseEscalation: 0.03,
      parkingRatio: 3,
      allottedParkingSpaces: 30,
      reservedPaidSpaces: 0,
      unreservedPaidSpaces: 30,
      parkingCostPerSpace: 150,
      annualParkingEscalation: 0.03,
      parkingSalesTax: 0.0825,
      abatements: [],
      phaseInEvents: [],
    };
  }

  const termMonths = monthCountInclusive(source.commencement, source.expiration);
  const baseRentSchedule = (source.rent_steps || []).map((step) => ({
    startMonth: Math.max(0, Math.floor(step.start || 0)),
    endMonth: Math.max(0, Math.floor(step.end || 0)),
    annualRatePsf: Math.max(0, Number(step.rate_psf_yr) || 0),
  }));
  if (baseRentSchedule.length === 0) {
    baseRentSchedule.push({ startMonth: 0, endMonth: termMonths - 1, annualRatePsf: 0 });
  }

  const parkingSpaces = Math.max(0, Math.floor(Number(source.parking_spaces) || 0));
  const parkingRatio = source.rsf > 0 ? round2((parkingSpaces / source.rsf) * 1000) : 0;
  const abatements = (source.abatement_periods || []).map((period) => ({
    startMonth: Math.max(0, Math.floor(Number(period.start_month) || 0)),
    endMonth: Math.max(0, Math.floor(Number(period.end_month) || 0)),
    type: period.abatement_type === "gross" ? "gross" as const : "base" as const,
  }));

  const fallbackAbatementMonths = Math.max(0, Math.floor(Number(source.free_rent_months) || 0));
  if (abatements.length === 0 && fallbackAbatementMonths > 0) {
    const start = Math.max(0, Math.floor(Number(source.free_rent_start_month) || 0));
    abatements.push({
      startMonth: start,
      endMonth: start + fallbackAbatementMonths - 1,
      type: source.free_rent_abatement_type === "gross" ? "gross" : "base",
    });
  }

  const phaseInEvents: PhaseInEvent[] = [];
  for (const step of source.phase_in_steps || []) {
    const startMonth = Math.max(0, Math.floor(Number(step.start_month) || 0));
    phaseInEvents.push({
      id: `${source.id}-phase-${startMonth}`,
      startDate: addMonths(source.commencement, startMonth),
      rsfIncrease: Math.max(0, Number(step.rsf) - Number(source.rsf || 0)),
    });
  }

  return {
    premises: premisesLabelFromScenario(source),
    rsf: Math.max(0, Number(source.rsf) || 0),
    commencementDate: source.commencement,
    expirationDate: source.expiration,
    leaseType: normalizeLeaseType(source.opex_mode),
    baseRentSchedule,
    baseOperatingExpense: Math.max(0, Number(source.base_opex_psf_yr) || 0),
    annualOperatingExpenseEscalation: Math.max(0, Number(source.opex_growth) || 0),
    parkingRatio: Math.max(0, parkingRatio),
    allottedParkingSpaces: parkingSpaces,
    reservedPaidSpaces: 0,
    unreservedPaidSpaces: parkingSpaces,
    parkingCostPerSpace: Math.max(0, Number(source.parking_cost_monthly_per_space) || 0),
    annualParkingEscalation: 0,
    parkingSalesTax: Math.max(0, Number(source.parking_sales_tax_rate) || 0),
    abatements,
    phaseInEvents,
  };
}

function scenarioTemplate(existing: ExistingObligation, name: string, downtimeMonths: number, rentFactor: number): SubleaseScenario {
  const term = monthCountInclusive(existing.commencementDate, existing.expirationDate);
  const startDate = addMonths(existing.commencementDate, downtimeMonths);
  const subleaseTermMonths = Math.max(1, term - downtimeMonths);
  const firstRate = existing.baseRentSchedule[0]?.annualRatePsf || 0;
  const inferredEscalation = inferRentEscalationPercentFromSteps(
    existing.baseRentSchedule.map((step) => ({
      start: step.startMonth,
      end: step.endMonth,
      rate_psf_yr: step.annualRatePsf,
    }))
  );

  return {
    id: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36).slice(-6)}`,
    name,
    downtimeMonths,
    subleaseCommencementDate: startDate,
    subleaseTermMonths,
    subleaseExpirationDate: endDateFromStartAndTerm(startDate, subleaseTermMonths),
    rsf: existing.rsf,
    leaseType: existing.leaseType,
    baseRent: round2(firstRate * rentFactor),
    rentInputType: "annual_psf",
    annualBaseRentEscalation: inferredEscalation > 0 ? inferredEscalation : 0.03,
    rentEscalationType: "percent",
    baseOperatingExpense: existing.baseOperatingExpense,
    annualOperatingExpenseEscalation: existing.annualOperatingExpenseEscalation,
    rentAbatementStartDate: startDate,
    rentAbatementMonths: 0,
    rentAbatementType: "base",
    customAbatementMonthlyAmount: 0,
    commissionPercent: 0.04,
    constructionBudget: 0,
    tiAllowanceToSubtenant: 0,
    legalMiscFees: 0,
    otherOneTimeCosts: 0,
    parkingRatio: existing.parkingRatio,
    allottedParkingSpaces: existing.allottedParkingSpaces,
    reservedPaidSpaces: existing.reservedPaidSpaces,
    unreservedPaidSpaces: existing.unreservedPaidSpaces,
    parkingCostPerSpace: existing.parkingCostPerSpace,
    annualParkingEscalation: existing.annualParkingEscalation,
    phaseInEvents: [],
    discountRate: DEFAULT_DISCOUNT_RATE,
  };
}

export function defaultSubleaseScenarios(existing: ExistingObligation): SubleaseScenario[] {
  return [
    scenarioTemplate(existing, "Best Case", 2, 0.9),
    scenarioTemplate(existing, "Realistic Case", 4, 0.75),
    scenarioTemplate(existing, "Worst Case", 8, 0.6),
  ];
}

export function cloneSubleaseScenario(scenario: SubleaseScenario): SubleaseScenario {
  return {
    ...scenario,
    id: `${scenario.id}-copy-${Math.random().toString(36).slice(2, 7)}`,
    name: `${scenario.name} Copy`,
    phaseInEvents: scenario.phaseInEvents.map((event) => ({ ...event, id: `${event.id}-copy` })),
  };
}
