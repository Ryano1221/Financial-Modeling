import type { SharedExportBranding } from "@/lib/export-design";
import type { EqualizedComparisonResult, EqualizedScenarioMetrics } from "@/lib/equalized";
import type { EngineResult, MonthlyRow, OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import { METRIC_LABELS } from "@/lib/lease-engine/excel-export";
import {
  buildPlatformShareLink,
  parsePlatformShareData,
  type PlatformShareEnvelope,
} from "@/lib/platform-share";
import type { CanonicalComputeResponse, CustomChartExportConfig } from "@/lib/types";

export interface FinancialAnalysesShareScenarioRow {
  id: string;
  scenarioName: string;
  documentType: string;
  buildingName: string;
  suiteFloor: string;
  address: string;
  leaseType: string;
  rsf: number;
  commencementDate: string;
  expirationDate: string;
  termMonths: number;
  totalObligation: number;
  npvCost: number;
  avgCostPsfYear: number;
  equalizedAvgCostPsfYear: number;
}

type FinancialAnalysesShareMetricKey = Exclude<(typeof METRIC_LABELS)[number], "equalizedAvgCostPsfYr">;

export const FINANCIAL_ANALYSES_SHARE_METRIC_KEYS: readonly FinancialAnalysesShareMetricKey[] =
  METRIC_LABELS.filter((key): key is FinancialAnalysesShareMetricKey => key !== "equalizedAvgCostPsfYr");

type FinancialAnalysesShareMetricValue = string | number;
type FinancialAnalysesShareMetricTuple = FinancialAnalysesShareMetricValue[];
type FinancialAnalysesShareEqualizedTuple = [
  scenarioId: string,
  averageGrossRentPsfYear: number,
  averageGrossRentMonth: number,
  averageCostPsfYear: number,
  averageCostYear: number,
  averageCostMonth: number,
  totalCost: number,
  npvCost: number,
];
export type FinancialAnalysesShareAnnualTuple = [
  leaseYear: number,
  baseRent: number,
  opex: number,
  parking: number,
  tiConcessions: number,
  total: number,
  discounted: number,
];

export interface FinancialAnalysesShareMetricSnapshot {
  i: string;
  n: string;
  v: FinancialAnalysesShareMetricTuple;
}

export interface FinancialAnalysesShareEqualizedSnapshot {
  needsCustomWindow: boolean;
  message: string;
  windowStart: string;
  windowEnd: string;
  windowSource: "overlap" | "custom";
  rows: FinancialAnalysesShareEqualizedTuple[];
}

export interface FinancialAnalysesShareChartSnapshot {
  title: string;
  barMetricKey: string;
  barMetricLabel: string;
  lineMetricKey: string;
  lineMetricLabel: string;
  sortDirection: "asc" | "desc";
}

export interface FinancialAnalysesShareAnnualScenarioSnapshot {
  i: string;
  r: FinancialAnalysesShareAnnualTuple[];
}

export interface FinancialAnalysesSharePayload {
  scenarios: FinancialAnalysesShareScenarioRow[];
  equalizedWindow: {
    start: string;
    end: string;
    source: "overlap" | "custom";
  } | null;
  m?: FinancialAnalysesShareMetricSnapshot[];
  e?: FinancialAnalysesShareEqualizedSnapshot | null;
  c?: FinancialAnalysesShareChartSnapshot[];
  a?: FinancialAnalysesShareAnnualScenarioSnapshot[];
}

export type FinancialAnalysesShareEnvelope = PlatformShareEnvelope<FinancialAnalysesSharePayload>;

export interface FinancialAnalysesShareViewModel {
  scenarios: FinancialAnalysesShareScenarioRow[];
  results: EngineResult[];
  equalized: EqualizedComparisonResult | null;
  charts: FinancialAnalysesShareChartSnapshot[];
  annualByScenario: Record<string, FinancialAnalysesShareAnnualTuple[]>;
}

function roundShareNumber(value: unknown, decimals: number = 2): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function metricValueForShare(value: unknown): FinancialAnalysesShareMetricValue {
  if (typeof value === "number") return roundShareNumber(value, 4);
  return String(value ?? "").trim();
}

function emptyOptionMetrics(): OptionMetrics {
  return {
    buildingName: "",
    suiteName: "",
    premisesName: "",
    rsf: 0,
    leaseType: "",
    termMonths: 0,
    commencementDate: "",
    expirationDate: "",
    baseRentPsfYr: 0,
    escalationPercent: 0,
    abatementAmount: 0,
    abatementType: "",
    abatementAppliedWhen: "",
    opexPsfYr: 0,
    opexEscalationPercent: 0,
    parkingCostPerSpotMonthlyPreTax: 0,
    parkingCostPerSpotMonthly: 0,
    parkingSalesTaxPercent: 0,
    parkingSpaces: 0,
    parkingCostMonthly: 0,
    parkingCostAnnual: 0,
    tiBudget: 0,
    tiAllowance: 0,
    tiOutOfPocket: 0,
    grossTiOutOfPocket: 0,
    avgGrossRentPerMonth: 0,
    avgGrossRentPerYear: 0,
    avgAllInCostPerMonth: 0,
    avgAllInCostPerYear: 0,
    avgCostPsfYr: 0,
    npvAtDiscount: 0,
    commissionPercent: 0,
    commissionBasis: "",
    commissionAmount: 0,
    netEffectiveRatePsfYr: 0,
    discountRateUsed: 0,
    totalObligation: 0,
    equalizedAvgCostPsfYr: 0,
    parkingAbatementMonths: 0,
    notes: "",
  };
}

function packMetrics(metrics: OptionMetrics): FinancialAnalysesShareMetricTuple {
  return FINANCIAL_ANALYSES_SHARE_METRIC_KEYS.map((key) => metricValueForShare(metrics[key]));
}

function unpackMetrics(values: FinancialAnalysesShareMetricTuple): OptionMetrics {
  const metrics = emptyOptionMetrics();
  const mutableMetrics = metrics as unknown as Record<string, unknown>;
  FINANCIAL_ANALYSES_SHARE_METRIC_KEYS.forEach((key, index) => {
    const template = metrics[key];
    const raw = values[index];
    if (typeof template === "number") {
      mutableMetrics[key] = roundShareNumber(raw, 4);
      return;
    }
    mutableMetrics[key] = String(raw ?? "").trim();
  });
  return metrics;
}

function toMonthlyRows(
  result: EngineResult,
  canonicalByScenarioId?: Record<string, CanonicalComputeResponse>,
): MonthlyRow[] {
  const canonical = canonicalByScenarioId?.[result.scenarioId];
  if (canonical?.monthly_rows?.length) {
    return canonical.monthly_rows.map((row, index) => ({
      monthIndex: Math.max(0, Math.floor(Number(row.month_index ?? index) || index)),
      periodStart: String(row.date || ""),
      periodEnd: String(row.date || ""),
      baseRent: roundShareNumber(row.base_rent),
      opex: roundShareNumber(row.opex),
      parking: roundShareNumber(row.parking),
      tiAmortization: roundShareNumber(row.ti_amort),
      misc: roundShareNumber(row.concessions),
      total: roundShareNumber(row.total_cost),
      effectivePsfYr: 0,
      cumulativeCost: 0,
      discountedValue: roundShareNumber(row.discounted_value),
    }));
  }
  return result.monthly;
}

function buildLeaseYearAnnualRows(
  result: EngineResult,
  canonicalByScenarioId?: Record<string, CanonicalComputeResponse>,
): FinancialAnalysesShareAnnualTuple[] {
  const monthly = toMonthlyRows(result, canonicalByScenarioId);
  const byYear = new Map<number, FinancialAnalysesShareAnnualTuple>();
  const month0 = monthly.find((row) => row.monthIndex === 0);
  const month0Unallocated = month0
    ? Number(month0.total || 0) - (Number(month0.baseRent || 0) + Number(month0.opex || 0) + Number(month0.parking || 0) + Number(month0.tiAmortization || 0))
    : 0;
  const plcTotal = roundShareNumber((month0?.tiAmortization || 0) + month0Unallocated);
  byYear.set(0, [0, 0, 0, 0, plcTotal, plcTotal, plcTotal]);

  monthly.forEach((row) => {
    if (row.monthIndex === 0) return;
    const year = Math.floor((Math.max(1, Number(row.monthIndex || 0)) - 1) / 12) + 1;
    const existing = byYear.get(year) || [year, 0, 0, 0, 0, 0, 0];
    existing[1] = roundShareNumber(existing[1] + Number(row.baseRent || 0));
    existing[2] = roundShareNumber(existing[2] + Number(row.opex || 0));
    existing[3] = roundShareNumber(existing[3] + Number(row.parking || 0));
    existing[4] = roundShareNumber(existing[4] + Number(row.tiAmortization || 0) + Number(row.misc || 0));
    existing[5] = roundShareNumber(existing[5] + Number(row.total || 0));
    existing[6] = roundShareNumber(existing[6] + Number(row.discountedValue || 0));
    byYear.set(year, existing);
  });

  return Array.from(byYear.values()).sort((left, right) => left[0] - right[0]);
}

export function buildFinancialAnalysesSharePayload(input: {
  scenarioRows: FinancialAnalysesShareScenarioRow[];
  results: EngineResult[];
  equalized: EqualizedComparisonResult;
  customCharts?: CustomChartExportConfig[];
  canonicalByScenarioId?: Record<string, CanonicalComputeResponse>;
}): FinancialAnalysesSharePayload {
  const metricsSnapshots: FinancialAnalysesShareMetricSnapshot[] = input.results.map((result) => ({
    i: result.scenarioId,
    n: result.scenarioName,
    v: packMetrics(result.metrics),
  }));

  const equalizedRows = Object.values(input.equalized.metricsByScenario || {}).map((metric): FinancialAnalysesShareEqualizedTuple => [
    metric.scenarioId,
    roundShareNumber(metric.averageGrossRentPsfYear, 4),
    roundShareNumber(metric.averageGrossRentMonth, 2),
    roundShareNumber(metric.averageCostPsfYear, 4),
    roundShareNumber(metric.averageCostYear, 2),
    roundShareNumber(metric.averageCostMonth, 2),
    roundShareNumber(metric.totalCost, 2),
    roundShareNumber(metric.npvCost, 2),
  ]);

  const annualSnapshots: FinancialAnalysesShareAnnualScenarioSnapshot[] = input.results.map((result) => ({
    i: result.scenarioId,
    r: buildLeaseYearAnnualRows(result, input.canonicalByScenarioId),
  }));

  const chartSnapshots: FinancialAnalysesShareChartSnapshot[] = (input.customCharts || []).map((chart) => ({
    title: String(chart.title || "").trim(),
    barMetricKey: String(chart.bar_metric_key || "").trim(),
    barMetricLabel: String(chart.bar_metric_label || "").trim(),
    lineMetricKey: String(chart.line_metric_key || "").trim(),
    lineMetricLabel: String(chart.line_metric_label || "").trim(),
    sortDirection: chart.sort_direction === "asc" ? "asc" : "desc",
  }));

  return {
    scenarios: input.scenarioRows,
    equalizedWindow: input.equalized.windowStart && input.equalized.windowEnd
      ? {
          start: input.equalized.windowStart,
          end: input.equalized.windowEnd,
          source: input.equalized.windowSource || "overlap",
        }
      : null,
    m: metricsSnapshots,
    e: {
      needsCustomWindow: Boolean(input.equalized.needsCustomWindow),
      message: String(input.equalized.message || "").trim(),
      windowStart: String(input.equalized.windowStart || "").trim(),
      windowEnd: String(input.equalized.windowEnd || "").trim(),
      windowSource: input.equalized.windowSource || "overlap",
      rows: equalizedRows,
    },
    c: chartSnapshots,
    a: annualSnapshots,
  };
}

export function materializeFinancialAnalysesSharePayload(
  payload: FinancialAnalysesSharePayload,
): FinancialAnalysesShareViewModel {
  const results: EngineResult[] = Array.isArray(payload.m)
    ? payload.m.map((row) => {
        const metrics = unpackMetrics(Array.isArray(row.v) ? row.v : []);
        return {
          scenarioId: row.i,
          scenarioName: row.n,
          termMonths: Math.max(0, Number(metrics.termMonths || 0)),
          monthly: [],
          annual: [],
          metrics,
          discountRateUsed: Math.max(0, Number(metrics.discountRateUsed || 0)),
        };
      })
    : [];

  const equalizedMetricsByScenario = ((payload.e?.rows || []) as FinancialAnalysesShareEqualizedTuple[]).reduce<Record<string, EqualizedScenarioMetrics>>((acc, row) => {
    const [
      scenarioId,
      averageGrossRentPsfYear,
      averageGrossRentMonth,
      averageCostPsfYear,
      averageCostYear,
      averageCostMonth,
      totalCost,
      npvCost,
    ] = row;
    acc[scenarioId] = {
      scenarioId,
      averageGrossRentPsfYear: roundShareNumber(averageGrossRentPsfYear, 4),
      averageGrossRentMonth: roundShareNumber(averageGrossRentMonth, 2),
      averageCostPsfYear: roundShareNumber(averageCostPsfYear, 4),
      averageCostYear: roundShareNumber(averageCostYear, 2),
      averageCostMonth: roundShareNumber(averageCostMonth, 2),
      totalCost: roundShareNumber(totalCost, 2),
      npvCost: roundShareNumber(npvCost, 2),
    };
    return acc;
  }, {});

  const hasEqualizedSnapshot = Boolean(payload.e) || Boolean(payload.equalizedWindow);
  const equalized: EqualizedComparisonResult | null = hasEqualizedSnapshot
    ? {
        hasOverlap: !Boolean(payload.e?.needsCustomWindow),
        needsCustomWindow: Boolean(payload.e?.needsCustomWindow),
        message: String(payload.e?.message || "").trim(),
        windowStart: String(payload.e?.windowStart || payload.equalizedWindow?.start || "").trim(),
        windowEnd: String(payload.e?.windowEnd || payload.equalizedWindow?.end || "").trim(),
        windowDays: 0,
        windowMonthCount: 0,
        windowSource: payload.e?.windowSource || payload.equalizedWindow?.source || "overlap",
        metricsByScenario: equalizedMetricsByScenario,
      }
    : null;

  const annualByScenario = ((payload.a || []) as FinancialAnalysesShareAnnualScenarioSnapshot[]).reduce<Record<string, FinancialAnalysesShareAnnualTuple[]>>((acc, row) => {
    acc[row.i] = Array.isArray(row.r) ? row.r : [];
    return acc;
  }, {});

  return {
    scenarios: Array.isArray(payload.scenarios) ? payload.scenarios : [],
    results,
    equalized,
    charts: Array.isArray(payload.c) ? payload.c : [],
    annualByScenario,
  };
}

export function buildFinancialAnalysesShareLink(
  payload: FinancialAnalysesSharePayload,
  branding?: SharedExportBranding | null,
): string {
  return buildPlatformShareLink(
    "/financial-analyses/share",
    "financial-analyses",
    payload,
    branding,
  );
}

export function parseFinancialAnalysesShareData(
  encoded: string | null | undefined,
): FinancialAnalysesShareEnvelope | null {
  const parsed = parsePlatformShareData<FinancialAnalysesSharePayload>(
    encoded,
    "financial-analyses",
  );
  if (!parsed || !Array.isArray(parsed.payload.scenarios)) return null;
  return parsed;
}
