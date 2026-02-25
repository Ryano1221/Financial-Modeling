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
  abatementAmount: number;
  abatementType: string;
  abatementAppliedWhen: string;
  opexPsfYr: number;
  opexEscalationPercent: number;
  parkingCostPerSpotMonthlyPreTax: number;
  parkingCostPerSpotMonthly: number;
  parkingSalesTaxPercent: number;
  parkingCostMonthly: number;
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

type NormalizedAbatementRange = {
  start: number;
  end: number;
  type: "full" | "partial";
  appliesTo: "base" | "gross";
  partialRate: number;
};

type NormalizedParkingAbatementRange = {
  start: number;
  end: number;
  type: "full" | "partial";
  partialRate: number;
};

function normalizeAbatementRanges(
  termMonths: number,
  primaryAbatement?: RentAbatement,
  abatementList?: RentAbatement[]
): NormalizedAbatementRange[] {
  const source = (abatementList && abatementList.length > 0)
    ? abatementList
    : (primaryAbatement ? [primaryAbatement] : []);
  const ranges: NormalizedAbatementRange[] = [];
  for (const item of source) {
    const start = Math.max(0, Math.floor(Number(item.startMonth ?? 0) || 0));
    const rawMonths = Math.max(0, Math.floor(Number(item.months ?? 0) || 0));
    const hasExplicitEnd = Number.isFinite(Number(item.endMonth));
    if (!hasExplicitEnd && rawMonths <= 0) continue;
    const fallbackEnd = start + rawMonths - 1;
    const endFromField = hasExplicitEnd ? Math.floor(Number(item.endMonth)) : fallbackEnd;
    const end = Math.min(termMonths - 1, Math.max(start, endFromField));
    if (start >= termMonths || end < start) continue;
    ranges.push({
      start,
      end,
      type: item.type === "partial" ? "partial" : "full",
      appliesTo: item.appliesTo === "gross" ? "gross" : "base",
      partialRate: Math.min(1, Math.max(0, Number(item.partialRate ?? 0) || 0)),
    });
  }
  return ranges.sort((a, b) => (a.start - b.start) || (a.end - b.end));
}

function normalizeParkingAbatementRanges(
  termMonths: number,
  parkingAbatements?: Array<{
    startMonth?: number;
    endMonth?: number;
    months?: number;
    type?: "full" | "partial";
    partialRate?: number;
  }>
): NormalizedParkingAbatementRange[] {
  const ranges: NormalizedParkingAbatementRange[] = [];
  for (const item of parkingAbatements ?? []) {
    const start = Math.max(0, Math.floor(Number(item.startMonth ?? 0) || 0));
    const rawMonths = Math.max(0, Math.floor(Number(item.months ?? 0) || 0));
    const hasExplicitEnd = Number.isFinite(Number(item.endMonth));
    if (!hasExplicitEnd && rawMonths <= 0) continue;
    const fallbackEnd = start + rawMonths - 1;
    const endFromField = hasExplicitEnd ? Math.floor(Number(item.endMonth)) : fallbackEnd;
    const end = Math.min(termMonths - 1, Math.max(start, endFromField));
    if (start >= termMonths || end < start) continue;
    ranges.push({
      start,
      end,
      type: item.type === "partial" ? "partial" : "full",
      partialRate: Math.min(1, Math.max(0, Number(item.partialRate ?? 0) || 0)),
    });
  }
  return ranges.sort((a, b) => (a.start - b.start) || (a.end - b.end));
}

function formatAbatementType(ranges: NormalizedAbatementRange[]): string {
  if (ranges.length === 0) return "None";
  const scopes = Array.from(new Set(ranges.map((range) => range.appliesTo)));
  const types = Array.from(new Set(ranges.map((range) => range.type)));

  const scopeLabel = scopes.length === 1
    ? (scopes[0] === "gross" ? "Gross rent" : "Base rent")
    : "Mixed base/gross";
  const typeLabel = types.length === 1
    ? (types[0] === "partial" ? "Partial" : "Full")
    : "Mixed full/partial";
  return `${scopeLabel} (${typeLabel})`;
}

