import { describe, expect, it } from "vitest";
import { buildCrmWorkspaceState, type CrmBuilding, type CrmCompany } from "@/lib/workspace/crm";
import { getWorkspaceBuildingDeletionKey } from "@/lib/workspace/deletions";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";
import type { ClientWorkspaceDeal, ClientWorkspaceDocument } from "@/lib/workspace/types";

const documents: ClientWorkspaceDocument[] = [
  {
    id: "doc_proposal",
    clientId: "client_1",
    name: "Proposal",
    type: "proposals",
    building: "One Congress",
    address: "111 Congress Ave",
    suite: "100",
    parsed: true,
    uploadedBy: "tester",
    uploadedAt: "2026-03-16T00:00:00.000Z",
    sourceModule: "upload",
    normalizeSnapshot: {
      canonical_lease: {
        tenant_name: "Proposal Tenant",
        building_name: "One Congress",
        address: "111 Congress Ave",
        floor: "10",
        suite: "100",
        rsf: 5000,
        commencement_date: "2030-01-01",
        expiration_date: "2035-12-31",
      } as never,
    },
  },
  {
    id: "doc_lease",
    clientId: "client_1",
    name: "Lease",
    type: "leases",
    building: "One Congress",
    address: "111 Congress Ave",
    suite: "200",
    parsed: true,
    uploadedBy: "tester",
    uploadedAt: "2026-03-16T00:00:00.000Z",
    sourceModule: "upload",
    normalizeSnapshot: {
      canonical_lease: {
        tenant_name: "Current Tenant",
        building_name: "One Congress",
        address: "111 Congress Ave",
        floor: "11",
        suite: "200",
        rsf: 7000,
        commencement_date: "2025-01-01",
        expiration_date: "2030-12-31",
        lease_type: "Direct",
      } as never,
    },
  },
  {
    id: "doc_sublease",
    clientId: "client_1",
    name: "Sublease",
    type: "sublease documents",
    building: "One Congress",
    address: "111 Congress Ave",
    suite: "300",
    parsed: true,
    uploadedBy: "tester",
    uploadedAt: "2026-03-16T00:00:00.000Z",
    sourceModule: "upload",
    normalizeSnapshot: {
      canonical_lease: {
        tenant_name: "Subtenant",
        building_name: "One Congress",
        address: "111 Congress Ave",
        floor: "12",
        suite: "300",
        rsf: 4500,
        commencement_date: "2026-01-01",
        expiration_date: "2028-12-31",
        lease_type: "Sublease",
      } as never,
    },
  },
];

function makeBuilding(id: string, name = "The Plaza Building", address = "2277 Plaza Drive"): CrmBuilding {
  return {
    id,
    clientId: "client-1",
    name,
    address,
    market: "Austin",
    submarket: "CBD",
    ownerName: "Owner",
    propertyType: "Office",
    totalRSF: 100000,
    notes: "",
  };
}

