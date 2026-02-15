import Fastify from "fastify";
import { config } from "./config.js";
import prismaPlugin from "./plugins/prisma.js";
import corsPlugin from "./plugins/cors.js";
import { healthRoutes } from "./routes/health.js";
import { stockRoutes } from "./routes/stocks.js";
import { screenerRoutes } from "./routes/screener.js";

async function main() {
  const fastify = Fastify({
    logger: {
      level: config.log.level,
      ...(config.isDev && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
    },
  });

  // ── Plugins ──
  await fastify.register(corsPlugin);
  await fastify.register(prismaPlugin);

  // ── Routes ──
  await fastify.register(healthRoutes);
  await fastify.register(stockRoutes, { prefix: "/api/v1" });
  await fastify.register(screenerRoutes, { prefix: "/api/v1" });

  // ── Start ──
  try {
    await fastify.listen({
      port: config.api.port,
      host: config.api.host,
    });
    fastify.log.info(
      `Stock Screener API running on http://${config.api.host}:${config.api.port}`,
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // ── Graceful shutdown ──
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, shutting down...`);
      await fastify.close();
      process.exit(0);
    });
  }
}

main();
