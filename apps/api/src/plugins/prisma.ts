import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function prismaPlugin(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient({
    log: fastify.log.level === "debug"
      ? ["query", "info", "warn", "error"]
      : ["warn", "error"],
  });

  await prisma.$connect();
  fastify.log.info("Database connected");

  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
    fastify.log.info("Database disconnected");
  });
}

export default fp(prismaPlugin, {
  name: "prisma",
});
