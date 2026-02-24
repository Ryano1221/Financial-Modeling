import { describe, expect, it } from "vitest";
import { inferRentEscalationPercentFromSteps } from "@/lib/rent-escalation";

describe("inferRentEscalationPercentFromSteps", () => {
  it("infers annual escalation from near-yearly transitions", () => {
    const pct = inferRentEscalationPercentFromSteps([
      { start: 0, end: 11, rate_psf_yr: 40 },
      { start: 12, end: 23, rate_psf_yr: 41.2 }, // 3%
      { start: 24, end: 35, rate_psf_yr: 42.436 }, // 3%
    ]);
    expect(pct).toBeCloseTo(0.03, 3);
  });

  it("uses explicit step-to-step change for sparse multi-year steps", () => {
    const pct = inferRentEscalationPercentFromSteps([
      { start: 1, end: 24, rate_psf_yr: 45.0 },
      { start: 25, end: 48, rate_psf_yr: 46.35 }, // explicit 3% step change
      { start: 49, end: 72, rate_psf_yr: 47.7405 }, // explicit 3% step change
    ]);
    expect(pct).toBeCloseTo(0.03, 3);
  });

  it("returns 0 when rates never change", () => {
    const pct = inferRentEscalationPercentFromSteps([
      { start: 0, end: 11, rate_psf_yr: 50 },
      { start: 12, end: 23, rate_psf_yr: 50 },
      { start: 24, end: 35, rate_psf_yr: 50 },
    ]);
    expect(pct).toBe(0);
  });
});

