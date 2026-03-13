"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { PlatformPanel, PlatformSection } from "@/components/platform/PlatformShell";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { ClientDocumentPicker } from "@/components/workspace/ClientDocumentPicker";
import type { ClientWorkspaceDeal, DealsViewMode } from "@/lib/workspace/types";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(value: string): string {
  const raw = asText(value);
  if (!raw) return "-";
  const dt = new Date(raw);
  if (!Number.isFinite(dt.getTime())) return raw;
  return dt.toLocaleDateString();
}

function formatDateTime(value: string): string {
  const raw = asText(value);
  if (!raw) return "-";
  const dt = new Date(raw);
  if (!Number.isFinite(dt.getTime())) return raw;
  return dt.toLocaleString();
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function dealSortByRecent(left: ClientWorkspaceDeal, right: ClientWorkspaceDeal): number {
  return asText(right.updatedAt).localeCompare(asText(left.updatedAt));
}

function stageCountMap(deals: ClientWorkspaceDeal[], stages: string[]): Map<string, number> {
  const counts = new Map<string, number>(stages.map((stage) => [stage, 0]));
  for (const deal of deals) {
    const stage = asText(deal.stage) || stages[0];
    counts.set(stage, (counts.get(stage) || 0) + 1);
  }
  return counts;
}

function budgetForOpenDeals(deals: ClientWorkspaceDeal[]): number {
  return deals
    .filter((deal) => deal.status === "open" || deal.status === "on_hold")
    .reduce((sum, deal) => sum + asNumber(deal.budget), 0);
}

function statusBadgeClass(status: ClientWorkspaceDeal["status"]): string {
  if (status === "won") return "border-emerald-300/50 text-emerald-200 bg-emerald-400/10";
  if (status === "lost") return "border-rose-300/50 text-rose-200 bg-rose-400/10";
  if (status === "on_hold") return "border-amber-300/50 text-amber-100 bg-amber-400/10";
  return "border-cyan-300/50 text-cyan-100 bg-cyan-400/10";
}

function priorityBadgeClass(priority: ClientWorkspaceDeal["priority"]): string {
  if (priority === "critical") return "border-red-300/60 text-red-200 bg-red-500/15";
  if (priority === "high") return "border-orange-300/60 text-orange-200 bg-orange-500/15";
  if (priority === "medium") return "border-indigo-300/50 text-indigo-200 bg-indigo-500/15";
  return "border-slate-300/50 text-slate-300 bg-slate-500/10";
}

interface DealsWorkspaceProps {
  clientId: string;
  clientName?: string | null;
}

export function DealsWorkspace({ clientId, clientName }: DealsWorkspaceProps) {
  const {
    deals,
    dealStages,
    crmSettings,
    documents,
    representationMode,
    createDeal,
    updateDeal,
    removeDeal,
    updateDocument,
  } = useClientWorkspace();
  const isLandlordMode = representationMode === LANDLORD_REP_MODE;
  const [view, setView] = useState<DealsViewMode>(() => crmSettings.defaultDealsView);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [draggingDealId, setDraggingDealId] = useState("");
  const [dragOverStage, setDragOverStage] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [form, setForm] = useState({
    dealName: "",
    requirementName: "",
    dealType: "Tenant Rep",
    stage: dealStages[0] || "New Lead",
    status: "open" as ClientWorkspaceDeal["status"],
    priority: "medium" as ClientWorkspaceDeal["priority"],
    targetMarket: "",
    submarket: "",
    city: "",
    squareFootageMin: "",
    squareFootageMax: "",
    budget: "",
    occupancyDateGoal: "",
    expirationDate: "",
    selectedProperty: "",
    selectedSuite: "",
    selectedLandlord: "",
    tenantRepBroker: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("No active deals for this client yet.");

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      stage: dealStages.includes(prev.stage) ? prev.stage : dealStages[0] || "New Lead",
    }));
  }, [dealStages]);

  useEffect(() => {
    setForm((prev) => {
      if (prev.dealType !== "Tenant Rep" && prev.dealType !== "Landlord Rep") return prev;
      return {
        ...prev,
        dealType: isLandlordMode ? "Landlord Rep" : "Tenant Rep",
      };
    });
  }, [isLandlordMode]);

  useEffect(() => {
    setView(crmSettings.defaultDealsView);
  }, [clientId, crmSettings.defaultDealsView]);

  const sortedDeals = useMemo(() => [...deals].sort(dealSortByRecent), [deals]);
  const filteredDeals = useMemo(() => {
    const needle = asText(pipelineQuery).toLowerCase();
    if (!needle) return sortedDeals;
    return sortedDeals.filter((deal) => {
      const haystack = [
        deal.dealName,
        deal.requirementName,
        deal.city,
        deal.submarket,
        deal.targetMarket,
        deal.selectedProperty,
        deal.selectedSuite,
        deal.selectedLandlord,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [pipelineQuery, sortedDeals]);

  const selectedDeal = useMemo(
    () => sortedDeals.find((deal) => deal.id === selectedDealId) || sortedDeals[0] || null,
    [sortedDeals, selectedDealId],
  );

  const countsByStage = useMemo(() => stageCountMap(sortedDeals, dealStages), [sortedDeals, dealStages]);

  const linkedDocumentMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const deal of sortedDeals) {
      const linked = Array.from(
        new Set([
          ...deal.linkedDocumentIds,
          ...documents.filter((doc) => doc.dealId === deal.id).map((doc) => doc.id),
        ]),
      );
      map.set(deal.id, linked);
    }
    return map;
  }, [sortedDeals, documents]);

  const boardGridStyle = useMemo(
    () =>
      ({
        "--stage-count": String(Math.max(dealStages.length, 1)),
      }) as CSSProperties,
    [dealStages.length],
  );

  const stageOrder = useMemo(
    () => new Map<string, number>(dealStages.map((stage, index) => [stage, index])),
    [dealStages],
  );

  const pipelineMetrics = useMemo(
    () => ({
      total: sortedDeals.length,
      open: sortedDeals.filter((deal) => deal.status === "open").length,
      won: sortedDeals.filter((deal) => deal.status === "won" || asText(deal.stage).toLowerCase() === "executed").length,
      pipelineValue: budgetForOpenDeals(sortedDeals),
    }),
    [sortedDeals],
  );

  const createDealFromForm = useCallback(() => {
    if (!asText(form.dealName)) {
      setError("Deal name is required.");
      return;
    }
    const created = createDeal({
      clientId,
      dealName: form.dealName,
      requirementName: form.requirementName,
      dealType: form.dealType,
      stage: form.stage,
      status: form.status,
      priority: form.priority,
      targetMarket: form.targetMarket,
      submarket: form.submarket,
      city: form.city,
      squareFootageMin: asNumber(form.squareFootageMin),
      squareFootageMax: asNumber(form.squareFootageMax),
      budget: asNumber(form.budget),
      occupancyDateGoal: form.occupancyDateGoal,
      expirationDate: form.expirationDate,
      selectedProperty: form.selectedProperty,
      selectedSuite: form.selectedSuite,
      selectedLandlord: form.selectedLandlord,
      tenantRepBroker: form.tenantRepBroker,
      notes: form.notes,
    });
    if (!created) {
      setError("Unable to create deal.");
      return;
    }
    setError("");
    setStatus(`Created deal ${created.dealName}.`);
    setSelectedDealId(created.id);
    setForm((prev) => ({
      ...prev,
      dealName: "",
      requirementName: "",
      targetMarket: "",
      submarket: "",
      city: "",
      squareFootageMin: "",
      squareFootageMax: "",
      budget: "",
      occupancyDateGoal: "",
      expirationDate: "",
      selectedProperty: "",
      selectedSuite: "",
      selectedLandlord: "",
      notes: "",
    }));
  }, [clientId, createDeal, form]);

  const moveDealToStage = useCallback(
    (deal: ClientWorkspaceDeal, nextStage: string, sourceLabel: string) => {
      const target = asText(nextStage);
      if (!target || target === deal.stage) return;
      const nowIso = new Date().toISOString();
      const nextStatus: ClientWorkspaceDeal["status"] =
        asText(target).toLowerCase() === "executed"
          ? "won"
          : (deal.status === "won" && asText(deal.stage).toLowerCase() === "executed" ? "open" : deal.status);
      const timelineEntry = {
        id: makeId("deal_activity"),
        clientId: deal.clientId,
        dealId: deal.id,
        label: "Stage moved",
        description: `${deal.stage} -> ${target} via ${sourceLabel}`,
        createdAt: nowIso,
      };
      updateDeal(deal.id, {
        stage: target,
        status: nextStatus,
        timeline: [timelineEntry, ...deal.timeline].slice(0, 100),
      });
      setStatus(`Moved ${deal.dealName} to ${target}.`);
    },
    [updateDeal],
  );

  const handleDropToStage = useCallback(
    (stage: string) => {
      const draggedDeal = sortedDeals.find((deal) => deal.id === draggingDealId);
      setDragOverStage("");
      setDraggingDealId("");
      if (!draggedDeal) return;
      moveDealToStage(draggedDeal, stage, "drag and drop");
      setSelectedDealId(draggedDeal.id);
    },
    [draggingDealId, moveDealToStage, sortedDeals],
  );

  const addTaskToSelectedDeal = useCallback(() => {
    if (!selectedDeal) return;
    const title = asText(taskDraft);
    if (!title) return;
    const nowIso = new Date().toISOString();
    const nextTask = {
      id: makeId("deal_task"),
      clientId: selectedDeal.clientId,
      dealId: selectedDeal.id,
      title,
      dueDate: "",
      completed: false,
      createdAt: nowIso,
    };
    updateDeal(selectedDeal.id, {
      tasks: [nextTask, ...selectedDeal.tasks].slice(0, 100),
      timeline: [
        {
          id: makeId("deal_activity"),
          clientId: selectedDeal.clientId,
          dealId: selectedDeal.id,
          label: "Task added",
          description: title,
          createdAt: nowIso,
        },
        ...selectedDeal.timeline,
      ].slice(0, 100),
    });
    setTaskDraft("");
  }, [selectedDeal, taskDraft, updateDeal]);

  return (
    <PlatformSection
      kicker="Deals"
      title={isLandlordMode ? "Landlord Representation Deal Operating System" : "Tenant Representation Deal Operating System"}
      description={
        isLandlordMode
          ? "Operate inquiry-to-execution listing pipeline: track tours, proposals, negotiation, lease drafting, and executed deals."
          : "Operate your client pipeline like a CRM: drag deals across stages, attach documents, and let AI auto-advance stages when classified documents arrive."
      }
      maxWidthClassName="max-w-[96vw]"
      headerAlign="center"
      actions={
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className={`btn-premium ${view === "board" ? "btn-premium-primary" : "btn-premium-secondary"}`}
            onClick={() => setView("board")}
          >
            Pipeline
          </button>
          <button
            type="button"
            className={`btn-premium ${view === "table" ? "btn-premium-primary" : "btn-premium-secondary"}`}
            onClick={() => setView("table")}
          >
            Table
          </button>
          <button
            type="button"
            className={`btn-premium ${view === "timeline" ? "btn-premium-primary" : "btn-premium-secondary"}`}
            onClick={() => setView("timeline")}
          >
            Timeline
          </button>
          <button
            type="button"
            className={`btn-premium ${view === "client_grouped" ? "btn-premium-primary" : "btn-premium-secondary"}`}
            onClick={() => setView("client_grouped")}
          >
            Client Grouped
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <PlatformPanel
          kicker="Pipeline Overview"
          title={`${asText(clientName) || "Active Client"} CRM Metrics`}
          className="xl:col-span-12"
        >
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="border border-white/15 bg-black/25 p-3">
              <p className="text-xs text-slate-400">Total deals</p>
              <p className="text-2xl text-white">{pipelineMetrics.total}</p>
            </div>
            <div className="border border-white/15 bg-black/25 p-3">
              <p className="text-xs text-slate-400">Open</p>
              <p className="text-2xl text-white">{pipelineMetrics.open}</p>
            </div>
            <div className="border border-white/15 bg-black/25 p-3">
              <p className="text-xs text-slate-400">Won</p>
              <p className="text-2xl text-white">{pipelineMetrics.won}</p>
            </div>
            <div className="border border-white/15 bg-black/25 p-3 col-span-2 lg:col-span-1">
              <p className="text-xs text-slate-400">Open pipeline value</p>
              <p className="text-2xl text-white">{formatCurrency(pipelineMetrics.pipelineValue)}</p>
            </div>
            <div className="border border-cyan-300/30 bg-cyan-500/5 p-3 col-span-2 lg:col-span-1">
              <p className="heading-kicker mb-1">AI stage assistant</p>
              <p className="text-xs text-slate-200">
                {isLandlordMode
                  ? "Deals auto-advance when listing documents are classified (proposal, LOI/counter, lease, amendment, marketing docs)."
                  : "Deals auto-advance when linked documents are classified (proposal, LOI, lease, amendment, analysis, survey)."}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              className="input-premium sm:max-w-md"
              placeholder="Search deals by name, market, property, city"
              value={pipelineQuery}
              onChange={(event) => setPipelineQuery(event.target.value)}
            />
            <p className="text-xs text-slate-400">Drag any deal card and drop into a stage column to move it.</p>
          </div>
        </PlatformPanel>

        <PlatformPanel kicker="Create Deal" title="Quick Intake" className="xl:col-span-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              className="input-premium sm:col-span-2"
              placeholder="Deal name*"
              value={form.dealName}
              onChange={(event) => setForm((prev) => ({ ...prev, dealName: event.target.value }))}
            />
            <input
              className="input-premium sm:col-span-2"
              placeholder={isLandlordMode ? "Listing / suite summary" : "Requirement name"}
              value={form.requirementName}
              onChange={(event) => setForm((prev) => ({ ...prev, requirementName: event.target.value }))}
            />
            <select
              className="input-premium"
              value={form.stage}
              onChange={(event) => setForm((prev) => ({ ...prev, stage: event.target.value }))}
            >
              {dealStages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
            <select
              className="input-premium"
              value={form.priority}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, priority: event.target.value as ClientWorkspaceDeal["priority"] }))
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <input
              className="input-premium"
              placeholder="City"
              value={form.city}
              onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
            />
            <input
              className="input-premium"
              placeholder="Target market"
              value={form.targetMarket}
              onChange={(event) => setForm((prev) => ({ ...prev, targetMarket: event.target.value }))}
            />
            <input
              className="input-premium"
              placeholder="Min SF"
              value={form.squareFootageMin}
              onChange={(event) => setForm((prev) => ({ ...prev, squareFootageMin: event.target.value }))}
            />
            <input
              className="input-premium"
              placeholder="Max SF"
              value={form.squareFootageMax}
              onChange={(event) => setForm((prev) => ({ ...prev, squareFootageMax: event.target.value }))}
            />
            <input
              className="input-premium sm:col-span-2"
              placeholder="Budget"
              value={form.budget}
              onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))}
            />
          </div>
          <details className="mt-3 border border-white/15 bg-black/20 p-2">
            <summary className="cursor-pointer text-xs text-slate-300 tracking-[0.12em] uppercase">Advanced Fields</summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <input
                className="input-premium"
                placeholder="Submarket"
                value={form.submarket}
                onChange={(event) => setForm((prev) => ({ ...prev, submarket: event.target.value }))}
              />
              <input
                className="input-premium"
                placeholder="Deal type"
                value={form.dealType}
                onChange={(event) => setForm((prev) => ({ ...prev, dealType: event.target.value }))}
              />
              <input
                className="input-premium"
                placeholder={isLandlordMode ? "Listing broker" : "Tenant rep broker"}
                value={form.tenantRepBroker}
                onChange={(event) => setForm((prev) => ({ ...prev, tenantRepBroker: event.target.value }))}
              />
              <input
                className="input-premium"
                placeholder="Selected property"
                value={form.selectedProperty}
                onChange={(event) => setForm((prev) => ({ ...prev, selectedProperty: event.target.value }))}
              />
              <input
                className="input-premium"
                placeholder="Selected suite"
                value={form.selectedSuite}
                onChange={(event) => setForm((prev) => ({ ...prev, selectedSuite: event.target.value }))}
              />
              <input
                className="input-premium"
                placeholder={isLandlordMode ? "Prospect / tenant" : "Selected landlord"}
                value={form.selectedLandlord}
                onChange={(event) => setForm((prev) => ({ ...prev, selectedLandlord: event.target.value }))}
              />
              <input
                type="date"
                className="input-premium"
                value={form.occupancyDateGoal}
                onChange={(event) => setForm((prev) => ({ ...prev, occupancyDateGoal: event.target.value }))}
              />
              <input
                type="date"
                className="input-premium"
                value={form.expirationDate}
                onChange={(event) => setForm((prev) => ({ ...prev, expirationDate: event.target.value }))}
              />
              <textarea
                className="input-premium sm:col-span-2 min-h-[70px]"
                placeholder="Notes"
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
          </details>
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-premium btn-premium-primary" onClick={createDealFromForm}>
              Create Deal
            </button>
          </div>
          <div className="mt-4 border-t border-white/15 pt-3">
            <p className="heading-kicker mb-2">Stage Settings</p>
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
              <p className="text-xs text-slate-300">
                Stage order, default CRM view, and document-driven automation are managed in Account Settings, inside CRM Settings.
              </p>
              <a href="/account?section=settings&settings=crm" className="btn-premium btn-premium-secondary w-full sm:w-auto text-center">
                Open Settings
              </a>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">{status}</p>
          {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
        </PlatformPanel>

        <PlatformPanel
          kicker="CRM Views"
          title={`${asText(clientName) || "Active Client"} Pipeline`}
          className="xl:col-span-12"
        >
          {view === "board" ? (
            <div>
              <div className="overflow-x-auto">
                <div
                  className="grid gap-3 pb-2 [grid-template-columns:repeat(var(--stage-count),minmax(220px,1fr))]"
                  style={boardGridStyle}
                >
                  {dealStages.map((stage) => {
                    const stageDeals = filteredDeals.filter((deal) => asText(deal.stage) === stage);
                    const isDropActive = dragOverStage === stage;
                    return (
                      <div
                        key={stage}
                        className={`min-h-[420px] border p-3 transition-colors ${
                          isDropActive ? "border-cyan-300 bg-cyan-500/10" : "border-white/15 bg-black/20"
                        }`}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          setDragOverStage(stage);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDragOverStage(stage);
                        }}
                        onDragLeave={(event) => {
                          event.preventDefault();
                          if (dragOverStage === stage) setDragOverStage("");
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDropToStage(stage);
                        }}
                      >
                        <div className="mb-3 flex items-center justify-between border-b border-white/15 pb-2">
                          <p className="text-sm text-white">{stage}</p>
                          <span className="text-xs text-slate-300">{countsByStage.get(stage) || 0}</span>
                        </div>
                        <div className="space-y-2">
                          {stageDeals.length === 0 ? (
                            <p className="text-xs text-slate-500">Drop a deal here.</p>
                          ) : (
                            stageDeals.map((deal) => {
                              const linkedDocs = linkedDocumentMap.get(deal.id) || [];
                              const stageIndex = stageOrder.get(deal.stage) ?? 0;
                              const previousStage = dealStages[Math.max(0, stageIndex - 1)] || "";
                              const nextStage = dealStages[Math.min(dealStages.length - 1, stageIndex + 1)] || "";
                              return (
                                <div
                                  key={deal.id}
                                  draggable
                                  onDragStart={() => {
                                    setDraggingDealId(deal.id);
                                    setSelectedDealId(deal.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggingDealId("");
                                    setDragOverStage("");
                                  }}
                                  className={`cursor-grab border p-2 transition-colors active:cursor-grabbing ${
                                    selectedDeal?.id === deal.id
                                      ? "border-cyan-300 bg-cyan-500/15"
                                      : "border-white/20 bg-black/30 hover:bg-white/5"
                                  } ${draggingDealId === deal.id ? "opacity-60" : "opacity-100"}`}
                                  onClick={() => setSelectedDealId(deal.id)}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm text-white leading-5">{deal.dealName}</p>
                                    <span className={`border px-1 py-[2px] text-[10px] uppercase tracking-[0.12em] ${priorityBadgeClass(deal.priority)}`}>
                                      {deal.priority}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-300 mt-1">{deal.requirementName || "No requirement summary"}</p>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    <span className={`border px-1 py-[2px] text-[10px] uppercase tracking-[0.12em] ${statusBadgeClass(deal.status)}`}>
                                      {deal.status.replace("_", " ")}
                                    </span>
                                    <span className="border border-white/20 px-1 py-[2px] text-[10px] text-slate-300">
                                      Docs {linkedDocs.length}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-[11px] text-slate-400">
                                    {[deal.city, deal.submarket].filter(Boolean).join(" - ") || "Location pending"}
                                  </p>
                                  <p className="text-[11px] text-slate-400">
                                    {deal.squareFootageMin || 0}-{deal.squareFootageMax || 0} SF | {formatCurrency(deal.budget)}
                                  </p>
                                  <div className="mt-2 flex items-center justify-between">
                                    <button
                                      type="button"
                                      className="border border-white/25 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-slate-200 disabled:opacity-30"
                                      disabled={!previousStage || previousStage === deal.stage}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (previousStage) moveDealToStage(deal, previousStage, "quick back");
                                      }}
                                    >
                                      Back
                                    </button>
                                    <p className="text-[10px] text-slate-400">Updated {formatDate(deal.updatedAt)}</p>
                                    <button
                                      type="button"
                                      className="border border-white/25 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-slate-200 disabled:opacity-30"
                                      disabled={!nextStage || nextStage === deal.stage}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (nextStage) moveDealToStage(deal, nextStage, "quick advance");
                                      }}
                                    >
                                      Next
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 border border-white/20 bg-black/30 p-3">
                <div className="flex items-center justify-between border-b border-white/15 pb-2">
                  <p className="heading-kicker">Current Deals</p>
                  <span className="text-xs text-slate-300">{filteredDeals.length}</span>
                </div>
                {filteredDeals.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No deals in this workspace yet.</p>
                ) : (
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {filteredDeals.map((deal) => (
                      <div
                        key={`dock_${deal.id}`}
                        draggable
                        onDragStart={() => {
                          setDraggingDealId(deal.id);
                          setSelectedDealId(deal.id);
                        }}
                        onDragEnd={() => {
                          setDraggingDealId("");
                          setDragOverStage("");
                        }}
                        onClick={() => setSelectedDealId(deal.id)}
                        className={`cursor-grab border p-2 transition-colors active:cursor-grabbing ${
                          selectedDeal?.id === deal.id
                            ? "border-cyan-300 bg-cyan-500/15"
                            : "border-white/20 bg-black/35 hover:bg-white/5"
                        } ${draggingDealId === deal.id ? "opacity-60" : "opacity-100"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-white leading-5">{deal.dealName}</p>
                          <span className="border border-white/20 px-1 py-[2px] text-[10px] text-slate-300">
                            {deal.stage}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {[deal.city, deal.submarket].filter(Boolean).join(" - ") || "Location pending"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {view === "table" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Deal</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Stage</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Status</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Priority</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Location</th>
                    <th className="text-left py-2 pr-3 text-slate-300 font-medium">Budget</th>
                    <th className="text-left py-2 text-slate-300 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-slate-400">No deals match the current search.</td>
                    </tr>
                  ) : (
                    filteredDeals.map((deal) => (
                      <tr
                        key={deal.id}
                        className={`border-b border-white/10 cursor-pointer ${
                          selectedDeal?.id === deal.id ? "bg-cyan-500/10" : "hover:bg-white/5"
                        }`}
                        onClick={() => setSelectedDealId(deal.id)}
                      >
                        <td className="py-2 pr-3 text-white">{deal.dealName}</td>
                        <td className="py-2 pr-3 text-slate-200">{deal.stage}</td>
                        <td className="py-2 pr-3 text-slate-200">{deal.status.replace("_", " ")}</td>
                        <td className="py-2 pr-3 text-slate-200">{deal.priority}</td>
                        <td className="py-2 pr-3 text-slate-200">{[deal.city, deal.submarket].filter(Boolean).join(", ") || "-"}</td>
                        <td className="py-2 pr-3 text-slate-200">{formatCurrency(deal.budget)}</td>
                        <td className="py-2 text-slate-200">{formatDate(deal.updatedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {view === "timeline" ? (
            <div className="space-y-2">
              {filteredDeals.length === 0 ? (
                <p className="text-sm text-slate-400">No timeline entries yet.</p>
              ) : (
                filteredDeals.map((deal) => (
                  <button
                    key={deal.id}
                    type="button"
                    className={`w-full border px-3 py-3 text-left ${
                      selectedDeal?.id === deal.id
                        ? "border-cyan-300 bg-cyan-500/15"
                        : "border-white/20 bg-black/20 hover:bg-white/5"
                    }`}
                    onClick={() => setSelectedDealId(deal.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-white">{deal.dealName}</p>
                        <p className="text-xs text-slate-300 mt-1">{deal.stage} - {deal.status.replace("_", " ")}</p>
                        <p className="text-xs text-slate-400 mt-1">{deal.timeline[0]?.description || "No activity logged yet."}</p>
                      </div>
                      <p className="text-xs text-slate-400">{formatDate(deal.updatedAt)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}

          {view === "client_grouped" ? (
            <div className="border border-white/15 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Client Group</p>
              <h3 className="text-lg text-white mb-2">{asText(clientName) || "Active Client"}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <div className="border border-white/15 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Deals</p>
                  <p className="text-2xl text-white">{sortedDeals.length}</p>
                </div>
                <div className="border border-white/15 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Open</p>
                  <p className="text-2xl text-white">{sortedDeals.filter((deal) => deal.status === "open").length}</p>
                </div>
                <div className="border border-white/15 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">Executed</p>
                  <p className="text-2xl text-white">{sortedDeals.filter((deal) => asText(deal.stage) === "Executed").length}</p>
                </div>
                <div className="border border-white/15 bg-black/20 p-2">
                  <p className="text-xs text-slate-400">On Hold</p>
                  <p className="text-2xl text-white">{sortedDeals.filter((deal) => deal.status === "on_hold").length}</p>
                </div>
              </div>
            </div>
          ) : null}
        </PlatformPanel>

        <PlatformPanel
          kicker="Deal Detail"
          title={selectedDeal ? selectedDeal.dealName : "Select a deal"}
          className="xl:col-span-12"
        >
          {!selectedDeal ? (
            <p className="text-sm text-slate-400">Create a deal or select one from the CRM views.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  className="input-premium md:col-span-2"
                  value={selectedDeal.dealName}
                  onChange={(event) => updateDeal(selectedDeal.id, { dealName: event.target.value })}
                />
                <select
                  className="input-premium"
                  value={selectedDeal.stage}
                  onChange={(event) => moveDealToStage(selectedDeal, event.target.value, "manual update")}
                >
                  {dealStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
                <select
                  className="input-premium"
                  value={selectedDeal.status}
                  onChange={(event) =>
                    updateDeal(selectedDeal.id, { status: event.target.value as ClientWorkspaceDeal["status"] })
                  }
                >
                  <option value="open">Open</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="on_hold">On Hold</option>
                </select>
                <input
                  className="input-premium"
                  value={selectedDeal.targetMarket}
                  placeholder="Target market"
                  onChange={(event) => updateDeal(selectedDeal.id, { targetMarket: event.target.value })}
                />
                <input
                  className="input-premium"
                  value={selectedDeal.submarket}
                  placeholder="Submarket"
                  onChange={(event) => updateDeal(selectedDeal.id, { submarket: event.target.value })}
                />
                <input
                  className="input-premium"
                  value={selectedDeal.city}
                  placeholder="City"
                  onChange={(event) => updateDeal(selectedDeal.id, { city: event.target.value })}
                />
                <input
                  className="input-premium"
                  value={String(selectedDeal.budget || "")}
                  placeholder="Budget"
                  onChange={(event) => updateDeal(selectedDeal.id, { budget: asNumber(event.target.value) })}
                />
                <textarea
                  className="input-premium md:col-span-2 min-h-[72px]"
                  value={selectedDeal.notes}
                  placeholder="Notes"
                  onChange={(event) => updateDeal(selectedDeal.id, { notes: event.target.value })}
                />

                <div className="md:col-span-2 border border-white/15 bg-black/25 p-3">
                  <p className="heading-kicker mb-2">Tasks + Next Steps</p>
                  <div className="flex gap-2">
                    <input
                      className="input-premium"
                      placeholder="Add next step"
                      value={taskDraft}
                      onChange={(event) => setTaskDraft(event.target.value)}
                    />
                    <button type="button" className="btn-premium btn-premium-primary" onClick={addTaskToSelectedDeal}>
                      Add
                    </button>
                  </div>
                  <div className="mt-2 space-y-2 max-h-[180px] overflow-y-auto pr-1">
                    {selectedDeal.tasks.length === 0 ? (
                      <p className="text-xs text-slate-400">No tasks yet.</p>
                    ) : (
                      selectedDeal.tasks.map((task) => (
                        <label key={task.id} className="flex items-start gap-2 border border-white/15 bg-black/20 p-2">
                          <input
                            type="checkbox"
                            checked={Boolean(task.completed)}
                            onChange={(event) => {
                              const nextTasks = selectedDeal.tasks.map((item) =>
                                item.id === task.id ? { ...item, completed: event.target.checked } : item,
                              );
                              updateDeal(selectedDeal.id, { tasks: nextTasks });
                            }}
                          />
                          <span className={`text-xs ${task.completed ? "text-slate-500 line-through" : "text-slate-200"}`}>
                            {task.title}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div className="md:col-span-2 border border-white/15 bg-black/25 p-3">
                  <p className="heading-kicker mb-2">Activity Timeline</p>
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {selectedDeal.timeline.length === 0 ? (
                      <p className="text-xs text-slate-400">No activity yet.</p>
                    ) : (
                      selectedDeal.timeline.map((event) => (
                        <div key={event.id} className="border border-white/15 bg-black/20 p-2">
                          <p className="text-xs text-white">{event.label}</p>
                          <p className="text-xs text-slate-300 mt-1">{event.description}</p>
                          <p className="text-[11px] text-slate-500 mt-1">{formatDateTime(event.createdAt)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 border border-white/15 bg-black/20 p-3">
                <p className="heading-kicker mb-2">Linked Documents</p>
                <ClientDocumentPicker
                  buttonLabel="Attach Existing Document"
                  onSelectDocument={(document) => {
                    updateDeal(selectedDeal.id, {
                      linkedDocumentIds: Array.from(
                        new Set([...(linkedDocumentMap.get(selectedDeal.id) || []), document.id]),
                      ),
                    });
                    updateDocument(document.id, { dealId: selectedDeal.id });
                    setStatus(`Attached ${document.name} to ${selectedDeal.dealName}.`);
                  }}
                />
                <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {(linkedDocumentMap.get(selectedDeal.id) || []).length === 0 ? (
                    <p className="text-xs text-slate-400">No linked documents yet.</p>
                  ) : (
                    (linkedDocumentMap.get(selectedDeal.id) || []).map((documentId) => {
                      const doc = documents.find((item) => item.id === documentId);
                      if (!doc) return null;
                      return (
                        <div key={documentId} className="border border-white/15 bg-black/25 p-2">
                          <p className="text-xs text-white break-all">{doc.name}</p>
                          <p className="text-[11px] text-slate-400">{doc.type}</p>
                          <button
                            type="button"
                            className="mt-1 btn-premium btn-premium-danger text-[10px]"
                            onClick={() => {
                              updateDeal(selectedDeal.id, {
                                linkedDocumentIds: (linkedDocumentMap.get(selectedDeal.id) || []).filter((id) => id !== documentId),
                              });
                              updateDocument(documentId, { dealId: "" });
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="mt-3 border-t border-white/15 pt-3">
                  <button
                    type="button"
                    className="btn-premium btn-premium-danger w-full"
                    onClick={() => {
                      removeDeal(selectedDeal.id);
                      setSelectedDealId("");
                      setStatus(`Deleted deal ${selectedDeal.dealName}.`);
                    }}
                  >
                    Delete Deal
                  </button>
                </div>
              </div>
            </div>
          )}
        </PlatformPanel>
      </div>
    </PlatformSection>
  );
}
