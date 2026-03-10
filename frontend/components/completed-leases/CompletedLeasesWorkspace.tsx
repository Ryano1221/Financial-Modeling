"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlatformPanel, PlatformSection } from "@/components/platform/PlatformShell";
import { fetchApi, getDisplayErrorMessage } from "@/lib/api";
import type { BackendCanonicalLease, NormalizerResponse } from "@/lib/types";
import {
  buildCompletedLeaseAbstractFileName,
  buildCompletedLeaseAbstractWorkbook,
  downloadArrayBuffer,
  printCompletedLeaseAbstract,
} from "@/lib/completed-leases/export";
import type {
  CompletedLeaseAbstractView,
  CompletedLeaseDocumentKind,
  CompletedLeaseDocumentRecord,
  CompletedLeaseExportBranding,
} from "@/lib/completed-leases/types";

interface CompletedLeasesWorkspaceProps {
  exportBranding?: CompletedLeaseExportBranding;
}

const STORAGE_KEY = "completed_leases_module_v1";

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toIsoDate(dateValue: Date): string {
  const yyyy = dateValue.getUTCFullYear();
  const mm = String(dateValue.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dateValue.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(value: string): string {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferKind(fileName: string, normalize: NormalizerResponse): CompletedLeaseDocumentKind {
  const fromSummary = String(normalize.extraction_summary?.document_type_detected || "").toLowerCase();
  const fromName = String(fileName || "").toLowerCase();
  if (
    fromSummary.includes("amend")
    || fromSummary.includes("counter")
    || fromSummary.includes("redline")
    || fromName.includes("amend")
    || fromName.includes("counter")
    || fromName.includes("redline")
  ) {
    return "amendment";
  }
  return "lease";
}

function mergeRentSchedules(
  base: BackendCanonicalLease["rent_schedule"],
  amendment: BackendCanonicalLease["rent_schedule"],
): BackendCanonicalLease["rent_schedule"] {
  if (!Array.isArray(amendment) || amendment.length === 0) return base;
  const cleaned = amendment
    .map((step) => ({
      start_month: Math.max(0, Math.floor(Number(step.start_month) || 0)),
      end_month: Math.max(0, Math.floor(Number(step.end_month) || 0)),
      rent_psf_annual: Math.max(0, Number(step.rent_psf_annual) || 0),
    }))
    .filter((step) => step.end_month >= step.start_month);
  return cleaned.length > 0 ? cleaned : base;
}

function shouldApplyOverride(
  value: unknown,
  confidence: number | undefined,
  key: keyof BackendCanonicalLease,
): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0 && (confidence ?? 1) >= 0.5;
  if (Array.isArray(value)) return value.length > 0 && (confidence ?? 1) >= 0.5;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    if (key === "free_rent_months" || key === "parking_count" || key === "ti_allowance_psf") return (confidence ?? 1) >= 0.5;
    return value > 0 && (confidence ?? 1) >= 0.5;
  }
  return (confidence ?? 1) >= 0.5;
}

function buildControllingAbstract(
  selected: CompletedLeaseDocumentRecord,
  allDocuments: CompletedLeaseDocumentRecord[],
): CompletedLeaseAbstractView {
  const sourceDocuments = [selected];
  if (selected.kind === "lease" || !selected.linkedLeaseId) {
    return {
      controllingCanonical: selected.canonical,
      controllingDocumentId: selected.id,
      sourceDocuments,
      overrideNotes: [],
    };
  }

  const base = allDocuments.find((doc) => doc.id === selected.linkedLeaseId);
  if (!base) {
    return {
      controllingCanonical: selected.canonical,
      controllingDocumentId: selected.id,
      sourceDocuments,
      overrideNotes: ["Linked base lease was not found. Using amendment values as controlling until relinked."],
    };
  }

  sourceDocuments.unshift(base);
  const merged: BackendCanonicalLease = {
    ...base.canonical,
    notes: [base.canonical.notes, selected.canonical.notes].filter(Boolean).join("\n"),
  };
  const overrideNotes: string[] = [];
  const amendment = selected.canonical;

  const scalarKeys: Array<keyof BackendCanonicalLease> = [
    "premises_name",
    "address",
    "building_name",
    "suite",
    "floor",
    "rsf",
    "lease_type",
    "commencement_date",
    "expiration_date",
    "term_months",
    "free_rent_months",
    "free_rent_scope",
    "discount_rate_annual",
    "opex_psf_year_1",
    "opex_growth_rate",
    "expense_stop_psf",
    "expense_structure_type",
    "parking_count",
    "parking_rate_monthly",
    "parking_sales_tax_rate",
    "ti_allowance_psf",
    "ti_budget_total",
  ];

  scalarKeys.forEach((key) => {
    const value = amendment[key];
    const confidence = selected.fieldConfidence[key as string];
    if (!shouldApplyOverride(value, confidence, key)) return;
    const previous = merged[key];
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    merged[key] = value as never;
    overrideNotes.push(`Amendment overrides ${key} (${String(previous ?? "-")} → ${String(value ?? "-")}).`);
  });

  const mergedSchedule = mergeRentSchedules(base.canonical.rent_schedule, amendment.rent_schedule);
  if (mergedSchedule !== base.canonical.rent_schedule) {
    merged.rent_schedule = mergedSchedule;
    overrideNotes.push("Amendment rent schedule replaced base lease schedule.");
  }

  if (Array.isArray(amendment.phase_in_schedule) && amendment.phase_in_schedule.length > 0) {
    merged.phase_in_schedule = amendment.phase_in_schedule;
    overrideNotes.push("Amendment phase-in schedule overrides base lease phase-in.");
  }

  if (Array.isArray(amendment.free_rent_periods) && amendment.free_rent_periods.length > 0) {
    merged.free_rent_periods = amendment.free_rent_periods;
    overrideNotes.push("Amendment free-rent periods override base lease abatements.");
  }

  if (Array.isArray(amendment.parking_abatement_periods) && amendment.parking_abatement_periods.length > 0) {
    merged.parking_abatement_periods = amendment.parking_abatement_periods;
    overrideNotes.push("Amendment parking abatements override base lease parking abatements.");
  }

  return {
    controllingCanonical: merged,
    controllingDocumentId: selected.id,
    sourceDocuments,
    overrideNotes,
  };
}

export function CompletedLeasesWorkspace({ exportBranding = {} }: CompletedLeasesWorkspaceProps) {
  const [documents, setDocuments] = useState<CompletedLeaseDocumentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState("No files uploaded");
  const [dragOver, setDragOver] = useState(false);
  const [globalDragActive, setGlobalDragActive] = useState(false);
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const globalDragDepthRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { documents?: CompletedLeaseDocumentRecord[]; selectedId?: string };
      if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) return;
      setDocuments(parsed.documents);
      setSelectedId(parsed.selectedId && parsed.documents.some((doc) => doc.id === parsed.selectedId) ? parsed.selectedId : parsed.documents[0].id);
      setStatus(`Loaded ${parsed.documents.length} saved document${parsed.documents.length === 1 ? "" : "s"}.`);
    } catch {
      // ignore corrupted local state and continue
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || documents.length === 0) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ documents, selectedId }));
  }, [documents, selectedId]);

  const selected = useMemo(
    () => documents.find((doc) => doc.id === selectedId) ?? documents[0] ?? null,
    [documents, selectedId]
  );

  const controllingAbstract = useMemo(() => {
    if (!selected) return null;
    return buildControllingAbstract(selected, documents);
  }, [selected, documents]);

  const leaseOptions = useMemo(() => documents.filter((doc) => doc.kind === "lease"), [documents]);

  const updateSelectedCanonical = useCallback((key: keyof BackendCanonicalLease, value: string) => {
    if (!selected) return;
    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id !== selected.id) return doc;
        const nextCanonical = { ...doc.canonical };
        if (key === "rsf" || key === "term_months" || key === "free_rent_months" || key === "parking_count") {
          (nextCanonical as Record<string, unknown>)[key] = Math.max(0, Math.floor(Number(value) || 0));
        } else if (
          key === "discount_rate_annual"
          || key === "opex_psf_year_1"
          || key === "opex_growth_rate"
          || key === "parking_rate_monthly"
          || key === "ti_allowance_psf"
        ) {
          (nextCanonical as Record<string, unknown>)[key] = Math.max(0, Number(value) || 0);
        } else {
          (nextCanonical as Record<string, unknown>)[key] = value;
        }
        return { ...doc, canonical: nextCanonical };
      })
    );
  }, [selected]);

  const updateDocumentMeta = useCallback((docId: string, patch: Partial<CompletedLeaseDocumentRecord>) => {
    setDocuments((prev) => prev.map((doc) => (doc.id === docId ? { ...doc, ...patch } : doc)));
  }, []);

  const parseAndAddDocument = useCallback(async (file: File) => {
    const name = String(file.name || "").toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".docx") && !name.endsWith(".doc")) {
      throw new Error(`Unsupported file type for ${file.name}. Use .pdf, .docx, or .doc.`);
    }
    const form = new FormData();
    form.append("source", name.endsWith(".pdf") ? "PDF" : "WORD");
    form.append("file", file);

    const res = await fetchApi("/normalize", { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Normalize request failed (${res.status}).`);
    }
    const normalize = (await res.json()) as NormalizerResponse;
    const kind = inferKind(file.name, normalize);
    const record: CompletedLeaseDocumentRecord = {
      id: nextId(),
      fileName: file.name,
      uploadedAtIso: toIsoDate(new Date()),
      kind,
      linkedLeaseId: kind === "amendment" ? leaseOptions[0]?.id : undefined,
      canonical: normalize.canonical_lease,
      fieldConfidence: normalize.field_confidence || {},
      warnings: normalize.warnings || [],
      extractionSummary: normalize.extraction_summary,
      reviewTasks: normalize.review_tasks || [],
      source: normalize,
    };
    setDocuments((prev) => [record, ...prev]);
    setSelectedId(record.id);
    return record;
  }, [leaseOptions]);

  const processFiles = useCallback(async (incoming: FileList | File[] | null | undefined) => {
    const files = Array.from(incoming ?? []);
    if (files.length === 0) return;
    setLoading(true);
    setError("");
    try {
      let processed = 0;
      for (const file of files) {
        setStatus(`Extracting ${file.name}...`);
        await parseAndAddDocument(file);
        processed += 1;
      }
      setStatus(`Processed ${processed} document${processed === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [parseAndAddDocument]);

  const onExcelExport = useCallback(async () => {
    if (!controllingAbstract) return;
    setExportExcelLoading(true);
    setError("");
    try {
      const buffer = await buildCompletedLeaseAbstractWorkbook(controllingAbstract, exportBranding);
      downloadArrayBuffer(
        buffer,
        buildCompletedLeaseAbstractFileName("xlsx", exportBranding),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    } finally {
      setExportExcelLoading(false);
    }
  }, [controllingAbstract, exportBranding]);

  const onPdfExport = useCallback(() => {
    if (!controllingAbstract) return;
    setError("");
    try {
      printCompletedLeaseAbstract(controllingAbstract, exportBranding);
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    }
  }, [controllingAbstract, exportBranding]);

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

  return (
    <PlatformSection
      kicker="Completed Leases"
      title="Completed Lease Abstraction"
      description="Upload executed leases and amendments, review extracted controlling terms, and export polished abstract outputs."
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExcelExport}
            disabled={exportExcelLoading || !controllingAbstract}
            className="btn-premium btn-premium-success disabled:opacity-50"
          >
            {exportExcelLoading ? "Exporting..." : "Export Excel"}
          </button>
          <button
            type="button"
            onClick={onPdfExport}
            disabled={!controllingAbstract}
            className="btn-premium btn-premium-secondary disabled:opacity-50"
          >
            Export PDF
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <PlatformPanel kicker="Intake" title="Upload Lease Documents" className="lg:col-span-4">
          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void processFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`cursor-pointer border border-dashed px-4 py-8 text-center transition-colors ${
              dragOver || globalDragActive ? "border-cyan-300 bg-cyan-500/10" : "border-white/20 bg-black/20"
            }`}
          >
            <p className="heading-kicker mb-2">Upload lease package</p>
            <p className="text-sm text-slate-200">
              Drag and drop <strong>.pdf</strong>, <strong>.docx</strong>, or <strong>.doc</strong> files here,
              or click to choose.
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Amendment files can be linked to a base lease for controlling-term overrides.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            className="hidden"
            onChange={(event) => {
              void processFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <p className="text-xs text-slate-400 mt-3">{loading ? "Processing documents..." : status}</p>
          {error ? <p className="text-xs text-red-300 mt-2">{error}</p> : null}
        </PlatformPanel>

        <PlatformPanel kicker="Repository" title="Document Stack" className="lg:col-span-8 min-w-0">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Document</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Type</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Uploaded</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Link to Lease</th>
                  <th className="text-left py-2 text-slate-300 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-slate-400">
                      No documents yet.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => {
                    const selectedRow = doc.id === selected?.id;
                    return (
                      <tr key={doc.id} className={`border-b border-white/10 ${selectedRow ? "bg-cyan-500/10" : ""}`}>
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            onClick={() => setSelectedId(doc.id)}
                            className={`text-left ${selectedRow ? "text-cyan-100" : "text-slate-100"} hover:text-cyan-100`}
                          >
                            {doc.fileName}
                          </button>
                        </td>
                        <td className="py-2 pr-3 text-slate-200">{doc.kind === "amendment" ? "Amendment" : "Lease"}</td>
                        <td className="py-2 pr-3 text-slate-300">{formatDate(doc.uploadedAtIso.slice(0, 10))}</td>
                        <td className="py-2 pr-3">
                          {doc.kind === "amendment" ? (
                            <select
                              value={doc.linkedLeaseId || ""}
                              onChange={(event) => updateDocumentMeta(doc.id, { linkedLeaseId: event.target.value || undefined })}
                              className="input-premium !py-1 !px-2 text-xs"
                            >
                              <option value="">Unlinked</option>
                              {leaseOptions.map((lease) => (
                                <option key={lease.id} value={lease.id}>
                                  {lease.fileName}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-400">Base lease</span>
                          )}
                        </td>
                        <td className="py-2">
                          {doc.reviewTasks.length > 0 ? (
                            <span className="text-amber-200">{doc.reviewTasks.length} task(s)</span>
                          ) : (
                            <span className="text-emerald-200">Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </PlatformPanel>

        <PlatformPanel kicker="Review" title="Extraction Review" className="lg:col-span-5">
          {!selected ? (
            <p className="text-sm text-slate-400">Select a document to review extracted fields.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400">
                  Kind
                  <select
                    value={selected.kind}
                    onChange={(e) => updateDocumentMeta(selected.id, { kind: e.target.value as CompletedLeaseDocumentKind })}
                    className="input-premium mt-1 !py-2"
                  >
                    <option value="lease">Lease</option>
                    <option value="amendment">Amendment</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  RSF
                  <input
                    type="number"
                    value={asNumber(selected.canonical.rsf)}
                    onChange={(e) => updateSelectedCanonical("rsf", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Commencement
                  <input
                    type="date"
                    value={String(selected.canonical.commencement_date || "")}
                    onChange={(e) => updateSelectedCanonical("commencement_date", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Expiration
                  <input
                    type="date"
                    value={String(selected.canonical.expiration_date || "")}
                    onChange={(e) => updateSelectedCanonical("expiration_date", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Lease Type
                  <input
                    type="text"
                    value={String(selected.canonical.lease_type || "")}
                    onChange={(e) => updateSelectedCanonical("lease_type", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Parking Count
                  <input
                    type="number"
                    value={asNumber(selected.canonical.parking_count)}
                    onChange={(e) => updateSelectedCanonical("parking_count", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
              </div>

              {selected.extractionSummary ? (
                <div className="border border-white/10 bg-black/25 p-3">
                  <p className="text-xs text-slate-400 uppercase tracking-[0.08em]">Document classification</p>
                  <p className="text-sm text-slate-100 mt-1">{selected.extractionSummary.document_type_detected || "unknown"}</p>
                  {selected.extractionSummary.sections_searched.length > 0 ? (
                    <p className="text-xs text-slate-400 mt-1">Sections searched: {selected.extractionSummary.sections_searched.join(", ")}</p>
                  ) : null}
                </div>
              ) : null}

              {selected.reviewTasks.length > 0 ? (
                <div className="border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-100 uppercase tracking-[0.08em] mb-1">Needs Review</p>
                  <ul className="text-xs text-amber-100/90 space-y-1">
                    {selected.reviewTasks.slice(0, 8).map((task, idx) => (
                      <li key={`${task.field_path}-${idx}`}>
                        <strong>{task.field_path}:</strong> {task.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </PlatformPanel>

        <PlatformPanel kicker="Abstract" title="Controlling Lease Abstract" className="lg:col-span-7">
          {!controllingAbstract ? (
            <p className="text-sm text-slate-400">Upload documents to build the controlling abstract.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Premises</p>
                  <p className="text-sm text-white">{String(controllingAbstract.controllingCanonical.premises_name || controllingAbstract.controllingCanonical.building_name || "-")}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Address</p>
                  <p className="text-sm text-white">{String(controllingAbstract.controllingCanonical.address || "-")}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Commencement</p>
                  <p className="text-sm text-white">{formatDate(String(controllingAbstract.controllingCanonical.commencement_date || ""))}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Expiration</p>
                  <p className="text-sm text-white">{formatDate(String(controllingAbstract.controllingCanonical.expiration_date || ""))}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">RSF</p>
                  <p className="text-sm text-white">{asNumber(controllingAbstract.controllingCanonical.rsf).toLocaleString("en-US")}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Lease Type</p>
                  <p className="text-sm text-white">{String(controllingAbstract.controllingCanonical.lease_type || "-")}</p>
                </div>
              </div>

              {controllingAbstract.overrideNotes.length > 0 ? (
                <div className="border border-cyan-400/40 bg-cyan-500/10 p-3">
                  <p className="text-xs text-cyan-100 uppercase tracking-[0.08em] mb-1">Override audit</p>
                  <ul className="text-xs text-cyan-100/90 space-y-1">
                    {controllingAbstract.overrideNotes.map((note, idx) => (
                      <li key={`${note}-${idx}`}>• {note}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-slate-400">No amendment overrides were applied in this abstract.</p>
              )}
            </div>
          )}
        </PlatformPanel>
      </div>
    </PlatformSection>
  );
}
