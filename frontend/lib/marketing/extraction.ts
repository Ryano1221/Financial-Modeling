import { fetchApi } from "@/lib/api";

export interface MarketingExtractedFields {
  building_name: string | null;
  address: string | null;
  suite_number: string | null;
  rsf: number | string | null;
  floor: string | null;
  availability: string | null;
  lease_type: "Direct Lease" | "Sublease" | null;
  rate: string | null;
  opex: string | null;
  term_expiration: string | null;
  suite_features: string | string[] | null;
  building_features: string | string[] | null;
  broker_names: string[] | null;
  broker_emails: string[] | null;
  broker_phones: string[] | null;
  extracted_photos?: Array<{ name: string; data_url: string }> | null;
  floorplan_image?: { name: string; data_url: string } | null;
}

export async function extractMarketingDocument(file: File): Promise<MarketingExtractedFields | null> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchApi("/marketing/extract", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as MarketingExtractedFields;
}