describe("workspace/crm stacking-plan ingest", () => {
  it("updates stacking plans from current lease and sublease uploads but not proposals", () => {
    const state = buildCrmWorkspaceState({
      clientId: "client_1",
      clientName: "Owner Client",
      representationMode: LANDLORD_REP_MODE,
      documents,
      deals: [],
      properties: [{ id: "property_1", name: "One Congress", address: "111 Congress Ave", market: "Austin", submarket: "CBD" }],
      spaces: [],
      obligations: [],
      surveys: [],
      surveyEntries: [],
      financialAnalyses: [],
      leaseAbstracts: [],
      existingState: null,
    });

    const stackSuites = new Set(state.stackingPlanEntries.map((entry) => entry.suite));
    const occupancySuites = new Set(state.occupancyRecords.map((entry) => entry.suite));

    expect(stackSuites.has("100")).toBe(false);
    expect(occupancySuites.has("100")).toBe(false);
    expect(stackSuites.has("200")).toBe(true);
    expect(stackSuites.has("300")).toBe(true);
    expect(occupancySuites.has("200")).toBe(true);
    expect(occupancySuites.has("300")).toBe(true);
  });

  it("uses shared market inventory buildings when provided", () => {
    const state = buildCrmWorkspaceState({
      clientId: "client_1",
      clientName: "Owner Client",
      representationMode: LANDLORD_REP_MODE,
      sharedBuildings: [
        {
          id: "shared_1",
          clientId: "market_inventory_shared",
          name: "Shared Tower",
          address: "500 Shared Ave",
          city: "Austin",
          state: "TX",
          market: "Austin",
          submarket: "CBD",
          ownerName: "Shared Owner",
          propertyType: "Office",
          totalRSF: 150000,
          notes: "Shared import",
          buildingClass: "A",
          buildingStatus: "Existing",
          yearBuilt: 2015,
          yearRenovated: null,
          numberOfStories: 12,
          coreFactor: null,
          typicalFloorSize: 12000,
          parkingRatio: 3.5,
          operatingExpenses: "$16.50",
          amenities: "",
          propertyId: "500",
          ownerPhone: "",
          propertyManagerName: "",
          propertyManagerPhone: "",
          leasingCompanyName: "",
          leasingCompanyContact: "",
          leasingCompanyPhone: "",
          latitude: 30.2672,
          longitude: -97.7431,
          source: "costar_excel_import",
        },
      ],
      documents: [],
      deals: [],
      properties: [],
      spaces: [],
      obligations: [],
      surveys: [],
      surveyEntries: [],
      financialAnalyses: [],
      leaseAbstracts: [],
      existingState: null,
    });

    expect(state.buildings.some((building) => building.id === "shared_1")).toBe(true);
    expect(state.buildings.find((building) => building.id === "shared_1")?.name).toBe("Shared Tower");
  });

  it("links manually created CRM companies to pipeline deals by company id", () => {
    const manualCompany: CrmCompany = {
      id: "company_prospect_1",
      clientId: "client_1",
      name: "Pipeline Prospect",
      type: "prospect",
      industry: "Technology",
      market: "Austin",
      submarket: "CBD",
      buildingId: "",
      floor: "",
      suite: "",
      squareFootage: 0,
      currentLeaseExpiration: "",
      noticeDeadline: "",
      renewalProbability: 0.5,
      prospectStatus: "New Lead",
      relationshipOwner: "Broker Team",
      source: "manual",
      notes: "",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
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
    };
    const deal: ClientWorkspaceDeal = {
      id: "deal_prospect_1",
      clientId: "client_1",
      companyId: manualCompany.id,
      dealName: "Pipeline Prospect Requirement",
      requirementName: "Pipeline Prospect requirement",
      dealType: "Tenant Rep",
      stage: "New Lead",
      status: "open",
      priority: "medium",
      targetMarket: "Austin",
      submarket: "CBD",
      city: "",
      squareFootageMin: 0,
      squareFootageMax: 0,
      budget: 0,
      occupancyDateGoal: "",
      expirationDate: "",
      selectedProperty: "",
      selectedSuite: "",
      selectedLandlord: "",
      tenantRepBroker: "Broker Team",
      notes: "",
      linkedSurveyIds: [],
      linkedAnalysisIds: [],
      linkedDocumentIds: [],
      linkedObligationIds: [],
      linkedLeaseAbstractIds: [],
      timeline: [],
      tasks: [],
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    };

    const state = buildCrmWorkspaceState({
      clientId: "client_1",
      clientName: "Workspace Client",
      documents: [],
      deals: [deal],
      properties: [],
      spaces: [],
      obligations: [],
      surveys: [],
      surveyEntries: [],
      financialAnalyses: [],
      leaseAbstracts: [],
      existingState: {
        companies: [manualCompany],
      },
    });

    const prospect = state.companies.find((company) => company.id === manualCompany.id);
    const workspace = state.companies.find((company) => company.name === "Workspace Client");

    expect(prospect?.name).toBe("Pipeline Prospect");
    expect(prospect?.linkedDealIds).toContain(deal.id);
    expect(state.prospectingRecords.find((record) => record.companyId === manualCompany.id)?.prospectStage).toBe("New Lead");
    expect(workspace?.linkedDealIds).not.toContain(deal.id);
  });

  it("preserves shortlist and tour workflow records from existing state", () => {
    const state = buildCrmWorkspaceState({
      clientId: "client_1",
      clientName: "Owner Client",
      representationMode: LANDLORD_REP_MODE,
      documents: [],
      deals: [],
      properties: [],
      spaces: [],
      obligations: [],
      surveys: [],
      surveyEntries: [],
      financialAnalyses: [],
      leaseAbstracts: [],
      existingState: {
        shortlists: [
          {
            id: "shortlist_1",
            clientId: "other_client",
            buildingId: "building_1",
            dealId: "deal_1",
            name: "CBD Tour Run",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          },
        ],
        shortlistEntries: [
          {
            id: "entry_1",
            clientId: "other_client",
            shortlistId: "shortlist_1",
            dealId: "deal_1",
            buildingId: "building_1",
            floor: "10",
            suite: "100",
            rsf: 5000,
            source: "manual",
            status: "touring",
            owner: "Broker Team",
            rank: 1,
            notes: "Prime option",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          },
        ],
        tours: [
          {
            id: "tour_1",
            clientId: "other_client",
            dealId: "deal_1",
            shortlistEntryId: "entry_1",
            buildingId: "building_1",
            floor: "10",
            suite: "100",
            scheduledAt: "2026-04-05T15:00:00.000Z",
            status: "scheduled",
            broker: "Broker Team",
            assignee: "Tour Lead",
            attendees: ["Client A"],
            notes: "Confirm lobby meet",
            followUpActions: "",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          },
        ],
        workflowBoardViews: [
          {
            id: "view_1",
            clientId: "other_client",
            dealId: "deal_1",
            scope: "team",
            createdBy: "broker@example.com",
            team: "Austin Brokerage",
            name: "Broker Team Next 14",
            buildingId: "building_1",
            broker: "Broker Team",
            dateFilter: "next_14",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          },
        ],
      },
    });

    expect(state.shortlists).toHaveLength(1);
    expect(state.shortlists[0].clientId).toBe("client_1");
    expect(state.shortlistEntries[0].status).toBe("touring");
    expect(state.shortlistEntries[0].owner).toBe("Broker Team");
    expect(state.tours[0].attendees).toEqual(["Client A"]);
    expect(state.tours[0].clientId).toBe("client_1");
    expect(state.tours[0].assignee).toBe("Tour Lead");
    expect(state.workflowBoardViews[0].clientId).toBe("client_1");
    expect(state.workflowBoardViews[0].scope).toBe("team");
    expect(state.workflowBoardViews[0].team).toBe("Austin Brokerage");
    expect(state.workflowBoardViews[0].dateFilter).toBe("next_14");
  });
});

