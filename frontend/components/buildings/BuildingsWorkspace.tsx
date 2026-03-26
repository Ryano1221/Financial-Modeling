"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultScenarioInput } from "@/components/ScenarioForm";
import {
  PlatformDashboardTier,
  PlatformMetricCard,
  PlatformMetricStrip,
  PlatformPanel,
  PlatformSection,
} from "@/components/platform/PlatformShell";
import { CrmBuildingInsightCard } from "@/components/deals/CrmBuildingInsightCard";
import { CrmBuildingInventoryMap } from "@/components/deals/CrmBuildingInventoryMap";
import { CrmBuildingStackingPlan } from "@/components/deals/CrmBuildingStackingPlan";
import { useBrokerOs } from "@/components/workspace/BrokerOsProvider";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { getBuildingRegistryEntry, getDesignatedBuildingImage, hasCuratedBuildingPhoto, resolveBuildingImageUrl } from "@/lib/building-photos";
import { createManualSurveyEntryFromBuilding } from "@/lib/surveys/engine";
import type { SurveyEntry } from "@/lib/surveys/types";
import type { ScenarioInput } from "@/lib/types";
import { fetchWorkspaceCloudSection, saveWorkspaceCloudSection } from "@/lib/workspace/cloud";
import {
  CRM_OS_STORAGE_KEY,
  buildCrmWorkspaceState,
  emptyCrmWorkspaceState,
  filterCrmBuildings,
  type CrmBuilding,
  type CrmCompany,
  type CrmShortlist,
  type CrmShortlistEntry,
  type CrmStackingPlanEntry,
  type CrmTour,
  type CrmWorkspaceState,
} from "@/lib/workspace/crm";
import { clearBuildingFocus, loadBuildingFocus, persistBuildingFocus } from "@/lib/workspace/building-focus";
import { getWorkspaceBuildingDeletionKey, normalizeDeletionIds } from "@/lib/workspace/deletions";
import { fetchSharedMarketInventory, type SharedMarketInventoryResponse } from "@/lib/workspace/market-inventory";
import {
  buildLandlordBuildingHubSummary,
  buildLandlordStackingPlan,
  buildModeAwareAiRecommendations,
  type LandlordStackingPlanSuiteCell,
} from "@/lib/workspace/representation-selectors";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";

const SURVEYS_STORAGE_KEY = "surveys_module_entries_v1";
const PENDING_SCENARIO_KEY = "lease_deck_pending_scenario";

type BuildingSortOption =
  | "featured"
  | "name_asc"
  | "rsf_desc"
  | "stories_desc"
  | "year_desc"
  | "submarket_asc";

type SuiteStatusFilter = "all" | "vacant" | "occupied" | "expiring" | "proposal_active" | "toured";

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

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, value || 0));
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function suiteStatusLabel(status: LandlordStackingPlanSuiteCell["status"]): string {
  return status.replace(/_/g, " ");
}

function suiteStatusTone(status: LandlordStackingPlanSuiteCell["status"]): string {
  if (status === "occupied") return "border-emerald-300/50 bg-emerald-500/12 text-emerald-50";
  if (status === "expiring") return "border-orange-300/50 bg-orange-500/12 text-orange-50";
  if (status === "proposal_active") return "border-cyan-300/50 bg-cyan-500/12 text-cyan-50";
  if (status === "toured") return "border-indigo-300/50 bg-indigo-500/12 text-indigo-50";
  return "border-white/15 bg-white/[0.05] text-slate-100";
}

function suiteExpiryTone(expirationDate: string): string {
  const raw = asText(expirationDate);
  if (!raw) return "border-white/15 bg-white/[0.04] text-slate-200";
  const expiry = new Date(raw);
  if (!Number.isFinite(expiry.getTime())) return "border-white/15 bg-white/[0.04] text-slate-200";
  const now = new Date();
  const months = (expiry.getUTCFullYear() - now.getUTCFullYear()) * 12 + (expiry.getUTCMonth() - now.getUTCMonth());
  if (months <= 6) return "border-red-300/50 bg-red-500/14 text-red-50";
  if (months <= 18) return "border-orange-300/50 bg-orange-500/14 text-orange-50";
  if (months <= 36) return "border-amber-300/50 bg-amber-500/12 text-amber-50";
  return "border-emerald-300/40 bg-emerald-500/10 text-emerald-50";
}

function suiteRateBand(rate: number): { label: string; tone: string } {
  if (!Number.isFinite(rate) || rate <= 0) return { label: "Rate Pending", tone: "border-white/15 bg-white/[0.04] text-slate-200" };
  if (rate >= 45) return { label: "Premium Rate", tone: "border-fuchsia-300/45 bg-fuchsia-500/10 text-fuchsia-50" };
  if (rate >= 32) return { label: "Core Rate", tone: "border-cyan-300/45 bg-cyan-500/10 text-cyan-50" };
  return { label: "Value Rate", tone: "border-emerald-300/45 bg-emerald-500/10 text-emerald-50" };
}

function suiteSourceLabel(source: LandlordStackingPlanSuiteCell["source"]): string {
  if (source === "current_sublease") return "Current sublease";
  if (source === "current_lease") return "Current lease";
  if (source === "occupancy_attachment") return "Manual attachment";
  if (source === "space_seed") return "Building shell";
  return "Manual";
}

function shortlistStatusLabel(value: CrmShortlistEntry["status"]): string {
  return value.replace(/_/g, " ");
}

function shortlistStatusTone(value: CrmShortlistEntry["status"]): string {
  if (value === "proposal_requested") return "border-cyan-300/50 bg-cyan-500/12 text-cyan-50";
  if (value === "touring") return "border-indigo-300/50 bg-indigo-500/12 text-indigo-50";
  if (value === "eliminated") return "border-red-300/50 bg-red-500/12 text-red-50";
  if (value === "shortlisted") return "border-emerald-300/50 bg-emerald-500/12 text-emerald-50";
  return "border-white/15 bg-white/[0.05] text-slate-100";
}

