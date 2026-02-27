"use client";

import { useState } from "react";
import type { EngineResult, OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import { METRIC_LABELS, METRIC_DISPLAY_NAMES, formatMetricValue } from "@/lib/lease-engine/excel-export";
import type { EqualizedComparisonResult } from "@/lib/equalized";
import { formatCurrency, formatCurrencyPerSF, formatDateISO, formatPercent } from "@/lib/format";
import type { ScenarioWithId } from "@/lib/types";
import { effectiveTiBudgetTotal, round2 } from "@/lib/ti";
import { buildOverarchingAssumptionNotes } from "@/lib/global-assumptions";

interface SummaryMatrixProps {
  results: EngineResult[];
  equalized?: EqualizedComparisonResult;
  scenariosById?: Record<string, ScenarioWithId>;
  onUpdateTiBudgetPsf?: (scenarioId: string, value: number) => void;
}

export function SummaryMatrix({
  results,
  equalized,
  scenariosById,
  onUpdateTiBudgetPsf,
}: SummaryMatrixProps) {
  const [tiBudgetDrafts, setTiBudgetDrafts] = useState<Record<string, string>>({});
  if (results.length === 0) return null;

  const matrixMetricKeys = METRIC_LABELS.filter(
    (key) => key !== "equalizedAvgCostPsfYr"
  );
  const numericZeroTolerance = 1e-9;
  const emptyStringMarkers = new Set(["", "-", "—", "none", "n/a", "na"]);

  const equalizedRows = [
    "Equalized Avg Cost/SF/YR",
    "Equalized Avg Cost/Month",
    "Equalized Avg Cost/YR",
    "Equalized Total Cost",
    "Equalized NPV",
  ] as const;

  const getEqualizedCellValue = (rowIdx: number, scenarioId: string) => {
    const eq = equalized?.metricsByScenario?.[scenarioId];
    if (!eq) return "—";
    if (rowIdx === 0) return formatCurrencyPerSF(eq.averageCostPsfYear);
    if (rowIdx === 1) return formatCurrency(eq.averageCostMonth);
    if (rowIdx === 2) return formatCurrency(eq.averageCostYear);
    if (rowIdx === 3) return formatCurrency(eq.totalCost);
    return formatCurrency(eq.npvCost);
  };

  const getTiBudgetPsfFromScenario = (scenarioId: string): number => {
    const scenario = scenariosById?.[scenarioId];
    if (!scenario) return 0;
    const rsf = Math.max(0, Number(scenario.rsf) || 0);
    if (rsf <= 0) return 0;
    return round2(effectiveTiBudgetTotal(scenario) / rsf);
  };

  const commitTiBudgetEdit = (scenarioId: string) => {
    const draft = (tiBudgetDrafts[scenarioId] ?? "").trim();
    setTiBudgetDrafts((prev) => {
      const next = { ...prev };
      delete next[scenarioId];
      return next;
    });
    if (!onUpdateTiBudgetPsf || draft.length === 0) return;
    const parsed = Number(draft.replace(/,/g, ""));
    if (!Number.isFinite(parsed)) return;
    onUpdateTiBudgetPsf(scenarioId, Math.max(0, parsed));
  };

  const getNotes = (formatted: string) =>
    formatted
      .split(/\n+/)
      .map((line) => line.replace(/^\s*•\s*/, "").trim())
      .filter(Boolean);

  const getMatrixCellValue = (
    metricKey: keyof OptionMetrics,
    scenarioId: string,
    value: unknown
  ): string => {
    if (metricKey === "equalizedAvgCostPsfYr") {
      const eq = equalized?.metricsByScenario?.[scenarioId];
      if (eq) return formatCurrencyPerSF(eq.averageCostPsfYear);
    }
    return formatMetricValue(metricKey, value);
  };

  const isMeaningfulMetricValue = (
    metricKey: keyof OptionMetrics,
    scenarioId: string,
    value: unknown
  ): boolean => {
    if (typeof value === "number") {
      return Math.abs(value) > numericZeroTolerance;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (emptyStringMarkers.has(normalized)) return false;
      const numeric = Number(normalized.replace(/,/g, ""));
      if (Number.isFinite(numeric) && Math.abs(numeric) <= numericZeroTolerance) return false;
      return normalized.length > 0;
    }

    if (value == null) return false;

    const formatted = getMatrixCellValue(metricKey, scenarioId, value).trim().toLowerCase();
    if (emptyStringMarkers.has(formatted)) return false;
    const numeric = Number(formatted.replace(/,/g, ""));
    if (Number.isFinite(numeric) && Math.abs(numeric) <= numericZeroTolerance) return false;
    return formatted.length > 0;
  };

  const visibleMatrixMetricKeys = matrixMetricKeys.filter((metricKey) =>
    metricKey === "discountRateUsed"
      ? (() => {
        const rates = results
          .map((r) => Number(r.metrics.discountRateUsed))
          .filter((value) => Number.isFinite(value));
        if (rates.length !== results.length || rates.length <= 1) return false;
        return new Set(rates.map((value) => value.toFixed(6))).size > 1;
      })()
      :
    metricKey === "parkingSalesTaxPercent"
      ? results.some((r) => {
        const metrics = r.metrics as OptionMetrics;
        return (
          Math.abs(Number(metrics.parkingCostMonthly) || 0) > numericZeroTolerance ||
          Math.abs(Number(metrics.parkingCostAnnual) || 0) > numericZeroTolerance
        );
      })
      : results.some((r) =>
        isMeaningfulMetricValue(metricKey, r.scenarioId, (r.metrics as OptionMetrics)[metricKey])
      )
  );

  const getMetricLabel = (metricKey: keyof OptionMetrics): string => {
    if (metricKey !== "npvAtDiscount") return METRIC_DISPLAY_NAMES[metricKey] ?? metricKey;
    const rates = results
      .map((r) => Number(r.metrics.discountRateUsed))
      .filter((value) => Number.isFinite(value));
    if (rates.length === results.length && rates.length > 0) {
      const uniqueRates = new Set(rates.map((value) => value.toFixed(6)));
      if (uniqueRates.size === 1) {
        return `NPV @ ${formatPercent(rates[0], { decimals: 1 })} Discount Rate`;
      }
    }
    return "NPV @ Discount Rate (per scenario)";
  };

  const renderEqualizedSection = () => (
    <div className="px-5 py-4 bg-slate-900/45">
      <p className="heading-kicker mb-1">Equalized</p>
      <h2 className="heading-section">Equalized comparison</h2>
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
        <>
          <div className="xl:hidden mt-3 space-y-3">
            {results.map((r) => (
              <div key={`eq-mobile-${r.scenarioId}`} className="border border-slate-300/20 bg-slate-950/55 p-3">
                <h3 className="text-sm font-semibold text-slate-100 mb-2 whitespace-normal break-words">{r.scenarioName}</h3>
                <dl className="space-y-1.5 text-xs">
                  {equalizedRows.map((label, idx) => (
                    <div key={`eq-mobile-${r.scenarioId}-${label}`} className="grid grid-cols-2 gap-2">
                      <dt className="text-slate-400">{label}</dt>
                      <dd className="text-slate-200 text-right">{getEqualizedCellValue(idx, r.scenarioId)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden xl:block overflow-x-auto mt-3">
            <table className="w-full min-w-[720px] table-fixed text-xs sm:text-sm border border-slate-300/15">
              <thead>
                <tr className="bg-slate-900/35 border-b border-slate-300/20">
                  <th className="text-left py-2.5 px-4 font-medium text-slate-300 w-[34%]">Metric</th>
                  {results.map((r) => (
                    <th key={`eq-${r.scenarioId}`} className="text-right py-2.5 px-4 font-medium text-slate-300 align-top">
                      <span className="inline-block max-w-full whitespace-normal break-words leading-snug">
                        {r.scenarioName}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equalizedRows.map((label, rowIdx) => (
                  <tr key={label} className="border-b border-slate-300/10 hover:bg-slate-400/10">
                    <td className="py-2.5 px-4 font-medium text-slate-200">{label}</td>
                    {results.map((r) => (
                      <td key={`${label}-${r.scenarioId}`} className="py-2.5 px-4 text-right text-slate-300">
                        {getEqualizedCellValue(rowIdx, r.scenarioId)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );

  const renderTiBudgetCell = (scenarioId: string) => {
    const scenario = scenariosById?.[scenarioId];
    const rsf = Math.max(0, Number(scenario?.rsf) || 0);
    const currentPsf = getTiBudgetPsfFromScenario(scenarioId);
    const draft = tiBudgetDrafts[scenarioId];
    const value = draft ?? String(currentPsf);
    const disabled = !scenario || rsf <= 0 || !onUpdateTiBudgetPsf;
    return (
      <input
        type="text"
        value={value}
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        onChange={(e) =>
          setTiBudgetDrafts((prev) => ({
            ...prev,
            [scenarioId]: e.target.value,
          }))
        }
        onBlur={() => commitTiBudgetEdit(scenarioId)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setTiBudgetDrafts((prev) => {
              const next = { ...prev };
              delete next[scenarioId];
              return next;
            });
          }
        }}
        className="input-premium inline-block w-28 min-h-0 py-1 px-2 text-right text-xs sm:text-sm"
        aria-label="TI budget per square foot"
      />
    );
  };

  const overarchingNotes = buildOverarchingAssumptionNotes(
    results.map((r) => Number(r.metrics.discountRateUsed))
  );

  return (
    <div className="table-shell">
      <div className="px-5 py-4 border-b border-slate-300/20 bg-slate-900/45">
        <p className="heading-kicker mb-1">Portfolio comparison</p>
        <h2 className="heading-section">Comparison matrix</h2>
        <p className="text-xs text-slate-400 mt-1">
          This model leverages AI driven lease data extraction. Please review all extracted inputs for accuracy and confirm assumptions prior to relying on outputs. Any field can be edited above if adjustments are required. Metrics are calculated by the lease engine using each option&apos;s specified discount rate or the global default when not set.
        </p>
      </div>
      <div className="xl:hidden p-3 space-y-3">
        {results.map((r) => (
          <div key={`matrix-mobile-${r.scenarioId}`} className="border border-slate-300/20 bg-slate-950/55 p-3">
            <h3 className="text-sm font-semibold text-slate-100 mb-2 whitespace-normal break-words">{r.scenarioName}</h3>
            <dl className="space-y-2 text-xs">
              {visibleMatrixMetricKeys.map((key) => {
                const value = (r.metrics as OptionMetrics)[key];
                const formatted = getMatrixCellValue(key, r.scenarioId, value);
                const notesCell = key === "notes";
                const noteBullets = notesCell ? getNotes(formatted) : [];
                return (
                  <div key={`matrix-mobile-${r.scenarioId}-${key}`} className="pt-1 border-t border-slate-300/10 first:border-0 first:pt-0">
                    <dt className="text-slate-400 mb-1">{getMetricLabel(key)}</dt>
                    <dd className="text-slate-200">
                      {notesCell ? (
                        noteBullets.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1">
                            {noteBullets.map((item, index) => (
                              <li key={`matrix-mobile-${r.scenarioId}-${index}`} className="break-words whitespace-normal">
                                {item}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="whitespace-normal break-words">{formatted}</span>
                        )
                      ) : key === "tiBudget" ? (
                        renderTiBudgetCell(r.scenarioId)
                      ) : (
                        formatted
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
      <div className="hidden xl:block overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed text-xs sm:text-sm">
          <thead>
            <tr className="bg-slate-900/35 border-b border-slate-300/20">
              <th className="text-left py-2.5 px-4 font-medium text-slate-300 w-[30%]">Metric</th>
              {results.map((r) => (
                <th key={r.scenarioId} className="text-right py-2.5 px-4 font-medium text-slate-300 align-top">
                  <span className="inline-block max-w-full whitespace-normal break-words leading-snug">
                    {r.scenarioName}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleMatrixMetricKeys.map((key) => (
              <tr key={key} className="border-b border-slate-300/10 hover:bg-slate-400/10">
                <td className="py-2.5 px-4 font-medium text-slate-200 whitespace-normal break-words">
                  {getMetricLabel(key)}
                </td>
                {results.map((r) => {
                  const value = (r.metrics as OptionMetrics)[key];
                  const formatted = getMatrixCellValue(key, r.scenarioId, value);
                  const notesCell = key === "notes";
                  const noteBullets = notesCell ? getNotes(formatted) : [];
                  return (
                    <td
                      key={r.scenarioId}
                      className={`py-2.5 px-4 text-slate-300 align-top whitespace-normal break-words ${notesCell ? "text-left" : "text-right"}`}
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
                      ) : key === "tiBudget" ? (
                        renderTiBudgetCell(r.scenarioId)
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
      <div className="px-5 py-4 border-t border-slate-300/20 bg-slate-900/35">
        <p className="heading-kicker mb-1">Overarching notes</p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-slate-300">
          {overarchingNotes.map((note, index) => (
            <li key={`overarching-note-${index}`} className="whitespace-normal break-words">
              {note}
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-slate-300/20">
        {renderEqualizedSection()}
      </div>
    </div>
  );
}
