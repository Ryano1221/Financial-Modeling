import { formatPercent } from "@/lib/format";

function normalizeDiscountRates(discountRates: number[]): number[] {
  return discountRates.filter((rate) => Number.isFinite(rate) && rate >= 0);
}

function buildDiscountRateAssumption(discountRates: number[]): string {
  const rates = normalizeDiscountRates(discountRates);
  if (rates.length === 0) return "Discount rate assumptions should be reviewed.";
  const unique = Array.from(new Set(rates.map((rate) => rate.toFixed(6)))).map(Number);
  if (unique.length === 1) {
    return `${formatPercent(unique[0], { decimals: 1 })} discount rate is used.`;
  }
  const formattedRates = unique
    .sort((a, b) => a - b)
    .map((rate) => formatPercent(rate, { decimals: 1 }));
  if (formattedRates.length <= 3) {
    return `Scenario-specific discount rates are used (${formattedRates.join(", ")}).`;
  }
  return "Scenario-specific discount rates are used.";
}

export function buildOverarchingAssumptionNotes(discountRates: number[]): string[] {
  return [
    "Gross Rental Rates include all standard operating expenses.",
    "Tenant Improvement Costs shown are assumptions based on the below high-level estimates.",
    "TI out of Pocket is the difference between estimated tenant buildout costs and tenant allowance.",
    "Total Estimated Obligation includes full service rental costs, buildout costs, and parking.",
    "Landlord's Net Effective Return includes total net rent less concession and lease commission.",
    "Numbers are pre-tax dollars and do not take into account depreciation for upfront costs (parking includes sales tax if applicable).",
    buildDiscountRateAssumption(discountRates),
  ];
}
