"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrmBuilding, CrmCompany } from "@/lib/workspace/crm";
import type { LandlordStackingPlanBuildingRow, LandlordStackingPlanSuiteCell } from "@/lib/workspace/representation-selectors";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string): string {
  const raw = asText(value);
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw;
  return parsed.toLocaleDateString();
}

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, value || 0));
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function statusTone(status: LandlordStackingPlanSuiteCell["status"]): string {
  if (status === "occupied") return "border-emerald-300/50 bg-emerald-500/15 text-emerald-50";
  if (status === "expiring") return "border-orange-300/60 bg-orange-500/15 text-orange-50";
  if (status === "proposal_active") return "border-cyan-300/60 bg-cyan-500/15 text-cyan-50";
  if (status === "toured") return "border-indigo-300/60 bg-indigo-500/15 text-indigo-50";
  return "border-white/20 bg-white/[0.06] text-slate-100";
}

function sourceLabel(source: LandlordStackingPlanSuiteCell["source"]): string {
  if (source === "current_sublease") return "Current sublease";
  if (source === "current_lease") return "Current lease";
  if (source === "occupancy_attachment") return "Manual attachment";
  if (source === "space_seed") return "Building shell";
  return "Manual";
}

type DraftState = {
  id: string;
  floor: string;
  suite: string;
  rsf: string;
  companyId: string;
  tenantName: string;
  leaseStart: string;
  leaseExpiration: string;
  noticeDeadline: string;
  rentType: string;
  baseRent: string;
  opex: string;
  abatementMonths: string;
  tiAllowance: string;
  concessions: string;
  landlordName: string;
  occupancyState: "vacant" | "occupied";
};

function makeDraftFromSuite(suite: LandlordStackingPlanSuiteCell | null | undefined): DraftState {
  return {
    id: suite?.id || "",
    floor: suite?.floor || "",
    suite: suite?.suite || "",
    rsf: suite?.rsf ? String(suite.rsf) : "",
    companyId: suite?.companyId || "",
    tenantName: suite?.companyName || "",
    leaseStart: suite?.leaseStart || "",
    leaseExpiration: suite?.expirationDate || "",
    noticeDeadline: suite?.noticeDeadline || "",
    rentType: suite?.rentType || "",
    baseRent: suite?.baseRent ? String(suite.baseRent) : "",
    opex: suite?.opex ? String(suite.opex) : "",
    abatementMonths: suite?.abatementMonths ? String(suite.abatementMonths) : "",
    tiAllowance: suite?.tiAllowance ? String(suite.tiAllowance) : "",
    concessions: suite?.concessions || "",
    landlordName: suite?.landlordName || "",
    occupancyState: suite && (suite.occupied || suite.companyName) ? "occupied" : "vacant",
  };
}

