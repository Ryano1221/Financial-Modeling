import type { MarketingFlyerSnapshot } from "@/lib/marketing/types";

function encodeBase64Url(input: string): string {
  if (typeof window === "undefined") return "";
  return window
    .btoa(unescape(encodeURIComponent(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(input: string): string {
  if (typeof window === "undefined") return "";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeURIComponent(escape(window.atob(padded)));
}

export function buildMarketingShareLink(snapshot: MarketingFlyerSnapshot): string {
  if (typeof window === "undefined") return "";
  const encoded = encodeBase64Url(JSON.stringify(snapshot));
  return `${window.location.origin}/marketing/share?data=${encoded}`;
}

export function parseMarketingShareData(raw: string | null | undefined): MarketingFlyerSnapshot | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(decodeBase64Url(value)) as MarketingFlyerSnapshot;
  } catch {
    return null;
  }
}
