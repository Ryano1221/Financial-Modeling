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
  "parkingSpaces",
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
  "commissionPercent",
  "commissionBasis",
  "commissionAmount",
  "netEffectiveRatePsfYr",
  "discountRateUsed",
  "totalObligation",
  "equalizedAvgCostPsfYr",
  "notes",
];

export const METRIC_DISPLAY_NAMES: Record<string, string> = {
  buildingName: "Building Name",
  suiteName: "Suite / Floor",
  premisesName: "Building + Suite/Floor",
  rsf: "Rentable Square Footage",
  leaseType: "Lease Type",
  termMonths: "Lease Term (Months)",
  commencementDate: "Lease Commencement Date",
  expirationDate: "Lease Expiration Date",
  baseRentPsfYr: "Base Rent ($/SF/YR)",
  escalationPercent: "Rent Escalation %",
  abatementAmount: "Abatement Amount",
  abatementType: "Abatement Type",
  abatementAppliedWhen: "Abatement Applied",
  opexPsfYr: "Operating Expenses ($/RSF/YR)",
  opexEscalationPercent: "OpEx Escalation %",
  parkingSpaces: "Parking Spaces",
  parkingCostPerSpotMonthlyPreTax: "Parking Cost ($/Spot/Month, Pre-Tax)",
  parkingCostPerSpotMonthly: "Parking Cost ($/Spot/Month, After Tax)",
  parkingSalesTaxPercent: "Parking Sales Tax %",
  parkingCostMonthly: "Parking Cost (Monthly)",
  parkingCostAnnual: "Parking Cost (Annual)",
  tiBudget: "TI Budget ($/SF)",
  tiAllowance: "TI Allowance ($/SF)",
  tiOutOfPocket: "TI Out of Pocket",
  grossTiOutOfPocket: "Gross TI Out of Pocket",
  avgGrossRentPerMonth: "Avg Gross Rent/Month",
  avgGrossRentPerYear: "Avg Gross Rent/Year",
  avgAllInCostPerMonth: "Avg All-In Cost/Month",
  avgAllInCostPerYear: "Avg All-In Cost/Year",
  avgCostPsfYr: "Avg Cost/RSF/YR",
  npvAtDiscount: "NPV @ Discount Rate",
  commissionPercent: "Commission %",
  commissionBasis: "Commission Basis",
  commissionAmount: "Commission",
  netEffectiveRatePsfYr: "NER (Net Effective Rate)",
  discountRateUsed: "Discount Rate Used",
  totalObligation: "Total Estimated Obligation",
  equalizedAvgCostPsfYr: "Equalized Avg Cost/RSF/YR",
  notes: "Notes",
};

const NOTE_CATEGORY_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "Renewal / extension", regex: /\brenew(al)?\b|\bextend\b/i },
  { label: "ROFR / ROFO", regex: /\brofr\b|\brofo\b|right of first refusal|right of first offer/i },
  { label: "Expansion / contraction", regex: /\bexpansion\b|\bcontraction\b|\bgive[- ]?back\b/i },
  { label: "Termination", regex: /\btermination\b|\bearly termination\b/i },
  { label: "Assignment / sublease", regex: /\bassignment\b|\bsublease\b/i },
  { label: "Operating expenses", regex: /\bopex\b|\boperating expense\b|\bexpense stop\b|\bbase year\b/i },
  { label: "Expense caps / exclusions", regex: /\bcaps?\b|\bexcluded\b|\bexclusions?\b|\bcontrollable\b|\baudit rights?\b|\bmanagement fees?\b/i },
  { label: "Parking", regex: /\bparking\b|\bspace(s)?\b|\bratio\b|\b\d+(?:\.\d+)?\s*\/\s*1,?000\s*(?:rsf|sf)\b/i },
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
  const placeholders = new Set([
    "use",
    "general",
    "parking",
    "renewal",
    "extension",
    "assignment",
    "sublease",
    "opex",
    "operating expenses",
    "audit rights",
  ]);
  if (placeholders.has(low)) return false;
  if (["n/a", "na", "none", "null", "-", "--", "general"].includes(low)) return false;
  if (/^\d+(?:\.\d+)?$/.test(low)) return false;
  if (/^[\W_]+$/.test(cleaned)) return false;
  if (!/[a-z]/i.test(cleaned)) return false;
  if (cleaned.length < 8 && !/[a-z]{2,}/i.test(cleaned)) return false;
  return true;
}

