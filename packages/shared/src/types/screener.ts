import type { StockSummary } from "./stock.js";

// ─── Screener Filter Types ─────────────────────────────

export interface RangeFilter {
  min?: number;
  max?: number;
}

export interface ScreenerFilters {
  // Classification
  exchanges?: string[];
  sectors?: string[];
  industries?: string[];
  countries?: string[];

  // Valorisation
  peRatio?: RangeFilter;
  forwardPe?: RangeFilter;
  pegRatio?: RangeFilter;
  pbRatio?: RangeFilter;
  evToEbitda?: RangeFilter;

  // Taille
  marketCap?: RangeFilter;
  price?: RangeFilter;

  // Profitabilité
  grossMargin?: RangeFilter;
  operatingMargin?: RangeFilter;
  netMargin?: RangeFilter;
  roe?: RangeFilter;

  // Croissance
  revenueGrowth?: RangeFilter;

  // Dividende
  dividendYield?: RangeFilter;

  // Risque
  beta?: RangeFilter;
  debtToEquity?: RangeFilter;

  // Prix relatif
  pctFrom52WeekHigh?: RangeFilter;
  pctFrom52WeekLow?: RangeFilter;
}

// ─── Sort ───────────────────────────────────────────────

export type ScreenerSortField =
  | "ticker"
  | "name"
  | "lastPrice"
  | "marketCap"
  | "peRatio"
  | "dividendYield"
  | "revenueGrowth"
  | "volume"
  | "week52High"
  | "week52Low";

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
