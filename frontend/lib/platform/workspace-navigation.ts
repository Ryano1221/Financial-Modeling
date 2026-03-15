import {
  DEFAULT_REPRESENTATION_MODE,
  LANDLORD_REP_MODE,
  TENANT_REP_MODE,
  type RepresentationMode,
} from "@/lib/workspace/representation-mode";
import type { PlatformModuleId } from "@/lib/platform/module-registry";

export type WorkspaceTabId =
  | "overview"
  | "locations"
  | "deals"
  | "market-survey"
  | "analyses"
  | "documents"
  | "obligations"
  | "activity"
  | "tenants"
  | "availabilities"
  | "insights";

export type WorkspaceNavId =
  | "clients"
  | "buildings"
  | "deals"
  | "market"
  | "documents"
  | "insights"
  | "availabilities"
  | "tenants";

type WorkspaceTabDefinition = {
  id: WorkspaceTabId;
  label: string;
  description: string;
};

type WorkspaceNavDefinition = {
  id: WorkspaceNavId;
  label: string;
  description: string;
  targetTab: WorkspaceTabId;
};

const TENANT_WORKSPACE_TABS: readonly WorkspaceTabDefinition[] = [
  { id: "overview", label: "Overview", description: "Client summary, priorities, and next actions." },
  { id: "locations", label: "Locations", description: "Markets, buildings, and location context tied to the client." },
  { id: "deals", label: "Deals", description: "Requirement pipeline and negotiation workflow." },
  { id: "market-survey", label: "Market Survey", description: "Survey rows, shortlist review, and map context." },
  { id: "analyses", label: "Analyses", description: "Financial comparison and recovery workflows from client documents." },
  { id: "documents", label: "Documents", description: "Client library, lease abstracts, and document stack." },
  { id: "obligations", label: "Obligations", description: "Expirations, notices, and obligation tracking." },
  { id: "activity", label: "Activity", description: "Recent workflow events, AI actions, and follow-up queue." },
] as const;

const LANDLORD_WORKSPACE_TABS: readonly WorkspaceTabDefinition[] = [
  { id: "overview", label: "Overview", description: "Building dashboard, occupancy, and pipeline summary." },
  { id: "tenants", label: "Tenants", description: "Tenant roster, lease dates, and occupancy context." },
  { id: "availabilities", label: "Availabilities", description: "Available spaces, marketing inventory, and package review." },
  { id: "deals", label: "Deals", description: "Inquiry, tour, proposal, and lease execution pipeline." },
  { id: "documents", label: "Documents", description: "Building documents, lease tracking, and document stack." },
  { id: "insights", label: "Insights", description: "Reporting, analytics, obligations, and AI-guided actions." },
] as const;

const TENANT_PRIMARY_NAV: readonly WorkspaceNavDefinition[] = [
  { id: "clients", label: "Clients", description: "Open the client workspace overview.", targetTab: "overview" },
  { id: "deals", label: "Deals", description: "Jump into the active client pipeline.", targetTab: "deals" },
  { id: "market", label: "Market", description: "Open survey and analysis workflow inside the client workspace.", targetTab: "market-survey" },
  { id: "documents", label: "Documents", description: "Open the client document stack and lease abstracts.", targetTab: "documents" },
  { id: "insights", label: "Insights", description: "Open obligations, activity, and follow-up insight.", targetTab: "activity" },
] as const;

const LANDLORD_PRIMARY_NAV: readonly WorkspaceNavDefinition[] = [
  { id: "buildings", label: "Buildings", description: "Open the building workspace overview.", targetTab: "overview" },
  { id: "availabilities", label: "Availabilities", description: "Open available-space and marketing workflow.", targetTab: "availabilities" },
  { id: "deals", label: "Deals", description: "Open inquiry and execution pipeline.", targetTab: "deals" },
  { id: "tenants", label: "Tenants", description: "Open tenant roster and occupancy view.", targetTab: "tenants" },
  { id: "insights", label: "Insights", description: "Open reporting, obligations, and analytics.", targetTab: "insights" },
] as const;

