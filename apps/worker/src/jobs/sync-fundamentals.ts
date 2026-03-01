import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_LIMIT = 1500; // max stocks per run
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

          // Fetch current lastPrice to compute relative fields
          const currentStock = await prisma.stock.findUnique({
            where: { id: stock.id },
            select: { lastPrice: true },
          });
          const lastPrice = currentStock?.lastPrice ?? null;
          const w52High = data.Technicals["52WeekHigh"];
          const w52Low = data.Technicals["52WeekLow"];
          const mktCap = data.Highlights.MarketCapitalization;
          const ebitda = data.Highlights.EBITDA;

          // Derive current ratio from latest quarterly balance sheet
          const latestQBS = Object.values(
            data.Financials?.Balance_Sheet?.quarterly ?? {},
          )[0];
          const curAssets = latestQBS ? parseNum(latestQBS.totalCurrentAssets) : null;
          const curLiab = latestQBS ? parseNum(latestQBS.totalCurrentLiabilities) : null;
          const currentRatio =
            curAssets != null && curLiab != null && curLiab !== 0
              ? curAssets / curLiab
              : null;

          // Derive FCF from latest quarterly cash flow
          const latestQCF = Object.values(
            data.Financials?.Cash_Flow?.quarterly ?? {},
          )[0];
          const fcf = latestQCF ? parseNum(latestQCF.freeCashFlow) : null;
          const fcfYield =
            fcf != null && mktCap != null && mktCap > 0 ? fcf / mktCap : null;

          // Update denormalized fields on Stock
          await prisma.stock.update({
            where: { id: stock.id },
            data: {
              sector: data.General.Sector || null,
              industry: data.General.Industry || null,
              marketCap: mktCap,
              peRatio: data.Valuation.TrailingPE,
              forwardPe: data.Valuation.ForwardPE,
              pegRatio: data.Highlights.PEGRatio,
              eps: data.Highlights.EarningsShare,
              dilutedEps: data.Highlights.DilutedEpsTTM,
              revenue: data.Highlights.RevenueTTM,
              revenueGrowth: data.Highlights.QuarterlyRevenueGrowthYOY,
              earningsGrowth: data.Highlights.QuarterlyEarningsGrowthYOY,
              grossMargin:
                data.Highlights.GrossProfitTTM && data.Highlights.RevenueTTM
                  ? data.Highlights.GrossProfitTTM / data.Highlights.RevenueTTM
                  : null,
              operatingMargin: data.Highlights.OperatingMarginTTM,
              netMargin: data.Highlights.ProfitMargin,
              roe: data.Highlights.ReturnOnEquityTTM,
              roa: data.Highlights.ReturnOnAssetsTTM,
              dividendYield: data.Highlights.DividendYield,
              beta: data.Technicals.Beta,
              week52High: w52High,
              week52Low: w52Low,
              evToEbitda: data.Valuation.EnterpriseValueEbitda,
              evToRevenue: data.Valuation.EnterpriseValueRevenue,
              pbRatio: data.Valuation.PriceBookMRQ,
              psRatio: data.Valuation.PriceSalesTTM,
              enterpriseValue: data.Valuation.EnterpriseValue,
              ebitda,
              freeCashFlow: fcf,
              fcfYield,
              currentRatio,
              targetPrice: data.Highlights.WallStreetTargetPrice,
              pctInsiders: data.SharesStats?.PercentInsiders ?? null,
              pctInstitutions: data.SharesStats?.PercentInstitutions ?? null,
              shortPctFloat: data.SharesStats?.ShortPercentFloat ?? null,
              pctFrom52WeekHigh:
                lastPrice != null && w52High != null && w52High !== 0
                  ? (lastPrice - w52High) / w52High
                  : null,
              pctFrom52WeekLow:
                lastPrice != null && w52Low != null && w52Low !== 0
                  ? (lastPrice - w52Low) / w52Low
                  : null,
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
                ebitda: parseNum(income.ebitda),
                eps: null,
                totalAssets: parseNum(balance?.totalAssets),
                totalCurrentAssets: parseNum(balance?.totalCurrentAssets),
                totalDebt: parseNum(balance?.longTermDebt),
                totalCurrentLiab: parseNum(balance?.totalCurrentLiabilities),
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
                ebitda: parseNum(income.ebitda),
                totalAssets: parseNum(balance?.totalAssets),
                totalCurrentAssets: parseNum(balance?.totalCurrentAssets),
                totalDebt: parseNum(balance?.longTermDebt),
                totalCurrentLiab: parseNum(balance?.totalCurrentLiabilities),
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
