"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
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

type MatrixRow = { label: string; value: (d: DerivedScenario) => string };

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

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function shortenLabel(name: string, max = 26): string {
  const clean = (name || "").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
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

function buildLeaseAbstractBullets(d: DerivedScenario): string[] {
  const bullets: string[] = [];
  bullets.push(
    `${d.premises || d.name}: ${formatRSF(d.rsf)}, ${formatMonths(d.termMonths)} term (${formatDateISO(d.commencement)} to ${formatDateISO(d.expiration)}), ${d.leaseType.toUpperCase()} structure.`
  );
  bullets.push(
    `Financial profile: ${formatCurrency(d.npvCost)} NPV, ${formatCurrencyPerSF(d.avgCostPsfYear)} average cost/SF/year, ${formatCurrency(d.totalObligation)} total nominal obligation.`
  );

  if (d.rentSteps.length > 0) {
    const first = d.rentSteps[0];
    const last = d.rentSteps[d.rentSteps.length - 1];
    bullets.push(
      `Base rent schedule runs ${d.rentSteps.length} step(s), from ${formatCurrencyPerSF(first.rate)} to ${formatCurrencyPerSF(last.rate)}.`
    );
  }
  if (d.freeRentMonths > 0) bullets.push(`Free rent: ${formatNumber(d.freeRentMonths)} month(s).`);
  if (d.tiAllowancePsf > 0) bullets.push(`TI allowance: ${formatCurrencyPerSF(d.tiAllowancePsf)} (${formatCurrency(d.tiAllowanceGross)} gross).`);
  if (d.parkingSpaces > 0) bullets.push(`Parking: ${formatNumber(d.parkingSpaces)} spaces at ${formatCurrency(d.parkingMonthly)} per month total.`);

  const clauseLines = d.clauses.slice(0, 10).map((c) => `${c.category}: ${c.detail}`);
  bullets.push(...clauseLines);

  if (clauseLines.length === 0) {
    bullets.push("No specific clause notes were extracted. Manually confirm ROFR/ROFO, renewal rights, termination language, and OpEx exclusions in the source lease.");
  }

  return bullets;
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

  const branding = data?.branding;
  const derived = useMemo(() => (data?.scenarios ?? []).map(deriveScenario), [data?.scenarios]);

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
    shortName: shortenLabel(d.name, 22),
    avg_cost_psf_year: d.avgCostPsfYear,
    npv_cost: d.npvCost,
    avg_cost_year: d.avgCostYear,
  }));

  const sortedByNpv = [...derived].sort((a, b) => a.npvCost - b.npvCost);
  const best = sortedByNpv[0];

  const matrixRows: MatrixRow[] = [
    { label: "Building", value: (d) => d.buildingName || "-" },
    { label: "Suite", value: (d) => d.suite || "-" },
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

  const scenarioChunks = chunkArray(derived, 3);
  const metricChunks = chunkArray(matrixRows, 11);
  const chartChunks = chunkArray(chartRows, 8);

  const reportDate = branding?.date || new Date().toISOString().slice(0, 10);
  const pageBreak = "page-break";

  return (
    <div className="report-page bg-[#f8fafc] text-stone-900 print:bg-white print:text-black">
      <main className="mx-auto max-w-[1400px] print:max-w-none">
        <section className={`px-10 py-12 md:px-14 md:py-16 ${pageBreak}`}>
          <p className="text-xs uppercase tracking-[0.32em] text-stone-500">Investor Financial Analysis</p>
          <h1 className="text-4xl md:text-5xl font-bold mt-3 leading-tight">Lease Economics Comparison Deck</h1>
          <p className="text-stone-600 mt-4 max-w-4xl text-sm md:text-base">
            Institutional-grade side-by-side comparison across {derived.length} proposal{derived.length !== 1 ? "s" : ""},
            with risk-focused lease abstract notes and valuation metrics optimized for client decision-making.
          </p>

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-stone-500">Prepared for</p>
              <p className="font-semibold mt-0.5">{branding?.client_name || "Client"}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-stone-500">Prepared by</p>
              <p className="font-semibold mt-0.5">{branding?.broker_name || "The CRE Model"}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-stone-500">Report date</p>
              <p className="font-semibold mt-0.5">{reportDate}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-stone-500">Market</p>
              <p className="font-semibold mt-0.5">{branding?.market || "N/A"}</p>
            </div>
          </div>

          {best ? (
            <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 avoid-break">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Best financial outcome by NPV</p>
              <h2 className="text-2xl font-semibold mt-1 text-emerald-900">{best.name}</h2>
              <p className="text-emerald-900/90 mt-2 text-sm md:text-base">
                {formatCurrency(best.npvCost)} NPV, {formatCurrencyPerSF(best.avgCostPsfYear)} average cost/SF/year,
                and {formatCurrency(best.totalObligation)} total nominal obligation.
              </p>
            </div>
          ) : null}
        </section>

        <section className={`px-8 py-9 md:px-10 md:py-10 ${pageBreak}`}>
          <h2 className="text-2xl font-semibold mb-4">Executive Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-stone-200 bg-white p-4 avoid-break">
              <p className="text-sm font-semibold mb-2">Ranking by NPV cost</p>
              <ul className="list-disc list-inside text-sm space-y-1 text-stone-700">
                {sortedByNpv.slice(0, 6).map((d, i) => (
                  <li key={`${d.name}-${i}`}>
                    Rank {i + 1}: <strong>{d.name}</strong> at {formatCurrency(d.npvCost)} NPV and {formatCurrencyPerSF(d.avgCostPsfYear)} average cost/SF/year.
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-4 avoid-break">
              <p className="text-sm font-semibold mb-2">Key decision points</p>
              <ul className="list-disc list-inside text-sm space-y-1 text-stone-700">
                <li>Validate legal rights and options: ROFR, ROFO, renewal/extension, termination, and assignment/sublease terms.</li>
                <li>Confirm OpEx treatment: exclusions, controllable caps, and base-year or NNN definitions.</li>
                <li>Reconcile TI, free-rent economics, and capex timing versus occupancy and cashflow priorities.</li>
                <li>Review parking and non-rent charges that may materially affect blended annual occupancy cost.</li>
              </ul>
            </div>
          </div>
        </section>

        {scenarioChunks.map((scenarioChunk, chunkIdx) =>
          metricChunks.map((metricChunk, metricIdx) => {
            const startOpt = chunkIdx * 3 + 1;
            const endOpt = startOpt + scenarioChunk.length - 1;
            const startMetric = metricIdx * 11 + 1;
            const endMetric = startMetric + metricChunk.length - 1;

            return (
              <section key={`matrix-${chunkIdx}-${metricIdx}`} className={`px-6 py-8 md:px-8 md:py-9 ${pageBreak}`}>
                <div className="mb-3">
                  <h2 className="text-2xl font-semibold">Comparison Matrix</h2>
                  <p className="text-xs text-stone-500 mt-1">
                    Options {startOpt}-{endOpt} of {derived.length} | Metrics {startMetric}-{endMetric} of {matrixRows.length}
                  </p>
                </div>
                <div className="overflow-hidden rounded-lg border border-stone-300 bg-white">
                  <table className="w-full border-collapse text-[10px] md:text-[11px] table-fixed">
                    <thead>
                      <tr className="bg-stone-100">
                        <th className="text-left p-2 border border-stone-300 w-[220px]">Metric</th>
                        {scenarioChunk.map((d, i) => (
                          <th key={`${d.name}-head-${i}`} className="text-left p-2 border border-stone-300 whitespace-normal break-words">{d.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metricChunk.map((row, rowIdx) => (
                        <tr key={row.label} className={rowIdx % 2 === 0 ? "bg-white" : "bg-stone-50"}>
                          <th className="text-left p-2 border border-stone-200 font-medium whitespace-normal break-words">{row.label}</th>
                          {scenarioChunk.map((d, i) => (
                            <td key={`${row.label}-${i}`} className="p-2 border border-stone-200 align-top whitespace-normal break-words">{row.value(d)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}

        {chartChunks.map((chunk, idx) => {
          const chartHeight = Math.max(300, chunk.length * 40);
          return (
            <section key={`charts-${idx}`} className={`px-8 py-9 md:px-10 md:py-10 ${pageBreak}`}>
              <h2 className="text-2xl font-semibold mb-4">Cost Visuals (Options {idx * 8 + 1}-{idx * 8 + chunk.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-stone-200 rounded-lg p-3 bg-white avoid-break">
                  <p className="font-medium text-sm mb-2">Average cost ($/SF/year)</p>
                  <div style={{ height: chartHeight }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chunk} layout="vertical" margin={{ top: 8, right: 14, left: 14, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(Number(v))} />
                        <YAxis type="category" dataKey="shortName" width={150} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => formatCurrencyPerSF(v)} />
                        <Bar dataKey="avg_cost_psf_year" fill="#0f172a" name="Avg cost/SF/year" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="border border-stone-200 rounded-lg p-3 bg-white avoid-break">
                  <p className="font-medium text-sm mb-2">NPV cost</p>
                  <div style={{ height: chartHeight }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chunk} layout="vertical" margin={{ top: 8, right: 14, left: 14, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(Number(v))} />
                        <YAxis type="category" dataKey="shortName" width={150} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Bar dataKey="npv_cost" fill="#334155" name="NPV cost" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>
          );
        })}

        <section className={`px-8 py-9 md:px-10 md:py-10 ${pageBreak}`}>
          <h2 className="text-2xl font-semibold mb-4">Lease Abstract Highlights</h2>
          <p className="text-sm text-stone-600 mb-5">
            Bullet-point lease abstract for each proposal. Items below should be verified against final legal lease language.
          </p>
          <div className="space-y-4">
            {derived.map((d, idx) => (
              <article key={`abstract-${d.name}-${idx}`} className="rounded-xl border border-stone-200 bg-white p-4 avoid-break">
                <h3 className="text-base font-semibold">{d.name}</h3>
                <p className="text-xs text-stone-500 mt-0.5">{d.premises || "Premises not specified"}</p>
                <ul className="mt-3 list-disc list-inside text-sm text-stone-700 space-y-1">
                  {buildLeaseAbstractBullets(d).map((line, lineIdx) => (
                    <li key={`${d.name}-bullet-${lineIdx}`}>{line}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {derived.map((d, i) => (
          <section key={`${d.name}-${i}`} className={`px-8 py-9 md:px-10 md:py-10 ${pageBreak}`}>
            <h2 className="text-2xl font-semibold mb-2">Scenario Detail: {d.name}</h2>
            <p className="text-stone-600 text-sm mb-4">{d.premises || "Premises not specified"}</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-6">
              <div className="border border-stone-200 rounded-lg p-3 bg-white"><p className="text-stone-500">RSF</p><p className="font-semibold">{formatRSF(d.rsf)}</p></div>
              <div className="border border-stone-200 rounded-lg p-3 bg-white"><p className="text-stone-500">Term</p><p className="font-semibold">{d.termYears.toFixed(2)} years</p></div>
              <div className="border border-stone-200 rounded-lg p-3 bg-white"><p className="text-stone-500">NPV</p><p className="font-semibold">{formatCurrency(d.npvCost)}</p></div>
              <div className="border border-stone-200 rounded-lg p-3 bg-white"><p className="text-stone-500">Avg cost/SF/year</p><p className="font-semibold">{formatCurrencyPerSF(d.avgCostPsfYear)}</p></div>
            </div>

            <h3 className="text-lg font-medium mb-2">Rent Steps</h3>
            <div className="overflow-hidden border border-stone-300 rounded-lg mb-5 bg-white">
              <table className="w-full text-xs table-fixed">
                <thead>
                  <tr className="bg-stone-100">
                    <th className="text-left p-2 border border-stone-300 w-32">Start month</th>
                    <th className="text-left p-2 border border-stone-300 w-32">End month</th>
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
          </section>
        ))}

        <section className="px-8 py-9 md:px-10 md:py-10">
          <h2 className="text-xl font-semibold mb-3">Disclaimer</h2>
          <p className="text-sm text-stone-600 max-w-4xl">
            This analysis is for discussion purposes only. Figures are based on the assumptions provided and do not constitute legal, accounting,
            or investment advice. Verify lease language and business terms with legal counsel and your brokerage team before final decisions.
          </p>
        </section>
      </main>

      <style jsx global>{`
        @media print {
          .report-page {
            background: #fff !important;
            color: #111827 !important;
          }
          .report-page .page-break {
            break-after: page;
            page-break-after: always;
          }
          .report-page .avoid-break {
            break-inside: avoid-page;
            page-break-inside: avoid;
          }
          .report-page table {
            page-break-inside: auto;
          }
          .report-page tr,
          .report-page td,
          .report-page th {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
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
