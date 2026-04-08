import { filterDocumentsByDeletedIds, normalizeDeletionIds } from "@/lib/workspace/deletions";
import { normalizeRepresentationMode, type RepresentationMode } from "@/lib/workspace/representation-mode";
import {
  getDefaultDealStagesForMode,
  normalizeCrmSettings,
  type ClientCrmSettings,
  type ClientWorkspaceClient,
  type ClientWorkspaceDeal,
  type ClientWorkspaceDocument,
} from "@/lib/workspace/types";

export interface HydratedWorkspaceState {
  representationMode: RepresentationMode | null;
  clients: ClientWorkspaceClient[];
  deals: ClientWorkspaceDeal[];
  dealStageMap: Record<string, string[]>;
  crmSettingsMap: Record<string, ClientCrmSettings>;
  documents: ClientWorkspaceDocument[];
  deletedDocumentIds: string[];
  activeClientId: string | null;
}

function normalizeId(value: unknown): string {
  return String(value || "").trim();
}

function mergeById<T extends { id: string }>(preferred: T[], fallback: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of preferred) {
    const id = normalizeId(item.id);
    if (!id || merged.has(id)) continue;
    merged.set(id, item);
  }
  for (const item of fallback) {
    const id = normalizeId(item.id);
    if (!id || merged.has(id)) continue;
    merged.set(id, item);
  }
  return Array.from(merged.values());
}

function mergeDocuments(
  preferred: ClientWorkspaceDocument[],
  fallback: ClientWorkspaceDocument[],
): ClientWorkspaceDocument[] {
  const merged = new Map<string, ClientWorkspaceDocument>();
  for (const document of preferred) {
    const id = normalizeId(document.id);
    if (!id || merged.has(id)) continue;
    merged.set(id, document);
  }
  for (const document of fallback) {
    const id = normalizeId(document.id);
    if (!id) continue;
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, document);
      continue;
    }
    merged.set(id, {
      ...existing,
      fileMimeType: existing.fileMimeType || document.fileMimeType,
      previewDataUrl: existing.previewDataUrl || document.previewDataUrl,
      normalizeSnapshot: existing.normalizeSnapshot || document.normalizeSnapshot,
    });
  }
  return Array.from(merged.values());
}

function mergeDealStageMap(
  preferred: Record<string, string[]>,
  fallback: Record<string, string[]>,
  mode: RepresentationMode | null,
  clientIds: Set<string>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const clientId of Array.from(clientIds)) {
    const preferredStages = Array.isArray(preferred[clientId]) ? preferred[clientId] : [];
    const fallbackStages = Array.isArray(fallback[clientId]) ? fallback[clientId] : [];
    const nextStages = preferredStages.length > 0
      ? preferredStages
      : (fallbackStages.length > 0 ? fallbackStages : [...getDefaultDealStagesForMode(mode)]);
    merged[clientId] = Array.from(
      new Set(nextStages.map((stage) => String(stage || "").trim()).filter(Boolean)),
    );
  }
  return merged;
}

function mergeCrmSettingsMap(
  preferred: Record<string, ClientCrmSettings>,
  fallback: Record<string, ClientCrmSettings>,
  mode: RepresentationMode | null,
  clientIds: Set<string>,
): Record<string, ClientCrmSettings> {
  const merged: Record<string, ClientCrmSettings> = {};
  for (const clientId of Array.from(clientIds)) {
    merged[clientId] = normalizeCrmSettings(
      {
        ...(fallback[clientId] || {}),
        ...(preferred[clientId] || {}),
      },
      mode,
    );
  }
  return merged;
}

export function mergeHydratedWorkspaceState(
  preferred: HydratedWorkspaceState,
  fallback: HydratedWorkspaceState,
): HydratedWorkspaceState {
  const representationMode = normalizeRepresentationMode(preferred.representationMode)
    || normalizeRepresentationMode(fallback.representationMode);
  const clients = mergeById(preferred.clients, fallback.clients);
  const clientIds = new Set(clients.map((client) => normalizeId(client.id)).filter(Boolean));
  const deals = mergeById(preferred.deals, fallback.deals);
  const deletedDocumentIds = normalizeDeletionIds([
    ...preferred.deletedDocumentIds,
    ...fallback.deletedDocumentIds,
  ]);
  const documents = filterDocumentsByDeletedIds(
    mergeDocuments(preferred.documents, fallback.documents),
    deletedDocumentIds,
  );
  const activeClientId = (() => {
    const preferredId = normalizeId(preferred.activeClientId);
    if (preferredId && clientIds.has(preferredId)) return preferredId;
    const fallbackId = normalizeId(fallback.activeClientId);
    if (fallbackId && clientIds.has(fallbackId)) return fallbackId;
    return clients[0]?.id || null;
  })();

  return {
    representationMode,
    clients,
    deals,
    dealStageMap: mergeDealStageMap(preferred.dealStageMap, fallback.dealStageMap, representationMode, clientIds),
    crmSettingsMap: mergeCrmSettingsMap(preferred.crmSettingsMap, fallback.crmSettingsMap, representationMode, clientIds),
    documents,
    deletedDocumentIds,
    activeClientId,
  };
}

export function preferLocalWhenRemoteEmpty<T>(
  remoteValue: T | null | undefined,
  localValue: T | null | undefined,
  hasRemoteContent: (value: T) => boolean,
): T | null {
  if (remoteValue && hasRemoteContent(remoteValue)) return remoteValue;
  if (localValue) return localValue;
  return remoteValue ?? null;
}
