"use client";

import { useMemo, useState } from "react";
import type { EngineResult, OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import type { CanonicalComputeResponse } from "@/lib/types";
import { formatCurrency, formatCurrencyPerSF, formatNumber, formatPercent } from "@/lib/format";
import {
  Bar,
  BarChart,
  ComposedChart,
  CartesianGrid,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TabKey = "charts" | "annual";
type AnnualMode = "lease_year" | "calendar_year";
type SortDirection = "desc" | "asc";
type AnnualSeriesKey = "baseRent" | "opex" | "parking" | "tiConcessions" | "total" | "discounted";
type CustomChartConfig = {
  id: number;
  barMetricKey: keyof OptionMetrics;
  lineMetricKey: keyof OptionMetrics;
  sortDirection: SortDirection;
};

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

type AnnualSeriesSpec = {
  key: AnnualSeriesKey;
  label: string;
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
const DEFAULT_SECONDARY_METRIC_KEY: keyof OptionMetrics = "npvAtDiscount";

const BAR_COLORS = [
  "from-cyan-400 to-blue-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-pink-400 to-rose-500",
];

const ANNUAL_BAR_COLORS = ["#22d3ee", "#34d399", "#f59e0b", "#f472b6", "#60a5fa", "#a78bfa"];

const ANNUAL_SERIES_OPTIONS: AnnualSeriesSpec[] = [
  { key: "total", label: "Total" },
  { key: "discounted", label: "Discounted (Present Value)" },
  { key: "baseRent", label: "Base Rent" },
  { key: "opex", label: "OpEx" },
  { key: "parking", label: "Parking" },
  { key: "tiConcessions", label: "TI / Concessions" },
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

function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function formatAxisValue(metric: MetricSpec, value: number): string {
  const v = toNumber(value);
  switch (metric.key) {
    case "parkingSpaces":
      return formatNumber(Math.round(v));
    case "parkingSalesTaxPercent":
      return `${(v * 100).toFixed(1)}%`;
    case "avgCostPsfYr":
    case "baseRentPsfYr":
    case "opexPsfYr":
    case "netEffectiveRatePsfYr":
    case "tiBudget":
    case "tiAllowance":
      return `$${v.toFixed(1)}`;
    default:
      return formatCompactCurrency(v);
  }
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

function DualMetricComboChart({
  barMetric,
  lineMetric,
  rows,
  sortDirection,
  title = "Two-Metric Comparison",
}: {
  barMetric: MetricSpec;
  lineMetric: MetricSpec;
  rows: EngineResult[];
  sortDirection: SortDirection;
  title?: string;
}) {
  const sorted = [...rows].sort((a, b) => {
    const av = toNumber((a.metrics as OptionMetrics)[barMetric.key]);
    const bv = toNumber((b.metrics as OptionMetrics)[barMetric.key]);
    return sortDirection === "asc" ? av - bv : bv - av;
  });

  const chartData = sorted.map((row) => ({
    scenarioName: row.scenarioName,
    barValue: toNumber((row.metrics as OptionMetrics)[barMetric.key]),
    lineValue: toNumber((row.metrics as OptionMetrics)[lineMetric.key]),
  }));
  const maxBarValue = Math.max(0, ...chartData.map((row) => toNumber(row.barValue)));
  const maxLineValue = Math.max(0, ...chartData.map((row) => toNumber(row.lineValue)));
  const leftAxisMax = maxBarValue > 0 ? maxBarValue * 1.15 : 1;
  const rightAxisMax = maxLineValue > 0 ? maxLineValue * 1.15 : 1;

  return (
    <div className="surface-card p-4 sm:p-5">
      <h3 className="text-base font-semibold text-slate-100 mb-1 tracking-tight">{title}</h3>
      <p className="text-xs text-slate-400 mb-3">Bar: {barMetric.label} | Line: {lineMetric.label}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
        <div className="inline-flex items-center gap-2 text-xs text-slate-300">
          <span className="inline-block h-2.5 w-2.5 bg-cyan-400" />
          <span>{barMetric.label} (bar)</span>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-slate-300">
          <span className="inline-block h-[2px] w-3 bg-amber-400" />
          <span>{lineMetric.label} (line)</span>
        </div>
      </div>
      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 24, right: 8, left: 8, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#33415566" />
            <XAxis
              dataKey="scenarioName"
              tick={{ fill: "#cbd5e1", fontSize: 12 }}
              interval={0}
              angle={-12}
              textAnchor="end"
              height={56}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#cbd5e1", fontSize: 12 }}
              tickFormatter={(value) => formatAxisValue(barMetric, toNumber(value))}
              width={80}
              domain={[0, leftAxisMax]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#cbd5e1", fontSize: 12 }}
              tickFormatter={(value) => formatAxisValue(lineMetric, toNumber(value))}
              width={80}
              domain={[0, rightAxisMax]}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", color: "#e2e8f0" }}
              labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
              formatter={(value: number, name: string) => {
                if (name === barMetric.label) return [barMetric.format(toNumber(value)), name];
                return [lineMetric.format(toNumber(value)), name];
              }}
            />
            <Bar
              yAxisId="left"
              dataKey="barValue"
              name={barMetric.label}
              fill="#22d3ee"
              radius={[2, 2, 0, 0]}
              maxBarSize={42}
            >
              <LabelList
                dataKey="barValue"
                position="top"
                content={(props: any) => {
                  const { x, y, width, value } = props;
                  const text = barMetric.format(toNumber(value));
                  const labelWidth = Math.max(54, Math.round(text.length * 6.8) + 10);
                  const labelHeight = 18;
                  const centerX = x + width / 2;
                  const rectX = centerX - labelWidth / 2;
                  const rectY = Math.max(2, y - 22);
                  return (
                    <g>
                      <rect
                        x={rectX}
                        y={rectY}
                        width={labelWidth}
                        height={labelHeight}
                        rx={4}
                        fill="#020617"
                        stroke="#334155"
                        strokeWidth={1}
                      />
                      <text
                        x={centerX}
                        y={rectY + 13}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize={11}
                        fontWeight={600}
                      >
                        {text}
                      </text>
                    </g>
                  );
                }}
              />
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="lineValue"
              name={lineMetric.label}
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 3, fill: "#f59e0b" }}
              activeDot={{ r: 5 }}
              label={(props: any) => {
                const { x, y, value, viewBox } = props;
                const text = lineMetric.format(toNumber(value));
                const chartWidthRaw = Number(viewBox?.width);
                const chartWidth = Number.isFinite(chartWidthRaw) ? chartWidthRaw : 1000;
                const labelWidth = Math.max(54, Math.round(text.length * 6.8) + 10);
                const useLeftAnchor = x > chartWidth - labelWidth - 24;
                const labelX = useLeftAnchor ? x - 8 : x + 8;
                const anchor = useLeftAnchor ? "end" : "start";
                const labelY = y < 20 ? y + 16 : y - 8;
                const rectX = useLeftAnchor ? labelX - labelWidth : labelX;
                const rectY = labelY - 12;
                return (
                  <g>
                    <rect
                      x={rectX}
                      y={rectY}
                      width={labelWidth}
                      height={18}
                      rx={4}
                      fill="#020617"
                      stroke="#7c2d12"
                      strokeWidth={1}
                    />
                    <text
                      x={labelX}
                      y={labelY + 1}
                      textAnchor={anchor}
                      fill="#fde68a"
                      fontSize={11}
                      fontWeight={600}
                    >
                      {text}
                    </text>
                  </g>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
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
  const [secondaryMetricKey, setSecondaryMetricKey] = useState<keyof OptionMetrics>(DEFAULT_SECONDARY_METRIC_KEY);
  const [annualSeriesKey, setAnnualSeriesKey] = useState<AnnualSeriesKey>("total");
  const [savedCharts, setSavedCharts] = useState<CustomChartConfig[]>([]);

  const selectedMetric = useMemo(
    () => METRIC_OPTIONS.find((metric) => metric.key === activeMetricKey) ?? METRIC_OPTIONS[0],
    [activeMetricKey]
  );
  const selectedSecondaryMetric = useMemo(
    () => METRIC_OPTIONS.find((metric) => metric.key === secondaryMetricKey) ?? METRIC_OPTIONS[0],
    [secondaryMetricKey]
  );
  const metricsByKey = useMemo(() => {
    const out: Record<string, MetricSpec> = {};
    for (const metric of METRIC_OPTIONS) out[metric.key] = metric;
    return out;
  }, []);
  const selectedAnnualSeries = useMemo(
    () => ANNUAL_SERIES_OPTIONS.find((series) => series.key === annualSeriesKey) ?? ANNUAL_SERIES_OPTIONS[0],
    [annualSeriesKey]
  );

  const annualRowsByScenario = useMemo(() => {
    const out: Record<string, AnnualAggregateRow[]> = {};
    for (const result of results) {
      const monthly = monthlyPointsForScenario(result, canonicalByScenarioId);
      out[result.scenarioId] = annualAggregate(monthly, annualMode);
    }
    return out;
  }, [results, canonicalByScenarioId, annualMode]);

  const annualCombinedRows = useMemo(() => {
    const byKey = new Map<number, Record<string, string | number>>();
    for (const result of results) {
      const rows = annualRowsByScenario[result.scenarioId] || [];
      for (const row of rows) {
        const existing = byKey.get(row.key) ?? { key: row.key, label: row.label };
        existing[result.scenarioId] = toNumber(row[annualSeriesKey]);
        byKey.set(row.key, existing);
      }
    }
    const ordered = Array.from(byKey.values()).sort((a, b) => toNumber(a.key) - toNumber(b.key));
    for (const row of ordered) {
      for (const result of results) {
        if (typeof row[result.scenarioId] !== "number") {
          row[result.scenarioId] = 0;
        }
      }
    }
    return ordered;
  }, [annualRowsByScenario, results, annualSeriesKey]);

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
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
            <label className="block">
              <span className="text-xs text-slate-400">Bar metric</span>
              <select
                value={activeMetricKey}
                onChange={(e) => {
                  const next = e.target.value as keyof OptionMetrics;
                  if (METRIC_OPTIONS.some((metric) => metric.key === next)) {
                    setActiveMetricKey(next);
                    if (next === secondaryMetricKey) {
                      const fallback = METRIC_OPTIONS.find((metric) => metric.key !== next)?.key ?? next;
                      setSecondaryMetricKey(fallback);
                    }
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
              <span className="text-xs text-slate-400">Line metric</span>
              <select
                value={secondaryMetricKey}
                onChange={(e) => {
                  const next = e.target.value as keyof OptionMetrics;
                  if (METRIC_OPTIONS.some((metric) => metric.key === next) && next !== activeMetricKey) {
                    setSecondaryMetricKey(next);
                  }
                }}
                className="input-premium mt-1"
              >
                {METRIC_OPTIONS.filter((metric) => metric.key !== activeMetricKey).map((metric) => (
                  <option key={metric.key} value={metric.key}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Sort scenarios by bar metric</span>
              <select
                value={sortDirection}
                onChange={(e) => setSortDirection((e.target.value === "asc" ? "asc" : "desc"))}
                className="input-premium mt-1"
              >
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setSavedCharts((prev) => [
                  ...prev,
                  {
                    id: Date.now() + prev.length,
                    barMetricKey: activeMetricKey,
                    lineMetricKey: secondaryMetricKey,
                    sortDirection,
                  },
                ]);
              }}
              className="px-3 py-2 text-sm border border-slate-300/20 bg-slate-900/40 text-slate-100 hover:bg-slate-800/60 h-[42px]"
            >
              Add Another Chart
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <CombinedMetricChart metric={selectedMetric} rows={results} sortDirection={sortDirection} />
            <CombinedMetricChart metric={selectedSecondaryMetric} rows={results} sortDirection={sortDirection} />
          </div>
          <DualMetricComboChart
            barMetric={selectedMetric}
            lineMetric={selectedSecondaryMetric}
            rows={results}
            sortDirection={sortDirection}
            title="Two-Metric Comparison"
          />
          {savedCharts.length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Additional Charts</h3>
              {savedCharts.map((chart, idx) => {
                const barMetric = metricsByKey[chart.barMetricKey] ?? selectedMetric;
                const lineMetric = metricsByKey[chart.lineMetricKey] ?? selectedSecondaryMetric;
                return (
                  <div key={`saved-chart-${chart.id}`} className="border border-slate-300/20 bg-slate-950/50 p-3 sm:p-4">
                    <div className="flex flex-wrap items-end gap-3 justify-between mb-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                        <label className="block">
                          <span className="text-xs text-slate-400">Bar metric</span>
                          <select
                            value={chart.barMetricKey}
                            onChange={(e) => {
                              const next = e.target.value as keyof OptionMetrics;
                              setSavedCharts((prev) =>
                                prev.map((item) => {
                                  if (item.id !== chart.id) return item;
                                  const nextLine = item.lineMetricKey === next
                                    ? (METRIC_OPTIONS.find((metric) => metric.key !== next)?.key ?? item.lineMetricKey)
                                    : item.lineMetricKey;
                                  return { ...item, barMetricKey: next, lineMetricKey: nextLine };
                                })
                              );
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
                          <span className="text-xs text-slate-400">Line metric</span>
                          <select
                            value={chart.lineMetricKey}
                            onChange={(e) => {
                              const next = e.target.value as keyof OptionMetrics;
                              if (next === chart.barMetricKey) return;
                              setSavedCharts((prev) =>
                                prev.map((item) => (item.id === chart.id ? { ...item, lineMetricKey: next } : item))
                              );
                            }}
                            className="input-premium mt-1"
                          >
                            {METRIC_OPTIONS.filter((metric) => metric.key !== chart.barMetricKey).map((metric) => (
                              <option key={metric.key} value={metric.key}>
                                {metric.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs text-slate-400">Sort</span>
                          <select
                            value={chart.sortDirection}
                            onChange={(e) => {
                              const next = e.target.value === "asc" ? "asc" : "desc";
                              setSavedCharts((prev) =>
                                prev.map((item) => (item.id === chart.id ? { ...item, sortDirection: next } : item))
                              );
                            }}
                            className="input-premium mt-1"
                          >
                            <option value="desc">Highest first</option>
                            <option value="asc">Lowest first</option>
                          </select>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSavedCharts((prev) => prev.filter((item) => item.id !== chart.id))}
                        className="px-3 py-2 text-sm border border-rose-400/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 h-[42px]"
                      >
                        Remove
                      </button>
                    </div>
                    <DualMetricComboChart
                      barMetric={barMetric}
                      lineMetric={lineMetric}
                      rows={results}
                      sortDirection={chart.sortDirection}
                      title={`Two-Metric Comparison #${idx + 2}`}
                    />
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
                      <CombinedMetricChart metric={barMetric} rows={results} sortDirection={chart.sortDirection} />
                      <CombinedMetricChart metric={lineMetric} rows={results} sortDirection={chart.sortDirection} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3 justify-between">
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
            <label className="block min-w-[220px]">
              <span className="text-xs text-slate-400">Annual comparison metric</span>
              <select
                value={annualSeriesKey}
                onChange={(e) => {
                  const next = e.target.value as AnnualSeriesKey;
                  if (ANNUAL_SERIES_OPTIONS.some((series) => series.key === next)) {
                    setAnnualSeriesKey(next);
                  }
                }}
                className="input-premium mt-1"
              >
                {ANNUAL_SERIES_OPTIONS.map((series) => (
                  <option key={series.key} value={series.key}>
                    {series.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-400">
            {annualMode === "lease_year"
              ? "Lease Year rolls up every 12 months from lease commencement."
              : "Calendar Year rolls up by Jan-Dec year from monthly cash flows."}
          </p>
          {annualSeriesKey === "discounted" ? (
            <p className="text-xs text-cyan-200/90">
              Discounted (Present Value) means each period&apos;s cash flow is converted to present-day dollars at the option&apos;s discount rate (default 8.0% unless overridden).
            </p>
          ) : null}

          <div className="border border-slate-300/20 bg-slate-950/50 p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-slate-100 mb-1">
              Combined Annual Comparison: {selectedAnnualSeries.label}
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              All scenarios are plotted together by {annualMode === "lease_year" ? "lease year" : "calendar year"}.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
              {results.map((result, index) => (
                <div key={`annual-legend-${result.scenarioId}`} className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <span
                    className="inline-block h-2.5 w-2.5"
                    style={{ backgroundColor: ANNUAL_BAR_COLORS[index % ANNUAL_BAR_COLORS.length] }}
                  />
                  <span>{result.scenarioName}</span>
                </div>
              ))}
            </div>
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={annualCombinedRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#33415566" />
                  <XAxis dataKey="label" tick={{ fill: "#cbd5e1", fontSize: 12 }} tickMargin={8} />
                  <YAxis
                    tick={{ fill: "#cbd5e1", fontSize: 12 }}
                    tickFormatter={(value) => formatCompactCurrency(toNumber(value))}
                    width={72}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", color: "#e2e8f0" }}
                    labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                    formatter={(value: number, name: string) => [formatCurrency(toNumber(value)), name]}
                  />
                  {results.map((result, index) => (
                    <Bar
                      key={`annual-bar-${result.scenarioId}`}
                      dataKey={result.scenarioId}
                      name={result.scenarioName}
                      fill={ANNUAL_BAR_COLORS[index % ANNUAL_BAR_COLORS.length]}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border border-slate-300/20 bg-slate-950/50 p-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-300/20 text-slate-300">
                    <th className="text-left py-2 pr-3">{annualMode === "lease_year" ? "Lease Year" : "Calendar Year"}</th>
                    {results.map((result) => (
                      <th key={`header-${result.scenarioId}`} className="text-right py-2 px-2">
                        {result.scenarioName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {annualCombinedRows.map((row) => (
                    <tr key={`combined-${String(row.key)}`} className="border-b border-slate-300/10 hover:bg-slate-400/10">
                      <td className="py-2 pr-3 text-slate-200">{String(row.label)}</td>
                      {results.map((result) => (
                        <td key={`cell-${String(row.key)}-${result.scenarioId}`} className="py-2 px-2 text-right text-slate-300">
                          {formatCurrency(toNumber(row[result.scenarioId]))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
