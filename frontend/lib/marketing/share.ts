import { fetchApi } from "@/lib/api";
import type { MarketingFlyerSnapshot } from "@/lib/marketing/types";

export async function createMarketingShareLink(snapshot: MarketingFlyerSnapshot): Promise<string> {
  const res = await fetchApi("/marketing/flyer/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot }),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `Share request failed (${res.status}).`);
  }
  const payload = (await res.json()) as { id?: string; url?: string };
  const path = payload.url || (payload.id ? `/marketing/share?id=${encodeURIComponent(payload.id)}` : "");
  if (!path) throw new Error("Share link was not returned.");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return path.startsWith("http") ? path : `${origin}${path}`;
}

export async function fetchMarketingShareSnapshot(id: string): Promise<MarketingFlyerSnapshot> {
  const res = await fetchApi(`/marketing/flyer/share/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `Flyer link failed (${res.status}).`);
  }
  return (await res.json()) as MarketingFlyerSnapshot;
}
