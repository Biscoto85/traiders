import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";

async function corsPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(cors, {
    origin: config.isDev ? true : config.cors.origin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  });
}

export default fp(corsPlugin, {
  name: "cors",
});
