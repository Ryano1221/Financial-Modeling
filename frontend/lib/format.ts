export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatNumber(n: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
  }).format(n);
}
