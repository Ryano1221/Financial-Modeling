export type RepresentationMode = "tenant_rep" | "landlord_rep";

export const TENANT_REP_MODE: RepresentationMode = "tenant_rep";
export const LANDLORD_REP_MODE: RepresentationMode = "landlord_rep";
export const DEFAULT_REPRESENTATION_MODE: RepresentationMode = TENANT_REP_MODE;

export function normalizeRepresentationMode(value: unknown): RepresentationMode | null {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === TENANT_REP_MODE) return TENANT_REP_MODE;
  if (raw === LANDLORD_REP_MODE) return LANDLORD_REP_MODE;
  return null;
}

export function isRepresentationMode(value: unknown): value is RepresentationMode {
  return normalizeRepresentationMode(value) !== null;
}

export function representationModeLabel(mode: RepresentationMode | null | undefined): string {
  if (!mode) return "Not selected";
  if (mode === LANDLORD_REP_MODE) return "Landlord Rep";
  return "Tenant Rep";
}
