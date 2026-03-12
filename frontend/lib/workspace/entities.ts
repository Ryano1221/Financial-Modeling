import type {
  ClientWorkspaceClient,
  ClientWorkspaceDeal,
  ClientWorkspaceDocument,
} from "@/lib/workspace/types";

export interface WorkspaceCompanyEntity {
  id: string;
  name: string;
  clientIds: string[];
  documentIds: string[];
}

export interface WorkspaceBuildingEntity {
  id: string;
  companyId: string;
  name: string;
  address: string;
  spaceIds: string[];
  documentIds: string[];
}

export interface WorkspaceSpaceEntity {
  id: string;
  companyId: string;
  buildingId: string;
  suite: string;
  documentIds: string[];
}

export interface WorkspaceObligationEntity {
  id: string;
  companyId: string;
  buildingId: string;
  spaceId: string;
  sourceDocumentIds: string[];
}

export interface WorkspaceAnalysisEntity {
  id: string;
  companyId: string;
  sourceDocumentId: string;
}

export interface WorkspaceSurveyEntity {
  id: string;
  companyId: string;
  sourceDocumentId: string;
}

export interface WorkspaceDealEntity {
  id: string;
  companyId: string;
  clientId: string;
  dealName: string;
  stage: string;
  status: string;
  priority: string;
  linkedDocumentIds: string[];
}

export interface WorkspaceEntityGraph {
  companies: WorkspaceCompanyEntity[];
  clients: ClientWorkspaceClient[];
  buildings: WorkspaceBuildingEntity[];
  spaces: WorkspaceSpaceEntity[];
  obligations: WorkspaceObligationEntity[];
  analyses: WorkspaceAnalysisEntity[];
  surveys: WorkspaceSurveyEntity[];
  deals: WorkspaceDealEntity[];
  documents: ClientWorkspaceDocument[];
}

