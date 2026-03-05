"use client";

import { useMemo, useState } from "react";
import type { EngineResult, OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import type { CanonicalComputeResponse } from "@/lib/types";
import { formatCurrency, formatCurrencyPerSF, formatNumber, formatPercent } from "@/lib/format";

type TabKey = "charts" | "annual";
type AnnualMode = "lease_year" | "calendar_year";
type SortDirection = "desc" | "asc";

type MetricSpec = {
  key: keyof OptionMetrics;
  label: string;
  format: (value: number) => string;
};

type MonthlyPoint = {
  monthIndex: number;
  date: string;
  baseRent: number;
  opex: number;
  parking: number;
  tiConcessions: number;
  total: number;
  discounted: number;
};

type AnnualAggregateRow = {
  key: number;
  label: string;
  baseRent: number;
  opex: number;
  parking: number;
  tiConcessions: number;
  total: number;
  discounted: number;
};

const METRIC_OPTIONS: MetricSpec[] = [
  { key: "avgCostPsfYr", label: "Avg Cost/SF/YR", format: (value) => formatCurrencyPerSF(value) },
  { key: "npvAtDiscount", label: "NPV @ Discount Rate", format: (value) => formatCurrency(value) },
  { key: "avgAllInCostPerYear", label: "Avg All-In Cost/Year", format: (value) => formatCurrency(value) },
  { key: "totalObligation", label: "Total Estimated Obligation", format: (value) => formatCurrency(value) },
  { key: "avgGrossRentPerYear", label: "Avg Gross Rent/Year", format: (value) => formatCurrency(value) },
  { key: "avgGrossRentPerMonth", label: "Avg Gross Rent/Month", format: (value) => formatCurrency(value) },
  { key: "baseRentPsfYr", label: "Base Rent ($/SF/YR)", format: (value) => formatCurrencyPerSF(value) },
  { key: "opexPsfYr", label: "Operating Expenses ($/SF/YR)", format: (value) => formatCurrencyPerSF(value) },
  { key: "netEffectiveRatePsfYr", label: "NER (Net Effective Rate)", format: (value) => formatCurrencyPerSF(value) },
  { key: "commissionAmount", label: "Commission", format: (value) => formatCurrency(value) },
  { key: "abatementAmount", label: "Abatement Amount", format: (value) => formatCurrency(value) },
  { key: "tiBudget", label: "TI Budget ($/SF)", format: (value) => formatCurrencyPerSF(value) },
  { key: "tiAllowance", label: "TI Allowance ($/SF)", format: (value) => formatCurrencyPerSF(value) },
  { key: "parkingSpaces", label: "Parking Spaces", format: (value) => formatNumber(value) },
  { key: "parkingCostAnnual", label: "Parking Cost (Annual)", format: (value) => formatCurrency(value) },
  { key: "parkingSalesTaxPercent", label: "Parking Sales Tax %", format: (value) => formatPercent(value) },
];

const DEFAULT_METRIC_KEY: keyof OptionMetrics = "avgCostPsfYr";

const BAR_COLORS = [
  "from-cyan-400 to-blue-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-pink-400 to-rose-500",
];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCurrency(value: number): number {
  return Math.round(toNumber(value) * 100) / 100;
}

function monthlyPointsForScenario(
  result: EngineResult,
  canonicalByScenarioId: Record<string, CanonicalComputeResponse> | undefined
): MonthlyPoint[] {
  const canonical = canonicalByScenarioId?.[result.scenarioId];
  if (canonical?.monthly_rows?.length) {
    return canonical.monthly_rows.map((row) => ({
      monthIndex: Math.max(0, Math.floor(toNumber(row.month_index))),
      date: String(row.date || ""),
      baseRent: toNumber(row.base_rent),
      opex: toNumber(row.opex),
      parking: toNumber(row.parking),
      tiConcessions: toNumber(row.ti_amort) + toNumber(row.concessions),
      total: toNumber(row.total_cost),
      discounted: toNumber(row.discounted_value),
    }));
  }

  return result.monthly.map((row) => ({
    monthIndex: Math.max(0, Math.floor(toNumber(row.monthIndex))),
    date: String(row.periodStart || ""),
    baseRent: toNumber(row.baseRent),
    opex: toNumber(row.opex),
    parking: toNumber(row.parking),
    tiConcessions: toNumber(row.tiAmortization) + toNumber(row.misc),
    total: toNumber(row.total),
    discounted: toNumber(row.discountedValue),
  }));
}

function annualAggregate(points: MonthlyPoint[], mode: AnnualMode): AnnualAggregateRow[] {
  const byKey = new Map<number, AnnualAggregateRow>();

  if (mode === "lease_year") {
    const month0 = points.find((point) => point.monthIndex === 0);
    const month0Unallocated = month0
      ? month0.total - (month0.baseRent + month0.opex + month0.parking + month0.tiConcessions)
      : 0;
    const year0TiNet = roundCurrency((month0?.tiConcessions || 0) + month0Unallocated);
    byKey.set(0, {
      key: 0,
      label: "Lease Year 0 (PLC)",
      baseRent: 0,
      opex: 0,
      parking: 0,
      // Explicitly isolate TI budget less TI allowance/credits in Year 0.
      tiConcessions: year0TiNet,
      total: year0TiNet,
      discounted: year0TiNet,
    });
  }

  for (const point of points) {
    if (mode === "lease_year" && point.monthIndex === 0) {
      continue
    }
    const key = mode === "lease_year"
      ? Math.floor((point.monthIndex - 1) / 12) + 1
      : (() => {
          const year = Number(String(point.date || "").slice(0, 4));
          return Number.isFinite(year) ? year : 0;
        })();
    if (!Number.isFinite(key) || key <= 0) continue;

    const existing = byKey.get(key) ?? {
      key,
      label: mode === "lease_year" ? `Lease Year ${key}` : String(key),
      baseRent: 0,
      opex: 0,
      parking: 0,
      tiConcessions: 0,
      total: 0,
      discounted: 0,
    };
    existing.baseRent += point.baseRent;
    existing.opex += point.opex;
    existing.parking += point.parking;
    existing.tiConcessions += point.tiConcessions;
    existing.total += point.total;
    existing.discounted += point.discounted;
    byKey.set(key, existing);
  }

  return Array.from(byKey.values()).sort((a, b) => a.key - b.key);
}

function CombinedMetricChart({
  metric,
  rows,
  sortDirection,
}: {
  metric: MetricSpec;
  rows: EngineResult[];
  sortDirection: SortDirection;
}) {
  const sorted = [...rows].sort((a, b) => {
    const av = toNumber((a.metrics as OptionMetrics)[metric.key]);
    const bv = toNumber((b.metrics as OptionMetrics)[metric.key]);
    return sortDirection === "asc" ? av - bv : bv - av;
  });
  const maxValue = Math.max(1, ...sorted.map((row) => toNumber((row.metrics as OptionMetrics)[metric.key])));

  return (
    <div className="surface-card p-4 sm:p-5">
      <h3 className="text-base font-semibold text-slate-100 mb-4 tracking-tight">{metric.label}</h3>
      <div className="space-y-3">
        {sorted.map((row, index) => {
          const value = toNumber((row.metrics as OptionMetrics)[metric.key]);
          const widthPct = clampPercent((value / maxValue) * 100);
          const colorClass = BAR_COLORS[index % BAR_COLORS.length];
          return (
            <div key={`${metric.key}-${row.scenarioId}`} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-200 truncate max-w-[58%] sm:max-w-[65%]" title={row.scenarioName}>
                  {row.scenarioName}
                </span>
                <span className="text-xs text-slate-300">{metric.format(value)}</span>
              </div>
              <div className="h-2 bg-slate-600/35 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 bg-gradient-to-r ${colorClass}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AnalyticsWorkbench({
  results,
  canonicalByScenarioId,
}: {
  results: EngineResult[];
  canonicalByScenarioId?: Record<string, CanonicalComputeResponse>;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("charts");
  const [annualMode, setAnnualMode] = useState<AnnualMode>("lease_year");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [activeMetricKey, setActiveMetricKey] = useState<keyof OptionMetrics>(DEFAULT_METRIC_KEY);

  const selectedMetric = useMemo(
    () => METRIC_OPTIONS.find((metric) => metric.key === activeMetricKey) ?? METRIC_OPTIONS[0],
    [activeMetricKey]
  );

  const annualRowsByScenario = useMemo(() => {
    const out: Record<string, AnnualAggregateRow[]> = {};
    for (const result of results) {
      const monthly = monthlyPointsForScenario(result, canonicalByScenarioId);
      out[result.scenarioId] = annualAggregate(monthly, annualMode);
    }
    return out;
  }, [results, canonicalByScenarioId, annualMode]);

  if (results.length === 0) return null;

  return (
    <div className="surface-card p-5 sm:p-6 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="heading-kicker mb-1">Visual Analytics</p>
          <h2 className="heading-section">Charts and Cash Flow</h2>
        </div>
        <div className="inline-flex border border-slate-300/20 bg-slate-900/40">
          <button
            type="button"
            onClick={() => setActiveTab("charts")}
            className={`px-3 py-2 text-xs sm:text-sm ${activeTab === "charts" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300 hover:bg-slate-800/60"}`}
          >
            Custom Charts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("annual")}
            className={`px-3 py-2 text-xs sm:text-sm border-l border-slate-300/20 ${activeTab === "annual" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300 hover:bg-slate-800/60"}`}
          >
            Annual Cash Flow
          </button>
        </div>
      </div>

      {activeTab === "charts" ? (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-slate-400">Comparison metric</span>
              <select
                value={activeMetricKey}
                onChange={(e) => {
                  const next = e.target.value as keyof OptionMetrics;
                  if (METRIC_OPTIONS.some((metric) => metric.key === next)) {
                    setActiveMetricKey(next);
                  }
                }}
                className="input-premium mt-1"
              >
                {METRIC_OPTIONS.map((metric) => (
                  <option key={metric.key} value={metric.key}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Sort scenarios by selected metric</span>
              <select
                value={sortDirection}
                onChange={(e) => setSortDirection((e.target.value === "asc" ? "asc" : "desc"))}
                className="input-premium mt-1"
              >
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
          </div>

          <CombinedMetricChart metric={selectedMetric} rows={results} sortDirection={sortDirection} />
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-400">Annual basis:</span>
            <div className="inline-flex border border-slate-300/20 bg-slate-900/40">
              <button
                type="button"
                onClick={() => setAnnualMode("lease_year")}
                className={`px-3 py-2 text-xs sm:text-sm ${annualMode === "lease_year" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300 hover:bg-slate-800/60"}`}
              >
                Lease Year
              </button>
              <button
                type="button"
                onClick={() => setAnnualMode("calendar_year")}
                className={`px-3 py-2 text-xs sm:text-sm border-l border-slate-300/20 ${annualMode === "calendar_year" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300 hover:bg-slate-800/60"}`}
              >
                Calendar Year
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            {annualMode === "lease_year"
              ? "Lease Year rolls up every 12 months from lease commencement."
              : "Calendar Year rolls up by Jan-Dec year from monthly cash flows."}
          </p>

          <div className="space-y-4">
            {results.map((result) => {
              const annualRows = annualRowsByScenario[result.scenarioId] || [];
              return (
                <div key={`annual-${result.scenarioId}`} className="border border-slate-300/20 bg-slate-950/50 p-3">
                  <h3 className="text-sm font-semibold text-slate-100 mb-2">{result.scenarioName}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[780px] text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-slate-300/20 text-slate-300">
                          <th className="text-left py-2 pr-3">{annualMode === "lease_year" ? "Lease Year" : "Calendar Year"}</th>
                          <th className="text-right py-2 px-2">Base Rent</th>
                          <th className="text-right py-2 px-2">OpEx</th>
                          <th className="text-right py-2 px-2">Parking</th>
                          <th className="text-right py-2 px-2">
                            {annualMode === "lease_year" ? "TI Net (Budget-Allowance)" : "TI / Concessions"}
                          </th>
                          <th className="text-right py-2 px-2">Total</th>
                          <th className="text-right py-2 pl-2">Discounted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {annualRows.map((row) => (
                          <tr key={`${result.scenarioId}-${row.key}`} className="border-b border-slate-300/10 hover:bg-slate-400/10">
                            <td className="py-2 pr-3 text-slate-200">{row.label}</td>
                            <td className="py-2 px-2 text-right text-slate-300">{formatCurrency(row.baseRent)}</td>
                            <td className="py-2 px-2 text-right text-slate-300">{formatCurrency(row.opex)}</td>
                            <td className="py-2 px-2 text-right text-slate-300">{formatCurrency(row.parking)}</td>
                            <td className="py-2 px-2 text-right text-slate-300">{formatCurrency(row.tiConcessions)}</td>
                            <td className="py-2 px-2 text-right text-slate-100">{formatCurrency(row.total)}</td>
                            <td className="py-2 pl-2 text-right text-slate-300">{formatCurrency(row.discounted)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
