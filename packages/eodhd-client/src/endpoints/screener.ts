import type { EODHDClient } from "../client.js";

// ─── EODHD Raw Response Types ───────────────────────────

export interface EODHDScreenerResult {
  code: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  market_capitalization: number | null;
  earnings_share: number | null;
  dividend_yield: number | null;
  refund_1d_p: number | null;
}

export interface EODHDScreenerFilters {
  market_capitalization_more_than?: number;
  market_capitalization_less_than?: number;
  earnings_share_more_than?: number;
  earnings_share_less_than?: number;
  dividend_yield_more_than?: number;
  dividend_yield_less_than?: number;
  sector?: string;
  industry?: string;
  exchange?: string;
}

// ─── Endpoint ───────────────────────────────────────────

export class ScreenerEndpoint {
  constructor(private client: EODHDClient) {}

  /**
   * Use EODHD's server-side screener endpoint.
   *
   * Note: This endpoint is useful for initial filtering,
   * but for our app we primarily screen from our local DB
   * for more flexibility and speed.
   *
   * @example
   *   await client.screener.search({
   *     market_capitalization_more_than: 1_000_000_000,
   *     sector: "Technology",
   *   });
   */
  async search(
    filters: EODHDScreenerFilters,
    options: {
      limit?: number;
      offset?: number;
      sort?: string; // e.g. "market_capitalization.desc"
    } = {},
  ): Promise<EODHDScreenerResult[]> {
    const params: Record<string, string | number | undefined> = {
      ...this.flattenFilters(filters),
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    };

    if (options.sort) {
      params.sort = options.sort;
    }

    return this.client.fetch<EODHDScreenerResult[]>(`/screener`, params);
  }

  private flattenFilters(
    filters: EODHDScreenerFilters,
  ): Record<string, string | number | undefined> {
    const result: Record<string, string | number | undefined> = {};

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }

    return result;
  }
}
