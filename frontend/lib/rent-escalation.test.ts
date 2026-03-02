import { describe, expect, it } from "vitest";
import {
  inferDisplayedRentEscalationPercentFromSteps,
  inferRentEscalationPercentFromSteps,
  initialBaseRentPsfYrFromSteps,
} from "@/lib/rent-escalation";

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

describe("initialBaseRentPsfYrFromSteps", () => {
  it("returns first non-zero step rate", () => {
    const rate = initialBaseRentPsfYrFromSteps([
      { start: 0, end: 11, rate_psf_yr: 33 },
      { start: 12, end: 23, rate_psf_yr: 33.99 },
    ]);
    expect(rate).toBeCloseTo(33, 6);
  });
});

describe("inferDisplayedRentEscalationPercentFromSteps", () => {
  it("prefers early annual transitions for display", () => {
    const pct = inferDisplayedRentEscalationPercentFromSteps([
      { start: 0, end: 11, rate_psf_yr: 33.0 },
      { start: 12, end: 23, rate_psf_yr: 33.99 }, // 3.00%
      { start: 24, end: 35, rate_psf_yr: 34.99 }, // ~2.94%
      { start: 36, end: 47, rate_psf_yr: 40.0 }, // outlier later jump
    ]);
    expect(pct).toBeCloseTo(0.03, 2);
  });

  it("ignores boundary-split duplicate rate rows when inferring escalation", () => {
    const pct = inferDisplayedRentEscalationPercentFromSteps([
      { start: 0, end: 0, rate_psf_yr: 33.0 },
      { start: 1, end: 6, rate_psf_yr: 33.0 },
      { start: 7, end: 11, rate_psf_yr: 33.0 },
      { start: 12, end: 12, rate_psf_yr: 33.99 },
      { start: 13, end: 23, rate_psf_yr: 33.99 },
      { start: 24, end: 24, rate_psf_yr: 35.0097 },
      { start: 25, end: 35, rate_psf_yr: 35.0097 },
    ]);
    expect(pct).toBeCloseTo(0.03, 3);
  });
});
