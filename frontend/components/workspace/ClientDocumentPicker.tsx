"use client";

import { useMemo, useState } from "react";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import type { ClientDocumentType, ClientWorkspaceDocument } from "@/lib/workspace/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function formatDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return asText(iso) || "-";
  return dt.toLocaleDateString();
}

interface ClientDocumentPickerProps {
  buttonLabel?: string;
  allowedTypes?: readonly ClientDocumentType[];
  onSelectDocument: (doc: ClientWorkspaceDocument) => void;
}

export function ClientDocumentPicker({
  buttonLabel = "Select Existing Document",
  allowedTypes,
  onSelectDocument,
}: ClientDocumentPickerProps) {
  const { documents, activeClient } = useClientWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState("");

  const filtered = useMemo(() => {
    const allowed = Array.isArray(allowedTypes) && allowedTypes.length > 0
      ? new Set(allowedTypes)
      : null;
    const needle = asText(query).toLowerCase();

    return documents.filter((doc) => {
      if (allowed && !allowed.has(doc.type)) return false;
      if (!needle) return true;
      const haystack = `${doc.name} ${doc.type} ${doc.building} ${doc.address} ${doc.suite}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [documents, query, allowedTypes]);

  const preview = useMemo(
    () => filtered.find((doc) => doc.id === previewId) ?? null,
    [filtered, previewId],
  );

  if (!activeClient) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="btn-premium btn-premium-secondary"
      >
        {buttonLabel}
      </button>

      {open ? (
        <div className="mt-3 border border-white/20 bg-black/40 p-3 space-y-3">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input-premium"
            placeholder="Search documents"
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-8 overflow-x-auto border border-white/15 bg-black/30 p-2">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Name</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Type</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Building</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Uploaded</th>
                    <th className="text-left py-2 text-slate-300 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-5 text-slate-400">No client documents found for current filters.</td>
                    </tr>
                  ) : (
                    filtered.map((doc) => (
                      <tr key={doc.id} className="border-b border-white/10 hover:bg-white/5">
                        <td className="py-2 pr-3 text-slate-100">{doc.name}</td>
                        <td className="py-2 pr-3 text-slate-300">{doc.type}</td>
                        <td className="py-2 pr-3 text-slate-300">{doc.building || "-"}</td>
                        <td className="py-2 pr-3 text-slate-300">{formatDate(doc.uploadedAt)}</td>
                        <td className="py-2 flex gap-2">
                          <button
                            type="button"
                            className="btn-premium btn-premium-secondary text-xs"
                            onClick={() => setPreviewId(doc.id)}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            className="btn-premium btn-premium-primary text-xs"
                            onClick={() => {
                              onSelectDocument(doc);
                              setOpen(false);
                            }}
                          >
                            Use
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-4 border border-white/15 bg-black/30 p-3">
              <p className="heading-kicker mb-2">Preview</p>
              {preview ? (
                <div className="space-y-2">
                  <p className="text-sm text-white">{preview.name}</p>
                  <p className="text-xs text-slate-400">{preview.type}</p>
                  <p className="text-xs text-slate-300">{preview.address || preview.building || "-"}</p>
                  <p className="text-xs text-slate-300">Suite: {preview.suite || "-"}</p>
                  {preview.previewDataUrl ? (
                    preview.previewDataUrl.startsWith("data:image/") ? (
                      <img src={preview.previewDataUrl} alt={preview.name} className="w-full border border-white/15" />
                    ) : (
                      <iframe src={preview.previewDataUrl} className="w-full h-52 border border-white/15" title={preview.name} />
                    )
                  ) : (
                    <p className="text-xs text-slate-500">No binary preview available. Parsed metadata can still be used.</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Select a document row to preview it.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
