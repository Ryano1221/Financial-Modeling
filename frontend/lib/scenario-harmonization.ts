import type { ScenarioWithId } from "@/lib/types";
import { hasCommencementBeforeToday } from "@/lib/remaining-obligation";

function normalizeKeyPart(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function portfolioMatchKey(s: ScenarioWithId): string {
  const building = normalizeKeyPart(s.building_name || "");
  const address = normalizeKeyPart(s.address || "");
  return building || address;
}

function hasMeaningfulCommencedSource(s: ScenarioWithId, now: Date): boolean {
  if (!s.original_extracted_lease) return false;
  const sourceCommencement = String(s.original_extracted_lease.commencement || s.commencement || "");
  return hasCommencementBeforeToday(sourceCommencement, now);
}

function isLikelyPlaceholderOpex(s: ScenarioWithId): boolean {
  const base = Number(s.base_opex_psf_yr || 0);
  const baseYear = Number(s.base_year_opex_psf_yr || 0);
  const hasCalendar = Boolean(s.opex_by_calendar_year && Object.keys(s.opex_by_calendar_year).length > 0);
  if (hasCalendar) return false;
  return base > 0 && base <= 10.01 && baseYear >= 0 && baseYear <= 10.01;
}

function pickPeerSuite(peers: ScenarioWithId[]): string {
  const suites = peers
    .map((peer) => String(peer.suite || "").trim())
    .filter((suite) => suite.length > 0);
  return suites[0] || "";
}

function pickPeerOpex(peers: ScenarioWithId[]): number | null {
  const candidates = peers
    .map((peer) => Number(peer.base_opex_psf_yr || 0))
    .filter((value) => Number.isFinite(value) && value > 10.01);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a - b);
  const mid = Math.floor(candidates.length / 2);
  return candidates[mid] ?? candidates[0] ?? null;
}

export function harmonizeExtractedScenarios(
  scenarios: ScenarioWithId[],
  now: Date = new Date()
): ScenarioWithId[] {
  if (!Array.isArray(scenarios) || scenarios.length < 2) return scenarios;
  const byKey = new Map<string, ScenarioWithId[]>();
  scenarios.forEach((scenario) => {
    const key = portfolioMatchKey(scenario);
    if (!key) return;
    const bucket = byKey.get(key) ?? [];
    bucket.push(scenario);
    byKey.set(key, bucket);
  });

  return scenarios.map((scenario) => {
    const key = portfolioMatchKey(scenario);
    if (!key) return scenario;
    if (!hasMeaningfulCommencedSource(scenario, now)) return scenario;

    const peers = (byKey.get(key) ?? []).filter((peer) => peer.id !== scenario.id);
    if (peers.length === 0) return scenario;

    const next: ScenarioWithId = { ...scenario };
    let changed = false;

    if (!String(next.suite || "").trim()) {
      const peerSuite = pickPeerSuite(peers);
      if (peerSuite) {
        next.suite = peerSuite;
        changed = true;
      }
    }

    if (isLikelyPlaceholderOpex(next)) {
      const peerOpex = pickPeerOpex(peers);
      if (peerOpex && peerOpex > 0) {
        next.base_opex_psf_yr = peerOpex;
        next.base_year_opex_psf_yr = peerOpex;
        changed = true;
      }
    }

    return changed ? next : scenario;
  });
}

