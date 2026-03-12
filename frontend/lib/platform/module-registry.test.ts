import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_MODULE_ID,
  FINANCIAL_ANALYSES_TOOL_TABS,
  PLATFORM_MODULES,
  isFinancialAnalysesToolId,
  isPlatformModuleId,
  resolveActivePlatformModule,
} from "@/lib/platform/module-registry";

describe("platform/module-registry", () => {
  it("exposes unique module ids", () => {
    const ids = PLATFORM_MODULES.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_PLATFORM_MODULE_ID);
  });

  it("resolves module with auth-aware fallback", () => {
    expect(resolveActivePlatformModule("surveys", true)).toBe("surveys");
    expect(resolveActivePlatformModule("surveys", false)).toBe(DEFAULT_PLATFORM_MODULE_ID);
    expect(resolveActivePlatformModule("unknown-module", true)).toBe(DEFAULT_PLATFORM_MODULE_ID);
  });

  it("recognizes module and financial-tool ids", () => {
    expect(isPlatformModuleId("obligations")).toBe(true);
    expect(isPlatformModuleId("deals")).toBe(true);
    expect(isPlatformModuleId("not-real")).toBe(false);

    const toolIds = FINANCIAL_ANALYSES_TOOL_TABS.map((tab) => tab.id);
    expect(toolIds.every((id) => isFinancialAnalysesToolId(id))).toBe(true);
    expect(isFinancialAnalysesToolId("made-up-tool")).toBe(false);
  });
});