const DEFAULT_TAB_BY_MODE: Record<RepresentationMode, WorkspaceTabId> = {
  tenant_rep: "overview",
  landlord_rep: "overview",
};

const WORKSPACE_TAB_IDS = new Set<string>([
  ...TENANT_WORKSPACE_TABS.map((tab) => tab.id),
  ...LANDLORD_WORKSPACE_TABS.map((tab) => tab.id),
]);

const NAV_IDS = new Set<string>([
  ...TENANT_PRIMARY_NAV.map((item) => item.id),
  ...LANDLORD_PRIMARY_NAV.map((item) => item.id),
]);

const LEGACY_MODULE_TO_TENANT_TAB: Record<PlatformModuleId, WorkspaceTabId> = {
  deals: "deals",
  "financial-analyses": "analyses",
  surveys: "market-survey",
  "completed-leases": "documents",
  obligations: "obligations",
};

const LEGACY_MODULE_TO_LANDLORD_TAB: Record<PlatformModuleId, WorkspaceTabId> = {
  deals: "deals",
  "financial-analyses": "availabilities",
  surveys: "availabilities",
  "completed-leases": "documents",
  obligations: "insights",
};

export function getWorkspaceLabel(mode: RepresentationMode | null | undefined): string {
  return (mode || DEFAULT_REPRESENTATION_MODE) === LANDLORD_REP_MODE
    ? "Building Workspace"
    : "Client Workspace";
}

export function getWorkspaceTabsForMode(mode: RepresentationMode | null | undefined): readonly WorkspaceTabDefinition[] {
  return (mode || DEFAULT_REPRESENTATION_MODE) === LANDLORD_REP_MODE
    ? LANDLORD_WORKSPACE_TABS
    : TENANT_WORKSPACE_TABS;
}

export function getPrimaryWorkspaceNavForMode(mode: RepresentationMode | null | undefined): readonly WorkspaceNavDefinition[] {
  return (mode || DEFAULT_REPRESENTATION_MODE) === LANDLORD_REP_MODE
    ? LANDLORD_PRIMARY_NAV
    : TENANT_PRIMARY_NAV;
}

export function isWorkspaceTabId(value: string | null | undefined): value is WorkspaceTabId {
  return WORKSPACE_TAB_IDS.has(String(value || "").trim().toLowerCase());
}

export function isWorkspaceNavId(value: string | null | undefined): value is WorkspaceNavId {
  return NAV_IDS.has(String(value || "").trim().toLowerCase());
}

export function getDefaultWorkspaceTabId(mode: RepresentationMode | null | undefined): WorkspaceTabId {
  return DEFAULT_TAB_BY_MODE[mode || DEFAULT_REPRESENTATION_MODE];
}

export function getWorkspaceTabById(
  tabId: WorkspaceTabId,
  mode: RepresentationMode | null | undefined,
): WorkspaceTabDefinition {
  const tabs = getWorkspaceTabsForMode(mode);
  return tabs.find((tab) => tab.id === tabId) || tabs[0];
}

export function resolveWorkspaceTab(
  rawTab: string | null | undefined,
  mode: RepresentationMode | null | undefined,
  legacyModule?: PlatformModuleId | null,
): WorkspaceTabId {
  const resolvedMode = mode || DEFAULT_REPRESENTATION_MODE;
  if (isWorkspaceTabId(rawTab)) {
    const tab = getWorkspaceTabById(rawTab, resolvedMode);
    return tab.id;
  }
  if (legacyModule) {
    return resolvedMode === LANDLORD_REP_MODE
      ? LEGACY_MODULE_TO_LANDLORD_TAB[legacyModule]
      : LEGACY_MODULE_TO_TENANT_TAB[legacyModule];
  }
  return getDefaultWorkspaceTabId(resolvedMode);
}

export function resolveNavToWorkspaceTab(
  rawNav: string | null | undefined,
  mode: RepresentationMode | null | undefined,
): WorkspaceTabId | null {
  if (!isWorkspaceNavId(rawNav)) return null;
  const items = getPrimaryWorkspaceNavForMode(mode);
  return items.find((item) => item.id === rawNav)?.targetTab || null;
}