function formatDateTime(value: string): string {
  const raw = asText(value);
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw;
  return parsed.toLocaleString([], { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function displayBuildingName(building: CrmBuilding): string {
  const registryEntry = getBuildingRegistryEntry(building);
  return asText(building.name) || registryEntry?.preferredName || asText(building.address) || "Unnamed building";
}

function hasPinnedBuildingPhoto(building: CrmBuilding): boolean {
  return hasCuratedBuildingPhoto(building) || Boolean(asText(building.photoOverrideUrl));
}

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

export function BuildingsWorkspace({ clientId, clientName }: { clientId: string; clientName?: string | null }) {
  const router = useRouter();
  const { activeClient, documents, deals, representationMode, isAuthenticated, updateDeal } = useClientWorkspace();
  const { graph } = useBrokerOs();
  const storageKey = useMemo(() => makeClientScopedStorageKey(CRM_OS_STORAGE_KEY, clientId), [clientId]);
  const surveysStorageKey = useMemo(() => makeClientScopedStorageKey(SURVEYS_STORAGE_KEY, clientId), [clientId]);
  const pendingScenarioKey = useMemo(() => makeClientScopedStorageKey(PENDING_SCENARIO_KEY, clientId), [clientId]);

  const [storageHydrated, setStorageHydrated] = useState(false);
  const [crmDraft, setCrmDraft] = useState<CrmWorkspaceState>(() => emptyCrmWorkspaceState(representationMode));
  const [sharedMarketInventory, setSharedMarketInventory] = useState<SharedMarketInventoryResponse | null>(null);
  const [selectedInventoryBuildingId, setSelectedInventoryBuildingId] = useState("");
  const [buildingSearch, setBuildingSearch] = useState("");
  const [buildingSort, setBuildingSort] = useState<BuildingSortOption>("featured");
  const [buildingClassFilter, setBuildingClassFilter] = useState("all");
  const [buildingPhotoFilter, setBuildingPhotoFilter] = useState("all");
  const [buildingMapFilter, setBuildingMapFilter] = useState("all");
  const [suiteSearch, setSuiteSearch] = useState("");
  const [suiteFloorFilter, setSuiteFloorFilter] = useState("all");
  const [suiteStatusFilter, setSuiteStatusFilter] = useState<SuiteStatusFilter>("all");
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<string[]>([]);
  const [selectedMapBuildingIds, setSelectedMapBuildingIds] = useState<string[]>([]);
  const [mapSelectionMode, setMapSelectionMode] = useState(false);
  const [mapSelectionOnly, setMapSelectionOnly] = useState(false);
  const [workflowDealId, setWorkflowDealId] = useState("");
  const [shortlistName, setShortlistName] = useState("");
  const [scheduledTourAt, setScheduledTourAt] = useState("");
  const [workflowNotes, setWorkflowNotes] = useState("");
  const [status, setStatus] = useState("Use the Buildings workspace to browse towers, drill into suites, edit stack plans, and push context into downstream workflows.");
  const [error, setError] = useState("");
  const [buildingPhotoStatus, setBuildingPhotoStatus] = useState<{ buildingId: string; message: string }>({ buildingId: "", message: "" });

  useEffect(() => {
    let cancelled = false;
    setStorageHydrated(false);
    async function hydrate() {
      if (isAuthenticated) {
        try {
          const remote = await fetchWorkspaceCloudSection(storageKey);
          if (!cancelled) {
            setCrmDraft(remote?.value && typeof remote.value === "object" ? (remote.value as CrmWorkspaceState) : emptyCrmWorkspaceState(representationMode));
            setStorageHydrated(true);
            return;
          }
        } catch {
          // local fallback below
        }
      }
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(storageKey);
          setCrmDraft(raw ? (JSON.parse(raw) as CrmWorkspaceState) : emptyCrmWorkspaceState(representationMode));
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
      // local copy already saved
    });
  }, [crmState, isAuthenticated, storageHydrated, storageKey]);

  useEffect(() => {
    if (!storageHydrated || selectedInventoryBuildingId) return;
    const focus = loadBuildingFocus(clientId);
    if (focus?.buildingId && crmState.buildings.some((building) => building.id === focus.buildingId)) {
      setSelectedInventoryBuildingId(focus.buildingId);
      return;
    }
    if (crmState.buildings[0]?.id) setSelectedInventoryBuildingId(crmState.buildings[0].id);
  }, [clientId, crmState.buildings, selectedInventoryBuildingId, storageHydrated]);

  const patchCrmDraft = useCallback((patcher: (current: CrmWorkspaceState) => CrmWorkspaceState) => {
    setCrmDraft((prev) => patcher(prev));
  }, []);

  const patchBuildingRecord = useCallback((buildingId: string, patch: Partial<CrmBuilding>) => {
    patchCrmDraft((current) => ({
      ...current,
      buildings: current.buildings.map((building) => (building.id === buildingId ? { ...building, ...patch } : building)),
    }));
  }, [patchCrmDraft]);

  const filteredBuildings = useMemo(
    () => filterCrmBuildings(crmState, {
      query: "",
      market: "all",
      submarket: "all",
      buildingId: "all",
      floor: "all",
      suite: "all",
      companyType: "all",
      prospectStage: "all",
      expirationBucket: "all",
      followUpState: "all",
    }),
    [crmState],
  );

  const baseDisplayedBuildings = useMemo(() => {
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
        const haystack = [displayBuildingName(building), building.address, building.submarket, building.market, building.ownerName, building.leasingCompanyName, building.propertyManagerName]
          .map(normalizeText)
          .join(" ");
        return haystack.includes(query);
      })
      .sort((left, right) => compareBuildings(left, right, buildingSort, selectedInventoryBuildingId || null));
  }, [buildingClassFilter, buildingMapFilter, buildingPhotoFilter, buildingSearch, buildingSort, filteredBuildings, selectedInventoryBuildingId]);
  const displayedBuildings = useMemo(() => {
    if (!mapSelectionOnly || selectedMapBuildingIds.length === 0) return baseDisplayedBuildings;
    const set = new Set(selectedMapBuildingIds);
    return baseDisplayedBuildings.filter((building) => set.has(building.id));
  }, [baseDisplayedBuildings, mapSelectionOnly, selectedMapBuildingIds]);

  const activeInventoryBuilding = useMemo(
    () => crmState.buildings.find((building) => building.id === selectedInventoryBuildingId) || displayedBuildings[0] || null,
    [crmState.buildings, displayedBuildings, selectedInventoryBuildingId],
  );

  const attachableCompanyOptions = useMemo(
    () => [...crmState.companies]
      .filter((company) => company.type !== "landlord" && company.type !== "ownership_group")
      .sort((left, right) => left.name.localeCompare(right.name)),
    [crmState.companies],
  );

  const stackingPlanRows = useMemo(
    () => buildLandlordStackingPlan({
      buildings: displayedBuildings,
      companies: crmState.companies,
      occupancyRecords: crmState.occupancyRecords,
      stackingPlanEntries: crmState.stackingPlanEntries,
      shortlistEntries: crmState.shortlistEntries,
      tours: crmState.tours,
      properties: graph.properties,
      spaces: graph.spaces,
      deals,
      proposals: graph.proposals,
      obligations: graph.obligations,
      filters: {
        market: "all",
        submarket: "all",
        buildingId: activeInventoryBuilding?.id || "all",
        query: buildingSearch,
      },
    }),
    [activeInventoryBuilding?.id, buildingSearch, crmState.companies, crmState.occupancyRecords, crmState.shortlistEntries, crmState.stackingPlanEntries, crmState.tours, deals, displayedBuildings, graph.obligations, graph.proposals, graph.properties, graph.spaces],
  );

  const activeStackingBuildingRow = useMemo(
    () => stackingPlanRows.find((row) => row.buildingId === activeInventoryBuilding?.id) || stackingPlanRows[0] || null,
    [activeInventoryBuilding?.id, stackingPlanRows],
  );

  const activeBuildingSummary = useMemo(() => buildLandlordBuildingHubSummary(activeStackingBuildingRow), [activeStackingBuildingRow]);
  const activeBuildingSuites = useMemo(
    () => activeStackingBuildingRow?.floors.flatMap((floor) => floor.suites) || [],
    [activeStackingBuildingRow],
  );
  const activeTrackedRsf = useMemo(
    () => activeStackingBuildingRow?.floors.reduce((sum, floor) => sum + floor.suites.reduce((suiteSum, suite) => suiteSum + Math.max(0, suite.rsf), 0), 0) || 0,
    [activeStackingBuildingRow],
  );
  const availableFloorOptions = useMemo(
    () => Array.from(new Set(activeBuildingSuites.map((suite) => asText(suite.floor)).filter(Boolean)))
      .sort((left, right) => Number(right) - Number(left) || right.localeCompare(left)),
    [activeBuildingSuites],
  );
  const filteredSuites = useMemo(() => {
    const query = normalizeText(suiteSearch);
    return activeBuildingSuites.filter((suite) => {
      if (suiteFloorFilter !== "all" && asText(suite.floor) !== suiteFloorFilter) return false;
      if (suiteStatusFilter !== "all" && suite.status !== suiteStatusFilter) return false;
      if (!query) return true;
      const haystack = [
        suite.floor,
        suite.suite,
        suite.companyName,
        suite.landlordName,
        suiteStatusLabel(suite.status),
        suiteSourceLabel(suite.source),
      ].map(normalizeText).join(" ");
      return haystack.includes(query);
    });
  }, [activeBuildingSuites, suiteFloorFilter, suiteSearch, suiteStatusFilter]);
  const selectedSuites = useMemo(
    () => filteredSuites.filter((suite) => selectedSuiteIds.includes(suite.id)),
    [filteredSuites, selectedSuiteIds],
  );
  const workflowDeals = useMemo(
    () => deals.filter((deal) => deal.clientId === clientId && deal.status !== "won" && deal.status !== "lost"),
    [clientId, deals],
  );
  const selectedWorkflowDeal = useMemo(
    () => workflowDeals.find((deal) => deal.id === workflowDealId) || workflowDeals[0] || null,
    [workflowDealId, workflowDeals],
  );
  const activeBuildingShortlists = useMemo(
    () => crmState.shortlists.filter((item) => item.buildingId === activeInventoryBuilding?.id),
    [activeInventoryBuilding?.id, crmState.shortlists],
  );
  const activeBuildingShortlistEntries = useMemo(
    () => crmState.shortlistEntries.filter((item) => item.buildingId === activeInventoryBuilding?.id),
    [activeInventoryBuilding?.id, crmState.shortlistEntries],
  );
  const activeBuildingTours = useMemo(
    () => crmState.tours.filter((item) => item.buildingId === activeInventoryBuilding?.id),
    [activeInventoryBuilding?.id, crmState.tours],
  );
  const aiRecommendations = useMemo(
    () => buildModeAwareAiRecommendations({ mode: representationMode, selectedBuilding: activeInventoryBuilding, buildingSummary: activeBuildingSummary }),
    [activeBuildingSummary, activeInventoryBuilding, representationMode],
  );

  useEffect(() => {
    if (workflowDealId && workflowDeals.some((deal) => deal.id === workflowDealId)) return;
    setWorkflowDealId(workflowDeals[0]?.id || "");
  }, [workflowDealId, workflowDeals]);

  useEffect(() => {
    if (!activeInventoryBuilding) return;
    setShortlistName((current) => current || `${displayBuildingName(activeInventoryBuilding)} Shortlist`);
  }, [activeInventoryBuilding]);

  const buildingInventoryMetrics = useMemo(() => ({
    totalRSF: displayedBuildings.reduce((sum, building) => sum + asNumber(building.totalRSF), 0),
    mappedCount: displayedBuildings.filter((building) => Number.isFinite(building.latitude) && Number.isFinite(building.longitude)).length,
    pinnedPhotoCount: displayedBuildings.filter((building) => hasPinnedBuildingPhoto(building)).length,
    selectedCount: selectedMapBuildingIds.length,
  }), [displayedBuildings]);

  const buildingClassCounts = useMemo(() => ({
    all: filteredBuildings.length,
    A: filteredBuildings.filter((building) => asText(building.buildingClass).toUpperCase() === "A").length,
    B: filteredBuildings.filter((building) => asText(building.buildingClass).toUpperCase() === "B").length,
  }), [filteredBuildings]);

  const focusBuilding = useCallback((building: CrmBuilding) => {
    setSelectedInventoryBuildingId(building.id);
    setSelectedSuiteIds([]);
    setSuiteSearch("");
    setSuiteFloorFilter("all");
    setSuiteStatusFilter("all");
    persistBuildingFocus(clientId, building);
    setBuildingPhotoStatus((prev) => (prev.buildingId === building.id ? prev : { buildingId: "", message: "" }));
    setStatus(`Selected ${displayBuildingName(building)} and kept the filtered results in view.`);
    setError("");
  }, [clientId]);

  const buildScenarioFromSuite = useCallback((suite: LandlordStackingPlanSuiteCell): ScenarioInput => {
    const fallbackCommencement = defaultScenarioInput.commencement;
    const fallbackExpiration = defaultScenarioInput.expiration;
    const commencement = asText(suite.leaseStart) || fallbackCommencement;
    const expiration = asText(suite.expirationDate) || fallbackExpiration;
    const rate = suite.baseRent > 0 ? suite.baseRent : defaultScenarioInput.rent_steps[0]?.rate_psf_yr || 30;
    return {
      ...defaultScenarioInput,
      clientId,
      name: `${displayBuildingName(activeInventoryBuilding || { ...suite, name: "", address: "" } as unknown as CrmBuilding)} · Suite ${suite.suite || "Space"}`,
      building_name: activeInventoryBuilding ? displayBuildingName(activeInventoryBuilding) : "",
      suite: suite.suite,
      floor: suite.floor,
      address: activeInventoryBuilding?.address || "",
      notes: `${suite.companyName ? `${suite.companyName}. ` : ""}${suiteSourceLabel(suite.source)} added from Buildings workspace.`,
      rsf: Math.max(1, suite.rsf || defaultScenarioInput.rsf),
      commencement,
      expiration,
      rent_steps: [{ start: 0, end: Math.max(0, defaultScenarioInput.rent_steps[0].end), rate_psf_yr: rate }],
      opex_mode: suite.opex > 0 ? "nnn" : defaultScenarioInput.opex_mode,
      base_opex_psf_yr: suite.opex > 0 ? suite.opex : defaultScenarioInput.base_opex_psf_yr,
      base_year_opex_psf_yr: suite.opex > 0 ? suite.opex : defaultScenarioInput.base_year_opex_psf_yr,
      free_rent_months: suite.abatementMonths > 0 ? suite.abatementMonths : defaultScenarioInput.free_rent_months,
      free_rent_start_month: 0,
      free_rent_end_month: Math.max(0, (suite.abatementMonths || defaultScenarioInput.free_rent_months) - 1),
      abatement_periods: suite.abatementMonths > 0
        ? [{ start_month: 0, end_month: Math.max(0, suite.abatementMonths - 1), abatement_type: "base" }]
        : defaultScenarioInput.abatement_periods,
      ti_allowance_psf: suite.tiAllowance > 0 ? suite.tiAllowance : defaultScenarioInput.ti_allowance_psf,
    };
  }, [activeInventoryBuilding, clientId]);

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
    return existing ? currentEntries.map((entry) => (entry.id === existing.id ? nextEntry : entry)) : [nextEntry, ...currentEntries];
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
    patchCrmDraft((current) => ({ ...current, stackingPlanEntries: upsertStackingEntry(current, payload) }));
    if (activeInventoryBuilding) persistBuildingFocus(clientId, activeInventoryBuilding, { floor: payload.floor, suite: payload.suite });
    setStatus(`Saved ${displayBuildingName(activeInventoryBuilding || { id: payload.buildingId, clientId, name: "Building", address: "", market: "", submarket: "", ownerName: "", propertyType: "Office", totalRSF: 0, notes: "" })} floor ${payload.floor} suite ${payload.suite}.`);
  }, [activeInventoryBuilding, clientId, patchCrmDraft, upsertStackingEntry]);

  const syncDealWorkflow = useCallback((input: {
    nextStage: string;
    suite: LandlordStackingPlanSuiteCell;
    note: string;
  }) => {
    if (!selectedWorkflowDeal) return;
    const timelineEntry = {
      id: makeId("deal_activity"),
      clientId,
      dealId: selectedWorkflowDeal.id,
      label: input.nextStage,
      description: input.note,
      createdAt: new Date().toISOString(),
    };
    updateDeal(selectedWorkflowDeal.id, {
      stage: input.nextStage,
      selectedProperty: activeInventoryBuilding ? displayBuildingName(activeInventoryBuilding) : selectedWorkflowDeal.selectedProperty,
      selectedSuite: input.suite.suite || selectedWorkflowDeal.selectedSuite,
      selectedLandlord: activeInventoryBuilding?.ownerName || selectedWorkflowDeal.selectedLandlord,
      timeline: [timelineEntry, ...selectedWorkflowDeal.timeline].slice(0, 100),
    });
  }, [activeInventoryBuilding, clientId, selectedWorkflowDeal, updateDeal]);

  const saveShortlistWorkflow = useCallback((mode: "shortlist" | "tour" | "proposal_requested") => {
    if (!activeInventoryBuilding) return;
    if (selectedSuites.length === 0) {
      setError("Select one or more suites first.");
      return;
    }

    const effectiveShortlistName = asText(shortlistName) || `${displayBuildingName(activeInventoryBuilding)} Shortlist`;
    const now = new Date().toISOString();
    let createdEntries = 0;
    let createdTours = 0;

    patchCrmDraft((current) => {
      const currentShortlists = [...(current.shortlists || [])];
      const currentEntries = [...(current.shortlistEntries || [])];
      const currentTours = [...(current.tours || [])];

      let shortlist = currentShortlists.find((item) =>
        item.buildingId === activeInventoryBuilding.id
        && asText(item.dealId) === asText(selectedWorkflowDeal?.id)
        && normalizeText(item.name) === normalizeText(effectiveShortlistName),
      );
      if (!shortlist) {
        shortlist = {
          id: makeId("crm_shortlist"),
          clientId,
          dealId: selectedWorkflowDeal?.id,
          buildingId: activeInventoryBuilding.id,
          name: effectiveShortlistName,
          createdAt: now,
          updatedAt: now,
        } satisfies CrmShortlist;
        currentShortlists.unshift(shortlist);
      } else {
        shortlist = { ...shortlist, updatedAt: now };
        const shortlistIndex = currentShortlists.findIndex((item) => item.id === shortlist?.id);
        currentShortlists[shortlistIndex] = shortlist;
      }

      selectedSuites.forEach((suite, index) => {
        const existingEntry = currentEntries.find((item) =>
          item.shortlistId === shortlist?.id
          && item.buildingId === activeInventoryBuilding.id
          && normalizeText(item.floor) === normalizeText(suite.floor)
          && normalizeText(item.suite) === normalizeText(suite.suite),
        );
        const nextStatus: CrmShortlistEntry["status"] = mode === "proposal_requested"
          ? "proposal_requested"
          : mode === "tour"
            ? "touring"
            : existingEntry?.status === "proposal_requested"
              ? "proposal_requested"
              : "shortlisted";
        const nextEntry: CrmShortlistEntry = {
          id: existingEntry?.id || makeId("crm_shortlist_entry"),
          clientId,
          shortlistId: shortlist.id,
          dealId: selectedWorkflowDeal?.id,
          buildingId: activeInventoryBuilding.id,
          floor: suite.floor,
          suite: suite.suite,
          rsf: suite.rsf,
          companyId: suite.companyId || undefined,
          source: suite.source,
          status: nextStatus,
          owner: existingEntry?.owner || selectedWorkflowDeal?.tenantRepBroker || activeClient?.contactName || "Broker Team",
          rank: existingEntry?.rank || index + 1,
          notes: asText(workflowNotes) || existingEntry?.notes || "",
          linkedSurveyEntryId: existingEntry?.linkedSurveyEntryId,
          createdAt: existingEntry?.createdAt || now,
          updatedAt: now,
        };
        if (existingEntry) {
          currentEntries[currentEntries.findIndex((item) => item.id === existingEntry.id)] = nextEntry;
        } else {
          currentEntries.unshift(nextEntry);
          createdEntries += 1;
        }

        if (mode === "tour") {
          const existingTour = currentTours.find((item) =>
            item.shortlistEntryId === nextEntry.id
            || (
              item.buildingId === activeInventoryBuilding.id
              && normalizeText(item.floor) === normalizeText(suite.floor)
              && normalizeText(item.suite) === normalizeText(suite.suite)
              && asText(item.dealId) === asText(selectedWorkflowDeal?.id)
            ),
          );
          const nextTour: CrmTour = {
            id: existingTour?.id || makeId("crm_tour"),
            clientId,
            dealId: selectedWorkflowDeal?.id,
            shortlistEntryId: nextEntry.id,
            buildingId: activeInventoryBuilding.id,
            floor: suite.floor,
            suite: suite.suite,
            scheduledAt: asText(scheduledTourAt) || existingTour?.scheduledAt || now,
            status: "scheduled",
            broker: activeClient?.contactName || "Broker Team",
            assignee: existingTour?.assignee || activeClient?.contactName || "Broker Team",
            attendees: existingTour?.attendees || [],
            notes: asText(workflowNotes) || existingTour?.notes || "",
            followUpActions: existingTour?.followUpActions || "",
            createdAt: existingTour?.createdAt || now,
            updatedAt: now,
          };
          if (existingTour) {
            currentTours[currentTours.findIndex((item) => item.id === existingTour.id)] = nextTour;
          } else {
            currentTours.unshift(nextTour);
            createdTours += 1;
          }
        }
      });

      return {
        ...current,
        shortlists: currentShortlists,
        shortlistEntries: currentEntries,
        tours: currentTours,
      };
    });

    const primarySuite = selectedSuites[0];
    if (primarySuite && selectedWorkflowDeal) {
      const nextStage = mode === "proposal_requested"
        ? (representationMode === LANDLORD_REP_MODE ? "Proposal Out" : "Proposal Requested")
        : mode === "tour"
          ? (representationMode === LANDLORD_REP_MODE ? "Tour Scheduled" : "Touring")
          : (representationMode === LANDLORD_REP_MODE ? selectedWorkflowDeal.stage : "Survey");
      if (nextStage && nextStage !== selectedWorkflowDeal.stage) {
        syncDealWorkflow({
          nextStage,
          suite: primarySuite,
          note: `${mode === "proposal_requested" ? "Moved" : mode === "tour" ? "Scheduled" : "Added"} ${displayBuildingName(activeInventoryBuilding)} suite ${primarySuite.suite} into ${effectiveShortlistName}.`,
        });
      } else {
        updateDeal(selectedWorkflowDeal.id, {
          selectedProperty: displayBuildingName(activeInventoryBuilding),
          selectedSuite: primarySuite.suite,
          selectedLandlord: activeInventoryBuilding.ownerName || selectedWorkflowDeal.selectedLandlord,
        });
      }
    }

    persistBuildingFocus(clientId, activeInventoryBuilding, { floor: selectedSuites[0]?.floor || "", suite: selectedSuites[0]?.suite || "" });
    setError("");
    setStatus(
      mode === "tour"
        ? `Scheduled ${createdTours || selectedSuites.length} tour${(createdTours || selectedSuites.length) === 1 ? "" : "s"} for ${effectiveShortlistName}.`
        : mode === "proposal_requested"
          ? `Marked ${selectedSuites.length} suite${selectedSuites.length === 1 ? "" : "s"} as proposal requested in ${effectiveShortlistName}.`
          : `Added ${createdEntries || selectedSuites.length} suite${(createdEntries || selectedSuites.length) === 1 ? "" : "s"} to ${effectiveShortlistName}.`,
    );
  }, [activeClient?.contactName, activeInventoryBuilding, clientId, patchCrmDraft, representationMode, scheduledTourAt, selectedSuites, selectedWorkflowDeal, shortlistName, syncDealWorkflow, updateDeal, workflowNotes]);

  const queueBuildingForSurveys = useCallback(() => {
    if (!activeInventoryBuilding || typeof window === "undefined") return;
    const entry: SurveyEntry = createManualSurveyEntryFromBuilding({
      clientId,
      buildingName: displayBuildingName(activeInventoryBuilding),
      address: activeInventoryBuilding.address,
      submarket: activeInventoryBuilding.submarket,
      opexPsfAnnual: asNumber(activeInventoryBuilding.operatingExpenses),
      notes: `Added from Buildings workspace. ${activeInventoryBuilding.market || "Austin"}${activeInventoryBuilding.submarket ? ` / ${activeInventoryBuilding.submarket}` : ""}`,
    });
    try {
      const raw = window.localStorage.getItem(surveysStorageKey);
      const current = raw ? (JSON.parse(raw) as { entries?: SurveyEntry[]; selectedId?: string }) : { entries: [] as SurveyEntry[] };
      const entries = Array.isArray(current.entries) ? current.entries : [];
      const duplicate = entries.find((candidate) => normalizeText(candidate.buildingName) === normalizeText(entry.buildingName) && normalizeText(candidate.address) === normalizeText(entry.address));
      const payload = duplicate ? { entries, selectedId: duplicate.id } : { entries: [entry, ...entries], selectedId: entry.id };
      window.localStorage.setItem(surveysStorageKey, JSON.stringify(payload));
      if (isAuthenticated) {
        void saveWorkspaceCloudSection(surveysStorageKey, payload).catch(() => {
          // local copy already saved
        });
      }
      persistBuildingFocus(clientId, activeInventoryBuilding);
      setStatus(duplicate ? `${displayBuildingName(activeInventoryBuilding)} is already available in Surveys.` : `Added ${displayBuildingName(activeInventoryBuilding)} to Surveys as a manual building row.`);
      setError("");
    } catch (err) {
      setError(String((err as Error)?.message || "Unable to add this building to Surveys."));
    }
  }, [activeInventoryBuilding, clientId, isAuthenticated, surveysStorageKey]);

  const toggleSuiteSelection = useCallback((suiteId: string) => {
    setSelectedSuiteIds((current) =>
      current.includes(suiteId) ? current.filter((id) => id !== suiteId) : [...current, suiteId],
    );
  }, []);

  const queueSelectedSuitesForSurveys = useCallback(() => {
    if (!activeInventoryBuilding || typeof window === "undefined" || selectedSuites.length === 0) return;
    try {
      const raw = window.localStorage.getItem(surveysStorageKey);
      const current = raw ? (JSON.parse(raw) as { entries?: SurveyEntry[]; selectedId?: string }) : { entries: [] as SurveyEntry[] };
      const entries = Array.isArray(current.entries) ? [...current.entries] : [];
      let createdCount = 0;
      let duplicateCount = 0;
      let lastSelectedId = current.selectedId || "";

      for (const suite of selectedSuites) {
        const candidate = createManualSurveyEntryFromBuilding({
          clientId,
          buildingName: displayBuildingName(activeInventoryBuilding),
          address: activeInventoryBuilding.address,
          submarket: activeInventoryBuilding.submarket,
          floor: suite.floor,
          suite: suite.suite,
          availableSqft: suite.rsf,
          baseRentPsfAnnual: suite.baseRent,
          opexPsfAnnual: suite.opex || asNumber(activeInventoryBuilding.operatingExpenses),
          leaseType: suite.rentType ? "NNN" : "Unknown",
          occupancyType: suite.source === "current_sublease" ? "Sublease" : "Direct",
          sublessor: suite.source === "current_sublease" ? suite.companyName : "",
          subleaseExpirationDate: suite.source === "current_sublease" ? suite.expirationDate : "",
          notes: `Added from Buildings workspace suite selection. Floor ${suite.floor} / Suite ${suite.suite}. ${suiteSourceLabel(suite.source)}.`,
        });
        const duplicate = entries.find((entry) =>
          normalizeText(entry.buildingName) === normalizeText(candidate.buildingName)
          && normalizeText(entry.address) === normalizeText(candidate.address)
          && normalizeText(entry.floor) === normalizeText(candidate.floor)
          && normalizeText(entry.suite) === normalizeText(candidate.suite),
        );
        if (duplicate) {
          duplicateCount += 1;
          lastSelectedId = duplicate.id;
          continue;
        }
        entries.unshift(candidate);
        createdCount += 1;
        lastSelectedId = candidate.id;
      }

      const payload = { entries, selectedId: lastSelectedId };
      window.localStorage.setItem(surveysStorageKey, JSON.stringify(payload));
      if (isAuthenticated) {
        void saveWorkspaceCloudSection(surveysStorageKey, payload).catch(() => {
          // local copy already saved
        });
      }
      if (selectedSuites.length === 1) {
        const suite = selectedSuites[0];
        persistBuildingFocus(clientId, activeInventoryBuilding, { floor: suite.floor, suite: suite.suite });
      } else {
        persistBuildingFocus(clientId, activeInventoryBuilding);
      }
      setStatus(
        createdCount > 0
          ? `Added ${createdCount} suite${createdCount === 1 ? "" : "s"} to Surveys${duplicateCount > 0 ? ` and skipped ${duplicateCount} existing row${duplicateCount === 1 ? "" : "s"}` : ""}.`
          : `All selected suites are already available in Surveys.`,
      );
      setError("");
    } catch (err) {
      setError(String((err as Error)?.message || "Unable to add the selected suites to Surveys."));
    }
  }, [activeInventoryBuilding, clientId, isAuthenticated, selectedSuites, surveysStorageKey]);

  const queueSelectedSuitesForAnalyses = useCallback(() => {
    if (selectedSuites.length === 0 || typeof window === "undefined") return;
    const queue = selectedSuites.map((suite) => buildScenarioFromSuite(suite));
    sessionStorage.setItem(pendingScenarioKey, JSON.stringify(queue));
    if (activeInventoryBuilding) {
      if (selectedSuites.length === 1) {
        persistBuildingFocus(clientId, activeInventoryBuilding, {
          floor: selectedSuites[0].floor,
          suite: selectedSuites[0].suite,
        });
      } else {
        persistBuildingFocus(clientId, activeInventoryBuilding);
      }
    }
    setStatus(`Prepared ${queue.length} suite${queue.length === 1 ? "" : "s"} for Financial Analyses.`);
    setError("");
    router.push("/?module=financial-analyses");
  }, [activeInventoryBuilding, buildScenarioFromSuite, clientId, pendingScenarioKey, router, selectedSuites]);

  const removeActiveBuilding = useCallback(() => {
    if (!activeInventoryBuilding || typeof window === "undefined") return;
    const buildingLabel = displayBuildingName(activeInventoryBuilding);
    const confirmed = window.confirm(
      `Remove ${buildingLabel} from this client workspace? This keeps it deleted across refresh and cloud sync for this client.`,
    );
    if (!confirmed) return;

    const deletedBuildingKey = getWorkspaceBuildingDeletionKey(activeInventoryBuilding);
    const nextBuilding = crmState.buildings.find((building) => building.id !== activeInventoryBuilding.id) || null;

    patchCrmDraft((current) => {
      const currentDeletedBuildingKeys = Array.isArray(current.deletedBuildingKeys) ? current.deletedBuildingKeys : [];
      const currentShortlists = Array.isArray(current.shortlists) ? current.shortlists : [];
      const currentShortlistEntries = Array.isArray(current.shortlistEntries) ? current.shortlistEntries : [];
      const currentTours = Array.isArray(current.tours) ? current.tours : [];
      const currentWorkflowBoardViews = Array.isArray(current.workflowBoardViews) ? current.workflowBoardViews : [];
      const currentBuildings = Array.isArray(current.buildings) ? current.buildings : [];
      const currentOccupancyRecords = Array.isArray(current.occupancyRecords) ? current.occupancyRecords : [];
      const currentStackingPlanEntries = Array.isArray(current.stackingPlanEntries) ? current.stackingPlanEntries : [];
      const remainingShortlists = currentShortlists.filter((item) => item.buildingId !== activeInventoryBuilding.id);
      const remainingShortlistIds = new Set(remainingShortlists.map((item) => item.id));
      const remainingShortlistEntries = currentShortlistEntries.filter((item) =>
        item.buildingId !== activeInventoryBuilding.id
        && remainingShortlistIds.has(item.shortlistId),
      );
      const remainingShortlistEntryIds = new Set(remainingShortlistEntries.map((item) => item.id));
      return {
        ...current,
        deletedBuildingKeys: normalizeDeletionIds([...currentDeletedBuildingKeys, deletedBuildingKey]),
        buildings: currentBuildings.filter((building) => building.id !== activeInventoryBuilding.id),
        occupancyRecords: currentOccupancyRecords.filter((record) => record.buildingId !== activeInventoryBuilding.id),
        stackingPlanEntries: currentStackingPlanEntries.filter((entry) => entry.buildingId !== activeInventoryBuilding.id),
        shortlists: remainingShortlists,
        shortlistEntries: remainingShortlistEntries,
        tours: currentTours.filter((tour) =>
          tour.buildingId !== activeInventoryBuilding.id
          && (!asText(tour.shortlistEntryId) || remainingShortlistEntryIds.has(asText(tour.shortlistEntryId))),
        ),
        workflowBoardViews: currentWorkflowBoardViews.filter((view) => asText(view.buildingId) !== activeInventoryBuilding.id),
      };
    });

    setSelectedSuiteIds([]);
    setSelectedMapBuildingIds((current) => {
      const nextIds = current.filter((id) => id !== activeInventoryBuilding.id);
      if (nextIds.length === 0) setMapSelectionOnly(false);
      return nextIds;
    });
    setSelectedInventoryBuildingId(nextBuilding?.id || "");
    setError("");
    if (nextBuilding) {
      persistBuildingFocus(clientId, nextBuilding);
      setStatus(`Removed ${buildingLabel} from this client workspace. ${displayBuildingName(nextBuilding)} is now active.`);
      return;
    }
    clearBuildingFocus(clientId);
    setStatus(`Removed ${buildingLabel} from this client workspace. It will stay deleted across refresh and sync.`);
  }, [activeInventoryBuilding, clientId, crmState.buildings, patchCrmDraft]);

  return (
    <PlatformSection
      kicker="Buildings"
      title="Building Intelligence Workspace"
      description="Browse all buildings and suites on one comprehensive map, filter the active set, edit stack plans, and carry building context into surveys and related workflows."
      actions={activeInventoryBuilding ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-premium btn-premium-secondary" onClick={queueBuildingForSurveys}>Add To Surveys</button>
          <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={queueSelectedSuitesForSurveys} disabled={selectedSuites.length === 0}>Add Selected Suites</button>
          <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={queueSelectedSuitesForAnalyses} disabled={selectedSuites.length === 0}>Add Suites To Analyses</button>
          <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => saveShortlistWorkflow("shortlist")} disabled={selectedSuites.length === 0}>Add To Shortlist</button>
          <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => saveShortlistWorkflow("tour")} disabled={selectedSuites.length === 0}>Schedule Tour</button>
          <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => saveShortlistWorkflow("proposal_requested")} disabled={selectedSuites.length === 0}>Request Proposal</button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={() => {
            persistBuildingFocus(clientId, activeInventoryBuilding);
            router.push("/?module=surveys");
          }}>Open Surveys</button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={() => {
            persistBuildingFocus(clientId, activeInventoryBuilding);
            router.push("/?module=deals");
          }}>Open CRM</button>
          <Link className="btn-premium btn-premium-secondary" href="/?module=financial-analyses" onClick={() => persistBuildingFocus(clientId, activeInventoryBuilding)}>
            Open Analyses
          </Link>
          <button
            type="button"
            className="rounded-md border border-red-300/35 bg-red-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-100 transition hover:bg-red-500/20"
            onClick={removeActiveBuilding}
          >
            Remove Building
          </button>
        </div>
      ) : null}
      maxWidthClassName="max-w-[96vw]"
    >
      <PlatformMetricStrip>
        <PlatformMetricCard label="Buildings" value={formatInt(displayedBuildings.length)} detail="Current filtered building set." tone="accent" />
        <PlatformMetricCard label="Mapped Pins" value={formatInt(buildingInventoryMetrics.mappedCount)} detail="Buildings with map coordinates." />
        <PlatformMetricCard label="Curated Photos" value={formatInt(buildingInventoryMetrics.pinnedPhotoCount)} detail="Verified or uploaded building photos." />
        <PlatformMetricCard label="Map Selected" value={formatInt(buildingInventoryMetrics.selectedCount)} detail="Buildings selected directly from the map." />
        <PlatformMetricCard label="Inventory RSF" value={formatInt(buildingInventoryMetrics.totalRSF)} detail="Tracked rentable area across the active set." />
      </PlatformMetricStrip>

      <PlatformDashboardTier
        label="Portfolio Map"
        title={activeInventoryBuilding ? displayBuildingName(activeInventoryBuilding) : "Shared Building Inventory"}
        description="The map and the right-side result set stay together so you can click buildings, keep the surrounding set visible, and move directly into suite-level editing."
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.95fr]">
          <div className="space-y-3">
            <div className="border border-white/15 bg-black/20 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="heading-kicker">Property Browser</p>
                  <p className="mt-1 text-xs text-slate-400">Filter the building inventory by name, class, photo coverage, map coverage, and sort order.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${mapSelectionMode ? "border-amber-300 bg-amber-500/15 text-amber-100" : "border-white/15 bg-black/30 text-slate-300 hover:bg-white/5"}`}
                    onClick={() => setMapSelectionMode((current) => !current)}
                  >
                    {mapSelectionMode ? "Map Selection On" : "Select On Map"}
                  </button>
                  <button
                    type="button"
                    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${mapSelectionOnly ? "border-cyan-300 bg-cyan-500/15 text-cyan-100" : "border-white/15 bg-black/30 text-slate-300 hover:bg-white/5"} disabled:opacity-50`}
                    onClick={() => setMapSelectionOnly((current) => !current)}
                    disabled={selectedMapBuildingIds.length === 0}
                  >
                    {mapSelectionOnly ? "Showing Map Selection" : "Show Selection Only"}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-300 hover:bg-white/5 disabled:opacity-50"
                    onClick={() => {
                      setSelectedMapBuildingIds([]);
                      setMapSelectionOnly(false);
                    }}
                    disabled={selectedMapBuildingIds.length === 0}
                  >
                    Clear Map Selection
                  </button>
                  {[
                    { label: "All", value: "all", count: buildingClassCounts.all },
                    { label: "Class A", value: "A", count: buildingClassCounts.A },
                    { label: "Class B", value: "B", count: buildingClassCounts.B },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setBuildingClassFilter(option.value)}
                      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em] ${buildingClassFilter === option.value ? "border-cyan-300 bg-cyan-500/15 text-cyan-100" : "border-white/15 bg-black/30 text-slate-300 hover:bg-white/5"}`}
                    >
                      {option.label} · {formatInt(option.count)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <input className="input-premium" placeholder="Search building, owner, address" value={buildingSearch} onChange={(event) => setBuildingSearch(event.target.value)} />
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
              buildings={baseDisplayedBuildings}
              selectedBuildingId={activeInventoryBuilding?.id || null}
              selectedBuildingIds={selectedMapBuildingIds}
              selectionMode={mapSelectionMode}
              onSelectBuilding={(buildingId) => {
                const building = crmState.buildings.find((entry) => entry.id === buildingId);
                if (building) focusBuilding(building);
              }}
              onSelectionChange={(buildingIds) => {
                setSelectedMapBuildingIds(buildingIds);
                if (buildingIds.length > 0) {
                  const first = crmState.buildings.find((entry) => entry.id === buildingIds[0]);
                  if (first) focusBuilding(first);
                  setStatus(`Selected ${buildingIds.length} building${buildingIds.length === 1 ? "" : "s"} from the map.`);
                } else {
                  setStatus("Cleared map building selection.");
                }
              }}
            />
          </div>

          <div className="space-y-4">
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
                setBuildingPhotoStatus({ buildingId: activeInventoryBuilding.id, message: `Saved workspace-default photo for ${displayBuildingName(activeInventoryBuilding)}.` });
              }}
              onClearPhotoOverride={() => {
                if (!activeInventoryBuilding) return;
                patchBuildingRecord(activeInventoryBuilding.id, {
                  photoOverrideUrl: "",
                  photoOverrideSourceLabel: "",
                  photoOverrideSourceUrl: "",
                  photoOverrideUpdatedAt: new Date().toISOString(),
                });
                setBuildingPhotoStatus({ buildingId: activeInventoryBuilding.id, message: `Cleared workspace-default photo for ${displayBuildingName(activeInventoryBuilding)}.` });
              }}
              statusMessage={buildingPhotoStatus.buildingId === activeInventoryBuilding?.id ? buildingPhotoStatus.message : ""}
            />

            <PlatformPanel kicker="Building Actions" title="Use This Building Across The Platform">
              <div className="space-y-3 text-sm text-slate-300">
                <p>{activeInventoryBuilding ? `Use ${displayBuildingName(activeInventoryBuilding)} as the active building context across the client workspace.` : "Select a building to start from one shared building context."}</p>
                <p className="text-xs text-slate-400">Removing a building now creates a client-scoped delete record, so it stays gone after refresh and cloud sync instead of being rebuilt from saved workspace state.</p>
                {activeBuildingSummary ? (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="border border-white/10 bg-black/20 p-2"><p className="text-slate-400">Vacant Suites</p><p className="mt-1 text-white">{formatInt(activeBuildingSummary.vacantSuites)}</p></div>
                    <div className="border border-white/10 bg-black/20 p-2"><p className="text-slate-400">Expiring Suites</p><p className="mt-1 text-white">{formatInt(activeBuildingSummary.expiringSuites)}</p></div>
                    <div className="border border-white/10 bg-black/20 p-2"><p className="text-slate-400">Proposal Suites</p><p className="mt-1 text-white">{formatInt(activeBuildingSummary.proposalSuites)}</p></div>
                    <div className="border border-white/10 bg-black/20 p-2"><p className="text-slate-400">Tracked RSF</p><p className="mt-1 text-white">{formatInt(activeTrackedRsf)}</p></div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  {aiRecommendations.map((item) => <div key={item} className="border border-white/10 bg-black/20 p-2 text-xs text-slate-200">• {item}</div>)}
                </div>
                {error ? <p className="text-xs text-red-300">{error}</p> : null}
                <p className="text-xs text-cyan-100">{status}</p>
              </div>
            </PlatformPanel>

            <PlatformPanel kicker="Shortlist + Tours" title="Move Selected Suites Into Live Workflow">
              <div className="space-y-3 text-sm text-slate-300">
                <p>Select a deal, choose suites, and push them into a shortlist, scheduled tour, or proposal-requested state without leaving the building workspace.</p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <select className="input-premium" value={workflowDealId} onChange={(event) => setWorkflowDealId(event.target.value)}>
                    <option value="">No linked deal</option>
                    {workflowDeals.map((deal) => (
                      <option key={deal.id} value={deal.id}>
                        {deal.dealName} · {deal.stage}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input-premium"
                    value={shortlistName}
                    onChange={(event) => setShortlistName(event.target.value)}
                    placeholder="Shortlist name"
                  />
                  <input
                    className="input-premium"
                    type="datetime-local"
                    value={scheduledTourAt}
                    onChange={(event) => setScheduledTourAt(event.target.value)}
                  />
                  <input
                    className="input-premium"
                    value={workflowNotes}
                    onChange={(event) => setWorkflowNotes(event.target.value)}
                    placeholder="Tour or shortlist notes"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="border border-white/10 bg-black/20 p-2">
                    <p className="text-slate-500">Shortlists</p>
                    <p className="mt-1 text-white">{formatInt(activeBuildingShortlists.length)}</p>
                  </div>
                  <div className="border border-white/10 bg-black/20 p-2">
                    <p className="text-slate-500">Entries</p>
                    <p className="mt-1 text-white">{formatInt(activeBuildingShortlistEntries.length)}</p>
                  </div>
                  <div className="border border-white/10 bg-black/20 p-2">
                    <p className="text-slate-500">Tours</p>
                    <p className="mt-1 text-white">{formatInt(activeBuildingTours.filter((tour) => tour.status !== "cancelled").length)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => saveShortlistWorkflow("shortlist")} disabled={selectedSuites.length === 0}>
                    Add Selected Suites To Shortlist
                  </button>
                  <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => saveShortlistWorkflow("tour")} disabled={selectedSuites.length === 0}>
                    Schedule Selected Tours
                  </button>
                  <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => saveShortlistWorkflow("proposal_requested")} disabled={selectedSuites.length === 0}>
                    Mark Proposal Requested
                  </button>
                </div>
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {activeBuildingShortlistEntries.length === 0 && activeBuildingTours.length === 0 ? (
                    <p className="text-xs text-slate-500">No shortlist entries or tours recorded for this building yet.</p>
                  ) : (
                    <>
                      {activeBuildingShortlistEntries.slice(0, 8).map((entry) => (
                        <div key={entry.id} className="border border-white/10 bg-black/20 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${shortlistStatusTone(entry.status)}`}>{shortlistStatusLabel(entry.status)}</span>
                            <span className="text-white">Floor {entry.floor || "-"} · Suite {entry.suite}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">
                            {(crmState.shortlists.find((item) => item.id === entry.shortlistId)?.name || "Shortlist")} {entry.dealId ? `· ${workflowDeals.find((deal) => deal.id === entry.dealId)?.dealName || "Linked deal"}` : ""}
                          </p>
                        </div>
                      ))}
                      {activeBuildingTours.slice(0, 6).map((tour) => (
                        <div key={tour.id} className="border border-white/10 bg-black/20 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="border border-indigo-300/40 bg-indigo-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-indigo-50">{tour.status}</span>
                              <span className="text-white">Floor {tour.floor || "-"} · Suite {tour.suite}</span>
                            </div>
                            <span className="text-[11px] text-slate-400">{formatDateTime(tour.scheduledAt)}</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </PlatformPanel>

            <PlatformPanel kicker="Results" title="Filtered Buildings">
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {displayedBuildings.length === 0 ? <p className="text-sm text-slate-400">No buildings match the current filters.</p> : displayedBuildings.map((building, index) => (
                  (() => {
                    const designatedImage = getDesignatedBuildingImage(building);
                    const imageUrl = resolveBuildingImageUrl(designatedImage?.imageUrl || "", designatedImage?.sourceUrl || "");
                    const isMapSelected = selectedMapBuildingIds.includes(building.id);
                    return (
                      <button
                        key={building.id}
                        type="button"
                        onClick={() => focusBuilding(building)}
                        className={`w-full border text-left transition ${
                          activeInventoryBuilding?.id === building.id
                            ? "border-cyan-300 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]"
                            : isMapSelected
                              ? "border-amber-300 bg-amber-500/10 shadow-[0_0_0_1px_rgba(251,191,36,0.14)]"
                              : "border-white/15 bg-black/25 hover:bg-white/5"
                        }`}
                      >
                        <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-0">
                          <div className="relative min-h-[106px] border-r border-white/10 bg-black/35">
                            {imageUrl ? (
                              <img src={imageUrl} alt={displayBuildingName(building)} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,rgba(32,59,112,0.82),rgba(18,28,54,0.95))] p-3 text-left">
                                <div>
                                  <p className="text-lg font-semibold leading-none text-white">{displayBuildingName(building)}</p>
                                  <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-cyan-100">{building.submarket || building.market || "Austin Office"}</p>
                                </div>
                              </div>
                            )}
                            <div className="absolute left-2 top-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-white/15 bg-black/65 px-2 text-[10px] uppercase tracking-[0.12em] text-slate-200">
                              {formatInt(index + 1)}
                            </div>
                          </div>
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm text-white">{displayBuildingName(building)}</p>
                                  <span className="border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-200">{building.buildingClass || "Unclassified"}</span>
                                  {isMapSelected ? <span className="border border-amber-300/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-100">Map Selected</span> : null}
                                </div>
                                <p className="mt-1 text-xs text-slate-400">{[building.address, building.submarket, building.market].filter(Boolean).join(" / ") || "Austin office inventory"}</p>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                                  <div><span className="text-slate-500">RSF</span><p className="mt-1 text-white">{formatInt(building.totalRSF)}</p></div>
                                  <div><span className="text-slate-500">Stories</span><p className="mt-1 text-white">{formatInt(asNumber(building.numberOfStories))}</p></div>
                                  <div><span className="text-slate-500">Built</span><p className="mt-1 text-white">{asText(building.yearBuilt) || "-"}</p></div>
                                  <div><span className="text-slate-500">Owner</span><p className="mt-1 truncate text-white">{building.ownerName || "Pending"}</p></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })()
                ))}
              </div>
            </PlatformPanel>
          </div>
        </div>
      </PlatformDashboardTier>

      {activeInventoryBuilding ? (
        <PlatformDashboardTier
          label="Stacking Plan"
          title={`${displayBuildingName(activeInventoryBuilding)} Suite Stack`}
          description="Edit floors, suites, tenants, and economics in one building-first workspace. Current lease and sublease uploads continue to inform the stack, while proposals stay non-authoritative."
        >
          <div className="space-y-4">
            <PlatformPanel kicker="Suite Browser" title="Filter And Select Suites">
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <input
                    className="input-premium"
                    placeholder="Search suite, tenant, source"
                    value={suiteSearch}
                    onChange={(event) => setSuiteSearch(event.target.value)}
                  />
                  <select className="input-premium" value={suiteFloorFilter} onChange={(event) => setSuiteFloorFilter(event.target.value)}>
                    <option value="all">All floors</option>
                    {availableFloorOptions.map((floor) => (
                      <option key={floor} value={floor}>Floor {floor}</option>
                    ))}
                  </select>
                  <select className="input-premium" value={suiteStatusFilter} onChange={(event) => setSuiteStatusFilter(event.target.value as SuiteStatusFilter)}>
                    <option value="all">All suite states</option>
                    <option value="vacant">Vacant</option>
                    <option value="occupied">Occupied</option>
                    <option value="expiring">Expiring</option>
                    <option value="proposal_active">Proposal Active</option>
                    <option value="toured">Toured</option>
                  </select>
                  <div className="border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
                    <p className="text-slate-500">Selected</p>
                    <p className="mt-1 text-white">{formatInt(selectedSuites.length)} suites</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => setSelectedSuiteIds(filteredSuites.map((suite) => suite.id))} disabled={filteredSuites.length === 0}>
                    Select Filtered Suites
                  </button>
                  <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={() => setSelectedSuiteIds([])} disabled={selectedSuiteIds.length === 0}>
                    Clear Suite Selection
                  </button>
                  <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={queueSelectedSuitesForSurveys} disabled={selectedSuites.length === 0}>
                    Add Selected Suites To Surveys
                  </button>
                  <button type="button" className="btn-premium btn-premium-secondary disabled:opacity-50" onClick={queueSelectedSuitesForAnalyses} disabled={selectedSuites.length === 0}>
                    Add Selected Suites To Analyses
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {filteredSuites.length === 0 ? (
                    <p className="text-sm text-slate-400">No suites match the current suite filters.</p>
                  ) : filteredSuites.map((suite) => {
                    const selected = selectedSuiteIds.includes(suite.id);
                    return (
                      <button
                        key={suite.id}
                        type="button"
                        onClick={() => {
                          toggleSuiteSelection(suite.id);
                          persistBuildingFocus(clientId, activeInventoryBuilding, { floor: suite.floor, suite: suite.suite });
                        }}
                        className={`border p-3 text-left transition ${selected ? "border-cyan-300 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]" : "border-white/15 bg-black/20 hover:bg-white/5"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${suiteStatusTone(suite.status)}`}>{suiteStatusLabel(suite.status)}</span>
                              <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${suiteRateBand(suite.baseRent).tone}`}>{suiteRateBand(suite.baseRent).label}</span>
                              <span className={`border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${suiteExpiryTone(suite.expirationDate)}`}>{suite.expirationDate ? `Expires ${suite.expirationDate}` : "Expiration Pending"}</span>
                              <span className="text-sm text-white">Floor {suite.floor} · Suite {suite.suite}</span>
                            </div>
                            <p className="mt-2 text-xs text-slate-400">{suite.companyName || "Vacant / unassigned"} · {suiteSourceLabel(suite.source)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{selected ? "Selected" : "Select"}</span>
                            <span className={`inline-flex h-5 w-5 items-center justify-center border text-[11px] ${selected ? "border-cyan-300 bg-cyan-500/20 text-cyan-50" : "border-white/20 text-slate-400"}`}>{selected ? "✓" : ""}</span>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                          <div><span className="text-slate-500">RSF</span><p className="mt-1 text-white">{formatInt(suite.rsf)}</p></div>
                          <div><span className="text-slate-500">Base Rent</span><p className="mt-1 text-white">{suite.baseRent > 0 ? `${formatCurrency(suite.baseRent)}/SF` : "-"}</p></div>
                          <div><span className="text-slate-500">OpEx</span><p className="mt-1 text-white">{suite.opex > 0 ? `${formatCurrency(suite.opex)}/SF` : "-"}</p></div>
                          <div><span className="text-slate-500">Expiration</span><p className="mt-1 text-white">{asText(suite.expirationDate) || "-"}</p></div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </PlatformPanel>

            <CrmBuildingStackingPlan building={activeInventoryBuilding} row={activeStackingBuildingRow} companies={attachableCompanyOptions as CrmCompany[]} onSaveEntry={saveStackingPlanEntry} />
          </div>
        </PlatformDashboardTier>
      ) : null}
    </PlatformSection>
  );
}
