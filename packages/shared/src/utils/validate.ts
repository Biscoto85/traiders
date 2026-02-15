import { z } from "zod";

// ─── Primitives ─────────────────────────────────────────

export const rangeFilterSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
}).refine(
  (data) => {
    if (data.min !== undefined && data.max !== undefined) {
      return data.min <= data.max;
    }
    return true;
  },
  { message: "min must be less than or equal to max" }
);

// ─── Screener ───────────────────────────────────────────

export const screenerSortFieldSchema = z.enum([
  "ticker",
  "name",
  "lastPrice",
  "marketCap",
  "peRatio",
  "dividendYield",
  "revenueGrowth",
  "volume",
  "week52High",
  "week52Low",
]);

export const sortDirectionSchema = z.enum(["asc", "desc"]);

export const screenerSortSchema = z.object({
  field: screenerSortFieldSchema,
  direction: sortDirectionSchema,
});

export const screenerFiltersSchema = z.object({
  exchanges: z.array(z.string().min(1).max(10)).optional(),
  sectors: z.array(z.string().min(1).max(100)).optional(),
  industries: z.array(z.string().min(1).max(100)).optional(),
  countries: z.array(z.string().min(1).max(5)).optional(),

  peRatio: rangeFilterSchema.optional(),
  forwardPe: rangeFilterSchema.optional(),
  pegRatio: rangeFilterSchema.optional(),
  pbRatio: rangeFilterSchema.optional(),
  evToEbitda: rangeFilterSchema.optional(),

  marketCap: rangeFilterSchema.optional(),
  price: rangeFilterSchema.optional(),

  grossMargin: rangeFilterSchema.optional(),
  operatingMargin: rangeFilterSchema.optional(),
  netMargin: rangeFilterSchema.optional(),
  roe: rangeFilterSchema.optional(),

  revenueGrowth: rangeFilterSchema.optional(),
  dividendYield: rangeFilterSchema.optional(),

  beta: rangeFilterSchema.optional(),
  debtToEquity: rangeFilterSchema.optional(),

  pctFrom52WeekHigh: rangeFilterSchema.optional(),
  pctFrom52WeekLow: rangeFilterSchema.optional(),
});

export const screenerRequestSchema = z.object({
  filters: screenerFiltersSchema,
  sort: screenerSortSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// ─── Stock params ───────────────────────────────────────

export const tickerParamSchema = z.object({
  ticker: z.string().min(1).max(20).regex(/^[A-Z0-9.-]+$/i, "Invalid ticker format"),
  exchange: z.string().min(1).max(10).optional(),
});

export const priceHistoryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format").optional(),
  period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
});

// ─── Type inference helpers ─────────────────────────────

export type ScreenerFiltersInput = z.infer<typeof screenerFiltersSchema>;
export type ScreenerRequestInput = z.infer<typeof screenerRequestSchema>;
export type TickerParamInput = z.infer<typeof tickerParamSchema>;
export type PriceHistoryQueryInput = z.infer<typeof priceHistoryQuerySchema>;
