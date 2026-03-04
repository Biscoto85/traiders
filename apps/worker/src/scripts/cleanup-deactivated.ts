/**
 * Cleanup script: remove all deactivated (isActive=false) stocks.
 *
 * Run this after sync-tickers with SYNC_INDICES to purge non-index stocks.
 *
 * Usage:
 *   npx tsx apps/worker/src/scripts/cleanup-deactivated.ts [--dry-run]
 *
 * All related DailyPrice, Fundamentals, Bookmarks, and Alerts are cascade-deleted.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: existsSync(".env.production") ? ".env.production" : ".env" });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const BATCH_SIZE = 500;

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  console.log(`\n=== Cleanup deactivated stocks ===\n`);
  if (dryRun) console.log("  ** DRY RUN — no deletions **\n");

  const total = await prisma.stock.count();
  const toDelete = await prisma.stock.count({ where: { isActive: false } });
  const keepActive = total - toDelete;

  console.log(`  Total stocks:      ${total}`);
  console.log(`  Deactivated:       ${toDelete}`);
  console.log(`  Active (keeping):  ${keepActive}\n`);

  if (toDelete === 0) {
    console.log("Nothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  if (dryRun) {
    const byExchange = await prisma.stock.groupBy({
      by: ["exchangeId"],
      where: { isActive: false },
      _count: true,
    });
    console.log("  Deactivated stocks by exchange:");
    for (const row of byExchange) {
      console.log(`    ${row.exchangeId}: ${row._count}`);
    }
    console.log(`\n  Run without --dry-run to delete.\n`);
    await prisma.$disconnect();
    return;
  }

  // Delete in batches (cascade handles DailyPrice, Fundamentals, Bookmarks, Alerts)
  let deleted = 0;
  while (deleted < toDelete) {
    const batch = await prisma.stock.findMany({
      where: { isActive: false },
      select: { id: true },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;

    const ids = batch.map((s) => s.id);
    await prisma.stock.deleteMany({ where: { id: { in: ids } } });
    deleted += batch.length;

    console.log(`  Deleted ${deleted}/${toDelete}...`);
  }

  console.log(`\n  Done: ${deleted} stocks removed (with cascade).\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
