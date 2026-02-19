"use client";

import { useState } from "react";
import { formatRSF, formatDateISO } from "@/lib/format";
import type { ScenarioWithId } from "@/lib/types";

interface ScenarioListProps {
  scenarios: ScenarioWithId[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
  onMove?: (id: string, direction: "up" | "down") => void;
  onToggleIncludeInSummary?: (id: string) => void;
  onLockBaseline?: (id: string) => void;
  baselineId?: string | null;
  includedInSummary?: Record<string, boolean>;
}

export function ScenarioList({
  scenarios,
  selectedId,
  onSelect,
  onDuplicate,
  onDelete,
  onRename,
  onMove,
  onToggleIncludeInSummary,
  onLockBaseline,
  baselineId = null,
  includedInSummary = {},
}: ScenarioListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const startRename = (s: ScenarioWithId) => {
    setEditingId(s.id);
    setEditName(s.name);
  };
  const submitRename = (id: string) => {
    if (onRename && editName.trim()) onRename(id, editName.trim());
    setEditingId(null);
  };

  if (scenarios.length === 0) {
    return (
      <div className="surface-card p-5">
        <p className="heading-kicker mb-2">Scenarios</p>
        <h2 className="heading-section mb-2">Scenarios</h2>
        <p className="text-sm text-slate-300">No scenarios yet. Add one to get started.</p>
      </div>
    );
  }

  return (
    <div className="table-shell">
      <div className="px-5 py-4 border-b border-slate-300/20 bg-slate-900/45">
        <p className="heading-kicker mb-1">Scenarios</p>
        <h2 className="heading-section mb-2">Scenario manager</h2>
        <p className="text-xs text-slate-400">Rename, reorder, include in summary, or set baseline. State is saved locally.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs sm:text-sm">
          <thead>
            <tr className="bg-slate-900/35 border-b border-slate-300/20">
              <th className="text-left py-2.5 px-4 font-medium text-slate-300">Name</th>
              <th className="text-left py-2.5 px-4 font-medium text-slate-300">Doc type</th>
              <th className="text-right py-2.5 px-4 font-medium text-slate-300">RSF</th>
              <th className="text-left py-2.5 px-4 font-medium text-slate-300">Commencement</th>
              <th className="text-left py-2.5 px-4 font-medium text-slate-300">Expiration</th>
              <th className="text-left py-2.5 px-4 font-medium text-slate-300">Opex mode</th>
              <th className="text-left py-2.5 px-4 font-medium text-slate-300">Summary</th>
              <th className="text-right py-2.5 px-4 font-medium text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s, index) => (
              <tr
                key={s.id}
                className={`border-b border-slate-300/10 hover:bg-slate-400/10 ${
                  selectedId === s.id ? "bg-[#3b82f6]/14" : ""
                } ${baselineId === s.id ? "ring-l-2 ring-[#3b82f6]" : ""}`}
              >
                <td className="py-2.5 px-4">
                  {editingId === s.id ? (
                    <span className="inline-flex gap-2 items-center">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => submitRename(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(s.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="input-premium w-40 min-h-0 py-1.5 px-2 text-sm"
                        autoFocus
                      />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className="text-left font-medium text-slate-100 hover:underline focus:outline-none focus-ring rounded inline-flex items-center gap-1 max-w-[20rem] min-w-0"
                      title={s.name}
                    >
                      <span className="truncate">{s.name}</span>
                      {baselineId === s.id && (
                        <span className="text-[10px] uppercase text-slate-400 font-normal">(baseline)</span>
                      )}
                    </button>
                  )}
                </td>
                <td className="py-2.5 px-4 text-slate-300 capitalize">
                  {(s.document_type_detected || "unknown").replace(/_/g, " ")}
                </td>
                <td className="py-2.5 px-4 text-right text-slate-300">{formatRSF(s.rsf)}</td>
                <td className="py-2.5 px-4 text-slate-300">{formatDateISO(s.commencement)}</td>
                <td className="py-2.5 px-4 text-slate-300">{formatDateISO(s.expiration)}</td>
                <td className="py-2.5 px-4 text-slate-300 capitalize">
                  {s.opex_mode === "base_year" ? "Base year" : "NNN"}
                </td>
                <td className="py-2.5 px-4">
                  {onToggleIncludeInSummary && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includedInSummary[s.id] !== false}
                        onChange={() => onToggleIncludeInSummary(s.id)}
                        className="rounded border-white/20 bg-white/5 text-[#3b82f6] focus:ring-[#3b82f6]"
                      />
                      <span className="text-slate-300 text-xs">Include</span>
                    </label>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <span className="inline-flex flex-wrap gap-1.5 items-center justify-end">
                    {onRename && editingId !== s.id && (
                      <button
                        type="button"
                        onClick={() => startRename(s)}
                        className="text-slate-300 hover:text-slate-100 text-xs font-medium focus:outline-none focus-ring rounded"
                      >
                        Rename
                      </button>
                    )}
                    {onMove && (
                      <>
                        <button
                          type="button"
                          onClick={() => onMove(s.id, "up")}
                          disabled={index === 0}
                          className="text-slate-300 hover:text-slate-100 text-xs font-medium disabled:opacity-40 focus:outline-none focus-ring rounded"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => onMove(s.id, "down")}
                          disabled={index === scenarios.length - 1}
                          className="text-slate-300 hover:text-slate-100 text-xs font-medium disabled:opacity-40 focus:outline-none focus-ring rounded"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                      </>
                    )}
                    {onLockBaseline && (
                      <button
                        type="button"
                        onClick={() => onLockBaseline(s.id)}
                        className={`text-xs font-medium focus:outline-none focus-ring rounded ${
                          baselineId === s.id ? "text-[#3b82f6]" : "text-slate-300 hover:text-slate-100"
                        }`}
                        title={baselineId === s.id ? "Unlock baseline" : "Lock as baseline"}
                      >
                        {baselineId === s.id ? "✓ Baseline" : "Baseline"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className="text-slate-300 hover:text-slate-100 text-xs font-medium focus:outline-none focus-ring rounded"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(s.id)}
                      className="text-slate-300 hover:text-slate-100 text-xs font-medium focus:outline-none focus-ring rounded"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s.id)}
                      className="text-red-300 hover:text-red-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
                    >
                      Delete
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
