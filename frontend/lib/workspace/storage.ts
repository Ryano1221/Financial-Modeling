export const CLIENTS_STORAGE_KEY = "lease_deck_clients_v1";
export const ACTIVE_CLIENT_STORAGE_KEY = "lease_deck_active_client_id_v1";
export const DOCUMENT_LIBRARY_STORAGE_KEY = "lease_deck_documents_v1";
export const DELETED_DOCUMENT_LIBRARY_STORAGE_KEY = "lease_deck_deleted_documents_v1";
export const DEAL_LIBRARY_STORAGE_KEY = "lease_deck_deals_v1";
export const DEAL_STAGE_CONFIG_STORAGE_KEY = "lease_deck_deal_stages_v1";
export const CRM_SETTINGS_STORAGE_KEY = "lease_deck_crm_settings_v1";
export const REPRESENTATION_MODE_STORAGE_KEY = "lease_deck_representation_mode_v1";

export function normalizeWorkspaceScope(clientId: string | null | undefined): string {
  const raw = String(clientId || "").trim();
  if (!raw) return "guest";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function makeClientScopedStorageKey(base: string, clientId: string | null | undefined): string {
  return `${base}::${normalizeWorkspaceScope(clientId)}`;
}
