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
  buttonAlign?: "left" | "center" | "right";
  onSelectDocument: (doc: ClientWorkspaceDocument) => void;
}

export function ClientDocumentPicker({
  buttonLabel = "Select Existing Document",
  allowedTypes,
  buttonAlign = "left",
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

  const buttonAlignClass =
    buttonAlign === "center"
      ? "justify-center"
      : buttonAlign === "right"
        ? "justify-end"
        : "justify-start";

  return (
    <div>
      <div className={`flex ${buttonAlignClass}`}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="btn-premium btn-premium-secondary"
        >
          {buttonLabel}
        </button>
      </div>

      {open ? (
        <div className="mt-3 border border-white/20 bg-black/40 p-3 space-y-3">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input-premium"
            placeholder="Search documents"
          />

          <div className="space-y-2 md:hidden">
            {filtered.length === 0 ? (
              <div className="border border-white/15 bg-black/30 p-3 text-xs text-slate-400">
                No client documents found for current filters.
              </div>
            ) : (
              filtered.map((doc) => (
                <div key={doc.id} className="border border-white/15 bg-black/30 p-3 space-y-2">
                  <p className="text-sm text-slate-100 break-words">{doc.name}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <p className="text-slate-400">Type: <span className="text-slate-200">{doc.type}</span></p>
                    <p className="text-slate-400">Uploaded: <span className="text-slate-200">{formatDate(doc.uploadedAt)}</span></p>
                    <p className="col-span-2 text-slate-400">Building: <span className="text-slate-200">{doc.building || "-"}</span></p>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-x-auto border border-white/15 bg-black/30 p-2">
            <table className="w-full border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Name</th>
                  <th className="text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Type</th>
                  <th className="hidden md:table-cell text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Building</th>
                  <th className="hidden sm:table-cell text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Uploaded</th>
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
                      <td className="py-2 pr-2 sm:pr-3 text-slate-100 break-words">{doc.name}</td>
                      <td className="py-2 pr-2 sm:pr-3 text-slate-300 break-words">{doc.type}</td>
                      <td className="hidden md:table-cell py-2 pr-2 sm:pr-3 text-slate-300 break-words">{doc.building || "-"}</td>
                      <td className="hidden sm:table-cell py-2 pr-2 sm:pr-3 text-slate-300">{formatDate(doc.uploadedAt)}</td>
                      <td className="py-2 pr-1">
                        <div className="flex flex-wrap gap-2">
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
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {preview ? (
            <div className="border border-white/15 bg-black/30 p-3">
              <p className="heading-kicker mb-2">Preview</p>
              <div className="space-y-2">
                <p className="text-sm text-white">{preview.name}</p>
                <p className="text-xs text-slate-400">{preview.type}</p>
                <p className="text-xs text-slate-300">{preview.address || preview.building || "-"}</p>
                <p className="text-xs text-slate-300">Suite: {preview.suite || "-"}</p>
                {preview.previewDataUrl ? (
                  preview.previewDataUrl.startsWith("data:image/") ? (
                    <img src={preview.previewDataUrl} alt={preview.name} className="w-full border border-white/15 max-h-[360px] object-contain" />
                  ) : (
                    <iframe src={preview.previewDataUrl} className="w-full h-64 border border-white/15" title={preview.name} />
                  )
                ) : (
                  <p className="text-xs text-slate-500">No binary preview available. Parsed metadata can still be used.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
