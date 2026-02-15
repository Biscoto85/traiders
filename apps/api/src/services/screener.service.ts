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
): ScreenerQueryResult {
  const where: Prisma.StockWhereInput = {
    isActive: true,
  };

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

  // ── Range filters (map to Prisma gte/lte) ──
  const rangeMap: Array<[keyof ScreenerFilters, keyof Prisma.StockWhereInput]> = [
    ["peRatio", "peRatio"],
    ["forwardPe", "forwardPe"],
    ["pegRatio", "pegRatio"],
    ["pbRatio", "pbRatio"],
    ["evToEbitda", "evToEbitda"],
    ["marketCap", "marketCap"],
    ["price", "lastPrice"],
    ["grossMargin", "grossMargin"],
    ["operatingMargin", "operatingMargin"],
    ["netMargin", "netMargin"],
    ["roe", "roe"],
    ["revenueGrowth", "revenueGrowth"],
    ["dividendYield", "dividendYield"],
    ["beta", "beta"],
    ["debtToEquity", "debtToEquity"],
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

  // ── 52-week relative filters (computed) ──
  // These require lastPrice + week52High/Low to be present
  // We handle them as AND conditions
  if (filters.pctFrom52WeekHigh) {
    // pctFrom52WeekHigh = (lastPrice - week52High) / week52High
    // This requires raw SQL, we'll add as a post-filter or use Prisma raw
    // For MVP, we skip these computed filters and add them later
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
    dividendYield: "dividendYield",
    revenueGrowth: "revenueGrowth",
    volume: "lastVolume",
    week52High: "week52High",
    week52Low: "week52Low",
  };

  const orderByField = fieldMapping[sortField] ?? "marketCap";
  const orderBy = { [orderByField]: sortDir } as Prisma.StockOrderByWithRelationInput;

  return { where, orderBy };
}

/**
 * Execute screener query with cursor-based pagination.
 */
export async function executeScreenerQuery(
  prisma: PrismaClient,
  filters: ScreenerFilters,
  sort?: ScreenerSort,
  cursor?: string,
  limit = 50,
) {
  const { where, orderBy } = buildScreenerQuery(filters, sort);

  const [totalCount, results] = await Promise.all([
    prisma.stock.count({ where }),
    prisma.stock.findMany({
      where,
      orderBy,
      take: limit + 1, // fetch one extra to determine if there's a next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
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
        dividendYield: true,
        revenueGrowth: true,
        grossMargin: true,
        operatingMargin: true,
        netMargin: true,
        roe: true,
        debtToEquity: true,
        beta: true,
        week52High: true,
        week52Low: true,
        evToEbitda: true,
        pbRatio: true,
        priceUpdatedAt: true,
      },
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
