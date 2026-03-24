import type { ClientWorkspaceDeal } from "@/lib/workspace/types";
import type {
  BrokerageOsObligation,
  BrokerageOsProposal,
  BrokerageOsProperty,
  BrokerageOsSpace,
} from "@/lib/workspace/os-types";
import type {
  CrmBuilding,
  CrmCompany,
  CrmOccupancyRecord,
  CrmReminder,
  CrmShortlistEntry,
  CrmStackingPlanEntry,
  CrmStackingPlanSource,
  CrmTouchpoint,
  CrmTour,
  CrmWorkspaceState,
} from "@/lib/workspace/crm";
import type { RepresentationMode } from "@/lib/workspace/representation-mode";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";
import { getRepresentationModeProfile } from "@/lib/workspace/representation-profile";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalize(value: unknown): string {
  return asText(value).toLowerCase();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthsUntil(value: string, now = new Date()): number {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return Number.POSITIVE_INFINITY;
  return (date.getUTCFullYear() - now.getUTCFullYear()) * 12 + (date.getUTCMonth() - now.getUTCMonth());
}

export function buildModeAwareHeroMetricCards(
  mode: RepresentationMode | null | undefined,
  input: {
    activeDealsCount: number;
    scenariosCount: number;
    documentsCount: number;
    propertyCount: number;
    availableSpacesCount: number;
    activeProposalsCount: number;
  },
): Array<{ label: string; value: number }> {
  if (mode === LANDLORD_REP_MODE) {
    return [
      { label: "Buildings", value: input.propertyCount },
      { label: "Available Suites", value: input.availableSpacesCount },
      { label: "Active Proposals", value: input.activeProposalsCount },
    ];
  }
  return [
    { label: "Active Deals", value: input.activeDealsCount },
    { label: "Analyses", value: input.scenariosCount },
    { label: "Documents", value: input.documentsCount },
  ];
}

export function buildModeAwareHeroPipelineActions(
  mode: RepresentationMode | null | undefined,
  input: {
    documentsCount: number;
    parsedDocumentsCount: number;
    scenariosCount: number;
    activeDealsCount: number;
    availableSpacesCount: number;
    activeToursCount: number;
    activeProposalsCount: number;
  },
): Array<{ label: string; value: string; active: boolean }> {
  if (mode === LANDLORD_REP_MODE) {
    return [
      { label: "LISTINGS", value: `${input.availableSpacesCount}`, active: input.availableSpacesCount > 0 },
      { label: "INQUIRIES", value: `${input.activeDealsCount}`, active: input.activeDealsCount > 0 },
      { label: "TOURS", value: `${input.activeToursCount}`, active: input.activeToursCount > 0 },
      { label: "PROPOSALS", value: `${input.activeProposalsCount}`, active: input.activeProposalsCount > 0 },
    ];
  }
  return [
    { label: "UPLOAD", value: `${input.documentsCount}`, active: input.documentsCount > 0 },
    { label: "EXTRACT", value: `${input.parsedDocumentsCount}`, active: input.parsedDocumentsCount > 0 },
    { label: "ANALYZE", value: `${input.scenariosCount}`, active: input.scenariosCount > 0 },
    { label: "TRACK", value: `${input.activeDealsCount}`, active: input.activeDealsCount > 0 },
  ];
}

export function buildModeAwareDashboardCards(
  mode: RepresentationMode | null | undefined,
  dashboard: {
    totalProspects: number;
    totalActiveClients: number;
    totalLandlordTenants: number;
    upcomingExpirations: number;
    upcomingNoticeDates: number;
    activeDeals: number;
    highPriorityTasks: number;
    dueReminders: number;
    overdueFollowUps: number;
    noTouchCompanies: number;
  },
): Array<{ label: string; value: number }> {
  if (mode === LANDLORD_REP_MODE) {
    return [
      { label: "Portfolio Vacancies", value: Math.max(0, dashboard.totalLandlordTenants - dashboard.totalActiveClients) },
      { label: "Expiring Tenants", value: dashboard.upcomingExpirations },
      { label: "Active Deals", value: dashboard.activeDeals },
      { label: "Negotiation Risk", value: dashboard.highPriorityTasks },
      { label: "Reminders Due", value: dashboard.dueReminders },
      { label: "Downtime Risk", value: dashboard.overdueFollowUps },
    ];
  }
  return [
    { label: "Expiring Clients", value: dashboard.upcomingExpirations },
    { label: "Expiring Prospects", value: dashboard.totalProspects },
    { label: "Stale Relationships", value: dashboard.noTouchCompanies },
    { label: "Active Deals", value: dashboard.activeDeals },
    { label: "Touchpoints Due", value: dashboard.dueReminders },
    { label: "Follow Ups Overdue", value: dashboard.overdueFollowUps },
  ];
}

export function buildModeAwareAiRecommendations(input: {
  mode: RepresentationMode | null | undefined;
  selectedCompany?: CrmCompany | null;
  selectedCompanyDealsCount?: number;
  selectedCompanyDocumentsCount?: number;
  selectedBuilding?: CrmBuilding | null;
  buildingSummary?: LandlordBuildingHubSummary | null;
}): string[] {
  const profile = getRepresentationModeProfile(input.mode);
  const queue: string[] = [];
  if (input.mode === LANDLORD_REP_MODE) {
    if (input.selectedBuilding && input.buildingSummary) {
      if (input.buildingSummary.expiringSuites > 0) {
        queue.push(`${input.buildingSummary.expiringSuites} suite${input.buildingSummary.expiringSuites === 1 ? "" : "s"} need expiration review in ${input.selectedBuilding.name}.`);
      }
      if (input.buildingSummary.touredSuites > 0) {
        queue.push(`${input.buildingSummary.touredSuites} toured suite${input.buildingSummary.touredSuites === 1 ? "" : "s"} should get a follow-up update.`);
      }
      if (input.buildingSummary.proposalSuites > 0) {
        queue.push(`${input.buildingSummary.proposalSuites} suite${input.buildingSummary.proposalSuites === 1 ? "" : "s"} have active proposal motion.`);
      }
      if (input.buildingSummary.vacantSuites > 0) {
        queue.push(`${input.buildingSummary.vacantSuites} vacant suite${input.buildingSummary.vacantSuites === 1 ? "" : "s"} are contributing to downtime exposure.`);
      }
    }
  } else if (input.selectedCompany) {
    if (input.selectedCompany.currentLeaseExpiration) {
      queue.push(`${input.selectedCompany.name} has a lease timing event at ${input.selectedCompany.currentLeaseExpiration}.`);
    }
    if (input.selectedCompany.noticeDeadline) {
      queue.push(`Notice planning should be reviewed before ${input.selectedCompany.noticeDeadline}.`);
    }
    if (input.selectedCompany.nextFollowUpDate) {
      queue.push(`Next follow up is set for ${input.selectedCompany.nextFollowUpDate}.`);
    }
    if ((input.selectedCompanyDealsCount || 0) === 0) {
      queue.push(`No active deal is linked yet, so consider opening a pursuit record.`);
    }
    if ((input.selectedCompanyDocumentsCount || 0) === 0) {
      queue.push(`No documents are linked yet, so upload lease, proposal, or survey material to strengthen the profile.`);
    }
  }
  if (queue.length === 0) {
    queue.push(...profile.ai.nextBestActions.map((item) => `${item}.`));
  }
  return queue;
}

export interface TenantCompanyHubSummary {
  title: string;
  locationLabel: string;
  squareFootage: number;
  expirationDate: string;
  noticeDeadline: string;
  linkedDeals: number;
  linkedDocuments: number;
  linkedObligations: number;
  linkedAnalyses: number;
  touchpoints: number;
  reminders: number;
}

export function buildTenantCompanyHubSummary(input: {
  company: CrmCompany;
  touchpoints: CrmTouchpoint[];
  reminders: CrmReminder[];
}): TenantCompanyHubSummary {
  return {
    title: input.company.name,
    locationLabel: [input.company.market, input.company.submarket, input.company.floor, input.company.suite].filter(Boolean).join(" / ") || "Location pending",
    squareFootage: asNumber(input.company.squareFootage),
    expirationDate: asText(input.company.currentLeaseExpiration),
    noticeDeadline: asText(input.company.noticeDeadline),
    linkedDeals: input.company.linkedDealIds.length,
    linkedDocuments: input.company.linkedDocumentIds.length,
    linkedObligations: input.company.linkedObligationIds.length,
    linkedAnalyses: input.company.linkedAnalysisIds.length,
    touchpoints: input.touchpoints.length,
    reminders: input.reminders.length,
  };
}

export type LandlordStackingPlanSuiteStatus =
  | "vacant"
  | "occupied"
  | "expiring"
  | "proposal_active"
  | "toured";

export interface LandlordStackingPlanSuiteCell {
  id: string;
  buildingId: string;
  floor: string;
  suite: string;
  rsf: number;
  status: LandlordStackingPlanSuiteStatus;
  companyId: string;
  companyName: string;
  leaseStart: string;
  expirationDate: string;
  noticeDeadline: string;
  rentType: string;
  baseRent: number;
  opex: number;
  abatementMonths: number;
  tiAllowance: number;
  concessions: string;
  landlordName: string;
  source: CrmStackingPlanSource;
  sourceDocumentIds: string[];
  proposalCount: number;
  toured: boolean;
  occupied: boolean;
  vacant: boolean;
}

export interface LandlordStackingPlanFloorRow {
  floor: string;
  suites: LandlordStackingPlanSuiteCell[];
}

export interface LandlordStackingPlanBuildingRow {
  buildingId: string;
  buildingName: string;
  market: string;
  submarket: string;
  floors: LandlordStackingPlanFloorRow[];
  summary: {
    occupied: number;
    vacant: number;
    expiring: number;
    proposalActive: number;
    toured: number;
  };
}

function sortFloorLabel(left: string, right: string): number {
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) return rightNum - leftNum;
  return right.localeCompare(left);
}

