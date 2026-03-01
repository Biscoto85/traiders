import { PrismaClient } from "@prisma/client";
import { CronJob } from "cron";
import { EODHDClient } from "@stock-screener/eodhd-client";
import { config } from "./config.js";
import { runSyncEod } from "./jobs/sync-eod.js";
import { runSyncFundamentals } from "./jobs/sync-fundamentals.js";
import { runSyncTickers } from "./jobs/sync-tickers.js";
import { runEmailDigests } from "./jobs/send-email-digests.js";

async function main() {
  console.log("Traiders Worker starting...");
  console.log(`Exchanges: ${config.exchanges.join(", ")}`);

  const prisma = new PrismaClient({
    log: ["warn", "error"],
  });

  await prisma.$connect();
  console.log("Database connected");

  const eodhd = new EODHDClient({
    apiKey: config.eodhd.apiKey,
    baseUrl: config.eodhd.baseUrl,
  });

  // ── Define cron jobs ──

  const jobs: CronJob[] = [];

  // EOD prices: weekdays after market close
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

  // Fundamentals: weekly
  const fundamentalsJob = CronJob.from({
    cronTime: config.cron.syncFundamentals,
    onTick: () => {
      runSyncFundamentals(prisma, eodhd, config.exchanges).catch((err) =>
        console.error("Fundamentals sync cron error:", err),
      );
    },
    timeZone: "America/New_York",
  });
  jobs.push(fundamentalsJob);
  console.log(`Fundamentals sync scheduled: ${config.cron.syncFundamentals}`);

  // Tickers: monthly
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
        runEmailDigests(prisma, "weekly", mailConfig).catch((err) =>
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

  // ── Run initial sync on first startup ──
  const isFirstRun = !(await prisma.syncJob.findUnique({
    where: { jobName: "sync-tickers" },
  }));

  if (isFirstRun) {
    console.log("First run detected — starting initial data sync...");
    console.log("Step 1/3: Syncing ticker lists...");
    await runSyncTickers(prisma, eodhd, config.exchanges);
    console.log("Step 2/3: Syncing EOD prices...");
    await runSyncEod(prisma, eodhd, config.exchanges);
    console.log("Step 3/3: Syncing fundamentals (this may take a while)...");
    await runSyncFundamentals(prisma, eodhd, config.exchanges);
    console.log("Initial sync complete!");
  }

  console.log("Worker running. Press Ctrl+C to stop.");

  // ── Graceful shutdown ──
  const shutdown = async () => {
    console.log("Shutting down worker...");
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