const SIMPLE_NUMBER_WORDS: Record<number, string> = {
  0: "zero",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
  30: "thirty",
  40: "forty",
  50: "fifty",
  60: "sixty",
  70: "seventy",
  80: "eighty",
  90: "ninety",
};

function titleCaseWord(input: string): string {
  return input
    .split(/([-\s])/)
    .map((token) => {
      if (token === "-" || token === " ") return token;
      if (!token) return "";
      return token[0].toUpperCase() + token.slice(1).toLowerCase();
    })
    .join("")
    .trim();
}

function intToWords(num: number): string {
  const n = Math.floor(Math.max(0, num));
  if (Object.prototype.hasOwnProperty.call(SIMPLE_NUMBER_WORDS, n)) return SIMPLE_NUMBER_WORDS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const ones = n % 10;
    const tensWord = SIMPLE_NUMBER_WORDS[tens] ?? "";
    if (ones === 0) return tensWord;
    const onesWord = SIMPLE_NUMBER_WORDS[ones] ?? "";
    return `${tensWord}-${onesWord}`.replace(/^-|-$/g, "");
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rem = n % 100;
    const head = `${SIMPLE_NUMBER_WORDS[hundreds] ?? String(hundreds)} hundred`;
    if (rem === 0) return head;
    return `${head} ${intToWords(rem)}`.trim();
  }
  return String(n);
}

function wordToInt(input: string): number | null {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const token = raw.replace(/_/g, "-").replace(/\s+/g, "-");
  for (const [num, word] of Object.entries(SIMPLE_NUMBER_WORDS)) {
    if (word === token) return Number(num);
  }
  const parts = token.split("-").filter(Boolean);
  if (parts.length === 2) {
    const left = wordToInt(parts[0]);
    const right = wordToInt(parts[1]);
    if (left != null && right != null && left >= 20 && right < 10) return left + right;
  }
  return null;
}

