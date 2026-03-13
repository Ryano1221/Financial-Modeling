# The CRE Model Brokerage OS Architecture

## 1. Platform Core

The platform is implemented as one operating system layer on top of the existing product UI:

- `Shared Entity Graph`
- `Shared Workflow Engine`
- `Shared Document Intelligence Layer`
- `Shared AI Orchestration Layer`
- `Shared Export + Share Layer`
- `Shared Activity + Change + Audit Logs`

All modules (`Deals`, `Financial Analyses`, `Completed Leases`, `Surveys`, `Obligations`) read and write through this shared layer.

## 2. Workspace Scope

All records are scoped to one active client workspace.

- After auth, user selects or creates a client.
- Active `clientId` is global and persists in workspace state.
- Switching client rehydrates all derived entities and views.
- No entity is stored without `clientId`.

## 3. Unified Entity Graph

### 3.1 Core Entities

- `client`
- `company`
- `contact`
- `deal`
- `requirement`
- `property`
- `space`
- `document`
- `survey`
- `surveyEntry`
- `proposal`
- `financialAnalysis`
- `subleaseRecovery`
- `lease`
- `amendment`
- `leaseAbstract`
- `obligation`
- `task`
- `activity`
- `changeEvent`
- `export`
- `shareLink`

### 3.2 Relationship Contract

- `client -> deals`
- `client -> documents`
- `deal -> requirement`
- `deal -> survey`
- `survey -> surveyEntries`
- `surveyEntry -> property + space`
- `proposal -> space`
- `financialAnalysis -> proposal + document`
- `subleaseRecovery -> obligation + proposal`
- `lease -> obligation`
- `amendment -> lease`
- `leaseAbstract -> lease + amendment`
- `document -> multiple entities (deal/property/space/lease/obligation/etc.)`
- `deal -> analyses`
- `deal -> obligations`
- `task -> deal`
- `activity/changeEvent/export/shareLink -> client (+ optional deal)`

## 4. Workflow Engine

The workflow engine is a shared transition system, not module-specific logic.

### 4.1 Stages

- `New Lead`
- `Qualified`
- `Requirement Gathering`
- `Survey`
- `Touring`
- `Proposal Requested`
- `Proposal Received`
- `Financial Analysis`
- `Negotiation`
- `LOI`
- `Lease Drafting`
- `Lease Review`
- `Executed`
- `Lost`
- `On Hold`

### 4.2 Transition Rules

- Transition validity is checked against stage order and explicit terminal rules.
- `Lost` and `On Hold` are terminal-like states with re-open rules.
- Workflow transitions can be triggered by:
  - user actions
  - document classification events
  - AI tool actions

### 4.3 Workflow Outputs

Every transition creates:

- `activity` log entry
- `changeEvent` record
- `audit` entry with actor (`user` or `ai`)

## 5. Document Intelligence Layer

Every upload enters one shared document service:

1. fingerprint
2. classify
3. parse (once)
4. normalize extracted entities
5. link to graph entities

Key behavior:

- Parse-once reuse (`document.parsedData` + linked entities).
- Classification drives workflow hints.
- Linking is many-to-many (`document` can link to multiple entity ids).

## 6. AI Orchestration Layer

AI orchestration executes structured tools over the entity graph.

### 6.1 Tool Surface

- `createDeal`
- `updateDealStage`
- `createSurvey`
- `addSurveyEntriesFromDocuments`
- `createFinancialAnalysis`
- `createSubleaseRecovery`
- `compareProposals`
- `createLeaseAbstract`
- `updateObligationFromLease`
- `summarizeAmendmentChanges`
- `classifyDocument`
- `extractTermsFromDocument`
- `linkDocumentToEntities`
- `createTask`
- `generateClientSummary`
- `exportPdf`
- `exportExcel`
- `createShareLink`

### 6.2 AI Runtime Rules

- Intent resolution maps user command -> tool plan.
- Tool calls execute in deterministic order.
- Every AI action writes activity/change/audit logs.
- AI never bypasses workspace scope.

## 7. Export + Share Layer

One export registry serves all modules.

Supported outputs:

- PDF
- Excel
- client share links

Every export/share operation writes:

- `export` record
- `shareLink` record (if applicable)
- log records

## 8. Module Interop Contract

Modules are adapters into shared graph:

- `Deals`: pipeline lifecycle + tasks + linked records
- `Financial Analyses`: writes analyses linked to deals/documents
- `Completed Leases`: writes lease/amendment/abstract + obligation updates
- `Surveys`: writes survey + survey entries linked to spaces/deals
- `Obligations`: reads leases/amendments and maintains obligation timeline/metrics

Each module must consume shared entities rather than creating isolated module-only records.

## 9. Operational Definition

The platform is operational when:

- client workspace selection gates authenticated use
- all uploads route to unified document library
- deal workflow transitions are centralized and logged
- AI commands execute structured tools on shared graph
- exports and share links are unified and logged
- all top-level modules interoperate via shared entities

