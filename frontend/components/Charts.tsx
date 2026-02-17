"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatCurrencyPerSF } from "@/lib/format";
import type { CashflowResult } from "@/lib/types";

export interface ChartRow {
  name: string;
  avg_cost_psf_year: number;
  npv_cost: number;
  avg_cost_year: number;
}

interface ChartsProps {
  data: ChartRow[];
}

export function Charts({ data }: ChartsProps) {
  if (data.length === 0) return null;

  const chartClass = "rounded-xl border border-white/10 bg-white/[0.03] p-5";
  const chartHeight = 280;
  const gridStroke = "rgba(255,255,255,0.08)";
  const barFill = "#3b82f6";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className={chartClass}>
        <h3 className="text-sm font-medium text-white mb-3">
          Avg cost $/SF/year by scenario
        </h3>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#71717a" }} tickFormatter={(v) => formatCurrencyPerSF(v)} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "#a1a1aa" }} />
              <Tooltip formatter={(v: number) => formatCurrencyPerSF(v)} contentStyle={{ backgroundColor: "#111113", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} labelStyle={{ color: "#fff" }} />
              <Bar dataKey="avg_cost_psf_year" fill={barFill} radius={[0, 4, 4, 0]} name="Avg $/SF/yr" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={chartClass}>
        <h3 className="text-sm font-medium text-white mb-3">
          NPV cost by scenario
        </h3>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#71717a" }} tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "#a1a1aa" }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ backgroundColor: "#111113", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} labelStyle={{ color: "#fff" }} />
              <Bar dataKey="npv_cost" fill={barFill} radius={[0, 4, 4, 0]} name="NPV cost" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={chartClass}>
        <h3 className="text-sm font-medium text-white mb-3">
          Avg cost/year by scenario
        </h3>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#71717a" }} tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "#a1a1aa" }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ backgroundColor: "#111113", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} labelStyle={{ color: "#fff" }} />
              <Bar dataKey="avg_cost_year" fill={barFill} radius={[0, 4, 4, 0]} name="Avg cost/yr" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
