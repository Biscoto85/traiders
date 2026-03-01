import Fastify from "fastify";
import { config } from "./config.js";
import prismaPlugin from "./plugins/prisma.js";
import corsPlugin from "./plugins/cors.js";
import rateLimitPlugin from "./plugins/rate-limit.js";
import jwtPlugin from "./plugins/jwt.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { stockRoutes } from "./routes/stocks.js";
import { screenerRoutes } from "./routes/screener.js";
import { presetRoutes } from "./routes/presets.js";
import { adminRoutes } from "./routes/admin.js";
import { emailDigestRoutes } from "./routes/email-digests.js";

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
  await fastify.register(rateLimitPlugin);
  await fastify.register(prismaPlugin);
  await fastify.register(jwtPlugin);

  // ── Public routes ──
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes, { prefix: "/api/v1" });

  // ── Protected routes (require JWT) ──
  await fastify.register(async function protectedRoutes(instance) {
    instance.addHook("onRequest", instance.authenticate);
    await instance.register(stockRoutes, { prefix: "/api/v1" });
    await instance.register(screenerRoutes, { prefix: "/api/v1" });
    await instance.register(presetRoutes, { prefix: "/api/v1" });
    await instance.register(emailDigestRoutes, { prefix: "/api/v1" });
    await instance.register(adminRoutes, { prefix: "/api/v1" });
  });

  // ── Start ──
  try {
    await fastify.listen({
      port: config.api.port,
      host: config.api.host,
    });
    fastify.log.info(
      `Traiders API running on http://${config.api.host}:${config.api.port}`,
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
