import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_SIZE = 500;

/**
 * Sync exchange ticker lists.
 * Adds new tickers, deactivates removed ones.
 * Runs monthly.
 */
export async function runSyncTickers(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchanges: string[],
  shouldAbort?: () => boolean,
): Promise<void> {
  const jobName = "sync-tickers";
  const startedAt = new Date();

  console.log(`[${jobName}] Starting ticker sync...`);

  let totalProcessed = 0;

  // Mark job as running
  await prisma.syncJob.upsert({
    where: { jobName },
    create: { jobName, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null, durationMs: null, tickersProcessed: 0 },
  });

  try {
    // Fetch exchange list once (not per exchange)
    const exchangeInfo = await eodhd.eod.getExchangesList();

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

      // Ensure exchange record exists
      const exInfo = exchangeInfo.find((e) => e.Code === exchangeId);

      if (exInfo) {
        await prisma.exchange.upsert({
          where: { id: exchangeId },
          create: {
            id: exchangeId,
            name: exInfo.Name,
            country: exInfo.Country,
            currency: exInfo.Currency,
            timezone: "UTC", // EODHD doesn't provide timezone directly
          },
          update: {
            name: exInfo.Name,
            country: exInfo.Country,
            currency: exInfo.Currency,
          },
        });
      }

      // Fetch all symbols for this exchange
      const symbols = await eodhd.eod.getExchangeSymbols(exchangeId);
      const remoteTickers = new Set(symbols.map((s) => s.Code));

      console.log(
        `[${jobName}] ${exchangeId}: ${symbols.length} symbols from EODHD`,
      );

      // Upsert symbols in batches
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);

        await prisma.$transaction(
          batch.map((sym) =>
            prisma.stock.upsert({
              where: {
                ticker_exchangeId: { ticker: sym.Code, exchangeId },
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

        totalProcessed += batch.length;
      }

      // Deactivate tickers no longer listed on the exchange.
      // PostgreSQL limits bind variables to 32767 per statement, so if the
      // remote ticker list is large we chunk the notIn query.
      const remoteArray = [...remoteTickers];
      const CHUNK_SIZE = 15_000; // stay well under 32767 limit
      let deactivatedTotal = 0;

      if (remoteArray.length <= CHUNK_SIZE) {
        // Small enough for a single query
        const result = await prisma.stock.updateMany({
          where: {
            exchangeId,
            isActive: true,
            ticker: { notIn: remoteArray },
          },
          data: { isActive: false },
        });
        deactivatedTotal = result.count;
      } else {
        // Large exchange: find active tickers first, then deactivate
        // those not in the remote set (avoids bind variable overflow)
        const activeStocks = await prisma.stock.findMany({
          where: { exchangeId, isActive: true },
          select: { id: true, ticker: true },
        });
        const toDeactivate = activeStocks
          .filter((s) => !remoteTickers.has(s.ticker))
          .map((s) => s.id);

        // Batch the deactivation in chunks
        for (let i = 0; i < toDeactivate.length; i += CHUNK_SIZE) {
          const chunk = toDeactivate.slice(i, i + CHUNK_SIZE);
          const result = await prisma.stock.updateMany({
            where: { id: { in: chunk } },
            data: { isActive: false },
          });
          deactivatedTotal += result.count;
        }
      }

      if (deactivatedTotal > 0) {
        console.log(
          `[${jobName}] ${exchangeId}: deactivated ${deactivatedTotal} delisted tickers`,
        );
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
        lastError: null,
        tickersProcessed: totalProcessed,
        durationMs,
      },
    });

    console.log(
      `[${jobName}] Done: ${totalProcessed} tickers synced in ${durationMs}ms`,
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
