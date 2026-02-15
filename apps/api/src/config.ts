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
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  isDev: optionalEnv("NODE_ENV", "development") === "development",

  api: {
    port: parseInt(optionalEnv("API_PORT", "4000"), 10),
    host: optionalEnv("API_HOST", "0.0.0.0"),
  },

  db: {
    url: requireEnv("DATABASE_URL"),
  },

  eodhd: {
    apiKey: requireEnv("EODHD_API_KEY"),
    baseUrl: optionalEnv("EODHD_BASE_URL", "https://eodhd.com/api"),
  },

  cors: {
    origin: optionalEnv("WEB_URL", "http://localhost:3000"),
  },

  log: {
    level: optionalEnv("LOG_LEVEL", "info"),
  },
} as const;

export type Config = typeof config;
