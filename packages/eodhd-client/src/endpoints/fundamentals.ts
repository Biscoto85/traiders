import type { EODHDClient } from "../client.js";

// ─── EODHD Plan Requirements ────────────────────────────
// Fundamentals (/fundamentals): Fundamentals ($59.99), All-in-One ($99.99)
// NOT available in: All World
// Each request costs 10 API calls.
// ─────────────────────────────────────────────────────────

// ─── EODHD Raw Response Types ───────────────────────────

export interface EODHDFundamentals {
  General: {
    Code: string;
    Type: string;
    Name: string;
    Exchange: string;
    CurrencyCode: string;
    CurrencyName: string;
    CurrencySymbol: string;
    CountryName: string;
    CountryISO: string;
    ISIN: string | null;
    LEI: string | null;
    PrimaryTicker: string | null;
    FiscalYearEnd: string;
    Sector: string;
    Industry: string;
    GicSector: string;
    GicGroup: string;
    GicIndustry: string;
    GicSubIndustry: string;
    Description: string;
    Address: string;
    Phone: string;
    WebURL: string;
    LogoURL: string;
    FullTimeEmployees: number;
    UpdatedAt: string;
  };
  Highlights: {
    MarketCapitalization: number | null;
    MarketCapitalizationMln: string;
    EBITDA: number | null;
    PERatio: number | null;
    PEGRatio: number | null;
    WallStreetTargetPrice: number | null;
    BookValue: number | null;
    DividendShare: number | null;
    DividendYield: number | null;
    EarningsShare: number | null;
    EPSEstimateCurrentYear: number | null;
    EPSEstimateNextYear: number | null;
    EPSEstimateNextQuarter: number | null;
    EPSEstimateCurrentQuarter: number | null;
    MostRecentQuarter: string;
    ProfitMargin: number | null;
    OperatingMarginTTM: number | null;
    ReturnOnAssetsTTM: number | null;
    ReturnOnEquityTTM: number | null;
    RevenueTTM: number | null;
    RevenuePerShareTTM: number | null;
    QuarterlyRevenueGrowthYOY: number | null;
    GrossProfitTTM: number | null;
    DilutedEpsTTM: number | null;
    QuarterlyEarningsGrowthYOY: number | null;
  };
  Valuation: {
    TrailingPE: number | null;
    ForwardPE: number | null;
    PriceSalesTTM: number | null;
    PriceBookMRQ: number | null;
    EnterpriseValue: number | null;
    EnterpriseValueRevenue: number | null;
    EnterpriseValueEbitda: number | null;
  };
  Technicals: {
    Beta: number | null;
    "52WeekHigh": number | null;
    "52WeekLow": number | null;
    "50DayMA": number | null;
    "200DayMA": number | null;
    SharesShort: number | null;
    SharesShortPriorMonth: number | null;
    ShortRatio: number | null;
    ShortPercent: number | null;
  };
  SharesStats: {
    SharesOutstanding: number | null;
    SharesFloat: number | null;
    PercentInsiders: number | null;
    PercentInstitutions: number | null;
    SharesShort: number | null;
    SharesShortPriorMonth: number | null;
    ShortRatio: number | null;
    ShortPercentOutstanding: number | null;
    ShortPercentFloat: number | null;
  };
  Financials: {
    Balance_Sheet: {
      quarterly: Record<string, EODHDBalanceSheet>;
      yearly: Record<string, EODHDBalanceSheet>;
    };
    Income_Statement: {
      quarterly: Record<string, EODHDIncomeStatement>;
      yearly: Record<string, EODHDIncomeStatement>;
    };
    Cash_Flow: {
      quarterly: Record<string, EODHDCashFlow>;
      yearly: Record<string, EODHDCashFlow>;
    };
  };
}

export interface EODHDBalanceSheet {
  date: string;
  filing_date: string | null;
  currency_symbol: string;
  totalAssets: string | null;
  totalCurrentAssets: string | null;
  cashAndShortTermInvestments: string | null;
  totalLiab: string | null;
  totalCurrentLiabilities: string | null;
  longTermDebt: string | null;
  shortLongTermDebt: string | null;
  totalStockholderEquity: string | null;
  [key: string]: string | null;
}

export interface EODHDIncomeStatement {
  date: string;
  filing_date: string | null;
  currency_symbol: string;
  totalRevenue: string | null;
  grossProfit: string | null;
  operatingIncome: string | null;
  netIncome: string | null;
  ebitda: string | null;
  ebit: string | null;
  [key: string]: string | null;
}

export interface EODHDCashFlow {
  date: string;
  filing_date: string | null;
  currency_symbol: string;
  totalCashFromOperatingActivities: string | null;
  capitalExpenditures: string | null;
  freeCashFlow: string | null;
  [key: string]: string | null;
}

export interface EODHDIndexComponent {
  Code: string;
  Exchange: string;
  Name: string;
  Sector: string;
  Industry: string;
}

// ─── Endpoint ───────────────────────────────────────────

export class FundamentalsEndpoint {
  constructor(private client: EODHDClient) {}

  /**
   * Get full fundamentals for a ticker.
   * Note: Consumes 10 API calls per request.
   *
   * @example
   *   await client.fundamentals.get("AAPL", "US");
   */
  async get(
    ticker: string,
    exchange: string,
  ): Promise<EODHDFundamentals> {
    return this.client.fetch<EODHDFundamentals>(
      `/fundamentals/${ticker}.${exchange}`,
    );
  }

  /**
   * Get the constituents of a stock index.
   * Costs 10 API calls per request.
   *
   * @example
   *   await client.fundamentals.getIndexComponents("GSPC"); // S&P 500
   *   await client.fundamentals.getIndexComponents("FCHI"); // CAC 40
   */
  async getIndexComponents(
    indexTicker: string,
  ): Promise<Record<string, EODHDIndexComponent>> {
    // Don't use filter param — EODHD ignores it for index endpoints
    const data = await this.client.fetch<{
      Components?: Record<string, EODHDIndexComponent>;
    }>(`/fundamentals/${indexTicker}.INDX`);
    return data.Components ?? {};
  }

  /**
   * Get only the highlights / summary section.
   * Uses filter parameter to reduce payload size.
   */
  async getHighlights(
    ticker: string,
    exchange: string,
  ): Promise<Pick<EODHDFundamentals, "General" | "Highlights" | "Valuation" | "Technicals">> {
    return this.client.fetch(
      `/fundamentals/${ticker}.${exchange}`,
      { filter: "General,Highlights,Valuation,Technicals" },
    );
  }
}
