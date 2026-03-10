"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { normalizeWorkspaceDocument } from "@/lib/workspace/ingestion";
import { CLIENT_DOCUMENT_TYPES, type ClientWorkspaceDocument } from "@/lib/workspace/types";
import { getDisplayErrorMessage } from "@/lib/api";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return asText(iso) || "-";
  return dt.toLocaleString();
}

function inDateRange(iso: string, startDate: string, endDate: string): boolean {
  if (!startDate && !endDate) return true;
  const day = asText(iso).slice(0, 10);
  if (!day) return false;
  if (startDate && day < startDate) return false;
  if (endDate && day > endDate) return false;
  return true;
}

function previewLabel(document: ClientWorkspaceDocument): string {
  if (document.previewDataUrl) return "Preview available";
  if (document.normalizeSnapshot?.canonical_lease) return "Parsed summary";
  return "Preview unavailable";
}

export function ClientDocumentCenter() {
  const { activeClient, documents, registerDocument } = useClientWorkspace();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("No documents uploaded for this client.");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [suiteFilter, setSuiteFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [previewId, setPreviewId] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPreview = useMemo(
    () => documents.find((doc) => doc.id === previewId) ?? null,
    [documents, previewId],
  );

  const filteredDocuments = useMemo(() => {
    const needle = asText(query).toLowerCase();
    const buildingNeedle = asText(buildingFilter).toLowerCase();
    const suiteNeedle = asText(suiteFilter).toLowerCase();

    return documents.filter((doc) => {
      if (typeFilter !== "all" && doc.type !== typeFilter) return false;
      if (buildingNeedle && !asText(doc.building).toLowerCase().includes(buildingNeedle)) return false;
      if (suiteNeedle && !asText(doc.suite).toLowerCase().includes(suiteNeedle)) return false;
      if (!inDateRange(doc.uploadedAt, startDate, endDate)) return false;
      if (!needle) return true;
      const haystack = `${doc.name} ${doc.type} ${doc.building} ${doc.address} ${doc.suite}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [documents, query, typeFilter, buildingFilter, suiteFilter, startDate, endDate]);

  const processFiles = useCallback(async (incoming: FileList | File[] | null | undefined) => {
    if (!activeClient) return;
    const files = Array.from(incoming ?? []);
    if (files.length === 0) return;
    setLoading(true);
    setError("");

    try {
      let processed = 0;
      for (const file of files) {
        setStatus(`Ingesting ${file.name}...`);
        let normalize = null;
        try {
          normalize = await normalizeWorkspaceDocument(file);
        } catch {
          normalize = null;
        }

        await registerDocument({
          clientId: activeClient.id,
          name: file.name,
          file,
          sourceModule: "document-center",
          normalize,
          parsed: Boolean(normalize),
        });
        processed += 1;
      }
      setStatus(`Ingested ${processed} document${processed === 1 ? "" : "s"} for ${activeClient.name}.`);
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeClient, registerDocument]);

  if (!activeClient) return null;

  return (
    <section className="scroll-mt-24 bg-grid">
      <div className="mx-auto w-full max-w-6xl border border-white/15 p-3 sm:p-4 bg-grid">
        <div className="border border-white/15 bg-black/25 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="heading-kicker mb-2">Document Center</p>
              <h2 className="heading-section mb-1">{activeClient.name} Document Library</h2>
              <p className="text-sm text-slate-300">All platform uploads route into this client-scoped library.</p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-premium btn-premium-primary"
            >
              Upload Documents
            </button>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragOver(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void processFiles(event.dataTransfer.files);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`mt-4 cursor-pointer border border-dashed px-4 py-8 text-center transition-colors ${
              dragOver ? "border-cyan-300 bg-cyan-500/10" : "border-white/20 bg-black/20"
            }`}
          >
            <p className="heading-kicker mb-2">Drag and drop upload</p>
            <p className="text-sm text-slate-200">Supports bulk files. Parseable files are automatically classified and indexed.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void processFiles(event.target.files);
              event.target.value = "";
            }}
          />

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input-premium md:col-span-3"
              placeholder="Search name, type, building, address, suite"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="input-premium"
            >
              <option value="all">All types</option>
              {CLIENT_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
              className="input-premium"
              placeholder="Building"
            />
            <input
              type="text"
              value={suiteFilter}
              onChange={(e) => setSuiteFilter(e.target.value)}
              className="input-premium"
              placeholder="Suite"
            />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-premium"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-premium"
            />
          </div>

          <p className="mt-3 text-xs text-slate-400">{loading ? "Ingesting documents..." : status}</p>
          {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4">
          <div className="lg:col-span-8 border border-white/15 bg-black/30 p-4">
            <p className="heading-kicker mb-2">Documents</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Name</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Type</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Building</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Suite</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Uploaded</th>
                    <th className="text-left py-2 text-slate-300 font-medium">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-slate-400">No documents match the current filters.</td>
                    </tr>
                  ) : (
                    filteredDocuments.map((doc) => {
                      const selected = doc.id === selectedPreview?.id;
                      return (
                        <tr
                          key={doc.id}
                          className={`border-b border-white/10 transition-colors ${selected ? "bg-cyan-500/10" : "hover:bg-white/5"}`}
                        >
                          <td className="py-2 pr-3 text-slate-100">{doc.name}</td>
                          <td className="py-2 pr-3 text-slate-300">{doc.type}</td>
                          <td className="py-2 pr-3 text-slate-300">{doc.building || "-"}</td>
                          <td className="py-2 pr-3 text-slate-300">{doc.suite || "-"}</td>
                          <td className="py-2 pr-3 text-slate-300">{formatDateTime(doc.uploadedAt)}</td>
                          <td className="py-2">
                            <button
                              type="button"
                              className="btn-premium btn-premium-secondary text-xs"
                              onClick={() => setPreviewId(doc.id)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-4 border border-white/15 bg-black/30 p-4">
            <p className="heading-kicker mb-2">Preview</p>
            {selectedPreview ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-white">{selectedPreview.name}</p>
                  <p className="text-xs text-slate-400">{previewLabel(selectedPreview)}</p>
                </div>

                {selectedPreview.previewDataUrl ? (
                  selectedPreview.previewDataUrl.startsWith("data:image/") ? (
                    <img src={selectedPreview.previewDataUrl} alt={selectedPreview.name} className="w-full border border-white/15" />
                  ) : (
                    <iframe src={selectedPreview.previewDataUrl} className="w-full h-64 border border-white/15 bg-black" title={selectedPreview.name} />
                  )
                ) : null}

                {selectedPreview.normalizeSnapshot?.canonical_lease ? (
                  <div className="border border-white/15 bg-black/20 p-3 text-xs text-slate-300 space-y-1">
                    <p><span className="text-slate-400">Tenant:</span> {asText(selectedPreview.normalizeSnapshot.canonical_lease.tenant_name) || "-"}</p>
                    <p><span className="text-slate-400">Landlord:</span> {asText(selectedPreview.normalizeSnapshot.canonical_lease.landlord_name) || "-"}</p>
                    <p><span className="text-slate-400">Building:</span> {asText(selectedPreview.normalizeSnapshot.canonical_lease.building_name) || "-"}</p>
                    <p><span className="text-slate-400">Address:</span> {asText(selectedPreview.normalizeSnapshot.canonical_lease.address) || "-"}</p>
                    <p><span className="text-slate-400">Suite:</span> {asText(selectedPreview.normalizeSnapshot.canonical_lease.suite) || "-"}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Select a document to preview.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
