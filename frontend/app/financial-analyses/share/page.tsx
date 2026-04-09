"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SummaryMatrix } from "@/components/SummaryMatrix";
import {
  materializeFinancialAnalysesSharePayload,
  parseFinancialAnalysesShareData,
  type FinancialAnalysesShareAnnualTuple,
  type FinancialAnalysesShareChartSnapshot,
} from "@/lib/financial-analyses/share";
import { formatCurrency, formatDateISO, formatNumber } from "@/lib/format";

type AnnualChartMetric = "total" | "discounted";

function annualLabel(year: number): string {
  return year === 0 ? "Lease Year 0 (PLC)" : `Lease Year ${year}`;
}

function annualMetricValue(row: FinancialAnalysesShareAnnualTuple, metric: AnnualChartMetric): number {
  return metric === "discounted" ? Number(row[6] || 0) : Number(row[5] || 0);
}

function CompactCurrency({ value }: { value: number }) {
  return <>{formatCurrency(Number(value || 0))}</>;
}

function formatChartValue(metricKey: string, value: number): string {
  const key = String(metricKey || "").trim();
  const numeric = Number(value || 0);
  if (key === "parkingSpaces") return formatNumber(numeric);
  if (key === "discountRateUsed" || key === "commissionPercent" || key === "escalationPercent" || key === "opexEscalationPercent" || key === "parkingSalesTaxPercent") {
    return `${(Math.abs(numeric) <= 1 ? numeric * 100 : numeric).toFixed(1)}%`;
  }
  if (key.includes("Psf") || key.includes("psf") || key === "tiBudget" || key === "tiAllowance") {
    return formatCurrency(numeric, { decimals: 2 });
  }
  if (key.includes("Cost") || key.includes("Rent") || key.includes("Obligation") || key.includes("Npv") || key.includes("Budget") || key.includes("Allowance") || key.includes("Pocket") || key === "commissionAmount") {
    return formatCurrency(numeric);
  }
  return formatNumber(numeric);
}

function metricSnapshotValue(metrics: unknown, metricKey: string): number {
  const record = metrics as Record<string, unknown>;
  return Number(record[metricKey] || 0);
}

