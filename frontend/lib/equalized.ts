import type { ScenarioWithId } from "@/lib/types";
import { scenarioToCanonical, runMonthlyEngine } from "@/lib/lease-engine";

export interface EqualizedWindowInput {
  start: string;
  end: string;
}

export interface EqualizedScenarioMetrics {
  scenarioId: string;
  averageGrossRentPsfYear: number;
  averageGrossRentMonth: number;
  averageCostPsfYear: number;
  averageCostYear: number;
  averageCostMonth: number;
  totalCost: number;
  npvCost: number;
}

export interface EqualizedComparisonResult {
  hasOverlap: boolean;
  needsCustomWindow: boolean;
  message: string;
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  windowMonthCount: number;
  windowSource: "overlap" | "custom";
  metricsByScenario: Record<string, EqualizedScenarioMetrics>;
}

function parseDateValue(raw: string): Date | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() === y &&
      parsed.getUTCMonth() + 1 === m &&
      parsed.getUTCDate() === d
    ) {
      return parsed;
    }
  }

  const mdy = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (mdy) {
    const m = Number(mdy[1]);
    const d = Number(mdy[2]);
    const y = Number(mdy[3]);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() === y &&
      parsed.getUTCMonth() + 1 === m &&
      parsed.getUTCDate() === d
    ) {
      return parsed;
    }
  }

  return null;
}

function dateToIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function diffDays(start: Date, endExclusive: Date): number {
  const ms = endExclusive.getTime() - start.getTime();
  if (ms <= 0) return 0;
  return ms / 86_400_000;
}

function clampOverlapDays(
  periodStart: Date,
  periodEndExclusive: Date,
  windowStart: Date,
  windowEndExclusive: Date
): number {
  const startMs = Math.max(periodStart.getTime(), windowStart.getTime());
  const endMs = Math.min(periodEndExclusive.getTime(), windowEndExclusive.getTime());
  if (endMs <= startMs) return 0;
  return (endMs - startMs) / 86_400_000;
}

function computeMonthCount(start: Date, endInclusive: Date): number {
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), 1));
  let total = 0;

  while (cursor.getTime() <= stop.getTime()) {
    const monthStart = cursor;
    const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const monthEndInclusive = addDays(nextMonthStart, -1);

    const overlapStart = new Date(Math.max(monthStart.getTime(), start.getTime()));
    const overlapEnd = new Date(Math.min(monthEndInclusive.getTime(), endInclusive.getTime()));
    if (overlapEnd.getTime() >= overlapStart.getTime()) {
      const overlapDaysInclusive = diffDays(overlapStart, addDays(overlapEnd, 1));
      const daysInMonth = diffDays(monthStart, nextMonthStart);
      total += overlapDaysInclusive / Math.max(1, daysInMonth);
    }

    cursor = nextMonthStart;
  }

  return total;
}

function isValidWindow(start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  return end.getTime() > start.getTime();
}

