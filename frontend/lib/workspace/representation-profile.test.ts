import { describe, expect, it } from "vitest";
import {
  REPRESENTATION_MODE_PROFILES,
  getRepresentationModeProfile,
} from "@/lib/workspace/representation-profile";
import { getDefaultCrmSettingsForMode } from "@/lib/workspace/types";

describe("workspace/representation-profile", () => {
  it("resolves tenant and landlord defaults from one shared profile map", () => {
    const tenant = getRepresentationModeProfile("tenant_rep");
    const landlord = getRepresentationModeProfile("landlord_rep");

    expect(tenant.navigation.defaultModule).toBe("deals");
    expect(tenant.crm.defaultDealsView).toBe("client_grouped");
    expect(tenant.crm.availableViews).toContain("client_grouped");
    expect(tenant.ai.suggestedPrompts[0]).toContain("prospects");
    expect(tenant.exports.summary).toContain("occupancy cost");

    expect(landlord.navigation.defaultModule).toBe("deals");
    expect(landlord.crm.defaultDealsView).toBe("stacking_plan");
    expect(landlord.crm.availableViews).toContain("stacking_plan");
    expect(landlord.navigation.modules.find((module) => module.id === "deals")?.label).toBe("Leasing Console");
    expect(landlord.exports.summary).toContain("ownership");
  });

  it("drives CRM defaults through representation mode instead of separate storage models", () => {
    expect(getDefaultCrmSettingsForMode("tenant_rep").defaultDealsView).toBe("client_grouped");
    expect(getDefaultCrmSettingsForMode("landlord_rep").defaultDealsView).toBe("stacking_plan");
  });

  it("exposes dashboard, reminder, template, and export presets for both modes", () => {
    for (const profile of Object.values(REPRESENTATION_MODE_PROFILES)) {
      expect(profile.crm.dashboardWidgets.length).toBeGreaterThan(3);
      expect(profile.ai.nextBestActions.length).toBeGreaterThan(2);
      expect(profile.templates.length).toBeGreaterThan(1);
      expect(profile.reminders.expirationMonths.length).toBeGreaterThan(2);
      expect(profile.exports.excelDescriptor.length).toBeGreaterThan(3);
      expect(profile.onboarding.steps.length).toBeGreaterThan(2);
    }
  });
});
