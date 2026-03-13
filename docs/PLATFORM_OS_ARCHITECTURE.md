# Leasing Broker OS Architecture

## Objective
Expand The CRE Model from a single analysis workflow into a client-scoped broker operating system where all module data is isolated by active client workspace and interconnected through shared entities.

## Core Workspace Principle
- Every record is scoped by `clientId`.
- User selects an active client workspace.
- Modules query and mutate records only for the active client.
- Cross-module linkage is done with explicit IDs (deal/document/analysis/survey/obligation/abstract).

## Shared Domain Models

### Client
```ts
client {
  id
  name
  companyType
  industry
  contactName
  contactEmail
  brokerage
  notes
  createdAt
  logoDataUrl?
  logoFileName?
}
```

### Document
```ts
document {
  id
  clientId
  dealId?
  name
  type
  building
  address
  suite
  parsed
  uploadedBy
  uploadedAt
  sourceModule
  normalizeSnapshot?
}
```

### Deal
```ts
deal {
  id
  clientId
  dealName
  requirementName
  dealType
  stage
  status
  priority
  targetMarket
  submarket
  city
  squareFootageMin
  squareFootageMax
  budget
  occupancyDateGoal
  expirationDate
  selectedProperty
  selectedSuite
  selectedLandlord
  tenantRepBroker
  notes
  linkedSurveyIds[]
  linkedAnalysisIds[]
  linkedDocumentIds[]
  linkedObligationIds[]
  linkedLeaseAbstractIds[]
  timeline[]
  tasks[]
  createdAt
  updatedAt
}
```

### Deal Stage Configuration
- Client-specific stage list.
- Default stage order:
  - New Lead
  - Qualified
  - Requirement Gathering
  - Market Survey
  - Touring
  - Shortlist
  - Proposal Requested
  - Proposal Received
  - Financial Analysis
  - Negotiation
  - Finalist
  - Lease Drafting
  - Lease Review
  - Executed
  - Lost
  - On Hold

## Module Relationships
- `Financial Analyses` attaches outputs to client documents and can link to deals.
- `Completed Leases` creates lease abstracts and links source docs.
- `Surveys` produces client-scoped survey records and links source docs.
- `Obligations` derives obligations from parsed lease docs and links source docs.
- `Deals` is the lifecycle hub and links to documents, surveys, analyses, obligations, and abstracts.

## Shared Systems
- Unified workspace provider for:
  - active client
  - cloud/local sync
  - clients/documents/deals
  - stage configuration
  - entity graph
- Unified document center:
  - single visible drop section
  - global drop-anywhere ingestion on screen
  - module upload reuse via document picker
- Unified exports are kept in each module export service while preserving common branding inputs.

## Persistence
- Cloud-first state via workspace API section.
- Local fallback keys for offline/authless modes.
- Workspace payload now includes:
  - clients
  - deals
  - dealStageMap
  - documents
  - activeClientId

## Implementation Sequence
1. Extend workspace domain models and storage schema.
2. Extend provider with deals + stage APIs and cloud sync.
3. Add Deals module UI and register top-nav module.
4. Move client switching into header controls.
5. Consolidate document drop UX to one intake section + global drop.
6. Wire document-to-deal linking.
7. Add parser regression guardrails/tests for full-service gross handling.
