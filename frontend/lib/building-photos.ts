import { austinBuildingPhotoRegistry, type AustinBuildingPhotoRegistryEntry } from "@/lib/data/austinBuildingPhotoRegistry";
import type { CrmBuilding } from "@/lib/workspace/crm";

export type DesignatedBuildingImageKind = "override" | "curated";

export type DesignatedBuildingImage = {
  kind: DesignatedBuildingImageKind;
  imageUrl: string;
  sourceLabel: string;
  sourceUrl?: string;
  description: string;
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

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapLabel(value: string, maxLength = 24): string[] {
  const words = asText(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["Austin Office"];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function formatInt(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

export function resolveBuildingImageUrl(imageUrl: string, sourceUrl = ""): string {
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

export function getBuildingRegistryEntry(building: CrmBuilding | null): AustinBuildingPhotoRegistryEntry | null {
  if (!building) return null;
  const normalizedName = normalizeBuildingName(building.name);
  const normalizedAddress = normalizeText(building.address);
  return austinBuildingPhotoRegistry.find((entry) => {
    if (entry.buildingId === building.id) return true;
    if (entry.propertyId && entry.propertyId === building.propertyId) return true;
    if (entry.aliases?.some((alias) => normalizeBuildingName(alias) === normalizedName || normalizeText(alias) === normalizedAddress)) return true;
    return false;
  }) || null;
}

export function getDesignatedBuildingImage(building: CrmBuilding | null): DesignatedBuildingImage | null {
  if (!building) return null;
  const overrideUrl = asText(building.photoOverrideUrl);
  if (overrideUrl) {
    return {
      kind: "override",
      imageUrl: overrideUrl,
      sourceLabel: asText(building.photoOverrideSourceLabel) || "Workspace default building photo",
      sourceUrl: asText(building.photoOverrideSourceUrl),
      description: "Workspace-designated building image.",
    };
  }

  const registryEntry = getBuildingRegistryEntry(building);
  if (registryEntry?.imagePath) {
    return {
      kind: "curated",
      imageUrl: registryEntry.imagePath,
      sourceLabel: registryEntry.sourceLabel || "Curated building photo",
      sourceUrl: registryEntry.sourceUrl,
      description: registryEntry.description || "",
    };
  }
  return null;
}

export function hasDesignatedBuildingImage(building: CrmBuilding | null): boolean {
  return Boolean(getDesignatedBuildingImage(building)?.imageUrl);
}

export function hasCuratedBuildingPhoto(building: CrmBuilding | null): boolean {
  if (!building) return false;
  return Boolean(asText(building.photoOverrideUrl) || getBuildingRegistryEntry(building)?.imagePath);
}
