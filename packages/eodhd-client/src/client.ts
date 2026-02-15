import { EODEndpoint } from "./endpoints/eod.js";
import { FundamentalsEndpoint } from "./endpoints/fundamentals.js";
import { BulkEndpoint } from "./endpoints/bulk.js";
import { ScreenerEndpoint } from "./endpoints/screener.js";

// ─── EODHD Raw Response Types ───────────────────────────

export interface EODHDConfig {
  apiKey: string;
  baseUrl?: string;
  /** Max requests per minute (default: 950, safe margin under 1000) */
  rateLimit?: number;
  /** Retry count for failed requests (default: 3) */
  retries?: number;
  /** Request timeout in ms (default: 30_000) */
  timeout?: number;
}

export interface RateLimitState {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per ms
}

// ─── Client ─────────────────────────────────────────────

export class EODHDClient {
  readonly config: Required<EODHDConfig>;

  private rateLimit: RateLimitState;

  // Endpoint groups
  readonly eod: EODEndpoint;
  readonly fundamentals: FundamentalsEndpoint;
  readonly bulk: BulkEndpoint;
  readonly screener: ScreenerEndpoint;

  constructor(config: EODHDConfig) {
    this.config = {
      baseUrl: "https://eodhd.com/api",
      rateLimit: 950,
      retries: 3,
      timeout: 30_000,
      ...config,
    };

    // Token bucket rate limiter: refills per minute
    this.rateLimit = {
      tokens: this.config.rateLimit,
      maxTokens: this.config.rateLimit,
      lastRefill: Date.now(),
      refillRate: this.config.rateLimit / 60_000,
    };

    // Initialize endpoint groups
    this.eod = new EODEndpoint(this);
    this.fundamentals = new FundamentalsEndpoint(this);
    this.bulk = new BulkEndpoint(this);
    this.screener = new ScreenerEndpoint(this);
  }

  /**
   * Core HTTP fetch with auth, rate limiting, retry, and error handling.
   */
  async fetch<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    await this.waitForRateLimit();

    const url = this.buildUrl(path, params);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout,
        );

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new EODHDError(
            `EODHD API error ${response.status}: ${body}`,
            response.status,
            path,
          );
        }

        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx client errors (except 429)
        if (
          lastError instanceof EODHDError &&
          lastError.statusCode >= 400 &&
          lastError.statusCode < 500 &&
          lastError.statusCode !== 429
        ) {
          throw lastError;
        }

        // Exponential backoff before retry
        if (attempt < this.config.retries) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000);
          await sleep(delay);
        }
      }
    }

    throw lastError ?? new Error("EODHD request failed");
  }

  /**
   * Build a full URL with auth token and query params.
   */
  private buildUrl(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): URL {
    const url = new URL(`${this.config.baseUrl}${path}`);
    url.searchParams.set("api_token", this.config.apiKey);
    url.searchParams.set("fmt", "json");

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  /**
   * Simple token bucket rate limiter. Waits if no tokens available.
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.rateLimit.lastRefill;
    const refilled = elapsed * this.rateLimit.refillRate;

    this.rateLimit.tokens = Math.min(
      this.rateLimit.maxTokens,
      this.rateLimit.tokens + refilled,
    );
    this.rateLimit.lastRefill = now;

    if (this.rateLimit.tokens < 1) {
      const waitMs = (1 - this.rateLimit.tokens) / this.rateLimit.refillRate;
      await sleep(waitMs);
      this.rateLimit.tokens = 0;
      this.rateLimit.lastRefill = Date.now();
    }

    this.rateLimit.tokens -= 1;
  }
}

// ─── Error class ────────────────────────────────────────

export class EODHDError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "EODHDError";
  }
}

// ─── Helpers ────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
