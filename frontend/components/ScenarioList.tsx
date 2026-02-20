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
  onReorder?: (fromId: string, toId: string) => void;
  onToggleIncludeInSummary?: (id: string) => void;
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
  includedInSummary = {},
}: ScenarioListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

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
        <p className="text-xs text-slate-400">Rename, drag to reorder, include in summary. Information is stored securely.</p>
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
            {scenarios.map((s) => (
              <tr
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
                className={`border-b border-slate-300/10 hover:bg-slate-400/10 ${
                  selectedId === s.id ? "bg-[#3b82f6]/14" : ""
                } ${dragId === s.id ? "opacity-60" : ""}`}
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
                      <span className="text-slate-500 cursor-grab" aria-hidden>{onReorder ? "⋮⋮" : ""}</span>
                      <span className="truncate">{s.name}</span>
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