interface BuildWorkspaceEntityGraphInput {
  clients: ClientWorkspaceClient[];
  documents: ClientWorkspaceDocument[];
  deals?: ClientWorkspaceDeal[];
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function companyNameForClient(client: ClientWorkspaceClient): string {
  const brokerage = asText(client.brokerage);
  return brokerage || asText(client.name) || "Unassigned";
}

function companyIdForClient(client: ClientWorkspaceClient): string {
  const key = slugify(companyNameForClient(client)) || "unassigned";
  return `company_${key}`;
}

function upsertCompany(
  map: Map<string, WorkspaceCompanyEntity>,
  companyId: string,
  companyName: string,
  clientId: string,
) {
  const existing = map.get(companyId);
  if (existing) {
    if (!existing.clientIds.includes(clientId)) existing.clientIds.push(clientId);
    return;
  }
  map.set(companyId, {
    id: companyId,
    name: companyName,
    clientIds: [clientId],
    documentIds: [],
  });
}

function attachDocumentToCompany(
  map: Map<string, WorkspaceCompanyEntity>,
  companyId: string,
  documentId: string,
) {
  const company = map.get(companyId);
  if (!company) return;
  if (!company.documentIds.includes(documentId)) company.documentIds.push(documentId);
}

export function buildWorkspaceEntityGraph({
  clients,
  documents,
  deals = [],
}: BuildWorkspaceEntityGraphInput): WorkspaceEntityGraph {
  const clientById = new Map<string, ClientWorkspaceClient>();
  for (const client of clients) {
    clientById.set(client.id, client);
  }

  const companies = new Map<string, WorkspaceCompanyEntity>();
  for (const client of clients) {
    const companyId = companyIdForClient(client);
    upsertCompany(companies, companyId, companyNameForClient(client), client.id);
  }

  const buildings = new Map<string, WorkspaceBuildingEntity>();
  const spaces = new Map<string, WorkspaceSpaceEntity>();
  const obligations = new Map<string, WorkspaceObligationEntity>();
  const analyses = new Map<string, WorkspaceAnalysisEntity>();
  const surveys = new Map<string, WorkspaceSurveyEntity>();
  const dealEntities = new Map<string, WorkspaceDealEntity>();

  for (const document of documents) {
    const client = clientById.get(document.clientId);
    const companyId = client ? companyIdForClient(client) : "company_unassigned";
    if (!companies.has(companyId)) {
      companies.set(companyId, {
        id: companyId,
        name: client ? companyNameForClient(client) : "Unassigned",
        clientIds: client ? [client.id] : [],
        documentIds: [],
      });
    }
    attachDocumentToCompany(companies, companyId, document.id);

    const buildingName = asText(document.building) || "Unknown building";
    const address = asText(document.address);
    const buildingKey = slugify(`${companyId}-${buildingName}-${address}`) || `building-${document.id}`;
    const buildingId = `building_${buildingKey}`;
    if (!buildings.has(buildingId)) {
      buildings.set(buildingId, {
        id: buildingId,
        companyId,
        name: buildingName,
        address,
        spaceIds: [],
        documentIds: [],
      });
    }
    const building = buildings.get(buildingId);
    if (building && !building.documentIds.includes(document.id)) {
      building.documentIds.push(document.id);
    }

    const suite = asText(document.suite) || "Unknown suite";
    const spaceKey = slugify(`${buildingId}-${suite}`) || `space-${document.id}`;
    const spaceId = `space_${spaceKey}`;
    if (!spaces.has(spaceId)) {
      spaces.set(spaceId, {
        id: spaceId,
        companyId,
        buildingId,
        suite,
        documentIds: [],
      });
    }
    const space = spaces.get(spaceId);
    if (space && !space.documentIds.includes(document.id)) {
      space.documentIds.push(document.id);
    }
    if (building && !building.spaceIds.includes(spaceId)) {
      building.spaceIds.push(spaceId);
    }

    if (document.sourceModule === "financial-analyses" || document.type === "financial analyses") {
      const analysisId = `analysis_${slugify(document.id) || document.id}`;
      analyses.set(analysisId, {
        id: analysisId,
        companyId,
        sourceDocumentId: document.id,
      });
    }

    if (document.sourceModule === "surveys" || document.type === "surveys" || document.type === "flyers" || document.type === "floorplans") {
      const surveyId = `survey_${slugify(document.id) || document.id}`;
      surveys.set(surveyId, {
        id: surveyId,
        companyId,
        sourceDocumentId: document.id,
      });
    }

    if (
      document.sourceModule === "obligations"
      || document.sourceModule === "completed-leases"
      || document.type === "leases"
      || document.type === "amendments"
      || document.type === "redlines"
      || document.type === "abstracts"
    ) {
      const obligationKey = slugify(`${companyId}-${buildingId}-${spaceId}`) || `obligation-${document.id}`;
      const obligationId = `obligation_${obligationKey}`;
      const existing = obligations.get(obligationId);
      if (existing) {
        if (!existing.sourceDocumentIds.includes(document.id)) {
          existing.sourceDocumentIds.push(document.id);
        }
      } else {
        obligations.set(obligationId, {
          id: obligationId,
          companyId,
          buildingId,
          spaceId,
          sourceDocumentIds: [document.id],
        });
      }
    }
  }

  for (const deal of deals) {
    const client = clientById.get(deal.clientId);
    const companyId = client ? companyIdForClient(client) : "company_unassigned";
    if (!companies.has(companyId)) {
      companies.set(companyId, {
        id: companyId,
        name: client ? companyNameForClient(client) : "Unassigned",
        clientIds: client ? [client.id] : [],
        documentIds: [],
      });
    }
    const linkedDocumentIds = Array.from(
      new Set(
        [
          ...(Array.isArray(deal.linkedDocumentIds) ? deal.linkedDocumentIds : []),
          ...documents
            .filter((doc) => doc.dealId === deal.id)
            .map((doc) => doc.id),
        ].filter(Boolean),
      ),
    );
    dealEntities.set(deal.id, {
      id: deal.id,
      companyId,
      clientId: deal.clientId,
      dealName: deal.dealName,
      stage: deal.stage,
      status: deal.status,
      priority: deal.priority,
      linkedDocumentIds,
    });
  }

  return {
    companies: Array.from(companies.values()),
    clients: [...clients],
    buildings: Array.from(buildings.values()),
    spaces: Array.from(spaces.values()),
    obligations: Array.from(obligations.values()),
    analyses: Array.from(analyses.values()),
    surveys: Array.from(surveys.values()),
    deals: Array.from(dealEntities.values()),
    documents: [...documents],
  };
}
