"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import {
  PlatformDashboardTier,
  PlatformInsightCard,
  PlatformMetricCard,
  PlatformMetricStrip,
  PlatformPanel,
  PlatformSection,
} from "@/components/platform/PlatformShell";
import { CrmBuildingStackingPlan } from "@/components/deals/CrmBuildingStackingPlan";
import { CrmBuildingInsightCard } from "@/components/deals/CrmBuildingInsightCard";
import { CrmBuildingInventoryMap } from "@/components/deals/CrmBuildingInventoryMap";
import { ClientDocumentPicker } from "@/components/workspace/ClientDocumentPicker";
import { useBrokerOs } from "@/components/workspace/BrokerOsProvider";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { getBuildingRegistryEntry, hasCuratedBuildingPhoto } from "@/lib/building-photos";
import { fetchWorkspaceCloudSection, saveWorkspaceCloudSection } from "@/lib/workspace/cloud";
import { fetchSharedMarketInventory, type SharedMarketInventoryResponse } from "@/lib/workspace/market-inventory";
import {
  CRM_OS_STORAGE_KEY,
  buildCrmDashboard,
  buildCrmWorkspaceState,
  defaultCrmFilters,
  emptyCrmWorkspaceState,
  filterCrmBuildings,
  filterCrmCompanies,
  generateCrmOutreachDraft,
  type CrmBuilding,
  type CrmCompany,
  type CrmFilters,
  type CrmOccupancyRecord,
  type CrmReminder,
  type CrmStackingPlanEntry,
  type CrmTask,
  type CrmTouchpoint,
  type CrmWorkspaceState,
} from "@/lib/workspace/crm";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";
import { getRepresentationModeProfile } from "@/lib/workspace/representation-profile";
import {
  buildLandlordBuildingHubSummary,
  buildLandlordStackingPlan,
  buildModeAwareAiRecommendations,
  buildModeAwareDashboardCards,
  buildTenantCompanyHubSummary,
} from "@/lib/workspace/representation-selectors";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";
import type { ClientWorkspaceDeal, DealsViewMode } from "@/lib/workspace/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeText(value: unknown): string {
  return asText(value).toLowerCase();
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

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, value || 0));
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatDecimal(value: number, digits = 1): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function displayBuildingName(building: CrmBuilding): string {
  const registryEntry = getBuildingRegistryEntry(building);
  return asText(building.name) || registryEntry?.preferredName || asText(building.address) || "Unnamed building";
}

function buildingRegistryEntry(building: CrmBuilding) {
  return getBuildingRegistryEntry(building);
}

function hasPinnedBuildingPhoto(building: CrmBuilding): boolean {
  return hasCuratedBuildingPhoto(building);
}

type BuildingSortOption =
  | "featured"
  | "name_asc"
  | "rsf_desc"
  | "stories_desc"
  | "year_desc"
  | "submarket_asc";

