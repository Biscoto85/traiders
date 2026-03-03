import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

/**
 * SYNC_MODE controls which EODHD endpoints are used:
 *
 *  "daily" → All World plan ($19.99/mo)
 *    - sync-eod (Bulk EOD) + sync-tickers (Exchange lists) only
 *    - sync-fundamentals is SKIPPED
 *
 *  "full"  → All-in-One plan ($99.99/mo)
 *    - All syncs enabled, including fundamentals
 *
 * The mode can be overridden at runtime via the SystemConfig DB table
 * (key: "SYNC_MODE"), changeable from the admin UI.
 * Env var is used as fallback when no DB entry exists.
 */
export type SyncMode = "daily" | "full";

export const config = {
  db: {
    url: requireEnv("DATABASE_URL"),
  },

  eodhd: {
    apiKey: requireEnv("EODHD_API_KEY"),
    baseUrl: optionalEnv("EODHD_BASE_URL", "https://eodhd.com/api"),
  },

  /** Default sync mode from env. Overridden by DB SystemConfig at runtime. */
  defaultSyncMode: (optionalEnv("SYNC_MODE", "daily") as SyncMode),

  cron: {
    syncEod: optionalEnv("SYNC_EOD_CRON", "0 22 * * 1-5"),
    syncFundamentals: optionalEnv("SYNC_FUNDAMENTALS_CRON", "0 6 * * 6"),
    syncTickers: optionalEnv("SYNC_TICKERS_CRON", "0 3 1 * *"),
    emailDigestWeekly: optionalEnv("EMAIL_DIGEST_WEEKLY_CRON", "0 8 * * 1"), // Monday 8am
  },

  /** Exchanges to sync. Add more as needed. */
  exchanges: optionalEnv("SYNC_EXCHANGES", "US").split(","),

  sync: {
    /** Skip stocks with known marketCap below this threshold (saves 10 API calls each). */
    minMarketCap: parseInt(optionalEnv("SYNC_MIN_MARKET_CAP", "50000000"), 10),
    /** Max API calls per fundamentals run. EODHD limit is 100K/day — keep margin. */
    maxApiCalls: parseInt(optionalEnv("SYNC_MAX_API_CALLS", "90000"), 10),
  },

  appUrl: optionalEnv("WEB_URL", "http://localhost:5173"),

  smtp: {
    host: optionalEnv("SMTP_HOST", ""),
    port: parseInt(optionalEnv("SMTP_PORT", "587"), 10),
    secure: optionalEnv("SMTP_SECURE", "false") === "true",
    user: optionalEnv("SMTP_USER", ""),
    pass: optionalEnv("SMTP_PASS", ""),
    from: optionalEnv("SMTP_FROM", "traiders@example.com"),
  },

  log: {
    level: optionalEnv("LOG_LEVEL", "info"),
  },
} as const;
