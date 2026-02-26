/**
 * Excel export: Summary comparison matrix + one sheet per option (inputs + outputs).
 * Classic broker workbook feel.
 */

import ExcelJS from "exceljs";
import {
  formatCurrency,
  formatCurrencyPerSF,
  formatDateISO,
  formatMonths,
  formatNumber,
  formatPercent,
  formatRSF,
} from "@/lib/format";
import type { LeaseScenarioCanonical } from "./canonical-schema";
import type { EngineResult, OptionMetrics } from "./monthly-engine";
import { runMonthlyEngine } from "./monthly-engine";

const SUMMARY_SHEET = "Summary";

function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[/\\?*\[\]]/g, "").trim();
  const base = cleaned || fallback;
  return base.slice(0, 31).trim() || fallback.slice(0, 31);
}

function makeUniqueSheetName(name: string, fallback: string, used: Set<string>): string {
  const base = sanitizeSheetName(name, fallback);
  let attempt = 1;
  while (attempt <= 9999) {
    const suffix = attempt === 1 ? "" : ` (${attempt})`;
    const trimmedBase = base.slice(0, Math.max(1, 31 - suffix.length)).trim();
    const candidate = `${trimmedBase}${suffix}`;
    const key = candidate.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
    attempt += 1;
  }
  const emergency = `${Date.now()}`.slice(-6);
  const fallbackName = sanitizeSheetName(`${fallback}-${emergency}`, fallback);
  used.add(fallbackName.toLowerCase());
  return fallbackName;
}
export const METRIC_LABELS: (keyof OptionMetrics)[] = [
  "buildingName",
  "suiteName",
  "rsf",
  "leaseType",
  "termMonths",
  "commencementDate",
  "expirationDate",
  "baseRentPsfYr",
  "escalationPercent",
  "abatementAmount",
  "abatementType",
  "abatementAppliedWhen",
  "opexPsfYr",
  "opexEscalationPercent",
  "parkingCostPerSpotMonthlyPreTax",
  "parkingSalesTaxPercent",
  "parkingCostPerSpotMonthly",
  "parkingCostMonthly",
  "parkingCostAnnual",
  "tiBudget",
  "tiAllowance",
  "tiOutOfPocket",
  "grossTiOutOfPocket",
  "avgGrossRentPerMonth",
  "avgGrossRentPerYear",
  "avgAllInCostPerMonth",
  "avgAllInCostPerYear",
  "avgCostPsfYr",
  "npvAtDiscount",
  "discountRateUsed",
  "totalObligation",
  "equalizedAvgCostPsfYr",
  "notes",
];

export const METRIC_DISPLAY_NAMES: Record<string, string> = {
  buildingName: "Building name",
  suiteName: "Suite / floor",
  premisesName: "Building + suite/floor",
  rsf: "Rentable square footage",
  leaseType: "Lease type",
  termMonths: "Lease term (months)",
  commencementDate: "Lease commencement date",
  expirationDate: "Lease expiration date",
  baseRentPsfYr: "Base rent ($/SF/yr)",
  escalationPercent: "Rent escalation %",
  abatementAmount: "Abatement amount",
  abatementType: "Abatement type",
  abatementAppliedWhen: "Abatement applied",
  opexPsfYr: "Operating expenses ($/RSF/yr)",
  opexEscalationPercent: "OpEx escalation %",
  parkingCostPerSpotMonthlyPreTax: "Parking cost ($/spot/month, pre-tax)",
  parkingCostPerSpotMonthly: "Parking cost ($/spot/month, after tax)",
  parkingSalesTaxPercent: "Parking sales tax %",
  parkingCostMonthly: "Parking cost (monthly)",
  parkingCostAnnual: "Parking cost (annual)",
  tiBudget: "TI budget ($/SF)",
  tiAllowance: "TI allowance ($/SF)",
  tiOutOfPocket: "TI out of pocket",
  grossTiOutOfPocket: "Gross TI out of pocket",
  avgGrossRentPerMonth: "Avg gross rent/month",
  avgGrossRentPerYear: "Avg gross rent/year",
  avgAllInCostPerMonth: "Avg all-in cost/month",
  avgAllInCostPerYear: "Avg all-in cost/year",
  avgCostPsfYr: "Avg cost/RSF/year",
  npvAtDiscount: "NPV @ discount rate",
  discountRateUsed: "Discount rate used",
  totalObligation: "Total estimated obligation",
  equalizedAvgCostPsfYr: "Equalized avg cost/RSF/yr",
  notes: "Notes",
};

