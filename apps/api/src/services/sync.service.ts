import type { PrismaClient } from "@prisma/client";
import { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_SIZE = 500;

/**
 * Sync the list of tickers for an exchange.
 */
export async function syncExchangeTickers(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchangeId: string,
): Promise<number> {
  const symbols = await eodhd.eod.getExchangeSymbols(exchangeId);

  let processed = 0;

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);

    await prisma.$transaction(
      batch.map((sym) =>
        prisma.stock.upsert({
          where: {
            ticker_exchangeId: {
              ticker: sym.Code,
              exchangeId,
            },
          },
          create: {
            ticker: sym.Code,
            exchangeId,
            name: sym.Name,
            currency: sym.Currency,
            isin: sym.Isin,
            type: sym.Type,
            isActive: true,
          },
          update: {
            name: sym.Name,
            currency: sym.Currency,
            isin: sym.Isin,
            type: sym.Type,
            isActive: true,
          },
        }),
      ),
    );

    processed += batch.length;
  }

  return processed;
}

/**
 * Sync daily EOD prices for an exchange using bulk endpoint.
 * Most efficient: one API call per exchange.
 */
export async function syncEodPrices(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchangeId: string,
  date?: string,
): Promise<number> {
  const bulkData = await eodhd.bulk.getEod(exchangeId, { date });

  if (!bulkData.length) return 0;

  // Build a map of ticker → stock ID for fast lookups
  const tickers = bulkData.map((d) => d.code);
  const stocks = await prisma.stock.findMany({
    where: { ticker: { in: tickers }, exchangeId },
    select: { id: true, ticker: true },
  });
  const stockMap = new Map(stocks.map((s) => [s.ticker, s.id]));

  let processed = 0;

  for (let i = 0; i < bulkData.length; i += BATCH_SIZE) {
    const batch = bulkData.slice(i, i + BATCH_SIZE);

    const operations = batch
      .filter((item) => stockMap.has(item.code))
      .flatMap((item) => {
        const stockId = stockMap.get(item.code)!;
        const priceDate = new Date(item.date);

        return [
          // Upsert daily price
          prisma.dailyPrice.upsert({
            where: {
              stockId_date: { stockId, date: priceDate },
            },
            create: {
              stockId,
              date: priceDate,
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
              adjClose: item.adjusted_close,
              volume: BigInt(Math.round(item.volume)),
            },
            update: {
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
              adjClose: item.adjusted_close,
              volume: BigInt(Math.round(item.volume)),
            },
          }),
          // Update denormalized price on Stock
          prisma.stock.update({
            where: { id: stockId },
            data: {
              lastPrice: item.adjusted_close,
              lastVolume: BigInt(Math.round(item.volume)),
              priceUpdatedAt: priceDate,
            },
          }),
        ];
      });

    if (operations.length > 0) {
      await prisma.$transaction(operations);
    }

    processed += batch.length;
  }

  return processed;
}

/**
 * Sync fundamentals for a single stock.
 * Fetches from EODHD and updates both Fundamentals table
 * and denormalized fields on Stock.
 */
