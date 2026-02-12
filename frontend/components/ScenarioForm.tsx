"use client";

import type { ScenarioWithId, ScenarioInput, RentStep, OpexMode } from "@/lib/types";

interface ScenarioFormProps {
  scenario: ScenarioWithId | null;
  onUpdate: (s: ScenarioWithId) => void;
  onAddScenario: () => void;
  onDuplicateScenario: () => void;
}

const defaultScenarioInput: ScenarioInput = {
  name: "New scenario",
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
  discount_rate_annual: 0.06,
};

export function ScenarioForm({
  scenario,
  onUpdate,
  onAddScenario,
  onDuplicateScenario,
}: ScenarioFormProps) {
  const update = <K extends keyof ScenarioInput>(
    key: K,
    value: ScenarioInput[K]
  ) => {
    if (!scenario) return;
    onUpdate({ ...scenario, [key]: value });
  };

  const updateRentStep = (index: number, field: keyof RentStep, value: number) => {
    if (!scenario) return;
    const steps = scenario.rent_steps.map((step, i) =>
      i === index ? { ...step, [field]: value } : step
    );
    onUpdate({ ...scenario, rent_steps: steps });
  };

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
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-1">Scenario editor</p>
          <h2 className="text-lg font-semibold text-white">Scenario editor</h2>
        </div>
        <span className="inline-flex gap-2">
          <button type="button" onClick={onAddScenario} className={btnSecondary}>
            Add scenario
          </button>
          <button type="button" onClick={onDuplicateScenario} className={btnSecondary}>
            Duplicate scenario
          </button>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-sm text-zinc-400">Name</span>
          <input type="text" value={scenario.name} onChange={(e) => update("name", e.target.value)} className={inputClass} />
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
          <span className="text-sm text-zinc-400">Discount rate (annual)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={scenario.discount_rate_annual}
            onChange={(e) =>
              update("discount_rate_annual", Number(e.target.value))
            }
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-4">
        <span className="text-sm text-zinc-400 block mb-2">
          Rent steps (start month, end month, rate $/SF/yr)
        </span>
        {scenario.rent_steps.map((step, i) => (
          <div key={i} className="flex flex-wrap gap-3 items-end mb-2">
            <label>
              <span className="sr-only">Start month</span>
              <input
                type="number"
                min={0}
                value={step.start}
                onChange={(e) =>
                  updateRentStep(i, "start", Number(e.target.value))
                }
                className="w-24 rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white focus:ring-1 focus:ring-[#3b82f6] focus:outline-none"
              />
            </label>
            <label>
              <span className="sr-only">End month</span>
              <input
                type="number"
                min={0}
                value={step.end}
                onChange={(e) =>
                  updateRentStep(i, "end", Number(e.target.value))
                }
                className="w-24 rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white focus:ring-1 focus:ring-[#3b82f6] focus:outline-none"
              />
            </label>
            <label>
              <span className="sr-only">Rate $/SF/yr</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={step.rate_psf_yr}
                onChange={(e) =>
                  updateRentStep(i, "rate_psf_yr", Number(e.target.value))
                }
                className="w-28 rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white focus:ring-1 focus:ring-[#3b82f6] focus:outline-none"
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

export { defaultScenarioInput };
