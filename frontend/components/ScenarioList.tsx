"use client";

import { useState } from "react";
import { formatRSF, formatDateISO } from "@/lib/format";
import type { ScenarioWithId } from "@/lib/types";
import { getPremisesDisplayName } from "@/lib/canonical-api";
import { hasCommencementBeforeToday } from "@/lib/remaining-obligation";

type LeaseObligationMode = "full_original_term" | "remaining_obligation";

interface ScenarioListProps {
  scenarios: ScenarioWithId[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
  onReorder?: (fromId: string, toId: string) => void;
  onToggleIncludeInSummary?: (id: string) => void;
  onChangeLeaseObligationMode?: (id: string, mode: LeaseObligationMode) => void;
  includedInSummary?: Record<string, boolean>;
}

export function ScenarioList({
  scenarios,
  selectedId,
  onSelect,
  onDuplicate,
  onDelete,
  onRename,
  onReorder,
  onToggleIncludeInSummary,
  onChangeLeaseObligationMode,
  includedInSummary = {},
}: ScenarioListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const getOpexModeLabel = (mode: ScenarioWithId["opex_mode"]): string => {
    if (mode === "base_year") return "Base Year";
    if (mode === "full_service") return "FSG";
    return "NNN";
  };
  const getScenarioName = (scenario: ScenarioWithId): string =>
    getPremisesDisplayName({
      building_name: scenario.building_name,
      suite: scenario.suite,
      floor: scenario.floor,
      scenario_name: scenario.name,
    });
  const canToggleObligationMode = (scenario: ScenarioWithId): boolean => {
    if (!scenario.original_extracted_lease) return false;
    const sourceCommencement = String(scenario.original_extracted_lease.commencement || scenario.commencement || "");
    return hasCommencementBeforeToday(sourceCommencement);
  };
  const obligationMode = (scenario: ScenarioWithId): LeaseObligationMode =>
    scenario.is_remaining_obligation ? "remaining_obligation" : "full_original_term";

  const startRename = (s: ScenarioWithId) => {
    setEditingId(s.id);
    setEditName(s.name);
  };
  const submitRename = (id: string) => {
    if (onRename && editName.trim()) onRename(id, editName.trim());
    setEditingId(null);
  };
  const actionBtnBase =
    "inline-flex items-center justify-center min-h-[34px] px-3 text-[11px] sm:text-xs font-medium border transition-colors focus:outline-none focus-ring";
  const actionBtnNeutral =
    `${actionBtnBase} text-slate-200 border-slate-300/25 bg-slate-950/45 hover:bg-slate-800/70 hover:text-white`;
  const actionBtnDanger =
    `${actionBtnBase} text-red-200 border-red-400/35 bg-slate-950/45 hover:bg-red-500/15 hover:text-red-100`;
  const nameBtnBase =
    "text-left font-medium focus:outline-none focus-ring inline-flex items-start gap-2 min-w-0 w-full transition-colors";

  if (scenarios.length === 0) {
    return (
      <div className="surface-card p-5">
        <p className="heading-kicker mb-2">Scenarios</p>
        <h2 className="heading-section mb-2">Scenario list</h2>
        <p className="text-sm text-slate-300">No scenarios yet.</p>
      </div>
    );
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-300/15 bg-slate-900/35">
        <p className="heading-kicker mb-1">Scenarios</p>
        <h2 className="heading-section">Options</h2>
        <p className="mt-1 text-xs text-slate-400">Select an option to edit and choose which ones appear in the final presentation.</p>
      </div>
      <div className="max-h-[72vh] overflow-y-auto p-3 sm:p-4">
        <div className="space-y-3">
          {scenarios.map((s, index) => {
            const scenarioName = getScenarioName(s);
            const isSelected = selectedId === s.id;
            const included = includedInSummary[s.id] !== false;
            return (
              <article
                key={s.id}
                draggable={!!onReorder}
                onDragStart={() => setDragId(s.id)}
                onDragOver={(e) => {
                  if (!onReorder || !dragId || dragId === s.id) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!onReorder || !dragId || dragId === s.id) return;
                  onReorder(dragId, s.id);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                className={`rounded-2xl border p-4 transition-all ${
                  isSelected
                    ? "border-cyan-300/70 bg-cyan-500/[0.08] shadow-[0_0_0_1px_rgba(103,232,249,0.18)]"
                    : "border-white/12 bg-slate-950/45 hover:border-white/22 hover:bg-white/[0.03]"
                } ${dragId === s.id ? "opacity-60" : ""}`}
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 text-xs leading-none ${isSelected ? "text-cyan-200" : "text-slate-500"}`} aria-hidden>
                        {onReorder ? "⋮⋮" : ""}
                      </span>
                      <div className="min-w-0 flex-1">
                        {editingId === s.id ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => submitRename(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitRename(s.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="input-premium min-h-0 py-2 px-3 text-sm"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelect(s.id)}
                            className={`${nameBtnBase} text-white`}
                            title={scenarioName}
                          >
                            <span className="block text-left text-base font-semibold leading-6 sm:text-lg">{scenarioName}</span>
                          </button>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-cyan-100">
                            Option {index + 1}
                          </span>
                          <span className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-slate-300">
                            {(s.document_type_detected || "unknown").replace(/_/g, " ")}
                          </span>
                          <span className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-slate-300">
                            {getOpexModeLabel(s.opex_mode)}
                          </span>
                          {included ? (
                            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-emerald-200">
                              In report
                            </span>
                          ) : (
                            <span className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                              Hidden from report
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">RSF</p>
                        <p className="mt-1 font-medium text-white">{formatRSF(s.rsf)}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Commencement</p>
                        <p className="mt-1 font-medium text-white">{formatDateISO(s.commencement)}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Expiration</p>
                        <p className="mt-1 font-medium text-white">{formatDateISO(s.expiration)}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Status</p>
                        <p className="mt-1 font-medium text-white">{included ? "Included" : "Hidden"}</p>
                      </div>
                    </div>

                    {onChangeLeaseObligationMode && canToggleObligationMode(s) ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Obligation mode</span>
                        <button
                          type="button"
                          onClick={() => onChangeLeaseObligationMode(s.id, "full_original_term")}
                          className={`px-3 py-1.5 text-xs border ${
                            obligationMode(s) === "full_original_term"
                              ? "border-cyan-300/65 bg-cyan-500/10 text-cyan-100"
                              : "border-white/12 bg-white/[0.03] text-slate-300"
                          }`}
                        >
                          Full term
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeLeaseObligationMode(s.id, "remaining_obligation")}
                          className={`px-3 py-1.5 text-xs border ${
                            obligationMode(s) === "remaining_obligation"
                              ? "border-cyan-300/65 bg-cyan-500/10 text-cyan-100"
                              : "border-white/12 bg-white/[0.03] text-slate-300"
                          }`}
                        >
                          Remaining only
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="xl:w-[210px] xl:min-w-[210px]">
                    {onToggleIncludeInSummary ? (
                      <label className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 text-sm text-slate-200">
                        <span>Include in report</span>
                        <input
                          type="checkbox"
                          checked={included}
                          onChange={() => onToggleIncludeInSummary(s.id)}
                          className="rounded border-white/20 bg-white/5 text-[#3b82f6] focus:ring-[#3b82f6]"
                        />
                      </label>
                    ) : null}

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {onRename && editingId !== s.id ? (
                        <button type="button" onClick={() => startRename(s)} className={actionBtnNeutral}>
                          Rename
                        </button>
                      ) : null}
                      <button type="button" onClick={() => onSelect(s.id)} className={actionBtnNeutral}>
                        {isSelected ? "Selected" : "Edit"}
                      </button>
                      <button type="button" onClick={() => onDuplicate(s.id)} className={actionBtnNeutral}>
                        Duplicate
                      </button>
                      <button type="button" onClick={() => onDelete(s.id)} className={actionBtnDanger}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
