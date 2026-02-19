/**
 * Single source of truth: monthly cash flow engine.
 * Produces timeline from commencement through expiration; annual rollups; NPV @ discount rate.
 */

import type {
  LeaseScenarioCanonical,
  RentStepCanonical,
  RentAbatement,
  ParkingSlotCanonical,
} from "./canonical-schema";

const DEFAULT_DISCOUNT_RATE = 0.08;

function parseDate(s: string): { year: number; month: number; day: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

function monthDiff(start: string, end: string): number {
  const a = parseDate(start);
  const b = parseDate(end);
  return (b.year - a.year) * 12 + (b.month - a.month) + (b.day >= a.day ? 1 : 0);
}

/** Monthly series for one scenario */
export interface MonthlyRow {
  monthIndex: number;
  periodStart: string;
  periodEnd: string;
  baseRent: number;
  opex: number;
  parking: number;
  tiAmortization: number;
  misc: number;
  total: number;
  effectivePsfYr: number;
  /** Running sum of total (undiscounted) */
  cumulativeCost: number;
  /** PV of this month's total at discount rate */
  discountedValue: number;
}

/** Annual rollup */
export interface AnnualRow {
  leaseYear: number;
  periodStart: string;
  periodEnd: string;
  baseRent: number;
  opex: number;
  parking: number;
  tiAmortization: number;
  misc: number;
  total: number;
  effectivePsfYr: number;
}

/** Key metrics for comparison matrix and option sheet */
export interface OptionMetrics {
  buildingName: string;
  suiteName: string;
  premisesName: string;
  rsf: number;
  leaseType: string;
  termMonths: number;
  commencementDate: string;
  expirationDate: string;
  baseRentPsfYr: number;
  escalationPercent: number;
  opexPsfYr: number;
  opexEscalationPercent: number;
  parkingCostAnnual: number;
  tiBudget: number;
  tiAllowance: number;
  tiOutOfPocket: number;
  grossTiOutOfPocket: number;
  avgGrossRentPerMonth: number;
  avgGrossRentPerYear: number;
  avgAllInCostPerMonth: number;
  avgAllInCostPerYear: number;
  avgCostPsfYr: number;
  npvAtDiscount: number;
  discountRateUsed: number;
  totalObligation: number;
  equalizedAvgCostPsfYr: number;
  notes: string;
}

/** Full engine result */
export interface EngineResult {
  scenarioId: string;
  scenarioName: string;
  termMonths: number;
  monthly: MonthlyRow[];
  annual: AnnualRow[];
  metrics: OptionMetrics;
  discountRateUsed: number;
}

function getDiscountRate(s: LeaseScenarioCanonical, globalDiscountRate?: number): number {
  if (s.discountRateAnnual != null && s.discountRateAnnual >= 0) return s.discountRateAnnual;
  return globalDiscountRate ?? DEFAULT_DISCOUNT_RATE;
}

/** Build monthly base rent from steps and abatement */
function monthlyBaseRent(
  termMonths: number,
  steps: RentStepCanonical[],
  effectiveRsf: number[],
  abatement?: RentAbatement
): number[] {
  const rent = new Array<number>(termMonths).fill(0);
  for (const step of steps) {
    for (let m = step.startMonth; m <= Math.min(step.endMonth, termMonths - 1); m++) {
      if (m >= 0) rent[m] = (step.ratePsfYr / 12) * (effectiveRsf[m] ?? 0);
    }
  }
  if (abatement && abatement.months > 0) {
    const start = Math.max(0, Math.floor(Number(abatement.startMonth ?? 0) || 0));
    const end = Math.min(termMonths, start + abatement.months);
    if (abatement.type === "full") {
      for (let m = start; m < end; m++) rent[m] = 0;
    } else {
      const factor = abatement.partialRate ?? 0;
      for (let m = start; m < end; m++) rent[m] = rent[m] * (1 - factor);
    }
  }
  return rent;
}

/** Monthly opex from lease type */
function monthlyOpex(
  termMonths: number,
  baseOpexPsfYr: number,
  baseYearPsfYr: number | undefined,
  escalationPercent: number,
  leaseType: string,
  effectiveRsf: number[]
): number[] {
  const opex: number[] = [];
  if (leaseType === "full_service") return new Array(termMonths).fill(0);
  for (let m = 0; m < termMonths; m++) {
    const yearIndex = Math.floor(m / 12);
    const annualPsf = baseOpexPsfYr * Math.pow(1 + escalationPercent, yearIndex);
    let chargePsfYr = annualPsf;
    if (leaseType === "base_year" || leaseType === "expense_stop") {
      const baseYear = baseYearPsfYr ?? baseOpexPsfYr;
      chargePsfYr = Math.max(0, annualPsf - baseYear);
    }
    opex.push((chargePsfYr / 12) * (effectiveRsf[m] ?? 0));
  }
  return opex;
}

function effectiveRsfSchedule(
  defaultRsf: number,
  termMonths: number,
  phaseInSchedule?: Array<{ startMonth: number; endMonth: number; rsf: number }>
): number[] {
  const base = Math.max(0, defaultRsf || 0);
  const out = new Array<number>(termMonths).fill(base);
  if (!phaseInSchedule || phaseInSchedule.length === 0) return out;
  const sorted = [...phaseInSchedule].sort((a, b) => (a.startMonth - b.startMonth) || (a.endMonth - b.endMonth));
  for (const step of sorted) {
    const start = Math.max(0, step.startMonth | 0);
    const end = Math.min(termMonths - 1, Math.max(start, step.endMonth | 0));
    const rsf = Math.max(0, Number(step.rsf) || 0);
    for (let m = start; m <= end; m++) out[m] = rsf;
  }
  return out;
}

/** Monthly parking from slots */
function monthlyParking(
  termMonths: number,
  slots: ParkingSlotCanonical[],
  escalationPercent: number
): number[] {
  const park: number[] = [];
  for (let m = 0; m < termMonths; m++) {
    const yearIndex = Math.floor(m / 12);
    const mult = Math.pow(1 + escalationPercent, yearIndex);
    let sum = 0;
    for (const slot of slots) {
      const abate = slot.abatementMonths ?? 0;
      const cost = m < abate ? 0 : slot.costPerSpacePerMonth * slot.count * mult;
      sum += cost;
    }
    park.push(sum);
  }
  return park;
}

/** TI amortization: equal monthly payment over term */
function monthlyTiAmortization(
  outOfPocket: number,
  termMonths: number,
  rateAnnual: number,
  amortTermMonths: number
): number[] {
  if (outOfPocket <= 0 || amortTermMonths <= 0 || rateAnnual < 0) {
    return new Array(termMonths).fill(0);
  }
  const r = rateAnnual / 12;
  const n = Math.min(amortTermMonths, termMonths);
  const pmt = r <= 0 ? outOfPocket / n : (outOfPocket * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const arr = new Array(termMonths).fill(0);
  for (let i = 0; i < n; i++) arr[i] = pmt;
  return arr;
}

/** One-time costs and broker fee at month 0, security deposit out/in */
function monthlyMisc(
  termMonths: number,
  oneTimeCosts: Array<{ name: string; amount: number; month: number }>,
  brokerFee: number,
  recurringMonthly: number,
  securityDepositMonths: number,
  firstMonthRent: number
): number[] {
  const arr = new Array(termMonths).fill(recurringMonthly ?? 0);
  arr[0] += brokerFee ?? 0;
  const deposit = securityDepositMonths > 0 ? firstMonthRent * securityDepositMonths : 0;
  if (deposit > 0) {
    arr[0] += deposit;
    if (termMonths > 0) arr[termMonths - 1] -= deposit;
  }
  for (const ot of oneTimeCosts) {
    if (ot.month >= 0 && ot.month < termMonths) arr[ot.month] += ot.amount;
  }
  return arr;
}

/** Add TI allowance as negative (credit) at month 0 */
function applyTiCredit(monthlyTotal: number[], tiAllowance: number, termMonths: number): void {
  if (termMonths > 0 && tiAllowance > 0) monthlyTotal[0] -= tiAllowance;
}

function addMonthsToDate(dateStr: string, months: number): string {
  const d = parseDate(dateStr);
  let y = d.year;
  let m = d.month + months;
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  const day = Math.min(d.day, new Date(y, m + 1, 0).getDate());
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Run the monthly engine for one scenario.
 * Uses option discount rate if set, else global (default 8%).
 */
export function runMonthlyEngine(
  scenario: LeaseScenarioCanonical,
  globalDiscountRate?: number
): EngineResult {
  const rsf = scenario.partyAndPremises.rentableSqFt;
  const termMonths = scenario.datesAndTerm.leaseTermMonths;
  const comm = scenario.datesAndTerm.commencementDate;
  const discountRate = getDiscountRate(scenario, globalDiscountRate);
  const effectiveRsf = effectiveRsfSchedule(
    rsf,
    termMonths,
    (scenario.phaseInSchedule ?? []).map((step) => ({
      startMonth: step.startMonth,
      endMonth: step.endMonth,
      rsf: step.rsf,
    }))
  );

  const baseRent = monthlyBaseRent(
    termMonths,
    scenario.rentSchedule.steps,
    effectiveRsf,
    scenario.rentSchedule.abatement
  );
  const opex = monthlyOpex(
    termMonths,
    scenario.expenseSchedule.baseOpexPsfYr,
    scenario.expenseSchedule.baseYearOpexPsfYr,
    scenario.expenseSchedule.annualEscalationPercent,
    scenario.expenseSchedule.leaseType,
    effectiveRsf
  );
  const parking = monthlyParking(
    termMonths,
    scenario.parkingSchedule.slots,
    scenario.parkingSchedule.annualEscalationPercent
  );
  if (scenario.rentSchedule.abatement?.appliesTo === "gross" && (scenario.rentSchedule.abatement?.months ?? 0) > 0) {
    const start = Math.max(0, Math.floor(Number(scenario.rentSchedule.abatement.startMonth ?? 0) || 0));
    const end = Math.min(termMonths, start + (scenario.rentSchedule.abatement.months ?? 0));
    for (let m = start; m < end; m += 1) {
      opex[m] = 0;
      parking[m] = 0;
    }
  }
  const ti = scenario.tiSchedule.amortizeOop && scenario.tiSchedule.outOfPocket > 0
    ? monthlyTiAmortization(
        scenario.tiSchedule.outOfPocket,
        termMonths,
        scenario.tiSchedule.amortizationRateAnnual ?? 0,
        scenario.tiSchedule.amortizationTermMonths ?? termMonths
      )
    : new Array(termMonths).fill(0);
  const firstMonthRent = baseRent[0] ?? 0;
  const misc = monthlyMisc(
    termMonths,
    scenario.otherCashFlows.oneTimeCosts,
    scenario.otherCashFlows.brokerFee ?? 0,
    scenario.otherCashFlows.recurringMonthly ?? 0,
    scenario.otherCashFlows.securityDepositMonths ?? 0,
    firstMonthRent
  );

  const total = baseRent.map((r, i) => r + opex[i] + parking[i] + ti[i] + misc[i]);
  applyTiCredit(total, scenario.tiSchedule.allowanceFromLandlord, termMonths);

  const monthlyRate = Math.pow(1 + discountRate, 1 / 12) - 1;
  let cumulative = 0;

  const monthly: MonthlyRow[] = [];
  for (let m = 0; m < termMonths; m++) {
    cumulative += total[m];
    const pv = total[m] / Math.pow(1 + monthlyRate, m);
    const periodStart = addMonthsToDate(comm, m);
    const periodEnd = addMonthsToDate(comm, m + 1);
    const monthRsf = effectiveRsf[m] ?? rsf;
    const effPsfYr = monthRsf > 0 ? (total[m] * 12) / monthRsf : 0;
    monthly.push({
      monthIndex: m,
      periodStart,
      periodEnd,
      baseRent: baseRent[m],
      opex: opex[m],
      parking: parking[m],
      tiAmortization: ti[m],
      misc: misc[m],
      total: total[m],
      effectivePsfYr: effPsfYr,
      cumulativeCost: cumulative,
      discountedValue: pv,
    });
  }

  const annual: AnnualRow[] = [];
  for (let y = 0; y < Math.ceil(termMonths / 12); y++) {
    const start = y * 12;
    const end = Math.min(start + 12, termMonths);
    let sumRent = 0, sumOpex = 0, sumPark = 0, sumTi = 0, sumMisc = 0, sumTotal = 0;
    for (let m = start; m < end; m++) {
      sumRent += baseRent[m];
      sumOpex += opex[m];
      sumPark += parking[m];
      sumTi += ti[m];
      sumMisc += misc[m];
      sumTotal += total[m];
    }
    const periodStart = addMonthsToDate(comm, start);
    const periodEnd = addMonthsToDate(comm, end);
    const yearRsf = effectiveRsf.slice(start, end);
    const avgYearRsf = yearRsf.length > 0 ? yearRsf.reduce((a, b) => a + b, 0) / yearRsf.length : rsf;
    annual.push({
      leaseYear: y + 1,
      periodStart,
      periodEnd,
      baseRent: sumRent,
      opex: sumOpex,
      parking: sumPark,
      tiAmortization: sumTi,
      misc: sumMisc,
      total: sumTotal,
      effectivePsfYr: avgYearRsf > 0 ? (sumTotal / (end - start)) * 12 / avgYearRsf : 0,
    });
  }

  const totalObligation = total.reduce((a, b) => a + b, 0);
  const npv = total.reduce((acc, cf, t) => acc + cf / Math.pow(1 + monthlyRate, t), 0);
  const years = termMonths / 12;
  const avgRsfTerm = effectiveRsf.length > 0 ? effectiveRsf.reduce((a, b) => a + b, 0) / effectiveRsf.length : rsf;
  const avgCostYear = years > 0 ? totalObligation / years : 0;
  const avgCostPsfYr = avgRsfTerm > 0 ? avgCostYear / avgRsfTerm : 0;
  const equalizedAvgPsfYr = avgRsfTerm > 0 && years > 0 ? totalObligation / years / avgRsfTerm : 0;

  const firstStep = scenario.rentSchedule.steps[0];
  const buildingName = (scenario.partyAndPremises.premisesLabel ?? "").trim();
  const suiteName = (scenario.partyAndPremises.floorsOrSuite ?? "").trim();
  const metrics: OptionMetrics = {
    buildingName,
    suiteName,
    premisesName: scenario.partyAndPremises.premisesName || scenario.name,
    rsf,
    leaseType: scenario.expenseSchedule.leaseType,
    termMonths,
    commencementDate: comm,
    expirationDate: scenario.datesAndTerm.expirationDate,
    baseRentPsfYr: firstStep?.ratePsfYr ?? 0,
    escalationPercent: scenario.rentSchedule.annualEscalationPercent * 100,
    opexPsfYr: scenario.expenseSchedule.baseOpexPsfYr,
    opexEscalationPercent: scenario.expenseSchedule.annualEscalationPercent * 100,
    parkingCostAnnual: parking.reduce((a, b) => a + b, 0),
    tiBudget: scenario.tiSchedule.budgetTotal,
    tiAllowance: scenario.tiSchedule.allowanceFromLandlord,
    tiOutOfPocket: scenario.tiSchedule.outOfPocket,
    grossTiOutOfPocket: scenario.tiSchedule.grossOutOfPocket ?? scenario.tiSchedule.outOfPocket,
    avgGrossRentPerMonth: baseRent.reduce((a, b) => a + b, 0) / (termMonths || 1),
    avgGrossRentPerYear: baseRent.reduce((a, b) => a + b, 0) / years || 0,
    avgAllInCostPerMonth: totalObligation / (termMonths || 1),
    avgAllInCostPerYear: avgCostYear,
    avgCostPsfYr,
    npvAtDiscount: npv,
    discountRateUsed: discountRate,
    totalObligation,
    equalizedAvgCostPsfYr: equalizedAvgPsfYr,
    notes: scenario.notes ?? "",
  };

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    termMonths,
    monthly,
    annual,
    metrics,
    discountRateUsed: discountRate,
  };
}
