/**
 * Format a number as a compact market cap string.
 * e.g. 2_500_000_000 → "2.50B"
 */
export function formatMarketCap(value: number | null | undefined): string {
  if (value == null) return "—";

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

/**
 * Format a number as currency.
 * e.g. 142.56 → "$142.56"
 */
export function formatCurrency(
  value: number | null | undefined,
  currency = "USD",
  locale = "en-US",
): string {
  if (value == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a ratio or percentage.
 * e.g. 0.2534 → "25.34%"
 */
export function formatPercent(
  value: number | null | undefined,
  decimals = 2,
): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a ratio as-is with fixed decimals.
 * e.g. 25.431 → "25.43"
 */
export function formatRatio(
  value: number | null | undefined,
  decimals = 2,
): string {
  if (value == null) return "—";
  return value.toFixed(decimals);
}

/**
 * Format volume with compact notation.
 * e.g. 84_320_000 → "84.32M"
 */
export function formatVolume(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatMarketCap(value); // same logic
}
