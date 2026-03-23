"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { getBuildingRegistryEntry, getDesignatedBuildingImage } from "@/lib/building-photos";
import type { CrmBuilding } from "@/lib/workspace/crm";

type CrmBuildingInsightCardProps = {
  building: CrmBuilding | null;
  onSavePhotoOverride?: (payload: { imageUrl: string; sourceLabel: string; sourceUrl?: string }) => void;
  onClearPhotoOverride?: () => void;
  statusMessage?: string;
};

type ExternalInsight = {
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  sourceLabel: string;
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeText(value: unknown): string {
  return asText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeBuildingName(value: unknown): string {
  return normalizeText(value)
    .replace(/\b(the|building|office|tower|plaza|center|centre|campus)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(left: string, right: string): number {
  const leftTokens = new Set(normalizeText(left).split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(normalizeText(right).split(" ").filter((token) => token.length > 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of Array.from(leftTokens)) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function isTrustedTitleMatch(buildingName: string, candidateTitle: string): boolean {
  const normalizedBuilding = normalizeBuildingName(buildingName);
  const normalizedTitle = normalizeBuildingName(candidateTitle);
  if (!normalizedBuilding || !normalizedTitle) return false;
  if (normalizedTitle === normalizedBuilding) return true;
  if (normalizedTitle.includes(normalizedBuilding) || normalizedBuilding.includes(normalizedTitle)) return true;
  return tokenScore(normalizedBuilding, normalizedTitle) >= 0.72;
}

function getRegistryEntry(building: CrmBuilding | null) {
  return getBuildingRegistryEntry(building);
}

function formatInt(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

function formatDecimal(value: number | null | undefined, digits = 2): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function fallbackDescription(building: CrmBuilding): string {
  const clauses = [
    `${building.buildingClass || "Office"} office building in ${building.submarket || building.market || "Austin"}`,
    building.totalRSF ? `${formatInt(building.totalRSF)} RSF` : "",
    building.numberOfStories ? `${formatInt(building.numberOfStories)} stories` : "",
    building.yearBuilt ? `built ${building.yearBuilt}` : "",
    building.yearRenovated ? `renovated ${building.yearRenovated}` : "",
    building.ownerName ? `owned by ${building.ownerName}` : "",
    building.leasingCompanyName ? `leasing by ${building.leasingCompanyName}` : "",
  ].filter(Boolean);
  return clauses.join(". ") + ".";
}

function toDisplayImageUrl(imageUrl: string, sourceUrl = ""): string {
  const cleanedImageUrl = asText(imageUrl);
  if (!cleanedImageUrl) return "";
  if (cleanedImageUrl.startsWith("data:image/") || cleanedImageUrl.startsWith("/")) return cleanedImageUrl;
  if (!/^https?:\/\//i.test(cleanedImageUrl)) return cleanedImageUrl;
  const params = new URLSearchParams({ target: cleanedImageUrl });
  const cleanedSourceUrl = asText(sourceUrl);
  if (/^https?:\/\//i.test(cleanedSourceUrl)) {
    params.set("source", cleanedSourceUrl);
  }
  return `/api/building-photo?${params.toString()}`;
}

async function fetchWikipediaInsight(building: CrmBuilding): Promise<ExternalInsight | null> {
  const registryEntry = getRegistryEntry(building);
  if (registryEntry?.imagePath) {
    return {
      title: registryEntry.preferredName || building.name,
      description: registryEntry.description,
      imageUrl: registryEntry.imagePath,
      sourceUrl: registryEntry.sourceUrl,
      sourceLabel: registryEntry.sourceLabel,
    };
  }

  const query = [`"${building.name}"`, building.address, "Austin Texas office building"].filter(Boolean).join(" ");
  const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", query);
  searchUrl.searchParams.set("utf8", "1");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("origin", "*");

  const searchRes = await fetch(searchUrl.toString(), { headers: { Accept: "application/json" } });
  if (!searchRes.ok) return null;
  const searchPayload = await searchRes.json() as { query?: { search?: Array<{ title?: string }> } };
  const candidates = (searchPayload.query?.search || []).slice(0, 5);
  const best = candidates
    .map((candidate) => ({
      title: asText(candidate.title),
      score: Math.max(
        tokenScore(normalizeBuildingName(building.name), normalizeBuildingName(asText(candidate.title))),
        tokenScore(`${normalizeBuildingName(building.name)} ${normalizeText(building.address)}`, normalizeBuildingName(asText(candidate.title))),
      ),
    }))
    .sort((left, right) => right.score - left.score)[0];

  if (!best?.title || !isTrustedTitleMatch(building.name, best.title)) return null;

  const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.title.replace(/\s+/g, "_"))}`, {
    headers: { Accept: "application/json" },
  });
  if (!summaryRes.ok) return null;
  const summary = await summaryRes.json() as {
    title?: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
  };
  const imageUrl = asText(summary.originalimage?.source) || asText(summary.thumbnail?.source);
  const description = asText(summary.extract);
  if (!imageUrl && !description) return null;
  return {
    title: asText(summary.title) || building.name,
    description,
    imageUrl,
    sourceUrl: asText(summary.content_urls?.desktop?.page),
    sourceLabel: "Wikipedia",
  };
}

export function CrmBuildingInsightCard({
  building,
  onSavePhotoOverride,
  onClearPhotoOverride,
  statusMessage,
}: CrmBuildingInsightCardProps) {
  const [externalInsight, setExternalInsight] = useState<ExternalInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualError, setManualError] = useState("");
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const registryEntry = getRegistryEntry(building);
  const designatedImage = getDesignatedBuildingImage(building);

  useEffect(() => {
    let cancelled = false;
    setExternalInsight(null);

    async function loadInsight() {
      if (!building) return;
      if (registryEntry?.imagePath) {
        setExternalInsight({
          title: registryEntry.preferredName || building.name,
          description: registryEntry.description,
          imageUrl: registryEntry.imagePath,
          sourceUrl: registryEntry.sourceUrl,
          sourceLabel: registryEntry.sourceLabel,
        });
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const insight = await fetchWikipediaInsight(building);
        if (!cancelled) setExternalInsight(insight);
      } catch {
        if (!cancelled) setExternalInsight(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInsight();
    return () => {
      cancelled = true;
    };
  }, [building, registryEntry]);

  useEffect(() => {
    setManualUrl("");
    setManualError("");
    setImageLoadFailed(false);
  }, [building?.id]);

  const headline = externalInsight?.title || registryEntry?.preferredName || building?.name || "Select a building";
  const description = externalInsight?.description || designatedImage?.description || (building ? fallbackDescription(building) : "");
  const rawHeroImage = asText(building?.photoOverrideUrl) || externalInsight?.imageUrl || designatedImage?.imageUrl || "";
  const heroSourceUrl = asText(building?.photoOverrideSourceUrl) || externalInsight?.sourceUrl || designatedImage?.sourceUrl || registryEntry?.sourceUrl || "";
  const heroImage = imageLoadFailed ? "" : toDisplayImageUrl(rawHeroImage, heroSourceUrl);
  const heroLabel = asText(building?.photoOverrideUrl)
    ? "Workspace default building photo"
    : externalInsight?.imageUrl
      ? "Verified public building photo"
      : designatedImage?.kind === "curated"
        ? "Curated building photo"
        : "Verified photo unavailable";
  const googleMapsUrl = building ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([building.name, building.address].filter(Boolean).join(", "))}` : "";
  const osmUrl = building && Number.isFinite(building.latitude) && Number.isFinite(building.longitude)
    ? `https://www.openstreetmap.org/?mlat=${building.latitude}&mlon=${building.longitude}#map=17/${building.latitude}/${building.longitude}`
    : "";

  async function fileToDataUrl(file: File): Promise<string> {
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read the selected image."));
      reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not process the selected image."));
      image.src = raw;
    });
    const maxWidth = 1200;
    const scale = img.width > maxWidth ? maxWidth / img.width : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the image canvas.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.84);
  }

  async function onUploadOverride(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !building) return;
    try {
      setManualError("");
      const imageUrl = await fileToDataUrl(file);
      onSavePhotoOverride?.({
        imageUrl,
        sourceLabel: "Manual building photo override",
        sourceUrl: "",
      });
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Could not save that image.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onSaveUrlOverride() {
    if (!building) return;
    const value = asText(manualUrl);
    if (!/^https?:\/\/.+/i.test(value) && !/^data:image\//i.test(value)) {
      setManualError("Enter a valid image URL that starts with http(s).");
      return;
    }
    setManualError("");
    onSavePhotoOverride?.({
      imageUrl: value,
      sourceLabel: "Manual building photo override",
      sourceUrl: value.startsWith("http") ? value : "",
    });
    setManualUrl("");
  }

  if (!building) {
    return (
      <div className="border border-white/15 bg-black/20 p-4">
        <p className="heading-kicker">Building Detail</p>
        <p className="mt-3 text-sm text-slate-400">Select a map pin or building row to load a property detail card.</p>
      </div>
    );
  }

  return (
    <div className="border border-white/15 bg-black/20 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="heading-kicker">Building Detail</p>
          <h3 className="mt-2 text-xl text-white">{headline}</h3>
          <p className="mt-1 text-sm text-slate-300">{[building.address, building.submarket, building.market].filter(Boolean).join(" / ")}</p>
        </div>
        <span className="border border-white/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">{building.buildingClass || "Office"}</span>
      </div>

      <div className="overflow-hidden border border-white/15 bg-black/30">
        {heroImage ? (
          <img
            src={heroImage}
            alt={`${building.name} preview`}
            className="h-[240px] w-full object-cover"
            onError={() => setImageLoadFailed(true)}
          />
        ) : (
          <div className="flex h-[240px] flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.22),transparent_60%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01))] px-6 text-center text-sm text-slate-300">
            <div className="relative h-20 w-16 rounded-t-md border border-cyan-200/40 bg-cyan-200/10">
              <div className="absolute inset-2 grid grid-cols-3 gap-1">
                {Array.from({ length: 15 }).map((_, index) => <span key={index} className="rounded-[2px] bg-cyan-100/40" />)}
              </div>
            </div>
            <p>We only show a photo when the building has a verified public match or an uploaded workspace override.</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-slate-300">
          <span>{heroLabel}</span>
          <span>{loading ? "Looking for public imagery" : building.photoOverrideSourceLabel || externalInsight?.sourceLabel || designatedImage?.sourceLabel || "CRM building data"}</span>
        </div>
      </div>

      <p className="text-sm leading-6 text-slate-200">{description}</p>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="border border-white/10 bg-black/25 p-2"><p className="text-slate-400">RSF</p><p className="mt-1 text-white">{formatInt(building.totalRSF)}</p></div>
        <div className="border border-white/10 bg-black/25 p-2"><p className="text-slate-400">Stories</p><p className="mt-1 text-white">{formatInt(building.numberOfStories)}</p></div>
        <div className="border border-white/10 bg-black/25 p-2"><p className="text-slate-400">Parking</p><p className="mt-1 text-white">{Number.isFinite(building.parkingRatio) ? `${formatDecimal(building.parkingRatio, 2)} / 1,000` : "-"}</p></div>
        <div className="border border-white/10 bg-black/25 p-2"><p className="text-slate-400">Built</p><p className="mt-1 text-white">{building.yearBuilt || "-"}</p></div>
      </div>

      <div className="space-y-1 text-xs text-slate-300">
        <p><span className="text-slate-400">Owner:</span> {building.ownerName || "-"}</p>
        <p><span className="text-slate-400">Leasing:</span> {building.leasingCompanyName || "-"}{building.leasingCompanyContact ? ` / ${building.leasingCompanyContact}` : ""}</p>
        <p><span className="text-slate-400">Operating Notes:</span> {building.operatingExpenses || building.notes || "-"}</p>
      </div>

      <div className="border border-white/10 bg-black/25 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="heading-kicker">Photo Override</p>
            <p className="mt-1 text-xs text-slate-400">Use this when a building is missing a photo or the photo needs to be corrected. Saved overrides become the workspace default for this building.</p>
          </div>
          {asText(building.photoOverrideUrl) ? (
            <button type="button" className="text-[11px] uppercase tracking-[0.12em] text-amber-200 hover:text-white" onClick={() => onClearPhotoOverride?.()}>
              Clear workspace default
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="input-premium flex-1 min-w-[240px]"
            placeholder="Paste direct image URL"
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
          />
          <button type="button" className="btn-premium btn-premium-secondary !px-3 !py-2" onClick={onSaveUrlOverride}>
            Save Workspace Default
          </button>
          <button type="button" className="btn-premium btn-premium-secondary !px-3 !py-2" onClick={() => fileInputRef.current?.click()}>
            Upload Workspace Default
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onUploadOverride} />
        </div>
        {statusMessage ? <p className="text-xs text-cyan-200">{statusMessage}</p> : null}
        {manualError ? <p className="text-xs text-amber-300">{manualError}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {googleMapsUrl ? <a className="btn-premium btn-premium-primary !px-3 !py-2" href={googleMapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a> : null}
        {osmUrl ? <a className="btn-premium btn-premium-secondary !px-3 !py-2" href={osmUrl} target="_blank" rel="noreferrer">Open in OpenStreetMap</a> : null}
        {building.photoOverrideSourceUrl ? <a className="btn-premium btn-premium-secondary !px-3 !py-2" href={building.photoOverrideSourceUrl} target="_blank" rel="noreferrer">Open override source</a> : null}
        {externalInsight?.sourceUrl ? <a className="btn-premium btn-premium-secondary !px-3 !py-2" href={externalInsight.sourceUrl} target="_blank" rel="noreferrer">Open source page</a> : null}
      </div>
    </div>
  );
}