function formatAbatementAppliedWhen(ranges: NormalizedAbatementRange[]): string {
  if (ranges.length === 0) return "—";
  return ranges
    .map((range) => {
      const start = range.start + 1;
      const end = range.end + 1;
      return start === end ? `M${start}` : `M${start}-M${end}`;
    })
    .join(", ");
}

/** Build monthly base rent from steps and abatement */
function monthlyBaseRent(
  termMonths: number,
  steps: RentStepCanonical[],
  effectiveRsf: number[],
  abatements: NormalizedAbatementRange[]
): number[] {
  const rent = new Array<number>(termMonths).fill(0);
  for (const step of steps) {
    for (let m = step.startMonth; m <= Math.min(step.endMonth, termMonths - 1); m++) {
      if (m >= 0) rent[m] = (step.ratePsfYr / 12) * (effectiveRsf[m] ?? 0);
    }
  }
  for (const abatement of abatements) {
    if (abatement.appliesTo !== "base" && abatement.appliesTo !== "gross") continue;
    for (let m = abatement.start; m <= abatement.end; m += 1) {
      if (abatement.type === "full") {
        rent[m] = 0;
      } else {
        rent[m] = rent[m] * (1 - abatement.partialRate);
      }
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
  effectiveRsf: number[],
  commencementDate: string,
  opexByCalendarYear?: Record<string, number>
): number[] {
  const commencement = parseDate(commencementDate);
  const explicitOpexByYear = (() => {
    const raw = opexByCalendarYear ?? {};
    const normalized: Record<number, number> = {};
    for (const [yearRaw, valueRaw] of Object.entries(raw)) {
      const year = Number(yearRaw);
      const value = Number(valueRaw);
      if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
      if (year < 1900 || year > 2200 || value < 0) continue;
      normalized[Math.floor(year)] = value;
    }
    return normalized;
  })();
  const explicitYears = Object.keys(explicitOpexByYear)
    .map(Number)
    .sort((a, b) => a - b);

  const annualOpexPsfForCalendarYear = (calendarYear: number): number => {
    if (explicitYears.length > 0) {
      if (calendarYear in explicitOpexByYear) return explicitOpexByYear[calendarYear];
      const floorYears = explicitYears.filter((year) => year <= calendarYear);
      const baselineYear =
        floorYears.length > 0 ? floorYears[floorYears.length - 1] : explicitYears[0];
      const baselineValue = explicitOpexByYear[baselineYear];
      if (escalationPercent <= 0) return baselineValue;
      const yearDelta = Math.max(0, calendarYear - baselineYear);
      return baselineValue * Math.pow(1 + escalationPercent, yearDelta);
    }
    return baseOpexPsfYr;
  };

  const opex: number[] = [];
  if (leaseType === "full_service") return new Array(termMonths).fill(0);
  for (let m = 0; m < termMonths; m++) {
    const annualPsf = explicitYears.length > 0
      ? annualOpexPsfForCalendarYear(commencement.year + Math.floor((commencement.month + m) / 12))
      : baseOpexPsfYr * Math.pow(1 + escalationPercent, Math.floor(m / 12));
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
  escalationPercent: number,
  salesTaxPercent: number = 0
): number[] {
  const park: number[] = [];
  const taxMultiplier = 1 + Math.max(0, Number(salesTaxPercent) || 0);
  for (let m = 0; m < termMonths; m++) {
    const yearIndex = Math.floor(m / 12);
    const mult = Math.pow(1 + escalationPercent, yearIndex);
    let sum = 0;
    for (const slot of slots) {
      const abate = slot.abatementMonths ?? 0;
      const cost = m < abate ? 0 : slot.costPerSpacePerMonth * taxMultiplier * slot.count * mult;
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

/** Apply TI budget expense and TI allowance credit at month 0 */
function applyTiMonthZeroAdjustments(
  monthlyTotal: number[],
  tiBudgetTotal: number,
  tiAllowanceTotal: number,
  termMonths: number
): void {
  if (termMonths <= 0) return;
  if (tiBudgetTotal > 0) monthlyTotal[0] += tiBudgetTotal;
  if (tiAllowanceTotal > 0) monthlyTotal[0] -= tiAllowanceTotal;
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

  const normalizedAbatements = normalizeAbatementRanges(
    termMonths,
    scenario.rentSchedule.abatement,
    scenario.rentSchedule.abatements
  );
  const normalizedParkingAbatements = normalizeParkingAbatementRanges(
    termMonths,
    scenario.parkingSchedule.parkingAbatements
  );
  const baseRentBeforeAbatement = monthlyBaseRent(
    termMonths,
    scenario.rentSchedule.steps,
    effectiveRsf,
    []
  );
  const baseRent = monthlyBaseRent(
    termMonths,
    scenario.rentSchedule.steps,
    effectiveRsf,
    normalizedAbatements
  );
  const opexBeforeAbatement = monthlyOpex(
    termMonths,
    scenario.expenseSchedule.baseOpexPsfYr,
    scenario.expenseSchedule.baseYearOpexPsfYr,
    scenario.expenseSchedule.annualEscalationPercent,
    scenario.expenseSchedule.leaseType,
    effectiveRsf,
    comm,
    scenario.expenseSchedule.opexByCalendarYear
  );
  const opex = [...opexBeforeAbatement];
  const parking = monthlyParking(
    termMonths,
    scenario.parkingSchedule.slots,
    scenario.parkingSchedule.annualEscalationPercent,
    scenario.parkingSchedule.salesTaxPercent ?? 0
  );
  for (const abatement of normalizedAbatements) {
    if (abatement.appliesTo !== "gross") continue;
    for (let m = abatement.start; m <= abatement.end; m += 1) {
      if (abatement.type === "full") {
        opex[m] = 0;
      } else {
        opex[m] = opex[m] * (1 - abatement.partialRate);
      }
    }
  }
  for (const abatement of normalizedParkingAbatements) {
    for (let m = abatement.start; m <= abatement.end; m += 1) {
      if (abatement.type === "full") {
        parking[m] = 0;
      } else {
        parking[m] = parking[m] * (1 - abatement.partialRate);
      }
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
  const tiBudgetTotal = Math.max(0, Number(scenario.tiSchedule.budgetTotal) || 0);
  const tiAllowanceTotal = Math.max(0, Number(scenario.tiSchedule.allowanceFromLandlord) || 0);
  const tiNetAt0 = tiBudgetTotal - tiAllowanceTotal;
  applyTiMonthZeroAdjustments(
    total,
    tiBudgetTotal,
    tiAllowanceTotal,
    termMonths
  );

  const monthlyRate = Math.pow(1 + discountRate, 1 / 12) - 1;
  const oneTimeMonth0 = (scenario.otherCashFlows.oneTimeCosts ?? []).reduce(
    (sum, cost) => sum + ((cost.month ?? 0) === 0 ? (Number(cost.amount) || 0) : 0),
    0
  );
  const upfrontAt0 =
    (Number(scenario.otherCashFlows.brokerFee) || 0) +
    ((Number(scenario.otherCashFlows.securityDepositMonths) || 0) > 0
      ? firstMonthRent * (Number(scenario.otherCashFlows.securityDepositMonths) || 0)
      : 0) +
    oneTimeMonth0 +
    tiNetAt0;
  const recurringMonth0 = (total[0] ?? 0) - upfrontAt0;
  let cumulative = 0;

  const monthly: MonthlyRow[] = [];
  for (let m = 0; m < termMonths; m++) {
    cumulative += total[m];
    const pv = monthlyRate > 0
      ? (
        m === 0
          ? upfrontAt0 + (recurringMonth0 / (1 + monthlyRate))
          : total[m] / Math.pow(1 + monthlyRate, m + 1)
      )
      : total[m];
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
  const baseAbatementValue = baseRentBeforeAbatement.reduce(
    (sum, value, idx) => sum + Math.max(0, value - (baseRent[idx] ?? 0)),
    0
  );
  const opexAbatementValue = opexBeforeAbatement.reduce(
    (sum, value, idx) => sum + Math.max(0, value - (opex[idx] ?? 0)),
    0
  );
  const abatementAmount = Math.max(0, baseAbatementValue + opexAbatementValue);
  const npv = monthlyRate > 0
    ? total.reduce((acc, cf, t) => {
      if (t === 0) return acc + upfrontAt0 + (recurringMonth0 / (1 + monthlyRate));
      return acc + (cf / Math.pow(1 + monthlyRate, t + 1));
    }, 0)
    : total.reduce((acc, cf) => acc + cf, 0);
  const years = termMonths / 12;
  const avgRsfTerm = effectiveRsf.length > 0 ? effectiveRsf.reduce((a, b) => a + b, 0) / effectiveRsf.length : rsf;
  const avgCostYear = years > 0 ? totalObligation / years : 0;
  const avgCostPsfYr = avgRsfTerm > 0 ? avgCostYear / avgRsfTerm : 0;
  const equalizedAvgPsfYr = avgRsfTerm > 0 && years > 0 ? totalObligation / years / avgRsfTerm : 0;
  const contractualBaseRentTotal = baseRentBeforeAbatement.reduce((a, b) => a + b, 0);
  const avgBaseRentPsfYr =
    avgRsfTerm > 0 && years > 0
      ? contractualBaseRentTotal / years / avgRsfTerm
      : (scenario.rentSchedule.steps[0]?.ratePsfYr ?? 0);

  const buildingName = (scenario.partyAndPremises.premisesLabel ?? "").trim();
  const suiteName = (scenario.partyAndPremises.floorsOrSuite ?? "").trim();
  const totalParkingSlots = (scenario.parkingSchedule.slots ?? []).reduce((sum, slot) => sum + Math.max(0, slot.count || 0), 0);
  const parkingTaxPct = Math.max(0, Number(scenario.parkingSchedule.salesTaxPercent ?? 0) || 0);
  const parkingCostPerSpotMonthlyPreTax =
    totalParkingSlots > 0
      ? ((scenario.parkingSchedule.slots ?? []).reduce(
          (sum, slot) => sum + (Math.max(0, Number(slot.costPerSpacePerMonth) || 0) * Math.max(0, Number(slot.count) || 0)),
          0
        ) / totalParkingSlots)
      : 0;
  const parkingCostPerSpotMonthly = parkingCostPerSpotMonthlyPreTax * (1 + parkingTaxPct);
  const grossRentNominal = baseRent.reduce((a, b) => a + b, 0) + opex.reduce((a, b) => a + b, 0);
  const parkingNominal = parking.reduce((a, b) => a + b, 0);
  const parkingCostMonthly = parkingNominal / Math.max(1, termMonths);
  const metrics: OptionMetrics = {
    buildingName,
    suiteName,
    premisesName: scenario.partyAndPremises.premisesName || scenario.name,
    rsf,
    leaseType: scenario.expenseSchedule.leaseType,
    termMonths,
    commencementDate: comm,
    expirationDate: scenario.datesAndTerm.expirationDate,
    baseRentPsfYr: avgBaseRentPsfYr,
    escalationPercent: scenario.rentSchedule.annualEscalationPercent * 100,
    abatementAmount,
    abatementType: formatAbatementType(normalizedAbatements),
    abatementAppliedWhen: formatAbatementAppliedWhen(normalizedAbatements),
    opexPsfYr: scenario.expenseSchedule.baseOpexPsfYr,
    opexEscalationPercent: scenario.expenseSchedule.annualEscalationPercent * 100,
    parkingCostPerSpotMonthlyPreTax,
    parkingCostPerSpotMonthly,
    parkingSalesTaxPercent: parkingTaxPct,
    parkingCostMonthly,
    parkingCostAnnual: years > 0 ? (parkingNominal / years) : parkingNominal,
    tiBudget: rsf > 0 ? scenario.tiSchedule.budgetTotal / rsf : 0,
    tiAllowance: rsf > 0 ? scenario.tiSchedule.allowanceFromLandlord / rsf : 0,
    tiOutOfPocket: scenario.tiSchedule.outOfPocket,
    grossTiOutOfPocket: scenario.tiSchedule.grossOutOfPocket ?? scenario.tiSchedule.outOfPocket,
    avgGrossRentPerMonth: grossRentNominal / (termMonths || 1),
    avgGrossRentPerYear: years > 0 ? (grossRentNominal / years) : 0,
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
