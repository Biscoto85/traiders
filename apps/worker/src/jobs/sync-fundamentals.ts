import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_LIMIT = 1500; // max stocks per exchange per run
const STALE_DAYS = 7;
const API_CALLS_PER_STOCK = 10;

export interface SyncFundamentalsOptions {
  /** Skip stocks with known marketCap below this (default 50M). */
  minMarketCap?: number;
  /** Stop the run after this many API calls (default 90 000). */
  maxApiCalls?: number;
}

/**
 * Sync fundamentals for stocks that haven't been updated recently.
 * Each stock costs 10 API calls, so we process in controlled batches.
 *
 * Optimization: stocks with known marketCap < minMarketCap are skipped entirely.
 * A global API call budget prevents exceeding the EODHD daily limit (100K).
 */
export async function runSyncFundamentals(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchanges: string[],
  options?: SyncFundamentalsOptions,
  shouldAbort?: () => boolean,
): Promise<void> {
  const jobName = "sync-fundamentals";
  const startedAt = new Date();
  const minMarketCap = options?.minMarketCap ?? 50_000_000;
  const maxApiCalls = options?.maxApiCalls ?? 90_000;
  const maxStocks = Math.floor(maxApiCalls / API_CALLS_PER_STOCK);

  console.log(`[${jobName}] Starting fundamentals sync...`);
  console.log(`[${jobName}] Config: minMarketCap=${(minMarketCap / 1e6).toFixed(0)}M, maxApiCalls=${maxApiCalls} (=${maxStocks} stocks)`);

  // Mark job as running
  await prisma.syncJob.upsert({
    where: { jobName },
    create: { jobName, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null, durationMs: null, tickersProcessed: 0 },
  });

  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - STALE_DAYS);

  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let budgetExhausted = false;

  try {
    for (const exchangeId of exchanges) {
      if (budgetExhausted) break;

      const remainingBudget = maxStocks - totalProcessed;
      const take = Math.min(BATCH_LIMIT, remainingBudget);

      if (take <= 0) {
        budgetExhausted = true;
        break;
      }

      // Count how many we're skipping due to market cap filter
      const skippedCount = await prisma.stock.count({
        where: {
          exchangeId,
          isActive: true,
          type: "Common Stock",
          marketCap: { not: null, lt: minMarketCap },
        },
      });
      totalSkipped += skippedCount;

      // Find stocks needing a fundamentals refresh, filtered by market cap.
      // Stocks with unknown marketCap (null) are still included for discovery,
      // but sorted last so high-cap stocks get priority.
      const stocks = await prisma.stock.findMany({
        where: {
          exchangeId,
          isActive: true,
          type: "Common Stock",
          OR: [
            { updatedAt: { lt: staleDate } },
            { marketCap: null },
          ],
          // Market cap filter: accept unknown (null) or above minimum
          NOT: {
            marketCap: { not: null, lt: minMarketCap },
          },
        },
        select: { id: true, ticker: true, marketCap: true },
        take,
        orderBy: { marketCap: "desc" },
      });

      const knownCap = stocks.filter((s) => s.marketCap != null).length;
      const unknownCap = stocks.length - knownCap;

      console.log(
        `[${jobName}] ${exchangeId}: ${stocks.length} stocks to update (${knownCap} with cap >= ${(minMarketCap / 1e6).toFixed(0)}M, ${unknownCap} unknown, ${skippedCount} skipped below threshold)`,
      );

      for (const stock of stocks) {
        // Check abort signal
        if (shouldAbort?.()) {
          const durationMs = Date.now() - startedAt.getTime();
          const msg = `[ABORTED] Interrompu par l'utilisateur apres ${totalProcessed} stocks (${durationMs}ms)`;
          console.log(`[${jobName}] ${msg}`);
          await prisma.syncJob.upsert({
            where: { jobName },
            create: { jobName, lastRunAt: startedAt, lastError: msg, durationMs },
            update: { lastRunAt: startedAt, lastError: msg, tickersProcessed: totalProcessed, durationMs },
          });
          return;
        }

        // Check budget before each API call
        if (totalProcessed >= maxStocks) {
          budgetExhausted = true;
          console.log(`[${jobName}] API budget reached (${totalProcessed * API_CALLS_PER_STOCK}/${maxApiCalls} calls). Stopping.`);
          break;
        }

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

          // Derive ratios from latest quarterly balance sheet
          const latestQBS = Object.values(
            data.Financials?.Balance_Sheet?.quarterly ?? {},
          )[0];
          const curAssets = latestQBS ? parseNum(latestQBS.totalCurrentAssets) : null;
          const curLiab = latestQBS ? parseNum(latestQBS.totalCurrentLiabilities) : null;
          const totalDebt = latestQBS ? parseNum(latestQBS.longTermDebt) : null;
          const totalEquity = latestQBS ? parseNum(latestQBS.totalStockholderEquity) : null;
          const currentRatio =
            curAssets != null && curLiab != null && curLiab !== 0
              ? curAssets / curLiab
              : null;
          const debtToEquity =
            totalDebt != null && totalEquity != null && totalEquity !== 0
              ? totalDebt / totalEquity
              : null;

          // Derive FCF + Operating CF from latest quarterly cash flow
          const latestQCF = Object.values(
            data.Financials?.Cash_Flow?.quarterly ?? {},
          )[0];
          const fcf = latestQCF ? parseNum(latestQCF.freeCashFlow) : null;
          const fcfYield =
            fcf != null && mktCap != null && mktCap > 0 ? fcf / mktCap : null;
          const operatingCashFlow = latestQCF
            ? parseNum(latestQCF.totalCashFromOperatingActivities)
            : null;

          // Derive cash from latest quarterly balance sheet
          const cashAndEquiv = latestQBS
            ? parseNum(latestQBS.cashAndShortTermInvestments)
            : null;

          // Compute derived Pikpik metrics
          const netDebt =
            totalDebt != null && cashAndEquiv != null
              ? totalDebt - cashAndEquiv
              : null;
          const priceToOCF =
            mktCap != null && operatingCashFlow != null && operatingCashFlow > 0
              ? mktCap / operatingCashFlow
              : null;
          const netDebtToOCF =
            netDebt != null && operatingCashFlow != null && operatingCashFlow > 0
              ? netDebt / operatingCashFlow
              : null;
          const equityToMarketCap =
            totalEquity != null && mktCap != null && mktCap > 0
              ? totalEquity / mktCap
              : null;

          // Compute 5-year revenue CAGR from quarterly fundamentals (TTM approach)
          let revenueCAGR5Y: number | null = null;
          try {
            const quarters = await prisma.fundamentals.findMany({
              where: { stockId: stock.id, type: "quarterly" },
              orderBy: { date: "desc" },
              select: { revenue: true },
              take: 24,
            });
            if (quarters.length >= 20) {
              const latestTTM = quarters.slice(0, 4).reduce((s, f) => s + (f.revenue ?? 0), 0);
              const oldTTM = quarters.slice(16, 20).reduce((s, f) => s + (f.revenue ?? 0), 0);
              if (latestTTM > 0 && oldTTM > 0) {
                revenueCAGR5Y = Math.pow(latestTTM / oldTTM, 1 / 4) - 1;
              }
            }
          } catch {
            // Skip CAGR if query fails
          }

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
              operatingCashFlow,
              totalDebt,
              cashAndEquiv,
              totalEquity,
              netDebt,
              priceToOCF,
              netDebtToOCF,
              equityToMarketCap,
              revenueCAGR5Y,
              currentRatio,
              debtToEquity,
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
            const apiUsed = totalProcessed * API_CALLS_PER_STOCK;
            console.log(
              `[${jobName}] Progress: ${totalProcessed} stocks (${apiUsed}/${maxApiCalls} API calls used)`,
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
    const apiUsed = totalProcessed * API_CALLS_PER_STOCK;

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
      `[${jobName}] Done: ${totalProcessed} synced, ${totalSkipped} skipped (cap < ${(minMarketCap / 1e6).toFixed(0)}M), ${totalErrors} errors, ${apiUsed} API calls, ${durationMs}ms${budgetExhausted ? " [BUDGET REACHED]" : ""}`,
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
