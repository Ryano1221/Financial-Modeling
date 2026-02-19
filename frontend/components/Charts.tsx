"use client";

import { formatCurrency, formatCurrencyPerSF } from "@/lib/format";

export interface ChartRow {
  name: string;
  avg_cost_psf_year: number;
  npv_cost: number;
  avg_cost_year: number;
}

interface ChartsProps {
  data: ChartRow[];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function MetricCard({
  title,
  rows,
  getValue,
  format,
}: {
  title: string;
  rows: ChartRow[];
  getValue: (r: ChartRow) => number;
  format: (v: number) => string;
}) {
  const values = rows.map(getValue).map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(1, ...values);
  return (
    <div className="surface-card p-4 sm:p-5">
      <h3 className="text-base font-semibold text-slate-100 mb-4 tracking-tight">{title}</h3>
      <div className="space-y-3">
        {rows.map((row) => {
          const value = Number.isFinite(getValue(row)) ? getValue(row) : 0;
          const widthPct = clampPercent((value / max) * 100);
          return (
            <div key={`${title}-${row.name}`} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-200 truncate max-w-[58%] sm:max-w-[65%]" title={row.name}>
                  {row.name}
                </span>
                <span className="text-xs text-slate-300">{format(value)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-600/35 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-400 to-blue-600"
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

export function Charts({ data }: ChartsProps) {
  if (data.length === 0) return null;

  const rows = data.filter(
    (d) =>
      Number.isFinite(d.avg_cost_psf_year) &&
      Number.isFinite(d.npv_cost) &&
      Number.isFinite(d.avg_cost_year)
  );
  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 sm:gap-6">
      <MetricCard
        title="Avg cost $/SF/year by scenario"
        rows={rows}
        getValue={(r) => r.avg_cost_psf_year}
        format={(v) => formatCurrencyPerSF(v)}
      />
      <MetricCard
        title="NPV cost by scenario"
        rows={rows}
        getValue={(r) => r.npv_cost}
        format={(v) => formatCurrency(v)}
      />
      <MetricCard
        title="Avg cost/year by scenario"
        rows={rows}
        getValue={(r) => r.avg_cost_year}
        format={(v) => formatCurrency(v)}
      />
    </div>
  );
}
