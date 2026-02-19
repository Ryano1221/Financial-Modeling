"use client";

import type { EngineResult, OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import { METRIC_LABELS, METRIC_DISPLAY_NAMES, formatMetricValue } from "@/lib/lease-engine/excel-export";

interface SummaryMatrixProps {
  results: EngineResult[];
}

export function SummaryMatrix({ results }: SummaryMatrixProps) {
  if (results.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10">
        <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-1">Portfolio comparison</p>
        <h2 className="text-lg font-semibold text-white">Comparison matrix</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Metrics from lease engine. Each option uses its own discount rate when set, otherwise the global default. Export Excel for the full workbook.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-xs sm:text-sm">
          <thead>
            <tr className="bg-white/[0.04] border-b border-white/10">
              <th className="text-left py-2.5 px-4 font-medium text-zinc-400 w-48">Metric</th>
              {results.map((r) => (
                <th key={r.scenarioId} className="text-right py-2.5 px-4 font-medium text-zinc-400 min-w-[10rem]">
                  {r.scenarioName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRIC_LABELS.map((key) => (
              <tr key={key} className="border-b border-white/5 hover:bg-white/[0.04]">
                <td className="py-2.5 px-4 font-medium text-zinc-300">
                  {METRIC_DISPLAY_NAMES[key] ?? key}
                </td>
                {results.map((r) => {
                  const value = (r.metrics as OptionMetrics)[key];
                  const formatted = formatMetricValue(key, value);
                  const notesCell = key === "notes";
                  return (
                    <td
                      key={r.scenarioId}
                      className={`py-2.5 px-4 text-zinc-400 align-top ${notesCell ? "text-left whitespace-pre-line" : "text-right"}`}
                    >
                      {formatted}
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