function compareBuildings(left: CrmBuilding, right: CrmBuilding, sort: BuildingSortOption, selectedBuildingId: string | null): number {
  if (sort === "featured") {
    const leftSelected = left.id === selectedBuildingId ? 1 : 0;
    const rightSelected = right.id === selectedBuildingId ? 1 : 0;
    if (leftSelected !== rightSelected) return rightSelected - leftSelected;
    const leftPhoto = hasPinnedBuildingPhoto(left) ? 1 : 0;
    const rightPhoto = hasPinnedBuildingPhoto(right) ? 1 : 0;
    if (leftPhoto !== rightPhoto) return rightPhoto - leftPhoto;
    const leftClass = asText(left.buildingClass).toUpperCase() === "A" ? 1 : 0;
    const rightClass = asText(right.buildingClass).toUpperCase() === "A" ? 1 : 0;
    if (leftClass !== rightClass) return rightClass - leftClass;
    if (asNumber(left.totalRSF) !== asNumber(right.totalRSF)) return asNumber(right.totalRSF) - asNumber(left.totalRSF);
    return displayBuildingName(left).localeCompare(displayBuildingName(right));
  }
  if (sort === "name_asc") return displayBuildingName(left).localeCompare(displayBuildingName(right));
  if (sort === "rsf_desc") return asNumber(right.totalRSF) - asNumber(left.totalRSF) || displayBuildingName(left).localeCompare(displayBuildingName(right));
  if (sort === "stories_desc") return asNumber(right.numberOfStories) - asNumber(left.numberOfStories) || displayBuildingName(left).localeCompare(displayBuildingName(right));
  if (sort === "year_desc") return asNumber(right.yearBuilt) - asNumber(left.yearBuilt) || displayBuildingName(left).localeCompare(displayBuildingName(right));
  return `${asText(left.submarket)} ${displayBuildingName(left)}`.localeCompare(`${asText(right.submarket)} ${displayBuildingName(right)}`);
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

function companyTypeBadgeClass(type: string): string {
  if (type === "active_client") return "border-cyan-300/60 bg-cyan-500/10 text-cyan-100";
  if (type === "prospect") return "border-amber-300/60 bg-amber-500/10 text-amber-100";
  if (type === "tenant") return "border-emerald-300/60 bg-emerald-500/10 text-emerald-100";
  if (type === "landlord" || type === "ownership_group") return "border-fuchsia-300/60 bg-fuchsia-500/10 text-fuchsia-100";
  if (type === "former_client") return "border-rose-300/60 bg-rose-500/10 text-rose-100";
  return "border-white/25 bg-white/5 text-slate-200";
}

function reminderToneClass(reminder: CrmReminder): string {
  if (reminder.severity === "critical") return "border-red-300/50 bg-red-500/10 text-red-100";
  if (reminder.severity === "warn") return "border-amber-300/50 bg-amber-500/10 text-amber-100";
  return "border-cyan-300/50 bg-cyan-500/10 text-cyan-100";
}

function compareByCriticalDate(left: CrmCompany, right: CrmCompany): number {
  const leftDate = [left.noticeDeadline, left.currentLeaseExpiration, left.nextFollowUpDate].filter(Boolean).sort()[0] || "9999-99-99";
  const rightDate = [right.noticeDeadline, right.currentLeaseExpiration, right.nextFollowUpDate].filter(Boolean).sort()[0] || "9999-99-99";
  return leftDate.localeCompare(rightDate);
}

interface DealsWorkspaceProps {
  clientId: string;
  clientName?: string | null;
}

function scrollToWorkspaceSection(ref: MutableRefObject<HTMLDivElement | null>) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

export function DealsWorkspace({ clientId, clientName }: DealsWorkspaceProps) {
  const {
    activeClient,
    deals,
    dealStages,
    crmSettings,
    documents,
    representationMode,
    isAuthenticated,
    createDeal,
    updateDeal,
    removeDeal,
    updateDocument,
  } = useClientWorkspace();
  const { graph } = useBrokerOs();
  const isLandlordMode = representationMode === LANDLORD_REP_MODE;
  const representationProfile = useMemo(
    () => getRepresentationModeProfile(representationMode),
    [representationMode],
  );
  const storageKey = useMemo(() => makeClientScopedStorageKey(CRM_OS_STORAGE_KEY, clientId), [clientId]);

  const [view, setView] = useState<DealsViewMode>(() => crmSettings.defaultDealsView);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [draggingDealId, setDraggingDealId] = useState("");
  const [dragOverStage, setDragOverStage] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [selectedInventoryBuildingId, setSelectedInventoryBuildingId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("No active deals or relationship records for this workspace yet.");
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [crmDraft, setCrmDraft] = useState<CrmWorkspaceState>(() => emptyCrmWorkspaceState(representationMode));
  const [sharedMarketInventory, setSharedMarketInventory] = useState<SharedMarketInventoryResponse | null>(null);
  const [filters, setFilters] = useState<CrmFilters>(defaultCrmFilters());
  const [companyForm, setCompanyForm] = useState({
    name: "",
    type: isLandlordMode ? "tenant" : "prospect",
    industry: "",
    market: "",
    submarket: "",
    buildingQuery: "",
    buildingId: "",
    floor: "",
    suite: "",
    squareFootage: "",
    expirationDate: "",
    nextFollowUpDate: "",
    relationshipOwner: "",
    notes: "",
  });
  const [touchpointDraft, setTouchpointDraft] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState<{ subject: string; body: string; recommendation: string } | null>(null);
  const [generatedDraftStatus, setGeneratedDraftStatus] = useState("");
  const [buildingPhotoStatus, setBuildingPhotoStatus] = useState<{ buildingId: string; message: string }>({
    buildingId: "",
    message: "",
  });
  const [suiteAttachmentForm, setSuiteAttachmentForm] = useState({
    companyId: "",
    floor: "",
    suite: "",
    rsf: "",
    leaseStart: "",
    leaseExpiration: "",
    noticeDeadline: "",
    rentType: "Direct",
    baseRent: "",
    opex: "",
    abatementMonths: "",
    tiAllowance: "",
    concessions: "",
    landlordName: "",
  });
  const operatingLayerRef = useRef<HTMLDivElement | null>(null);
  const inventoryRef = useRef<HTMLDivElement | null>(null);
  const relationshipGridRef = useRef<HTMLDivElement | null>(null);
  const followUpEngineRef = useRef<HTMLDivElement | null>(null);
  const profileWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const pipelineOverviewRef = useRef<HTMLDivElement | null>(null);
  const pipelineViewsRef = useRef<HTMLDivElement | null>(null);
  const [buildingSearch, setBuildingSearch] = useState("");
  const [buildingSort, setBuildingSort] = useState<BuildingSortOption>("featured");
  const [buildingClassFilter, setBuildingClassFilter] = useState("all");
  const [buildingPhotoFilter, setBuildingPhotoFilter] = useState("all");
  const [buildingMapFilter, setBuildingMapFilter] = useState("all");
  const [form, setForm] = useState({
    dealName: "",
    requirementName: "",
    dealType: isLandlordMode ? "Landlord Rep" : "Tenant Rep",
    stage: dealStages[0] || (isLandlordMode ? "New Inquiry" : "New Lead"),
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

  useEffect(() => {
    const nextView = representationProfile.crm.availableViews.includes(crmSettings.defaultDealsView)
      ? crmSettings.defaultDealsView
      : representationProfile.crm.defaultDealsView;
    setView(nextView);
  }, [crmSettings.defaultDealsView, clientId, representationProfile.crm.availableViews, representationProfile.crm.defaultDealsView]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      dealType: isLandlordMode ? "Landlord Rep" : "Tenant Rep",
      stage: dealStages.includes(prev.stage) ? prev.stage : dealStages[0] || prev.stage,
    }));
    setCompanyForm((prev) => ({
      ...prev,
      type: isLandlordMode ? (prev.type === "prospect" ? "tenant" : prev.type) : prev.type,
    }));
  }, [dealStages, isLandlordMode]);

  useEffect(() => {
    let cancelled = false;
    setStorageHydrated(false);
    async function hydrate() {
      if (isAuthenticated) {
        try {
          const remote = await fetchWorkspaceCloudSection(storageKey);
          if (cancelled) return;
          if (remote?.value && typeof remote.value === "object") {
            setCrmDraft(remote.value as CrmWorkspaceState);
          } else {
            setCrmDraft(emptyCrmWorkspaceState(representationMode));
          }
          setStorageHydrated(true);
          return;
        } catch {
          if (cancelled) return;
        }
      }
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(storageKey);
          if (raw) {
            setCrmDraft(JSON.parse(raw) as CrmWorkspaceState);
          } else {
            setCrmDraft(emptyCrmWorkspaceState(representationMode));
          }
        } catch {
          setCrmDraft(emptyCrmWorkspaceState(representationMode));
        }
      }
      if (!cancelled) setStorageHydrated(true);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, representationMode, storageKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadSharedInventory() {
      try {
        const payload = await fetchSharedMarketInventory();
        if (!cancelled) setSharedMarketInventory(payload);
      } catch {
        if (!cancelled) setSharedMarketInventory(null);
      }
    }
    void loadSharedInventory();
    return () => {
      cancelled = true;
    };
  }, []);

  const crmState = useMemo(
    () => buildCrmWorkspaceState({
      clientId,
      clientName: asText(clientName) || asText(activeClient?.name) || "Workspace Client",
      representationMode,
      sharedBuildings: sharedMarketInventory?.records,
      documents,
      deals,
      properties: graph.properties,
      spaces: graph.spaces,
      obligations: graph.obligations,
      surveys: graph.surveys,
      surveyEntries: graph.surveyEntries,
      financialAnalyses: graph.financialAnalyses,
      leaseAbstracts: graph.leaseAbstracts,
      existingState: crmDraft,
    }),
    [activeClient?.name, clientId, clientName, crmDraft, deals, documents, graph.financialAnalyses, graph.leaseAbstracts, graph.obligations, graph.properties, graph.spaces, graph.surveyEntries, graph.surveys, representationMode, sharedMarketInventory?.records],
  );

  useEffect(() => {
    if (!storageHydrated || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(crmState));
    if (!isAuthenticated) return;
    void saveWorkspaceCloudSection(storageKey, crmState).catch(() => {
      // local fallback already saved
    });
  }, [crmState, isAuthenticated, storageHydrated, storageKey]);

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
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [pipelineQuery, sortedDeals]);

  const selectedDeal = useMemo(
    () => sortedDeals.find((deal) => deal.id === selectedDealId) || sortedDeals[0] || null,
    [selectedDealId, sortedDeals],
  );
  const selectedCompany = useMemo(
    () => crmState.companies.find((company) => company.id === selectedCompanyId) || [...crmState.companies].sort(compareByCriticalDate)[0] || null,
    [crmState.companies, selectedCompanyId],
  );
  const selectedCompanyBuilding = useMemo(
    () => crmState.buildings.find((building) => building.id === selectedCompany?.buildingId) || null,
    [crmState.buildings, selectedCompany?.buildingId],
  );
  const selectedCompanyOccupancies = useMemo(
    () => crmState.occupancyRecords.filter((record) => record.companyId === selectedCompany?.id),
    [crmState.occupancyRecords, selectedCompany?.id],
  );
  const selectedCompanyProspecting = useMemo(
    () => crmState.prospectingRecords.find((record) => record.companyId === selectedCompany?.id) || null,
    [crmState.prospectingRecords, selectedCompany?.id],
  );
  const selectedCompanyRelationship = useMemo(
    () => crmState.clientRelationshipRecords.find((record) => record.companyId === selectedCompany?.id) || null,
    [crmState.clientRelationshipRecords, selectedCompany?.id],
  );
  const selectedCompanyDocuments = useMemo(
    () => documents.filter((document) => selectedCompany?.linkedDocumentIds.includes(document.id)),
    [documents, selectedCompany?.linkedDocumentIds],
  );
  const selectedCompanyDeals = useMemo(
    () => deals.filter((deal) => selectedCompany?.linkedDealIds.includes(deal.id) || deal.companyId === selectedCompany?.id),
    [deals, selectedCompany?.id, selectedCompany?.linkedDealIds],
  );
  const selectedCompanyReminders = useMemo(
    () => crmState.reminders.filter((reminder) => reminder.companyId === selectedCompany?.id && reminder.status === "open"),
    [crmState.reminders, selectedCompany?.id],
  );
  const selectedCompanyTasks = useMemo(
    () => crmState.tasks.filter((task) => task.companyId === selectedCompany?.id),
    [crmState.tasks, selectedCompany?.id],
  );
  const dashboard = useMemo(() => buildCrmDashboard(crmState, filters), [crmState, filters]);
  const dashboardCards = useMemo(
    () => buildModeAwareDashboardCards(representationMode, dashboard),
    [representationMode, dashboard],
  );
  const filteredCompanies = useMemo(() => filterCrmCompanies(crmState, filters), [crmState, filters]);
  const filteredBuildings = useMemo(() => filterCrmBuildings(crmState, filters), [crmState, filters]);
  const displayedBuildings = useMemo(() => {
    const query = normalizeText(buildingSearch);
    return [...filteredBuildings]
      .filter((building) => {
        if (buildingClassFilter !== "all" && asText(building.buildingClass).toUpperCase() !== buildingClassFilter) return false;
        const hasCuratedPhoto = hasCuratedBuildingPhoto(building);
        if (buildingPhotoFilter === "with_default_photo" && !hasCuratedPhoto) return false;
        if (buildingPhotoFilter === "designated_cover_only" && hasCuratedPhoto) return false;
        const hasMap = Number.isFinite(building.latitude) && Number.isFinite(building.longitude);
        if (buildingMapFilter === "mapped_only" && !hasMap) return false;
        if (buildingMapFilter === "unmapped_only" && hasMap) return false;
        if (!query) return true;
        const haystack = [
          displayBuildingName(building),
          building.address,
          building.submarket,
          building.market,
          building.ownerName,
          building.leasingCompanyName,
          building.propertyManagerName,
        ].map(normalizeText).join(" ");
        return haystack.includes(query);
      })
      .sort((left, right) => compareBuildings(left, right, buildingSort, selectedInventoryBuildingId || filters.buildingId || null));
  }, [buildingClassFilter, buildingMapFilter, buildingPhotoFilter, buildingSearch, buildingSort, filteredBuildings, filters.buildingId, selectedInventoryBuildingId]);
  const buildingOptions = useMemo(
    () => [...crmState.buildings].sort((left, right) => `${left.name} ${left.submarket}`.localeCompare(`${right.name} ${right.submarket}`)),
    [crmState.buildings],
  );
  const attachableCompanyOptions = useMemo(
    () => [...crmState.companies]
      .filter((company) => company.type !== "landlord" && company.type !== "ownership_group")
      .sort((left, right) => left.name.localeCompare(right.name)),
    [crmState.companies],
  );
  const selectedIntakeBuilding = useMemo(
    () => crmState.buildings.find((building) => building.id === companyForm.buildingId) || null,
    [companyForm.buildingId, crmState.buildings],
  );
  const buildingAutocompleteSuggestions = useMemo(() => {
    const query = normalizeText(companyForm.buildingQuery);
    if (!query) return [];
    return buildingOptions
      .map((building) => {
        const name = normalizeText(displayBuildingName(building));
        const address = normalizeText(building.address);
        const submarket = normalizeText(building.submarket);
        const market = normalizeText(building.market);
        const exactMatch = name === query || address === query;
        const startsWith = name.startsWith(query) || address.startsWith(query);
        const includes = [name, address, submarket, market].some((value) => value.includes(query));
        if (!exactMatch && !startsWith && !includes) return null;
        return {
          building,
          score: exactMatch ? 0 : startsWith ? 1 : 2,
        };
      })
      .filter((entry): entry is { building: CrmBuilding; score: number } => Boolean(entry))
      .sort((left, right) => left.score - right.score || compareBuildings(left.building, right.building, "name_asc", null))
      .slice(0, 6)
      .map((entry) => entry.building);
  }, [buildingOptions, companyForm.buildingQuery]);
  const exactBuildingAutocompleteMatch = useMemo(() => {
    const query = normalizeText(companyForm.buildingQuery);
    if (!query) return null;
    return buildingOptions.find((building) => {
      const name = normalizeText(displayBuildingName(building));
      const address = normalizeText(building.address);
      return name === query || address === query;
    }) || null;
  }, [buildingOptions, companyForm.buildingQuery]);
  const intakeResolvedBuilding = selectedIntakeBuilding || exactBuildingAutocompleteMatch;
  const showAddBuildingAction = Boolean(
    asText(companyForm.buildingQuery)
      && !selectedIntakeBuilding
      && !exactBuildingAutocompleteMatch,
  );
  const marketOptions = useMemo(
    () => Array.from(new Set([
      ...crmState.companies.map((company) => company.market),
      ...crmState.buildings.map((building) => building.market),
    ].filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [crmState.buildings, crmState.companies],
  );
  const submarketOptions = useMemo(
    () => Array.from(new Set([
      ...crmState.companies.map((company) => company.submarket),
      ...crmState.buildings.map((building) => building.submarket),
    ].filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [crmState.buildings, crmState.companies],
  );
  const selectedInventoryBuilding = useMemo(
    () => crmState.buildings.find((building) => building.id === selectedInventoryBuildingId)
      || crmState.buildings.find((building) => building.id === filters.buildingId)
      || null,
    [crmState.buildings, filters.buildingId, selectedInventoryBuildingId],
  );
  const activeInventoryBuilding = useMemo(
    () => selectedInventoryBuilding || displayedBuildings[0] || null,
    [displayedBuildings, selectedInventoryBuilding],
  );
  const activeLandlordOccupancy = useMemo(() => {
    if (!selectedCompany) return null;
    if (activeInventoryBuilding) {
      return selectedCompanyOccupancies.find((record) => record.buildingId === activeInventoryBuilding.id)
        || selectedCompanyOccupancies[0]
        || null;
    }
    return selectedCompanyOccupancies[0] || null;
  }, [activeInventoryBuilding, selectedCompany, selectedCompanyOccupancies]);
  const buildingInventoryMetrics = useMemo(() => {
    const classCounts = displayedBuildings.reduce((map, building) => {
      const key = asText(building.buildingClass).toUpperCase() || "Unclassified";
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map<string, number>());
    return {
      totalRSF: displayedBuildings.reduce((sum, building) => sum + asNumber(building.totalRSF), 0),
      mappedCount: displayedBuildings.filter((building) => Number.isFinite(building.latitude) && Number.isFinite(building.longitude)).length,
      pinnedPhotoCount: displayedBuildings.filter((building) => hasPinnedBuildingPhoto(building)).length,
      classBreakdown: Array.from(classCounts.entries()).sort(([left], [right]) => left.localeCompare(right)),
    };
  }, [displayedBuildings]);
  const buildingClassCounts = useMemo(() => ({
    all: filteredBuildings.length,
    A: filteredBuildings.filter((building) => asText(building.buildingClass).toUpperCase() === "A").length,
    B: filteredBuildings.filter((building) => asText(building.buildingClass).toUpperCase() === "B").length,
  }), [filteredBuildings]);
  const stageCounts = useMemo(() => stageCountMap(sortedDeals, dealStages), [dealStages, sortedDeals]);
  const linkedDocumentMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const deal of sortedDeals) {
      const linked = Array.from(new Set([
        ...deal.linkedDocumentIds,
        ...documents.filter((doc) => doc.dealId === deal.id).map((doc) => doc.id),
      ]));
      map.set(deal.id, linked);
    }
    return map;
  }, [documents, sortedDeals]);
  const boardGridStyle = useMemo(
    () => ({ "--stage-count": String(Math.max(dealStages.length, 1)) } as CSSProperties),
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
  const stackingPlanRows = useMemo(
    () => buildLandlordStackingPlan({
      buildings: filteredBuildings,
      companies: crmState.companies,
      occupancyRecords: crmState.occupancyRecords,
      stackingPlanEntries: crmState.stackingPlanEntries,
      properties: graph.properties,
      spaces: graph.spaces,
      deals: filteredDeals,
      proposals: graph.proposals,
      obligations: graph.obligations,
      filters: {
        market: filters.market,
        submarket: filters.submarket,
        buildingId: selectedInventoryBuildingId || filters.buildingId,
        query: buildingSearch,
      },
    }),
    [
      filteredBuildings,
      crmState.companies,
      crmState.occupancyRecords,
      crmState.stackingPlanEntries,
      graph.properties,
      graph.spaces,
      filteredDeals,
      graph.proposals,
      graph.obligations,
      filters.market,
      filters.submarket,
      filters.buildingId,
      selectedInventoryBuildingId,
      buildingSearch,
    ],
  );
  const activeStackingBuildingRow = useMemo(
    () => stackingPlanRows.find((row) => row.buildingId === activeInventoryBuilding?.id) || stackingPlanRows[0] || null,
    [activeInventoryBuilding?.id, stackingPlanRows],
  );
  const activeBuildingSummary = useMemo(
    () => buildLandlordBuildingHubSummary(activeStackingBuildingRow),
    [activeStackingBuildingRow],
  );
  const tenantHubSummary = useMemo(
    () => selectedCompany
      ? buildTenantCompanyHubSummary({
        company: selectedCompany,
        touchpoints: crmState.touchpoints.filter((touchpoint) => touchpoint.companyId === selectedCompany.id),
        reminders: selectedCompanyReminders,
      })
      : null,
    [crmState.touchpoints, selectedCompany, selectedCompanyReminders],
  );

  useEffect(() => {
    if (!selectedCompany && crmState.companies.length > 0) {
      const nextDefault = [...crmState.companies].sort(compareByCriticalDate)[0];
      if (nextDefault) setSelectedCompanyId(nextDefault.id);
    }
  }, [crmState.companies, selectedCompany]);

  useEffect(() => {
    const companyByName = new Map(crmState.companies.map((company) => [normalizeText(company.name), company.id]));
    for (const document of documents) {
      if (document.companyId) continue;
      const canonicalTenant = normalizeText(document.normalizeSnapshot?.canonical_lease?.tenant_name);
      const suggestedCompanyId = companyByName.get(canonicalTenant);
      if (canonicalTenant && suggestedCompanyId) {
        updateDocument(document.id, { companyId: suggestedCompanyId });
      }
    }
    if (!activeClient?.name) return;
    const workspaceCompanyId = companyByName.get(normalizeText(activeClient.name));
    if (!workspaceCompanyId) return;
    for (const deal of deals) {
      if (deal.companyId) continue;
      updateDeal(deal.id, { companyId: workspaceCompanyId });
    }
  }, [activeClient?.name, crmState.companies, deals, documents, updateDeal, updateDocument]);

  useEffect(() => {
    if (!selectedDeal && sortedDeals.length > 0) {
      setSelectedDealId(sortedDeals[0].id);
    }
  }, [selectedDeal, sortedDeals]);

  useEffect(() => {
    if (filters.buildingId !== "all") {
      setSelectedInventoryBuildingId(filters.buildingId);
    }
  }, [filters.buildingId]);

  useEffect(() => {
    setSuiteAttachmentForm({
      companyId: selectedCompany?.id || "",
      floor: activeLandlordOccupancy?.floor || selectedCompany?.floor || "",
      suite: activeLandlordOccupancy?.suite || selectedCompany?.suite || "",
      rsf: String(activeLandlordOccupancy?.rsf || selectedCompany?.squareFootage || ""),
      leaseStart: activeLandlordOccupancy?.leaseStart || "",
      leaseExpiration: activeLandlordOccupancy?.leaseExpiration || selectedCompany?.currentLeaseExpiration || "",
      noticeDeadline: activeLandlordOccupancy?.noticeDeadline || selectedCompany?.noticeDeadline || "",
      rentType: activeLandlordOccupancy?.rentType || "Direct",
      baseRent: String(activeLandlordOccupancy?.baseRent || ""),
      opex: String(activeLandlordOccupancy?.opex || ""),
      abatementMonths: String(activeLandlordOccupancy?.abatementMonths || ""),
      tiAllowance: String(activeLandlordOccupancy?.tiAllowance || ""),
      concessions: activeLandlordOccupancy?.concessions || "",
      landlordName: activeLandlordOccupancy?.landlordName || activeInventoryBuilding?.ownerName || selectedCompany?.landlordName || "",
    });
  }, [
    activeInventoryBuilding?.id,
    activeInventoryBuilding?.ownerName,
    activeLandlordOccupancy?.abatementMonths,
    activeLandlordOccupancy?.baseRent,
    activeLandlordOccupancy?.concessions,
    activeLandlordOccupancy?.floor,
    activeLandlordOccupancy?.id,
    activeLandlordOccupancy?.landlordName,
    activeLandlordOccupancy?.leaseExpiration,
    activeLandlordOccupancy?.leaseStart,
    activeLandlordOccupancy?.noticeDeadline,
    activeLandlordOccupancy?.opex,
    activeLandlordOccupancy?.rentType,
    activeLandlordOccupancy?.rsf,
    activeLandlordOccupancy?.suite,
    activeLandlordOccupancy?.tiAllowance,
    selectedCompany?.currentLeaseExpiration,
    selectedCompany?.floor,
    selectedCompany?.id,
    selectedCompany?.landlordName,
    selectedCompany?.noticeDeadline,
    selectedCompany?.squareFootage,
    selectedCompany?.suite,
  ]);

  const patchCrmDraft = useCallback((patcher: (current: CrmWorkspaceState) => CrmWorkspaceState) => {
    setCrmDraft((prev) => patcher(prev));
  }, []);

  const createCompanyProfile = useCallback(() => {
    const name = asText(companyForm.name);
    if (!name) {
      setError("Company name is required.");
      return;
    }
    const linkedBuilding = intakeResolvedBuilding;
    const nextCompany: CrmCompany = {
      id: makeId("crm_company"),
      clientId,
      name,
      type: companyForm.type as CrmCompany["type"],
      industry: asText(companyForm.industry),
      market: asText(companyForm.market) || linkedBuilding?.market || "",
      submarket: asText(companyForm.submarket) || linkedBuilding?.submarket || "",
      buildingId: linkedBuilding?.id || "",
      floor: asText(companyForm.floor),
      suite: asText(companyForm.suite),
      squareFootage: asNumber(companyForm.squareFootage),
      currentLeaseExpiration: asText(companyForm.expirationDate),
      noticeDeadline: "",
      renewalProbability: 0.5,
      prospectStatus: companyForm.type === "prospect" ? "Targeted" : "Managed",
      relationshipOwner: asText(companyForm.relationshipOwner) || "Broker Team",
      source: "manual",
      notes: asText(companyForm.notes),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      linkedDocumentIds: [],
      linkedDealIds: [],
      linkedObligationIds: [],
      linkedSurveyIds: [],
      linkedAnalysisIds: [],
      linkedLeaseAbstractIds: [],
      lastTouchDate: "",
      nextFollowUpDate: asText(companyForm.nextFollowUpDate),
      landlordName: "",
      brokerRelationship: "",
    };
    patchCrmDraft((current) => ({ ...current, companies: [nextCompany, ...current.companies] }));
    setSelectedCompanyId(nextCompany.id);
    setCompanyForm({
      name: "",
      type: isLandlordMode ? "tenant" : "prospect",
      industry: "",
      market: "",
      submarket: "",
      buildingQuery: "",
      buildingId: "",
      floor: "",
      suite: "",
      squareFootage: "",
      expirationDate: "",
      nextFollowUpDate: "",
      relationshipOwner: "",
      notes: "",
    });
    setStatus(linkedBuilding ? `Created CRM profile for ${name} and linked ${displayBuildingName(linkedBuilding)}.` : `Created CRM profile for ${name}.`);
    setError("");
  }, [clientId, companyForm, intakeResolvedBuilding, isLandlordMode, patchCrmDraft]);

  const applyIntakeBuildingSelection = useCallback((building: CrmBuilding) => {
    setCompanyForm((prev) => ({
      ...prev,
      buildingId: building.id,
      buildingQuery: displayBuildingName(building),
      market: building.market || prev.market,
      submarket: building.submarket || prev.submarket,
    }));
    setError("");
    setStatus(`Linked ${displayBuildingName(building)} to the intake profile.`);
  }, []);

  const clearIntakeBuildingSelection = useCallback(() => {
    setCompanyForm((prev) => ({
      ...prev,
      buildingId: "",
      buildingQuery: "",
    }));
    setError("");
    setStatus("Cleared the building from the intake profile.");
  }, []);

  const addIntakeBuilding = useCallback(() => {
    const buildingName = asText(companyForm.buildingQuery);
    if (!buildingName) {
      setError("Type a building name before adding it.");
      return;
    }
    if (exactBuildingAutocompleteMatch) {
      applyIntakeBuildingSelection(exactBuildingAutocompleteMatch);
      return;
    }
    const nextBuilding: CrmBuilding = {
      id: makeId("crm_building"),
      clientId,
      name: buildingName,
      address: "",
      market: asText(companyForm.market),
      submarket: asText(companyForm.submarket),
      ownerName: "",
      propertyType: "Office",
      totalRSF: 0,
      notes: "Added from CRM intake.",
      source: "manual_intake",
    };
    patchCrmDraft((current) => ({
      ...current,
      buildings: [nextBuilding, ...current.buildings],
    }));
    setCompanyForm((prev) => ({
      ...prev,
      buildingId: nextBuilding.id,
      buildingQuery: displayBuildingName(nextBuilding),
      market: prev.market || nextBuilding.market,
      submarket: prev.submarket || nextBuilding.submarket,
    }));
    setError("");
    setStatus(`Added ${displayBuildingName(nextBuilding)} to buildings and linked it to the intake profile.`);
  }, [applyIntakeBuildingSelection, clientId, companyForm.buildingQuery, companyForm.market, companyForm.submarket, exactBuildingAutocompleteMatch, patchCrmDraft]);

  const focusBuilding = useCallback((building: CrmBuilding) => {
    setSelectedInventoryBuildingId(building.id);
    setBuildingPhotoStatus((prev) => (prev.buildingId === building.id ? prev : { buildingId: "", message: "" }));
    setStatus(`Selected ${building.name} while keeping the current inventory results in view.`);
  }, []);

  const patchSelectedCompany = useCallback((patch: Partial<CrmCompany>) => {
    if (!selectedCompany) return;
    patchCrmDraft((current) => ({
      ...current,
      companies: current.companies.some((company) => company.id === selectedCompany.id)
        ? current.companies.map((company) =>
            company.id === selectedCompany.id
              ? { ...company, ...patch, updatedAt: new Date().toISOString() }
              : company,
          )
        : [{ ...selectedCompany, ...patch, updatedAt: new Date().toISOString() }, ...current.companies],
    }));
  }, [patchCrmDraft, selectedCompany]);

  const patchBuildingRecord = useCallback((buildingId: string, patch: Partial<CrmBuilding>) => {
    patchCrmDraft((current) => ({
      ...current,
      buildings: current.buildings.map((building) =>
        building.id === buildingId
          ? { ...building, ...patch }
          : building,
      ),
    }));
  }, [patchCrmDraft]);

  const upsertStackingEntry = useCallback((current: CrmWorkspaceState, seed: Partial<CrmStackingPlanEntry> & { buildingId: string; floor: string; suite: string }) => {
    const currentEntries = current.stackingPlanEntries || [];
    const key = `${normalizeText(seed.buildingId)}::${normalizeText(seed.floor || "unassigned")}::${normalizeText(seed.suite)}`;
    const existing = currentEntries.find((entry) =>
      (seed.id && entry.id === seed.id)
      || `${normalizeText(entry.buildingId)}::${normalizeText(entry.floor || "unassigned")}::${normalizeText(entry.suite)}` === key,
    );
    const now = new Date().toISOString();
    const nextEntry: CrmStackingPlanEntry = {
      id: seed.id || existing?.id || makeId("crm_stack"),
      clientId,
      buildingId: seed.buildingId,
      floor: seed.floor,
      suite: seed.suite,
      rsf: Math.max(asNumber(seed.rsf), 0),
      companyId: asText(seed.companyId),
      tenantName: asText(seed.tenantName),
      leaseStart: asText(seed.leaseStart),
      leaseExpiration: asText(seed.leaseExpiration),
      noticeDeadline: asText(seed.noticeDeadline),
      rentType: asText(seed.rentType),
      baseRent: Math.max(asNumber(seed.baseRent), 0),
      opex: Math.max(asNumber(seed.opex), 0),
      abatementMonths: Math.max(asNumber(seed.abatementMonths), 0),
      tiAllowance: Math.max(asNumber(seed.tiAllowance), 0),
      concessions: asText(seed.concessions),
      landlordName: asText(seed.landlordName),
      source: "manual",
      sourceDocumentIds: existing?.sourceDocumentIds || [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    return existing
      ? currentEntries.map((entry) => (entry.id === existing.id ? nextEntry : entry))
      : [nextEntry, ...currentEntries];
  }, [clientId]);

  const saveStackingPlanEntry = useCallback((payload: {
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
  }) => {
    patchCrmDraft((current) => {
      const nextStackingPlanEntries = upsertStackingEntry(current, payload);
      const hasLinkedCompany = Boolean(asText(payload.companyId));
      const currentOccupancyRecords = current.occupancyRecords || [];
      const currentCompanies = current.companies || [];
      const occupancyKeyMatch = (record: CrmOccupancyRecord) => (
        record.buildingId === payload.buildingId
        && normalizeText(record.floor) === normalizeText(payload.floor)
        && normalizeText(record.suite) === normalizeText(payload.suite)
      );
      const existingOccupancy = currentOccupancyRecords.find((record) => occupancyKeyMatch(record));
      const nextOccupancyRecords = hasLinkedCompany
        ? (
          existingOccupancy
            ? currentOccupancyRecords.map((record) => (
              record.id === existingOccupancy.id
                ? {
                  ...record,
                  companyId: payload.companyId,
                  floor: payload.floor,
                  suite: payload.suite,
                  rsf: payload.rsf,
                  leaseStart: payload.leaseStart,
                  leaseExpiration: payload.leaseExpiration,
                  noticeDeadline: payload.noticeDeadline,
                  rentType: payload.rentType || "Direct",
                  baseRent: payload.baseRent,
                  opex: payload.opex,
                  abatementMonths: payload.abatementMonths,
                  tiAllowance: payload.tiAllowance,
                  concessions: payload.concessions,
                  landlordName: payload.landlordName,
                }
                : record
            ))
            : [{
              id: makeId("crm_occupancy"),
              clientId,
              companyId: payload.companyId,
              buildingId: payload.buildingId,
              floor: payload.floor,
              suite: payload.suite,
              rsf: payload.rsf,
              leaseStart: payload.leaseStart,
              leaseExpiration: payload.leaseExpiration,
              noticeDeadline: payload.noticeDeadline,
              rentType: payload.rentType || "Direct",
              baseRent: payload.baseRent,
              opex: payload.opex,
              abatementMonths: payload.abatementMonths,
              tiAllowance: payload.tiAllowance,
              concessions: payload.concessions,
              landlordName: payload.landlordName,
              isCurrent: true,
                  sourceDocumentIds: [],
            }, ...currentOccupancyRecords]
        )
        : currentOccupancyRecords.filter((record) => !occupancyKeyMatch(record));
      const nextCompanies = hasLinkedCompany
        ? currentCompanies.map((company) => (
          company.id === payload.companyId
            ? {
              ...company,
              type: isLandlordMode && company.type === "prospect" ? "tenant" : company.type,
              buildingId: payload.buildingId,
              market: activeInventoryBuilding?.market || company.market,
              submarket: activeInventoryBuilding?.submarket || company.submarket,
              floor: payload.floor,
              suite: payload.suite,
              squareFootage: Math.max(company.squareFootage, payload.rsf),
              currentLeaseExpiration: payload.leaseExpiration || company.currentLeaseExpiration,
              noticeDeadline: payload.noticeDeadline || company.noticeDeadline,
              landlordName: payload.landlordName || company.landlordName,
              updatedAt: new Date().toISOString(),
            }
            : company
        ))
        : currentCompanies;
      return {
        ...current,
        companies: nextCompanies,
        occupancyRecords: nextOccupancyRecords,
        stackingPlanEntries: nextStackingPlanEntries,
      };
    });
    if (payload.companyId) setSelectedCompanyId(payload.companyId);
    const buildingLabel = activeInventoryBuilding ? displayBuildingName(activeInventoryBuilding) : "selected building";
    setStatus(`Saved stack plan for ${buildingLabel} floor ${payload.floor} suite ${payload.suite}.`);
    setError("");
  }, [activeInventoryBuilding, clientId, isLandlordMode, patchCrmDraft, upsertStackingEntry]);

  const saveSuiteAttachment = useCallback(() => {
    if (!activeInventoryBuilding) {
      setError("Select a building before attaching a tenant to a suite.");
      return;
    }
    const targetCompany = crmState.companies.find((company) => company.id === suiteAttachmentForm.companyId);
    if (!targetCompany) {
      setError("Select a tenant profile before saving suite details.");
      return;
    }
    const suite = asText(suiteAttachmentForm.suite);
    if (!suite) {
      setError("Suite is required.");
      return;
    }
    const floor = asText(suiteAttachmentForm.floor);
    const nextOccupancy: CrmOccupancyRecord = {
      id: activeLandlordOccupancy?.companyId === targetCompany.id && activeLandlordOccupancy?.buildingId === activeInventoryBuilding.id
        ? activeLandlordOccupancy.id
        : makeId("crm_occupancy"),
      clientId,
      companyId: targetCompany.id,
      buildingId: activeInventoryBuilding.id,
      floor,
      suite,
      rsf: asNumber(suiteAttachmentForm.rsf),
      leaseStart: asText(suiteAttachmentForm.leaseStart),
      leaseExpiration: asText(suiteAttachmentForm.leaseExpiration),
      noticeDeadline: asText(suiteAttachmentForm.noticeDeadline),
      rentType: asText(suiteAttachmentForm.rentType) || "Direct",
      baseRent: asNumber(suiteAttachmentForm.baseRent),
      opex: asNumber(suiteAttachmentForm.opex),
      abatementMonths: asNumber(suiteAttachmentForm.abatementMonths),
      tiAllowance: asNumber(suiteAttachmentForm.tiAllowance),
      concessions: asText(suiteAttachmentForm.concessions),
      landlordName: asText(suiteAttachmentForm.landlordName) || activeInventoryBuilding.ownerName || "",
      isCurrent: true,
      sourceDocumentIds: activeLandlordOccupancy?.companyId === targetCompany.id ? (activeLandlordOccupancy.sourceDocumentIds || []) : [],
    };
    patchCrmDraft((current) => {
      const matchingRecord = current.occupancyRecords.find((record) => (
        record.id === nextOccupancy.id
        || (
          record.companyId === targetCompany.id
          && record.buildingId === activeInventoryBuilding.id
          && normalizeText(record.floor) === normalizeText(floor)
          && normalizeText(record.suite) === normalizeText(suite)
        )
      ));
      return {
        ...current,
        companies: current.companies.map((company) => (
          company.id === targetCompany.id
            ? {
              ...company,
              type: isLandlordMode && company.type === "prospect" ? "tenant" : company.type,
              buildingId: activeInventoryBuilding.id,
              market: activeInventoryBuilding.market || company.market,
              submarket: activeInventoryBuilding.submarket || company.submarket,
              floor,
              suite,
              squareFootage: Math.max(company.squareFootage, nextOccupancy.rsf),
              currentLeaseExpiration: nextOccupancy.leaseExpiration || company.currentLeaseExpiration,
              noticeDeadline: nextOccupancy.noticeDeadline || company.noticeDeadline,
              landlordName: nextOccupancy.landlordName || company.landlordName,
              updatedAt: new Date().toISOString(),
            }
            : company
        )),
        occupancyRecords: matchingRecord
          ? current.occupancyRecords.map((record) => (
            record.id === matchingRecord.id
              ? {
                ...record,
                ...nextOccupancy,
                sourceDocumentIds: record.sourceDocumentIds,
              }
              : record
          ))
          : [nextOccupancy, ...current.occupancyRecords],
      };
    });
    setSelectedCompanyId(targetCompany.id);
    setError("");
    setStatus(`Attached ${targetCompany.name} to ${displayBuildingName(activeInventoryBuilding)} suite ${suite} with optional comp details saved.`);
  }, [activeInventoryBuilding, activeLandlordOccupancy, clientId, crmState.companies, isLandlordMode, patchCrmDraft, suiteAttachmentForm]);

  const patchProspectingRecord = useCallback((patch: Record<string, unknown>) => {
    if (!selectedCompany) return;
    patchCrmDraft((current) => {
      const existing = current.prospectingRecords.find((record) => record.companyId === selectedCompany.id);
      const nextRecord = {
        id: existing?.id || makeId("crm_prospect"),
        clientId,
        companyId: selectedCompany.id,
        market: selectedCompany.market,
        submarket: selectedCompany.submarket,
        buildingId: selectedCompany.buildingId,
        floor: selectedCompany.floor,
        suite: selectedCompany.suite,
        prospectStage: selectedCompany.prospectStatus,
        temperature: "Warm",
        leadSource: selectedCompany.source,
        lastContactDate: selectedCompany.lastTouchDate,
        nextFollowUpDate: selectedCompany.nextFollowUpDate,
        expirationDate: selectedCompany.currentLeaseExpiration,
        notes: selectedCompany.notes,
        assignedBroker: selectedCompany.relationshipOwner,
        ...existing,
        ...patch,
      };
      return {
        ...current,
        prospectingRecords: existing
          ? current.prospectingRecords.map((record) => (record.companyId === selectedCompany.id ? nextRecord : record))
          : [nextRecord, ...current.prospectingRecords],
      };
    });
  }, [clientId, patchCrmDraft, selectedCompany]);

  const addCrmTask = useCallback((title: string, dueDate = "") => {
    if (!selectedCompany || !asText(title)) return;
    const task: CrmTask = {
      id: makeId("crm_task"),
      clientId,
      companyId: selectedCompany.id,
      type: "follow_up",
      title: asText(title),
      dueDate,
      status: "open",
      priority: "high",
      owner: selectedCompany.relationshipOwner || "Broker Team",
      aiSuggested: false,
    };
    patchCrmDraft((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    setTaskDraft("");
    setStatus(`Added CRM task for ${selectedCompany.name}.`);
  }, [clientId, patchCrmDraft, selectedCompany]);

  const addTouchpoint = useCallback(() => {
    if (!selectedCompany || !asText(touchpointDraft)) return;
    const touchpoint: CrmTouchpoint = {
      id: makeId("crm_touchpoint"),
      clientId,
      companyId: selectedCompany.id,
      category: "manual_note",
      summary: asText(touchpointDraft),
      createdAt: new Date().toISOString(),
    };
    patchCrmDraft((current) => ({ ...current, touchpoints: [touchpoint, ...current.touchpoints] }));
    patchSelectedCompany({ lastTouchDate: touchpoint.createdAt.slice(0, 10) });
    setTouchpointDraft("");
    setStatus(`Logged touchpoint for ${selectedCompany.name}.`);
  }, [clientId, patchCrmDraft, patchSelectedCompany, selectedCompany, touchpointDraft]);

  const dismissReminder = useCallback((reminderId: string) => {
    patchCrmDraft((current) => ({
      ...current,
      reminders: current.reminders.map((reminder) =>
        reminder.id === reminderId ? { ...reminder, status: "dismissed" } : reminder,
      ),
    }));
  }, [patchCrmDraft]);

  const createDealFromCompany = useCallback(() => {
    if (!selectedCompany) return;
    const created = createDeal({
      clientId,
      companyId: selectedCompany.id,
      dealName: isLandlordMode ? `${selectedCompany.name} Pursuit` : `${selectedCompany.name} Requirement`,
      requirementName: isLandlordMode ? `${selectedCompany.name} occupancy / suite strategy` : `${selectedCompany.name} requirement`,
      dealType: isLandlordMode ? "Landlord Rep" : "Tenant Rep",
      stage: dealStages[0],
      targetMarket: selectedCompany.market,
      submarket: selectedCompany.submarket,
      selectedProperty: selectedCompanyBuilding?.name || "",
      selectedSuite: selectedCompany.suite,
      selectedLandlord: selectedCompany.landlordName,
      tenantRepBroker: selectedCompany.relationshipOwner,
      expirationDate: selectedCompany.currentLeaseExpiration,
      notes: selectedCompany.notes,
    });
    if (!created) return;
    setSelectedDealId(created.id);
    setStatus(`Created deal for ${selectedCompany.name}.`);
  }, [clientId, createDeal, dealStages, isLandlordMode, selectedCompany, selectedCompanyBuilding]);

  const createDealFromForm = useCallback(() => {
    if (!asText(form.dealName)) {
      setError("Deal name is required.");
      return;
    }
    const created = createDeal({
      clientId,
      companyId: selectedCompany?.id,
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
  }, [clientId, createDeal, form, selectedCompany?.id]);

  const moveDealToStage = useCallback((deal: ClientWorkspaceDeal, nextStage: string, sourceLabel: string) => {
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
  }, [updateDeal]);

  const handleDropToStage = useCallback((stage: string) => {
    const draggedDeal = sortedDeals.find((deal) => deal.id === draggingDealId);
    setDragOverStage("");
    setDraggingDealId("");
    if (!draggedDeal) return;
    moveDealToStage(draggedDeal, stage, "drag and drop");
    setSelectedDealId(draggedDeal.id);
  }, [draggingDealId, moveDealToStage, sortedDeals]);

  const createOutreachDraft = useCallback(() => {
    if (!selectedCompany) return;
    const template = crmState.templates.find((item) => item.id === (selectedTemplateId || crmState.templates[0]?.id));
    if (!template) return;
    const draft = generateCrmOutreachDraft({
      template,
      company: selectedCompany,
      building: selectedCompanyBuilding,
      occupancy: selectedCompanyOccupancies[0] || null,
      brokerName: selectedCompany.relationshipOwner || activeClient?.contactName || "Broker Team",
      representationMode,
    });
    setGeneratedDraft(draft);
    setGeneratedDraftStatus(`Generated ${template.name} for ${selectedCompany.name}.`);
  }, [activeClient?.contactName, crmState.templates, representationMode, selectedCompany, selectedCompanyBuilding, selectedCompanyOccupancies, selectedTemplateId]);

  const aiRecommendations = useMemo(() => {
    return buildModeAwareAiRecommendations({
      mode: representationMode,
      selectedCompany,
      selectedCompanyDealsCount: selectedCompanyDeals.length,
      selectedCompanyDocumentsCount: selectedCompanyDocuments.length,
      selectedBuilding: activeInventoryBuilding,
      buildingSummary: activeBuildingSummary,
    });
  }, [
    representationMode,
    selectedCompany,
    selectedCompanyDeals.length,
    selectedCompanyDocuments.length,
    activeInventoryBuilding,
    activeBuildingSummary,
  ]);

  const totalVacantSuites = useMemo(
    () => stackingPlanRows.reduce((sum, row) => sum + row.summary.vacant, 0),
    [stackingPlanRows],
  );
  const totalTourSuites = useMemo(
    () => stackingPlanRows.reduce((sum, row) => sum + row.summary.toured, 0),
    [stackingPlanRows],
  );
  const totalProposalSuites = useMemo(
    () => stackingPlanRows.reduce((sum, row) => sum + row.summary.proposalActive, 0),
    [stackingPlanRows],
  );
  const activeReminderCount = useMemo(
    () => crmState.reminders.filter((reminder) => reminder.status === "open").length,
    [crmState.reminders],
  );

  const openDrillDownView = useCallback((input: {
    ref: MutableRefObject<HTMLDivElement | null>;
    nextView?: DealsViewMode;
    filtersPatch?: Partial<CrmFilters>;
    companyId?: string;
    buildingId?: string;
  }) => {
    if (input.nextView) setView(input.nextView);
    if (input.filtersPatch) {
      setFilters((prev) => ({
        ...prev,
        ...input.filtersPatch,
      }));
    }
    if (input.companyId) setSelectedCompanyId(input.companyId);
    if (input.buildingId) {
      const nextBuildingId = input.buildingId;
      setSelectedInventoryBuildingId(nextBuildingId);
      setFilters((prev) => ({ ...prev, buildingId: nextBuildingId }));
    }
    scrollToWorkspaceSection(input.ref);
  }, []);

  const commandMetricCards = useMemo(() => {
    if (isLandlordMode) {
      return [
        {
          label: "Vacant Suites",
          value: formatInt(totalVacantSuites),
          detail: "Open the stacking plan and inventory view for current availability.",
          tone: "warning" as const,
          onClick: () => openDrillDownView({ ref: pipelineViewsRef, nextView: "stacking_plan" }),
        },
        {
          label: "Tours Scheduled",
          value: formatInt(totalTourSuites),
          detail: "Jump to active building stacks and tour-driven suite activity.",
          tone: "accent" as const,
          onClick: () => openDrillDownView({ ref: pipelineViewsRef, nextView: "stacking_plan" }),
        },
        {
          label: "Proposals Outstanding",
          value: formatInt(totalProposalSuites),
          detail: "Review proposal-active suites and current leasing motion.",
          tone: "accent" as const,
          onClick: () => openDrillDownView({ ref: pipelineViewsRef, nextView: "stacking_plan" }),
        },
        {
          label: "Negotiations In Progress",
          value: formatInt(pipelineMetrics.open),
          detail: "Open the live deal board for active pursuits and negotiation flow.",
          tone: "neutral" as const,
          onClick: () => openDrillDownView({ ref: pipelineViewsRef, nextView: "board" }),
        },
      ];
    }

    return [
      {
        label: "Active Deals",
        value: formatInt(pipelineMetrics.open),
        detail: "Open the live pipeline board for in-flight tenant requirements.",
        tone: "accent" as const,
        onClick: () => openDrillDownView({ ref: pipelineViewsRef, nextView: "board" }),
      },
      {
        label: "Expiring Leases",
        value: formatInt(dashboard.upcomingExpirations),
        detail: "Jump to client records filtered for timing-driven lease events.",
        tone: "warning" as const,
        onClick: () => openDrillDownView({
          ref: relationshipGridRef,
          nextView: "client_grouped",
          filtersPatch: { expirationBucket: "18m" },
        }),
      },
      {
        label: "Touchpoints Due",
        value: formatInt(activeReminderCount),
        detail: "Open the follow-up engine to work the current reminder queue.",
        tone: "accent" as const,
        onClick: () => openDrillDownView({
          ref: followUpEngineRef,
          filtersPatch: { followUpState: "due_this_week" },
        }),
      },
      {
        label: "Stale Relationships",
        value: formatInt(dashboard.noTouchCompanies),
        detail: "Review accounts that need broker re-engagement before momentum slips.",
        tone: "neutral" as const,
        onClick: () => openDrillDownView({
          ref: relationshipGridRef,
          nextView: "client_grouped",
          filtersPatch: { followUpState: "no_touch_45" },
        }),
      },
    ];
  }, [
    activeReminderCount,
    dashboard.noTouchCompanies,
    dashboard.upcomingExpirations,
    isLandlordMode,
    openDrillDownView,
    pipelineMetrics.open,
    totalProposalSuites,
    totalTourSuites,
    totalVacantSuites,
  ]);

  return (
    <PlatformSection
      kicker="Deals"
      title={representationProfile.crm.commandCenterTitle}
      description={representationProfile.crm.commandCenterDescription}
      maxWidthClassName="max-w-[96vw]"
      headerAlign="center"
      actions={
        <div className="flex flex-wrap justify-center gap-2">
          {representationProfile.crm.availableViews.map((viewId) => (
            <button
              key={viewId}
              type="button"
              className={`btn-premium ${view === viewId ? "btn-premium-primary" : "btn-premium-secondary"}`}
              onClick={() => setView(viewId)}
            >
              {representationProfile.crm.viewLabels[viewId]}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-5">
        <PlatformDashboardTier
          label="Command Metrics"
          title="Command Center"
          description="The most important numbers surface first and every metric jumps straight into the relevant filtered workspace."
        >
          <PlatformMetricStrip>
            {commandMetricCards.map((card) => (
              <PlatformMetricCard
                key={card.label}
                label={card.label}
                value={card.value}
                detail={card.detail}
                tone={card.tone}
                onClick={card.onClick}
              />
            ))}
          </PlatformMetricStrip>
        </PlatformDashboardTier>

        <PlatformDashboardTier
          label="Insights"
          title="Mode-Aware Intelligence"
          description="Existing pipeline, timing, portfolio, and relationship signals are grouped here for faster scanning before you drop into detailed workspace views."
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PlatformInsightCard
              kicker="Pipeline Overview"
              title={isLandlordMode ? "Leasing Motion" : "Deal Activity"}
              description="Open pipeline performance and live workflow momentum."
              onClick={() => openDrillDownView({ ref: pipelineOverviewRef, nextView: isLandlordMode ? "board" : "board" })}
            >
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-slate-400">Total deals</p>
                  <p className="mt-2 text-2xl text-white">{formatInt(pipelineMetrics.total)}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-slate-400">Open pipeline</p>
                  <p className="mt-2 text-2xl text-white">{formatInt(pipelineMetrics.open)}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-slate-400">Won / executed</p>
                  <p className="mt-2 text-2xl text-white">{formatInt(pipelineMetrics.won)}</p>
                </div>
                <div className="border border-cyan-300/30 bg-cyan-500/10 p-3">
                  <p className="text-xs text-cyan-100">Open value</p>
                  <p className="mt-2 text-xl text-cyan-50">{formatCurrency(pipelineMetrics.pipelineValue)}</p>
                </div>
              </div>
            </PlatformInsightCard>

            <PlatformInsightCard
              kicker="Expiration Timeline"
              title={isLandlordMode ? "Expiration Pressure" : "Client Timing Pressure"}
              description="Lease events and notice pressure grouped into one clean timing snapshot."
              onClick={() => openDrillDownView({ ref: operatingLayerRef })}
            >
              <div className="space-y-3">
                {dashboard.expirationTimeline.length === 0 ? (
                  <p className="text-sm text-slate-400">No expiration data yet.</p>
                ) : (
                  dashboard.expirationTimeline.slice(0, 4).map((point) => (
                    <div key={point.label} className="grid grid-cols-[84px_1fr_auto] gap-3 items-center text-xs">
                      <span className="text-slate-300">{point.label}</span>
                      <div className="h-2 border border-white/10 bg-white/10">
                        <div className="h-full bg-cyan-300" style={{ width: `${Math.min(100, Math.max(10, point.count * 18))}%` }} />
                      </div>
                      <span className="text-white">{point.count}</span>
                    </div>
                  ))
                )}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {dashboard.expirationHeatmap.slice(0, 4).map((cell) => (
                    <div key={cell.label} className="border border-white/10 bg-black/20 p-2 text-center">
                      <p className="text-slate-400">{cell.label}</p>
                      <p className="mt-1 text-lg text-white">{cell.count}</p>
                    </div>
                  ))}
                </div>
              </div>
            </PlatformInsightCard>

            <PlatformInsightCard
              kicker={isLandlordMode ? "Portfolio Health" : "Relationship Queue"}
              title={isLandlordMode ? "Portfolio + Availability" : "Relationships + Coverage"}
              description={isLandlordMode ? "Buildings, class mix, and vacancy exposure." : "Accounts that need attention and the places where activity is concentrated."}
              onClick={() => openDrillDownView({ ref: isLandlordMode ? inventoryRef : relationshipGridRef, nextView: isLandlordMode ? "stacking_plan" : "client_grouped" })}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  {(isLandlordMode ? dashboard.concentrationByBuilding : dashboard.concentrationByMarket).slice(0, 4).map((entry) => (
                    <div key={entry.label} className="flex items-center justify-between gap-3 border border-white/10 bg-black/20 px-3 py-2">
                      <span className="text-slate-300">{entry.label}</span>
                      <span className="text-white">{formatInt(entry.count)}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 text-sm">
                  {isLandlordMode ? (
                    <>
                      <div className="border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs text-slate-400">Mapped buildings</p>
                        <p className="mt-1 text-xl text-white">{formatInt(buildingInventoryMetrics.mappedCount)}</p>
                      </div>
                      <div className="border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs text-slate-400">Curated photos</p>
                        <p className="mt-1 text-xl text-white">{formatInt(buildingInventoryMetrics.pinnedPhotoCount)}</p>
                      </div>
                    </>
                  ) : (
                    dashboard.relationshipQueue.slice(0, 3).map((company) => (
                      <div key={company.id} className="border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-sm text-white">{company.name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Critical {formatDate(company.noticeDeadline || company.currentLeaseExpiration || company.nextFollowUpDate)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </PlatformInsightCard>

            <PlatformInsightCard
              kicker="Next Actions"
              title={isLandlordMode ? "Leasing Action Queue" : "Broker Action Queue"}
              description="AI-guided priorities and the live reminder workload."
              onClick={() => openDrillDownView({ ref: followUpEngineRef })}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[0.9fr_1.1fr]">
                <div className="border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-slate-400">Open reminders</p>
                  <p className="mt-2 text-3xl text-white">{formatInt(activeReminderCount)}</p>
                  <p className="mt-2 text-xs text-slate-400">{representationProfile.crm.pipelineSyncText}</p>
                </div>
                <ul className="space-y-2 text-sm text-slate-200">
                  {aiRecommendations.slice(0, 4).map((item) => (
                    <li key={item} className="border border-white/10 bg-black/20 px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </PlatformInsightCard>
          </div>
        </PlatformDashboardTier>

        <PlatformDashboardTier
          label="Drill-Down Workspace"
          title="Detailed Records, Editors, and Workflow Views"
          description="Everything already built stays here, but it now sits below the command summary so you can scan first and drill down second."
        >
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div ref={operatingLayerRef} className="xl:col-span-12 scroll-mt-28">
              <PlatformPanel kicker="Operating Layer" title={representationProfile.crm.operatingLayerTitle}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="border border-white/15 bg-black/20 p-3">
                    <p className="heading-kicker mb-2">Mode Focus</p>
                    <p className="text-sm text-slate-100">{representationProfile.crm.operatingLayerFocus}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3">
                      {dashboardCards.map((card) => (
                        <div key={card.label} className="border border-white/10 bg-black/20 p-2">
                          <p className="text-[11px] text-slate-400">{card.label}</p>
                          <p className="mt-1 text-lg text-white">{formatInt(card.value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border border-white/15 bg-black/20 p-3">
                    <p className="heading-kicker mb-2">Relationship Queue</p>
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {dashboard.relationshipQueue.map((company) => (
                        <button key={company.id} type="button" onClick={() => setSelectedCompanyId(company.id)} className={`w-full border p-2 text-left ${selectedCompany?.id === company.id ? "border-cyan-300 bg-cyan-500/10" : "border-white/15 bg-black/25 hover:bg-white/5"}`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-white">{company.name}</p>
                            <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${companyTypeBadgeClass(company.type)}`}>{company.type.replace(/_/g, " ")}</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{[company.market, company.submarket].filter(Boolean).join(" / ") || "Unassigned"}</p>
                          <p className="text-xs text-slate-300 mt-1">Critical: {formatDate(company.noticeDeadline || company.currentLeaseExpiration || company.nextFollowUpDate)}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="border border-white/15 bg-black/20 p-3">
                    <p className="heading-kicker mb-2">Expiration Timeline</p>
                    <div className="space-y-2">
                      {dashboard.expirationTimeline.length === 0 ? <p className="text-xs text-slate-400">No expiration data yet.</p> : dashboard.expirationTimeline.map((point) => (
                        <div key={point.label} className="grid grid-cols-[110px_1fr_auto] gap-2 items-center text-xs">
                          <span className="text-slate-300">{point.label}</span>
                          <div className="h-2 bg-white/10 border border-white/10">
                            <div className="h-full bg-cyan-300" style={{ width: `${Math.min(100, point.count * 10)}%` }} />
                          </div>
                          <span className="text-white">{point.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border border-white/15 bg-black/20 p-3">
                    <p className="heading-kicker mb-2">Expiration Heatmap</p>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      {dashboard.expirationHeatmap.length === 0 ? <p className="text-slate-400 col-span-4">No heatmap data yet.</p> : dashboard.expirationHeatmap.slice(0, 12).map((cell) => (
                        <div key={cell.label} className="border border-white/15 bg-black/25 p-2 text-center">
                          <p className="text-slate-400">{cell.label}</p>
                          <p className="text-lg text-white mt-1">{cell.count}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </PlatformPanel>
            </div>

            <PlatformPanel kicker="CRM Intake" title={representationProfile.crm.intakeTitle} className="xl:col-span-4">
          <div className="grid grid-cols-1 gap-2">
            <input className="input-premium" placeholder="Company name" value={companyForm.name} onChange={(event) => setCompanyForm((prev) => ({ ...prev, name: event.target.value }))} />
            <select className="input-premium" value={companyForm.type} onChange={(event) => setCompanyForm((prev) => ({ ...prev, type: event.target.value }))}>
              <option value="prospect">Prospect</option>
              <option value="active_client">Active Client</option>
              <option value="former_client">Former Client</option>
              <option value="landlord">Landlord</option>
              <option value="tenant">Tenant</option>
              <option value="ownership_group">Ownership Group</option>
              <option value="other">Other</option>
            </select>
            <input className="input-premium" placeholder="Industry" value={companyForm.industry} onChange={(event) => setCompanyForm((prev) => ({ ...prev, industry: event.target.value }))} />
            <input className="input-premium" placeholder="Market" value={companyForm.market} onChange={(event) => setCompanyForm((prev) => ({ ...prev, market: event.target.value }))} />
            <input className="input-premium" placeholder="Submarket" value={companyForm.submarket} onChange={(event) => setCompanyForm((prev) => ({ ...prev, submarket: event.target.value }))} />
            <div className="space-y-2">
              <input
                className="input-premium"
                placeholder="Type building name or address"
                value={companyForm.buildingQuery}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setCompanyForm((prev) => {
                    const selectedName = selectedIntakeBuilding ? displayBuildingName(selectedIntakeBuilding) : "";
                    return {
                      ...prev,
                      buildingQuery: nextQuery,
                      buildingId: normalizeText(nextQuery) === normalizeText(selectedName) ? prev.buildingId : "",
                    };
                  });
                }}
              />
              {selectedIntakeBuilding ? (
                <div className="flex flex-col gap-2 border border-cyan-300/30 bg-cyan-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/80">Linked Building</p>
                    <p className="truncate text-sm text-white">{displayBuildingName(selectedIntakeBuilding)}</p>
                    <p className="truncate text-xs text-cyan-100/75">{[selectedIntakeBuilding.submarket, selectedIntakeBuilding.market, selectedIntakeBuilding.address].filter(Boolean).join(" • ") || "No location details yet"}</p>
                  </div>
                  <button type="button" className="btn-premium btn-premium-secondary min-h-[42px] px-4 py-2 text-xs sm:w-auto" onClick={clearIntakeBuildingSelection}>
                    Clear
                  </button>
                </div>
              ) : asText(companyForm.buildingQuery) ? (
                <div className="space-y-2 border border-white/10 bg-black/20 p-3">
                  {buildingAutocompleteSuggestions.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Matching Buildings</p>
                      <div className="grid gap-2">
                        {buildingAutocompleteSuggestions.map((building) => (
                          <button
                            key={building.id}
                            type="button"
                            className="flex min-h-[52px] flex-col items-start justify-center border border-white/10 bg-black/25 px-3 py-2 text-left transition hover:border-cyan-300/40 hover:bg-cyan-500/10"
                            onClick={() => applyIntakeBuildingSelection(building)}
                          >
                            <span className="text-sm text-white">{displayBuildingName(building)}</span>
                            <span className="text-xs text-slate-400">{[building.submarket, building.market, building.address].filter(Boolean).join(" • ") || "Existing building record"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No existing building matched that entry yet.</p>
                  )}
                  {showAddBuildingAction ? (
                    <button type="button" className="btn-premium btn-premium-secondary w-full" onClick={addIntakeBuilding}>
                      Add &quot;{asText(companyForm.buildingQuery)}&quot; as a building
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="px-1 text-xs text-slate-400">Start typing a building name to autofill an existing record or add a new one.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input-premium" placeholder="Floor" value={companyForm.floor} onChange={(event) => setCompanyForm((prev) => ({ ...prev, floor: event.target.value }))} />
              <input className="input-premium" placeholder="Suite" value={companyForm.suite} onChange={(event) => setCompanyForm((prev) => ({ ...prev, suite: event.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input-premium" placeholder="RSF" value={companyForm.squareFootage} onChange={(event) => setCompanyForm((prev) => ({ ...prev, squareFootage: event.target.value }))} />
              <input type="date" className="input-premium" value={companyForm.expirationDate} onChange={(event) => setCompanyForm((prev) => ({ ...prev, expirationDate: event.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input-premium" value={companyForm.nextFollowUpDate} onChange={(event) => setCompanyForm((prev) => ({ ...prev, nextFollowUpDate: event.target.value }))} />
              <input className="input-premium" placeholder="Relationship owner" value={companyForm.relationshipOwner} onChange={(event) => setCompanyForm((prev) => ({ ...prev, relationshipOwner: event.target.value }))} />
            </div>
            <textarea className="input-premium min-h-[92px]" placeholder="Notes" value={companyForm.notes} onChange={(event) => setCompanyForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-premium btn-premium-primary w-full" onClick={createCompanyProfile}>Create Profile</button>
            <button type="button" className="btn-premium btn-premium-secondary w-full" onClick={selectedCompany ? createDealFromCompany : undefined} disabled={!selectedCompany}>Open Deal</button>
          </div>
          <p className="mt-3 text-xs text-slate-400">{status}</p>
          {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
        </PlatformPanel>

        <PlatformPanel kicker="Filters" title={representationProfile.crm.filtersTitle} className="xl:col-span-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
            <input className="input-premium xl:col-span-2" placeholder="Search company, market, broker, stage" value={filters.query} onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))} />
            <select className="input-premium" value={filters.market} onChange={(event) => setFilters((prev) => ({ ...prev, market: event.target.value }))}>
              <option value="all">All markets</option>
              {marketOptions.map((market) => <option key={market} value={market}>{market}</option>)}
            </select>
            <select className="input-premium" value={filters.submarket} onChange={(event) => setFilters((prev) => ({ ...prev, submarket: event.target.value }))}>
              <option value="all">All submarkets</option>
              {submarketOptions.map((submarket) => <option key={submarket} value={submarket}>{submarket}</option>)}
            </select>
            <select className="input-premium" value={filters.buildingId} onChange={(event) => setFilters((prev) => ({ ...prev, buildingId: event.target.value }))}>
              <option value="all">All buildings</option>
              {buildingOptions.map((building) => <option key={building.id} value={building.id}>{[displayBuildingName(building), building.submarket].filter(Boolean).join(" - ")}</option>)}
            </select>
            <input className="input-premium" placeholder="Floor" value={filters.floor === "all" ? "" : filters.floor} onChange={(event) => setFilters((prev) => ({ ...prev, floor: event.target.value || "all" }))} />
            <input className="input-premium" placeholder="Suite" value={filters.suite === "all" ? "" : filters.suite} onChange={(event) => setFilters((prev) => ({ ...prev, suite: event.target.value || "all" }))} />
            <select className="input-premium" value={filters.companyType} onChange={(event) => setFilters((prev) => ({ ...prev, companyType: event.target.value }))}>
              <option value="all">All company types</option>
              <option value="prospect">Prospects</option>
              <option value="active_client">Active clients</option>
              <option value="former_client">Former clients</option>
              <option value="landlord">Landlords</option>
              <option value="tenant">Tenants</option>
              <option value="ownership_group">Ownership groups</option>
            </select>
            <select className="input-premium" value={filters.prospectStage} onChange={(event) => setFilters((prev) => ({ ...prev, prospectStage: event.target.value }))}>
              <option value="all">All stages</option>
              {Array.from(new Set(crmState.prospectingRecords.map((record) => record.prospectStage).filter(Boolean))).map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
            <select className="input-premium" value={filters.expirationBucket} onChange={(event) => setFilters((prev) => ({ ...prev, expirationBucket: event.target.value }))}>
              <option value="all">All expiration ranges</option>
              <option value="12m">Next 12 months</option>
              <option value="18m">Next 18 months</option>
              <option value="24m">Next 24 months</option>
              <option value="past_due">Past due</option>
            </select>
            <select className="input-premium" value={filters.followUpState} onChange={(event) => setFilters((prev) => ({ ...prev, followUpState: event.target.value }))}>
              <option value="all">All follow up states</option>
              <option value="due_this_week">Due this week</option>
              <option value="overdue">Overdue</option>
              <option value="no_touch_45">No touch 45+ days</option>
            </select>
          </div>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="border border-white/15 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Market Concentration</p>
              <div className="space-y-2 text-xs">
                {dashboard.concentrationByMarket.slice(0, 5).map((entry) => (
                  <div key={entry.label} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                    <span className="text-slate-300">{entry.label}</span>
                    <span className="text-slate-400">{formatInt(entry.count)}</span>
                    <span className="text-white">{formatInt(entry.rsf)} RSF</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-white/15 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Building Concentration</p>
              <div className="space-y-2 text-xs">
                {dashboard.concentrationByBuilding.slice(0, 5).map((entry) => (
                  <div key={entry.label} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                    <span className="text-slate-300">{entry.label}</span>
                    <span className="text-slate-400">{formatInt(entry.count)}</span>
                    <span className="text-white">{formatInt(entry.rsf)} RSF</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-white/15 bg-black/20 p-3">
              <p className="heading-kicker mb-2">AI Suggested Focus</p>
              <ul className="space-y-2 text-xs text-slate-200">
                {aiRecommendations.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </div>
          </div>
        </PlatformPanel>

            <div ref={inventoryRef} className="xl:col-span-12 scroll-mt-28">
        <PlatformPanel kicker="Austin Inventory" title="Austin Class A / B Building Map">
          <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.95fr] gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                <div className="border border-white/15 bg-black/20 p-3">
                  <p className="heading-kicker">Buildings</p>
                  <p className="mt-2 text-2xl text-white">{formatInt(displayedBuildings.length)}</p>
                </div>
                <div className="border border-white/15 bg-black/20 p-3">
                  <p className="heading-kicker">Mapped Pins</p>
                  <p className="mt-2 text-2xl text-white">{formatInt(buildingInventoryMetrics.mappedCount)}</p>
                </div>
                <div className="border border-white/15 bg-black/20 p-3">
                  <p className="heading-kicker">Curated Photos</p>
                  <p className="mt-2 text-2xl text-white">{formatInt(buildingInventoryMetrics.pinnedPhotoCount)}</p>
                </div>
                <div className="border border-white/15 bg-black/20 p-3">
                  <p className="heading-kicker">Inventory RSF</p>
                  <p className="mt-2 text-2xl text-white">{formatInt(buildingInventoryMetrics.totalRSF)}</p>
                </div>
                <div className="border border-white/15 bg-black/20 p-3">
                  <p className="heading-kicker">Class Mix</p>
                  <p className="mt-2 text-sm text-white">
                    {buildingInventoryMetrics.classBreakdown.length === 0
                      ? "-"
                      : buildingInventoryMetrics.classBreakdown.map(([label, count]) => `${label}: ${count}`).join(" / ")}
                  </p>
                </div>
              </div>
              <div className="border border-white/15 bg-black/20 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="heading-kicker">Property Browser</p>
                    <p className="mt-1 text-xs text-slate-400">Quickly narrow Austin inventory by name, class, photo coverage, map availability, and sort order.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "All", value: "all", count: buildingClassCounts.all },
                      { label: "Class A", value: "A", count: buildingClassCounts.A },
                      { label: "Class B", value: "B", count: buildingClassCounts.B },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setBuildingClassFilter(option.value)}
                        className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${
                          buildingClassFilter === option.value
                            ? "border-cyan-300 bg-cyan-500/15 text-cyan-100"
                            : "border-white/15 bg-black/30 text-slate-300 hover:bg-white/5"
                        }`}
                      >
                        {option.label} · {formatInt(option.count)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                  <input
                    className="input-premium"
                    placeholder="Search building, owner, address"
                    value={buildingSearch}
                    onChange={(event) => setBuildingSearch(event.target.value)}
                  />
                  <select className="input-premium" value={buildingPhotoFilter} onChange={(event) => setBuildingPhotoFilter(event.target.value)}>
                    <option value="all">All photo states</option>
                    <option value="with_default_photo">With curated / uploaded photo</option>
                    <option value="designated_cover_only">Missing curated photo</option>
                  </select>
                  <select className="input-premium" value={buildingMapFilter} onChange={(event) => setBuildingMapFilter(event.target.value)}>
                    <option value="all">All map states</option>
                    <option value="mapped_only">Mapped only</option>
                    <option value="unmapped_only">Unmapped only</option>
                  </select>
                  <select className="input-premium" value={buildingSort} onChange={(event) => setBuildingSort(event.target.value as BuildingSortOption)}>
                    <option value="featured">Sort: Featured</option>
                    <option value="name_asc">Sort: Name</option>
                    <option value="rsf_desc">Sort: Largest RSF</option>
                    <option value="stories_desc">Sort: Tallest</option>
                    <option value="year_desc">Sort: Newest</option>
                    <option value="submarket_asc">Sort: Submarket</option>
                  </select>
                </div>
              </div>
              <CrmBuildingInventoryMap
                buildings={displayedBuildings}
                selectedBuildingId={activeInventoryBuilding?.id || null}
                onSelectBuilding={(buildingId) => {
                  const building = crmState.buildings.find((entry) => entry.id === buildingId);
                  if (!building) return;
                  focusBuilding(building);
                }}
              />
            </div>
            <div className="border border-white/15 bg-black/20 p-3">
              <CrmBuildingInsightCard
                building={activeInventoryBuilding}
                onSavePhotoOverride={(payload) => {
                  if (!activeInventoryBuilding) return;
                  patchBuildingRecord(activeInventoryBuilding.id, {
                    photoOverrideUrl: payload.imageUrl,
                    photoOverrideSourceLabel: payload.sourceLabel,
                    photoOverrideSourceUrl: payload.sourceUrl || "",
                    photoOverrideUpdatedAt: new Date().toISOString(),
                  });
                  setBuildingPhotoStatus({
                    buildingId: activeInventoryBuilding.id,
                    message: `Saved workspace-default photo for ${displayBuildingName(activeInventoryBuilding)}.`,
                  });
                }}
                onClearPhotoOverride={() => {
                  if (!activeInventoryBuilding) return;
                  patchBuildingRecord(activeInventoryBuilding.id, {
                    photoOverrideUrl: "",
                    photoOverrideSourceLabel: "",
                    photoOverrideSourceUrl: "",
                    photoOverrideUpdatedAt: new Date().toISOString(),
                  });
                  setBuildingPhotoStatus({
                    buildingId: activeInventoryBuilding.id,
                    message: `Cleared workspace-default photo for ${displayBuildingName(activeInventoryBuilding)}.`,
                  });
                }}
                statusMessage={buildingPhotoStatus.buildingId === activeInventoryBuilding?.id ? buildingPhotoStatus.message : ""}
              />
              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <p className="heading-kicker">Building Inventory</p>
                  <p className="mt-2 text-xs text-slate-300">Powered by the shared CoStar-backed building inventory. Select a tower pin or building card to open a richer property profile here.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(filters.buildingId !== "all" || selectedInventoryBuildingId) ? (
                    <button type="button" className="btn-premium btn-premium-secondary !px-3 !py-2" onClick={() => {
                      setSelectedInventoryBuildingId("");
                      setFilters((prev) => ({ ...prev, buildingId: "all" }));
                    }}>
                      Clear selected building
                    </button>
                  ) : null}
                  {(buildingSearch || buildingClassFilter !== "all" || buildingPhotoFilter !== "all" || buildingMapFilter !== "all" || buildingSort !== "featured") ? (
                    <button type="button" className="btn-premium btn-premium-secondary !px-3 !py-2" onClick={() => {
                      setBuildingSearch("");
                      setBuildingClassFilter("all");
                      setBuildingPhotoFilter("all");
                      setBuildingMapFilter("all");
                      setBuildingSort("featured");
                    }}>
                      Reset property filters
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {displayedBuildings.length === 0 ? <p className="text-sm text-slate-400">No buildings match the current inventory filters.</p> : displayedBuildings.map((building, index) => (
                  <button
                    key={building.id}
                    type="button"
                    onClick={() => focusBuilding(building)}
                    className={`w-full border p-3 text-left transition ${activeInventoryBuilding?.id === building.id ? "border-cyan-300 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]" : "border-white/15 bg-black/25 hover:bg-white/5"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-white/15 bg-white/5 px-2 text-[10px] uppercase tracking-[0.12em] text-slate-300">
                            {formatInt(index + 1)}
                          </span>
                          <p className="text-sm text-white">{displayBuildingName(building)}</p>
                          <span className="border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-200">{building.buildingClass || "Unclassified"}</span>
                          <span className="border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-300">{building.buildingStatus || "Building"}</span>
                          <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${hasCuratedBuildingPhoto(building) ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" : "border-amber-300/40 bg-amber-500/10 text-amber-100"}`}>
                            {hasCuratedBuildingPhoto(building) ? "Photo Ready" : "Photo Needed"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{[building.address, building.submarket, building.market].filter(Boolean).join(" / ") || "Austin office inventory"}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                          <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">RSF</p>
                            <p className="mt-1 text-white">{formatInt(building.totalRSF)}</p>
                          </div>
                          <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Stories</p>
                            <p className="mt-1 text-white">{building.numberOfStories ? formatInt(building.numberOfStories) : "-"}</p>
                          </div>
                          <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Built</p>
                            <p className="mt-1 text-white">{building.yearBuilt || "-"}</p>
                          </div>
                          <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
                            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Parking</p>
                            <p className="mt-1 text-white">{building.parkingRatio ? `${formatDecimal(building.parkingRatio, 2)} / 1,000` : "-"}</p>
                          </div>
                        </div>
                      </div>
                      <div className="min-w-[148px] text-right text-xs text-slate-300">
                        <p className="text-white">{building.ownerName || "Owner pending"}</p>
                        <p className="mt-1 text-slate-400">{building.leasingCompanyName || "Leasing pending"}</p>
                        <p className={`mt-3 inline-flex rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${Number.isFinite(building.latitude) && Number.isFinite(building.longitude) ? "border-cyan-300/40 bg-cyan-500/10 text-cyan-100" : "border-white/15 bg-white/5 text-slate-300"}`}>
                          {Number.isFinite(building.latitude) && Number.isFinite(building.longitude) ? "Map ready" : "No coordinates"}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </PlatformPanel>
            </div>

            <div ref={relationshipGridRef} className="xl:col-span-7 scroll-mt-28">
        <PlatformPanel kicker="Relationship Grid" title={representationProfile.crm.relationshipGridTitle}>
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {filteredCompanies.length === 0 ? <p className="text-sm text-slate-400">No profiles match the current filters.</p> : [...filteredCompanies].sort(compareByCriticalDate).map((company) => {
              const prospecting = crmState.prospectingRecords.find((record) => record.companyId === company.id);
              const companyBuilding = crmState.buildings.find((building) => building.id === company.buildingId);
              return (
                <button key={company.id} type="button" onClick={() => setSelectedCompanyId(company.id)} className={`w-full border p-3 text-left ${selectedCompany?.id === company.id ? "border-cyan-300 bg-cyan-500/10" : "border-white/15 bg-black/20 hover:bg-white/5"}`}>
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-white">{company.name}</p>
                        <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${companyTypeBadgeClass(company.type)}`}>{company.type.replace(/_/g, " ")}</span>
                        <span className="border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-300">{prospecting?.prospectStage || company.prospectStatus || "Managed"}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{[company.market, company.submarket].filter(Boolean).join(" / ") || "Unassigned market"}</p>
                      <p className="text-xs text-slate-300 mt-1">{[companyBuilding?.name, company.floor, company.suite].filter(Boolean).join(" • ") || "Location pending"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-right min-w-[240px]">
                      <p className="text-slate-400">Expiration <span className="text-slate-100">{formatDate(company.currentLeaseExpiration)}</span></p>
                      <p className="text-slate-400">Notice <span className="text-slate-100">{formatDate(company.noticeDeadline)}</span></p>
                      <p className="text-slate-400">Last touch <span className="text-slate-100">{formatDate(company.lastTouchDate)}</span></p>
                      <p className="text-slate-400">Next follow up <span className="text-slate-100">{formatDate(company.nextFollowUpDate)}</span></p>
                      <p className="text-slate-400">Docs <span className="text-slate-100">{company.linkedDocumentIds.length}</span></p>
                      <p className="text-slate-400">Deals <span className="text-slate-100">{company.linkedDealIds.length}</span></p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </PlatformPanel>
            </div>

        <PlatformPanel kicker="Location Intelligence" title={representationProfile.crm.locationIntelligenceTitle} className="xl:col-span-5">
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {dashboard.locationHierarchy.length === 0 ? <p className="text-sm text-slate-400">No hierarchical occupancy data yet.</p> : dashboard.locationHierarchy.map((marketGroup) => (
              <div key={marketGroup.market} className="border border-white/15 bg-black/20 p-3">
                <p className="text-sm text-white">{marketGroup.market}</p>
                <div className="mt-2 space-y-2">
                  {marketGroup.submarkets.map((submarketGroup) => (
                    <div key={`${marketGroup.market}-${submarketGroup.submarket}`} className="border border-white/10 bg-black/20 p-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-300">{submarketGroup.submarket}</p>
                      <div className="mt-2 space-y-2">
                        {submarketGroup.buildings.map((buildingGroup) => (
                          <div key={buildingGroup.buildingId} className="border border-white/10 bg-black/25 p-2">
                            <p className="text-xs text-white">{buildingGroup.buildingName}</p>
                            {buildingGroup.floors.length === 0 ? (
                              <p className="mt-2 text-[11px] text-slate-400">No tracked occupancies yet. Building inventory is loaded and ready for company / suite attachment.</p>
                            ) : (
                              <div className="mt-2 space-y-2">
                                {buildingGroup.floors.map((floorGroup) => (
                                  <div key={`${buildingGroup.buildingId}-${floorGroup.floor}`}>
                                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Floor {floorGroup.floor}</p>
                                    <div className="mt-1 space-y-1">
                                      {floorGroup.suites.map((suite) => (
                                        <button key={`${suite.companyId}-${suite.suite}`} type="button" onClick={() => setSelectedCompanyId(suite.companyId)} className="w-full border border-white/10 bg-black/25 px-2 py-1 text-left text-xs hover:bg-white/5">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-slate-100">Suite {suite.suite} · {suite.companyName}</span>
                                            <span className="text-slate-400">{formatDate(suite.expirationDate)}</span>
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </PlatformPanel>

            <div ref={followUpEngineRef} className="xl:col-span-12 scroll-mt-28">
        <PlatformPanel kicker="Follow Up Engine" title={representationProfile.crm.followUpTitle}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="border border-white/15 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Reminder Queue</p>
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {crmState.reminders.filter((reminder) => reminder.status === "open").slice(0, 12).map((reminder) => (
                  <div key={reminder.id} className={`border p-2 ${reminderToneClass(reminder)}`}>
                    <p className="text-xs font-medium">{reminder.message}</p>
                    <p className="mt-1 text-[11px] opacity-80">{reminder.triggerLogic} · {formatDate(reminder.triggerDate)}</p>
                    <button type="button" className="mt-2 text-[11px] uppercase tracking-[0.12em] text-white/80 hover:text-white" onClick={() => dismissReminder(reminder.id)}>Dismiss</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-white/15 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Task Queue</p>
              <div className="flex gap-2">
                <input className="input-premium" placeholder="Add follow up task" value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} />
                <button type="button" className="btn-premium btn-premium-primary" onClick={() => addCrmTask(taskDraft, selectedCompany?.nextFollowUpDate || "")}>Add</button>
              </div>
              <div className="mt-3 space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {crmState.tasks.length === 0 ? <p className="text-xs text-slate-400">No CRM tasks yet.</p> : crmState.tasks.slice(0, 12).map((task) => (
                  <div key={task.id} className="border border-white/15 bg-black/25 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-white">{task.title}</p>
                      <span className={`border px-1 py-[2px] text-[10px] uppercase tracking-[0.12em] ${task.priority === "critical" ? "border-red-300/50 text-red-100" : task.priority === "high" ? "border-amber-300/50 text-amber-100" : "border-white/20 text-slate-300"}`}>{task.priority}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">Due {formatDate(task.dueDate)} · {task.owner}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-white/15 bg-black/20 p-3">
              <p className="heading-kicker mb-2">AI Outreach Studio</p>
              <select className="input-premium" value={selectedTemplateId || crmState.templates[0]?.id || ""} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                {crmState.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              <button type="button" className="btn-premium btn-premium-primary mt-3 w-full" onClick={createOutreachDraft} disabled={!selectedCompany}>Generate Draft</button>
              {generatedDraftStatus ? <p className="mt-2 text-xs text-cyan-200">{generatedDraftStatus}</p> : null}
              {generatedDraft ? (
                <div className="mt-3 border border-white/15 bg-black/25 p-3 space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Subject</p>
                  <p className="text-sm text-white">{generatedDraft.subject || "-"}</p>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Body</p>
                  <pre className="whitespace-pre-wrap text-xs text-slate-200 font-sans">{generatedDraft.body}</pre>
                  <p className="text-xs text-cyan-100">{generatedDraft.recommendation}</p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-400">Select a company profile to generate follow up messaging.</p>
              )}
            </div>
          </div>
        </PlatformPanel>
            </div>

            <div ref={profileWorkspaceRef} className="xl:col-span-12 scroll-mt-28">
        <PlatformPanel
          kicker="Profile Workspace"
          title={isLandlordMode ? (activeInventoryBuilding?.name || representationProfile.crm.profileWorkspaceTitle) : (selectedCompany ? selectedCompany.name : representationProfile.crm.profileWorkspaceTitle)}
        >
          {isLandlordMode ? (
            !activeInventoryBuilding || !activeBuildingSummary || !activeStackingBuildingRow ? (
              <p className="text-sm text-slate-400">Select a building from the inventory or stacking plan to inspect the full operating hub.</p>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className="xl:col-span-4 border border-white/15 bg-black/20 p-3 space-y-3">
                  <p className="heading-kicker">Building Overview</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Building</p><p className="mt-1 text-white">{activeBuildingSummary.buildingName}</p></div>
                    <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Submarket</p><p className="mt-1 text-white">{activeInventoryBuilding.submarket || "-"}</p></div>
                    <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Total Suites</p><p className="mt-1 text-white">{formatInt(activeBuildingSummary.totalSuites)}</p></div>
                    <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Vacant Suites</p><p className="mt-1 text-white">{formatInt(activeBuildingSummary.vacantSuites)}</p></div>
                    <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Expiring</p><p className="mt-1 text-white">{formatInt(activeBuildingSummary.expiringSuites)}</p></div>
                    <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Proposal Active</p><p className="mt-1 text-white">{formatInt(activeBuildingSummary.proposalSuites)}</p></div>
                  </div>
                  <div className="border border-white/15 bg-black/20 p-3 text-xs text-slate-300">
                    <p className="text-white">{activeInventoryBuilding.address || "Address pending"}</p>
                    <p className="mt-1">{[activeInventoryBuilding.market, activeInventoryBuilding.submarket].filter(Boolean).join(" / ") || "Austin inventory"}</p>
                    <p className="mt-2">Ownership: <span className="text-white">{activeInventoryBuilding.ownerName || "Pending"}</span></p>
                    <p className="mt-1">Leasing: <span className="text-white">{activeInventoryBuilding.leasingCompanyName || "Pending"}</span></p>
                  </div>
                </div>

                <div className="xl:col-span-8 space-y-4">
                  <CrmBuildingStackingPlan
                    building={activeInventoryBuilding}
                    row={activeStackingBuildingRow}
                    companies={attachableCompanyOptions}
                    onSaveEntry={saveStackingPlanEntry}
                  />

                  <div className="border border-white/15 bg-black/20 p-3">
                    <p className="heading-kicker mb-2">Next Best Actions</p>
                    <ul className="space-y-2 text-xs text-slate-200">
                      {aiRecommendations.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                    <div className="mt-4 border-t border-white/15 pt-3">
                      <p className="heading-kicker mb-2">Suggested AI Commands</p>
                      <div className="space-y-2">
                        {representationProfile.ai.suggestedPrompts.map((prompt) => (
                          <div key={prompt} className="border border-white/10 bg-black/25 p-2 text-xs text-slate-300">
                            {prompt}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : !selectedCompany ? (
            <p className="text-sm text-slate-400">Select a prospect or client profile to inspect the full command center view.</p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-4 border border-white/15 bg-black/20 p-3 space-y-3">
                <p className="heading-kicker">Overview</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="text-slate-400">Company
                    <input className="input-premium mt-1 !py-2" value={selectedCompany.name} onChange={(event) => patchSelectedCompany({ name: event.target.value })} />
                  </label>
                  <label className="text-slate-400">Type
                    <select className="input-premium mt-1 !py-2" value={selectedCompany.type} onChange={(event) => patchSelectedCompany({ type: event.target.value as CrmCompany["type"] })}>
                      <option value="prospect">Prospect</option>
                      <option value="active_client">Active Client</option>
                      <option value="former_client">Former Client</option>
                      <option value="landlord">Landlord</option>
                      <option value="tenant">Tenant</option>
                      <option value="ownership_group">Ownership Group</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="text-slate-400">Market
                    <input className="input-premium mt-1 !py-2" value={selectedCompany.market} onChange={(event) => patchSelectedCompany({ market: event.target.value })} />
                  </label>
                  <label className="text-slate-400">Submarket
                    <input className="input-premium mt-1 !py-2" value={selectedCompany.submarket} onChange={(event) => patchSelectedCompany({ submarket: event.target.value })} />
                  </label>
                  <label className="text-slate-400">Floor
                    <input className="input-premium mt-1 !py-2" value={selectedCompany.floor} onChange={(event) => patchSelectedCompany({ floor: event.target.value })} />
                  </label>
                  <label className="text-slate-400">Suite
                    <input className="input-premium mt-1 !py-2" value={selectedCompany.suite} onChange={(event) => patchSelectedCompany({ suite: event.target.value })} />
                  </label>
                  <label className="text-slate-400">Expiration
                    <input type="date" className="input-premium mt-1 !py-2" value={selectedCompany.currentLeaseExpiration} onChange={(event) => patchSelectedCompany({ currentLeaseExpiration: event.target.value })} />
                  </label>
                  <label className="text-slate-400">Next follow up
                    <input type="date" className="input-premium mt-1 !py-2" value={selectedCompany.nextFollowUpDate} onChange={(event) => patchSelectedCompany({ nextFollowUpDate: event.target.value })} />
                  </label>
                </div>
                <textarea className="input-premium min-h-[96px]" value={selectedCompany.notes} onChange={(event) => patchSelectedCompany({ notes: event.target.value })} />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Location</p><p className="text-white mt-1">{tenantHubSummary?.locationLabel || "Pending"}</p></div>
                  <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Square Footage</p><p className="text-white mt-1">{formatInt(tenantHubSummary?.squareFootage || 0)}</p></div>
                  <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Docs</p><p className="text-white mt-1">{formatInt(tenantHubSummary?.linkedDocuments || 0)}</p></div>
                  <div className="border border-white/15 bg-black/20 p-2"><p className="text-slate-400">Deals</p><p className="text-white mt-1">{formatInt(tenantHubSummary?.linkedDeals || 0)}</p></div>
                </div>
              </div>

              <div className="xl:col-span-4 border border-white/15 bg-black/20 p-3">
                <p className="heading-kicker mb-2">Occupancy + Relationship</p>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {selectedCompanyOccupancies.length === 0 ? <p className="text-xs text-slate-400">No occupancy records yet.</p> : selectedCompanyOccupancies.map((record) => (
                    <div key={record.id} className="border border-white/15 bg-black/25 p-2 text-xs">
                      <p className="text-white">{selectedCompanyBuilding?.name || crmState.buildings.find((building) => building.id === record.buildingId)?.name || "Building pending"}</p>
                      <p className="mt-1 text-slate-300">Floor {record.floor || "-"} · Suite {record.suite || "-"} · {formatInt(record.rsf)} RSF</p>
                      <p className="mt-1 text-slate-400">{record.rentType} · Base {formatCurrency(record.baseRent)} · OpEx {formatCurrency(record.opex)}</p>
                      <p className="mt-1 text-slate-400">Start {formatDate(record.leaseStart)} · Exp {formatDate(record.leaseExpiration)} · Notice {formatDate(record.noticeDeadline)}</p>
                      {(record.abatementMonths || record.tiAllowance || asText(record.concessions)) ? (
                        <p className="mt-1 text-slate-400">
                          {[
                            record.abatementMonths ? `${formatInt(record.abatementMonths)} mo abatement` : "",
                            record.tiAllowance ? `TI ${formatCurrency(record.tiAllowance)}` : "",
                            asText(record.concessions) ? `Concessions: ${record.concessions}` : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-white/15 pt-3 text-xs text-slate-300 space-y-2">
                  <p>Relationship Stage: <span className="text-white">{selectedCompanyRelationship?.relationshipStage || "Managed"}</span></p>
                  <p>Renewal Risk: <span className="text-white">{selectedCompanyRelationship?.renewalRisk || "Monitor"}</span></p>
                  <p>Churn Risk: <span className="text-white">{selectedCompanyRelationship?.churnRisk || "Monitor"}</span></p>
                  <p>Expansion Potential: <span className="text-white">{selectedCompanyRelationship?.expansionPotential || "Monitor"}</span></p>
                  <label className="block text-slate-400">Prospect Stage
                    <input className="input-premium mt-1 !py-2" value={selectedCompanyProspecting?.prospectStage || selectedCompany.prospectStatus} onChange={(event) => {
                      patchProspectingRecord({ prospectStage: event.target.value });
                      patchSelectedCompany({ prospectStatus: event.target.value });
                    }} />
                  </label>
                </div>
              </div>

              <div className="xl:col-span-4 border border-white/15 bg-black/20 p-3">
                <p className="heading-kicker mb-2">Follow Ups + Touchpoints</p>
                <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                  {selectedCompanyReminders.length === 0 ? <p className="text-xs text-slate-400">No open reminders for this profile.</p> : selectedCompanyReminders.map((reminder) => (
                    <div key={reminder.id} className={`border p-2 text-xs ${reminderToneClass(reminder)}`}>
                      <p>{reminder.message}</p>
                      <p className="mt-1 opacity-80">{formatDate(reminder.triggerDate)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <textarea className="input-premium min-h-[84px]" placeholder="Log call note, email, or follow up summary" value={touchpointDraft} onChange={(event) => setTouchpointDraft(event.target.value)} />
                </div>
                <button type="button" className="btn-premium btn-premium-primary mt-2 w-full" onClick={addTouchpoint}>Log Touchpoint</button>
                <div className="mt-3 space-y-2 max-h-[180px] overflow-y-auto pr-1">
                  {crmState.touchpoints.filter((touchpoint) => touchpoint.companyId === selectedCompany.id).length === 0 ? <p className="text-xs text-slate-400">No touchpoints yet.</p> : crmState.touchpoints.filter((touchpoint) => touchpoint.companyId === selectedCompany.id).slice(0, 8).map((touchpoint) => (
                    <div key={touchpoint.id} className="border border-white/15 bg-black/25 p-2 text-xs">
                      <p className="text-white">{touchpoint.summary}</p>
                      <p className="mt-1 text-slate-400">{formatDateTime(touchpoint.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="xl:col-span-6 border border-white/15 bg-black/20 p-3">
                <p className="heading-kicker mb-2">Documents + Intelligence</p>
                <ClientDocumentPicker
                  buttonLabel="Attach Existing Document"
                  onSelectDocument={(document) => {
                    if (!selectedCompany) return;
                    updateDocument(document.id, { companyId: selectedCompany.id });
                    patchSelectedCompany({ linkedDocumentIds: Array.from(new Set([...(selectedCompany.linkedDocumentIds || []), document.id])) });
                    setStatus(`Attached ${document.name} to ${selectedCompany.name}.`);
                  }}
                />
                <div className="mt-3 space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {selectedCompanyDocuments.length === 0 ? <p className="text-xs text-slate-400">No linked documents yet.</p> : selectedCompanyDocuments.map((document) => (
                    <div key={document.id} className="border border-white/15 bg-black/25 p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-white break-all">{document.name}</p>
                          <p className="mt-1 text-slate-400">
                            {[document.type, document.building, document.suite ? `Suite ${document.suite}` : ""].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="text-[10px] uppercase tracking-[0.12em] text-slate-300 hover:text-white"
                          onClick={() => {
                            if (!selectedCompany) return;
                            updateDocument(document.id, { companyId: "" });
                            patchSelectedCompany({
                              linkedDocumentIds: selectedCompany.linkedDocumentIds.filter((documentId) => documentId !== document.id),
                            });
                          }}
                        >
                          Detach
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="xl:col-span-6 border border-white/15 bg-black/20 p-3">
                <p className="heading-kicker mb-2">Deals + Recommended Actions</p>
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {selectedCompanyDeals.length === 0 ? <p className="text-xs text-slate-400">No linked deals yet.</p> : selectedCompanyDeals.map((deal) => (
                    <button key={deal.id} type="button" onClick={() => setSelectedDealId(deal.id)} className="w-full border border-white/15 bg-black/25 p-2 text-left text-xs hover:bg-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-white">{deal.dealName}</p>
                        <span className={`border px-1 py-[2px] text-[10px] uppercase tracking-[0.12em] ${priorityBadgeClass(deal.priority)}`}>{deal.priority}</span>
                      </div>
                      <p className="mt-1 text-slate-400">{deal.stage} · {deal.status.replace(/_/g, " ")} · {formatCurrency(deal.budget)}</p>
                    </button>
                  ))}
                </div>
                <div className="mt-3 border-t border-white/15 pt-3">
                  <p className="heading-kicker mb-2">Recommended Next Actions</p>
                  <ul className="space-y-2 text-xs text-slate-200">
                    {aiRecommendations.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </PlatformPanel>
            </div>

            <div ref={pipelineOverviewRef} className="xl:col-span-12 scroll-mt-28">
        <PlatformPanel kicker="Pipeline Overview" title={`${asText(clientName) || "Active Workspace"} Brokerage Pipeline`}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
            <div className="border border-white/15 bg-black/25 p-3"><p className="text-xs text-slate-400">Total deals</p><p className="text-2xl text-white">{pipelineMetrics.total}</p></div>
            <div className="border border-white/15 bg-black/25 p-3"><p className="text-xs text-slate-400">Open</p><p className="text-2xl text-white">{pipelineMetrics.open}</p></div>
            <div className="border border-white/15 bg-black/25 p-3"><p className="text-xs text-slate-400">Won</p><p className="text-2xl text-white">{pipelineMetrics.won}</p></div>
            <div className="border border-white/15 bg-black/25 p-3"><p className="text-xs text-slate-400">Open pipeline value</p><p className="text-2xl text-white">{formatCurrency(pipelineMetrics.pipelineValue)}</p></div>
            <div className="border border-cyan-300/30 bg-cyan-500/5 p-3"><p className="heading-kicker mb-1">Workflow Sync</p><p className="text-xs text-slate-200">{representationProfile.crm.pipelineSyncText}</p></div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input className="input-premium sm:max-w-md" placeholder="Search deals by name, market, property, city" value={pipelineQuery} onChange={(event) => setPipelineQuery(event.target.value)} />
            <p className="text-xs text-slate-400">Drag any deal card and drop into a stage column to move it.</p>
          </div>
        </PlatformPanel>
            </div>

        <PlatformPanel kicker="Create Deal" title="Quick Deal Intake" className="xl:col-span-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="input-premium sm:col-span-2" placeholder="Deal name*" value={form.dealName} onChange={(event) => setForm((prev) => ({ ...prev, dealName: event.target.value }))} />
            <input className="input-premium sm:col-span-2" placeholder={representationProfile.crm.quickDealRequirementPlaceholder} value={form.requirementName} onChange={(event) => setForm((prev) => ({ ...prev, requirementName: event.target.value }))} />
            <select className="input-premium" value={form.stage} onChange={(event) => setForm((prev) => ({ ...prev, stage: event.target.value }))}>{dealStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select>
            <select className="input-premium" value={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as ClientWorkspaceDeal["priority"] }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <input className="input-premium" placeholder="City" value={form.city} onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))} />
            <input className="input-premium" placeholder="Target market" value={form.targetMarket} onChange={(event) => setForm((prev) => ({ ...prev, targetMarket: event.target.value }))} />
            <input className="input-premium" placeholder="Min SF" value={form.squareFootageMin} onChange={(event) => setForm((prev) => ({ ...prev, squareFootageMin: event.target.value }))} />
            <input className="input-premium" placeholder="Max SF" value={form.squareFootageMax} onChange={(event) => setForm((prev) => ({ ...prev, squareFootageMax: event.target.value }))} />
            <input className="input-premium sm:col-span-2" placeholder="Budget" value={form.budget} onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))} />
          </div>
          <details className="mt-3 border border-white/15 bg-black/20 p-2">
            <summary className="cursor-pointer text-xs text-slate-300 tracking-[0.12em] uppercase">Advanced Fields</summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <input className="input-premium" placeholder="Submarket" value={form.submarket} onChange={(event) => setForm((prev) => ({ ...prev, submarket: event.target.value }))} />
              <input className="input-premium" placeholder="Deal type" value={form.dealType} onChange={(event) => setForm((prev) => ({ ...prev, dealType: event.target.value }))} />
              <input className="input-premium" placeholder={representationProfile.crm.quickDealBrokerPlaceholder} value={form.tenantRepBroker} onChange={(event) => setForm((prev) => ({ ...prev, tenantRepBroker: event.target.value }))} />
              <input className="input-premium" placeholder="Selected property" value={form.selectedProperty} onChange={(event) => setForm((prev) => ({ ...prev, selectedProperty: event.target.value }))} />
              <input className="input-premium" placeholder="Selected suite" value={form.selectedSuite} onChange={(event) => setForm((prev) => ({ ...prev, selectedSuite: event.target.value }))} />
              <input className="input-premium" placeholder={representationProfile.crm.quickDealCounterpartyPlaceholder} value={form.selectedLandlord} onChange={(event) => setForm((prev) => ({ ...prev, selectedLandlord: event.target.value }))} />
              <input type="date" className="input-premium" value={form.occupancyDateGoal} onChange={(event) => setForm((prev) => ({ ...prev, occupancyDateGoal: event.target.value }))} />
              <input type="date" className="input-premium" value={form.expirationDate} onChange={(event) => setForm((prev) => ({ ...prev, expirationDate: event.target.value }))} />
              <textarea className="input-premium sm:col-span-2 min-h-[70px]" placeholder="Notes" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </div>
          </details>
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-premium btn-premium-primary" onClick={createDealFromForm}>Create Deal</button>
          </div>
        </PlatformPanel>

            <div ref={pipelineViewsRef} className="xl:col-span-12 scroll-mt-28">
        <PlatformPanel kicker="Pipeline Views" title={isLandlordMode ? "Leasing Flow" : "Deal Flow"}>
          {view === "stacking_plan" ? (
            <div className="space-y-4">
              {stackingPlanRows.length === 0 ? <p className="text-sm text-slate-400">No suite or occupancy records match the current building filters.</p> : stackingPlanRows.map((buildingRow) => (
                <div key={buildingRow.buildingId} className={`border p-3 ${activeStackingBuildingRow?.buildingId === buildingRow.buildingId ? "border-cyan-300 bg-cyan-500/10" : "border-white/15 bg-black/20"}`}>
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm text-white">{buildingRow.buildingName}</p>
                      <p className="mt-1 text-xs text-slate-400">{[buildingRow.market, buildingRow.submarket].filter(Boolean).join(" / ") || "Austin portfolio"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3 xl:grid-cols-5">
                      <div className="border border-white/10 bg-black/25 px-2 py-1 text-slate-300">Occ <span className="text-white">{formatInt(buildingRow.summary.occupied)}</span></div>
                      <div className="border border-white/10 bg-black/25 px-2 py-1 text-slate-300">Vac <span className="text-white">{formatInt(buildingRow.summary.vacant)}</span></div>
                      <div className="border border-white/10 bg-black/25 px-2 py-1 text-slate-300">Exp <span className="text-white">{formatInt(buildingRow.summary.expiring)}</span></div>
                      <div className="border border-white/10 bg-black/25 px-2 py-1 text-slate-300">Prop <span className="text-white">{formatInt(buildingRow.summary.proposalActive)}</span></div>
                      <div className="border border-white/10 bg-black/25 px-2 py-1 text-slate-300">Tours <span className="text-white">{formatInt(buildingRow.summary.toured)}</span></div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {buildingRow.floors.map((floorGroup) => (
                      <div key={`${buildingRow.buildingId}-${floorGroup.floor}`} className="border border-white/10 bg-black/25 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-slate-300">Floor {floorGroup.floor}</p>
                        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3 xl:grid-cols-4">
                          {floorGroup.suites.map((suite) => (
                            <div key={`${buildingRow.buildingId}-${floorGroup.floor}-${suite.suite}`} className="border border-white/10 bg-black/25 p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-white">Suite {suite.suite}</p>
                                <span className={`border px-2 py-0.5 uppercase tracking-[0.12em] ${
                                  suite.status === "vacant" ? "border-amber-300/50 text-amber-100" :
                                    suite.status === "proposal_active" ? "border-cyan-300/50 text-cyan-100" :
                                      suite.status === "toured" ? "border-indigo-300/50 text-indigo-100" :
                                        suite.status === "expiring" ? "border-rose-300/50 text-rose-100" :
                                          "border-emerald-300/50 text-emerald-100"
                                }`}>
                                  {suite.status.replace(/_/g, " ")}
                                </span>
                              </div>
                              <p className="mt-1 text-slate-300">{suite.companyName || "Vacant / unassigned"}</p>
                              <p className="mt-1 text-slate-400">{formatInt(suite.rsf)} RSF {suite.expirationDate ? `· Exp ${formatDate(suite.expirationDate)}` : ""}</p>
                              <p className="mt-1 text-slate-400">Proposals {suite.proposalCount} · {suite.toured ? "Toured" : "No tour logged"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {view === "board" ? (
            <div>
              <div className="overflow-x-auto">
                <div className="grid gap-3 pb-2 [grid-template-columns:repeat(var(--stage-count),minmax(220px,1fr))]" style={boardGridStyle}>
                  {dealStages.map((stage) => {
                    const stageDeals = filteredDeals.filter((deal) => asText(deal.stage) === stage);
                    const isDropActive = dragOverStage === stage;
                    return (
                      <div key={stage} className={`min-h-[420px] border p-3 transition-colors ${isDropActive ? "border-cyan-300 bg-cyan-500/10" : "border-white/15 bg-black/20"}`} onDragEnter={(event) => { event.preventDefault(); setDragOverStage(stage); }} onDragOver={(event) => { event.preventDefault(); setDragOverStage(stage); }} onDragLeave={(event) => { event.preventDefault(); if (dragOverStage === stage) setDragOverStage(""); }} onDrop={(event) => { event.preventDefault(); handleDropToStage(stage); }}>
                        <div className="mb-3 flex items-center justify-between border-b border-white/15 pb-2"><p className="text-sm text-white">{stage}</p><span className="text-xs text-slate-300">{stageCounts.get(stage) || 0}</span></div>
                        <div className="space-y-2">
                          {stageDeals.length === 0 ? <p className="text-xs text-slate-500">Drop a deal here.</p> : stageDeals.map((deal) => {
                            const linkedDocs = linkedDocumentMap.get(deal.id) || [];
                            const stageIndex = stageOrder.get(deal.stage) ?? 0;
                            const previousStage = dealStages[Math.max(0, stageIndex - 1)] || "";
                            const nextStage = dealStages[Math.min(dealStages.length - 1, stageIndex + 1)] || "";
                            return (
                              <div key={deal.id} draggable onDragStart={() => { setDraggingDealId(deal.id); setSelectedDealId(deal.id); }} onDragEnd={() => { setDraggingDealId(""); setDragOverStage(""); }} className={`cursor-grab border p-2 transition-colors active:cursor-grabbing ${selectedDeal?.id === deal.id ? "border-cyan-300 bg-cyan-500/15" : "border-white/20 bg-black/30 hover:bg-white/5"} ${draggingDealId === deal.id ? "opacity-60" : "opacity-100"}`} onClick={() => setSelectedDealId(deal.id)}>
                                <div className="flex items-start justify-between gap-2"><p className="text-sm text-white leading-5">{deal.dealName}</p><span className={`border px-1 py-[2px] text-[10px] uppercase tracking-[0.12em] ${priorityBadgeClass(deal.priority)}`}>{deal.priority}</span></div>
                                <p className="text-xs text-slate-300 mt-1">{deal.requirementName || "No requirement summary"}</p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <span className={`border px-1 py-[2px] text-[10px] uppercase tracking-[0.12em] ${statusBadgeClass(deal.status)}`}>{deal.status.replace("_", " ")}</span>
                                  <span className="border border-white/20 px-1 py-[2px] text-[10px] text-slate-300">Docs {linkedDocs.length}</span>
                                </div>
                                <p className="mt-2 text-[11px] text-slate-400">{[deal.city, deal.submarket].filter(Boolean).join(" - ") || "Location pending"}</p>
                                <p className="text-[11px] text-slate-400">{deal.squareFootageMin || 0}-{deal.squareFootageMax || 0} SF | {formatCurrency(deal.budget)}</p>
                                <div className="mt-2 flex items-center justify-between">
                                  <button type="button" className="border border-white/25 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-slate-200 disabled:opacity-30" disabled={!previousStage || previousStage === deal.stage} onClick={(event) => { event.stopPropagation(); if (previousStage) moveDealToStage(deal, previousStage, "quick back"); }}>Back</button>
                                  <p className="text-[10px] text-slate-400">Updated {formatDate(deal.updatedAt)}</p>
                                  <button type="button" className="border border-white/25 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-slate-200 disabled:opacity-30" disabled={!nextStage || nextStage === deal.stage} onClick={(event) => { event.stopPropagation(); if (nextStage) moveDealToStage(deal, nextStage, "quick advance"); }}>Next</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {view === "table" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-sm">
                <thead><tr className="border-b border-white/20"><th className="text-left py-2 pr-3 text-slate-300 font-medium">Deal</th><th className="text-left py-2 pr-3 text-slate-300 font-medium">Stage</th><th className="text-left py-2 pr-3 text-slate-300 font-medium">Status</th><th className="text-left py-2 pr-3 text-slate-300 font-medium">Priority</th><th className="text-left py-2 pr-3 text-slate-300 font-medium">Location</th><th className="text-left py-2 pr-3 text-slate-300 font-medium">Budget</th><th className="text-left py-2 pr-3 text-slate-300 font-medium">Company</th><th className="text-left py-2 text-slate-300 font-medium">Updated</th></tr></thead>
                <tbody>
                  {filteredDeals.length === 0 ? <tr><td colSpan={8} className="py-6 text-slate-400">No deals match the current search.</td></tr> : filteredDeals.map((deal) => (
                    <tr key={deal.id} className={`border-b border-white/10 cursor-pointer ${selectedDeal?.id === deal.id ? "bg-cyan-500/10" : "hover:bg-white/5"}`} onClick={() => setSelectedDealId(deal.id)}>
                      <td className="py-2 pr-3 text-white">{deal.dealName}</td>
                      <td className="py-2 pr-3 text-slate-200">{deal.stage}</td>
                      <td className="py-2 pr-3 text-slate-200">{deal.status.replace("_", " ")}</td>
                      <td className="py-2 pr-3 text-slate-200">{deal.priority}</td>
                      <td className="py-2 pr-3 text-slate-200">{[deal.city, deal.submarket].filter(Boolean).join(", ") || "-"}</td>
                      <td className="py-2 pr-3 text-slate-200">{formatCurrency(deal.budget)}</td>
                      <td className="py-2 pr-3 text-slate-200">{crmState.companies.find((company) => company.id === deal.companyId)?.name || asText(clientName) || "Workspace"}</td>
                      <td className="py-2 text-slate-200">{formatDate(deal.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {view === "timeline" ? (
            <div className="space-y-2">
              {filteredDeals.length === 0 ? <p className="text-sm text-slate-400">No timeline entries yet.</p> : filteredDeals.map((deal) => (
                <button key={deal.id} type="button" className={`w-full border px-3 py-3 text-left ${selectedDeal?.id === deal.id ? "border-cyan-300 bg-cyan-500/15" : "border-white/20 bg-black/20 hover:bg-white/5"}`} onClick={() => setSelectedDealId(deal.id)}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-white">{deal.dealName}</p>
                      <p className="text-xs text-slate-300 mt-1">{deal.stage} - {deal.status.replace("_", " ")}</p>
                      <p className="text-xs text-slate-400 mt-1">{deal.timeline[0]?.description || "No activity logged yet."}</p>
                    </div>
                    <p className="text-xs text-slate-400">{formatDate(deal.updatedAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {view === "client_grouped" ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {[...crmState.companies].sort(compareByCriticalDate).slice(0, 9).map((company) => (
                <button key={company.id} type="button" onClick={() => setSelectedCompanyId(company.id)} className={`border p-3 text-left ${selectedCompany?.id === company.id ? "border-cyan-300 bg-cyan-500/10" : "border-white/15 bg-black/20 hover:bg-white/5"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-white">{company.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{[company.market, company.submarket].filter(Boolean).join(" / ") || "Unassigned"}</p>
                    </div>
                    <span className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${companyTypeBadgeClass(company.type)}`}>{company.type.replace(/_/g, " ")}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <p className="text-slate-400">Deals <span className="text-white">{company.linkedDealIds.length}</span></p>
                    <p className="text-slate-400">Docs <span className="text-white">{company.linkedDocumentIds.length}</span></p>
                    <p className="text-slate-400">Expiration <span className="text-white">{formatDate(company.currentLeaseExpiration)}</span></p>
                    <p className="text-slate-400">Follow up <span className="text-white">{formatDate(company.nextFollowUpDate)}</span></p>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </PlatformPanel>
            </div>

        <PlatformPanel kicker="Deal Detail" title={selectedDeal ? selectedDeal.dealName : "Select a deal"} className="xl:col-span-12">
          {!selectedDeal ? <p className="text-sm text-slate-400">Create a deal or select one from the CRM views.</p> : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="input-premium md:col-span-2" value={selectedDeal.dealName} onChange={(event) => updateDeal(selectedDeal.id, { dealName: event.target.value })} />
                <select className="input-premium" value={selectedDeal.stage} onChange={(event) => moveDealToStage(selectedDeal, event.target.value, "manual update")}>{dealStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select>
                <select className="input-premium" value={selectedDeal.status} onChange={(event) => updateDeal(selectedDeal.id, { status: event.target.value as ClientWorkspaceDeal["status"] })}>
                  <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option><option value="on_hold">On Hold</option>
                </select>
                <select className="input-premium" value={selectedDeal.companyId || selectedCompany?.id || ""} onChange={(event) => updateDeal(selectedDeal.id, { companyId: event.target.value || undefined })}>
                  <option value="">Link to CRM profile</option>
                  {crmState.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
                <input className="input-premium" value={selectedDeal.targetMarket} placeholder="Target market" onChange={(event) => updateDeal(selectedDeal.id, { targetMarket: event.target.value })} />
                <input className="input-premium" value={selectedDeal.submarket} placeholder="Submarket" onChange={(event) => updateDeal(selectedDeal.id, { submarket: event.target.value })} />
                <input className="input-premium" value={selectedDeal.city} placeholder="City" onChange={(event) => updateDeal(selectedDeal.id, { city: event.target.value })} />
                <input className="input-premium" value={String(selectedDeal.budget || "")} placeholder="Budget" onChange={(event) => updateDeal(selectedDeal.id, { budget: asNumber(event.target.value) })} />
                <textarea className="input-premium md:col-span-2 min-h-[72px]" value={selectedDeal.notes} placeholder="Notes" onChange={(event) => updateDeal(selectedDeal.id, { notes: event.target.value })} />
              </div>
              <div className="lg:col-span-5 border border-white/15 bg-black/20 p-3">
                <p className="heading-kicker mb-2">Linked Documents</p>
                <ClientDocumentPicker
                  buttonLabel="Attach Existing Document"
                  onSelectDocument={(document) => {
                    updateDeal(selectedDeal.id, { linkedDocumentIds: Array.from(new Set([...(linkedDocumentMap.get(selectedDeal.id) || []), document.id])) });
                    updateDocument(document.id, { dealId: selectedDeal.id, companyId: selectedDeal.companyId });
                    setStatus(`Attached ${document.name} to ${selectedDeal.dealName}.`);
                  }}
                />
                <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {(linkedDocumentMap.get(selectedDeal.id) || []).length === 0 ? <p className="text-xs text-slate-400">No linked documents yet.</p> : (linkedDocumentMap.get(selectedDeal.id) || []).map((documentId) => {
                    const doc = documents.find((item) => item.id === documentId);
                    if (!doc) return null;
                    return (
                      <div key={documentId} className="border border-white/15 bg-black/25 p-2">
                        <p className="text-xs text-white break-all">{doc.name}</p>
                        <p className="text-[11px] text-slate-400">{doc.type}</p>
                        <button type="button" className="mt-1 btn-premium btn-premium-danger text-[10px]" onClick={() => {
                          updateDeal(selectedDeal.id, { linkedDocumentIds: (linkedDocumentMap.get(selectedDeal.id) || []).filter((id) => id !== documentId) });
                          updateDocument(documentId, { dealId: "" });
                        }}>Remove</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </PlatformPanel>
          </div>
        </PlatformDashboardTier>
      </div>
    </PlatformSection>
  );
}