function condenseNoteFragment(fragment: string, maxChars = 185): string {
  const cleaned = stripNotePrefixNoise(fragment);
  if (!cleaned) return "";
  const low = cleaned.toLowerCase();
  if (/\bexpense caps?\/?exclusions?\s+or\s+audit rights included\b/i.test(cleaned)) return "";
  const hasRatioToken = /\b\d+(?:\.\d+)?\s*(?:permits?|spaces?|stalls?)?\s*(?:per|\/)\s*1,?000\s*(?:rsf|sf|square feet)?\b/i.test(cleaned);
  const hasSpaceCountToken = /\b(?:total\s+#?\s*paid\s+spaces?|#?\s*reserved\s+(?:paid\s+)?spaces?|#?\s*unreserved\s+(?:paid\s+)?spaces?|(?:[a-z\-]+\s*\(\d{1,3}\)|\d{1,3})\s+parking\s+spaces?)\b/i.test(cleaned);
  if (hasRatioToken && !hasSpaceCountToken && !/\bparking|\bpermit/.test(low)) return "";

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
    let optionNumber: number | null = null;
    let optionWord = "";
    const optionNumWord = cleaned.match(/\b(\d{1,2})\s*\(\s*([A-Za-z-]+)\s*\)\s+(?:renewal\s+)?(?:option|options)\b/i);
    const optionWordNum = cleaned.match(/\b([A-Za-z-]+)\s*\(\s*(\d{1,2})\s*\)\s+(?:renewal\s+)?(?:option|options)\b/i);
    const optionPlain = cleaned.match(/\b(\d{1,3}|[A-Za-z-]+)\s+(?:renewal\s+)?(?:option|options)\b/i);
    if (optionNumWord) {
      optionNumber = Number(optionNumWord[1]);
      optionWord = titleCaseWord(optionNumWord[2]);
    } else if (optionWordNum) {
      optionNumber = Number(optionWordNum[2]);
      optionWord = titleCaseWord(optionWordNum[1]);
    } else if (optionPlain) {
      optionNumber = /^\d+$/.test(optionPlain[1]) ? Number(optionPlain[1]) : wordToInt(optionPlain[1]);
    }
    if (optionNumber == null && /\brenewal\s+option\b/i.test(cleaned)) optionNumber = 1;

    let durationAmount: number | null = null;
    let durationWord = "";
    let durationUnit = "";
    const yearNumWord = cleaned.match(/\b(\d+(?:\.\d+)?)\s*\(\s*([A-Za-z-]+)\s*\)\s*(years?|yrs?)\b/i);
    const yearWordNum = cleaned.match(/\b([A-Za-z-]+)\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*(years?|yrs?)\b/i);
    const monthNumWord = cleaned.match(/\b(\d{1,3})\s*\(\s*([A-Za-z-]+)\s*\)\s*(months?|mos?)\b/i);
    const monthWordNum = cleaned.match(/\b([A-Za-z-]+)\s*\(\s*(\d{1,3})\s*\)\s*(months?|mos?)\b/i);
    const yearPlain = cleaned.match(/\b(\d{1,3}|[A-Za-z-]+)\s*(years?|yrs?)\b/i);
    const monthPlain = cleaned.match(/\b(\d{1,3}|[A-Za-z-]+)\s*(months?|mos?)\b/i);
    if (yearNumWord) {
      durationAmount = Number(yearNumWord[1]);
      durationWord = titleCaseWord(yearNumWord[2]);
      durationUnit = "years";
    } else if (yearWordNum) {
      durationAmount = Number(yearWordNum[2]);
      durationWord = titleCaseWord(yearWordNum[1]);
      durationUnit = "years";
    } else if (monthNumWord) {
      durationAmount = Number(monthNumWord[1]);
      durationWord = titleCaseWord(monthNumWord[2]);
      durationUnit = "months";
    } else if (monthWordNum) {
      durationAmount = Number(monthWordNum[2]);
      durationWord = titleCaseWord(monthWordNum[1]);
      durationUnit = "months";
    } else if (yearPlain) {
      durationAmount = /^\d+$/.test(yearPlain[1]) ? Number(yearPlain[1]) : wordToInt(yearPlain[1]);
      durationUnit = "years";
    } else if (monthPlain) {
      durationAmount = /^\d+$/.test(monthPlain[1]) ? Number(monthPlain[1]) : wordToInt(monthPlain[1]);
      durationUnit = "months";
    }
    if (durationAmount == null) return "";

    if (!durationWord) durationWord = titleCaseWord(intToWords(durationAmount));
    const durationText = `${durationAmount} (${durationWord || String(durationAmount)}) ${durationUnit}`;

    if (optionNumber == null) optionNumber = 1;
    if (!optionWord) optionWord = titleCaseWord(intToWords(optionNumber));
    const optionText = `${optionNumber} (${optionWord || String(optionNumber)}) renewal option${optionNumber === 1 ? "" : "s"}`;
    const fmvSuffix = low.includes("fair market") || low.includes("fmv") ? " at FMV" : "";
    return `${optionText} for ${durationText}${fmvSuffix}`;
  }

  if (/\bparking|\bpermit/.test(low)) {
    const ratioMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(?:permits?|spaces?|stalls?)?\s*(?:per|\/)\s*1,?000\s*(?:rsf|sf|square feet)?\b/i);
    const totalSpacesMatch = cleaned.match(/\btotal\s+#?\s*paid\s+spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)\b/i);
    const reservedCountMatch = cleaned.match(/\b#?\s*reserved\s+(?:paid\s+)?spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)\b/i);
    const unreservedCountMatch = cleaned.match(/\b#?\s*unreserved\s+(?:paid\s+)?spaces?\b\s*[:\-]?\s*(\d{1,4}(?:\.\d+)?)\b/i);
    const genericCountMatch = cleaned.match(/\b(?:[a-z\-]+\s*\((\d{1,3})\)|(\d{1,3}))\s+parking\s+spaces?\b/i);
    const reservedCount = reservedCountMatch ? Number(reservedCountMatch[1]) : null;
    const unreservedCount = unreservedCountMatch ? Number(unreservedCountMatch[1]) : null;
    let totalSpaces = totalSpacesMatch ? Number(totalSpacesMatch[1]) : null;
    if (totalSpaces == null && (reservedCount != null || unreservedCount != null)) {
      totalSpaces = Math.max(0, Number(reservedCount ?? 0)) + Math.max(0, Number(unreservedCount ?? 0));
    }
    if (totalSpaces == null && genericCountMatch) {
      totalSpaces = Number(genericCountMatch[1] || genericCountMatch[2] || 0);
    }
    let ratioValue = ratioMatch ? Number(ratioMatch[1]) : null;
    if ((ratioValue == null || ratioValue <= 0) && totalSpaces != null && totalSpaces > 0) {
      const rsfMatch = cleaned.match(/\b(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:rsf|rentable\s+square\s+feet|sf)\b/i);
      const rsfValue = rsfMatch ? Number(rsfMatch[1].replace(/,/g, "")) : 0;
      if (rsfValue > 0) ratioValue = (totalSpaces * 1000) / rsfValue;
    }
    const ratio = ratioValue != null && ratioValue > 0 ? `${ratioValue.toFixed(2).replace(/\.?0+$/g, "")}/1,000 RSF` : "";
    const mustTake = /\bmust[-\s]*take(?:[^\n]{0,24}\b(?:and|&)\s*pay|[^\n]{0,40}\bmust[-\s]*pay)\b/i.test(cleaned)
      ? "must-take-and-pay"
      : "";
    const convertMatch = cleaned.match(/\bup to\s*(\d{1,3})\s*%[^.]{0,140}\breserved\b/i);
    const convert = convertMatch ? `up to ${convertMatch[1]}% convertible to reserved` : "";
    const split = reservedCount != null || unreservedCount != null
      ? `reserved ${Math.trunc(Number(reservedCount ?? 0))}, unreserved ${Math.trunc(Number(unreservedCount ?? 0))}`
      : "";
    const parts = [
      totalSpaces != null && totalSpaces > 0 ? `total ${Math.trunc(totalSpaces)} spaces` : "",
      ratio,
      mustTake,
      split,
      convert,
    ].filter(Boolean);
    if (parts.length === 0) return "";
    return parts.join(", ");
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
    if (key === "npvAtDiscount") return formatCurrency(value);
    if (key === "abatementAmount") return formatCurrency(value);
    if (key === "commissionAmount") return formatCurrency(value);
    if (key === "tiBudget") return formatCurrencyPerSF(value);
    if (key === "tiAllowance") return formatCurrencyPerSF(value);
    if (key === "discountRateUsed") return formatPercent(value, { decimals: 1 });
    if (key === "commissionPercent") return formatPercent(value, { decimals: 2 });
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
      ["Commission %", formatPercent(m.commissionPercent / 100, { decimals: 2 })],
      ["Commission basis", m.commissionBasis],
      ["Commission", m.commissionAmount],
      ["NER (Net Effective Rate)", m.netEffectiveRatePsfYr],
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