export function computeEqualizedComparison(
  scenarios: ScenarioWithId[],
  globalDiscountRate: number,
  customWindow?: EqualizedWindowInput | null
): EqualizedComparisonResult {
  const empty: EqualizedComparisonResult = {
    hasOverlap: false,
    needsCustomWindow: false,
    message: "",
    windowStart: "",
    windowEnd: "",
    windowDays: 0,
    windowMonthCount: 0,
    windowSource: "overlap",
    metricsByScenario: {},
  };

  if (scenarios.length === 0) return empty;
  const eligibleScenarios = scenarios.filter((scenario) => !scenario.is_remaining_obligation);
  if (eligibleScenarios.length === 0) return empty;

  const parsedCommencements = eligibleScenarios
    .map((s) => parseDateValue(s.commencement))
    .filter((d): d is Date => d !== null);
  const parsedExpirations = eligibleScenarios
    .map((s) => parseDateValue(s.expiration))
    .filter((d): d is Date => d !== null);

  if (parsedCommencements.length !== eligibleScenarios.length || parsedExpirations.length !== eligibleScenarios.length) {
    return {
      ...empty,
      needsCustomWindow: true,
      message: "Unable to derive overlap from scenario dates. Enter a custom equalized start and end date.",
    };
  }

  const overlapStart = new Date(Math.max(...parsedCommencements.map((d) => d.getTime())));
  const overlapEnd = new Date(Math.min(...parsedExpirations.map((d) => d.getTime())));

  const customStart = parseDateValue(customWindow?.start || "");
  const customEnd = parseDateValue(customWindow?.end || "");
  const hasCustom = isValidWindow(customStart, customEnd);

  const hasNaturalOverlap = overlapEnd.getTime() > overlapStart.getTime();
  const useCustomWindow = !hasNaturalOverlap && hasCustom;
  if (!hasNaturalOverlap && !useCustomWindow) {
    return {
      ...empty,
      needsCustomWindow: true,
      message: "No overlapping lease term for equalized comparison. Enter a custom comparison start and end date.",
    };
  }

  const windowStart = useCustomWindow ? customStart! : overlapStart;
  const windowEnd = useCustomWindow ? customEnd! : overlapEnd;
  const windowEndExclusive = addDays(windowEnd, 1);
  const windowDays = diffDays(windowStart, windowEndExclusive);
  const windowMonthCount = computeMonthCount(windowStart, windowEnd);

  const metricsByScenario: Record<string, EqualizedScenarioMetrics> = {};

  for (const scenario of eligibleScenarios) {
    const canonical = scenarioToCanonical(scenario);
    const fullEngine = runMonthlyEngine(canonical, globalDiscountRate);
    const grossEngine = runMonthlyEngine(
      {
        ...canonical,
        rentSchedule: {
          ...canonical.rentSchedule,
          abatement: undefined,
          abatements: undefined,
        },
      },
      globalDiscountRate
    );

    let grossRentInWindow = 0;
    let totalCostInWindow = 0;
    let npvCost = 0;

    for (let i = 0; i < fullEngine.monthly.length; i += 1) {
      const row = fullEngine.monthly[i];
      const grossRow = grossEngine.monthly[i];
      if (!row || !grossRow) continue;

      const periodStart = parseDateValue(row.periodStart);
      const periodEndExclusive = parseDateValue(row.periodEnd);
      if (!periodStart || !periodEndExclusive) continue;

      const periodDays = diffDays(periodStart, periodEndExclusive);
      if (periodDays <= 0) continue;

      const overlapDays = clampOverlapDays(periodStart, periodEndExclusive, windowStart, windowEndExclusive);
      if (overlapDays <= 0) continue;

      const fraction = overlapDays / periodDays;
      grossRentInWindow += grossRow.baseRent * fraction;
      const clippedTotal = row.total * fraction;
      totalCostInWindow += clippedTotal;
      // NPV should follow underwriting stream/timing from the main engine.
      npvCost += Number.isFinite(row.discountedValue) ? row.discountedValue : 0;
    }

    const rsf = Math.max(0, Number(scenario.rsf) || 0);
    const monthDivisor = windowMonthCount > 0 ? windowMonthCount : 0;
    const annualizedDivisor =
      monthDivisor > 0 ? monthDivisor / 12 : windowDays > 0 ? windowDays / 365 : 0;

    metricsByScenario[scenario.id] = {
      scenarioId: scenario.id,
      averageGrossRentPsfYear:
        rsf > 0 && annualizedDivisor > 0 ? grossRentInWindow / rsf / annualizedDivisor : 0,
      averageGrossRentMonth: monthDivisor > 0 ? grossRentInWindow / monthDivisor : 0,
      averageCostPsfYear:
        rsf > 0 && annualizedDivisor > 0 ? totalCostInWindow / rsf / annualizedDivisor : 0,
      averageCostYear: annualizedDivisor > 0 ? totalCostInWindow / annualizedDivisor : 0,
      averageCostMonth: monthDivisor > 0 ? totalCostInWindow / monthDivisor : 0,
      totalCost: totalCostInWindow,
      npvCost,
    };
  }

  return {
    hasOverlap: hasNaturalOverlap,
    needsCustomWindow: false,
    message: "",
    windowStart: dateToIso(windowStart),
    windowEnd: dateToIso(windowEnd),
    windowDays,
    windowMonthCount,
    windowSource: useCustomWindow ? "custom" : "overlap",
    metricsByScenario,
  };
}
