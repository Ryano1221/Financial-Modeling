"use client";

import { formatCurrency, formatCurrencyPerSF, formatMonths } from "@/lib/format";
import type { CashflowResult } from "@/lib/types";

export type SortKey = "avg_cost_psf_year" | "npv_cost" | "avg_cost_year";
export type SortDir = "asc" | "desc";

export interface ComparisonRow {
  id: string;
  name: string;
  result: CashflowResult;
}

interface ComparisonTableProps {
  rows: ComparisonRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

const COLUMNS: { key: keyof CashflowResult; label: string; format: (v: number | null | undefined) => string }[] = [
  { key: "term_months", label: "Term (mo)", format: formatMonths },
  { key: "rent_nominal", label: "Rent (nominal)", format: formatCurrency },
  { key: "opex_nominal", label: "Opex (nominal)", format: formatCurrency },
  { key: "total_cost_nominal", label: "Total cost (nominal)", format: formatCurrency },
  { key: "npv_cost", label: "NPV cost", format: formatCurrency },
  { key: "avg_cost_year", label: "Avg cost/year", format: formatCurrency },
  { key: "avg_cost_psf_year", label: "Avg $/SF/yr", format: formatCurrencyPerSF },
];

export function ComparisonTable({
  rows,
  sortKey,
  sortDir,
  onSort,
}: ComparisonTableProps) {
  if (rows.length === 0) {
    return null;
  }

  const SortHeader = ({ columnKey, label }: { columnKey: SortKey; label: string }) => (
    <th className="text-right py-2.5 px-4 font-medium text-zinc-400">
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="hover:text-white inline-flex items-center gap-0.5 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] rounded"
      >
        {label}
        {sortKey === columnKey && (
          <span className="text-zinc-500">{sortDir === "asc" ? "↑" : "↓"}</span>
        )}
      </button>
    </th>
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10">
        <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-1">Comparison</p>
        <h2 className="text-lg font-semibold text-white">Comparison</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Sort: default by Avg $/SF/yr ascending. Click column headers to sort by NPV cost or Avg cost/year.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs sm:text-sm">
          <thead>
            <tr className="bg-white/[0.04] border-b border-white/10">
              <th className="text-left py-2.5 px-4 font-medium text-zinc-400">Name</th>
              {COLUMNS.map((col) =>
                col.key === "term_months" ||
                col.key === "rent_nominal" ||
                col.key === "opex_nominal" ||
                col.key === "total_cost_nominal" ? (
                  <th key={col.key} className="text-right py-2.5 px-4 font-medium text-zinc-400">
                    {col.label}
                  </th>
                ) : (
                  <SortHeader key={col.key} columnKey={col.key as SortKey} label={col.label} />
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.04]">
                <td className="py-2.5 px-4 font-medium text-white max-w-[16rem] truncate" title={row.name}>{row.name}</td>
                {COLUMNS.map((col) => (
                  <td key={col.key} className="py-2.5 px-4 text-right text-zinc-400">
                    {col.format(row.result[col.key] as number)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
