export const CLIENTS_STORAGE_KEY = "lease_deck_clients_v1";
export const ACTIVE_CLIENT_STORAGE_KEY = "lease_deck_active_client_id_v1";
export const DOCUMENT_LIBRARY_STORAGE_KEY = "lease_deck_documents_v1";

export function normalizeWorkspaceScope(clientId: string | null | undefined): string {
  const raw = String(clientId || "").trim();
  if (!raw) return "guest";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function makeClientScopedStorageKey(base: string, clientId: string | null | undefined): string {
  return `${base}::${normalizeWorkspaceScope(clientId)}`;
}
