import type { PrismaClient } from "@prisma/client";

/**
 * Get a single stock with full detail.
 */
export async function getStockByTicker(
  prisma: PrismaClient,
  ticker: string,
  exchangeId?: string,
) {
  const where = exchangeId
    ? { ticker_exchangeId: { ticker, exchangeId } }
    : undefined;

  if (where) {
    return prisma.stock.findUnique({ where });
  }

  // If no exchange specified, find the first match (prefer US)
  return prisma.stock.findFirst({
    where: { ticker, isActive: true },
    orderBy: { marketCap: "desc" },
  });
}

/**
 * Get price history for a stock.
 */
export async function getStockPriceHistory(
  prisma: PrismaClient,
  stockId: string,
  options: {
    from?: string;
    to?: string;
    limit?: number;
  } = {},
) {
  const where: Record<string, unknown> = { stockId };

  if (options.from || options.to) {
    where.date = {};
    if (options.from) (where.date as Record<string, unknown>).gte = new Date(options.from);
    if (options.to) (where.date as Record<string, unknown>).lte = new Date(options.to);
  }

  return prisma.dailyPrice.findMany({
    where,
    orderBy: { date: "asc" },
    take: options.limit ?? 365,
    select: {
      date: true,
      open: true,
      high: true,
      low: true,
      close: true,
      adjClose: true,
      volume: true,
    },
  });
}

/**
 * Get fundamental history for a stock.
 */
export async function getStockFundamentals(
  prisma: PrismaClient,
  stockId: string,
  type: "quarterly" | "annual" = "quarterly",
  limit = 20,
) {
  return prisma.fundamentals.findMany({
    where: { stockId, type },
    orderBy: { date: "desc" },
    take: limit,
  });
}

/**
 * Get distinct values for filter dropdowns.
 */
export async function getFilterOptions(prisma: PrismaClient) {
  const [sectors, industries, exchanges, countries] = await Promise.all([
    prisma.stock.findMany({
      where: { isActive: true, sector: { not: null } },
      distinct: ["sector"],
      select: { sector: true },
      orderBy: { sector: "asc" },
    }),
    prisma.stock.findMany({
      where: { isActive: true, industry: { not: null } },
      distinct: ["industry"],
      select: { industry: true },
      orderBy: { industry: "asc" },
    }),
    prisma.exchange.findMany({
      select: { id: true, name: true, country: true },
      orderBy: { name: "asc" },
    }),
    prisma.exchange.findMany({
      distinct: ["country"],
      select: { country: true },
      orderBy: { country: "asc" },
    }),
  ]);

  return {
    sectors: sectors.map((s) => s.sector).filter(Boolean) as string[],
    industries: industries.map((i) => i.industry).filter(Boolean) as string[],
    exchanges,
    countries: countries.map((c) => c.country),
  };
}
