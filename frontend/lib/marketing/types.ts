export type MarketingLeaseType = "Direct Lease" | "Sublease";
export type MarketingLayoutStyle = "Classic" | "Modern" | "Minimal";

export interface MarketingBroker {
  name: string;
  email: string;
  phone: string;
}

export interface MarketingFlyerForm {
  building_name: string;
  address: string;
  suite_number: string;
  rsf: string;
  floor: string;
  availability: string;
  lease_type: MarketingLeaseType;
  rate: string;
  opex: string;
  term_expiration: string;
  suite_features: string;
  building_features: string;
  broker: MarketingBroker;
  co_brokers: MarketingBroker[];
  layout_style: MarketingLayoutStyle;
  primary_color: string;
  secondary_color: string;
  include_floorplan: boolean;
}

export interface MarketingGeneratedCopy {
  headline: string;
  suite_bullets: string[];
  building_bullets: string[];
}

export interface MarketingMediaAsset {
  id: string;
  name: string;
  dataUrl: string;
}

export interface MarketingFlyerSnapshot {
  form: MarketingFlyerForm;
  copy: MarketingGeneratedCopy;
  photos: MarketingMediaAsset[];
  floorplan: MarketingMediaAsset | null;
  logoDataUrl?: string | null;
  generatedAtIso: string;
  disclaimer?: string;
}

export type MarketingAutoFilledFields = Partial<Record<keyof MarketingFlyerForm, true>>;
