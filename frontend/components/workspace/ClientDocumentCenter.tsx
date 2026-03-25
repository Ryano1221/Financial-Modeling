"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { DocumentIngestionLoader } from "@/components/workspace/DocumentIngestionLoader";
import { normalizeWorkspaceDocument } from "@/lib/workspace/ingestion";
import {
  CLIENT_DOCUMENT_TYPES,
  type ClientDocumentSourceModule,
  type ClientWorkspaceDocument,
} from "@/lib/workspace/types";
import { getDisplayErrorMessage } from "@/lib/api";
import {
  inferDocumentMimeType,
  isWordDocumentMimeType,
  isWordPreviewDataUrl,
} from "@/lib/workspace/document-preview";

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

interface ClientDocumentCenterProps {
  showDropZone?: boolean;
  sourceModule?: ClientDocumentSourceModule;
  globalDropLabel?: string;
}

export function ClientDocumentCenter({
  showDropZone = true,
  sourceModule = "document-center",
  globalDropLabel = "Drop files anywhere to save into this client and update the active workflow",
}: ClientDocumentCenterProps) {
  const { activeClient, documents, registerDocument, updateDocument, removeDocument } = useClientWorkspace();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("No documents uploaded for this client.");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [globalDragActive, setGlobalDragActive] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [suiteFilter, setSuiteFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "",
    type: "other" as (typeof CLIENT_DOCUMENT_TYPES)[number],
    building: "",
    address: "",
    suite: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const globalDragDepthRef = useRef(0);
  const isModuleScopedIntake = sourceModule !== "document-center";

  const triggerDownloadFromDataUrl = useCallback(async (fileName: string, dataUrl: string): Promise<void> => {
    const safeName = asText(fileName) || "document";
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = safeName;
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, []);

  const openDocument = useCallback(async (docId: string) => {
    const target = documents.find((doc) => doc.id === docId);
    if (!target) return;
    if (!target.previewDataUrl) {
      setError("This document was indexed, but its original file payload is not available in this browser yet. Re-upload it once and future refreshes will keep it openable here.");
      return;
    }
    const fileMimeType = inferDocumentMimeType(target.name, target.fileMimeType);
    if (isWordDocumentMimeType(fileMimeType) || isWordPreviewDataUrl(target.previewDataUrl)) {
      try {
        await triggerDownloadFromDataUrl(target.name, target.previewDataUrl);
        setError("");
        return;
      } catch {
        setError("The Word file could not be opened automatically. Try uploading it again.");
        return;
      }
    }
    const opened = window.open(target.previewDataUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      try {
        await triggerDownloadFromDataUrl(target.name, target.previewDataUrl);
        setError("Popup was blocked, so the document was downloaded instead.");
        return;
      } catch {
        setError("Browser blocked opening the document and download fallback failed. Try uploading again.");
        return;
      }
    }
    setError("");
  }, [documents, triggerDownloadFromDataUrl]);

  const startEditing = useCallback((doc: ClientWorkspaceDocument) => {
    setEditingId(doc.id);
    setEditDraft({
      name: doc.name,
      type: doc.type,
      building: doc.building,
      address: doc.address,
      suite: doc.suite,
    });
    setError("");
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEditing = useCallback(() => {
    if (!editingId) return;
    const name = asText(editDraft.name);
    if (!name) {
      setError("Document name is required.");
      return;
    }
    updateDocument(editingId, {
      name,
      type: editDraft.type,
      building: editDraft.building,
      address: editDraft.address,
      suite: editDraft.suite,
    });
    setEditingId(null);
    setError("");
    setStatus(`Updated document metadata for ${name}.`);
  }, [editDraft, editingId, updateDocument]);

  const deleteDocument = useCallback((doc: ClientWorkspaceDocument) => {
    const confirmed = window.confirm(`Delete "${doc.name}"? This cannot be undone.`);
    if (!confirmed) return;
    removeDocument(doc.id);
    if (editingId === doc.id) {
      setEditingId(null);
    }
    setError("");
    setStatus(`Deleted ${doc.name}.`);
  }, [editingId, removeDocument]);

  const renderEditFields = useCallback(() => (
    <>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        <input
          type="text"
          value={editDraft.name}
          onChange={(event) => setEditDraft((prev) => ({ ...prev, name: event.target.value }))}
          className="input-premium"
          placeholder="Document name"
        />
        <select
          value={editDraft.type}
          onChange={(event) =>
            setEditDraft((prev) => ({ ...prev, type: event.target.value as (typeof CLIENT_DOCUMENT_TYPES)[number] }))
          }
          className="input-premium"
        >
          {CLIENT_DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={editDraft.building}
          onChange={(event) => setEditDraft((prev) => ({ ...prev, building: event.target.value }))}
          className="input-premium"
          placeholder="Building"
        />
        <input
          type="text"
          value={editDraft.suite}
          onChange={(event) => setEditDraft((prev) => ({ ...prev, suite: event.target.value }))}
          className="input-premium"
          placeholder="Suite"
        />
        <input
          type="text"
          value={editDraft.address}
          onChange={(event) => setEditDraft((prev) => ({ ...prev, address: event.target.value }))}
          className="input-premium"
          placeholder="Address"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-premium btn-premium-primary text-xs" onClick={saveEditing}>
          Save
        </button>
        <button type="button" className="btn-premium btn-premium-secondary text-xs" onClick={cancelEditing}>
          Cancel
        </button>
      </div>
    </>
  ), [cancelEditing, editDraft, saveEditing]);

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
    if (loading) return;
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
          sourceModule,
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
  }, [activeClient, loading, registerDocument, sourceModule]);

  const isFileDragEvent = useCallback((event: DragEvent): boolean => {
    const dt = event.dataTransfer;
    if (!dt) return false;
    return Array.from(dt.types || []).includes("Files");
  }, []);

  useEffect(() => {
    const onWindowDragEnter = (event: DragEvent) => {
      if (loading || !isFileDragEvent(event)) return;
      event.preventDefault();
      globalDragDepthRef.current += 1;
      setGlobalDragActive(true);
    };
    const onWindowDragOver = (event: DragEvent) => {
      if (loading || !isFileDragEvent(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setGlobalDragActive(true);
    };
    const onWindowDragLeave = (event: DragEvent) => {
      if (!isFileDragEvent(event)) return;
      globalDragDepthRef.current = Math.max(0, globalDragDepthRef.current - 1);
      if (globalDragDepthRef.current === 0) setGlobalDragActive(false);
    };
    const onWindowDrop = (event: DragEvent) => {
      if (!isFileDragEvent(event)) return;
      event.preventDefault();
      globalDragDepthRef.current = 0;
      setGlobalDragActive(false);
      void processFiles(event.dataTransfer?.files);
    };
    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [isFileDragEvent, loading, processFiles]);

  if (!activeClient) return null;

  return (
    <section className="scroll-mt-24 bg-grid">
      {globalDragActive ? (
        <div className="pointer-events-none fixed inset-0 z-[70] border-2 border-dashed border-cyan-300/70 bg-cyan-500/10 backdrop-blur-[1px]">
          <div className="absolute inset-x-4 top-16 rounded-xl border border-cyan-200/70 bg-slate-900/90 px-4 py-3 text-center text-sm font-semibold tracking-tight text-cyan-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
            {globalDropLabel}
          </div>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-[96vw] border border-white/15 p-3 sm:p-4 bg-grid">
        <div className="border border-white/15 bg-black/25 p-4 sm:p-5">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="mx-auto max-w-3xl">
              <p className="heading-kicker mb-2">Document Center</p>
              <h2 className="heading-section mb-1">{activeClient.name} Document Library</h2>
              <p className="text-sm text-slate-300">All platform uploads route into this client-scoped library.</p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
              className="btn-premium btn-premium-primary disabled:opacity-60"
            >
              {loading ? "Indexing Documents..." : "Upload Documents"}
            </button>
          </div>

          {showDropZone ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (loading) return;
                fileInputRef.current?.click();
              }}
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
                  if (loading) return;
                  fileInputRef.current?.click();
                }
              }}
              className={`mt-4 cursor-pointer border border-dashed px-4 py-8 text-center transition-colors ${
                loading
                  ? "border-cyan-300/60 bg-cyan-500/10"
                  : dragOver || globalDragActive
                    ? "border-cyan-300 bg-cyan-500/10"
                    : "border-white/20 bg-black/20"
              }`}
            >
              {loading ? (
                <DocumentIngestionLoader
                  status={status}
                  detail={
                    isModuleScopedIntake
                      ? "We are classifying each file, building previews, saving everything to this client, and updating the active workspace flow."
                      : "We are classifying each file, building previews, and attaching everything to this client's shared document library."
                  }
                />
              ) : (
                <>
                  <p className="heading-kicker mb-2">Drag and drop upload</p>
                  <p className="text-sm text-slate-200">
                    {isModuleScopedIntake
                      ? "Supports bulk files. You can also drop files anywhere on this tab. Parseable files are automatically classified, saved to this client, and routed into the active workflow."
                      : "Supports bulk files. You can also drop files anywhere on this screen. Parseable files are automatically classified and indexed."}
                  </p>
                </>
              )}
            </div>
          ) : null}
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

        <div className="mt-4 border border-white/15 bg-black/30 p-4">
            <p className="heading-kicker mb-2">Documents</p>
            <div className="space-y-3 md:hidden">
              {filteredDocuments.length === 0 ? (
                <p className="py-4 text-sm text-slate-400">No documents match the current filters.</p>
              ) : (
                filteredDocuments.map((doc) => {
                  const isEditing = editingId === doc.id;
                  return (
                    <div key={doc.id} className="border border-white/15 bg-black/20 p-3 space-y-2">
                      <p className="text-sm text-slate-100 break-words">{doc.name}</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <p className="text-slate-400">Type: <span className="text-slate-200">{doc.type}</span></p>
                        <p className="text-slate-400">Suite: <span className="text-slate-200">{doc.suite || "-"}</span></p>
                        <p className="text-slate-400 col-span-2">Building: <span className="text-slate-200">{doc.building || "-"}</span></p>
                        <p className="text-slate-400 col-span-2">Uploaded: <span className="text-slate-200">{formatDateTime(doc.uploadedAt)}</span></p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-premium btn-premium-secondary text-xs"
                          onClick={() => {
                            void openDocument(doc.id);
                          }}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="btn-premium btn-premium-secondary text-xs"
                          onClick={() => startEditing(doc)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-premium btn-premium-danger text-xs"
                          onClick={() => deleteDocument(doc)}
                        >
                          Delete
                        </button>
                      </div>
                      {isEditing ? (
                        <div className="border-t border-white/10 pt-3">
                          {renderEditFields()}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="w-[32%] text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Name</th>
                    <th className="w-[10%] text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Type</th>
                    <th className="hidden md:table-cell w-[23%] text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Building</th>
                    <th className="hidden sm:table-cell w-[10%] text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Suite</th>
                    <th className="w-[13%] text-left py-2 pr-2 sm:pr-3 text-slate-300 font-medium">Uploaded</th>
                    <th className="sticky right-0 z-10 border-l border-white/10 bg-black/90 w-[276px] text-left py-2 pl-2 pr-2 sm:pr-3 text-slate-300 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-slate-400">No documents match the current filters.</td>
                    </tr>
                  ) : (
                    filteredDocuments.map((doc) => {
                      const isEditing = editingId === doc.id;
                      return (
                        <Fragment key={doc.id}>
                          <tr className="border-b border-white/10 transition-colors hover:bg-white/5">
                            <td className="py-3 pr-2 sm:pr-3 text-slate-100 align-top truncate" title={doc.name}>{doc.name}</td>
                            <td className="py-3 pr-2 sm:pr-3 text-slate-300 align-top truncate" title={doc.type}>{doc.type}</td>
                            <td className="hidden md:table-cell py-3 pr-2 sm:pr-3 text-slate-300 align-top truncate" title={doc.building || "-"}>{doc.building || "-"}</td>
                            <td className="hidden sm:table-cell py-3 pr-2 sm:pr-3 text-slate-300 align-top truncate" title={doc.suite || "-"}>{doc.suite || "-"}</td>
                            <td className="py-3 pr-2 sm:pr-3 text-slate-300 break-words align-top">{formatDateTime(doc.uploadedAt)}</td>
                            <td className="sticky right-0 border-l border-white/10 bg-black/90 py-3 pl-2 pr-2 sm:pr-3 text-slate-300 align-top whitespace-nowrap">
                              <div className="flex flex-nowrap items-center gap-2">
                                <button
                                  type="button"
                                  className="btn-premium btn-premium-secondary !h-8 !min-h-8 !w-20 !px-0 !py-0 text-[11px] inline-flex items-center justify-center shrink-0"
                                  onClick={() => {
                                    void openDocument(doc.id);
                                  }}
                                >
                                  Open
                                </button>
                                <button
                                  type="button"
                                  className="btn-premium btn-premium-secondary !h-8 !min-h-8 !w-20 !px-0 !py-0 text-[11px] inline-flex items-center justify-center shrink-0"
                                  onClick={() => startEditing(doc)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn-premium btn-premium-danger !h-8 !min-h-8 !w-20 !px-0 !py-0 text-[11px] inline-flex items-center justify-center shrink-0"
                                  onClick={() => deleteDocument(doc)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isEditing ? (
                            <tr className="border-b border-white/10 bg-black/20">
                              <td colSpan={6} className="py-3 pr-2 sm:pr-3">
                                {renderEditFields()}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
        </div>
      </div>
    </section>
  );
}