describe("buildCrmWorkspaceState deletions", () => {
  it("keeps deleted buildings out of the rebuilt workspace even when sources use a different id", () => {
    const deletedBuilding = makeBuilding("shared-1");
    const deletedBuildingKey = getWorkspaceBuildingDeletionKey(deletedBuilding);

    const state = buildCrmWorkspaceState({
      clientId: "client-1",
      clientName: "Workspace Client",
      representationMode: null,
      sharedBuildings: [deletedBuilding],
      documents: [],
      deals: [],
      properties: [
        {
          id: "property-99",
          name: "The Plaza Building",
          address: "2277 Plaza Drive",
          market: "Austin",
          submarket: "CBD",
        },
      ],
      spaces: [],
      obligations: [],
      surveys: [],
      surveyEntries: [],
      financialAnalyses: [],
      leaseAbstracts: [],
      existingState: {
        deletedBuildingKeys: [deletedBuildingKey],
      },
    });

    expect(state.deletedBuildingKeys).toEqual([deletedBuildingKey]);
    expect(state.buildings).toEqual([]);
  });

  it("filters building-bound workflow records when a building has been deleted", () => {
    const deletedBuilding = makeBuilding("shared-1");
    const deletedBuildingKey = getWorkspaceBuildingDeletionKey(deletedBuilding);

    const state = buildCrmWorkspaceState({
      clientId: "client-1",
      clientName: "Workspace Client",
      representationMode: null,
      sharedBuildings: [deletedBuilding],
      documents: [],
      deals: [],
      properties: [],
      spaces: [],
      obligations: [],
      surveys: [],
      surveyEntries: [],
      financialAnalyses: [],
      leaseAbstracts: [],
      existingState: {
        deletedBuildingKeys: [deletedBuildingKey],
        buildings: [deletedBuilding],
        occupancyRecords: [{
          id: "occ-1",
          clientId: "client-1",
          companyId: "company-1",
          buildingId: "shared-1",
          floor: "6",
          suite: "600",
          rsf: 3118,
          leaseStart: "2026-11-01",
          leaseExpiration: "2034-06-30",
          noticeDeadline: "",
          rentType: "gross",
          baseRent: 40,
          opex: 0,
          abatementMonths: 0,
          tiAllowance: 0,
          concessions: "",
          landlordName: "Owner",
          isCurrent: true,
          sourceDocumentIds: [],
        }],
        stackingPlanEntries: [{
          id: "stack-1",
          clientId: "client-1",
          buildingId: "shared-1",
          floor: "6",
          suite: "600",
          rsf: 3118,
          companyId: "company-1",
          tenantName: "Tenant",
          leaseStart: "2026-11-01",
          leaseExpiration: "2034-06-30",
          noticeDeadline: "",
          rentType: "gross",
          baseRent: 40,
          opex: 0,
          abatementMonths: 0,
          tiAllowance: 0,
          concessions: "",
          landlordName: "Owner",
          source: "manual",
          sourceDocumentIds: [],
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
        }],
        shortlists: [{
          id: "shortlist-1",
          clientId: "client-1",
          buildingId: "shared-1",
          name: "Deleted Tower Shortlist",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
        }],
        shortlistEntries: [{
          id: "entry-1",
          clientId: "client-1",
          shortlistId: "shortlist-1",
          buildingId: "shared-1",
          floor: "6",
          suite: "600",
          rsf: 3118,
          source: "manual",
          status: "shortlisted",
          owner: "Broker",
          rank: 1,
          notes: "",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
        }],
        tours: [{
          id: "tour-1",
          clientId: "client-1",
          buildingId: "shared-1",
          floor: "6",
          suite: "600",
          scheduledAt: "2026-03-27T15:00:00.000Z",
          status: "scheduled",
          broker: "Broker",
          assignee: "Broker",
          attendees: ["Broker"],
          notes: "",
          followUpActions: "",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
        }],
        workflowBoardViews: [
          {
            id: "view-building",
            clientId: "client-1",
            scope: "team",
            createdBy: "broker",
            team: "team",
            name: "Deleted Building View",
            buildingId: "shared-1",
            broker: "all",
            dateFilter: "all",
            createdAt: "2026-03-26T00:00:00.000Z",
            updatedAt: "2026-03-26T00:00:00.000Z",
          },
          {
            id: "view-all",
            clientId: "client-1",
            scope: "team",
            createdBy: "broker",
            team: "team",
            name: "All Buildings",
            buildingId: "all",
            broker: "all",
            dateFilter: "all",
            createdAt: "2026-03-26T00:00:00.000Z",
            updatedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
      },
    });

    expect(state.buildings).toEqual([]);
    expect(state.occupancyRecords).toEqual([]);
    expect(state.stackingPlanEntries).toEqual([]);
    expect(state.shortlists).toEqual([]);
    expect(state.shortlistEntries).toEqual([]);
    expect(state.tours).toEqual([]);
    expect(state.workflowBoardViews.map((view) => view.id)).toEqual(["view-all"]);
  });
});
