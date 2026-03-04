import type { PrismaClient } from "@prisma/client";
import type { EODHDClient, EODHDBulkEodItem } from "@stock-screener/eodhd-client";

const BATCH_SIZE = 200;

// ─── Validated item after parsing raw EODHD response ────────────────

interface ValidEodItem {
  stockId: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: bigint;
}

/**
 * Parse and validate a raw EODHD bulk item.
 *
 * The EODHD API sometimes returns "NA" strings, null, or missing fields
 * even though the TS types say `number`. This function coerces everything
 * through `Number()` and rejects items that don't have the minimum
 * required valid data (date + close price).
 */
function parseEodItem(
  raw: EODHDBulkEodItem,
  stockId: string,
): ValidEodItem | null {
  // ── Date ──────────────────────────────────────────────────────────
  const date = new Date(raw.date);
  if (isNaN(date.getTime())) return null;

  // ── Prices — coerce through Number() to catch "NA" / null / undef ─
  const close = Number(raw.close);
  const adjClose = Number(raw.adjusted_close);

  // close and adjClose are required (non-nullable in schema)
  if (!Number.isFinite(close)) return null;
  // If adjClose is bad, fall back to close
  const safeAdjClose = Number.isFinite(adjClose) ? adjClose : close;

  const rawOpen = Number(raw.open);
  const rawHigh = Number(raw.high);
  const rawLow = Number(raw.low);

  // open/high/low are required — fall back to close if invalid
  const open = Number.isFinite(rawOpen) ? rawOpen : close;
  const high = Number.isFinite(rawHigh) ? rawHigh : close;
  const low = Number.isFinite(rawLow) ? rawLow : close;

  // ── Volume — optional, default 0 ─────────────────────────────────
  const rawVol = Number(raw.volume);
  const volume = Number.isFinite(rawVol) && rawVol >= 0
    ? BigInt(Math.round(rawVol))
    : BigInt(0);

  return { stockId, date, open, high, low, close, adjClose: safeAdjClose, volume };
}

/**
 * Sync end-of-day prices for all configured exchanges.
 * Uses the bulk endpoint: 1 API call per exchange.
 *
 * Robustness:
 *  - Each exchange is processed independently (one failure won't block others)
 *  - Each raw item is parsed & validated before DB writes
 *  - Invalid items (bad dates, "NA" prices) are skipped with a warning log
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
  let totalSkipped = 0;
  const exchangeErrors: string[] = [];

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

      try {
        // Build ticker → stockId map
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

        // Parse & validate all items upfront
        const validItems: ValidEodItem[] = [];
        let exchangeSkipped = 0;

        for (const raw of bulkData) {
          const stockId = stockMap.get(raw.code);
          if (!stockId) continue; // Not our ticker

          const parsed = parseEodItem(raw, stockId);
          if (parsed) {
            validItems.push(parsed);
          } else {
            exchangeSkipped++;
          }
        }

        if (exchangeSkipped > 0) {
          console.warn(
            `[${jobName}] ${exchangeId}: ${exchangeSkipped} items skipped (invalid date/price)`,
          );
          totalSkipped += exchangeSkipped;
        }

        // Process valid items in batches
        for (let i = 0; i < validItems.length; i += BATCH_SIZE) {
          const batch = validItems.slice(i, i + BATCH_SIZE);

          const operations = batch.flatMap((item) => [
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
            prisma.stock.update({
              where: { id: item.stockId },
              data: {
                lastPrice: item.adjClose,
                lastVolume: item.volume,
                priceUpdatedAt: item.date,
              },
            }),
          ]);

          if (operations.length > 0) {
            await prisma.$transaction(operations);
          }
        }

        totalProcessed += validItems.length;

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

        console.log(`[${jobName}] ${exchangeId}: ${validItems.length} tickers synced`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[${jobName}] ${exchangeId} failed: ${msg}`);
        exchangeErrors.push(`${exchangeId}: ${msg}`);
      }
    }

    const durationMs = Date.now() - startedAt.getTime();
    const errorSummary =
      exchangeErrors.length > 0
        ? `${exchangeErrors.length} exchange(s) failed: ${exchangeErrors.join("; ")}`
        : null;

    await prisma.syncJob.upsert({
      where: { jobName },
      create: {
        jobName,
        lastRunAt: startedAt,
        lastSuccessAt: new Date(),
        tickersProcessed: totalProcessed,
        durationMs,
        lastError: errorSummary,
      },
      update: {
        lastRunAt: startedAt,
        lastSuccessAt: new Date(),
        lastError: errorSummary,
        tickersProcessed: totalProcessed,
        durationMs,
      },
    });

    console.log(
      `[${jobName}] Completed: ${totalProcessed} synced, ${totalSkipped} skipped${exchangeErrors.length > 0 ? `, ${exchangeErrors.length} exchange(s) with errors` : ""} in ${durationMs}ms`,
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
