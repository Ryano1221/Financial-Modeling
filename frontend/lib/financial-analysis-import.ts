import type { ScenarioWithId } from "@/lib/types";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";

function cleanText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function sourceToken(scenario: ScenarioWithId): string {
  return cleanText(scenario.source_document_id) || cleanText(scenario.source_document_name);
}

function optionToken(name: unknown): string {
  const normalized = cleanText(name);
  const match = normalized.match(/\boption\s*(a|b|1|2|one|two)\b/);
  return match ? match[0] : "";
}

function scenarioImportSignature(scenario: ScenarioWithId): string {
  return [
    sourceToken(scenario),
    optionToken(scenario.name),
    cleanText(scenario.building_name),
    cleanText(scenario.address),
    cleanText(scenario.suite),
    cleanText(scenario.floor),
    cleanText(scenario.commencement),
    cleanText(scenario.expiration),
    cleanText(scenario.document_type_detected),
  ].join("|");
}

export function mergeImportedFinancialAnalysisScenario(
  existing: ScenarioWithId[],
  incoming: ScenarioWithId,
): ScenarioWithId[] {
  const incomingSource = sourceToken(incoming);
  const incomingSignature = scenarioImportSignature(incoming);
  if (!incomingSource) return [...existing, incoming];

  const filtered = existing.filter((scenario) => {
    const existingSource = sourceToken(scenario);
    if (!existingSource || existingSource !== incomingSource) return true;
    return scenarioImportSignature(scenario) !== incomingSignature;
  });
  return [...filtered, incoming];
}

function documentIdentity(document: Pick<ClientWorkspaceDocument, "id">): string {
  return cleanText(document.id);
}

export function upsertRegisteredDocument(
  existing: ClientWorkspaceDocument[],
  incoming: ClientWorkspaceDocument,
): ClientWorkspaceDocument[] {
  const incomingIdentity = documentIdentity(incoming);
  const filtered = existing.filter((document) => documentIdentity(document) !== incomingIdentity);
  return [incoming, ...filtered];
}
