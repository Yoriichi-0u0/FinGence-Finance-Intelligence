export const currency = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  currencyDisplay: "symbol",
  maximumFractionDigits: 0,
});

export const currencyPrecise = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  currencyDisplay: "symbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number, precise = false) {
  return (precise ? currencyPrecise : currency)
    .format(value)
    .replace("MYR", "RM")
    .replace(/\s+/g, " ");
}

export function formatSignedCurrency(value: number) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

export function formatPercent(value: number, signed = false) {
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
