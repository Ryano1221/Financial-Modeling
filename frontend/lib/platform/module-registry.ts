import {
  DEFAULT_REPRESENTATION_MODE,
  LANDLORD_REP_MODE,
  TENANT_REP_MODE,
  type RepresentationMode,
} from "@/lib/workspace/representation-mode";

type PlatformModuleDefinition = {
  id: "deals" | "financial-analyses" | "surveys" | "completed-leases" | "obligations" | "documents";
  label: string;
  description: string;
  requiresAuth: boolean;
};

const MODULE_DEFINITION_BY_ID: Record<PlatformModuleDefinition["id"], Omit<PlatformModuleDefinition, "id">> = {
  deals: {
    label: "CRM",
    description: "Pipeline lifecycle, linked workflows, and execution tracking.",
    requiresAuth: true,
  },
  "financial-analyses": {
    label: "Financial Analyses",
    description: "Financial modeling and side-by-side lease comparisons.",
    requiresAuth: false,
  },
  surveys: {
    label: "Surveys",
    description: "Structure market surveys and publish branded client views.",
    requiresAuth: true,
  },
  "completed-leases": {
    label: "Lease Abstracts",
    description: "Parse executed leases and generate abstract outputs.",
    requiresAuth: true,
  },
  obligations: {
    label: "Obligations",
    description: "Track obligation timelines, documents, and portfolio risk.",
    requiresAuth: true,
  },
  documents: {
    label: "Documents",
    description: "Document library, linkage, and connected record visibility.",
    requiresAuth: true,
  },
};

const TENANT_MODULE_ORDER: readonly PlatformModuleDefinition["id"][] = [
  "deals",
  "financial-analyses",
  "surveys",
  "completed-leases",
  "obligations",
  "documents",
];

const LANDLORD_MODULE_ORDER: readonly PlatformModuleDefinition["id"][] = [
  "deals",
  "financial-analyses",
  "surveys",
  "completed-leases",
  "obligations",
  "documents",
];

const LANDLORD_MODULE_LABEL_OVERRIDES: Partial<Record<PlatformModuleDefinition["id"], string>> = {
  "financial-analyses": "Availabilities",
  surveys: "Marketing",
  "completed-leases": "Lease Tracking",
  obligations: "Reporting",
  documents: "Documents",
};

const LANDLORD_MODULE_DESCRIPTION_OVERRIDES: Partial<Record<PlatformModuleDefinition["id"], string>> = {
  deals: "Inquiry-to-execution pipeline for suites and listing opportunities.",
  "financial-analyses": "Availability inventory, suite economics, and listing positioning.",
  surveys: "Marketing package workflows, flyers, and listing collateral.",
  "completed-leases": "Lease execution tracking and closed package records.",
  obligations: "Property performance, expirations, and landlord reporting.",
  documents: "Document intelligence, linkage, and building-level file context.",
};

export const DEFAULT_PLATFORM_MODULE_ID_BY_MODE: Record<RepresentationMode, PlatformModuleDefinition["id"]> = {
  tenant_rep: "financial-analyses",
  landlord_rep: "deals",
};

function moduleDefinitionForMode(
  id: PlatformModuleDefinition["id"],
  mode: RepresentationMode,
): PlatformModuleDefinition {
  const base = MODULE_DEFINITION_BY_ID[id];
  if (mode !== LANDLORD_REP_MODE) {
    return {
      id,
      ...base,
    };
  }
  return {
    id,
    ...base,
    label: LANDLORD_MODULE_LABEL_OVERRIDES[id] || base.label,
    description: LANDLORD_MODULE_DESCRIPTION_OVERRIDES[id] || base.description,
  };
}

export function getPlatformModulesForMode(
  mode: RepresentationMode | null | undefined,
): readonly PlatformModuleDefinition[] {
  const resolvedMode = mode || DEFAULT_REPRESENTATION_MODE;
  const orderedIds = resolvedMode === LANDLORD_REP_MODE ? LANDLORD_MODULE_ORDER : TENANT_MODULE_ORDER;
  return orderedIds.map((id) => moduleDefinitionForMode(id, resolvedMode));
}

export const PLATFORM_MODULES = getPlatformModulesForMode(DEFAULT_REPRESENTATION_MODE);

export type PlatformModuleId = PlatformModuleDefinition["id"];

export const DEFAULT_PLATFORM_MODULE_ID: PlatformModuleId = DEFAULT_PLATFORM_MODULE_ID_BY_MODE[DEFAULT_REPRESENTATION_MODE];

export const FINANCIAL_ANALYSES_TOOL_TABS = [
  {
    id: "lease-comparison",
    label: "Financial Analysis",
    description: "Scenario comparison and lease economics.",
  },
  {
    id: "sublease-recovery",
    label: "Sublease Recovery Analysis",
    description: "Recovery outcomes vs remaining obligation.",
  },
] as const;

export type FinancialAnalysesToolId = (typeof FINANCIAL_ANALYSES_TOOL_TABS)[number]["id"];

const MODULE_ID_SET = new Set<string>(Object.keys(MODULE_DEFINITION_BY_ID));
const FINANCIAL_TOOL_ID_SET = new Set<string>(FINANCIAL_ANALYSES_TOOL_TABS.map((tab) => tab.id));

export function isPlatformModuleId(value: string | null | undefined): value is PlatformModuleId {
  const raw = String(value || "").trim().toLowerCase();
  return MODULE_ID_SET.has(raw);
}

export function isFinancialAnalysesToolId(value: string | null | undefined): value is FinancialAnalysesToolId {
  const raw = String(value || "").trim().toLowerCase();
  return FINANCIAL_TOOL_ID_SET.has(raw);
}

export function getDefaultPlatformModuleId(
  mode: RepresentationMode | null | undefined,
): PlatformModuleId {
  const resolvedMode = mode || DEFAULT_REPRESENTATION_MODE;
  return DEFAULT_PLATFORM_MODULE_ID_BY_MODE[resolvedMode];
}

export function getPlatformModuleById(
  moduleId: PlatformModuleId,
  mode: RepresentationMode | null | undefined = DEFAULT_REPRESENTATION_MODE,
) {
  const modules = getPlatformModulesForMode(mode);
  return modules.find((module) => module.id === moduleId) || modules[0];
}

export function resolveActivePlatformModule(
  rawValue: string | null | undefined,
  isAuthenticated: boolean,
  mode: RepresentationMode | null | undefined = DEFAULT_REPRESENTATION_MODE,
): PlatformModuleId {
  const fallback = getDefaultPlatformModuleId(mode);
  if (!isPlatformModuleId(rawValue)) return fallback;
  const resolved = getPlatformModuleById(rawValue, mode);
  if (!isAuthenticated && resolved.requiresAuth) return fallback;
  return resolved.id;
}
