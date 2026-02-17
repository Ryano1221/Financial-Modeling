"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  formatCurrency,
  formatCurrencyPerSF,
  formatDateISO,
  formatMonths,
  formatPercent,
  formatRSF,
  formatNumber,
} from "@/lib/format";
import { fetchApi, CONNECTION_MESSAGE } from "@/lib/api";
import type { ReportData } from "@/lib/types";

type ScenarioEntry = ReportData["scenarios"][number];

type ClauseHit = {
  category: string;
  detail: string;
};

type DerivedScenario = {
  name: string;
  buildingName: string;
  suite: string;
  premises: string;
  rsf: number;
  termMonths: number;
  termYears: number;
  commencement: string;
  expiration: string;
  leaseType: string;
  baseRentPsf: number;
  baseRentEscalation: number;
  baseOpexPsf: number;
  opexEscalation: number;
  freeRentMonths: number;
  parkingSpaces: number;
  parkingRatio: number;
  parkingMonthly: number;
  tiAllowancePsf: number;
  tiAllowanceGross: number;
  upfrontCapexGross: number;
  upfrontCapexPsf: number;
  avgGrossRentMonth: number;
  avgGrossRentYear: number;
  avgCostMonth: number;
  avgCostYear: number;
  avgCostPsfYear: number;
  npvCost: number;
  totalObligation: number;
  discountRate: number;
  rentSteps: Array<{ start: number; end: number; rate: number }>;
  notes: string;
  clauses: ClauseHit[];
};

const CLAUSE_PATTERNS: Array<{ category: string; regex: RegExp }> = [
  { category: "Renewal options", regex: /\brenew(al)?\b|\bextend\b/i },
  { category: "ROFR", regex: /\brofr\b|right of first refusal/i },
  { category: "ROFO", regex: /\brofo\b|right of first offer/i },
  { category: "Expansion rights", regex: /\bexpansion\b|\bexpansion right\b/i },
  { category: "Contraction rights", regex: /\bcontraction\b|give[- ]?back/i },
  { category: "Termination rights", regex: /\btermination\b|early termination/i },
  { category: "Assignment/sublease", regex: /\bassignment\b|\bsublease\b/i },
  { category: "OpEx exclusions", regex: /\bopex exclusion\b|excluded from opex|operating expense exclusion/i },
  { category: "Expense caps", regex: /\bexpense cap\b|cap on controllable|controllable expenses/i },
];

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

function rentEscalationFromSteps(steps: Array<{ start: number; end: number; rate_psf_yr: number }> | undefined): number {
  if (!steps || steps.length < 2) return 0;
  const sorted = [...steps]
    .map((s) => ({ start: toNumber(s.start), rate: toNumber(s.rate_psf_yr) }))
    .sort((a, b) => a.start - b.start);
  const first = sorted[0];
  const next = sorted.find((s) => s.start > first.start && s.rate !== first.rate) ?? sorted[1];
  if (!first || !next || first.rate <= 0) return 0;
  const yearsBetween = Math.max(1 / 12, (next.start - first.start) / 12);
  return Math.pow(next.rate / first.rate, 1 / yearsBetween) - 1;
}

