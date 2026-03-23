import { describe, expect, it } from "vitest";
import type { ClientWorkspaceDeal } from "@/lib/workspace/types";
import type { BrokerageOsProposal, BrokerageOsProperty, BrokerageOsSpace } from "@/lib/workspace/os-types";
import type { CrmBuilding, CrmCompany, CrmOccupancyRecord } from "@/lib/workspace/crm";
import { buildLandlordBuildingHubSummary, buildLandlordStackingPlan } from "@/lib/workspace/representation-selectors";

const building: CrmBuilding = {
  id: "building_1",
  clientId: "client_1",
  propertyId: "property_1",
  name: "One Congress",
  address: "111 Congress Ave",
  market: "Austin",
  submarket: "CBD",
  ownerName: "Owner",
  propertyType: "Office",
  totalRSF: 500000,
  notes: "",
};

const properties: BrokerageOsProperty[] = [
  {
    id: "property_1",
    clientId: "client_1",
    name: "One Congress",
    address: "111 Congress Ave",
    market: "Austin",
    submarket: "CBD",
  },
];

const spaces: BrokerageOsSpace[] = [
  { id: "space_100", clientId: "client_1", propertyId: "property_1", floor: "10", suite: "100", rsf: 10000 },
  { id: "space_200", clientId: "client_1", propertyId: "property_1", floor: "10", suite: "200", rsf: 8000 },
  { id: "space_300", clientId: "client_1", propertyId: "property_1", floor: "11", suite: "300", rsf: 9000 },
  { id: "space_400", clientId: "client_1", propertyId: "property_1", floor: "12", suite: "400", rsf: 7000 },
  { id: "space_500", clientId: "client_1", propertyId: "property_1", floor: "12", suite: "500", rsf: 6000 },
];

const companies: CrmCompany[] = [
  {
    id: "company_occupied",
    clientId: "client_1",
    name: "Stable Tenant",
    type: "tenant",
    industry: "",
    market: "Austin",
    submarket: "CBD",
    buildingId: "building_1",
    floor: "10",
    suite: "100",
    squareFootage: 10000,
    currentLeaseExpiration: "2028-12-31",
    noticeDeadline: "",
    renewalProbability: 0.5,
    prospectStatus: "Managed",
    relationshipOwner: "Broker Team",
    source: "manual",
    notes: "",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    linkedDocumentIds: [],
    linkedDealIds: [],
    linkedObligationIds: [],
    linkedSurveyIds: [],
    linkedAnalysisIds: [],
    linkedLeaseAbstractIds: [],
    lastTouchDate: "",
    nextFollowUpDate: "",
    landlordName: "",
    brokerRelationship: "",
  },
  {
    id: "company_expiring",
    clientId: "client_1",
    name: "Renewal Risk",
    type: "tenant",
    industry: "",
    market: "Austin",
    submarket: "CBD",
    buildingId: "building_1",
    floor: "11",
    suite: "300",
    squareFootage: 9000,
    currentLeaseExpiration: "2026-10-15",
    noticeDeadline: "",
    renewalProbability: 0.4,
    prospectStatus: "Managed",
    relationshipOwner: "Broker Team",
    source: "manual",
    notes: "",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    linkedDocumentIds: [],
    linkedDealIds: [],
    linkedObligationIds: [],
    linkedSurveyIds: [],
    linkedAnalysisIds: [],
    linkedLeaseAbstractIds: [],
    lastTouchDate: "",
    nextFollowUpDate: "",
    landlordName: "",
    brokerRelationship: "",
  },
  {
    id: "company_toured",
    clientId: "client_1",
    name: "Tour Prospect",
    type: "prospect",
    industry: "",
    market: "Austin",
    submarket: "CBD",
    buildingId: "building_1",
    floor: "12",
    suite: "400",
    squareFootage: 7000,
    currentLeaseExpiration: "",
    noticeDeadline: "",
    renewalProbability: 0.2,
    prospectStatus: "Touring",
    relationshipOwner: "Broker Team",
    source: "manual",
    notes: "",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    linkedDocumentIds: [],
    linkedDealIds: [],
    linkedObligationIds: [],
    linkedSurveyIds: [],
    linkedAnalysisIds: [],
    linkedLeaseAbstractIds: [],
    lastTouchDate: "",
    nextFollowUpDate: "",
    landlordName: "",
    brokerRelationship: "",
  },
];

