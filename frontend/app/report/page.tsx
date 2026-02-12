"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { baseUrl } from "@/lib/api";
import type { ReportData } from "@/lib/types";

function ReportContent() {
  const searchParams = useSearchParams();
  const reportId = searchParams.get("reportId");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) {
      setError("Missing reportId");
      return;
    }
    fetch(`${baseUrl}/reports/${reportId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Report not found");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [reportId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-100 p-8">
        <p className="text-red-700">{error}</p>
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

  const { scenarios, branding } = data;
  const chartRows = scenarios.map(({ scenario, result }) => ({
    name: scenario.name,
    avg_cost_psf_year: result.avg_cost_psf_year,
    npv_cost: result.npv_cost,
    avg_cost_year: result.avg_cost_year,
  }));

  const pageBreak = "break-after-page print:break-after-page";
  const sectionClass = `min-h-[80vh] flex flex-col justify-center p-8 md:p-12 ${pageBreak}`;

  return (
    <div className="bg-white text-stone-900 print:bg-white">

      {/* 1. Cover */}
      <section className={`min-h-screen flex flex-col justify-center p-8 md:p-12 ${pageBreak}`}>
        <div className="max-w-2xl">
          {branding?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_url} alt="Logo" className="h-12 object-contain mb-8 print:max-h-14" />
          )}
          <h1 className="text-3xl md:text-4xl font-bold text-stone-900 mb-2">
            Lease Economics Comparison
          </h1>
          {branding?.client_name && (
            <p className="text-xl text-stone-600">{branding.client_name}</p>
          )}
          {branding?.date && (
            <p className="text-stone-500 mt-4">As of {branding.date}</p>
          )}
          {branding?.market && (
            <p className="text-stone-500">{branding.market}</p>
          )}
          {branding?.broker_name && (
            <p className="text-stone-500 mt-2">Prepared by {branding.broker_name}</p>
          )}
        </div>
      </section>

      {/* 2. Executive summary */}
      <section className={sectionClass}>
        <h2 className="text-2xl font-semibold text-stone-800 mb-6">Executive Summary</h2>
        <p className="text-stone-600 max-w-2xl">
          This deck compares {scenarios.length} lease scenario{scenarios.length !== 1 ? "s" : ""} across key financial metrics including net present value (NPV), average cost per square foot, and nominal rent and operating expense totals.
        </p>
        <ul className="mt-6 list-disc list-inside text-stone-600 space-y-2">
          {scenarios.map(({ scenario, result }) => (
            <li key={scenario.name}>
              <strong>{scenario.name}</strong>: {formatCurrency(result.npv_cost)} NPV cost over {result.term_months} months; {formatNumber(result.avg_cost_psf_year)} $/SF/yr average.
            </li>
          ))}
        </ul>
      </section>

      {/* 3. Comparison table */}
      <section className={sectionClass}>
        <h2 className="text-2xl font-semibold text-stone-800 mb-6">Scenario Comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-stone-200">
            <thead>
              <tr className="bg-stone-100 border-b border-stone-200">
                <th className="text-left py-3 px-4 font-medium text-stone-700">Scenario</th>
                <th className="text-right py-3 px-4 font-medium text-stone-700">Term (mo)</th>
                <th className="text-right py-3 px-4 font-medium text-stone-700">Rent (nom.)</th>
                <th className="text-right py-3 px-4 font-medium text-stone-700">Opex (nom.)</th>
                <th className="text-right py-3 px-4 font-medium text-stone-700">Total (nom.)</th>
                <th className="text-right py-3 px-4 font-medium text-stone-700">NPV cost</th>
                <th className="text-right py-3 px-4 font-medium text-stone-700">Avg $/SF/yr</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map(({ scenario, result }) => (
                <tr key={scenario.name} className="border-b border-stone-100">
                  <td className="py-2 px-4 font-medium">{scenario.name}</td>
                  <td className="py-2 px-4 text-right">{result.term_months}</td>
                  <td className="py-2 px-4 text-right">{formatCurrency(result.rent_nominal)}</td>
                  <td className="py-2 px-4 text-right">{formatCurrency(result.opex_nominal)}</td>
                  <td className="py-2 px-4 text-right">{formatCurrency(result.total_cost_nominal)}</td>
                  <td className="py-2 px-4 text-right">{formatCurrency(result.npv_cost)}</td>
                  <td className="py-2 px-4 text-right">{formatNumber(result.avg_cost_psf_year)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Chart: Avg cost $/SF/year */}
      <section className={sectionClass}>
        <h2 className="text-2xl font-semibold text-stone-800 mb-6">Average Cost per SF/Year by Scenario</h2>
        <div className="h-80 w-full max-w-xl">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 8, right: 24, left: 8, bottom: 8 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
              <Bar dataKey="avg_cost_psf_year" fill="#57534e" radius={[0, 4, 4, 0]} name="Avg $/SF/yr" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 5. Chart: NPV cost */}
      <section className={sectionClass}>
        <h2 className="text-2xl font-semibold text-stone-800 mb-6">NPV Cost by Scenario</h2>
        <div className="h-80 w-full max-w-xl">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 8, right: 24, left: 8, bottom: 8 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
              <Bar dataKey="npv_cost" fill="#78716c" radius={[0, 4, 4, 0]} name="NPV cost" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 6. Chart: Avg cost/year */}
      <section className={sectionClass}>
        <h2 className="text-2xl font-semibold text-stone-800 mb-6">Average Cost per Year by Scenario</h2>
        <div className="h-80 w-full max-w-xl">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 8, right: 24, left: 8, bottom: 8 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
              <Bar dataKey="avg_cost_year" fill="#a8a29e" radius={[0, 4, 4, 0]} name="Avg cost/yr" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 7. Key assumptions */}
      <section className={sectionClass}>
        <h2 className="text-2xl font-semibold text-stone-800 mb-6">Key Assumptions</h2>
        <ul className="list-disc list-inside text-stone-600 space-y-2 max-w-2xl">
          {scenarios.map(({ scenario }) => (
            <li key={scenario.name}>
              <strong>{scenario.name}</strong>: {scenario.rsf.toLocaleString()} RSF, {scenario.commencement} – {scenario.expiration}, discount rate {(scenario.discount_rate_annual * 100).toFixed(1)}%, opex mode {scenario.opex_mode}.
            </li>
          ))}
        </ul>
      </section>

      {/* 8. Disclaimer */}
      <section className={`min-h-[50vh] p-8 md:p-12 ${pageBreak}`}>
        <h2 className="text-2xl font-semibold text-stone-800 mb-4">Disclaimer</h2>
        <p className="text-stone-600 text-sm max-w-2xl">
          This analysis is for discussion purposes only. Figures are based on the assumptions provided and do not constitute legal or financial advice. Please verify all terms with your legal and real estate advisors.
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
