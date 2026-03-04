import type { PrismaClient } from "@prisma/client";
import type { EODHDClient } from "@stock-screener/eodhd-client";

const BATCH_SIZE = 500;

/**
 * Build a whitelist of `ticker:exchange` pairs from EODHD index constituents.
 * Each index costs 10 API calls. Returns null if no indices configured.
 */
async function buildIndexWhitelist(
  eodhd: EODHDClient,
  indices: string[],
): Promise<Map<string, Set<string>> | null> {
  if (indices.length === 0) return null;

  // Map<exchangeId, Set<ticker>>
  const whitelist = new Map<string, Set<string>>();
  let totalComponents = 0;

  for (const indexTicker of indices) {
    console.log(`[sync-tickers] Fetching constituents for ${indexTicker}.INDX...`);
    try {
      const components = await eodhd.fundamentals.getIndexComponents(indexTicker);
      const count = Object.keys(components).length;

      if (count === 0) {
        console.warn(`[sync-tickers] ${indexTicker}.INDX returned 0 components — check API plan or index code`);
        continue;
      }

      console.log(`[sync-tickers] ${indexTicker}.INDX: ${count} components`);

      for (const comp of Object.values(components)) {
        const exchangeId = comp.Exchange;
        if (!whitelist.has(exchangeId)) {
          whitelist.set(exchangeId, new Set());
        }
        whitelist.get(exchangeId)!.add(comp.Code);
        totalComponents++;
      }
    } catch (err) {
      console.error(
        `[sync-tickers] Failed to fetch ${indexTicker}.INDX: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `[sync-tickers] Index whitelist: ${totalComponents} unique tickers across ${whitelist.size} exchanges`,
  );

  return whitelist;
}

/**
 * Sync exchange ticker lists.
 * When indices are provided, only syncs stocks belonging to those indices.
 * Runs monthly.
 */
export async function runSyncTickers(
  prisma: PrismaClient,
  eodhd: EODHDClient,
  exchanges: string[],
  shouldAbort?: () => boolean,
  indices?: string[],
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
    // Build index whitelist if configured
    const whitelist = await buildIndexWhitelist(eodhd, indices ?? []);

    if (whitelist) {
      // When using indices, auto-expand exchanges to include all exchanges
      // referenced in the index constituents
      const indexExchanges = [...whitelist.keys()];
      const missingExchanges = indexExchanges.filter((e) => !exchanges.includes(e));
      if (missingExchanges.length > 0) {
        console.log(
          `[${jobName}] Auto-adding exchanges from indices: ${missingExchanges.join(", ")}`,
        );
        exchanges = [...exchanges, ...missingExchanges];
      }
    }

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

      // Skip exchanges with no index constituents early (saves an API call)
      if (whitelist) {
        const allowedTickers = whitelist.get(exchangeId);
        if (!allowedTickers || allowedTickers.size === 0) {
          console.log(
            `[${jobName}] ${exchangeId}: no index constituents — skipping`,
          );
          continue;
        }
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
      let symbols: Awaited<ReturnType<typeof eodhd.eod.getExchangeSymbols>>;
      try {
        symbols = await eodhd.eod.getExchangeSymbols(exchangeId);
      } catch (err) {
        console.error(
          `[${jobName}] ${exchangeId}: failed to fetch symbols — ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }
      const totalOnExchange = symbols.length;

      // Filter by index whitelist if configured
      if (whitelist) {
        const allowedTickers = whitelist.get(exchangeId)!;
        symbols = symbols.filter((s) => allowedTickers.has(s.Code));
        console.log(
          `[${jobName}] ${exchangeId}: ${symbols.length} index members out of ${totalOnExchange} total symbols`,
        );
      } else {
        console.log(
          `[${jobName}] ${exchangeId}: ${symbols.length} symbols from EODHD`,
        );
      }

      const remoteTickers = new Set(symbols.map((s) => s.Code));

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

      // Deactivate tickers no longer in the allowed set.
      // With index filtering: deactivate anything NOT in the index whitelist.
      // Without filtering: deactivate tickers no longer listed on the exchange.
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
          `[${jobName}] ${exchangeId}: deactivated ${deactivatedTotal} ${whitelist ? "non-index" : "delisted"} tickers`,
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