function extractClauses(notes: string): ClauseHit[] {
  const text = (notes || "").trim();
  if (!text) return [];
  const parts = text
    .replace(/\r/g, "\n")
    .split(/\n+|\.\s+|;\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const hits: ClauseHit[] = [];
  for (const part of parts) {
    for (const pattern of CLAUSE_PATTERNS) {
      if (pattern.regex.test(part)) {
        hits.push({ category: pattern.category, detail: part });
        break;
      }
    }
  }
  if (hits.length > 0) return hits;
  if (text.length > 0) return [{ category: "General note", detail: text }];
  return [];
}

function deriveScenario(entry: ScenarioEntry): DerivedScenario {
  const scenario = entry.scenario;
  const result = entry.result;
  const rsf = toNumber(scenario.rsf);
  const termMonths = Math.max(0, Math.round(toNumber(result.term_months)));
  const termYears = safeDiv(termMonths, 12);
  const buildingName = (scenario.building_name || "").trim();
  const suite = (scenario.suite || "").trim();
  const premises = buildingName && suite ? `${buildingName} Suite ${suite}` : buildingName || suite || scenario.name;
  const parkingSpaces = toNumber(scenario.parking_spaces);
  const parkingRate = toNumber(scenario.parking_cost_monthly_per_space);
  const parkingMonthly = parkingSpaces * parkingRate;
  const tiAllowancePsf = toNumber(scenario.ti_allowance_psf);
  const tiAllowanceGross = tiAllowancePsf * rsf;
  const oneTimeCosts = Array.isArray(scenario.one_time_costs)
    ? scenario.one_time_costs.reduce((sum, c) => sum + toNumber(c.amount), 0)
    : 0;
  const upfrontCapexGross = oneTimeCosts + toNumber(scenario.broker_fee);
  const avgGrossRentMonth = safeDiv(toNumber(result.rent_nominal) + toNumber(result.opex_nominal), Math.max(1, termMonths));
  const avgGrossRentYear = avgGrossRentMonth * 12;
  const notes = (scenario.notes || "").trim();

  return {
    name: scenario.name,
    buildingName,
    suite,
    premises,
    rsf,
    termMonths,
    termYears,
    commencement: scenario.commencement,
    expiration: scenario.expiration,
    leaseType: scenario.opex_mode,
    baseRentPsf: toNumber(scenario.rent_steps?.[0]?.rate_psf_yr),
    baseRentEscalation: rentEscalationFromSteps(scenario.rent_steps),
    baseOpexPsf: toNumber(scenario.base_opex_psf_yr),
    opexEscalation: toNumber(scenario.opex_growth),
    freeRentMonths: toNumber(scenario.free_rent_months),
    parkingSpaces,
    parkingRatio: safeDiv(parkingSpaces, safeDiv(rsf, 1000)),
    parkingMonthly,
    tiAllowancePsf,
    tiAllowanceGross,
    upfrontCapexGross,
    upfrontCapexPsf: safeDiv(upfrontCapexGross, rsf),
    avgGrossRentMonth,
    avgGrossRentYear,
    avgCostMonth: safeDiv(toNumber(result.avg_cost_year), 12),
    avgCostYear: toNumber(result.avg_cost_year),
    avgCostPsfYear: toNumber(result.avg_cost_psf_year),
    npvCost: toNumber(result.npv_cost),
    totalObligation: toNumber(result.total_cost_nominal),
    discountRate: toNumber(scenario.discount_rate_annual),
    rentSteps: (scenario.rent_steps || []).map((s) => ({
      start: Math.max(0, Math.round(toNumber(s.start))),
      end: Math.max(0, Math.round(toNumber(s.end))),
      rate: toNumber(s.rate_psf_yr),
    })),
    notes,
    clauses: extractClauses(notes),
  };
}

function ReportContent() {
  const searchParams = useSearchParams();
  const reportId = searchParams.get("reportId");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scenarios = data?.scenarios || [];
  const branding = data?.branding;
  const derived = scenarios.map(deriveScenario);

  const loadReport = useCallback(async () => {
    if (!reportId) {
      setError("Missing report ID. Open a report from the main page.");
      return;
    }
    setError(null);
    try {
      const r = await fetchApi(`/reports/${reportId}`, { method: "GET" });
      if (!r.ok) throw new Error("Report not found");
      const json = await r.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : CONNECTION_MESSAGE);
    }
  }, [reportId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-100 p-8 gap-4">
        <p className="text-stone-700 text-center max-w-md">{error}</p>
        <button
          type="button"
          onClick={loadReport}
          className="min-h-[44px] px-6 py-2.5 rounded-lg bg-stone-800 text-white font-medium hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-100 p-8">
        <p className="text-stone-600">Loading report…</p>
      </div>
    );
  }

  const chartRows = derived.map((d) => ({
    name: d.name,
    avg_cost_psf_year: d.avgCostPsfYear,
    npv_cost: d.npvCost,
    avg_cost_year: d.avgCostYear,
  }));
  const sortedByNpv = [...derived].sort((a, b) => a.npvCost - b.npvCost);
  const best = sortedByNpv[0];

  const matrixRows: Array<{ label: string; value: (d: DerivedScenario) => string }> = [
    { label: "Premises", value: (d) => d.premises },
    { label: "Rentable square footage", value: (d) => formatRSF(d.rsf) },
    { label: "Lease term", value: (d) => `${d.termYears.toFixed(2)} years` },
    { label: "Lease commencement", value: (d) => formatDateISO(d.commencement) },
    { label: "Lease expiration", value: (d) => formatDateISO(d.expiration) },
    { label: "Lease type", value: (d) => d.leaseType.toUpperCase() },
    { label: "Base rent", value: (d) => formatCurrencyPerSF(d.baseRentPsf) },
    { label: "Annual base rent escalation", value: (d) => formatPercent(d.baseRentEscalation) },
    { label: "Base operating expenses", value: (d) => formatCurrencyPerSF(d.baseOpexPsf) },
    { label: "Annual opex escalation", value: (d) => formatPercent(d.opexEscalation) },
    { label: "Rent abatement", value: (d) => `${formatNumber(d.freeRentMonths)} months` },
    { label: "Parking ratio", value: (d) => `${formatNumber(d.parkingRatio, { decimals: 2 })}/1,000 SF` },
    { label: "Allotted parking spaces", value: (d) => formatNumber(d.parkingSpaces) },
    { label: "Monthly parking cost", value: (d) => formatCurrency(d.parkingMonthly) },
    { label: "TI allowance", value: (d) => formatCurrencyPerSF(d.tiAllowancePsf) },
    { label: "TI allowance (gross)", value: (d) => formatCurrency(d.tiAllowanceGross) },
    { label: "Up-front capex (PSF)", value: (d) => formatCurrencyPerSF(d.upfrontCapexPsf) },
    { label: "Up-front capex (gross)", value: (d) => formatCurrency(d.upfrontCapexGross) },
    { label: "Average gross rent/month", value: (d) => formatCurrency(d.avgGrossRentMonth) },
    { label: "Average gross rent/year", value: (d) => formatCurrency(d.avgGrossRentYear) },
    { label: "Average cost/SF/year", value: (d) => formatCurrencyPerSF(d.avgCostPsfYear) },
    { label: "Average cost/month", value: (d) => formatCurrency(d.avgCostMonth) },
    { label: "Average cost/year", value: (d) => formatCurrency(d.avgCostYear) },
    { label: "NPV @ discount rate", value: (d) => formatCurrency(d.npvCost) },
    { label: "Total estimated obligation", value: (d) => formatCurrency(d.totalObligation) },
    { label: "Discount rate", value: (d) => formatPercent(d.discountRate) },
  ];

  const pageBreak = "break-after-page print:break-after-page";

  return (
    <div className="bg-white text-stone-900 print:bg-white">
      <section className={`min-h-screen p-10 md:p-14 flex flex-col justify-center ${pageBreak}`}>
        <p className="text-sm uppercase tracking-[0.25em] text-stone-500">Financial Analysis</p>
        <h1 className="text-4xl md:text-5xl font-bold mt-2">Lease Economics Comparison</h1>
        <p className="text-stone-600 mt-3 max-w-3xl">
          Side-by-side financial comparison across {derived.length} scenario{derived.length !== 1 ? "s" : ""}.
          Built for executive review and decision support.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-4 max-w-2xl text-sm">
          <div>
            <p className="text-stone-500">Prepared for</p>
            <p className="font-medium">{branding?.client_name || "Client"}</p>
          </div>
          <div>
            <p className="text-stone-500">Report date</p>
            <p className="font-medium">{branding?.date || new Date().toISOString().slice(0, 10)}</p>
          </div>
          <div>
            <p className="text-stone-500">Market</p>
            <p className="font-medium">{branding?.market || "N/A"}</p>
          </div>
          <div>
            <p className="text-stone-500">Prepared by</p>
            <p className="font-medium">{branding?.broker_name || "The CRE Model"}</p>
          </div>
        </div>
      </section>

      <section className={`p-8 md:p-10 ${pageBreak}`}>
        <h2 className="text-2xl font-semibold mb-4">Executive Summary</h2>
        {best ? (
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 mb-4">
            <p className="text-sm text-stone-600">Lowest NPV scenario</p>
            <p className="text-lg font-semibold text-stone-900">{best.name}</p>
            <p className="text-sm text-stone-700 mt-1">
              {formatCurrency(best.npvCost)} NPV, {formatCurrencyPerSF(best.avgCostPsfYear)} average cost/SF/year, {formatCurrency(best.totalObligation)} total obligation.
            </p>
          </div>
        ) : null}
        <ul className="list-disc list-inside text-stone-700 space-y-1">
          {sortedByNpv.slice(0, 3).map((d, i) => (
            <li key={`${d.name}-${i}`}>
              Rank {i + 1}: <strong>{d.name}</strong> at {formatCurrency(d.npvCost)} NPV and {formatCurrencyPerSF(d.avgCostPsfYear)} average cost/SF/year.
            </li>
          ))}
        </ul>
      </section>

      <section className={`p-6 md:p-8 ${pageBreak}`}>
        <h2 className="text-2xl font-semibold mb-4">Comparison Matrix</h2>
        <div className="overflow-x-auto border border-stone-300 rounded-lg">
          <table className="w-full text-[10px] md:text-[11px] border-collapse">
            <thead>
              <tr className="bg-stone-100">
                <th className="text-left p-2 border border-stone-300 sticky left-0 bg-stone-100 min-w-[220px]">Analysis</th>
                {derived.map((d, i) => (
                  <th key={`${d.name}-head-${i}`} className="text-left p-2 border border-stone-300 min-w-[160px]">{d.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row, rowIdx) => (
                <tr key={row.label} className={rowIdx % 2 === 0 ? "bg-white" : "bg-stone-50"}>
                  <th className="text-left p-2 border border-stone-200 font-medium sticky left-0 bg-inherit">{row.label}</th>
                  {derived.map((d, i) => (
                    <td key={`${row.label}-${i}`} className="p-2 border border-stone-200 align-top">{row.value(d)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`p-8 md:p-10 ${pageBreak}`}>
        <h2 className="text-2xl font-semibold mb-5">Scenario Cost Visuals</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-80 border border-stone-200 rounded-lg p-3">
            <p className="font-medium text-sm mb-2">Avg cost $/SF/year</p>
            <ResponsiveContainer width="100%" height="92%">
              <BarChart data={chartRows} layout="vertical" margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} />
                <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatCurrencyPerSF(v)} />
                <Legend />
                <Bar dataKey="avg_cost_psf_year" fill="#1f2937" name="Avg cost/SF/year" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-80 border border-stone-200 rounded-lg p-3">
            <p className="font-medium text-sm mb-2">NPV cost</p>
            <ResponsiveContainer width="100%" height="92%">
              <BarChart data={chartRows} layout="vertical" margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} />
                <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="npv_cost" fill="#334155" name="NPV" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-80 border border-stone-200 rounded-lg p-3">
            <p className="font-medium text-sm mb-2">Avg cost/year</p>
            <ResponsiveContainer width="100%" height="92%">
              <BarChart data={chartRows} layout="vertical" margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v)} />
                <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="avg_cost_year" fill="#64748b" name="Avg cost/year" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {derived.map((d, i) => (
        <section key={`${d.name}-${i}`} className={`p-8 md:p-10 ${pageBreak}`}>
          <h2 className="text-2xl font-semibold mb-2">Scenario Detail: {d.name}</h2>
          <p className="text-stone-600 text-sm mb-4">{d.premises || "Premises not specified"}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-6">
            <div className="border border-stone-200 rounded-lg p-3"><p className="text-stone-500">RSF</p><p className="font-semibold">{formatRSF(d.rsf)}</p></div>
            <div className="border border-stone-200 rounded-lg p-3"><p className="text-stone-500">Term</p><p className="font-semibold">{d.termYears.toFixed(2)} years</p></div>
            <div className="border border-stone-200 rounded-lg p-3"><p className="text-stone-500">NPV</p><p className="font-semibold">{formatCurrency(d.npvCost)}</p></div>
            <div className="border border-stone-200 rounded-lg p-3"><p className="text-stone-500">Avg cost/SF/year</p><p className="font-semibold">{formatCurrencyPerSF(d.avgCostPsfYear)}</p></div>
          </div>

          <h3 className="text-lg font-medium mb-2">Rent Steps</h3>
          <div className="overflow-x-auto border border-stone-300 rounded-lg mb-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-stone-100">
                  <th className="text-left p-2 border border-stone-300">Start month</th>
                  <th className="text-left p-2 border border-stone-300">End month</th>
                  <th className="text-left p-2 border border-stone-300">Rate ($/SF/year)</th>
                </tr>
              </thead>
              <tbody>
                {d.rentSteps.length === 0 ? (
                  <tr><td colSpan={3} className="p-2 border border-stone-200 text-stone-500">No rent steps provided.</td></tr>
                ) : d.rentSteps.map((step, idx) => (
                  <tr key={`${d.name}-step-${idx}`} className={idx % 2 === 0 ? "bg-white" : "bg-stone-50"}>
                    <td className="p-2 border border-stone-200">{step.start}</td>
                    <td className="p-2 border border-stone-200">{step.end}</td>
                    <td className="p-2 border border-stone-200">{formatCurrencyPerSF(step.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-medium mb-2">Relevant Notes & Clauses</h3>
          {d.clauses.length > 0 ? (
            <div className="border border-stone-300 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-stone-100">
                    <th className="text-left p-2 border border-stone-300 w-44">Category</th>
                    <th className="text-left p-2 border border-stone-300">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {d.clauses.map((c, idx) => (
                    <tr key={`${d.name}-clause-${idx}`} className={idx % 2 === 0 ? "bg-white" : "bg-stone-50"}>
                      <td className="p-2 border border-stone-200 font-medium">{c.category}</td>
                      <td className="p-2 border border-stone-200">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-stone-500">No additional lease notes were captured for this scenario.</p>
          )}
        </section>
      ))}

      <section className="min-h-[40vh] p-8 md:p-10">
        <h2 className="text-xl font-semibold mb-3">Disclaimer</h2>
        <p className="text-sm text-stone-600 max-w-3xl">
          This analysis is for discussion purposes only. Figures are based on the assumptions provided and do not constitute legal, accounting, or investment advice.
          Verify lease language and business terms with legal counsel and your brokerage team prior to final decisions.
        </p>
      </section>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-stone-100 p-8"><p className="text-stone-600">Loading…</p></div>}>
      <ReportContent />
    </Suspense>
  );
}