function ShareMetricCharts({
  charts,
  results,
}: {
  charts: FinancialAnalysesShareChartSnapshot[];
  results: ReturnType<typeof materializeFinancialAnalysesSharePayload>["results"];
}) {
  if (charts.length === 0 || results.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl border border-white/20 bg-black/35 p-6">
      <p className="heading-kicker mb-2">Charts</p>
      <h2 className="heading-section mb-4">Client Comparison Charts</h2>
      <div className="space-y-6">
        {charts.map((chart, index) => {
          const rows = [...results].sort((left, right) => {
            const leftValue = metricSnapshotValue(left.metrics as unknown, chart.barMetricKey);
            const rightValue = metricSnapshotValue(right.metrics as unknown, chart.barMetricKey);
            return chart.sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
          });
          const data = rows.map((row) => ({
            scenarioName: row.scenarioName,
            barValue: metricSnapshotValue(row.metrics as unknown, chart.barMetricKey),
            lineValue: metricSnapshotValue(row.metrics as unknown, chart.lineMetricKey),
          }));
          const maxBar = Math.max(1, ...data.map((item) => item.barValue));
          const maxLine = Math.max(1, ...data.map((item) => item.lineValue));

          return (
            <div key={`${chart.title}-${index}`} className="border border-white/15 bg-slate-950/55 p-4">
              <h3 className="text-base font-semibold text-slate-100">{chart.title || `${chart.barMetricLabel} vs ${chart.lineMetricLabel}`}</h3>
              <p className="mt-1 text-xs text-slate-400">
                Bar: {chart.barMetricLabel} | Line: {chart.lineMetricLabel}
              </p>
              <div className="mt-4 h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 20, right: 12, left: 12, bottom: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#33415566" />
                    <XAxis
                      dataKey="scenarioName"
                      tick={{ fill: "#cbd5e1", fontSize: 12 }}
                      interval={0}
                      angle={-12}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: "#cbd5e1", fontSize: 12 }}
                      tickFormatter={(value) => formatChartValue(chart.barMetricKey, Number(value || 0))}
                      width={82}
                      domain={[0, maxBar * 1.15]}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fill: "#cbd5e1", fontSize: 12 }}
                      tickFormatter={(value) => formatChartValue(chart.lineMetricKey, Number(value || 0))}
                      width={82}
                      domain={[0, maxLine * 1.15]}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", color: "#e2e8f0" }}
                      formatter={(value: number, name: string) => {
                        const formatted = name === chart.barMetricLabel
                          ? formatChartValue(chart.barMetricKey, Number(value || 0))
                          : formatChartValue(chart.lineMetricKey, Number(value || 0));
                        return [formatted, name];
                      }}
                    />
                    <Bar yAxisId="left" dataKey="barValue" name={chart.barMetricLabel} fill="#22d3ee" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="right" type="linear" dataKey="lineValue" name={chart.lineMetricLabel} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ShareAnnualCashFlows({
  annualByScenario,
  scenarioLabels,
}: {
  annualByScenario: Record<string, FinancialAnalysesShareAnnualTuple[]>;
  scenarioLabels: Record<string, string>;
}) {
  const [metric, setMetric] = useState<AnnualChartMetric>("total");
  const scenarioIds = Object.keys(annualByScenario).filter((scenarioId) => annualByScenario[scenarioId]?.length);

  const combinedRows = useMemo(() => {
    const byYear = new Map<number, Record<string, string | number>>();
    scenarioIds.forEach((scenarioId) => {
      (annualByScenario[scenarioId] || []).forEach((row) => {
        const year = Number(row[0] || 0);
        const existing = byYear.get(year) || { year, label: annualLabel(year) };
        existing[scenarioId] = annualMetricValue(row, metric);
        byYear.set(year, existing);
      });
    });
    const ordered = Array.from(byYear.values()).sort((left, right) => Number(left.year || 0) - Number(right.year || 0));
    ordered.forEach((row) => {
      scenarioIds.forEach((scenarioId) => {
        if (typeof row[scenarioId] !== "number") row[scenarioId] = 0;
      });
    });
    return ordered;
  }, [annualByScenario, metric, scenarioIds]);

  const maxValue = useMemo(() => {
    let currentMax = 1;
    combinedRows.forEach((row) => {
      scenarioIds.forEach((scenarioId) => {
        currentMax = Math.max(currentMax, Number(row[scenarioId] || 0));
      });
    });
    return currentMax;
  }, [combinedRows, scenarioIds]);

  if (scenarioIds.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl border border-white/20 bg-black/35 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="heading-kicker mb-2">Cash Flow</p>
          <h2 className="heading-section">Annual Cash Flow Snapshot</h2>
        </div>
        <div className="inline-flex border border-slate-300/20 bg-slate-900/40">
          <button
            type="button"
            onClick={() => setMetric("total")}
            className={`px-3 py-2 text-xs sm:text-sm ${metric === "total" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300 hover:bg-slate-800/60"}`}
          >
            Total
          </button>
          <button
            type="button"
            onClick={() => setMetric("discounted")}
            className={`border-l border-slate-300/20 px-3 py-2 text-xs sm:text-sm ${metric === "discounted" ? "bg-cyan-500/20 text-cyan-100" : "text-slate-300 hover:bg-slate-800/60"}`}
          >
            Discounted
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        Lease-year annual rollup of base rent, operating expenses, parking, TI/concessions, total, and discounted present value.
      </p>

      <div className="mt-5 border border-white/15 bg-slate-950/55 p-4">
        <h3 className="text-sm font-semibold text-slate-100">
          Combined Annual Comparison: {metric === "discounted" ? "Discounted (Present Value)" : "Total"}
        </h3>
        <div className="mt-4 h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={combinedRows} margin={{ top: 20, right: 12, left: 12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#33415566" />
              <XAxis dataKey="label" tick={{ fill: "#cbd5e1", fontSize: 12 }} tickMargin={8} />
              <YAxis
                tick={{ fill: "#cbd5e1", fontSize: 12 }}
                tickFormatter={(value) => formatCurrency(Number(value || 0))}
                width={82}
                domain={[0, maxValue * 1.15]}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", color: "#e2e8f0" }}
                formatter={(value: number, name: string) => [formatCurrency(Number(value || 0)), name]}
              />
              {scenarioIds.map((scenarioId, index) => (
                <Bar
                  key={`annual-${scenarioId}`}
                  dataKey={scenarioId}
                  name={scenarioLabels[scenarioId] || scenarioId}
                  fill={["#22d3ee", "#34d399", "#f59e0b", "#f472b6", "#60a5fa", "#a78bfa"][index % 6]}
                  radius={[2, 2, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {scenarioIds.map((scenarioId) => (
          <div key={`cashflow-${scenarioId}`} className="border border-white/15 bg-slate-950/55 p-4">
            <h3 className="text-sm font-semibold text-slate-100">{scenarioLabels[scenarioId] || scenarioId}</h3>
            <div className="mt-3 overflow-x-auto border border-white/10">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/15 bg-slate-900/65">
                    <th className="px-3 py-2 text-left font-medium text-slate-200">Lease Year</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-200">Base Rent</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-200">OpEx</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-200">Parking</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-200">TI / Concessions</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-200">Total</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-200">Discounted</th>
                  </tr>
                </thead>
                <tbody>
                  {(annualByScenario[scenarioId] || []).map((row, index) => (
                    <tr key={`${scenarioId}-${row[0]}`} className={`border-b border-white/10 ${index % 2 === 1 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-3 py-2 text-slate-200">{annualLabel(Number(row[0] || 0))}</td>
                      <td className="px-3 py-2 text-right text-slate-300"><CompactCurrency value={row[1]} /></td>
                      <td className="px-3 py-2 text-right text-slate-300"><CompactCurrency value={row[2]} /></td>
                      <td className="px-3 py-2 text-right text-slate-300"><CompactCurrency value={row[3]} /></td>
                      <td className="px-3 py-2 text-right text-slate-300"><CompactCurrency value={row[4]} /></td>
                      <td className="px-3 py-2 text-right text-slate-100"><CompactCurrency value={row[5]} /></td>
                      <td className="px-3 py-2 text-right text-cyan-100"><CompactCurrency value={row[6]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinancialAnalysesShareContent() {
  const searchParams = useSearchParams();
  const envelope = useMemo(
    () => parseFinancialAnalysesShareData(searchParams.get("data")),
    [searchParams],
  );
  const view = useMemo(
    () => (envelope ? materializeFinancialAnalysesSharePayload(envelope.payload) : null),
    [envelope],
  );
  const scenarioLabels = useMemo(
    () => Object.fromEntries((view?.results || []).map((result) => [result.scenarioId, result.scenarioName])),
    [view],
  );

  if (!envelope || !view) {
    return (
      <main className="app-container pt-24 pb-16">
        <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
          <p className="heading-kicker mb-2">Financial Analyses Share</p>
          <h1 className="heading-section mb-2">Invalid Or Missing Share Data</h1>
          <p className="text-sm text-slate-300">This financial analysis share link is invalid or expired.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-container pt-24 pb-16">
      <div className="space-y-6">
        <section className="mx-auto max-w-7xl border border-white/20 bg-black/35 p-6">
          <p className="heading-kicker mb-2">Financial Analyses Share</p>
          <h1 className="heading-section mb-1">Lease Financial Analysis</h1>
          <p className="mb-4 text-sm text-slate-300">
            {envelope.branding.brokerageName} | {envelope.branding.clientName} | Prepared by {envelope.branding.preparedBy || "-"} | Report Date {envelope.branding.reportDate}
          </p>
          {view.equalized?.windowStart && view.equalized?.windowEnd ? (
            <p className="text-xs text-slate-400">
              Equalized window: {formatDateISO(view.equalized.windowStart)} to {formatDateISO(view.equalized.windowEnd)} ({view.equalized.windowSource}).
            </p>
          ) : null}
          {view.equalized?.needsCustomWindow && view.equalized?.message ? (
            <p className="mt-2 text-xs text-amber-200">{view.equalized.message}</p>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">
            Generated {formatDateISO(envelope.generatedAtIso)}. Values reflect the latest shared scenario assumptions.
          </p>
        </section>

        <section className="mx-auto max-w-7xl border border-white/20 bg-black/35 p-6">
          <p className="heading-kicker mb-2">Overview</p>
          <h2 className="heading-section mb-4">Scenario Overview</h2>
          <div className="overflow-x-auto border border-white/15">
            <table className="w-full min-w-[1200px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/20 bg-slate-900/70">
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Scenario</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Document</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Building</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Suite/Floor</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Address</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Lease Type</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-200">RSF</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-200">Term (Mo.)</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Commencement</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-200">Expiration</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-200">Total Obligation</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-200">NPV Cost</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-200">Avg Cost/SF/YR</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-200">Equalized Avg/SF/YR</th>
                </tr>
              </thead>
              <tbody>
                {view.scenarios.map((row, index) => (
                  <tr key={row.id} className={`border-b border-white/10 ${index % 2 === 1 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-2 py-2 text-white">{row.scenarioName}</td>
                    <td className="px-2 py-2 text-slate-300">{row.documentType || "-"}</td>
                    <td className="px-2 py-2 text-slate-300">{row.buildingName || "-"}</td>
                    <td className="px-2 py-2 text-slate-300">{row.suiteFloor || "-"}</td>
                    <td className="px-2 py-2 text-slate-300">{row.address || "-"}</td>
                    <td className="px-2 py-2 text-slate-300">{row.leaseType || "-"}</td>
                    <td className="px-2 py-2 text-right text-slate-200">{formatNumber(row.rsf)}</td>
                    <td className="px-2 py-2 text-right text-slate-200">{formatNumber(row.termMonths)}</td>
                    <td className="px-2 py-2 text-slate-300">{formatDateISO(row.commencementDate)}</td>
                    <td className="px-2 py-2 text-slate-300">{formatDateISO(row.expirationDate)}</td>
                    <td className="px-2 py-2 text-right text-slate-100">{formatCurrency(row.totalObligation)}</td>
                    <td className="px-2 py-2 text-right text-slate-100">{formatCurrency(row.npvCost)}</td>
                    <td className="px-2 py-2 text-right text-cyan-100">{formatCurrency(row.avgCostPsfYear)}</td>
                    <td className="px-2 py-2 text-right text-cyan-100">{formatCurrency(row.equalizedAvgCostPsfYear)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {view.results.length > 0 ? (
          <section className="mx-auto max-w-7xl border border-white/20 bg-black/35 p-0">
            <SummaryMatrix results={view.results} equalized={view.equalized || undefined} />
          </section>
        ) : null}

        <ShareMetricCharts charts={view.charts} results={view.results} />

        <ShareAnnualCashFlows annualByScenario={view.annualByScenario} scenarioLabels={scenarioLabels} />
      </div>
    </main>
  );
}

export default function FinancialAnalysesSharePage() {
  return (
    <Suspense
      fallback={
        <main className="app-container pt-24 pb-16">
          <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
            <p className="text-sm text-slate-300">Loading shared financial analysis...</p>
          </section>
        </main>
      }
    >
      <FinancialAnalysesShareContent />
    </Suspense>
  );
}
