import type { EODHDClient } from "../client.js";

// ─── EODHD Raw Response Types ───────────────────────────

export interface EODHDEodBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
}

export interface EODHDExchangeSymbol {
  Code: string;
  Name: string;
  Country: string;
  Exchange: string;
  Currency: string;
  Type: string;
  Isin: string | null;
}

// ─── Endpoint ───────────────────────────────────────────

export class EODEndpoint {
  constructor(private client: EODHDClient) {}

  /**
   * Get historical EOD prices for a ticker.
   *
   * @example
   *   await client.eod.getHistory("AAPL", "US", { from: "2024-01-01" });
   */
  async getHistory(
    ticker: string,
    exchange: string,
    options: {
      from?: string;
      to?: string;
      period?: "d" | "w" | "m"; // daily, weekly, monthly
      order?: "a" | "d"; // ascending / descending
    } = {},
  ): Promise<EODHDEodBar[]> {
    return this.client.fetch<EODHDEodBar[]>(
      `/eod/${ticker}.${exchange}`,
      {
        from: options.from,
        to: options.to,
        period: options.period ?? "d",
        order: options.order ?? "a",
      },
    );
  }

  /**
   * Get the list of all symbols for an exchange.
   *
   * @example
   *   await client.eod.getExchangeSymbols("US"); // All US stocks
   *   await client.eod.getExchangeSymbols("PA"); // Euronext Paris
   */
  async getExchangeSymbols(
    exchange: string,
  ): Promise<EODHDExchangeSymbol[]> {
    return this.client.fetch<EODHDExchangeSymbol[]>(
      `/exchange-symbol-list/${exchange}`,
    );
  }

  /**
   * Get all available exchanges.
   */
  async getExchangesList(): Promise<
    Array<{
      Name: string;
      Code: string;
      OperatingMIC: string;
      Country: string;
      Currency: string;
      CountryISO2: string;
      CountryISO3: string;
    }>
  > {
    return this.client.fetch(`/exchanges-list`);
  }
}