export function CrmBuildingStackingPlan({
  building,
  row,
  companies,
  onSaveEntry,
}: {
  building: CrmBuilding;
  row: LandlordStackingPlanBuildingRow | null;
  companies: CrmCompany[];
  onSaveEntry: (payload: {
    id?: string;
    buildingId: string;
    floor: string;
    suite: string;
    rsf: number;
    companyId: string;
    tenantName: string;
    leaseStart: string;
    leaseExpiration: string;
    noticeDeadline: string;
    rentType: string;
    baseRent: number;
    opex: number;
    abatementMonths: number;
    tiAllowance: number;
    concessions: string;
    landlordName: string;
  }) => void;
}) {
  const suites = useMemo(() => row?.floors.flatMap((floor) => floor.suites) || [], [row]);
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [draft, setDraft] = useState<DraftState>(() => makeDraftFromSuite(suites[0] || null));

  useEffect(() => {
    const defaultSuite = suites[0] || null;
    setSelectedSuiteId(defaultSuite?.id || "");
    setDraft(makeDraftFromSuite(defaultSuite));
  }, [building.id]);

  useEffect(() => {
    if (!selectedSuiteId) return;
    if (suites.some((suite) => suite.id === selectedSuiteId)) return;
    const fallbackSuite = suites[0] || null;
    setSelectedSuiteId(fallbackSuite?.id || "");
    setDraft(makeDraftFromSuite(fallbackSuite));
  }, [selectedSuiteId, suites]);

  useEffect(() => {
    if (selectedSuiteId || suites.length === 0) return;
    setSelectedSuiteId(suites[0].id);
    setDraft(makeDraftFromSuite(suites[0]));
  }, [selectedSuiteId, suites]);

  const selectedSuite = useMemo(
    () => suites.find((suite) => suite.id === selectedSuiteId) || null,
    [selectedSuiteId, suites],
  );
  const totalRsf = useMemo(
    () => Math.max(suites.reduce((sum, suite) => sum + Math.max(suite.rsf, 0), 0), 1),
    [suites],
  );
  const floorOptions = useMemo(
    () => Array.from(new Set((row?.floors || []).map((floor) => floor.floor))).sort((left, right) => Number(right) - Number(left) || right.localeCompare(left)),
    [row],
  );

  const handleSelectSuite = (suite: LandlordStackingPlanSuiteCell) => {
    setSelectedSuiteId(suite.id);
    setDraft(makeDraftFromSuite(suite));
  };

  const handleNewSuite = (floor = floorOptions[0] || "1") => {
    setSelectedSuiteId("");
    setDraft({
      ...makeDraftFromSuite(null),
      floor,
      landlordName: building.ownerName || "",
    });
  };

  const handleNewFloor = () => {
    const highestFloor = floorOptions
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0] || 0;
    handleNewSuite(String(highestFloor + 1));
  };

  const handleSave = () => {
    const suiteName = asText(draft.suite);
    const floor = asText(draft.floor);
    if (!suiteName || !floor) return;
    const isVacant = draft.occupancyState === "vacant";
    onSaveEntry({
      id: draft.id || undefined,
      buildingId: building.id,
      floor,
      suite: suiteName,
      rsf: asNumber(draft.rsf),
      companyId: isVacant ? "" : asText(draft.companyId),
      tenantName: isVacant ? "" : asText(draft.tenantName),
      leaseStart: isVacant ? "" : asText(draft.leaseStart),
      leaseExpiration: isVacant ? "" : asText(draft.leaseExpiration),
      noticeDeadline: isVacant ? "" : asText(draft.noticeDeadline),
      rentType: isVacant ? "" : asText(draft.rentType),
      baseRent: isVacant ? 0 : asNumber(draft.baseRent),
      opex: isVacant ? 0 : asNumber(draft.opex),
      abatementMonths: isVacant ? 0 : asNumber(draft.abatementMonths),
      tiAllowance: isVacant ? 0 : asNumber(draft.tiAllowance),
      concessions: isVacant ? "" : asText(draft.concessions),
      landlordName: asText(draft.landlordName) || building.ownerName || "",
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="xl:col-span-8 border border-white/15 bg-[linear-gradient(180deg,rgba(14,24,39,0.62),rgba(8,10,17,0.92))] p-4">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="heading-kicker">Building Stacking Plan</p>
            <h3 className="mt-2 text-xl font-semibold text-white">{building.name}</h3>
            <p className="mt-1 text-sm text-slate-400">{[building.address, building.submarket, building.market].filter(Boolean).join(" / ")}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-300">
            <button type="button" className="btn-premium" onClick={() => handleNewSuite()}>Add Suite</button>
            <button type="button" className="btn-premium" onClick={handleNewFloor}>Add Floor</button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
          <div className="border border-white/10 bg-black/25 p-3"><p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Floors</p><p className="mt-1 text-lg text-white">{row?.floors.length || 0}</p></div>
          <div className="border border-white/10 bg-black/25 p-3"><p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Suites</p><p className="mt-1 text-lg text-white">{suites.length}</p></div>
          <div className="border border-white/10 bg-black/25 p-3"><p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Occupied</p><p className="mt-1 text-lg text-white">{row?.summary.occupied || 0}</p></div>
          <div className="border border-white/10 bg-black/25 p-3"><p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Vacant</p><p className="mt-1 text-lg text-white">{row?.summary.vacant || 0}</p></div>
          <div className="border border-white/10 bg-black/25 p-3"><p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Tracked RSF</p><p className="mt-1 text-lg text-white">{formatInt(totalRsf)}</p></div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.12em] text-slate-300">
          <span className="border border-emerald-300/40 bg-emerald-500/10 px-2 py-1">Occupied</span>
          <span className="border border-orange-300/40 bg-orange-500/10 px-2 py-1">Expiring</span>
          <span className="border border-cyan-300/40 bg-cyan-500/10 px-2 py-1">Proposal Active</span>
          <span className="border border-indigo-300/40 bg-indigo-500/10 px-2 py-1">Toured</span>
          <span className="border border-white/20 bg-white/5 px-2 py-1">Vacant / shell</span>
        </div>

        <div className="mt-5 space-y-3">
          {(row?.floors || []).map((floorGroup) => (
            <div key={floorGroup.floor} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 border border-white/10 bg-black/20 p-3">
              <div className="flex min-h-[74px] items-center justify-center border border-white/10 bg-black/30 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Floor</p>
                  <p className="mt-1 text-lg font-semibold text-white">{floorGroup.floor}</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <div className="flex min-h-[74px] flex-wrap gap-2">
                  {floorGroup.suites.map((suite) => {
                    const basis = Math.max(110, Math.min(320, (suite.rsf / totalRsf) * 1200));
                    const active = suite.id === selectedSuiteId;
                    return (
                      <button
                        key={suite.id}
                        type="button"
                        onClick={() => handleSelectSuite(suite)}
                        className={`relative min-h-[74px] flex-1 border p-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:-translate-y-px hover:border-cyan-300/40 ${statusTone(suite.status)} ${active ? "ring-1 ring-cyan-300/60" : ""}`}
                        style={{ flexBasis: `${basis}px` }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.14em] opacity-75">Suite {suite.suite}</p>
                            <p className="mt-1 text-sm font-medium">{suite.companyName || "Vacant"}</p>
                          </div>
                          <span className="text-[10px] uppercase tracking-[0.12em] opacity-80">{sourceLabel(suite.source)}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] opacity-80">
                          <span>{formatInt(suite.rsf)} RSF</span>
                          <span>{suite.expirationDate ? `Exp ${formatDate(suite.expirationDate)}` : "Open block"}</span>
                          {suite.proposalCount > 0 ? <span>{suite.proposalCount} proposal{suite.proposalCount === 1 ? "" : "s"}</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          {(row?.floors.length || 0) === 0 ? (
            <div className="border border-dashed border-white/15 bg-black/20 p-6 text-center text-sm text-slate-400">
              No stack plan rows yet for this building. Add the first suite or upload a current lease or sublease to seed it.
            </div>
          ) : null}
        </div>
      </div>

      <div className="xl:col-span-4 border border-white/15 bg-black/20 p-4">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <p className="heading-kicker">Edit Stack Entry</p>
            <p className="mt-2 text-sm text-slate-400">{selectedSuite ? `${selectedSuite.floor} / ${selectedSuite.suite}` : "Create a new suite block or edit the selected suite."}</p>
          </div>
          {selectedSuite ? <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${statusTone(selectedSuite.status)}`}>{selectedSuite.status.replace(/_/g, " ")}</span> : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="block text-xs text-slate-400">
            Floor
            <input className="input-premium mt-1 !py-2" value={draft.floor} onChange={(event) => setDraft((prev) => ({ ...prev, floor: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Suite
            <input className="input-premium mt-1 !py-2" value={draft.suite} onChange={(event) => setDraft((prev) => ({ ...prev, suite: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            RSF
            <input className="input-premium mt-1 !py-2" inputMode="numeric" value={draft.rsf} onChange={(event) => setDraft((prev) => ({ ...prev, rsf: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Occupancy
            <select className="input-premium mt-1 !py-2" value={draft.occupancyState} onChange={(event) => setDraft((prev) => ({ ...prev, occupancyState: event.target.value as DraftState["occupancyState"] }))}>
              <option value="occupied">Occupied / leased</option>
              <option value="vacant">Vacant</option>
            </select>
          </label>
          <label className="col-span-2 block text-xs text-slate-400">
            Tenant profile
            <select
              className="input-premium mt-1 !py-2"
              value={draft.companyId}
              onChange={(event) => {
                const nextCompanyId = event.target.value;
                const matched = companies.find((company) => company.id === nextCompanyId);
                setDraft((prev) => ({
                  ...prev,
                  companyId: nextCompanyId,
                  tenantName: matched?.name || prev.tenantName,
                }));
              }}
            >
              <option value="">No linked tenant profile</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block text-xs text-slate-400">
            Tenant label
            <input className="input-premium mt-1 !py-2" value={draft.tenantName} onChange={(event) => setDraft((prev) => ({ ...prev, tenantName: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Lease start
            <input type="date" className="input-premium mt-1 !py-2" value={draft.leaseStart} onChange={(event) => setDraft((prev) => ({ ...prev, leaseStart: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Lease expiration
            <input type="date" className="input-premium mt-1 !py-2" value={draft.leaseExpiration} onChange={(event) => setDraft((prev) => ({ ...prev, leaseExpiration: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Notice
            <input type="date" className="input-premium mt-1 !py-2" value={draft.noticeDeadline} onChange={(event) => setDraft((prev) => ({ ...prev, noticeDeadline: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Rent type
            <input className="input-premium mt-1 !py-2" value={draft.rentType} onChange={(event) => setDraft((prev) => ({ ...prev, rentType: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Base rent
            <input className="input-premium mt-1 !py-2" inputMode="decimal" value={draft.baseRent} onChange={(event) => setDraft((prev) => ({ ...prev, baseRent: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            OpEx
            <input className="input-premium mt-1 !py-2" inputMode="decimal" value={draft.opex} onChange={(event) => setDraft((prev) => ({ ...prev, opex: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            Free rent (months)
            <input className="input-premium mt-1 !py-2" inputMode="numeric" value={draft.abatementMonths} onChange={(event) => setDraft((prev) => ({ ...prev, abatementMonths: event.target.value }))} />
          </label>
          <label className="block text-xs text-slate-400">
            TI allowance
            <input className="input-premium mt-1 !py-2" inputMode="decimal" value={draft.tiAllowance} onChange={(event) => setDraft((prev) => ({ ...prev, tiAllowance: event.target.value }))} />
          </label>
          <label className="col-span-2 block text-xs text-slate-400">
            Landlord / owner
            <input className="input-premium mt-1 !py-2" value={draft.landlordName} onChange={(event) => setDraft((prev) => ({ ...prev, landlordName: event.target.value }))} />
          </label>
          <label className="col-span-2 block text-xs text-slate-400">
            Concessions / notes
            <textarea className="input-premium mt-1 min-h-[100px]" value={draft.concessions} onChange={(event) => setDraft((prev) => ({ ...prev, concessions: event.target.value }))} />
          </label>
        </div>

        {selectedSuite ? (
          <div className="mt-4 border border-white/10 bg-black/25 p-3 text-xs text-slate-300">
            <p className="heading-kicker mb-2">Current record</p>
            <p>Source: <span className="text-white">{sourceLabel(selectedSuite.source)}</span></p>
            <p className="mt-1">Rate: <span className="text-white">{formatCurrency(selectedSuite.baseRent)}</span> · OpEx <span className="text-white">{formatCurrency(selectedSuite.opex)}</span></p>
            <p className="mt-1">Docs linked: <span className="text-white">{selectedSuite.sourceDocumentIds.length}</span></p>
          </div>
        ) : null}

        <button type="button" className="btn-premium btn-premium-primary mt-4 w-full" onClick={handleSave}>
          Save Stacking Plan Entry
        </button>
      </div>
    </div>
  );
}
