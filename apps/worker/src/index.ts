import { PrismaClient } from "@prisma/client";
import { CronJob } from "cron";
import { EODHDClient } from "@stock-screener/eodhd-client";
import { config, type SyncMode } from "./config.js";
import { runSyncEod } from "./jobs/sync-eod.js";
import { runSyncFundamentals } from "./jobs/sync-fundamentals.js";
import { runSyncTickers } from "./jobs/sync-tickers.js";
import { runEmailDigests } from "./jobs/send-email-digests.js";

/**
 * Read the current SYNC_MODE from the DB (SystemConfig table).
 * Falls back to the env-based default if no DB entry exists.
 */
async function getSyncMode(prisma: PrismaClient): Promise<SyncMode> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: "SYNC_MODE" },
    });
    if (row && (row.value === "daily" || row.value === "full")) {
      return row.value;
    }
  } catch {
    // Table may not exist yet (pre-migration) — fall back silently
  }
  return config.defaultSyncMode;
}

async function main() {
  console.log("Traiders Worker starting...");
  console.log(`Exchanges: ${config.exchanges.join(", ")}`);

  const prisma = new PrismaClient({
    log: ["warn", "error"],
  });

  await prisma.$connect();
  console.log("Database connected");

  const syncMode = await getSyncMode(prisma);
  console.log(`Sync mode: ${syncMode} (${syncMode === "full" ? "All-in-One plan — fundamentals enabled" : "All World plan — fundamentals skipped"})`);

  const eodhd = new EODHDClient({
    apiKey: config.eodhd.apiKey,
    baseUrl: config.eodhd.baseUrl,
  });

  // ── Define cron jobs ──

  const jobs: CronJob[] = [];

  // EOD prices: weekdays after market close (All World plan — always active)
  const eodJob = CronJob.from({
    cronTime: config.cron.syncEod,
    onTick: () => {
      runSyncEod(prisma, eodhd, config.exchanges).catch((err) =>
        console.error("EOD sync cron error:", err),
      );
    },
    timeZone: "America/New_York",
  });
  jobs.push(eodJob);
  console.log(`EOD sync scheduled: ${config.cron.syncEod}`);

  // Fundamentals: weekly — only in "full" mode (All-in-One plan)
  // Re-checks SYNC_MODE from DB on each tick so admin can toggle without restart.
  const fundamentalsJob = CronJob.from({
    cronTime: config.cron.syncFundamentals,
    onTick: async () => {
      const currentMode = await getSyncMode(prisma);
      if (currentMode !== "full") {
        console.log("[sync-fundamentals] Skipped — SYNC_MODE is 'daily'. Switch to 'full' (All-in-One plan) to enable.");
        return;
      }
      runSyncFundamentals(prisma, eodhd, config.exchanges).catch((err) =>
        console.error("Fundamentals sync cron error:", err),
      );
    },
    timeZone: "America/New_York",
  });
  jobs.push(fundamentalsJob);
  console.log(`Fundamentals sync scheduled: ${config.cron.syncFundamentals} (${syncMode === "full" ? "active" : "skipped in daily mode"})`);

  // Tickers: monthly (All World plan — always active)
  const tickersJob = CronJob.from({
    cronTime: config.cron.syncTickers,
    onTick: () => {
      runSyncTickers(prisma, eodhd, config.exchanges).catch((err) =>
        console.error("Tickers sync cron error:", err),
      );
    },
    timeZone: "America/New_York",
  });
  jobs.push(tickersJob);
  console.log(`Tickers sync scheduled: ${config.cron.syncTickers}`);

  // Email digests: weekly (Monday 8am Paris time)
  const mailConfig = {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user,
    pass: config.smtp.pass,
    from: config.smtp.from,
  };

  if (config.smtp.host) {
    const weeklyDigestJob = CronJob.from({
      cronTime: config.cron.emailDigestWeekly,
      onTick: () => {
        runEmailDigests(prisma, "weekly", mailConfig, config.appUrl).catch((err) =>
          console.error("Weekly email digest cron error:", err),
        );
      },
      timeZone: "Europe/Paris",
    });
    jobs.push(weeklyDigestJob);
    console.log(`Weekly email digest scheduled: ${config.cron.emailDigestWeekly}`);
  } else {
    console.log("SMTP not configured — email digests disabled");
  }

  // ── Start all jobs ──
  for (const job of jobs) {
    job.start();
  }

  // ── Poll for manual sync triggers (every 15s) ──
  let manualSyncRunning = false;

  const pollInterval = setInterval(async () => {
    if (manualSyncRunning) return;
    try {
      const pending = await prisma.systemConfig.findUnique({
        where: { key: "PENDING_SYNC" },
      });
      if (!pending) return;

      const jobName = pending.value;
      await prisma.systemConfig.delete({ where: { key: "PENDING_SYNC" } });

      manualSyncRunning = true;
      console.log(`[manual-trigger] Running ${jobName}...`);

      switch (jobName) {
        case "sync-eod":
          await runSyncEod(prisma, eodhd, config.exchanges);
          break;
        case "sync-tickers":
          await runSyncTickers(prisma, eodhd, config.exchanges);
          break;
        case "sync-fundamentals":
          await runSyncFundamentals(prisma, eodhd, config.exchanges);
          break;
        default:
          console.warn(`[manual-trigger] Unknown job: ${jobName}`);
      }

      console.log(`[manual-trigger] ${jobName} complete`);
    } catch (err) {
      console.error("[manual-trigger] Error:", err);
    } finally {
      manualSyncRunning = false;
    }
  }, 15_000);

  // ── Run initial sync on first startup ──
  const isFirstRun = !(await prisma.syncJob.findUnique({
    where: { jobName: "sync-tickers" },
  }));

  if (isFirstRun) {
    const initialMode = await getSyncMode(prisma);
    console.log("First run detected — starting initial data sync...");
    console.log("Step 1/3: Syncing ticker lists...");
    await runSyncTickers(prisma, eodhd, config.exchanges);
    console.log("Step 2/3: Syncing EOD prices...");
    await runSyncEod(prisma, eodhd, config.exchanges);
    if (initialMode === "full") {
      console.log("Step 3/3: Syncing fundamentals (this may take a while)...");
      await runSyncFundamentals(prisma, eodhd, config.exchanges);
    } else {
      console.log("Step 3/3: Fundamentals skipped (SYNC_MODE=daily). Switch to 'full' from admin to enable.");
    }
    console.log("Initial sync complete!");
  }

  console.log("Worker running. Press Ctrl+C to stop.");

  // ── Graceful shutdown ──
  const shutdown = async () => {
    console.log("Shutting down worker...");
    clearInterval(pollInterval);
    for (const job of jobs) {
      job.stop();
    }
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
