"use client";

import { useState } from "react";
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
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Scenarios</p>
        <h2 className="text-lg font-semibold text-white mb-2">Scenarios</h2>
        <p className="text-sm text-zinc-400">No scenarios yet. Add one to get started.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10">
        <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-1">Scenarios</p>
        <h2 className="text-lg font-semibold text-white mb-2">Scenario manager</h2>
        <p className="text-xs text-zinc-500">Rename, reorder, include in summary, or set baseline. State is saved locally.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.04] border-b border-white/10">
              <th className="text-left py-2.5 px-4 font-medium text-zinc-400">Name</th>
              <th className="text-right py-2.5 px-4 font-medium text-zinc-400">RSF</th>
              <th className="text-left py-2.5 px-4 font-medium text-zinc-400">Commencement</th>
              <th className="text-left py-2.5 px-4 font-medium text-zinc-400">Expiration</th>
              <th className="text-left py-2.5 px-4 font-medium text-zinc-400">Opex mode</th>
              <th className="text-left py-2.5 px-4 font-medium text-zinc-400">Summary</th>
              <th className="text-right py-2.5 px-4 font-medium text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s, index) => (
              <tr
                key={s.id}
                className={`border-b border-white/5 hover:bg-white/[0.04] ${
                  selectedId === s.id ? "bg-[#3b82f6]/10" : ""
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
                        className="rounded border border-white/20 bg-white/5 text-white px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                        autoFocus
                      />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className="text-left font-medium text-white hover:underline focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-1 rounded inline-flex items-center gap-1"
                    >
                      {s.name}
                      {baselineId === s.id && (
                        <span className="text-[10px] uppercase text-zinc-500 font-normal">(baseline)</span>
                      )}
                    </button>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right text-zinc-400">{s.rsf.toLocaleString()}</td>
                <td className="py-2.5 px-4 text-zinc-400">{s.commencement}</td>
                <td className="py-2.5 px-4 text-zinc-400">{s.expiration}</td>
                <td className="py-2.5 px-4 text-zinc-400 capitalize">
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
                      <span className="text-zinc-400 text-xs">Include</span>
                    </label>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <span className="inline-flex flex-wrap gap-1.5 items-center justify-end">
                    {onRename && editingId !== s.id && (
                      <button
                        type="button"
                        onClick={() => startRename(s)}
                        className="text-zinc-400 hover:text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#3b82f6] rounded"
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
                          className="text-zinc-400 hover:text-white text-xs font-medium disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] rounded"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => onMove(s.id, "down")}
                          disabled={index === scenarios.length - 1}
                          className="text-zinc-400 hover:text-white text-xs font-medium disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] rounded"
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
                        className={`text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#3b82f6] rounded ${
                          baselineId === s.id ? "text-[#3b82f6]" : "text-zinc-400 hover:text-white"
                        }`}
                        title={baselineId === s.id ? "Unlock baseline" : "Lock as baseline"}
                      >
                        {baselineId === s.id ? "✓ Baseline" : "Baseline"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className="text-zinc-400 hover:text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#3b82f6] rounded"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(s.id)}
                      className="text-zinc-400 hover:text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#3b82f6] rounded"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s.id)}
                      className="text-red-400 hover:text-red-300 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
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
