export const PLATFORM_MODULES = [
  {
    id: "financial-analyses",
    label: "Financial Analyses",
    description: "Financial modeling and side-by-side lease comparisons.",
    requiresAuth: false,
  },
  {
    id: "completed-leases",
    label: "Completed Leases",
    description: "Parse executed leases and generate abstract outputs.",
    requiresAuth: true,
  },
  {
    id: "surveys",
    label: "Surveys",
    description: "Structure market surveys and publish branded client views.",
    requiresAuth: true,
  },
  {
    id: "obligations",
    label: "Obligations",
    description: "Track obligation timelines, documents, and portfolio risk.",
    requiresAuth: true,
  },
] as const;

export type PlatformModuleId = (typeof PLATFORM_MODULES)[number]["id"];

export const DEFAULT_PLATFORM_MODULE_ID: PlatformModuleId = "financial-analyses";

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

const MODULE_ID_SET = new Set<string>(PLATFORM_MODULES.map((module) => module.id));
const FINANCIAL_TOOL_ID_SET = new Set<string>(FINANCIAL_ANALYSES_TOOL_TABS.map((tab) => tab.id));

export function isPlatformModuleId(value: string | null | undefined): value is PlatformModuleId {
  const raw = String(value || "").trim().toLowerCase();
  return MODULE_ID_SET.has(raw);
}

export function isFinancialAnalysesToolId(value: string | null | undefined): value is FinancialAnalysesToolId {
  const raw = String(value || "").trim().toLowerCase();
  return FINANCIAL_TOOL_ID_SET.has(raw);
}

export function getPlatformModuleById(moduleId: PlatformModuleId) {
  return PLATFORM_MODULES.find((module) => module.id === moduleId) || PLATFORM_MODULES[0];
}

export function resolveActivePlatformModule(
  rawValue: string | null | undefined,
  isAuthenticated: boolean,
): PlatformModuleId {
  if (!isPlatformModuleId(rawValue)) return DEFAULT_PLATFORM_MODULE_ID;
  const resolved = getPlatformModuleById(rawValue);
  if (!isAuthenticated && resolved.requiresAuth) return DEFAULT_PLATFORM_MODULE_ID;
  return resolved.id;
}
