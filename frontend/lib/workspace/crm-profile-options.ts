"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWorkspaceCloudSection } from "@/lib/workspace/cloud";
import { CRM_OS_STORAGE_KEY, type CrmCompany, type CrmWorkspaceState } from "@/lib/workspace/crm";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";

export const CRM_PROFILE_STATE_EVENT = "thecremodel:crm-profile-state-updated";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeProfileType(value: unknown): CrmCompany["type"] {
  const raw = asText(value);
  if (
    raw === "prospect"
    || raw === "active_client"
    || raw === "former_client"
    || raw === "landlord"
    || raw === "tenant"
    || raw === "ownership_group"
    || raw === "other"
  ) {
    return raw;
  }
  return "prospect";
}

function parseProfiles(value: unknown): CrmCompany[] {
  const state = value && typeof value === "object" ? (value as Partial<CrmWorkspaceState>) : null;
  if (!Array.isArray(state?.companies)) return [];
  return state.companies
    .map((item) => {
      const company = item as Partial<CrmCompany>;
      const id = asText(company.id);
      const name = asText(company.name);
      if (!id || !name) return null;
      return {
        ...company,
        id,
        name,
        clientId: asText(company.clientId),
        type: normalizeProfileType(company.type),
        industry: asText(company.industry),
        market: asText(company.market),
        submarket: asText(company.submarket),
        buildingId: asText(company.buildingId),
        floor: asText(company.floor),
        suite: asText(company.suite),
        squareFootage: Number(company.squareFootage) || 0,
        currentLeaseExpiration: asText(company.currentLeaseExpiration),
        noticeDeadline: asText(company.noticeDeadline),
        renewalProbability: Number(company.renewalProbability) || 0,
        prospectStatus: asText(company.prospectStatus),
        relationshipOwner: asText(company.relationshipOwner),
        source: asText(company.source),
        notes: asText(company.notes),
        createdAt: asText(company.createdAt),
        updatedAt: asText(company.updatedAt),
        linkedDocumentIds: Array.isArray(company.linkedDocumentIds) ? company.linkedDocumentIds.map(asText).filter(Boolean) : [],
        linkedDealIds: Array.isArray(company.linkedDealIds) ? company.linkedDealIds.map(asText).filter(Boolean) : [],
        linkedObligationIds: Array.isArray(company.linkedObligationIds) ? company.linkedObligationIds.map(asText).filter(Boolean) : [],
        linkedSurveyIds: Array.isArray(company.linkedSurveyIds) ? company.linkedSurveyIds.map(asText).filter(Boolean) : [],
        linkedAnalysisIds: Array.isArray(company.linkedAnalysisIds) ? company.linkedAnalysisIds.map(asText).filter(Boolean) : [],
        linkedLeaseAbstractIds: Array.isArray(company.linkedLeaseAbstractIds) ? company.linkedLeaseAbstractIds.map(asText).filter(Boolean) : [],
        lastTouchDate: asText(company.lastTouchDate),
        nextFollowUpDate: asText(company.nextFollowUpDate),
        landlordName: asText(company.landlordName),
        brokerRelationship: asText(company.brokerRelationship),
      } satisfies CrmCompany;
    })
    .filter((item): item is CrmCompany => Boolean(item))
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
        || left.name.localeCompare(right.name);
    });
}

function profileUpdatedTime(profile: CrmCompany): number {
  const updatedTime = Date.parse(profile.updatedAt || "");
  if (Number.isFinite(updatedTime)) return updatedTime;
  const createdTime = Date.parse(profile.createdAt || "");
  return Number.isFinite(createdTime) ? createdTime : 0;
}

function mergeProfiles(...profileGroups: CrmCompany[][]): CrmCompany[] {
  const byId = new Map<string, CrmCompany>();
  profileGroups.flat().forEach((profile) => {
    const existing = byId.get(profile.id);
    if (!existing || profileUpdatedTime(profile) >= profileUpdatedTime(existing)) {
      byId.set(profile.id, profile);
    }
  });
  return Array.from(byId.values()).sort((left, right) => {
    return profileUpdatedTime(right) - profileUpdatedTime(left) || left.name.localeCompare(right.name);
  });
}

function readLocalProfiles(storageKey: string): CrmCompany[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    return parseProfiles(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

export function useCrmProfileOptions(clientId: string | null | undefined, enabled = true): CrmCompany[] {
  const storageKey = makeClientScopedStorageKey(CRM_OS_STORAGE_KEY, clientId || "guest");
  const [profiles, setProfiles] = useState<CrmCompany[]>([]);

  const refreshProfiles = useCallback(() => {
    if (!enabled || !asText(clientId)) {
      setProfiles([]);
      return;
    }
    const localProfiles = readLocalProfiles(storageKey);
    setProfiles(localProfiles);
    void fetchWorkspaceCloudSection(storageKey)
      .then((remote) => {
        const remoteProfiles = parseProfiles(remote.value);
        setProfiles((currentProfiles) => mergeProfiles(localProfiles, currentProfiles, remoteProfiles));
      })
      .catch(() => undefined);
  }, [clientId, enabled, storageKey]);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== storageKey) return;
      refreshProfiles();
    };
    const handleCustom = () => refreshProfiles();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(CRM_PROFILE_STATE_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CRM_PROFILE_STATE_EVENT, handleCustom);
    };
  }, [refreshProfiles, storageKey]);

  return profiles;
}
