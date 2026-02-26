import { describe, expect, it } from "vitest";

import { formatMetricValue } from "@/lib/lease-engine/excel-export";

describe("notes formatting", () => {
  it("condenses and deduplicates repeated long legal bullets", () => {
    const repeated = [
      "Assignment / sublease: Assignment/Sublease: RIGHT: The existing lease shall be amended so that Tenant shall have the continuing right to assign the lease or sublet all or any portion of the premises at any time during the primary term or any extensions thereof, with Landlord's consent which shall not be unreasonably withheld, conditioned or delayed.",
      "Assignment / sublease: Assignment/Sublease: RIGHT: The existing lease shall be amended so that Tenant shall have the continuing right to assign the lease or sublet all or any portion of the premises at any time during the primary term or any extensions thereof, with Landlord's consent which shall not be unreasonably withheld, conditioned or delayed.",
    ].join(" | ");

    const formatted = formatMetricValue("notes", repeated);
    const bullets = formatted.split(/\n+/).filter((line) => line.trim().startsWith("• "));

    expect(bullets.length).toBe(1);
    expect(formatted).not.toContain("Assignment/Sublease: RIGHT:");
    expect(formatted.length).toBeLessThan(220);
    expect(formatted.toLowerCase()).toContain("not unreasonably withheld");
  });

  it("extracts concise parking summary details", () => {
    const raw =
      "Parking: Parking charges: PARKING: Parking is available in a structured, secured above grade pedestal garage. " +
      "Tenant shall be provided parking on a must take and pay basis at a ratio of 2.7 permits per 1,000 RSF. " +
      "Tenant shall have the right to convert up to 10% of Tenant parking permits to reserved stalls.";

    const formatted = formatMetricValue("notes", raw);
    expect(formatted).toContain("Parking: 2.7/1,000 RSF");
    expect(formatted).toContain("must-take-and-pay");
    expect(formatted).toContain("up to 10% convertible to reserved");
  });

  it("drops vague renewal and numeric noise while keeping useful notes", () => {
    const raw = [
      "General: 8",
      "Renewal / extension: Renewal option for stated term",
      "Operating expenses: OpEx estimate: source year 2026 value escalated 3.00% YoY to 2027 ($26.80/SF).",
    ].join(" | ");

    const formatted = formatMetricValue("notes", raw);
    expect(formatted).not.toContain("General: 8");
    expect(formatted).not.toContain("stated term");
    expect(formatted).toContain("Operating expenses: OpEx estimate");
  });

  it("formats renewal notes with only option count and duration", () => {
    const raw =
      "Renewal / extension: Tenant shall have one option to renew for 60 months at FMV with arbitration.";
    const formatted = formatMetricValue("notes", raw);
    expect(formatted).toContain("Renewal / extension: 1 (One) renewal option for 60 (Sixty) months at FMV");
    expect(formatted).not.toContain("arbitration");
  });

  it("formats renewal notes with numeric + word years when present", () => {
    const raw =
      "Renewal / extension: Tenant has one (1) renewal option for 4 (Four) years at fair market value.";
    const formatted = formatMetricValue("notes", raw);
    expect(formatted).toContain("Renewal / extension: 1 (One) renewal option for 4 (Four) years at FMV");
  });
});
