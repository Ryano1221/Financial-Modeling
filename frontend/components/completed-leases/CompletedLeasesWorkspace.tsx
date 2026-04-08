"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformPanel, PlatformSection } from "@/components/platform/PlatformShell";
import { getDisplayErrorMessage } from "@/lib/api";
import { normalizerResponseFromSnapshot } from "@/lib/lease-extraction-repair";
import type { BackendCanonicalLease, NormalizerResponse } from "@/lib/types";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";
import { fetchWorkspaceCloudSection, saveWorkspaceCloudSection } from "@/lib/workspace/cloud";
import { preferLocalWhenRemoteEmpty } from "@/lib/workspace/account-sync";
import { ClientDocumentPicker } from "@/components/workspace/ClientDocumentPicker";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";
import {
  buildCompletedLeaseAbstractFileName,
  buildCompletedLeaseShareLink,
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
  clientId: string;
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

function asText(value: unknown): string {
  return String(value || "").trim();
}

function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${value.toFixed(2)} $/SF/YR`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function getRentScheduleSummary(canonical: BackendCanonicalLease): string {
  const steps = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule : [];
  if (steps.length === 0) return "-";
  return steps
    .slice(0, 6)
    .map((step) => {
      const start = Math.max(0, Math.floor(Number(step.start_month) || 0)) + 1;
      const end = Math.max(start, Math.floor(Number(step.end_month) || start - 1) + 1);
      return `Months ${start}-${end}: ${formatRate(asNumber(step.rent_psf_annual))}`;
    })
    .join(" | ");
}

function estimateEscalationPct(canonical: BackendCanonicalLease): number {
  const steps = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule : [];
  if (steps.length < 2) return 0;
  const first = asNumber(steps[0]?.rent_psf_annual);
  const second = asNumber(steps[1]?.rent_psf_annual);
  if (first <= 0 || second <= 0) return 0;
  return Math.max(0, (second - first) / first);
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
  if (selected.kind === "lease" || !selected.linkedLeaseId) {
    return {
      controllingCanonical: selected.canonical,
      controllingDocumentId: selected.id,
      sourceDocuments: [selected],
      overrideNotes: [],
    };
  }

  const base = allDocuments.find((doc) => doc.id === selected.linkedLeaseId);
  if (!base) {
    return {
      controllingCanonical: selected.canonical,
      controllingDocumentId: selected.id,
      sourceDocuments: [selected],
      overrideNotes: ["Linked base lease was not found. Using amendment values as controlling until relinked."],
    };
  }

  const linkedAmendments = allDocuments
    .filter((doc) => doc.kind === "amendment" && doc.linkedLeaseId === base.id)
    .sort((left, right) => left.uploadedAtIso.localeCompare(right.uploadedAtIso));

  const sourceDocuments: CompletedLeaseDocumentRecord[] = [base, ...linkedAmendments];
  const merged: BackendCanonicalLease = {
    ...base.canonical,
    notes: asText(base.canonical.notes),
  };
  const overrideNotes: string[] = [];

  const scalarKeys: Array<keyof BackendCanonicalLease> = [
    "tenant_name",
    "landlord_name",
    "premises_name",
    "address",
    "building_name",
    "suite",
    "floor",
    "rsf",
    "lease_type",
    "commencement_date",
    "rent_commencement_date",
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
    "security_deposit_months",
    "security_deposit",
    "guaranty",
    "options",
    "notice_dates",
    "renewal_options",
    "termination_rights",
    "ti_allowance_psf",
    "ti_budget_total",
  ];
  linkedAmendments.forEach((amendmentDoc) => {
    const amendment = amendmentDoc.canonical;
    scalarKeys.forEach((key) => {
      const value = amendment[key];
      const confidence = amendmentDoc.fieldConfidence[key as string];
      if (!shouldApplyOverride(value, confidence, key)) return;
      const previous = merged[key];
      if (JSON.stringify(previous) === JSON.stringify(value)) return;
      merged[key] = value as never;
      overrideNotes.push(`${amendmentDoc.fileName} overrides ${key} (${String(previous ?? "-")} -> ${String(value ?? "-")}).`);
    });

    const mergedSchedule = mergeRentSchedules(merged.rent_schedule, amendment.rent_schedule);
    if (mergedSchedule !== merged.rent_schedule) {
      merged.rent_schedule = mergedSchedule;
      overrideNotes.push(`${amendmentDoc.fileName} replaces base rent schedule.`);
    }

    if (Array.isArray(amendment.phase_in_schedule) && amendment.phase_in_schedule.length > 0) {
      merged.phase_in_schedule = amendment.phase_in_schedule;
      overrideNotes.push(`${amendmentDoc.fileName} overrides phase-in schedule.`);
    }

    if (Array.isArray(amendment.free_rent_periods) && amendment.free_rent_periods.length > 0) {
      merged.free_rent_periods = amendment.free_rent_periods;
      overrideNotes.push(`${amendmentDoc.fileName} overrides free-rent periods.`);
    }

    if (Array.isArray(amendment.parking_abatement_periods) && amendment.parking_abatement_periods.length > 0) {
      merged.parking_abatement_periods = amendment.parking_abatement_periods;
      overrideNotes.push(`${amendmentDoc.fileName} overrides parking abatements.`);
    }

    const notes = [asText(merged.notes), asText(amendment.notes)].filter(Boolean).join("\n");
    merged.notes = notes || undefined;
  });

  return {
    controllingCanonical: merged,
    controllingDocumentId: selected.id,
    sourceDocuments,
    overrideNotes,
  };
}

export function CompletedLeasesWorkspace({ clientId, exportBranding = {} }: CompletedLeasesWorkspaceProps) {
  const { isAuthenticated, documents: clientDocuments } = useClientWorkspace();
  const [documents, setDocuments] = useState<CompletedLeaseDocumentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState("No files uploaded");
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const scopedStorageKey = useMemo(
    () => makeClientScopedStorageKey(STORAGE_KEY, clientId),
    [clientId],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    setStorageHydrated(false);
    setDocuments([]);
    setSelectedId("");
    setError("");
    setStatus("No files uploaded");

    const applyParsed = (parsed: { documents?: CompletedLeaseDocumentRecord[]; selectedId?: string } | null) => {
      if (!parsed || !Array.isArray(parsed.documents) || parsed.documents.length === 0) {
        setStorageHydrated(true);
        return;
      }
      const scopedDocs = parsed.documents.filter((doc) => doc.clientId === clientId || !doc.clientId).map((doc) => ({ ...doc, clientId }));
      if (scopedDocs.length === 0) {
        setStorageHydrated(true);
        return;
      }
      setDocuments(scopedDocs);
      setSelectedId(parsed.selectedId && scopedDocs.some((doc) => doc.id === parsed.selectedId) ? parsed.selectedId : scopedDocs[0].id);
      setStatus(`Loaded ${scopedDocs.length} saved document${scopedDocs.length === 1 ? "" : "s"}.`);
      setStorageHydrated(true);
    };

    async function hydrate() {
      let localParsed: { documents?: CompletedLeaseDocumentRecord[]; selectedId?: string } | null = null;
      try {
        const raw = localStorage.getItem(scopedStorageKey);
        localParsed = raw ? (JSON.parse(raw) as { documents?: CompletedLeaseDocumentRecord[]; selectedId?: string }) : null;
      } catch {
        localParsed = null;
      }
      if (isAuthenticated) {
        try {
          const remote = await fetchWorkspaceCloudSection(scopedStorageKey);
          if (cancelled) return;
          applyParsed(
            preferLocalWhenRemoteEmpty(
              (remote.value as { documents?: CompletedLeaseDocumentRecord[]; selectedId?: string } | null) ?? null,
              localParsed,
              (value) => Array.isArray(value.documents) && value.documents.length > 0,
            ),
          );
          return;
        } catch (error) {
          console.warn("completed_leases_cloud_load_failed", error);
          if (cancelled) return;
        }
      }
      applyParsed(localParsed);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [scopedStorageKey, clientId, isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!storageHydrated) return;
    const payload = documents.length === 0 ? null : { documents, selectedId };
    if (payload) {
      localStorage.setItem(scopedStorageKey, JSON.stringify(payload));
    } else {
      localStorage.removeItem(scopedStorageKey);
    }
    if (!isAuthenticated) return;
    void saveWorkspaceCloudSection(scopedStorageKey, payload).catch((error) => {
      console.warn("completed_leases_cloud_save_failed", error);
    });
  }, [documents, selectedId, scopedStorageKey, isAuthenticated, storageHydrated]);

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

  const addDocumentFromNormalize = useCallback(async (
    input: {
      fileName: string;
      normalize: NormalizerResponse;
      uploadedAtIso?: string;
    },
  ) => {
    const kind = inferKind(input.fileName, input.normalize);
    const record: CompletedLeaseDocumentRecord = {
      id: nextId(),
      clientId,
      fileName: input.fileName,
      uploadedAtIso: input.uploadedAtIso || toIsoDate(new Date()),
      kind,
      linkedLeaseId: kind === "amendment" ? leaseOptions[0]?.id : undefined,
      canonical: input.normalize.canonical_lease,
      fieldConfidence: input.normalize.field_confidence || {},
      warnings: input.normalize.warnings || [],
      extractionSummary: input.normalize.extraction_summary,
      reviewTasks: input.normalize.review_tasks || [],
      source: input.normalize,
    };
    setDocuments((prev) => [record, ...prev]);
    setSelectedId(record.id);
    return record;
  }, [clientId, leaseOptions]);

  const onSelectExistingDocument = useCallback(async (document: ClientWorkspaceDocument) => {
    const normalized = normalizerResponseFromSnapshot(document.normalizeSnapshot);
    if (!normalized?.canonical_lease) {
      setError("Selected document has no parsed payload. Upload this file through this client workspace first.");
      return;
    }
    setError("");
    await addDocumentFromNormalize({
      fileName: document.name,
      normalize: normalized,
      uploadedAtIso: toIsoDate(new Date()),
    });
    setStatus(`Imported ${document.name} from client document library.`);
  }, [addDocumentFromNormalize]);

  useEffect(() => {
    if (!storageHydrated) return;
    const moduleDocuments = clientDocuments.filter((document) => document.sourceModule === "completed-leases");
    if (moduleDocuments.length === 0) return;

    let importedCount = 0;
    setDocuments((prev) => {
      const existingSourceIds = new Set(prev.map((doc) => asText(doc.sourceDocumentId)).filter(Boolean));
      const next = [...prev];
      for (const document of moduleDocuments) {
        if (existingSourceIds.has(document.id)) continue;
        const normalized = normalizerResponseFromSnapshot(document.normalizeSnapshot);
        if (!normalized?.canonical_lease) continue;
        const kind = inferKind(document.name, normalized);
        next.unshift({
          id: nextId(),
          clientId,
          sourceDocumentId: document.id,
          fileName: document.name,
          uploadedAtIso: toIsoDate(new Date()),
          kind,
          linkedLeaseId: kind === "amendment" ? next.find((record) => record.kind === "lease")?.id : undefined,
          canonical: normalized.canonical_lease,
          fieldConfidence: normalized.field_confidence || {},
          warnings: normalized.warnings || [],
          extractionSummary: normalized.extraction_summary,
          reviewTasks: normalized.review_tasks || [],
          source: normalized,
        });
        existingSourceIds.add(document.id);
        importedCount += 1;
      }
      return next;
    });

    if (importedCount > 0) {
      setStatus(`Imported ${importedCount} lease document${importedCount === 1 ? "" : "s"} from this client's Lease Abstract tab upload.`);
      setError("");
    }
  }, [clientDocuments, clientId, storageHydrated]);

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

  const onCopyShareLink = useCallback(async () => {
    if (!controllingAbstract || typeof navigator === "undefined") return;
    setError("");
    try {
      const link = buildCompletedLeaseShareLink(controllingAbstract, exportBranding);
      await navigator.clipboard.writeText(link);
      setStatus("Share link copied.");
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    }
  }, [controllingAbstract, exportBranding]);

  return (
    <PlatformSection
      kicker="Lease Abstract"
      title="Completed Lease Abstraction"
      description="Review executed leases and amendments for this client, confirm controlling terms, and export polished abstract outputs."
      headerAlign="center"
      actions={
        <div className="flex flex-wrap justify-center gap-2">
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
          <button
            type="button"
            onClick={() => { void onCopyShareLink(); }}
            disabled={!controllingAbstract}
            className="btn-premium btn-premium-secondary disabled:opacity-50"
          >
            Copy Share Link
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <PlatformPanel kicker="Intake" title="Lease Document Intake" className="lg:col-span-4">
          <div className="border border-dashed border-white/20 bg-black/20 px-4 py-8 text-center">
            <p className="heading-kicker mb-2">Unified Document Intake</p>
            <p className="text-sm text-slate-200">
              Drop lease files anywhere on this tab to save them to this client and load them into the lease abstract stack.
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Amendment files can then be linked to a base lease for controlling-term overrides.
            </p>
          </div>
          <p className="text-xs text-slate-400 mt-3">{status}</p>
          <div className="mt-3">
            <ClientDocumentPicker
              buttonLabel="Select Existing Lease/Amendment"
              allowedTypes={["leases", "amendments", "redlines", "other"]}
              onSelectDocument={(doc) => {
                void onSelectExistingDocument(doc);
              }}
            />
          </div>
          {error ? <p className="text-xs text-red-300 mt-2">{error}</p> : null}
        </PlatformPanel>

        <PlatformPanel kicker="Repository" title="Document Stack" className="lg:col-span-8 min-w-0">
          <div className="space-y-3 md:hidden">
            {documents.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">No documents yet.</p>
            ) : (
              documents.map((doc) => {
                const selectedRow = doc.id === selected?.id;
                return (
                  <div key={doc.id} className={`border p-3 space-y-2 ${selectedRow ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/15 bg-black/20"}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(doc.id)}
                      className={`text-left text-sm break-words ${selectedRow ? "text-cyan-100" : "text-slate-100"}`}
                    >
                      {doc.fileName}
                    </button>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <p className="text-slate-400">Type: <span className="text-slate-200">{doc.kind === "amendment" ? "Amendment" : "Lease"}</span></p>
                      <p className="text-slate-400">Uploaded: <span className="text-slate-200">{formatDate(doc.uploadedAtIso.slice(0, 10))}</span></p>
                      <p className="text-slate-400">Review: <span className={doc.reviewTasks.length > 0 ? "text-amber-200" : "text-emerald-200"}>{doc.reviewTasks.length > 0 ? `${doc.reviewTasks.length} task(s)` : "Ready"}</span></p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400 mb-1">Link to Lease</p>
                      {doc.kind === "amendment" ? (
                        <select
                          value={doc.linkedLeaseId || ""}
                          onChange={(event) => updateDocumentMeta(doc.id, { linkedLeaseId: event.target.value || undefined })}
                          className="input-premium !py-1.5 !px-2 text-xs w-full"
                        >
                          <option value="">Unlinked</option>
                          {leaseOptions.map((lease) => (
                            <option key={lease.id} value={lease.id}>
                              {lease.fileName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-slate-400">Base lease</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="hidden md:block w-full overflow-x-auto">
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
                <label className="text-xs text-slate-400">
                  Tenant
                  <input
                    type="text"
                    value={asText(selected.canonical.tenant_name)}
                    onChange={(e) => updateSelectedCanonical("tenant_name", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Landlord
                  <input
                    type="text"
                    value={asText(selected.canonical.landlord_name)}
                    onChange={(e) => updateSelectedCanonical("landlord_name", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Building
                  <input
                    type="text"
                    value={asText(selected.canonical.building_name)}
                    onChange={(e) => updateSelectedCanonical("building_name", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Address
                  <input
                    type="text"
                    value={asText(selected.canonical.address)}
                    onChange={(e) => updateSelectedCanonical("address", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Suite
                  <input
                    type="text"
                    value={asText(selected.canonical.suite)}
                    onChange={(e) => updateSelectedCanonical("suite", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Floor
                  <input
                    type="text"
                    value={asText(selected.canonical.floor)}
                    onChange={(e) => updateSelectedCanonical("floor", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Rent Commencement
                  <input
                    type="date"
                    value={asText(selected.canonical.rent_commencement_date)}
                    onChange={(e) => updateSelectedCanonical("rent_commencement_date", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Term (months)
                  <input
                    type="number"
                    value={asNumber(selected.canonical.term_months)}
                    onChange={(e) => updateSelectedCanonical("term_months", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Free Rent (months)
                  <input
                    type="number"
                    value={asNumber(selected.canonical.free_rent_months)}
                    onChange={(e) => updateSelectedCanonical("free_rent_months", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  TI Allowance ($/SF)
                  <input
                    type="number"
                    value={asNumber(selected.canonical.ti_allowance_psf)}
                    onChange={(e) => updateSelectedCanonical("ti_allowance_psf", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Parking Rate (Monthly)
                  <input
                    type="number"
                    value={asNumber(selected.canonical.parking_rate_monthly)}
                    onChange={(e) => updateSelectedCanonical("parking_rate_monthly", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  OpEx Structure
                  <input
                    type="text"
                    value={asText(selected.canonical.expense_structure_type)}
                    onChange={(e) => updateSelectedCanonical("expense_structure_type", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Base OpEx ($/SF/YR)
                  <input
                    type="number"
                    value={asNumber(selected.canonical.opex_psf_year_1)}
                    onChange={(e) => updateSelectedCanonical("opex_psf_year_1", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Deposit
                  <input
                    type="text"
                    value={asText(selected.canonical.security_deposit)}
                    onChange={(e) => updateSelectedCanonical("security_deposit", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Guaranty
                  <input
                    type="text"
                    value={asText(selected.canonical.guaranty)}
                    onChange={(e) => updateSelectedCanonical("guaranty", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400 md:col-span-2">
                  Options
                  <input
                    type="text"
                    value={asText(selected.canonical.options || selected.canonical.renewal_options)}
                    onChange={(e) => updateSelectedCanonical("options", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400 md:col-span-2">
                  Notice Dates
                  <input
                    type="text"
                    value={asText(selected.canonical.notice_dates)}
                    onChange={(e) => updateSelectedCanonical("notice_dates", e.target.value)}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
              </div>

              <div className="border border-white/10 bg-black/25 p-3">
                <p className="text-xs text-slate-400 uppercase tracking-[0.08em] mb-2">Base Rent Schedule + Escalations</p>
                <p className="text-xs text-slate-200">{getRentScheduleSummary(selected.canonical)}</p>
                <p className="text-xs text-slate-400 mt-1">Estimated escalation: {formatPercent(estimateEscalationPct(selected.canonical))}</p>
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
                  <p className="text-xs text-slate-400">Tenant</p>
                  <p className="text-sm text-white">{asText(controllingAbstract.controllingCanonical.tenant_name) || "-"}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Landlord</p>
                  <p className="text-sm text-white">{asText(controllingAbstract.controllingCanonical.landlord_name) || "-"}</p>
                </div>
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
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Rent Commencement</p>
                  <p className="text-sm text-white">{formatDate(asText(controllingAbstract.controllingCanonical.rent_commencement_date))}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Term (Months)</p>
                  <p className="text-sm text-white">{asNumber(controllingAbstract.controllingCanonical.term_months) || "-"}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2 md:col-span-2">
                  <p className="text-xs text-slate-400">Base Rent Schedule</p>
                  <p className="text-sm text-white">{getRentScheduleSummary(controllingAbstract.controllingCanonical)}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Escalations: {formatPercent(estimateEscalationPct(controllingAbstract.controllingCanonical))}
                  </p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">OpEx Structure</p>
                  <p className="text-sm text-white">{asText(controllingAbstract.controllingCanonical.expense_structure_type) || "-"}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Free Rent (Months)</p>
                  <p className="text-sm text-white">{asNumber(controllingAbstract.controllingCanonical.free_rent_months) || 0}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">TI Allowance ($/SF)</p>
                  <p className="text-sm text-white">{asNumber(controllingAbstract.controllingCanonical.ti_allowance_psf) || "-"}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Parking</p>
                  <p className="text-sm text-white">
                    {asNumber(controllingAbstract.controllingCanonical.parking_count) || 0} spaces @ {asNumber(controllingAbstract.controllingCanonical.parking_rate_monthly) || 0}/mo
                  </p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Deposit</p>
                  <p className="text-sm text-white">{asText(controllingAbstract.controllingCanonical.security_deposit) || "-"}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Guaranty</p>
                  <p className="text-sm text-white">{asText(controllingAbstract.controllingCanonical.guaranty) || "-"}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2 md:col-span-2">
                  <p className="text-xs text-slate-400">Options / Notice Dates</p>
                  <p className="text-sm text-white">{asText(controllingAbstract.controllingCanonical.options || controllingAbstract.controllingCanonical.renewal_options) || "-"}</p>
                  <p className="text-xs text-slate-400 mt-1">{asText(controllingAbstract.controllingCanonical.notice_dates) || "-"}</p>
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
