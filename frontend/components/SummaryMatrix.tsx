"use client";

import type { EngineResult, OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import { METRIC_LABELS, METRIC_DISPLAY_NAMES, formatMetricValue } from "@/lib/lease-engine/excel-export";
import type { EqualizedComparisonResult } from "@/lib/equalized";
import { formatCurrency, formatCurrencyPerSF, formatDateISO } from "@/lib/format";

interface SummaryMatrixProps {
  results: EngineResult[];
  equalized?: EqualizedComparisonResult;
}

export function SummaryMatrix({ results, equalized }: SummaryMatrixProps) {
  if (results.length === 0) return null;

  return (
    <div className="table-shell">
      <div className="px-5 py-4 border-b border-slate-300/20 bg-slate-900/45">
        <p className="heading-kicker mb-1">Equalized</p>
        <h2 className="heading-section">Overlap-only comparison</h2>
        <p className="text-xs text-slate-400 mt-1">
          Equalized period:{" "}
          {equalized?.windowStart && equalized?.windowEnd
            ? `${formatDateISO(equalized.windowStart)} – ${formatDateISO(equalized.windowEnd)}`
            : "Not available"}
        </p>
        {equalized?.windowSource === "custom" && (
          <p className="text-xs text-amber-200/90 mt-1">Using custom comparison window.</p>
        )}
        {equalized?.needsCustomWindow ? (
          <p className="text-xs text-amber-200/90 mt-1">
            No overlapping lease term for equalized comparison. Enter custom dates to compute equalized values.
          </p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full min-w-[780px] text-xs sm:text-sm border border-slate-300/15">
              <thead>
                <tr className="bg-slate-900/35 border-b border-slate-300/20">
                  <th className="text-left py-2.5 px-4 font-medium text-slate-300 w-64">Metric</th>
                  {results.map((r) => (
                    <th key={`eq-${r.scenarioId}`} className="text-right py-2.5 px-4 font-medium text-slate-300 min-w-[10rem]">
                      {r.scenarioName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  "Equalized avg gross rent/SF/year",
                  "Equalized avg gross rent/month",
                  "Equalized avg cost/SF/year",
                  "Equalized avg cost/month",
                  "Equalized total cost",
                  "Equalized NPV (t0 at start)",
                ].map((label, rowIdx) => (
                  <tr key={label} className="border-b border-slate-300/10 hover:bg-slate-400/10">
                    <td className="py-2.5 px-4 font-medium text-slate-200">{label}</td>
                    {results.map((r) => {
                      const eq = equalized?.metricsByScenario?.[r.scenarioId];
                      let value = "—";
                      if (eq) {
                        if (rowIdx === 0) value = formatCurrencyPerSF(eq.averageGrossRentPsfYear);
                        if (rowIdx === 1) value = formatCurrency(eq.averageGrossRentMonth);
                        if (rowIdx === 2) value = formatCurrencyPerSF(eq.averageCostPsfYear);
                        if (rowIdx === 3) value = formatCurrency(eq.averageCostMonth);
                        if (rowIdx === 4) value = formatCurrency(eq.totalCost);
                        if (rowIdx === 5) value = formatCurrency(eq.npvCost);
                      }
                      return (
                        <td key={`${label}-${r.scenarioId}`} className="py-2.5 px-4 text-right text-slate-300">
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-b border-slate-300/20 bg-slate-900/45">
        <p className="heading-kicker mb-1">Portfolio comparison</p>
        <h2 className="heading-section">Comparison matrix</h2>
        <p className="text-xs text-slate-400 mt-1">
          Metrics from lease engine. Each option uses its own discount rate when set, otherwise the global default. Export Excel for the full workbook.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-xs sm:text-sm">
          <thead>
            <tr className="bg-slate-900/35 border-b border-slate-300/20">
              <th className="text-left py-2.5 px-4 font-medium text-slate-300 w-48">Metric</th>
              {results.map((r) => (
                <th key={r.scenarioId} className="text-right py-2.5 px-4 font-medium text-slate-300 min-w-[10rem]">
                  {r.scenarioName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRIC_LABELS.map((key) => (
              <tr key={key} className="border-b border-slate-300/10 hover:bg-slate-400/10">
                <td className="py-2.5 px-4 font-medium text-slate-200">
                  {METRIC_DISPLAY_NAMES[key] ?? key}
                </td>
                {results.map((r) => {
                  const value = (r.metrics as OptionMetrics)[key];
                  const formatted = formatMetricValue(key, value);
                  const notesCell = key === "notes";
                  const noteBullets = notesCell
                    ? formatted
                        .split(/\n+/)
                        .map((line) => line.replace(/^\s*•\s*/, "").trim())
                        .filter(Boolean)
                    : [];
                  return (
                    <td
                      key={r.scenarioId}
                      className={`py-2.5 px-4 text-slate-300 align-top ${notesCell ? "text-left" : "text-right"}`}
                    >
                      {notesCell ? (
                        noteBullets.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1">
                            {noteBullets.map((item, index) => (
                              <li key={`${r.scenarioId}-${index}`} className="break-words whitespace-normal">
                                {item}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="whitespace-normal break-words">{formatted}</span>
                        )
                      ) : (
                        formatted
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
