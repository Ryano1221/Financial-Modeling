import { describe, expect, it } from "vitest";
import {
  buildDefaultMarketingForm,
  canGenerateMarketingFlyer,
  mapCanonicalLeaseToMarketingForm,
  marketingLeaseTypeForMode,
  marketingOfferLabel,
} from "@/lib/marketing/engine";
import { LANDLORD_REP_MODE, TENANT_REP_MODE } from "@/lib/workspace/representation-mode";
import type { BackendCanonicalLease } from "@/lib/types";

describe("marketing/engine", () => {
  it("uses representation mode for lease/sublease wording", () => {
    expect(marketingLeaseTypeForMode(TENANT_REP_MODE)).toBe("Sublease");
    expect(marketingLeaseTypeForMode(LANDLORD_REP_MODE)).toBe("Direct Lease");
    expect(marketingOfferLabel("Sublease")).toBe("For Sublease");
    expect(marketingOfferLabel("Direct Lease")).toBe("For Lease");
  });

  it("maps normalized lease fields into the flyer form", () => {
    const canonical = {
      building_name: "Pier 70",
      address: "1 Pier 70, San Francisco, CA",
      suite: "200",
      floor: "2",
      rsf: 28000,
      expiration_date: "2030-04-30",
      rent_schedule: [{ start_month: 1, end_month: 12, rent_psf_annual: 42 }],
      opex_psf_year_1: 30.22,
      commencement_date: "2025-05-01",
      term_months: 60,
      free_rent_months: 0,
      discount_rate_annual: 0.08,
    } satisfies BackendCanonicalLease;
    const mapped = mapCanonicalLeaseToMarketingForm({
      canonical,
      currentForm: buildDefaultMarketingForm({ representationMode: TENANT_REP_MODE }),
      representationMode: TENANT_REP_MODE,
    });

    expect(mapped.form.building_name).toBe("Pier 70");
    expect(mapped.form.suite_number).toBe("200");
    expect(mapped.form.rsf).toBe("28000");
    expect(mapped.form.lease_type).toBe("Sublease");
    expect(mapped.form.rate).toBe("$42.00/SF Sublease");
    expect(mapped.form.opex).toBe("$30.22");
    expect(mapped.autoFilled.building_name).toBe(true);
  });

  it("requires the minimum flyer fields before generate", () => {
    const form = buildDefaultMarketingForm();
    expect(canGenerateMarketingFlyer(form)).toBe(false);
    expect(canGenerateMarketingFlyer({ ...form, building_name: "A", address: "B", suite_number: "100", rsf: "1000" })).toBe(true);
  });
});
