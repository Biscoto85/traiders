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

export const config = {
  db: {
    url: requireEnv("DATABASE_URL"),
  },

  eodhd: {
    apiKey: requireEnv("EODHD_API_KEY"),
    baseUrl: optionalEnv("EODHD_BASE_URL", "https://eodhd.com/api"),
  },

  cron: {
    syncEod: optionalEnv("SYNC_EOD_CRON", "0 22 * * 1-5"),
    syncFundamentals: optionalEnv("SYNC_FUNDAMENTALS_CRON", "0 6 * * 6"),
    syncTickers: optionalEnv("SYNC_TICKERS_CRON", "0 3 1 * *"),
    emailDigestWeekly: optionalEnv("EMAIL_DIGEST_WEEKLY_CRON", "0 8 * * 1"), // Monday 8am
  },

  /** Exchanges to sync. Add more as needed. */
  exchanges: optionalEnv("SYNC_EXCHANGES", "US").split(","),

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
