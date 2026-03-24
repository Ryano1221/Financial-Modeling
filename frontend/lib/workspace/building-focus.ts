import type { CrmBuilding } from '@/lib/workspace/crm';
import { makeClientScopedStorageKey } from '@/lib/workspace/storage';

const BUILDING_FOCUS_STORAGE_KEY = 'building_focus_v1';

export interface BuildingFocusState {
  buildingId: string;
  buildingName: string;
  address: string;
  market: string;
  submarket: string;
  floor?: string;
  suite?: string;
  updatedAt: string;
}

function asText(value: unknown): string {
  return String(value || '').trim();
}

function storageKey(clientId: string) {
  return makeClientScopedStorageKey(BUILDING_FOCUS_STORAGE_KEY, clientId);
}

export function persistBuildingFocus(clientId: string, building: CrmBuilding, extra?: { floor?: string; suite?: string }) {
  if (typeof window === 'undefined') return;
  const payload: BuildingFocusState = {
    buildingId: asText(building.id),
    buildingName: asText(building.name),
    address: asText(building.address),
    market: asText(building.market),
    submarket: asText(building.submarket),
    floor: asText(extra?.floor),
    suite: asText(extra?.suite),
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(storageKey(clientId), JSON.stringify(payload));
}

export function loadBuildingFocus(clientId: string): BuildingFocusState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(clientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BuildingFocusState> | null;
    if (!parsed || !asText(parsed.buildingId)) return null;
    return {
      buildingId: asText(parsed.buildingId),
      buildingName: asText(parsed.buildingName),
      address: asText(parsed.address),
      market: asText(parsed.market),
      submarket: asText(parsed.submarket),
      floor: asText(parsed.floor),
      suite: asText(parsed.suite),
      updatedAt: asText(parsed.updatedAt) || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearBuildingFocus(clientId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(clientId));
}
