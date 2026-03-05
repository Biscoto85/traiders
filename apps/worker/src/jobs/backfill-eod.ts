import type { PrismaClient } from "@prisma/client";
import type { EODHDClient, EODHDEodBar } from "@stock-screener/eodhd-client";

const BATCH_SIZE = 200;
const DELAY_MS = 100; // Rate-limit between per-ticker API calls
const MIN_HISTORY = 200; // Skip stocks that already have enough data
const BACKFILL_FROM = "2023-01-01";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBar(raw: EODHDEodBar, stockId: string) {
  const date = new Date(raw.date);
  if (isNaN(date.getTime())) return null;

  const close = Number(raw.close);
  if (!Number.isFinite(close)) return null;

  const adjClose = Number(raw.adjusted_close);
  const open = Number(raw.open);
  const high = Number(raw.high);
  const low = Number(raw.low);
  const rawVol = Number(raw.volume);

  return {
    stockId,
    date,
    open: Number.isFinite(open) ? open : close,
    high: Number.isFinite(high) ? high : close,
    low: Number.isFinite(low) ? low : close,
    close,
    adjClose: Number.isFinite(adjClose) ? adjClose : close,
    volume: Number.isFinite(rawVol) && rawVol >= 0 ? BigInt(Math.round(rawVol)) : BigInt(0),
  };
}

/**
 * One-time historical backfill of EOD prices.
 *
 * Uses the per-ticker EODHD endpoint (1 API call per stock).
 * Designed to be triggered manually from the admin panel.
 */
export async function runBackfillEod(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchanges: string[],
  shouldAbort?: () => boolean,
): Promise<void> {
  const jobName = "backfill-eod";
  const startedAt = new Date();

  console.log(`[${jobName}] Starting historical backfill from ${BACKFILL_FROM}...`);

  await prisma.syncJob.upsert({
    where: { jobName },
    create: { jobName, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null, durationMs: null, tickersProcessed: 0 },
  });

  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalBars = 0;

  try {
    for (const exchangeId of exchanges) {
      if (shouldAbort?.()) break;

      const stocks = await prisma.stock.findMany({
        where: { exchangeId, isActive: true },
        select: { id: true, ticker: true },
      });

      // Check which stocks already have enough history
      const priceCounts = await prisma.dailyPrice.groupBy({
        by: ["stockId"],
        where: { stockId: { in: stocks.map((s) => s.id) } },
        _count: true,
      });
      const countMap = new Map(priceCounts.map((p) => [p.stockId, p._count]));

      const needsBackfill = stocks.filter((s) => (countMap.get(s.id) ?? 0) < MIN_HISTORY);
      console.log(`[${jobName}] ${exchangeId}: ${needsBackfill.length}/${stocks.length} stocks need backfill`);

      for (const stock of needsBackfill) {
        if (shouldAbort?.()) break;

        try {
          const bars = await eodhd.eod.getHistory(stock.ticker, exchangeId, {
            from: BACKFILL_FROM,
            period: "d",
            order: "a",
          });

          const validBars = bars
            .map((raw) => parseBar(raw, stock.id))
            .filter((b): b is NonNullable<typeof b> => b != null);

          // Batch upsert
          for (let i = 0; i < validBars.length; i += BATCH_SIZE) {
            const batch = validBars.slice(i, i + BATCH_SIZE);
            const ops = batch.map((item) =>
              prisma.dailyPrice.upsert({
                where: { stockId_date: { stockId: item.stockId, date: item.date } },
                create: {
                  stockId: item.stockId,
                  date: item.date,
                  open: item.open,
                  high: item.high,
                  low: item.low,
                  close: item.close,
                  adjClose: item.adjClose,
                  volume: item.volume,
                },
                update: {
                  open: item.open,
                  high: item.high,
                  low: item.low,
                  close: item.close,
                  adjClose: item.adjClose,
                  volume: item.volume,
                },
              }),
            );
            if (ops.length > 0) {
              await prisma.$transaction(ops);
            }
          }

          totalBars += validBars.length;
          totalProcessed++;

          // Progress log every 50 stocks
          if (totalProcessed % 50 === 0) {
            console.log(`[${jobName}] Progress: ${totalProcessed} stocks, ${totalBars} bars inserted`);
            await prisma.syncJob.update({
              where: { jobName },
              data: { tickersProcessed: totalProcessed },
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[${jobName}] ${stock.ticker}.${exchangeId}: ${msg}`);
          totalSkipped++;
        }

        await sleep(DELAY_MS);
      }

      console.log(`[${jobName}] ${exchangeId}: done (${totalProcessed} stocks backfilled)`);
    }

    const durationMs = Date.now() - startedAt.getTime();
    const aborted = shouldAbort?.();
    const summary = aborted
      ? `[ABORTED] ${totalProcessed} stocks, ${totalBars} bars (${totalSkipped} errors)`
      : `${totalProcessed} stocks, ${totalBars} bars (${totalSkipped} errors)`;

    console.log(`[${jobName}] Complete: ${summary} in ${Math.round(durationMs / 1000)}s`);

    await prisma.syncJob.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: startedAt, durationMs, tickersProcessed: totalProcessed },
      update: {
        lastError: aborted ? summary : null,
        durationMs,
        tickersProcessed: totalProcessed,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${jobName}] Fatal error: ${msg}`);
    await prisma.syncJob.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: startedAt, lastError: msg, durationMs },
      update: { lastError: msg, durationMs, tickersProcessed: totalProcessed },
    });
  }
}