const NOTE_CATEGORY_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "Renewal / extension", regex: /\brenew(al)?\b|\bextend\b/i },
  { label: "ROFR / ROFO", regex: /\brofr\b|\brofo\b|right of first refusal|right of first offer/i },
  { label: "Expansion / contraction", regex: /\bexpansion\b|\bcontraction\b|\bgive[- ]?back\b/i },
  { label: "Termination", regex: /\btermination\b|\bearly termination\b/i },
  { label: "Assignment / sublease", regex: /\bassignment\b|\bsublease\b/i },
  { label: "Operating expenses", regex: /\bopex\b|\boperating expense\b|\bexpense stop\b|\bbase year\b/i },
  { label: "Expense caps / exclusions", regex: /\bcap\b|\bexcluded\b|\bexclusion\b|\bcontrollable\b/i },
  { label: "Parking", regex: /\bparking\b|\bspace(s)?\b|\bratio\b/i },
  { label: "Use / restrictions", regex: /\bpermitted use\b|\buse restriction\b|\bexclusive use\b|\buse shall be\b/i },
  { label: "Holdover", regex: /\bholdover\b/i },
];

const NOTE_PREFIX_PATTERNS: RegExp[] = [
  /^(general)\s*:\s*/i,
  /^(operating expenses?)\s*:\s*/i,
  /^(assignment\s*(?:\/|and)\s*sublease|sublease|assignment)\s*:\s*/i,
  /^(renewal\s*(?:option|\/\s*extension)?|option to renew)\s*:\s*/i,
  /^(parking\s*(?:charges|ratio)?)\s*:\s*/i,
  /^(expense caps?\s*\/\s*exclusions|opex(?:\s+exclusions?)?|audit rights?)\s*:\s*/i,
  /^(right|sublease)\s*:\s*/i,
];

