import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_MODULE_ID_BY_MODE,
  FINANCIAL_ANALYSES_TOOL_TABS,
  PLATFORM_MODULES,
  getPlatformModulesForMode,
  getDefaultPlatformModuleId,
  isFinancialAnalysesToolId,
  isPlatformModuleId,
  resolveActivePlatformModule,
} from "@/lib/platform/module-registry";
import { LANDLORD_REP_MODE, TENANT_REP_MODE } from "@/lib/workspace/representation-mode";

describe("platform/module-registry", () => {
  it("exposes unique module ids", () => {
    const ids = PLATFORM_MODULES.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(getDefaultPlatformModuleId(TENANT_REP_MODE));
  });

  it("resolves module with auth-aware fallback and mode defaults", () => {
    expect(resolveActivePlatformModule("marketing", true, TENANT_REP_MODE)).toBe("marketing");
    expect(resolveActivePlatformModule("surveys", true, TENANT_REP_MODE)).toBe("marketing");
    expect(resolveActivePlatformModule("marketing", false, TENANT_REP_MODE)).toBe(
      DEFAULT_PLATFORM_MODULE_ID_BY_MODE[TENANT_REP_MODE],
    );
    expect(resolveActivePlatformModule("unknown-module", true, TENANT_REP_MODE)).toBe(
      DEFAULT_PLATFORM_MODULE_ID_BY_MODE[TENANT_REP_MODE],
    );
    expect(resolveActivePlatformModule("unknown-module", true, LANDLORD_REP_MODE)).toBe(
      DEFAULT_PLATFORM_MODULE_ID_BY_MODE[LANDLORD_REP_MODE],
    );
  });

  it("recognizes module and financial-tool ids", () => {
    expect(isPlatformModuleId("obligations")).toBe(true);
    expect(isPlatformModuleId("deals")).toBe(true);
    expect(isPlatformModuleId("not-real")).toBe(false);

    const toolIds = FINANCIAL_ANALYSES_TOOL_TABS.map((tab) => tab.id);
    expect(toolIds.every((id) => isFinancialAnalysesToolId(id))).toBe(true);
    expect(isFinancialAnalysesToolId("made-up-tool")).toBe(false);
  });

  it("applies landlord module labels while preserving ids", () => {
    const landlordModules = getPlatformModulesForMode(LANDLORD_REP_MODE);
    expect(landlordModules.map((module) => module.id)).toEqual([
      "deals",
      "buildings",
      "financial-analyses",
      "marketing",
      "completed-leases",
      "obligations",
    ]);
    expect(landlordModules.find((module) => module.id === "financial-analyses")?.label).toBe("Availabilities");
    expect(landlordModules.find((module) => module.id === "marketing")?.label).toBe("Marketing");
    expect(landlordModules.find((module) => module.id === "obligations")?.label).toBe("Reporting");
  });
});
