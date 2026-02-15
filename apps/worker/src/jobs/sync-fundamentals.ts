import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_LIMIT = 300; // max stocks per run (rate limit friendly)
const STALE_DAYS = 7;

/**
 * Sync fundamentals for stocks that haven't been updated recently.
 * Each stock costs 10 API calls, so we process in controlled batches.
 */
export async function runSyncFundamentals(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchanges: string[],
): Promise<void> {
  const jobName = "sync-fundamentals";
  const startedAt = new Date();

  console.log(`[${jobName}] Starting fundamentals sync...`);

  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - STALE_DAYS);

  let totalProcessed = 0;
  let totalErrors = 0;

  try {
    for (const exchangeId of exchanges) {
      // Find stocks needing a fundamentals refresh
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
        select: { id: true, ticker: true },
        take: BATCH_LIMIT,
        orderBy: { updatedAt: "asc" },
      });

      console.log(
        `[${jobName}] ${exchangeId}: ${stocks.length} stocks to update`,
      );

      for (const stock of stocks) {
        try {
          const data = await eodhd.fundamentals.get(stock.ticker, exchangeId);

          if (!data?.General) {
            continue;
          }

          const parseNum = (v: string | null | undefined): number | null => {
            if (v == null || v === "") return null;
            const n = parseFloat(v);
            return isNaN(n) ? null : n;
          };

          // Update denormalized fields on Stock
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
              grossMargin:
                data.Highlights.GrossProfitTTM && data.Highlights.RevenueTTM
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

          // Upsert quarterly statements
          const quarterlyIS =
            data.Financials?.Income_Statement?.quarterly ?? {};
          const quarterlyBS =
            data.Financials?.Balance_Sheet?.quarterly ?? {};
          const quarterlyCF =
            data.Financials?.Cash_Flow?.quarterly ?? {};

          for (const [dateKey, income] of Object.entries(quarterlyIS)) {
            if (!income.date) continue;

            const balance = quarterlyBS[dateKey];
            const cashFlow = quarterlyCF[dateKey];
            const periodDate = new Date(income.date);
            const quarter = Math.ceil((periodDate.getMonth() + 1) / 3);
            const year = periodDate.getFullYear();
            const period = `Q${quarter}-${year}`;

            await prisma.fundamentals.upsert({
              where: {
                stockId_period: { stockId: stock.id, period },
              },
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
                cashAndEquiv: parseNum(
                  balance?.cashAndShortTermInvestments,
                ),
                operatingCF: parseNum(
                  cashFlow?.totalCashFromOperatingActivities,
                ),
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
                cashAndEquiv: parseNum(
                  balance?.cashAndShortTermInvestments,
                ),
                operatingCF: parseNum(
                  cashFlow?.totalCashFromOperatingActivities,
                ),
                capex: parseNum(cashFlow?.capitalExpenditures),
                freeCashFlow: parseNum(cashFlow?.freeCashFlow),
              },
            });
          }

          totalProcessed++;

          if (totalProcessed % 50 === 0) {
            console.log(
              `[${jobName}] Progress: ${totalProcessed}/${stocks.length}`,
            );
          }
        } catch (error) {
          totalErrors++;
          console.error(
            `[${jobName}] Error on ${stock.ticker}.${exchangeId}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    const durationMs = Date.now() - startedAt.getTime();

    await prisma.syncJob.upsert({
      where: { jobName },
      create: {
        jobName,
        lastRunAt: startedAt,
        lastSuccessAt: new Date(),
        tickersProcessed: totalProcessed,
        durationMs,
      },
      update: {
        lastRunAt: startedAt,
        lastSuccessAt: new Date(),
        lastError: totalErrors > 0 ? `${totalErrors} errors` : null,
        tickersProcessed: totalProcessed,
        durationMs,
      },
    });

    console.log(
      `[${jobName}] Done: ${totalProcessed} synced, ${totalErrors} errors, ${durationMs}ms`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${jobName}] Fatal:`, message);

    await prisma.syncJob.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: startedAt, lastError: message },
      update: { lastRunAt: startedAt, lastError: message },
    });
  }
}
