import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";
import { computeQualityScore } from "../scoring.js";

/** Yield to the event loop so abort polling can run */
const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

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
        // Yield to event loop so the abort poll interval can fire
        await yieldLoop();

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

          // Re-check abort after potentially long API call
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

          const parseNum = (v: string | null | undefined): number | null => {
            if (v == null || v === "") return null;
            const n = parseFloat(v);
            return isNaN(n) ? null : n;
          };

          /** Sanitize a numeric field that the API types as number|null
           *  but may actually be a string like "NA" at runtime. */
          const safeNum = (v: number | null | undefined): number | null => {
            if (v == null) return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          };

          // Fetch current lastPrice to compute relative fields
          const currentStock = await prisma.stock.findUnique({
            where: { id: stock.id },
            select: { lastPrice: true },
          });
          const lastPrice = currentStock?.lastPrice ?? null;
          const w52High = safeNum(data.Technicals?.["52WeekHigh"]);
          const w52Low = safeNum(data.Technicals?.["52WeekLow"]);
          const mktCap = safeNum(data.Highlights?.MarketCapitalization);
          const ebitda = safeNum(data.Highlights?.EBITDA);

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

          // Compute quality score
          const roe = safeNum(data.Highlights?.ReturnOnEquityTTM);
          const netMargin = safeNum(data.Highlights?.ProfitMargin);
          const revenueGrowth = safeNum(data.Highlights?.QuarterlyRevenueGrowthYOY);
          const earningsGrowth = safeNum(data.Highlights?.QuarterlyEarningsGrowthYOY);
          const peRatio = safeNum(data.Valuation?.TrailingPE);

          const qualityScore = computeQualityScore({
            roe,
            netMargin,
            revenueGrowth,
            revenueCAGR5Y,
            earningsGrowth,
            debtToEquity,
            currentRatio,
            peRatio,
            fcfYield,
            priceToOCF,
            netDebtToOCF,
          });

          // Sanitize all API numeric fields before DB write
          const grossProfitTTM = safeNum(data.Highlights?.GrossProfitTTM);
          const revenueTTM = safeNum(data.Highlights?.RevenueTTM);

          // Update denormalized fields on Stock
          await prisma.stock.update({
            where: { id: stock.id },
            data: {
              sector: data.General?.Sector || null,
              industry: data.General?.Industry || null,
              marketCap: mktCap,
              peRatio,
              forwardPe: safeNum(data.Valuation?.ForwardPE),
              pegRatio: safeNum(data.Highlights?.PEGRatio),
              eps: safeNum(data.Highlights?.EarningsShare),
              dilutedEps: safeNum(data.Highlights?.DilutedEpsTTM),
              revenue: revenueTTM,
              revenueGrowth,
              earningsGrowth,
              grossMargin:
                grossProfitTTM != null && revenueTTM != null && revenueTTM !== 0
                  ? grossProfitTTM / revenueTTM
                  : null,
              operatingMargin: safeNum(data.Highlights?.OperatingMarginTTM),
              netMargin,
              roe,
              roa: safeNum(data.Highlights?.ReturnOnAssetsTTM),
              dividendYield: safeNum(data.Highlights?.DividendYield),
              beta: safeNum(data.Technicals?.Beta),
              week52High: w52High,
              week52Low: w52Low,
              evToEbitda: safeNum(data.Valuation?.EnterpriseValueEbitda),
              evToRevenue: safeNum(data.Valuation?.EnterpriseValueRevenue),
              pbRatio: safeNum(data.Valuation?.PriceBookMRQ),
              psRatio: safeNum(data.Valuation?.PriceSalesTTM),
              enterpriseValue: safeNum(data.Valuation?.EnterpriseValue),
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
              qualityScore,
              targetPrice: safeNum(data.Highlights?.WallStreetTargetPrice),
              pctInsiders: safeNum(data.SharesStats?.PercentInsiders),
              pctInstitutions: safeNum(data.SharesStats?.PercentInstitutions),
              shortPctFloat: safeNum(data.SharesStats?.ShortPercentFloat),
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

            // Skip entries with invalid dates
            if (isNaN(periodDate.getTime())) continue;

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
    const durationMs = Date.now() - startedAt.getTime();
    console.error(`[${jobName}] Fatal:`, message);

    await prisma.syncJob.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: startedAt, lastError: message, durationMs },
      update: { lastRunAt: startedAt, lastError: message, durationMs },
    });
  }
}
