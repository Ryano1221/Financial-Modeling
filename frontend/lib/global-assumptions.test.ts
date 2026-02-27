import { describe, expect, it } from "vitest";

import { buildOverarchingAssumptionNotes } from "./global-assumptions";

describe("buildOverarchingAssumptionNotes", () => {
  it("renders a single-rate discount assumption when rates are identical", () => {
    const notes = buildOverarchingAssumptionNotes([0.08, 0.08]);
    expect(notes).toHaveLength(7);
    expect(notes[4]).toBe("Landlord's Net Effective Return includes total net rent less concession and lease commission.");
    expect(notes[6]).toBe("8.0% discount rate is used.");
  });

  it("renders a scenario-specific discount assumption when rates vary", () => {
    const notes = buildOverarchingAssumptionNotes([0.08, 0.05]);
    expect(notes[6]).toBe("Scenario-specific discount rates are used (5.0%, 8.0%).");
  });
});
