"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformPanel, PlatformSection } from "@/components/platform/PlatformShell";
import { getDisplayErrorMessage } from "@/lib/api";
import type { NormalizerResponse } from "@/lib/types";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";
import { fetchWorkspaceCloudSection, saveWorkspaceCloudSection } from "@/lib/workspace/cloud";
import { ClientDocumentPicker } from "@/components/workspace/ClientDocumentPicker";
import { SurveyLocationsMap } from "@/components/surveys/SurveyLocationsMap";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";
import { computeSurveyMonthlyOccupancyCost, createManualSurveyEntryFromImage, mapNormalizeToSurveyEntry } from "@/lib/surveys/engine";
import {
  buildSurveysExportFileName,
  buildSurveysShareLink,
  buildSurveysWorkbook,
  downloadArrayBuffer,
  printSurveysPdf,
} from "@/lib/surveys/export";
import type { SurveyEntry, SurveysExportBranding, SurveyLeaseType, SurveyOccupancyType } from "@/lib/surveys/types";

const STORAGE_KEY = "surveys_module_entries_v1";

interface SurveysWorkspaceProps {
  clientId: string;
  exportBranding?: SurveysExportBranding;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function formatIsoDate(iso: string): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "").trim() || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

export function SurveysWorkspace({ clientId, exportBranding = {} }: SurveysWorkspaceProps) {
  const { isAuthenticated } = useClientWorkspace();
  const [entries, setEntries] = useState<SurveyEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("No survey entries yet. Upload files in Document Center, then select them here.");
  const scopedStorageKey = useMemo(
    () => makeClientScopedStorageKey(STORAGE_KEY, clientId),
    [clientId],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    setStorageHydrated(false);
    setEntries([]);
    setSelectedId("");
    setStatus("No survey entries yet. Upload files in Document Center, then select them here.");
    setError("");

    const applyParsed = (parsed: { entries?: SurveyEntry[]; selectedId?: string } | null) => {
      if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) {
        setStorageHydrated(true);
        return;
      }
      const scopedEntries = parsed.entries
        .filter((entry) => entry.clientId === clientId || !entry.clientId)
        .map((entry) => ({ ...entry, clientId }));
      if (scopedEntries.length === 0) {
        setStorageHydrated(true);
        return;
      }
      setEntries(scopedEntries);
      if (parsed.selectedId && scopedEntries.some((entry) => entry.id === parsed.selectedId)) {
        setSelectedId(parsed.selectedId);
      } else {
        setSelectedId(scopedEntries[0].id);
      }
      setStatus(`Loaded ${scopedEntries.length} saved survey entr${scopedEntries.length === 1 ? "y" : "ies"}.`);
      setStorageHydrated(true);
    };

    async function hydrate() {
      if (isAuthenticated) {
        try {
          const remote = await fetchWorkspaceCloudSection(scopedStorageKey);
          if (cancelled) return;
          applyParsed((remote.value as { entries?: SurveyEntry[]; selectedId?: string } | null) ?? null);
          return;
        } catch (error) {
          console.warn("surveys_cloud_load_failed", error);
          if (cancelled) return;
          setStorageHydrated(true);
          return;
        }
      }
      try {
        const raw = localStorage.getItem(scopedStorageKey);
        applyParsed(raw ? (JSON.parse(raw) as { entries?: SurveyEntry[]; selectedId?: string }) : null);
      } catch {
        setStorageHydrated(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [scopedStorageKey, clientId, isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!storageHydrated) return;
    if (isAuthenticated) {
      const payload = entries.length === 0 ? null : { entries, selectedId };
      void saveWorkspaceCloudSection(scopedStorageKey, payload).catch((error) => {
        console.warn("surveys_cloud_save_failed", error);
      });
      return;
    }
    if (entries.length === 0) {
      localStorage.removeItem(scopedStorageKey);
      return;
    }
    localStorage.setItem(scopedStorageKey, JSON.stringify({ entries, selectedId }));
  }, [entries, selectedId, scopedStorageKey, isAuthenticated, storageHydrated]);

  const selected = useMemo(() => entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null, [entries, selectedId]);

  const selectedCost = useMemo(
    () => (selected ? computeSurveyMonthlyOccupancyCost(selected) : null),
    [selected]
  );

  const addEntry = useCallback((entry: SurveyEntry) => {
    setEntries((prev) => [entry, ...prev]);
    setSelectedId(entry.id);
  }, []);

  const onSelectExistingDocument = useCallback((document: ClientWorkspaceDocument) => {
    try {
      const snapshot = document.normalizeSnapshot;
      if (snapshot?.canonical_lease) {
        const normalized: NormalizerResponse = {
          canonical_lease: snapshot.canonical_lease,
          option_variants: snapshot.option_variants || [],
          confidence_score: Number(snapshot.confidence_score || 0),
          field_confidence: snapshot.field_confidence || {},
          missing_fields: [],
          clarification_questions: [],
          warnings: snapshot.warnings || [],
          extraction_summary: snapshot.extraction_summary,
          review_tasks: snapshot.review_tasks || [],
        };
        const entry = mapNormalizeToSurveyEntry(normalized, document.name, clientId);
        addEntry(entry);
        setStatus(`Loaded ${document.name} from client document library.`);
        setError("");
        return;
      }

      // If the selected existing document has no parse snapshot, create a manual review entry.
      const manual = createManualSurveyEntryFromImage(document.name, clientId);
      addEntry(manual);
      setStatus(`Added manual survey row from ${document.name}. Complete missing fields before export.`);
      setError("");
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    }
  }, [addEntry, clientId]);

  const updateSelected = useCallback((patch: Partial<SurveyEntry>) => {
    if (!selected) return;
    setEntries((prev) => prev.map((entry) => (entry.id === selected.id ? { ...entry, ...patch } : entry)));
  }, [selected]);

  const onExcelExport = useCallback(async () => {
    if (entries.length === 0) return;
    setExcelLoading(true);
    setError("");
    try {
      const buffer = await buildSurveysWorkbook(entries, exportBranding);
      downloadArrayBuffer(
        buffer,
        buildSurveysExportFileName("xlsx", exportBranding),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    } finally {
      setExcelLoading(false);
    }
  }, [entries, exportBranding]);

  const onPdfExport = useCallback(() => {
    if (entries.length === 0) return;
    setError("");
    try {
      printSurveysPdf(entries, exportBranding);
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    }
  }, [entries, exportBranding]);

  const onCopyShareLink = useCallback(async () => {
    if (entries.length === 0 || typeof navigator === "undefined") return;
    try {
      const link = buildSurveysShareLink(entries, exportBranding);
      await navigator.clipboard.writeText(link);
      setStatus("Share link copied.");
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    }
  }, [entries, exportBranding]);

  return (
    <PlatformSection
      kicker="Surveys"
      title="Survey Generation Workspace"
      description="Upload flyers, floorplans, brochures, and marketing packages to create structured survey entries and client-ready outputs."
      headerAlign="center"
      actions={
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="btn-premium btn-premium-success disabled:opacity-50"
            onClick={onExcelExport}
            disabled={excelLoading || entries.length === 0}
          >
            {excelLoading ? "Exporting..." : "Export Excel"}
          </button>
          <button
            type="button"
            className="btn-premium btn-premium-secondary disabled:opacity-50"
            onClick={onPdfExport}
            disabled={entries.length === 0}
          >
            Export PDF
          </button>
          <button
            type="button"
            className="btn-premium btn-premium-secondary disabled:opacity-50"
            onClick={onCopyShareLink}
            disabled={entries.length === 0}
          >
            Copy Share Link
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <PlatformPanel kicker="Survey Entries" title="Survey Table" className="lg:col-span-12">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs text-slate-400">{status}</p>
              {error ? <p className="text-xs text-red-300">{error}</p> : null}
            </div>
            <div className="w-full lg:w-auto">
              <ClientDocumentPicker
                buttonLabel="Select Existing Survey Document"
                allowedTypes={["surveys", "flyers", "floorplans", "other"]}
                onSelectDocument={onSelectExistingDocument}
              />
            </div>
          </div>
          <div className="space-y-3 md:hidden">
            {entries.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">No survey entries yet.</p>
            ) : (
              entries.map((entry) => {
                const active = entry.id === selected?.id;
                const cost = computeSurveyMonthlyOccupancyCost(entry);
                return (
                  <div key={entry.id} className={`border p-3 space-y-2 ${active ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/15 bg-black/20"}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(entry.id)}
                      className={`text-left text-sm break-words ${active ? "text-cyan-100" : "text-slate-100"}`}
                    >
                      {entry.buildingName || entry.sourceDocumentName}
                    </button>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <p className="text-slate-400">RSF: <span className="text-slate-200">{asNumber(entry.availableSqft).toLocaleString("en-US")}</span></p>
                      <p className="text-slate-400">Lease: <span className="text-slate-200">{entry.leaseType}</span></p>
                      <p className="text-slate-400">Type: <span className="text-slate-200">{entry.occupancyType}</span></p>
                      <p className="text-slate-400">Status: <span className="text-slate-200">{entry.needsReview ? "Needs Review" : "Ready"}</span></p>
                      <p className="col-span-2 text-slate-400">Address: <span className="text-slate-200">{entry.address || "-"}</span></p>
                      <p className="col-span-2 text-slate-400">Monthly Cost: <span className="text-slate-200">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cost.totalMonthly)}</span></p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Building</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Address</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">RSF</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Direct/Sublease</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Sublessor</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Sublease Exp.</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Lease</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Monthly Cost</th>
                  <th className="text-left py-2 text-slate-300 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-slate-400">
                      No survey entries yet.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => {
                    const active = entry.id === selected?.id;
                    const cost = computeSurveyMonthlyOccupancyCost(entry);
                    return (
                      <tr key={entry.id} className={`border-b border-white/10 ${active ? "bg-cyan-500/10" : ""}`}>
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            onClick={() => setSelectedId(entry.id)}
                            className={`text-left hover:text-cyan-100 ${active ? "text-cyan-100" : "text-slate-100"}`}
                          >
                            {entry.buildingName || entry.sourceDocumentName}
                          </button>
                        </td>
                        <td className="py-2 pr-3 text-slate-300">{entry.address || "-"}</td>
                        <td className="py-2 pr-3 text-slate-200">{asNumber(entry.availableSqft).toLocaleString("en-US")}</td>
                        <td className="py-2 pr-3 text-slate-200">{entry.occupancyType}</td>
                        <td className="py-2 pr-3 text-slate-200">{entry.sublessor || "-"}</td>
                        <td className="py-2 pr-3 text-slate-200">{entry.subleaseExpirationDate || "-"}</td>
                        <td className="py-2 pr-3 text-slate-200">{entry.leaseType}</td>
                        <td className="py-2 pr-3 text-slate-200">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cost.totalMonthly)}</td>
                        <td className="py-2 text-slate-200">{entry.needsReview ? "Needs Review" : "Ready"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </PlatformPanel>

        <PlatformPanel kicker="Map" title="Survey Location Map" className="lg:col-span-12">
          <SurveyLocationsMap
            entries={entries}
            selectedEntryId={selected?.id || null}
            onSelectEntry={(entryId) => setSelectedId(entryId)}
          />
        </PlatformPanel>

        <PlatformPanel kicker="Review" title="Survey Editor" className="lg:col-span-5">
          {!selected ? (
            <p className="text-sm text-slate-400">Select a survey entry to review and edit values.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400">
                  Building
                  <input
                    type="text"
                    value={selected.buildingName}
                    onChange={(e) => updateSelected({ buildingName: e.target.value })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Address
                  <input
                    type="text"
                    value={selected.address}
                    onChange={(e) => updateSelected({ address: e.target.value })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Suite
                  <input
                    type="text"
                    value={selected.suite}
                    onChange={(e) => updateSelected({ suite: e.target.value })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Floor
                  <input
                    type="text"
                    value={selected.floor}
                    onChange={(e) => updateSelected({ floor: e.target.value })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Available SF
                  <input
                    type="number"
                    value={asNumber(selected.availableSqft)}
                    onChange={(e) => updateSelected({ availableSqft: Math.max(0, Number(e.target.value) || 0) })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Base Rent ($/SF/YR)
                  <input
                    type="number"
                    step="0.01"
                    value={asNumber(selected.baseRentPsfAnnual)}
                    onChange={(e) => updateSelected({ baseRentPsfAnnual: Math.max(0, Number(e.target.value) || 0) })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  OpEx ($/SF/YR)
                  <input
                    type="number"
                    step="0.01"
                    value={asNumber(selected.opexPsfAnnual)}
                    onChange={(e) => updateSelected({ opexPsfAnnual: Math.max(0, Number(e.target.value) || 0) })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Occupancy Type
                  <select
                    value={selected.occupancyType}
                    onChange={(e) => updateSelected({ occupancyType: e.target.value as SurveyOccupancyType })}
                    className="input-premium mt-1 !py-2"
                  >
                    <option value="Unknown">Unknown</option>
                    <option value="Direct">Direct</option>
                    <option value="Sublease">Sublease</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Lease Type
                  <select
                    value={selected.leaseType}
                    onChange={(e) => updateSelected({ leaseType: e.target.value as SurveyLeaseType })}
                    className="input-premium mt-1 !py-2"
                  >
                    <option value="Unknown">Unknown</option>
                    <option value="NNN">NNN</option>
                    <option value="Gross">Gross</option>
                    <option value="Modified Gross">Modified Gross</option>
                    <option value="Base Year">Base Year</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Parking Spaces
                  <input
                    type="number"
                    value={asNumber(selected.parkingSpaces)}
                    onChange={(e) => updateSelected({ parkingSpaces: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Parking Rate (Monthly)
                  <input
                    type="number"
                    step="0.01"
                    value={asNumber(selected.parkingRateMonthlyPerSpace)}
                    onChange={(e) => updateSelected({ parkingRateMonthlyPerSpace: Math.max(0, Number(e.target.value) || 0) })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Sublessor
                  <input
                    type="text"
                    value={selected.sublessor}
                    onChange={(e) => updateSelected({ sublessor: e.target.value })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Sublease Expiration
                  <input
                    type="date"
                    value={selected.subleaseExpirationDate}
                    onChange={(e) => updateSelected({ subleaseExpirationDate: e.target.value })}
                    className="input-premium mt-1 !py-2"
                  />
                </label>
              </div>
              <label className="text-xs text-slate-400 block">
                Notes
                <textarea
                  value={selected.notes}
                  onChange={(e) => updateSelected({ notes: e.target.value })}
                  rows={3}
                  className="input-premium mt-1 w-full !py-2"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={!selected.needsReview}
                  onChange={(e) => updateSelected({ needsReview: !e.target.checked })}
                />
                Mark as ready for client view
              </label>
            </div>
          )}
        </PlatformPanel>

        <PlatformPanel kicker="Costing" title="Monthly Occupancy Cost" className="lg:col-span-7">
          {!selected || !selectedCost ? (
            <p className="text-sm text-slate-400">Select an entry to view monthly occupancy costs.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Base Rent / Month</p>
                  <p className="text-lg text-white">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(selectedCost.baseRentMonthly)}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">OpEx / Month</p>
                  <p className="text-lg text-white">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(selectedCost.opexMonthly)}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Parking / Month</p>
                  <p className="text-lg text-white">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(selectedCost.parkingMonthly)}</p>
                </div>
                <div className="border border-cyan-400/30 bg-cyan-500/10 p-2">
                  <p className="text-xs text-cyan-100">Total Occupancy / Month</p>
                  <p className="text-lg text-cyan-100">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(selectedCost.totalMonthly)}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">{selectedCost.leaseTypeRule}</p>
              {selected.needsReview ? (
                <div className="border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-100 uppercase tracking-[0.08em] mb-1">Review Required</p>
                  <ul className="text-xs text-amber-100/90 space-y-1">
                    {selected.reviewReasons.length > 0 ? (
                      selected.reviewReasons.map((reason, idx) => <li key={`${reason}-${idx}`}>• {reason}</li>)
                    ) : (
                      <li>• Confirm extracted terms before client delivery.</li>
                    )}
                  </ul>
                </div>
              ) : null}
              <div className="border border-white/10 bg-black/20 p-3">
                <p className="text-xs text-slate-400">Source file</p>
                <p className="text-sm text-white">{selected.sourceDocumentName}</p>
                <p className="text-xs text-slate-400 mt-1">Uploaded {formatIsoDate(selected.uploadedAtIso.slice(0, 10))}</p>
              </div>
            </div>
          )}
        </PlatformPanel>
      </div>
    </PlatformSection>
  );
}