function inferSuiteStatus(input: {
  occupied: boolean;
  expirationDate: string;
  proposalCount: number;
  toured: boolean;
}): LandlordStackingPlanSuiteStatus {
  const expiringSoon = input.expirationDate && monthsUntil(input.expirationDate) <= 12;
  if (input.proposalCount > 0) return "proposal_active";
  if (input.toured) return "toured";
  if (expiringSoon) return "expiring";
  if (input.occupied) return "occupied";
  return "vacant";
}

export function buildLandlordStackingPlan(input: {
  buildings: CrmBuilding[];
  companies: CrmCompany[];
  occupancyRecords: CrmOccupancyRecord[];
  stackingPlanEntries: CrmStackingPlanEntry[];
  shortlistEntries: CrmShortlistEntry[];
  tours: CrmTour[];
  properties: BrokerageOsProperty[];
  spaces: BrokerageOsSpace[];
  deals: ClientWorkspaceDeal[];
  proposals: BrokerageOsProposal[];
  obligations: BrokerageOsObligation[];
  filters?: {
    market?: string;
    submarket?: string;
    buildingId?: string;
    query?: string;
  };
}): LandlordStackingPlanBuildingRow[] {
  const buildingById = new Map(input.buildings.map((building) => [building.id, building]));
  const companyById = new Map(input.companies.map((company) => [company.id, company]));
  const propertyById = new Map(input.properties.map((property) => [property.id, property]));
  const propertyToBuildingId = new Map<string, string>();

  for (const building of input.buildings) {
    if (building.propertyId) propertyToBuildingId.set(building.propertyId, building.id);
    for (const property of input.properties) {
      const buildingKey = `${normalize(building.name)}::${normalize(building.address)}`;
      const propertyKey = `${normalize(property.name)}::${normalize(property.address)}`;
      if (buildingKey === propertyKey || normalize(property.name) === normalize(building.name)) {
        propertyToBuildingId.set(property.id, building.id);
      }
    }
  }

  const buildingSuiteMap = new Map<string, Map<string, LandlordStackingPlanSuiteCell>>();
  const ensureSuite = (buildingId: string, floor: string, suite: string, rsf: number): LandlordStackingPlanSuiteCell | null => {
    if (!buildingId || !suite) return null;
    if (!buildingSuiteMap.has(buildingId)) buildingSuiteMap.set(buildingId, new Map());
    const suites = buildingSuiteMap.get(buildingId)!;
    const key = `${asText(floor) || "Unassigned"}::${asText(suite)}`;
    const existing = suites.get(key);
    if (existing) {
      if (rsf > 0) existing.rsf = Math.max(existing.rsf, rsf);
      return existing;
    }
    const created: LandlordStackingPlanSuiteCell = {
      id: key,
      buildingId,
      floor: asText(floor) || "Unassigned",
      suite: asText(suite),
      rsf: Math.max(0, rsf),
      status: "vacant",
      companyId: "",
      companyName: "",
      leaseStart: "",
      expirationDate: "",
      noticeDeadline: "",
      rentType: "",
      baseRent: 0,
      opex: 0,
      abatementMonths: 0,
      tiAllowance: 0,
      concessions: "",
      landlordName: "",
      source: "space_seed",
      sourceDocumentIds: [],
      proposalCount: 0,
      toured: false,
      occupied: false,
      vacant: true,
    };
    suites.set(key, created);
    return created;
  };

  for (const space of input.spaces) {
    const buildingId = propertyToBuildingId.get(space.propertyId) || "";
    ensureSuite(buildingId, space.floor, space.suite, space.rsf);
  }

  for (const occupancy of input.occupancyRecords) {
    const suite = ensureSuite(occupancy.buildingId, occupancy.floor, occupancy.suite, occupancy.rsf);
    if (!suite) continue;
    suite.id = occupancy.id || suite.id;
    suite.occupied = true;
    suite.vacant = false;
    suite.companyId = occupancy.companyId || suite.companyId;
    suite.companyName = companyById.get(occupancy.companyId)?.name || suite.companyName;
    suite.leaseStart = asText(occupancy.leaseStart) || suite.leaseStart;
    suite.expirationDate = asText(occupancy.leaseExpiration) || suite.expirationDate;
    suite.noticeDeadline = asText(occupancy.noticeDeadline) || suite.noticeDeadline;
    suite.rentType = asText(occupancy.rentType) || suite.rentType;
    suite.baseRent = Math.max(suite.baseRent, asNumber(occupancy.baseRent));
    suite.opex = Math.max(suite.opex, asNumber(occupancy.opex));
    suite.abatementMonths = Math.max(suite.abatementMonths, asNumber(occupancy.abatementMonths));
    suite.tiAllowance = Math.max(suite.tiAllowance, asNumber(occupancy.tiAllowance));
    suite.concessions = asText(occupancy.concessions) || suite.concessions;
    suite.landlordName = asText(occupancy.landlordName) || suite.landlordName;
    suite.source = "current_lease";
    suite.sourceDocumentIds = occupancy.sourceDocumentIds?.length ? [...occupancy.sourceDocumentIds] : suite.sourceDocumentIds;
    suite.status = inferSuiteStatus(suite);
  }

  for (const entry of input.stackingPlanEntries) {
    const suite = ensureSuite(entry.buildingId, entry.floor, entry.suite, entry.rsf);
    if (!suite) continue;
    suite.id = entry.id || suite.id;
    suite.companyId = asText(entry.companyId) || suite.companyId;
    suite.companyName = asText(entry.tenantName) || companyById.get(entry.companyId)?.name || suite.companyName;
    suite.leaseStart = asText(entry.leaseStart) || suite.leaseStart;
    suite.expirationDate = asText(entry.leaseExpiration) || suite.expirationDate;
    suite.noticeDeadline = asText(entry.noticeDeadline) || suite.noticeDeadline;
    suite.rentType = asText(entry.rentType) || suite.rentType;
    suite.baseRent = Math.max(suite.baseRent, asNumber(entry.baseRent));
    suite.opex = Math.max(suite.opex, asNumber(entry.opex));
    suite.abatementMonths = Math.max(suite.abatementMonths, asNumber(entry.abatementMonths));
    suite.tiAllowance = Math.max(suite.tiAllowance, asNumber(entry.tiAllowance));
    suite.concessions = asText(entry.concessions) || suite.concessions;
    suite.landlordName = asText(entry.landlordName) || suite.landlordName;
    suite.source = entry.source || suite.source;
    suite.sourceDocumentIds = entry.sourceDocumentIds?.length ? [...entry.sourceDocumentIds] : suite.sourceDocumentIds;
    if (suite.companyId || suite.companyName) {
      suite.occupied = true;
      suite.vacant = false;
    }
    suite.status = inferSuiteStatus(suite);
  }

  for (const obligation of input.obligations) {
    const buildingId = asText(obligation.propertyId ? propertyToBuildingId.get(obligation.propertyId) : "") || asText(obligation.propertyId);
    const property = obligation.propertyId ? propertyById.get(obligation.propertyId) : null;
    const suite = ensureSuite(buildingId, "", asText(obligation.spaceId || property?.name || ""), obligation.rsf);
    if (!suite) continue;
    if (!suite.expirationDate) suite.expirationDate = asText(obligation.expirationDate);
    suite.status = inferSuiteStatus(suite);
  }

  const dealIndexById = new Map(input.deals.map((deal) => [deal.id, deal]));
  for (const deal of input.deals) {
    const company = companyById.get(asText(deal.companyId));
    const buildingId = company?.buildingId
      || input.buildings.find((building) => normalize(building.name) === normalize(deal.selectedProperty))?.id
      || "";
    const suite = ensureSuite(buildingId, company?.floor || "", asText(deal.selectedSuite || company?.suite), Math.max(asNumber(company?.squareFootage), asNumber(deal.squareFootageMax)));
    if (!suite) continue;
    const stage = normalize(deal.stage);
    if (stage.includes("tour")) suite.toured = true;
    if (stage.includes("proposal") || stage.includes("counter")) suite.proposalCount += 1;
    if (!suite.companyName && company?.name) suite.companyName = company.name;
    if (!suite.expirationDate && company?.currentLeaseExpiration) suite.expirationDate = company.currentLeaseExpiration;
    suite.status = inferSuiteStatus(suite);
  }

  for (const proposal of input.proposals) {
    const linkedDeal = proposal.dealId ? dealIndexById.get(proposal.dealId) : null;
    const buildingId = asText(proposal.propertyId ? propertyToBuildingId.get(proposal.propertyId) : "")
      || input.buildings.find((building) => normalize(building.name) === normalize(linkedDeal?.selectedProperty))?.id
      || "";
    const suiteIdFromDeal = linkedDeal?.selectedSuite || "";
    const matchedSpace = proposal.spaceId ? input.spaces.find((space) => space.id === proposal.spaceId) : null;
    const suite = ensureSuite(buildingId, matchedSpace?.floor || "", matchedSpace?.suite || suiteIdFromDeal, matchedSpace?.rsf || 0);
    if (!suite) continue;
    suite.proposalCount += 1;
    suite.status = inferSuiteStatus(suite);
  }

  const rows = input.buildings
    .filter((building) => {
      const market = input.filters?.market;
      const submarket = input.filters?.submarket;
      const buildingId = input.filters?.buildingId;
      const query = normalize(input.filters?.query);
      if (market && market !== "all" && building.market !== market) return false;
      if (submarket && submarket !== "all" && building.submarket !== submarket) return false;
      if (buildingId && buildingId !== "all" && building.id !== buildingId) return false;
      if (!query) return true;
      return [building.name, building.address, building.market, building.submarket].map(normalize).join(" ").includes(query);
    })
    .map((building) => {
      const suites = Array.from(buildingSuiteMap.get(building.id)?.values() || [])
        .map((suite) => ({
          ...suite,
          status: inferSuiteStatus(suite),
        }))
        .sort((left, right) => {
          const floorCompare = sortFloorLabel(left.floor, right.floor);
          if (floorCompare !== 0) return floorCompare;
          return left.suite.localeCompare(right.suite);
        });
      const floorsMap = new Map<string, LandlordStackingPlanSuiteCell[]>();
      for (const suite of suites) {
        const floor = suite.floor || "Unassigned";
        if (!floorsMap.has(floor)) floorsMap.set(floor, []);
        floorsMap.get(floor)!.push(suite);
      }
      return {
        buildingId: building.id,
        buildingName: building.name,
        market: building.market,
        submarket: building.submarket,
        floors: Array.from(floorsMap.entries())
          .sort(([left], [right]) => sortFloorLabel(left, right))
          .map(([floor, floorSuites]) => ({
            floor,
            suites: floorSuites,
          })),
        summary: {
          occupied: suites.filter((suite) => suite.occupied).length,
          vacant: suites.filter((suite) => suite.vacant).length,
          expiring: suites.filter((suite) => suite.status === "expiring").length,
          proposalActive: suites.filter((suite) => suite.proposalCount > 0).length,
          toured: suites.filter((suite) => suite.toured).length,
        },
      } satisfies LandlordStackingPlanBuildingRow;
    })
    .filter((row) => row.floors.length > 0);

  return rows.sort((left, right) => `${left.market} ${left.submarket} ${left.buildingName}`.localeCompare(`${right.market} ${right.submarket} ${right.buildingName}`));
}

export interface LandlordBuildingHubSummary {
  buildingName: string;
  totalSuites: number;
  occupiedSuites: number;
  vacantSuites: number;
  expiringSuites: number;
  proposalSuites: number;
  touredSuites: number;
}

export function buildLandlordBuildingHubSummary(row: LandlordStackingPlanBuildingRow | null | undefined): LandlordBuildingHubSummary | null {
  if (!row) return null;
  const totalSuites = row.floors.reduce((sum, floor) => sum + floor.suites.length, 0);
  return {
    buildingName: row.buildingName,
    totalSuites,
    occupiedSuites: row.summary.occupied,
    vacantSuites: row.summary.vacant,
    expiringSuites: row.summary.expiring,
    proposalSuites: row.summary.proposalActive,
    touredSuites: row.summary.toured,
  };
}
