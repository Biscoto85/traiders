import type { StockSummary } from "./stock.js";

// ─── Screener Filter Types ─────────────────────────────

export interface RangeFilter {
  min?: number;  // >= (inclusive)
  max?: number;  // <= (inclusive)
  gt?: number;   // >  (exclusive)
  lt?: number;   // <  (exclusive)
}

export type FilterLogic = "AND" | "OR";

export interface ScreenerFilters {
  // Logic mode: AND = all criteria must match, OR = at least one
  filterLogic?: FilterLogic;

  // Classification
  exchanges?: string[];
  sectors?: string[];
  industries?: string[];
  countries?: string[];

  // Valuation
  peRatio?: RangeFilter;
  forwardPe?: RangeFilter;
  pegRatio?: RangeFilter;
  pbRatio?: RangeFilter;
  psRatio?: RangeFilter;
  evToEbitda?: RangeFilter;
  evToRevenue?: RangeFilter;

  // Size & price
  marketCap?: RangeFilter;
  price?: RangeFilter;
  enterpriseValue?: RangeFilter;

  // Profitability
  grossMargin?: RangeFilter;
  operatingMargin?: RangeFilter;
  netMargin?: RangeFilter;
  roe?: RangeFilter;
  roa?: RangeFilter;

  // Growth
  revenueGrowth?: RangeFilter;
  earningsGrowth?: RangeFilter;

  // Yield & income
  dividendYield?: RangeFilter;
  fcfYield?: RangeFilter;

  // Risk & leverage
  beta?: RangeFilter;
  debtToEquity?: RangeFilter;
  currentRatio?: RangeFilter;

  // 52-week relative
  pctFrom52WeekHigh?: RangeFilter;
  pctFrom52WeekLow?: RangeFilter;

  // Cash-flow & debt metrics
  operatingCashFlow?: RangeFilter;
  priceToOCF?: RangeFilter;
  netDebt?: RangeFilter;
  netDebtToOCF?: RangeFilter;
  equityToMarketCap?: RangeFilter;
  revenueCAGR5Y?: RangeFilter;

  // Quality score
  qualityScore?: RangeFilter;

  // Analyst & ownership
  targetPrice?: RangeFilter;
  pctInsiders?: RangeFilter;
  pctInstitutions?: RangeFilter;
  shortPctFloat?: RangeFilter;
}

// ─── Sort ───────────────────────────────────────────────

export type ScreenerSortField =
  | "ticker"
  | "name"
  | "lastPrice"
  | "marketCap"
  | "peRatio"
  | "forwardPe"
  | "pegRatio"
  | "pbRatio"
  | "psRatio"
  | "evToEbitda"
  | "evToRevenue"
  | "dividendYield"
  | "revenueGrowth"
  | "earningsGrowth"
  | "grossMargin"
  | "operatingMargin"
  | "netMargin"
  | "roe"
  | "roa"
  | "debtToEquity"
  | "currentRatio"
  | "fcfYield"
  | "beta"
  | "volume"
  | "week52High"
  | "week52Low"
  | "pctFrom52WeekHigh"
  | "pctFrom52WeekLow"
  | "operatingCashFlow"
  | "priceToOCF"
  | "netDebt"
  | "netDebtToOCF"
  | "equityToMarketCap"
  | "revenueCAGR5Y"
  | "qualityScore";

export type SortDirection = "asc" | "desc";

export interface ScreenerSort {
  field: ScreenerSortField;
  direction: SortDirection;
}

// ─── Request / Response ─────────────────────────────────

export interface ScreenerRequest {
  filters: ScreenerFilters;
  sort?: ScreenerSort;
  cursor?: string; // opaque cursor for pagination
  limit?: number; // default 50, max 200
}

export interface ScreenerResponse {
  results: StockSummary[];
  totalCount: number;
  nextCursor: string | null;
  appliedFilters: ScreenerFilters;
}
