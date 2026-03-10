# Phase 7 Platform Readiness

This phase hardens the platform foundation so future modules can be added without reworking core navigation, layout, or data relationships.

## 1) Module Registration Pattern

Single source of truth:

- `/Users/ryanarnold/Desktop/Lease Deck/frontend/lib/platform/module-registry.ts`

What it centralizes:

- top-level modules (`financial-analyses`, `completed-leases`, `surveys`, `obligations`)
- module labels and descriptions
- auth guard behavior (`requiresAuth`)
- default module routing/fallback
- financial-analyses subtool tabs (`lease-comparison`, `sublease-recovery`)

Helpers:

- `resolveActivePlatformModule(rawValue, isAuthenticated)`
- `isPlatformModuleId(value)`
- `isFinancialAnalysesToolId(value)`

### Add a new top-level module

1. Add a new entry to `PLATFORM_MODULES`.
2. Implement/render the module in `frontend/app/page.tsx` content switch.
3. Add module-specific workspace/component files.

No TopNav hardcoding is required after this phase; nav reads registry data.

## 2) Navigation + Shell Integration

Updated consumers:

- `/Users/ryanarnold/Desktop/Lease Deck/frontend/components/TopNav.tsx`
- `/Users/ryanarnold/Desktop/Lease Deck/frontend/app/page.tsx`

Both now resolve active module IDs through the same registry instead of separate duplicated string lists.

## 3) Shared Entity Relationship Layer

New normalized entity graph:

- `/Users/ryanarnold/Desktop/Lease Deck/frontend/lib/workspace/entities.ts`

Graph nodes:

- `companies`
- `clients`
- `buildings`
- `spaces`
- `obligations`
- `analyses`
- `surveys`
- `documents`

Provider wiring:

- `/Users/ryanarnold/Desktop/Lease Deck/frontend/components/workspace/ClientWorkspaceProvider.tsx`

`useClientWorkspace()` now exposes `entityGraph` so any module can consume one consistent relationship model.

This keeps data modeling clean across:

- companies
- clients
- buildings
- spaces
- obligations
- analyses
- surveys
- documents

## 4) Future-Proofing Notes

- `ClientDocumentSourceModule` now includes `PlatformModuleId` in its type union:
  - `/Users/ryanarnold/Desktop/Lease Deck/frontend/lib/workspace/types.ts`
- This removes another hardcoded surface and allows module growth through registry updates.

## 5) Test Coverage Added

- `/Users/ryanarnold/Desktop/Lease Deck/frontend/lib/platform/module-registry.test.ts`
- `/Users/ryanarnold/Desktop/Lease Deck/frontend/lib/workspace/entities.test.ts`

These tests verify:

- registry uniqueness and auth fallback behavior
- entity graph normalization and cross-entity linking
