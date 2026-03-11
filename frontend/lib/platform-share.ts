import {
  resolveExportBranding,
  type ResolvedExportBranding,
  type SharedExportBranding,
} from "@/lib/export-design";
import { buildShareUrl, decodeSharePayload, encodeSharePayload } from "@/lib/share-link";

export type PlatformShareModule =
  | "financial-analyses"
  | "sublease-recovery"
  | "completed-leases"
  | "surveys";

export interface PlatformShareEnvelope<Payload> {
  version: 1;
  module: PlatformShareModule;
  generatedAtIso: string;
  branding: ResolvedExportBranding;
  payload: Payload;
}

const MAX_ENCODED_SHARE_LENGTH = 16000;

export function buildPlatformShareLink<Payload>(
  pathname: string,
  module: PlatformShareModule,
  payload: Payload,
  branding?: SharedExportBranding | null,
): string {
  const envelope: PlatformShareEnvelope<Payload> = {
    version: 1,
    module,
    generatedAtIso: new Date().toISOString(),
    branding: resolveExportBranding(branding),
    payload,
  };
  const encoded = encodeSharePayload(envelope);
  if (!encoded) throw new Error("Unable to encode share payload.");
  if (encoded.length > MAX_ENCODED_SHARE_LENGTH) {
    throw new Error("Share payload is too large to encode in a URL. Reduce included records and try again.");
  }
  return buildShareUrl(pathname, encoded);
}

export function parsePlatformShareData<Payload>(
  encoded: string | null | undefined,
  expectedModule: PlatformShareModule,
): PlatformShareEnvelope<Payload> | null {
  const value = String(encoded || "").trim();
  if (!value) return null;
  const parsed = decodeSharePayload<PlatformShareEnvelope<Payload>>(value);
  if (!parsed || parsed.version !== 1 || parsed.module !== expectedModule) return null;
  if (!parsed.payload || !parsed.branding || !parsed.generatedAtIso) return null;
  return parsed;
}
