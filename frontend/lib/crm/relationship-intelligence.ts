import type { PlatformModuleId } from "@/lib/platform/module-registry";
import type {
  ClientWorkspaceClient,
  ClientWorkspaceDeal,
  ClientWorkspaceDocument,
} from "@/lib/workspace/types";
import { LANDLORD_REP_MODE, type RepresentationMode } from "@/lib/workspace/representation-mode";

export type CompanyRelationshipRole =
  | "prospect"
  | "active_client"
  | "former_client"
  | "tenant"
  | "landlord"
  | "ownership_group";

export type CrmLocationHierarchy = {
  market: string;
  submarket: string;
  building: string;
  floor: string;
  suite: string;
};

export type ExpirationSignal = {
  id: string;
  label: string;
  expirationDate: string;
  monthsOut: number;
  source: "deal" | "document";
  hierarchy: CrmLocationHierarchy;
};

export type CrmRelationshipSnapshot = {
  roles: CompanyRelationshipRole[];
  connectedCounts: Record<PlatformModuleId | "documents", number>;
  hierarchy: CrmLocationHierarchy;
  hierarchyOptions: Array<{ key: keyof CrmLocationHierarchy; label: string; value: string }>;
  expirations12Months: number;
  expirations24Months: number;
  multiLocationCount: number;
  largeOccupancyCount: number;
  expirationSignals: ExpirationSignal[];
  documentUsage: Array<{ id: string; name: string; uses: PlatformModuleId[] }>;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

function parseDate(value: string): Date | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function monthDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function inferRoles(
  client: ClientWorkspaceClient | null,
  deals: ClientWorkspaceDeal[],
  documents: ClientWorkspaceDocument[],
  mode: RepresentationMode | null | undefined,
): CompanyRelationshipRole[] {
  const roles = new Set<CompanyRelationshipRole>();
  const companyType = clean(client?.companyType).toLowerCase();
  const notes = clean(client?.notes).toLowerCase();

  if (mode === LANDLORD_REP_MODE) {
    roles.add("landlord");
    roles.add("ownership_group");
  } else {
    roles.add("tenant");
  }

  if (deals.some((deal) => deal.status === "won")) {
    roles.add("active_client");
  } else if (deals.length > 0 || documents.length > 0) {
    roles.add("prospect");
  } else {
    roles.add("former_client");
  }

  if (companyType.includes("landlord") || notes.includes("landlord")) roles.add("landlord");
  if (companyType.includes("owner") || companyType.includes("ownership") || notes.includes("ownership")) roles.add("ownership_group");
  if (companyType.includes("tenant")) roles.add("tenant");
  return Array.from(roles);
}

function deriveHierarchy(
  deals: ClientWorkspaceDeal[],
  documents: ClientWorkspaceDocument[],
): CrmLocationHierarchy {
  const firstDeal = deals.find((deal) =>
    clean(deal.targetMarket) || clean(deal.submarket) || clean(deal.selectedProperty) || clean(deal.selectedSuite),
  );
  const firstDocument = documents.find((document) =>
    clean(document.building) || clean(document.address) || clean(document.suite),
  );
  return {
    market: clean(firstDeal?.targetMarket || firstDeal?.city),
    submarket: clean(firstDeal?.submarket),
    building: clean(firstDeal?.selectedProperty || firstDocument?.building || firstDocument?.address),
    floor: "",
    suite: clean(firstDeal?.selectedSuite || firstDocument?.suite),
  };
}

function inferDocumentUses(document: ClientWorkspaceDocument): PlatformModuleId[] {
  const uses = new Set<PlatformModuleId>();
  const type = clean(document.type).toLowerCase();
  const sourceModule = clean(document.sourceModule).toLowerCase() as PlatformModuleId;

  if (sourceModule === "deals" || document.dealId) uses.add("deals");
  if (sourceModule === "financial-analyses" || type === "financial analyses" || type === "proposals" || type === "lois" || type === "counters" || type === "sublease documents") {
    uses.add("financial-analyses");
  }
  if (sourceModule === "surveys" || type === "surveys" || type === "flyers" || type === "floorplans") {
    uses.add("surveys");
  }
  if (sourceModule === "completed-leases" || type === "leases" || type === "amendments" || type === "abstracts") {
    uses.add("completed-leases");
  }
  if (sourceModule === "obligations" || type === "leases" || type === "amendments" || type === "abstracts") {
    uses.add("obligations");
  }
  if (uses.size === 0) uses.add("deals");
  return Array.from(uses);
}

export function buildCrmRelationshipSnapshot(input: {
  client: ClientWorkspaceClient | null;
  deals: ClientWorkspaceDeal[];
  documents: ClientWorkspaceDocument[];
  scenariosCount: number;
  representationMode: RepresentationMode | null | undefined;
  now?: Date;
}): CrmRelationshipSnapshot {
  const now = input.now || new Date();
  const hierarchy = deriveHierarchy(input.deals, input.documents);
  const expirationSignals: ExpirationSignal[] = [];

  input.deals.forEach((deal) => {
    const expirationDate = clean(deal.expirationDate);
    const parsed = parseDate(expirationDate);
    if (!parsed) return;
    expirationSignals.push({
      id: `deal_${deal.id}`,
      label: clean(deal.dealName || deal.requirementName || deal.stage) || "Deal",
      expirationDate,
      monthsOut: monthDiff(now, parsed),
      source: "deal",
      hierarchy: {
        market: clean(deal.targetMarket || deal.city),
        submarket: clean(deal.submarket),
        building: clean(deal.selectedProperty),
        floor: "",
        suite: clean(deal.selectedSuite),
      },
    });
  });

  input.documents.forEach((document) => {
    const expirationDate = clean(document.normalizeSnapshot?.canonical_lease?.expiration_date);
    const parsed = parseDate(expirationDate);
    if (!parsed) return;
    expirationSignals.push({
      id: `document_${document.id}`,
      label: clean(document.name) || "Document",
      expirationDate,
      monthsOut: monthDiff(now, parsed),
      source: "document",
      hierarchy: {
        market: hierarchy.market,
        submarket: hierarchy.submarket,
        building: clean(document.building || document.address),
        floor: "",
        suite: clean(document.suite),
      },
    });
  });

  expirationSignals.sort((left, right) => left.monthsOut - right.monthsOut);

  const occupiedLocations = new Set(
    input.documents
      .map((document) => `${clean(document.building)}::${clean(document.address)}::${clean(document.suite)}`)
      .filter((value) => value !== "::::"),
  );

  const largeOccupancyCount = input.documents.filter((document) => {
    const rsf = Number(document.normalizeSnapshot?.canonical_lease?.rsf || 0);
    return Number.isFinite(rsf) && rsf >= 10000;
  }).length;

  const documentUsage = input.documents.slice(0, 8).map((document) => ({
    id: document.id,
    name: document.name,
    uses: inferDocumentUses(document),
  }));

  return {
    roles: inferRoles(input.client, input.deals, input.documents, input.representationMode),
    connectedCounts: {
      deals: input.deals.length,
      "financial-analyses": input.scenariosCount,
      surveys: input.documents.filter((document) => {
        const type = clean(document.type).toLowerCase();
        return type === "surveys" || type === "flyers" || type === "floorplans";
      }).length,
      "completed-leases": input.documents.filter((document) => {
        const type = clean(document.type).toLowerCase();
        return type === "leases" || type === "amendments" || type === "abstracts";
      }).length,
      obligations: expirationSignals.length,
      documents: input.documents.length,
    },
    hierarchy,
    hierarchyOptions: ([
      { key: "market", label: "Market", value: hierarchy.market },
      { key: "submarket", label: "Submarket", value: hierarchy.submarket },
      { key: "building", label: "Building", value: hierarchy.building },
      { key: "floor", label: "Floor", value: hierarchy.floor },
      { key: "suite", label: "Suite", value: hierarchy.suite },
    ] satisfies Array<{ key: keyof CrmLocationHierarchy; label: string; value: string }>).filter((item) => clean(item.value).length > 0),
    expirations12Months: expirationSignals.filter((signal) => signal.monthsOut >= 0 && signal.monthsOut <= 12).length,
    expirations24Months: expirationSignals.filter((signal) => signal.monthsOut >= 0 && signal.monthsOut <= 24).length,
    multiLocationCount: occupiedLocations.size > 1 ? occupiedLocations.size : 0,
    largeOccupancyCount,
    expirationSignals: expirationSignals.slice(0, 24),
    documentUsage,
  };
}
