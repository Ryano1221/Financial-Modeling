"use client";

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
  const update = <K extends keyof ScenarioInput>(
    key: K,
    value: ScenarioInput[K]
  ) => {
    if (!scenario) return;
    const next = { ...scenario, [key]: value };
    if (key === "building_name" || key === "suite") {
      const label = buildPremisesName(next.building_name, next.suite);
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

  const autoFixRentSteps = () => {
    if (!scenario) return;
    const sorted = [...scenario.rent_steps]
      .map((s) => ({
        start: Math.max(0, Math.floor(Number(s.start) || 0)),
        end: Math.max(0, Math.floor(Number(s.end) || 0)),
        rate_psf_yr: Math.max(0, Number(s.rate_psf_yr) || 0),
      }))
      .sort((a, b) => (a.start - b.start) || (a.end - b.end));

    const normalized: RentStep[] = [];
    sorted.forEach((step, idx) => {
      const prev = normalized[normalized.length - 1];
      let start = step.start;
      if (idx === 0 && start !== 0) start = 0;
      if (prev) start = Math.max(start, prev.end + 1);
      const end = Math.max(start, step.end);
      const rate = step.rate_psf_yr;

      if (prev && start === prev.end + 1 && Math.abs(prev.rate_psf_yr - rate) < 0.005) {
        prev.end = end;
      } else {
        normalized.push({ start, end, rate_psf_yr: rate });
      }
    });

    onUpdate({ ...scenario, rent_steps: normalized.length > 0 ? normalized : [{ start: 0, end: 11, rate_psf_yr: 0 }] });
  };

  const rentStepIssues = (() => {
    if (!scenario || scenario.rent_steps.length === 0) return ["Add at least one rent step."];
    const issues: string[] = [];
    const steps = [...scenario.rent_steps].sort((a, b) => a.start - b.start);
    if (steps[0] && steps[0].start !== 0) issues.push("First step should start at month 0.");
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

  const inputClass = "mt-1 block w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] placeholder:text-zinc-500";
  const btnSecondary = "rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b]";

  if (!scenario) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Scenario editor</p>
        <h2 className="text-lg font-semibold text-white mb-2">Scenario editor</h2>
        <p className="text-sm text-zinc-400 mb-4">
          Select a scenario from the list or add a new one.
        </p>
        <button
          type="button"
          onClick={onAddScenario}
          className="rounded-full bg-[#3b82f6] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b]"
        >
          Add scenario
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-1">Scenario editor</p>
          <h2 className="text-lg font-semibold text-white">Scenario editor</h2>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAcceptChanges}
          className="rounded-full bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
          className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Delete scenario
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-sm text-zinc-400">Building name</span>
          <input type="text" value={scenario.building_name ?? ""} onChange={(e) => update("building_name", e.target.value)} className={inputClass} placeholder="e.g. Capital View Center" />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Suite</span>
          <input type="text" value={scenario.suite ?? ""} onChange={(e) => update("suite", e.target.value)} className={inputClass} placeholder="e.g. 220" />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Floor (optional)</span>
          <input type="text" value={scenario.floor ?? ""} onChange={(e) => update("floor", e.target.value)} className={inputClass} placeholder="e.g. 2" />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm text-zinc-400">Street address (optional)</span>
          <input type="text" value={scenario.address ?? ""} onChange={(e) => update("address", e.target.value)} className={inputClass} placeholder="e.g. 123 Main St, City, State" />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">RSF</span>
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
          <span className="text-sm text-zinc-400">Commencement</span>
          <input
            type="date"
            value={scenario.commencement}
            onChange={(e) => update("commencement", e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Expiration</span>
          <input
            type="date"
            value={scenario.expiration}
            onChange={(e) => update("expiration", e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Free rent (months)</span>
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
          <span className="text-sm text-zinc-400">TI allowance ($/SF)</span>
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
          <span className="text-sm text-zinc-400">Opex mode</span>
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
          <span className="text-sm text-zinc-400">Base opex ($/SF/yr)</span>
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
          <span className="text-sm text-zinc-400">Base year opex ($/SF/yr)</span>
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
          <span className="text-sm text-zinc-400">Opex growth (e.g. 0.03)</span>
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
          <span className="text-sm text-zinc-400">Discount rate (annual; override for this option, e.g. 0.08 = 8%)</span>
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

      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Rent schedule</h3>
            <p className="text-xs text-zinc-400 mt-1">
              Month `0` is lease start. Steps must be continuous with no overlap. Example: `0-11`, `12-23`, `24-35`.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={autoFixRentSteps} className={btnSecondary}>
              Auto-fix steps
            </button>
            <button type="button" onClick={addRentStep} className={btnSecondary}>
              Add rent step
            </button>
          </div>
        </div>
        {rentStepIssues.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-medium text-amber-200 mb-1">Rent step warnings</p>
            <ul className="list-disc list-inside text-xs text-amber-100/90 space-y-0.5">
              {rentStepIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="hidden md:grid grid-cols-[64px_1fr_1fr_1fr_120px_80px] gap-3 px-1 pb-1">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Step</span>
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Start month</span>
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">End month</span>
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Rate ($/SF/yr)</span>
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Lease years</span>
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Action</span>
        </div>
        {scenario.rent_steps.map((step, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-[64px_1fr_1fr_1fr_120px_80px] gap-3 items-end mb-3">
            <div className="text-xs text-zinc-400 h-9 flex items-center px-2 rounded-lg border border-white/10 bg-white/[0.02]">
              #{i + 1}
            </div>
            <label>
              <span className="text-xs text-zinc-500 mb-1 block">Start month</span>
              <input
                type="number"
                min={0}
                value={step.start}
                onChange={(e) =>
                  updateRentStep(i, "start", Number(e.target.value))
                }
                className="w-full rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white focus:ring-1 focus:ring-[#3b82f6] focus:outline-none"
              />
            </label>
            <label>
              <span className="text-xs text-zinc-500 mb-1 block">End month</span>
              <input
                type="number"
                min={0}
                value={step.end}
                onChange={(e) =>
                  updateRentStep(i, "end", Number(e.target.value))
                }
                className="w-full rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white focus:ring-1 focus:ring-[#3b82f6] focus:outline-none"
              />
            </label>
            <label>
              <span className="text-xs text-zinc-500 mb-1 block">Rate ($/SF/yr)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={step.rate_psf_yr}
                onChange={(e) =>
                  updateRentStep(i, "rate_psf_yr", Number(e.target.value))
                }
                className="w-full rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white focus:ring-1 focus:ring-[#3b82f6] focus:outline-none"
              />
            </label>
            <div className="text-xs text-zinc-300 h-9 flex items-center px-2 rounded-lg border border-white/10 bg-white/[0.02]">
              Y{Math.floor(step.start / 12) + 1} - Y{Math.floor(step.end / 12) + 1}
            </div>
            <button
              type="button"
              onClick={() => removeRentStep(i)}
              disabled={scenario.rent_steps.length <= 1}
              className="h-9 rounded-lg border border-red-500/40 text-red-300 text-xs font-medium hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { defaultScenarioInput };
