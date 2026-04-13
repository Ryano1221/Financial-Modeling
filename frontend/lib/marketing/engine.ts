import type { BackendCanonicalLease } from "@/lib/types";
import { LANDLORD_REP_MODE, type RepresentationMode } from "@/lib/workspace/representation-mode";
import type {
  MarketingAutoFilledFields,
  MarketingFlyerForm,
  MarketingGeneratedCopy,
  MarketingLeaseType,
} from "@/lib/marketing/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function currency(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  return `$${num.toFixed(2)}`;
}

function firstRentPsf(canonical: BackendCanonicalLease | null | undefined): number {
  const schedule = Array.isArray(canonical?.rent_schedule) ? canonical?.rent_schedule : [];
  const first = schedule?.find((step) => Number(step?.rent_psf_annual) > 0);
  return Number(first?.rent_psf_annual) || 0;
}

export function marketingLeaseTypeForMode(mode: RepresentationMode | null | undefined): MarketingLeaseType {
  return mode === LANDLORD_REP_MODE ? "Direct Lease" : "Sublease";
}

export function marketingOfferLabel(leaseType: MarketingLeaseType): string {
  return leaseType === "Sublease" ? "For Sublease" : "For Lease";
}

export function buildDefaultMarketingForm(input: {
  representationMode?: RepresentationMode | null;
  brokerName?: string;
  brokerEmail?: string;
  brokerPhone?: string;
  primaryColor?: string;
  secondaryColor?: string;
} = {}): MarketingFlyerForm {
  return {
    building_name: "",
    address: "",
    suite_number: "",
    rsf: "",
    floor: "",
    availability: "Immediately",
    lease_type: marketingLeaseTypeForMode(input.representationMode),
    rate: "",
    opex: "",
    term_expiration: "",
    suite_features: "",
    building_features: "",
    broker: {
      name: asText(input.brokerName),
      email: asText(input.brokerEmail),
      phone: asText(input.brokerPhone),
    },
    co_brokers: [],
    layout_style: "Modern",
    primary_color: asText(input.primaryColor) || "#00E5FF",
    secondary_color: asText(input.secondaryColor) || "#B8F36B",
    include_floorplan: true,
  };
}

export function mapCanonicalLeaseToMarketingForm(input: {
  canonical: BackendCanonicalLease | null | undefined;
  currentForm: MarketingFlyerForm;
  representationMode?: RepresentationMode | null;
}): { form: MarketingFlyerForm; autoFilled: MarketingAutoFilledFields } {
  const canonical = input.canonical;
  const leaseType = marketingLeaseTypeForMode(input.representationMode);
  const rentPsf = firstRentPsf(canonical);
  const next: MarketingFlyerForm = {
    ...input.currentForm,
    lease_type: leaseType,
  };
  const autoFilled: MarketingAutoFilledFields = {};

  const assign = (key: keyof MarketingFlyerForm, value: unknown) => {
    if (key === "broker" || key === "co_brokers" || key === "layout_style" || key === "include_floorplan") return;
    const text = asText(value);
    if (!text) return;
    next[key] = text as never;
    autoFilled[key] = true;
  };

  assign("building_name", canonical?.building_name || canonical?.premises_name);
  assign("address", canonical?.address);
  assign("suite_number", canonical?.suite);
  assign("rsf", Number(canonical?.rsf) > 0 ? String(Math.round(Number(canonical?.rsf))) : "");
  assign("floor", canonical?.floor);
  assign("term_expiration", canonical?.expiration_date);
  assign("rate", rentPsf > 0 ? `${currency(rentPsf)}/SF ${leaseType === "Sublease" ? "Sublease" : asText(canonical?.lease_type) || "NNN"}` : "");
  assign("opex", currency(canonical?.opex_psf_year_1));
  assign("suite_features", canonical?.notes);

  if (!asText(next.availability)) {
    next.availability = "Immediately";
    autoFilled.availability = true;
  }

  return { form: next, autoFilled };
}

function normalizeBulletLine(line: string): string {
  return line
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,\s]+$/g, "");
}

export function cleanMarketingBullets(raw: string, fallback: string[], limit = 6): string[] {
  const lines = asText(raw)
    .split(/\n|;|•/)
    .map(normalizeBulletLine)
    .filter(Boolean);
  const unique = Array.from(new Set(lines));
  return (unique.length > 0 ? unique : fallback).slice(0, limit);
}

export function generateMarketingCopy(form: MarketingFlyerForm): MarketingGeneratedCopy {
  const rsf = Number(String(form.rsf).replace(/,/g, ""));
  const rsfText = Number.isFinite(rsf) && rsf > 0 ? `${Math.round(rsf).toLocaleString()} RSF` : "Move-in ready";
  const headlineBase = form.lease_type === "Sublease" ? "Flexible sublease opportunity" : "Polished lease opportunity";
  const headline = `${headlineBase} at ${form.building_name || "this suite"}`.split(/\s+/).slice(0, 12).join(" ");

  return {
    headline,
    suite_bullets: cleanMarketingBullets(form.suite_features, [
      `${rsfText} available`,
      form.availability ? `Available ${form.availability}` : "Availability ready for review",
      form.floor ? `Located on floor ${form.floor}` : "Efficient suite layout",
      form.rate ? `Quoted rate ${form.rate}` : "Client-ready deal terms",
    ]),
    building_bullets: cleanMarketingBullets(form.building_features, [
      "Professional building setting",
      "Convenient tenant access",
      "Strong surrounding amenity base",
      "Brokerage team can customize final positioning",
    ]),
  };
}

export function countRequiredMarketingFields(form: MarketingFlyerForm): number {
  return ["building_name", "address", "suite_number", "rsf"].filter((key) => asText(form[key as keyof MarketingFlyerForm])).length;
}

export function canGenerateMarketingFlyer(form: MarketingFlyerForm): boolean {
  return countRequiredMarketingFields(form) === 4;
}
