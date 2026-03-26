function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeText(value: unknown): string {
  return asText(value).toLowerCase();
}

export function normalizeDeletionIds(value: unknown): string[] {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    try {
      return normalizeDeletionIds(JSON.parse(raw));
    } catch {
      return [raw];
    }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const normalized = asText(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function filterDocumentsByDeletedIds<T extends { id: string }>(
  documents: readonly T[],
  deletedIds: readonly string[],
): T[] {
  const normalizedIds = normalizeDeletionIds(deletedIds);
  if (normalizedIds.length === 0) return [...documents];
  const deletedSet = new Set(normalizedIds);
  return documents.filter((document) => !deletedSet.has(asText(document.id)));
}

export function getWorkspaceBuildingDeletionKey(input: {
  id?: unknown;
  name?: unknown;
  address?: unknown;
}): string {
  const normalizedName = normalizeText(input.name);
  const normalizedAddress = normalizeText(input.address);
  if (normalizedName || normalizedAddress) {
    return `${normalizedName}::${normalizedAddress}`;
  }
  return asText(input.id);
}
