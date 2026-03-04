import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_SIZE = 200;

/**
 * Sync end-of-day prices for all configured exchanges.
 * Uses the bulk endpoint: 1 API call per exchange.
 */
export async function runSyncEod(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchanges: string[],
  shouldAbort?: () => boolean,
): Promise<void> {
  const jobName = "sync-eod";
  const startedAt = new Date();

  console.log(`[${jobName}] Starting EOD sync for exchanges: ${exchanges.join(", ")}`);

  let totalProcessed = 0;

  // Mark job as running
  await prisma.syncJob.upsert({
    where: { jobName },
    create: { jobName, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null, durationMs: null, tickersProcessed: 0 },
  });

  try {
    for (const exchangeId of exchanges) {
      if (shouldAbort?.()) {
        const durationMs = Date.now() - startedAt.getTime();
        const msg = `[ABORTED] Interrompu par l'utilisateur apres ${totalProcessed} tickers (${durationMs}ms)`;
        console.log(`[${jobName}] ${msg}`);
        await prisma.syncJob.upsert({
          where: { jobName },
          create: { jobName, lastRunAt: startedAt, lastError: msg, durationMs },
          update: { lastRunAt: startedAt, lastError: msg, tickersProcessed: totalProcessed, durationMs },
        });
        return;
      }

      // Build ticker → stockId map first so we can request only our tickers
      const stocks = await prisma.stock.findMany({
        where: { exchangeId, isActive: true },
        select: { id: true, ticker: true },
      });
      const stockMap = new Map<string, string>();
      for (const s of stocks) {
        stockMap.set(s.ticker, s.id);
      }

      const symbolList = Array.from(stockMap.keys());
      console.log(`[${jobName}] Fetching bulk EOD for ${exchangeId} (${symbolList.length} symbols)...`);

      const bulkData = await eodhd.bulk.getEod(exchangeId, { symbols: symbolList });

      if (!bulkData.length) {
        console.log(`[${jobName}] ${exchangeId}: no data returned`);
        continue;
      }

      // Process in batches
      for (let i = 0; i < bulkData.length; i += BATCH_SIZE) {
        const batch = bulkData.slice(i, i + BATCH_SIZE);

        const operations = batch
          .filter((item) => {
            if (!stockMap.has(item.code)) return false;
            const d = new Date(item.date);
            if (isNaN(d.getTime())) return false;
            if (!Number.isFinite(item.close)) return false;
            return true;
          })
          .flatMap((item) => {
            const stockId = stockMap.get(item.code)!;
            const priceDate = new Date(item.date);
            const vol = Number.isFinite(item.volume) ? BigInt(Math.round(item.volume)) : BigInt(0);
            const safe = (v: number) => (Number.isFinite(v) ? v : item.close);

            return [
              prisma.dailyPrice.upsert({
                where: { stockId_date: { stockId, date: priceDate } },
                create: {
                  stockId,
                  date: priceDate,
                  open: safe(item.open),
                  high: safe(item.high),
                  low: safe(item.low),
                  close: item.close,
                  adjClose: item.adjusted_close,
                  volume: vol,
                },
                update: {
                  open: safe(item.open),
                  high: safe(item.high),
                  low: safe(item.low),
                  close: item.close,
                  adjClose: item.adjusted_close,
                  volume: vol,
                },
              }),
              prisma.stock.update({
                where: { id: stockId },
                data: {
                  lastPrice: item.adjusted_close,
                  lastVolume: vol,
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
    const durationMs = Date.now() - startedAt.getTime();
    console.error(`[${jobName}] Failed:`, message);

    await prisma.syncJob.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: startedAt, lastError: message, durationMs },
      update: { lastRunAt: startedAt, lastError: message, durationMs },
    });
  }
}
