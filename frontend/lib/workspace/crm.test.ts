import { describe, expect, it } from "vitest";
import { buildCrmWorkspaceState } from "@/lib/workspace/crm";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";

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
