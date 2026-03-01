import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  ScreenerFilters,
  ScreenerSort,
  RangeFilter,
} from "@stock-screener/shared";

interface ScreenerQueryResult {
  where: Prisma.StockWhereInput;
  orderBy: Prisma.StockOrderByWithRelationInput;
}

/**
 * Builds a Prisma WHERE clause from screener filters.
 * Operates on denormalized Stock fields for single-table performance.
 */
export function buildScreenerQuery(
  filters: ScreenerFilters,
  sort?: ScreenerSort,
  tickerStartsWith?: string,
): ScreenerQueryResult {
  const where: Prisma.StockWhereInput = {
    isActive: true,
  };

  // ── Ticker letter filter ──
  if (tickerStartsWith) {
    where.ticker = { startsWith: tickerStartsWith.toUpperCase() };
  }

  // ── Classification filters ──
  if (filters.exchanges?.length) {
    where.exchangeId = { in: filters.exchanges };
  }
  if (filters.sectors?.length) {
    where.sector = { in: filters.sectors };
  }
  if (filters.industries?.length) {
    where.industry = { in: filters.industries };
  }
  if (filters.countries?.length) {
    where.exchange = { country: { in: filters.countries } };
  }

  // ── Range filters (map to Prisma gte/lte) ──
  const rangeMap: Array<[keyof ScreenerFilters, keyof Prisma.StockWhereInput]> = [
    // Valuation
    ["peRatio", "peRatio"],
    ["forwardPe", "forwardPe"],
    ["pegRatio", "pegRatio"],
    ["pbRatio", "pbRatio"],
    ["psRatio", "psRatio"],
    ["evToEbitda", "evToEbitda"],
    ["evToRevenue", "evToRevenue"],
    // Size & price
    ["marketCap", "marketCap"],
    ["price", "lastPrice"],
    ["enterpriseValue", "enterpriseValue"],
    // Profitability
    ["grossMargin", "grossMargin"],
    ["operatingMargin", "operatingMargin"],
    ["netMargin", "netMargin"],
    ["roe", "roe"],
    ["roa", "roa"],
    // Growth
    ["revenueGrowth", "revenueGrowth"],
    ["earningsGrowth", "earningsGrowth"],
    // Yield & income
    ["dividendYield", "dividendYield"],
    ["fcfYield", "fcfYield"],
    // Risk & leverage
    ["beta", "beta"],
    ["debtToEquity", "debtToEquity"],
    ["currentRatio", "currentRatio"],
    // 52-week relative
    ["pctFrom52WeekHigh", "pctFrom52WeekHigh"],
    ["pctFrom52WeekLow", "pctFrom52WeekLow"],
    // Analyst & ownership
    ["targetPrice", "targetPrice"],
    ["pctInsiders", "pctInsiders"],
    ["pctInstitutions", "pctInstitutions"],
    ["shortPctFloat", "shortPctFloat"],
  ];

  for (const [filterKey, dbField] of rangeMap) {
    const range = filters[filterKey] as RangeFilter | undefined;
    if (range) {
      const condition: Prisma.FloatNullableFilter = {};
      if (range.min !== undefined) condition.gte = range.min;
      if (range.max !== undefined) condition.lte = range.max;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (where as any)[dbField] = condition;
    }
  }

  // ── Sort ──
  const sortField = sort?.field ?? "marketCap";
  const sortDir = sort?.direction ?? "desc";

  const fieldMapping: Record<string, string> = {
    ticker: "ticker",
    name: "name",
    lastPrice: "lastPrice",
    marketCap: "marketCap",
    peRatio: "peRatio",
    forwardPe: "forwardPe",
    pegRatio: "pegRatio",
    pbRatio: "pbRatio",
    psRatio: "psRatio",
    evToEbitda: "evToEbitda",
    evToRevenue: "evToRevenue",
    dividendYield: "dividendYield",
    revenueGrowth: "revenueGrowth",
    earningsGrowth: "earningsGrowth",
    grossMargin: "grossMargin",
    operatingMargin: "operatingMargin",
    netMargin: "netMargin",
    roe: "roe",
    roa: "roa",
    debtToEquity: "debtToEquity",
    currentRatio: "currentRatio",
    fcfYield: "fcfYield",
    beta: "beta",
    volume: "lastVolume",
    week52High: "week52High",
    week52Low: "week52Low",
    pctFrom52WeekHigh: "pctFrom52WeekHigh",
    pctFrom52WeekLow: "pctFrom52WeekLow",
  };

  const orderByField = fieldMapping[sortField] ?? "marketCap";
  const orderBy = { [orderByField]: sortDir } as Prisma.StockOrderByWithRelationInput;

  return { where, orderBy };
}

const SCREENER_SELECT = {
  id: true,
  ticker: true,
  exchangeId: true,
  name: true,
  sector: true,
  industry: true,
  currency: true,
  isActive: true,
  lastPrice: true,
  lastVolume: true,
  marketCap: true,
  peRatio: true,
  forwardPe: true,
  pegRatio: true,
  eps: true,
  dilutedEps: true,
  dividendYield: true,
  revenueGrowth: true,
  earningsGrowth: true,
  grossMargin: true,
  operatingMargin: true,
  netMargin: true,
  roe: true,
  roa: true,
  debtToEquity: true,
  currentRatio: true,
  beta: true,
  week52High: true,
  week52Low: true,
  pctFrom52WeekHigh: true,
  pctFrom52WeekLow: true,
  evToEbitda: true,
  evToRevenue: true,
  pbRatio: true,
  psRatio: true,
  fcfYield: true,
  targetPrice: true,
  priceUpdatedAt: true,
} as const;

/**
 * Execute screener query with cursor or offset-based pagination.
 */
export async function executeScreenerQuery(
  prisma: PrismaClient,
  filters: ScreenerFilters,
  sort?: ScreenerSort,
  cursor?: string,
  limit = 50,
  offset?: number,
  tickerStartsWith?: string,
) {
  const { where, orderBy } = buildScreenerQuery(filters, sort, tickerStartsWith);

  // Determine pagination strategy
  const useOffset = offset !== undefined && offset >= 0;

  const [totalCount, results] = await Promise.all([
    prisma.stock.count({ where }),
    prisma.stock.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(useOffset
        ? { skip: offset }
        : cursor
          ? { cursor: { id: cursor }, skip: 1 }
          : {}),
      select: SCREENER_SELECT,
    }),
  ]);

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return {
    results: items,
    totalCount,
    nextCursor,
  };
}
