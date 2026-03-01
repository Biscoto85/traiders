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

      // Deactivate tickers no longer listed on the exchange
      const deactivated = await prisma.stock.updateMany({
        where: {
          exchangeId,
          isActive: true,
          ticker: { notIn: [...remoteTickers] },
        },
        data: { isActive: false },
      });

      if (deactivated.count > 0) {
        console.log(
          `[${jobName}] ${exchangeId}: deactivated ${deactivated.count} delisted tickers`,
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
    console.error(`[${jobName}] Fatal:`, message);

    await prisma.syncJob.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: startedAt, lastError: message },
      update: { lastRunAt: startedAt, lastError: message },
    });
  }
}
