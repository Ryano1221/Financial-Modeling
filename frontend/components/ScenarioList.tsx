"use client";

import type { ScenarioWithId } from "@/lib/types";

interface ScenarioListProps {
  scenarios: ScenarioWithId[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ScenarioList({
  scenarios,
  selectedId,
  onSelect,
  onDuplicate,
  onDelete,
}: ScenarioListProps) {
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
        <h2 className="text-lg font-semibold text-white">Scenarios</h2>
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
              <th className="text-right py-2.5 px-4 font-medium text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-white/5 hover:bg-white/[0.04] ${
                  selectedId === s.id ? "bg-[#3b82f6]/10" : ""
                }`}
              >
                <td className="py-2.5 px-4">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className="text-left font-medium text-white hover:underline focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-1 rounded"
                  >
                    {s.name}
                  </button>
                </td>
                <td className="py-2.5 px-4 text-right text-zinc-400">
                  {s.rsf.toLocaleString()}
                </td>
                <td className="py-2.5 px-4 text-zinc-400">{s.commencement}</td>
                <td className="py-2.5 px-4 text-zinc-400">{s.expiration}</td>
                <td className="py-2.5 px-4 text-zinc-400 capitalize">
                  {s.opex_mode === "base_year" ? "Base year" : "NNN"}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <span className="inline-flex gap-2">
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
