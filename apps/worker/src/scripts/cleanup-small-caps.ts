/**
 * Cleanup script: remove stocks with marketCap < threshold.
 *
 * Usage:
 *   npx tsx apps/worker/src/scripts/cleanup-small-caps.ts [--dry-run] [--min-cap 50000000] [--force]
 *
 * All related DailyPrice, Fundamentals, and Bookmark rows are cascade-deleted.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const minCapIdx = args.indexOf("--min-cap");
const minMarketCap = minCapIdx !== -1 ? parseInt(args[minCapIdx + 1], 10) : 50_000_000;
const BATCH_SIZE = 500;

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  console.log(`\n=== Cleanup small caps (< ${(minMarketCap / 1e6).toFixed(0)}M) ===\n`);
  if (dryRun) console.log("  ** DRY RUN — no deletions **\n");

  // ── Check no sync is currently running ──
  const runningSync = await prisma.syncJob.findFirst({
    where: {
      jobName: "sync-fundamentals",
      lastSuccessAt: null,
      lastError: null,
      lastRunAt: { not: null },
    },
  });
  if (runningSync) {
    // Also check: if lastRunAt is recent (< 6h) and no success/error yet, it's likely still running
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    if (runningSync.lastRunAt && runningSync.lastRunAt > sixHoursAgo) {
      console.log("  ⚠  sync-fundamentals seems to be running (started " +
        runningSync.lastRunAt.toISOString() + ").");
      console.log("  Wait for it to finish before running cleanup.\n");
      console.log("  Use --force to bypass this check.\n");
      if (!args.includes("--force")) {
        await prisma.$disconnect();
        process.exit(1);
      }
      console.log("  --force used, proceeding anyway...\n");
    }
  }

  // ── Diagnostic ──
  const total = await prisma.stock.count();
  const toDelete = await prisma.stock.count({
    where: { marketCap: { not: null, lt: minMarketCap } },
  });
  const keepKnown = await prisma.stock.count({
    where: { marketCap: { gte: minMarketCap } },
  });
  const keepNull = await prisma.stock.count({
    where: { marketCap: null },
  });

  console.log(`  Total stocks:          ${total}`);
  console.log(`  To delete (< ${(minMarketCap / 1e6).toFixed(0)}M):   ${toDelete}`);
  console.log(`  Keep (>= ${(minMarketCap / 1e6).toFixed(0)}M):       ${keepKnown}`);
  console.log(`  Keep (cap unknown):    ${keepNull}`);
  console.log(`  After cleanup:         ${keepKnown + keepNull}\n`);

  if (toDelete === 0) {
    console.log("Nothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  if (dryRun) {
    // Show top 10 that would be deleted
    const samples = await prisma.stock.findMany({
      where: { marketCap: { not: null, lt: minMarketCap } },
      select: { ticker: true, name: true, exchangeId: true, marketCap: true },
      orderBy: { marketCap: "desc" },
      take: 10,
    });
    console.log("  Sample stocks that would be deleted (largest first):");
    for (const s of samples) {
      const cap = s.marketCap ? `${(s.marketCap / 1e6).toFixed(1)}M` : "?";
      console.log(`    ${s.ticker}.${s.exchangeId}  ${s.name ?? ""}  (${cap})`);
    }
    console.log(`\n  Run without --dry-run to delete.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── Delete in batches ──
  let deleted = 0;
  while (deleted < toDelete) {
    const batch = await prisma.stock.findMany({
      where: { marketCap: { not: null, lt: minMarketCap } },
      select: { id: true },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;

    const ids = batch.map((s) => s.id);
    await prisma.stock.deleteMany({ where: { id: { in: ids } } });
    deleted += batch.length;

    console.log(`  Deleted ${deleted}/${toDelete}...`);
  }

  console.log(`\n  Done: ${deleted} stocks removed (with cascade on DailyPrice, Fundamentals, Bookmarks).\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
