// ─── Stock ───────────────────────────────────────────────

export interface StockTicker {
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  industry: string | null;
  currency: string;
  isActive: boolean;
}

export interface StockSummary extends StockTicker {
  lastPrice: number | null;
  lastVolume: number | null;
  marketCap: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  week52High: number | null;
  week52Low: number | null;
  priceUpdatedAt: Date | null;
}

export interface StockDetail extends StockSummary {
  forwardPe: number | null;
  pegRatio: number | null;
  eps: number | null;
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
  beta: number | null;
}

// ─── OHLCV ──────────────────────────────────────────────

export interface OHLCVBar {
  date: string; // ISO date "2024-01-15"
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
}

// ─── Fundamentals ───────────────────────────────────────

export type FundamentalPeriodType = "quarterly" | "annual";

export interface FundamentalPeriod {
  period: string; // "Q1-2024", "FY-2024"
  type: FundamentalPeriodType;
  date: string;

  // Income Statement
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;

  // Balance Sheet
  totalAssets: number | null;
  totalDebt: number | null;
  totalEquity: number | null;
  cashAndEquiv: number | null;

  // Cash Flow
  operatingCF: number | null;
  capex: number | null;
  freeCashFlow: number | null;

  // Ratios
  peRatio: number | null;
  pbRatio: number | null;
  evToEbitda: number | null;
}

// ─── Exchange ───────────────────────────────────────────

export interface Exchange {
  id: string;
  name: string;
  country: string;
  currency: string;
  timezone: string;
}
