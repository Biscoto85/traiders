import type { EODHDClient } from "../client.js";

// ─── EODHD Raw Response Types ───────────────────────────

export interface EODHDBulkEodItem {
  code: string;
  exchange_short_name: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
}

// ─── Endpoint ───────────────────────────────────────────

export class BulkEndpoint {
  constructor(private client: EODHDClient) {}

  /**
   * Get EOD prices for ALL tickers on an exchange in a single request.
   * This is the most efficient way to sync daily prices.
   *
   * Returns data for the last trading day by default,
   * or a specific date if provided.
   *
   * @example
   *   // Last trading day, all US stocks
   *   await client.bulk.getEod("US");
   *
   *   // Specific date
   *   await client.bulk.getEod("US", { date: "2024-06-15" });
   *
   *   // Filter by type
   *   await client.bulk.getEod("US", { type: "stock" });
   */
  async getEod(
    exchange: string,
    options: {
      date?: string;
      symbols?: string[]; // optional: filter to specific tickers
      type?: "stock" | "etf" | "fund";
    } = {},
  ): Promise<EODHDBulkEodItem[]> {
    const params: Record<string, string | undefined> = {
      date: options.date,
      type: options.type,
    };

    if (options.symbols?.length) {
      params.symbols = options.symbols.join(",");
    }

    return this.client.fetch<EODHDBulkEodItem[]>(
      `/eod-bulk-last-day/${exchange}`,
      params,
    );
  }

  /**
   * Get extended bulk data including some fundamental fields.
   * Only available for US exchanges.
   */
  async getExtended(
    exchange: string,
    options: {
      date?: string;
      symbols?: string[];
    } = {},
  ): Promise<
    Array<
      EODHDBulkEodItem & {
        ema_50d: number | null;
        ema_200d: number | null;
        avgvol_14d: number | null;
        avgvol_50d: number | null;
        avgvol_200d: number | null;
      }
    >
  > {
    const params: Record<string, string | undefined> = {
      date: options.date,
      type: "extended",
    };

    if (options.symbols?.length) {
      params.symbols = options.symbols.join(",");
    }

    return this.client.fetch(`/eod-bulk-last-day/${exchange}`, params);
  }
}