function splitNoteFragments(raw: string): string[] {
  const text = (raw || "").replace(/\r/g, "\n").replace(/\u2022/g, "\n").trim();
  if (!text) return [];
  const normalized = text.replace(/\n{2,}/g, "\n");
  const primary = normalized
    .split(/\s*\|\s*|\n+|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (primary.length > 1) return primary;
  return normalized
    .split(/\.\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripNotePrefixNoise(input: string): string {
  let text = (input || "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i += 1) {
    const before = text;
    for (const pattern of NOTE_PREFIX_PATTERNS) {
      text = text.replace(pattern, "").trim();
    }
    if (text === before) break;
  }
  return text;
}

function isMeaningfulNoteFragment(input: string): boolean {
  const cleaned = stripNotePrefixNoise(input).trim();
  if (!cleaned) return false;
  const low = cleaned.toLowerCase();
  if (["n/a", "na", "none", "null", "-", "--", "general"].includes(low)) return false;
  if (/^\d+(?:\.\d+)?$/.test(low)) return false;
  if (/^[\W_]+$/.test(cleaned)) return false;
  if (!/[a-z]/i.test(cleaned)) return false;
  if (cleaned.length < 8 && !/[a-z]{2,}/i.test(cleaned)) return false;
  return true;
}

function condenseNoteFragment(fragment: string, maxChars = 185): string {
  const cleaned = stripNotePrefixNoise(fragment);
  if (!cleaned) return "";
  const low = cleaned.toLowerCase();

  if (/\bassign|\bsublet|\bsublease/.test(low)) {
    const bits: string[] = [];
    if (low.includes("may not assign") || low.includes("without the prior written consent")) {
      bits.push("requires landlord consent");
    } else {
      bits.push("assignment/sublease rights included");
    }
    if (low.includes("all or any portion")) bits.push("covers all or part of premises");
    if (/\bnot\s+(?:be\s+)?unreasonably\s+withheld\b/i.test(cleaned)) bits.push("consent not unreasonably withheld");
    return bits.join("; ");
  }

  if (/\brenew|\bextension/.test(low)) {
    const optionCountMatch = cleaned.match(/\b(\d{1,2}|one|two|three)\s+(?:option|options)\b/i);
    const rawCount = optionCountMatch?.[1]?.toLowerCase();
    const countMap: Record<string, string> = { one: "1", two: "2", three: "3" };
    const optionCount = rawCount ? (countMap[rawCount] ?? rawCount) : "";
    const monthMatch = cleaned.match(/\b(\d{1,3})\s*(?:months?|mos?)\b/i);
    const yearMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i);
    const details: string[] = [];
    if (optionCount) details.push(`${optionCount} option${optionCount === "1" ? "" : "s"}`);
    if (monthMatch) details.push(`${monthMatch[1]} months`);
    else if (yearMatch) details.push(`${yearMatch[1]} years`);
    if (low.includes("fair market") || low.includes("fmv")) details.push("FMV");
    if (low.includes("arbitration")) details.push("arbitration");
    if (details.length === 0) return "";
    return `Renewal option: ${details.join(", ")}`;
  }

  if (/\bparking|\bpermit/.test(low)) {
    const ratioMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(?:permits?|spaces?|stalls?)?\s*(?:per|\/)\s*1,?000\s*(?:rsf|sf)?\b/i);
    const ratio = ratioMatch ? `${ratioMatch[1]}/1,000 RSF` : "";
    const mustTake = low.includes("must take and pay") ? "must-take-and-pay" : "";
    const convertMatch = cleaned.match(/\bup to\s*(\d{1,3})\s*%[^.]{0,140}\breserved\b/i);
    const convert = convertMatch ? `up to ${convertMatch[1]}% convertible to reserved` : "";
    const parts = [ratio, mustTake, convert].filter(Boolean);
    if (parts.length > 0) return `Parking: ${parts.join(", ")}`;
    return "Parking terms included";
  }

  if (/\bcontrollable\b|\bmanagement\b|\bcap\b/.test(low)) {
    const controllable = cleaned.match(/\b(\d+(?:\.\d+)?)\s*%\b[^.]{0,80}\bcontrollable\b/i);
    const management = cleaned.match(/\b(\d+(?:\.\d+)?)\s*%\b[^.]{0,80}\bmanagement\b/i);
    const parts = [
      controllable ? `${controllable[1]}% controllable-expense cap` : "",
      management ? `${management[1]}% management-fee cap` : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }

  if (cleaned.length <= maxChars) return cleaned;
  const sentences = cleaned
    .split(/(?<=[.!?;:])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length > 0 && sentences[0].length <= maxChars) return sentences[0];
  const wordBudget = Math.max(12, maxChars - 3);
  const words = cleaned.split(/\s+/);
  const compact: string[] = [];
  let length = 0;
  for (const word of words) {
    const delta = word.length + (compact.length > 0 ? 1 : 0);
    if (length + delta > wordBudget) break;
    compact.push(word);
    length += delta;
  }
  return `${compact.join(" ").trim().replace(/[ ,;:.]+$/g, "")}...`;
}

function noteDedupeKey(fragment: string): string {
  const cleaned = stripNotePrefixNoise(fragment).toLowerCase().replace(/\.\.\.$/g, "");
  return cleaned.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 22).join(" ");
}

function classifyNoteCategory(detail: string): string {
  for (const pattern of NOTE_CATEGORY_PATTERNS) {
    if (pattern.regex.test(detail)) return pattern.label;
  }
  return "General";
}

function formatNotesByCategory(raw: string): string {
  const fragments = splitNoteFragments(raw);
  if (fragments.length === 0) return "";
  const grouped = new Map<string, string[]>();
  for (const fragment of fragments) {
    const condensed = condenseNoteFragment(fragment);
    if (!condensed) continue;
    if (!isMeaningfulNoteFragment(condensed)) continue;
    const category = classifyNoteCategory(condensed);
    const existing = grouped.get(category) ?? [];
    const key = noteDedupeKey(condensed);
    if (!existing.some((item) => noteDedupeKey(item) === key)) {
      existing.push(condensed);
      grouped.set(category, existing);
    }
  }
  return Array.from(grouped.entries())
    .flatMap(([category, details]) => details.map((detail) => `• ${category}: ${detail}`))
    .join("\n");
}

export function formatMetricValue(key: string, value: unknown): string {
  if (value == null) return "";
  if (key === "notes") return formatNotesByCategory(String(value));
  if (key === "abatementType" || key === "abatementAppliedWhen") return String(value);
  if (typeof value === "number") {
    if (key === "abatementAmount") return formatCurrency(value);
    if (key === "tiBudget") return formatCurrencyPerSF(value);
    if (key === "tiAllowance") return formatCurrencyPerSF(value);
    if (key === "discountRateUsed") return formatPercent(value, { decimals: 1 });
    if (key === "escalationPercent" || key === "opexEscalationPercent" || key === "parkingSalesTaxPercent") return formatPercent(value);
    if (key === "rsf") return formatRSF(value);
    if (key === "termMonths") return formatMonths(value);
if (key === "commencementDate" || key === "expirationDate") return typeof value === "string" ? formatDateISO(value) : String(value ?? "");
  if (key.includes("Psf") || key.includes("psf")) return formatCurrencyPerSF(value);
    if (key.includes("Cost") || key.includes("Rent") || key.includes("Obligation") || key.includes("Npv") || key.includes("Budget") || key.includes("Allowance") || key.includes("Pocket")) return formatCurrency(value);
    return formatNumber(value);
  }
  if (key === "commencementDate" || key === "expirationDate") return formatDateISO(typeof value === "string" ? value : undefined);
  return String(value);
}


export async function buildWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TheCREmodel";
  workbook.created = new Date();
  const usedSheetNames = new Set<string>();

  const results: EngineResult[] = scenarios.map((s) => runMonthlyEngine(s, globalDiscountRate));

  // ---- Summary sheet: matrix ----
  const summarySheet = workbook.addWorksheet(
    makeUniqueSheetName(SUMMARY_SHEET, SUMMARY_SHEET, usedSheetNames),
    { views: [{ state: "frozen", ySplit: 1 }] }
  );
  summarySheet.getColumn(1).width = 32;
  const headerFont = { bold: true };
  summarySheet.getCell(1, 1).value = "Metric";
  summarySheet.getCell(1, 1).font = headerFont;
  results.forEach((r, i) => {
    const col = i + 2;
    summarySheet.getColumn(col).width = 18;
    summarySheet.getCell(1, col).value = r.scenarioName;
    summarySheet.getCell(1, col).font = headerFont;
  });
  METRIC_LABELS.forEach((key, rowIndex) => {
    const row = rowIndex + 2;
    summarySheet.getCell(row, 1).value = METRIC_DISPLAY_NAMES[key] ?? key;
    results.forEach((res, colIndex) => {
      const val = res.metrics[key];
      summarySheet.getCell(row, colIndex + 2).value = formatMetricValue(key, val);
    });
  });
  const notesRow = METRIC_LABELS.indexOf("notes") + 2;
  if (notesRow >= 2) {
    summarySheet.getRow(notesRow).height = 90;
    for (let col = 2; col <= results.length + 1; col++) {
      summarySheet.getCell(notesRow, col).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    }
  }

  // ---- One sheet per option ----
  for (let idx = 0; idx < scenarios.length; idx++) {
    const scenario = scenarios[idx];
    const result = results[idx];
    const sheetName = makeUniqueSheetName(scenario.name, `Option ${idx + 1}`, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 2 }] });

    let row = 1;

    // Inputs section header
    sheet.getCell(row, 1).value = "INPUTS";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;

    // General inputs block
    sheet.getCell(row, 1).value = "General inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    const generalRows = [
      ["Rentable square footage", scenario.partyAndPremises.rentableSqFt],
      ["Building name", scenario.partyAndPremises.premisesLabel ?? ""],
      ["Suite / floor", scenario.partyAndPremises.floorsOrSuite ?? ""],
      ["Lease type", scenario.expenseSchedule.leaseType],
      ["Lease term (months)", scenario.datesAndTerm.leaseTermMonths],
      ["Commencement date", scenario.datesAndTerm.commencementDate],
      ["Expiration date", scenario.datesAndTerm.expirationDate],
      ["Base rent ($/RSF/yr)", scenario.rentSchedule.steps[0]?.ratePsfYr ?? ""],
      ["Annual base rent escalation %", scenario.rentSchedule.annualEscalationPercent * 100],
      ["Rent abatement months", scenario.rentSchedule.abatement?.months ?? 0],
    ];
    generalRows.forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row++;

    // TI inputs block
    sheet.getCell(row, 1).value = "Tenant improvement inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    const ti = scenario.tiSchedule;
    [
      ["TI budget", ti.budgetTotal],
      ["TI allowance ($/SF)", scenario.partyAndPremises.rentableSqFt > 0 ? ti.allowanceFromLandlord / scenario.partyAndPremises.rentableSqFt : 0],
      ["TI out of pocket", ti.outOfPocket],
      ["Amortize TI", ti.amortizeOop ? "Yes" : "No"],
      ["Amortization rate", ti.amortizationRateAnnual ?? ""],
      ["Amortization term (months)", ti.amortizationTermMonths ?? ""],
    ].forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row++;

    // OpEx block
    sheet.getCell(row, 1).value = "Operating expenses inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    [
      ["Base OpEx ($/RSF/yr)", scenario.expenseSchedule.baseOpexPsfYr],
      ["Annual OpEx escalation %", scenario.expenseSchedule.annualEscalationPercent * 100],
    ].forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row++;

    // Parking block
    sheet.getCell(row, 1).value = "Parking inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    scenario.parkingSchedule.slots.forEach((slot, i) => {
      sheet.getCell(row, 1).value = `${slot.type} spaces (count)`;
      sheet.getCell(row, 2).value = slot.count;
      row++;
      sheet.getCell(row, 1).value = `${slot.type} cost/space/month`;
      sheet.getCell(row, 2).value = slot.costPerSpacePerMonth;
      row++;
    });
    row++;

    // Key metrics output block
    sheet.getCell(row, 1).value = "OUTPUTS — Key metrics";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const m = result.metrics;
    [
      ["NPV @ discount rate", m.npvAtDiscount],
      ["Discount rate used", formatPercent(m.discountRateUsed, { decimals: 1 })],
      ["Total estimated obligation", m.totalObligation],
      ["Avg cost/RSF/year", m.avgCostPsfYr],
      ["Avg monthly cost", m.avgAllInCostPerMonth],
      ["Avg annual cost", m.avgAllInCostPerYear],
      ["Equalized avg cost/RSF/yr", m.equalizedAvgCostPsfYr],
    ].forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row += 2;

    // Annual cash flow table
    sheet.getCell(row, 1).value = "Annual cash flow schedule";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    const annualHeaders = ["Lease year", "Period start", "Period end", "Base rent", "OpEx", "Parking", "TI amort", "Misc", "Total", "Effective $/RSF/yr"];
    annualHeaders.forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true };
    });
    row++;
    result.annual.forEach((yr) => {
      sheet.getCell(row, 1).value = yr.leaseYear;
      sheet.getCell(row, 2).value = yr.periodStart;
      sheet.getCell(row, 3).value = yr.periodEnd;
      sheet.getCell(row, 4).value = yr.baseRent;
      sheet.getCell(row, 5).value = yr.opex;
      sheet.getCell(row, 6).value = yr.parking;
      sheet.getCell(row, 7).value = yr.tiAmortization;
      sheet.getCell(row, 8).value = yr.misc;
      sheet.getCell(row, 9).value = yr.total;
      sheet.getCell(row, 10).value = yr.effectivePsfYr;
      row++;
    });

    // Hidden monthly sheet (as separate sheet, hidden)
    const monthlySheetName = makeUniqueSheetName(`${sheetName}_Monthly`, `Option ${idx + 1}_Monthly`, usedSheetNames);
    const monthlySheet = workbook.addWorksheet(monthlySheetName, { state: "hidden" });
    const monthlyHeaders = ["Month", "Period start", "Period end", "Base rent", "OpEx", "Parking", "TI amort", "Misc", "Total", "Effective $/RSF/yr"];
    monthlyHeaders.forEach((h, c) => {
      monthlySheet.getCell(1, c + 1).value = h;
      monthlySheet.getCell(1, c + 1).font = { bold: true };
    });
    result.monthly.forEach((mo, i) => {
      const r = i + 2;
      monthlySheet.getCell(r, 1).value = mo.monthIndex + 1;
      monthlySheet.getCell(r, 2).value = mo.periodStart;
      monthlySheet.getCell(r, 3).value = mo.periodEnd;
      monthlySheet.getCell(r, 4).value = mo.baseRent;
      monthlySheet.getCell(r, 5).value = mo.opex;
      monthlySheet.getCell(r, 6).value = mo.parking;
      monthlySheet.getCell(r, 7).value = mo.tiAmortization;
      monthlySheet.getCell(r, 8).value = mo.misc;
      monthlySheet.getCell(r, 9).value = mo.total;
      monthlySheet.getCell(r, 10).value = mo.effectivePsfYr;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ExcelJS.Buffer;
}