export async function syncStockFundamentals(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  ticker: string,
  exchangeId: string,
): Promise<boolean> {
  const stock = await prisma.stock.findUnique({
    where: { ticker_exchangeId: { ticker, exchangeId } },
    select: { id: true },
  });

  if (!stock) return false;

  const data = await eodhd.fundamentals.get(ticker, exchangeId);
  if (!data?.General) return false;

  const parseNum = (v: string | null | undefined): number | null => {
    if (v == null || v === "") return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  // ── Update denormalized Stock fields from Highlights ──
  await prisma.stock.update({
    where: { id: stock.id },
    data: {
      sector: data.General.Sector || null,
      industry: data.General.Industry || null,
      marketCap: data.Highlights.MarketCapitalization,
      peRatio: data.Valuation.TrailingPE,
      forwardPe: data.Valuation.ForwardPE,
      pegRatio: data.Highlights.PEGRatio,
      eps: data.Highlights.EarningsShare,
      revenue: data.Highlights.RevenueTTM,
      revenueGrowth: data.Highlights.QuarterlyRevenueGrowthYOY,
      grossMargin: data.Highlights.GrossProfitTTM && data.Highlights.RevenueTTM
        ? data.Highlights.GrossProfitTTM / data.Highlights.RevenueTTM
        : null,
      operatingMargin: data.Highlights.OperatingMarginTTM,
      netMargin: data.Highlights.ProfitMargin,
      roe: data.Highlights.ReturnOnEquityTTM,
      dividendYield: data.Highlights.DividendYield,
      beta: data.Technicals.Beta,
      week52High: data.Technicals["52WeekHigh"],
      week52Low: data.Technicals["52WeekLow"],
      evToEbitda: data.Valuation.EnterpriseValueEbitda,
      pbRatio: data.Valuation.PriceBookMRQ,
    },
  });

  // ── Upsert quarterly financial statements ──
  const quarterlyIS = data.Financials?.Income_Statement?.quarterly ?? {};
  const quarterlyBS = data.Financials?.Balance_Sheet?.quarterly ?? {};
  const quarterlyCF = data.Financials?.Cash_Flow?.quarterly ?? {};

  for (const [dateKey, income] of Object.entries(quarterlyIS)) {
    if (!income.date) continue;

    const balance = quarterlyBS[dateKey];
    const cashFlow = quarterlyCF[dateKey];
    const periodDate = new Date(income.date);

    // Derive period label: "Q1-2024"
    const quarter = Math.ceil((periodDate.getMonth() + 1) / 3);
    const year = periodDate.getFullYear();
    const period = `Q${quarter}-${year}`;

    await prisma.fundamentals.upsert({
      where: { stockId_period: { stockId: stock.id, period } },
      create: {
        stockId: stock.id,
        period,
        type: "quarterly",
        date: periodDate,
        revenue: parseNum(income.totalRevenue),
        grossProfit: parseNum(income.grossProfit),
        operatingIncome: parseNum(income.operatingIncome),
        netIncome: parseNum(income.netIncome),
        eps: null,
        totalAssets: parseNum(balance?.totalAssets),
        totalDebt: parseNum(balance?.longTermDebt),
        totalEquity: parseNum(balance?.totalStockholderEquity),
        cashAndEquiv: parseNum(balance?.cashAndShortTermInvestments),
        operatingCF: parseNum(cashFlow?.totalCashFromOperatingActivities),
        capex: parseNum(cashFlow?.capitalExpenditures),
        freeCashFlow: parseNum(cashFlow?.freeCashFlow),
      },
      update: {
        date: periodDate,
        revenue: parseNum(income.totalRevenue),
        grossProfit: parseNum(income.grossProfit),
        operatingIncome: parseNum(income.operatingIncome),
        netIncome: parseNum(income.netIncome),
        totalAssets: parseNum(balance?.totalAssets),
        totalDebt: parseNum(balance?.longTermDebt),
        totalEquity: parseNum(balance?.totalStockholderEquity),
        cashAndEquiv: parseNum(balance?.cashAndShortTermInvestments),
        operatingCF: parseNum(cashFlow?.totalCashFromOperatingActivities),
        capex: parseNum(cashFlow?.capitalExpenditures),
        freeCashFlow: parseNum(cashFlow?.freeCashFlow),
      },
    });
  }

  return true;
}

/**
 * Batch sync fundamentals for all active stocks on an exchange.
 * Respects rate limits via the EODHD client.
 */
export async function syncAllFundamentals(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchangeId: string,
  options: {
    /** Only sync stocks not updated in the last N days */
    staleDays?: number;
    /** Max stocks to process in one run */
    limit?: number;
    /** Progress callback */
    onProgress?: (processed: number, total: number) => void;
  } = {},
): Promise<number> {
  const { staleDays = 7, limit = 500, onProgress } = options;

  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - staleDays);

  const stocks = await prisma.stock.findMany({
    where: {
      exchangeId,
      isActive: true,
      type: "Common Stock",
      OR: [
        { updatedAt: { lt: staleDate } },
        { marketCap: null },
      ],
    },
    select: { ticker: true },
    take: limit,
    orderBy: { updatedAt: "asc" }, // oldest first
  });

  let processed = 0;

  for (const stock of stocks) {
    try {
      await syncStockFundamentals(prisma, eodhd, stock.ticker, exchangeId);
      processed++;
      onProgress?.(processed, stocks.length);
    } catch (error) {
      // Log but don't stop — some tickers may not have fundamentals
      console.error(
        `Failed to sync fundamentals for ${stock.ticker}.${exchangeId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return processed;
}
