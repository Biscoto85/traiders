import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_SIZE = 200;
const LOOKUP_BATCH = 20000; // PostgreSQL max 32767 bind variables

/**
 * Sync end-of-day prices for all configured exchanges.
 * Uses the bulk endpoint: 1 API call per exchange.
 */
export async function runSyncEod(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchanges: string[],
): Promise<void> {
  const jobName = "sync-eod";
  const startedAt = new Date();

  console.log(`[${jobName}] Starting EOD sync for exchanges: ${exchanges.join(", ")}`);

  let totalProcessed = 0;

  try {
    for (const exchangeId of exchanges) {
      console.log(`[${jobName}] Fetching bulk EOD for ${exchangeId}...`);

      const bulkData = await eodhd.bulk.getEod(exchangeId);

      if (!bulkData.length) {
        console.log(`[${jobName}] ${exchangeId}: no data returned`);
        continue;
      }

      // Build ticker → stockId map (batched to stay under PostgreSQL bind variable limit)
      const tickers = bulkData.map((d) => d.code);
      const stockMap = new Map<string, string>();
      for (let j = 0; j < tickers.length; j += LOOKUP_BATCH) {
        const tickerBatch = tickers.slice(j, j + LOOKUP_BATCH);
        const stocks = await prisma.stock.findMany({
          where: { ticker: { in: tickerBatch }, exchangeId },
          select: { id: true, ticker: true },
        });
        for (const s of stocks) {
          stockMap.set(s.ticker, s.id);
        }
      }

      // Process in batches
      for (let i = 0; i < bulkData.length; i += BATCH_SIZE) {
        const batch = bulkData.slice(i, i + BATCH_SIZE);

        const operations = batch
          .filter((item) => stockMap.has(item.code))
          .flatMap((item) => {
            const stockId = stockMap.get(item.code)!;
            const priceDate = new Date(item.date);

            return [
              prisma.dailyPrice.upsert({
                where: { stockId_date: { stockId, date: priceDate } },
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

        totalProcessed += batch.length;
      }

      // Recalculate pctFrom52WeekHigh/Low for all stocks on this exchange
      await prisma.$executeRaw`
        UPDATE "Stock"
        SET "pctFrom52WeekHigh" = CASE
              WHEN "lastPrice" IS NOT NULL AND "week52High" IS NOT NULL AND "week52High" != 0
              THEN ("lastPrice" - "week52High") / "week52High"
              ELSE NULL
            END,
            "pctFrom52WeekLow" = CASE
              WHEN "lastPrice" IS NOT NULL AND "week52Low" IS NOT NULL AND "week52Low" != 0
              THEN ("lastPrice" - "week52Low") / "week52Low"
              ELSE NULL
            END
        WHERE "exchangeId" = ${exchangeId}
          AND "lastPrice" IS NOT NULL
          AND ("week52High" IS NOT NULL OR "week52Low" IS NOT NULL)
      `;

      console.log(`[${jobName}] ${exchangeId}: ${bulkData.length} tickers synced`);
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
        lastError: null,
        tickersProcessed: totalProcessed,
        durationMs,
      },
    });

    console.log(
      `[${jobName}] Completed: ${totalProcessed} tickers in ${durationMs}ms`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${jobName}] Failed:`, message);

    await prisma.syncJob.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: startedAt, lastError: message },
      update: { lastRunAt: startedAt, lastError: message },
    });
  }
}