const occupancyRecords: CrmOccupancyRecord[] = [
  {
    id: "occ_100",
    clientId: "client_1",
    companyId: "company_occupied",
    buildingId: "building_1",
    floor: "10",
    suite: "100",
    rsf: 10000,
    leaseStart: "2024-01-01",
    leaseExpiration: "2028-12-31",
    noticeDeadline: "",
    rentType: "NNN",
    baseRent: 40,
    opex: 15,
    landlordName: "Owner",
    isCurrent: true,
    sourceDocumentIds: [],
  },
  {
    id: "occ_300",
    clientId: "client_1",
    companyId: "company_expiring",
    buildingId: "building_1",
    floor: "11",
    suite: "300",
    rsf: 9000,
    leaseStart: "2022-01-01",
    leaseExpiration: "2026-10-15",
    noticeDeadline: "",
    rentType: "NNN",
    baseRent: 42,
    opex: 16,
    landlordName: "Owner",
    isCurrent: true,
    sourceDocumentIds: [],
  },
];

const deals: ClientWorkspaceDeal[] = [
  {
    id: "deal_tour",
    clientId: "client_1",
    companyId: "company_toured",
    dealName: "Tour Prospect Pursuit",
    requirementName: "Suite 400",
    dealType: "Landlord Rep",
    stage: "Tour Scheduled",
    status: "open",
    priority: "high",
    targetMarket: "Austin",
    submarket: "CBD",
    city: "Austin",
    squareFootageMin: 7000,
    squareFootageMax: 7000,
    budget: 0,
    occupancyDateGoal: "",
    expirationDate: "",
    selectedProperty: "One Congress",
    selectedSuite: "400",
    selectedLandlord: "",
    tenantRepBroker: "",
    notes: "",
    linkedSurveyIds: [],
    linkedAnalysisIds: [],
    linkedDocumentIds: [],
    linkedObligationIds: [],
    linkedLeaseAbstractIds: [],
    timeline: [],
    tasks: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

const proposals: BrokerageOsProposal[] = [
  {
    id: "proposal_500",
    clientId: "client_1",
    propertyId: "property_1",
    spaceId: "space_500",
    dealId: undefined,
    documentId: "doc_500",
    type: "proposal",
    annualRatePsf: 45,
    termMonths: 60,
    summary: "Proposal for suite 500",
  },
];

describe("workspace/representation-selectors", () => {
  it("derives landlord stacking-plan suite states from the shared graph", () => {
    const rows = buildLandlordStackingPlan({
      buildings: [building],
      companies,
      occupancyRecords,
      properties,
      spaces,
      deals,
      proposals,
      obligations: [],
    });

    expect(rows).toHaveLength(1);
    const suites = rows[0].floors.flatMap((floor) => floor.suites);
    const statusBySuite = new Map(suites.map((suite) => [suite.suite, suite.status]));

    expect(statusBySuite.get("100")).toBe("occupied");
    expect(statusBySuite.get("200")).toBe("vacant");
    expect(statusBySuite.get("300")).toBe("expiring");
    expect(statusBySuite.get("400")).toBe("toured");
    expect(statusBySuite.get("500")).toBe("proposal_active");
  });

  it("builds a landlord building hub summary from stacking-plan rows", () => {
    const row = buildLandlordStackingPlan({
      buildings: [building],
      companies,
      occupancyRecords,
      properties,
      spaces,
      deals,
      proposals,
      obligations: [],
    })[0];

    const summary = buildLandlordBuildingHubSummary(row);

    expect(summary?.buildingName).toBe("One Congress");
    expect(summary?.totalSuites).toBe(5);
    expect(summary?.occupiedSuites).toBe(2);
    expect(summary?.vacantSuites).toBe(3);
    expect(summary?.expiringSuites).toBe(1);
    expect(summary?.proposalSuites).toBe(1);
    expect(summary?.touredSuites).toBe(1);
  });
});
