"use client";

import { useEffect, useState } from "react";
import type { ScenarioWithId, ScenarioInput, RentStep, OpexMode } from "@/lib/types";
import { buildPremisesName } from "@/lib/canonical-api";

interface ScenarioFormProps {
  scenario: ScenarioWithId | null;
  onUpdate: (s: ScenarioWithId) => void;
  onAddScenario: () => void;
  onDuplicateScenario: () => void;
  onDeleteScenario: (id: string) => void;
  onAcceptChanges: () => void;
}

const defaultScenarioInput: ScenarioInput = {
  name: "New scenario",
  building_name: "",
  suite: "",
  floor: "",
  rsf: 10000,
  commencement: "2026-01-01",
  expiration: "2031-01-01",
  rent_steps: [{ start: 0, end: 59, rate_psf_yr: 30 }],
  free_rent_months: 3,
  free_rent_start_month: 0,
  free_rent_end_month: 2,
  free_rent_abatement_type: "base",
  ti_allowance_psf: 50,
  opex_mode: "nnn",
  base_opex_psf_yr: 10,
  base_year_opex_psf_yr: 10,
  opex_growth: 0.03,
  discount_rate_annual: 0.08,
};

export function ScenarioForm({
  scenario,
  onUpdate,
  onAddScenario,
  onDuplicateScenario,
  onDeleteScenario,
  onAcceptChanges,
}: ScenarioFormProps) {
  const [commencementInput, setCommencementInput] = useState("");
  const [expirationInput, setExpirationInput] = useState("");

  const isoToDisplayDate = (value: string): string => {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return "";
    const yyyy = match[1];
    const mm = String(Number(match[2])).padStart(2, "0");
    const dd = String(Number(match[3])).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  };

  const displayToIsoDate = (value: string): string | null => {
    const text = String(value || "").trim();
    if (!text) return null;
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
      const yyyy = Number(iso[1]);
      const mm = Number(iso[2]);
      const dd = Number(iso[3]);
      const parsed = new Date(yyyy, mm - 1, dd);
      if (parsed.getFullYear() === yyyy && parsed.getMonth() + 1 === mm && parsed.getDate() === dd) {
        return `${String(yyyy)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      }
      return null;
    }
    const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dmy) return null;
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    const parsed = new Date(yyyy, mm - 1, dd);
    if (parsed.getFullYear() !== yyyy || parsed.getMonth() + 1 !== mm || parsed.getDate() !== dd) return null;
    return `${String(yyyy)}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  };

  useEffect(() => {
    setCommencementInput(isoToDisplayDate(scenario?.commencement ?? ""));
    setExpirationInput(isoToDisplayDate(scenario?.expiration ?? ""));
  }, [scenario?.id, scenario?.commencement, scenario?.expiration]);

  const termMonthsFromDates = (commencement: string, expiration: string): number => {
    const [cy, cm, cd] = String(commencement || "").split("-").map(Number);
    const [ey, em, ed] = String(expiration || "").split("-").map(Number);
    if (!cy || !cm || !cd || !ey || !em || !ed) return 1;
    let months = (ey - cy) * 12 + (em - cm);
    if (ed < cd) months -= 1;
    if (cd === 1) {
      const monthEnd = new Date(ey, em, 0).getDate();
      if (ed === monthEnd) months += 1;
    }
    return Math.max(1, months);
  };

  const applyFreeRentConsistency = (nextScenario: ScenarioWithId): ScenarioWithId => {
    const termMonths = termMonthsFromDates(nextScenario.commencement, nextScenario.expiration);
    const start = Math.max(0, Math.floor(Number(nextScenario.free_rent_start_month ?? 0) || 0));
    const months = Math.max(0, Math.floor(Number(nextScenario.free_rent_months ?? 0) || 0));
    const maxMonth = Math.max(0, termMonths - 1);
    const clampedStart = Math.min(start, maxMonth);
    const derivedEnd = months > 0 ? Math.min(maxMonth, clampedStart + months - 1) : clampedStart;
    return {
      ...nextScenario,
      free_rent_start_month: clampedStart,
      free_rent_end_month: derivedEnd,
      free_rent_months: months > 0 ? (derivedEnd - clampedStart + 1) : 0,
      free_rent_abatement_type: nextScenario.free_rent_abatement_type === "gross" ? "gross" : "base",
    };
  };

  const formatRsf = (value: number): string =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
      Math.max(0, Number(value) || 0)
    );

  const toDisplayMonth = (monthIndex: number): number => {
    if (!Number.isFinite(monthIndex)) return 1;
    return Math.max(1, Math.floor(monthIndex) + 1);
  };
  const toInternalMonth = (displayMonth: number): number => {
    if (!Number.isFinite(displayMonth)) return 0;
    return Math.max(0, Math.floor(displayMonth) - 1);
  };
  const freeStart = Math.max(0, Math.floor(Number(scenario?.free_rent_start_month ?? 0) || 0));
  const freeEndFallback = Math.max(freeStart, freeStart + Math.max(0, Math.floor(Number(scenario?.free_rent_months ?? 0) || 0)) - 1);
  const freeEnd = Math.max(freeStart, Math.floor(Number(scenario?.free_rent_end_month ?? freeEndFallback) || freeEndFallback));
  const hasFreeRent = (Number(scenario?.free_rent_months) || 0) > 0;
  const parseDateParts = (iso: string): { year: number; month: number; day: number } | null => {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    return { year: y, month: m, day: d };
  };
  const calendarYearForMonthIndex = (monthIndex: number): number | null => {
    if (!scenario) return null;
    const parts = parseDateParts(scenario.commencement);
    if (!parts) return null;
    const total = (parts.month - 1) + Math.max(0, Math.floor(monthIndex));
    return parts.year + Math.floor(total / 12);
  };
  const opexAnnualAtMonth = (monthIndex: number): number => {
    if (!scenario) return 0;
    const year = calendarYearForMonthIndex(monthIndex);
    if (!year) return Math.max(0, Number(scenario.base_opex_psf_yr) || 0);
    const commYear = calendarYearForMonthIndex(0) ?? year;
    const growth = Math.max(0, Number(scenario.opex_growth) || 0);
    const base = Math.max(0, Number(scenario.base_opex_psf_yr) || 0);
    const escalated = base * ((1 + growth) ** Math.max(0, year - commYear));
    if (scenario.opex_mode === "base_year") {
      const baseYearStop = Math.max(0, Number(scenario.base_year_opex_psf_yr) || 0);
      return Math.max(0, escalated - baseYearStop);
    }
    return escalated;
  };
  const isInFreeRange = (start: number, end: number): boolean => {
    if (!hasFreeRent) return false;
    return end >= freeStart && start <= freeEnd;
  };
  const formatCurrencyPsf = (value: number): string => `$${(Math.round(value * 100) / 100).toFixed(2)}`;
  const opexRangeLabel = (startMonth: number, endMonth: number): string => {
    const startVal = opexAnnualAtMonth(startMonth);
    const endVal = opexAnnualAtMonth(endMonth);
    if (Math.abs(startVal - endVal) < 0.01) return formatCurrencyPsf(startVal);
    return `${formatCurrencyPsf(startVal)} -> ${formatCurrencyPsf(endVal)}`;
  };

  const stepRsfLabel = (startMonth: number, endMonth: number): string => {
    if (!scenario) return "0 SF";
    const phase = (scenario.phase_in_steps ?? [])
      .filter((p) => p.start_month <= endMonth && p.end_month >= startMonth)
      .sort((a, b) => a.start_month - b.start_month);
    if (phase.length === 0) return `${formatRsf(scenario.rsf)} SF`;
    const unique = Array.from(
      new Set(
        phase
          .map((p) => Math.round(Number(p.rsf) || 0))
          .filter((v) => v > 0)
      )
    );
    if (unique.length <= 1) return `${formatRsf(unique[0] ?? scenario.rsf)} SF`;
    const min = Math.min(...unique);
    const max = Math.max(...unique);
    return `${formatRsf(min)} - ${formatRsf(max)} SF`;
  };

  const leaseYearLabel = (startMonthRaw: number, endMonthRaw: number): string => {
    const startMonth = Math.max(0, Math.floor(Number(startMonthRaw) || 0));
    const endMonth = Math.max(startMonth, Math.floor(Number(endMonthRaw) || 0));
    const startDisplayMonth = startMonth + 1;
    const endDisplayMonth = endMonth + 1;
    const startYear = Math.floor((startDisplayMonth - 1) / 12) + 1;
    const endYear = Math.floor((endDisplayMonth - 1) / 12) + 1;
    const yearLabel = startYear === endYear ? `Year ${startYear}` : `Years ${startYear}-${endYear}`;
    return `${yearLabel} (M${startDisplayMonth}-${endDisplayMonth})`;
  };
  const formatDateDDMMYYYY = (value: Date): string => {
    const dd = String(value.getUTCDate()).padStart(2, "0");
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = value.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  const leaseMonthStartDate = (monthIndexRaw: number): Date | null => {
    if (!scenario) return null;
    const parts = parseDateParts(scenario.commencement);
    if (!parts) return null;
    const monthIndex = Math.max(0, Math.floor(Number(monthIndexRaw) || 0));
    const totalMonths = (parts.month - 1) + monthIndex;
    const year = parts.year + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    const daysInTargetMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(parts.day, daysInTargetMonth);
    return new Date(Date.UTC(year, month - 1, day));
  };
  const leaseStepDateLabel = (startMonthRaw: number, endMonthRaw: number): string => {
    const startMonth = Math.max(0, Math.floor(Number(startMonthRaw) || 0));
    const endMonth = Math.max(startMonth, Math.floor(Number(endMonthRaw) || 0));
    const startDate = leaseMonthStartDate(startMonth);
    const nextStart = leaseMonthStartDate(endMonth + 1);
    if (!startDate || !nextStart) return "N/A";
    const endDate = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
    return `${formatDateDDMMYYYY(startDate)} - ${formatDateDDMMYYYY(endDate)}`;
  };
  const termMonths = scenario ? termMonthsFromDates(scenario.commencement, scenario.expiration) : 1;
  type PeriodizedRow = {
    start: number;
    end: number;
    dateLabel: string;
    baseRate: number;
    opexRate: number;
    rsfLabel: string;
    yearsLabel: string;
    abatementNote: string;
  };
  const periodizedRows: PeriodizedRow[] = (() => {
    if (!scenario || scenario.rent_steps.length === 0) return [];
    const boundaries = new Set<number>([0, Math.max(1, termMonths)]);
    scenario.rent_steps.forEach((s) => {
      boundaries.add(Math.max(0, Math.floor(Number(s.start) || 0)));
      boundaries.add(Math.max(0, Math.floor(Number(s.end) || 0) + 1));
    });
    (scenario.phase_in_steps ?? []).forEach((p) => {
      boundaries.add(Math.max(0, Math.floor(Number(p.start_month) || 0)));
      boundaries.add(Math.max(0, Math.floor(Number(p.end_month) || 0) + 1));
    });
    if (hasFreeRent) {
      boundaries.add(freeStart);
      boundaries.add(freeEnd + 1);
    }
    let prevYear = calendarYearForMonthIndex(0);
    for (let m = 1; m < termMonths; m += 1) {
      const y = calendarYearForMonthIndex(m);
      if (y != null && prevYear != null && y !== prevYear) boundaries.add(m);
      if (y != null) prevYear = y;
    }

    const sorted = Array.from(boundaries)
      .map((n) => Math.max(0, Math.floor(n)))
      .filter((n) => n <= termMonths)
      .sort((a, b) => a - b);
    const rows: PeriodizedRow[] = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i];
      const endExclusive = sorted[i + 1];
      if (endExclusive <= start) continue;
      const end = Math.min(termMonths - 1, endExclusive - 1);
      if (end < start) continue;
      const source = scenario.rent_steps.find((s) => start >= s.start && start <= s.end);
      if (!source) continue;
      const abated = isInFreeRange(start, end);
      const gross = abated && scenario.free_rent_abatement_type === "gross";
      rows.push({
        start,
        end,
        dateLabel: leaseStepDateLabel(start, end),
        baseRate: abated ? 0 : Math.max(0, Number(source.rate_psf_yr) || 0),
        opexRate: gross ? 0 : opexAnnualAtMonth(start),
        rsfLabel: stepRsfLabel(start, end),
        yearsLabel: leaseYearLabel(start, end),
        abatementNote: abated ? (gross ? "Gross abatement" : "Base-rent abatement") : "",
      });
    }
    return rows;
  })();

  const update = <K extends keyof ScenarioInput>(
    key: K,
    value: ScenarioInput[K]
  ) => {
    if (!scenario) return;
    let next = { ...scenario, [key]: value };
    if (key === "commencement" || key === "expiration" || key === "free_rent_months" || key === "free_rent_start_month" || key === "free_rent_abatement_type") {
      next = applyFreeRentConsistency(next);
    }
    if (key === "building_name" || key === "suite" || key === "floor") {
      const label = buildPremisesName(next.building_name, next.suite, next.floor);
      if (label) next.name = label;
    }
    onUpdate(next);
  };

  const updateRentStep = (index: number, field: keyof RentStep, value: number) => {
    if (!scenario) return;
    const steps = scenario.rent_steps.map((step, i) =>
      i === index ? { ...step, [field]: value } : step
    );
    onUpdate({ ...scenario, rent_steps: steps });
  };

  const addRentStep = () => {
    if (!scenario) return;
    const last = scenario.rent_steps[scenario.rent_steps.length - 1];
    const nextStart = last ? Math.max(0, last.end + 1) : 0;
    const nextEnd = nextStart + 11;
    const nextRate = last ? last.rate_psf_yr : 0;
    onUpdate({
      ...scenario,
      rent_steps: [...scenario.rent_steps, { start: nextStart, end: nextEnd, rate_psf_yr: nextRate }],
    });
  };

  const removeRentStep = (index: number) => {
    if (!scenario) return;
    if (scenario.rent_steps.length <= 1) return;
    onUpdate({
      ...scenario,
      rent_steps: scenario.rent_steps.filter((_, i) => i !== index),
    });
  };

  const rentStepIssues = (() => {
    if (!scenario || scenario.rent_steps.length === 0) return ["Add at least one rent step."];
    const issues: string[] = [];
    const steps = [...scenario.rent_steps].sort((a, b) => a.start - b.start);
    if (steps[0] && steps[0].start !== 0) issues.push("First step should start at month 1.");
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i];
      if (s.end < s.start) issues.push(`Step ${i + 1} ends before it starts.`);
      if (i > 0) {
        const prev = steps[i - 1];
        if (s.start <= prev.end) issues.push(`Step ${i + 1} overlaps step ${i}.`);
        if (s.start > prev.end + 1) issues.push(`Gap between step ${i} and step ${i + 1}.`);
      }
    }
    return issues;
  })();

  const inputClass = "input-premium mt-1 block";
  const btnSecondary = "btn-premium btn-premium-secondary w-full sm:w-auto";

  if (!scenario) {
    return (
      <div className="surface-card p-4 sm:p-5 md:p-6">
        <p className="heading-kicker mb-2">Scenario editor</p>
        <h2 className="heading-section mb-2">Scenario editor</h2>
        <p className="text-sm text-slate-300 mb-4">
          Select a scenario from the list or add a new one.
        </p>
        <button
          type="button"
          onClick={onAddScenario}
          className="btn-premium btn-premium-primary"
        >
          Add scenario
        </button>
      </div>
    );
  }

  return (
    <div className="surface-card p-4 sm:p-5 md:p-6">
      <div className="mb-4">
        <div>
          <p className="heading-kicker mb-1">Scenario editor</p>
          <h2 className="heading-section">Scenario editor</h2>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAcceptChanges}
          className="btn-premium btn-premium-success w-full sm:w-auto"
          title="Save edits and close the scenario editor"
        >
          Accept changes
        </button>
        <button type="button" onClick={onAddScenario} className={btnSecondary}>
          Add scenario
        </button>
        <button type="button" onClick={onDuplicateScenario} className={btnSecondary}>
          Duplicate scenario
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined" && window.confirm("Delete this scenario?")) {
              onDeleteScenario(scenario.id);
            }
          }}
          className="btn-premium btn-premium-danger w-full sm:w-auto"
        >
          Delete scenario
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-sm text-slate-300">Building name</span>
          <input type="text" value={scenario.building_name ?? ""} onChange={(e) => update("building_name", e.target.value)} className={inputClass} placeholder="e.g. Capital View Center" />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Suite</span>
          <input type="text" value={scenario.suite ?? ""} onChange={(e) => update("suite", e.target.value)} className={inputClass} placeholder="e.g. 220" />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Floor (optional)</span>
          <input type="text" value={scenario.floor ?? ""} onChange={(e) => update("floor", e.target.value)} className={inputClass} placeholder="e.g. 2" />
        </label>
        <label className="block sm:col-span-2 xl:col-span-2">
          <span className="text-sm text-slate-300">Street address (optional)</span>
          <input type="text" value={scenario.address ?? ""} onChange={(e) => update("address", e.target.value)} className={inputClass} placeholder="e.g. 123 Main St, City, State" />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">RSF</span>
          <input
            type="number"
            min={0.01}
            step={1}
            value={scenario.rsf}
            onChange={(e) => update("rsf", Number(e.target.value))}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Commencement</span>
          <input
            type="text"
            value={commencementInput}
            onChange={(e) => setCommencementInput(e.target.value)}
            onBlur={() => {
              const iso = displayToIsoDate(commencementInput);
              if (iso) update("commencement", iso);
              setCommencementInput(isoToDisplayDate(iso || scenario.commencement));
            }}
            className={inputClass}
            placeholder="dd/mm/yyyy"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Expiration</span>
          <input
            type="text"
            value={expirationInput}
            onChange={(e) => setExpirationInput(e.target.value)}
            onBlur={() => {
              const iso = displayToIsoDate(expirationInput);
              if (iso) update("expiration", iso);
              setExpirationInput(isoToDisplayDate(iso || scenario.expiration));
            }}
            className={inputClass}
            placeholder="dd/mm/yyyy"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Free rent start month</span>
          <input
            type="number"
            min={1}
            value={toDisplayMonth(scenario.free_rent_start_month ?? 0)}
            onChange={(e) => update("free_rent_start_month", toInternalMonth(Number(e.target.value)))}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Free rent (months)</span>
          <input
            type="number"
            min={0}
            value={scenario.free_rent_months}
            onChange={(e) =>
              update("free_rent_months", Number(e.target.value))
            }
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Abatement type</span>
          <select
            value={scenario.free_rent_abatement_type ?? "base"}
            onChange={(e) => update("free_rent_abatement_type", (e.target.value === "gross" ? "gross" : "base"))}
            className={inputClass}
          >
            <option value="base">Base rent abatement</option>
            <option value="gross">Gross abatement (base + OpEx + parking)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">TI allowance ($/SF)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={scenario.ti_allowance_psf}
            onChange={(e) =>
              update("ti_allowance_psf", Number(e.target.value))
            }
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Opex mode</span>
          <select
            value={scenario.opex_mode}
            onChange={(e) => update("opex_mode", e.target.value as OpexMode)}
            className={inputClass}
          >
            <option value="nnn">NNN</option>
            <option value="base_year">Base year</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Base opex ($/SF/yr)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={scenario.base_opex_psf_yr}
            onChange={(e) =>
              update("base_opex_psf_yr", Number(e.target.value))
            }
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Base year opex ($/SF/yr)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={scenario.base_year_opex_psf_yr}
            onChange={(e) =>
              update("base_year_opex_psf_yr", Number(e.target.value))
            }
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Opex growth (e.g. 0.03)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={scenario.opex_growth}
            onChange={(e) => update("opex_growth", Number(e.target.value))}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Discount rate (annual; override for this option, e.g. 0.08 = 8%)</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={scenario.discount_rate_annual}
            onChange={(e) =>
              update("discount_rate_annual", Number(e.target.value))
            }
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-300/20 bg-slate-900/36 p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-2">
          <div>
            <h3 className="text-base font-semibold text-slate-100 tracking-tight">Rent schedule</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
            <button type="button" onClick={addRentStep} className={btnSecondary}>
              Add rent step
            </button>
          </div>
        </div>
        <div className="mb-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          {scenario.free_rent_months > 0 ? (
            <>
              Free rent applies to months{" "}
              <span className="font-semibold">
                {toDisplayMonth(scenario.free_rent_start_month ?? 0)}-{toDisplayMonth((scenario.free_rent_end_month ?? Math.max(0, (scenario.free_rent_start_month ?? 0) + scenario.free_rent_months - 1)))}
              </span>{" "}
              as{" "}
              <span className="font-semibold">
                {scenario.free_rent_abatement_type === "gross" ? "gross abatement" : "base-rent-only abatement"}
              </span>.
            </>
          ) : (
            "No free rent / abatement is applied."
          )}
        </div>
        {rentStepIssues.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-medium text-amber-100 mb-1">Rent step warnings</p>
            <ul className="list-disc list-inside text-xs text-amber-100/90 space-y-0.5">
              {rentStepIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="hidden xl:grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_112px] gap-3 px-1 pb-1">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Step</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Start month</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">End month</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Dates (dd/mm/yyyy)</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Rate ($/SF/yr)</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Opex ($/SF/yr)</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">RSF</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Lease years</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Action</span>
        </div>
        {scenario.rent_steps.map((step, i) => (
          <div key={i} className="rounded-xl border border-slate-300/20 bg-slate-900/28 p-3 mb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_112px] gap-3 xl:gap-2 items-end">
              <div className="text-xs text-slate-300 min-h-10 flex items-center px-2 rounded-lg border border-slate-300/20 bg-slate-900/40 sm:col-span-2 xl:col-span-1">
                #{i + 1}
              </div>
              <label className="col-span-1">
                <span className="text-[11px] text-slate-400 mb-1 block xl:hidden">Start month</span>
                <input
                  type="number"
                  min={1}
                  value={toDisplayMonth(step.start)}
                  onChange={(e) =>
                    updateRentStep(i, "start", toInternalMonth(Number(e.target.value)))
                  }
                  className="input-premium w-full px-2 py-2"
                />
              </label>
              <label className="col-span-1">
                <span className="text-[11px] text-slate-400 mb-1 block xl:hidden">End month</span>
                <input
                  type="number"
                  min={1}
                  value={toDisplayMonth(step.end)}
                  onChange={(e) =>
                    updateRentStep(i, "end", toInternalMonth(Number(e.target.value)))
                  }
                  className="input-premium w-full px-2 py-2"
                />
              </label>
              <div className="text-xs text-slate-200 min-h-10 flex items-center px-2 rounded-lg border border-slate-300/20 bg-slate-900/40 sm:col-span-2 xl:col-span-1">
                <span className="text-[11px] text-slate-400 mb-1 block xl:hidden mr-2">Dates (dd/mm/yyyy)</span>
                {leaseStepDateLabel(step.start, step.end)}
              </div>
              <label className="col-span-1">
                <span className="text-[11px] text-slate-400 mb-1 block xl:hidden">Rate ($/SF/yr)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={step.rate_psf_yr}
                  onChange={(e) =>
                    updateRentStep(i, "rate_psf_yr", Number(e.target.value))
                  }
                  className="input-premium w-full px-2 py-2"
                />
              </label>
              <div className="text-xs text-slate-200 min-h-10 flex items-center px-2 rounded-lg border border-slate-300/20 bg-slate-900/40">
                <span className="text-[11px] text-slate-400 mb-1 block xl:hidden mr-2">Opex ($/SF/yr)</span>
                {opexRangeLabel(step.start, step.end)}
              </div>
              <div className="text-xs text-slate-200 min-h-10 flex items-center px-2 rounded-lg border border-slate-300/20 bg-slate-900/40">
                <span className="text-[11px] text-slate-400 mb-1 block xl:hidden mr-2">RSF</span>
                {stepRsfLabel(step.start, step.end)}
              </div>
              <div className="text-xs text-slate-200 min-h-10 flex items-center px-2 rounded-lg border border-slate-300/20 bg-slate-900/40">
                {leaseYearLabel(step.start, step.end)}
              </div>
              <button
                type="button"
                onClick={() => removeRentStep(i)}
                disabled={scenario.rent_steps.length <= 1}
                className="h-10 rounded-lg border border-red-500/45 text-red-200 text-xs font-medium hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed w-full"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="mt-4 rounded-lg border border-slate-300/20 bg-slate-950/35 p-3">
          <p className="text-xs font-medium text-slate-100 mb-2">Periodized schedule (output)</p>
          <p className="text-[11px] text-slate-400 mb-3">
            Auto-split by calendar year, phase-in RSF changes, and abatement boundaries. Abated periods show zero cash-flow components.
          </p>
          <div className="hidden xl:grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 px-1 pb-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Start month</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">End month</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Dates (dd/mm/yyyy)</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Base rent ($/SF/yr)</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Opex ($/SF/yr)</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">RSF</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Lease years</span>
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Note</span>
          </div>
          {periodizedRows.map((row, idx) => (
            <div key={`${row.start}-${row.end}-${idx}`} className="rounded-lg border border-slate-300/20 bg-slate-900/35 p-3 mb-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 xl:gap-2 items-center">
                <div className="text-sm text-slate-200">{toDisplayMonth(row.start)}</div>
                <div className="text-sm text-slate-200">{toDisplayMonth(row.end)}</div>
                <div className="text-sm text-slate-200">{row.dateLabel}</div>
                <div className="text-sm text-slate-200">{formatCurrencyPsf(row.baseRate)}</div>
                <div className="text-sm text-slate-200">{formatCurrencyPsf(row.opexRate)}</div>
                <div className="text-sm text-slate-300">{row.rsfLabel}</div>
                <div className="text-sm text-slate-300">{row.yearsLabel}</div>
                <div className={`text-xs ${row.abatementNote ? "text-emerald-300" : "text-slate-400"}`}>
                  {row.abatementNote || "Standard period"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { defaultScenarioInput };
