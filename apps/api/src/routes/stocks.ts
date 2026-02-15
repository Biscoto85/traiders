import type { FastifyInstance } from "fastify";
import { tickerParamSchema, priceHistoryQuerySchema } from "@stock-screener/shared";
import {
  getStockByTicker,
  getStockPriceHistory,
  getStockFundamentals,
  getFilterOptions,
} from "../services/stock.service.js";

export async function stockRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /stocks/:ticker
   * Get stock detail by ticker (optionally scoped to exchange).
   */
  fastify.get<{
    Params: { ticker: string };
    Querystring: { exchange?: string };
  }>("/stocks/:ticker", async (request, reply) => {
    const parsed = tickerParamSchema.safeParse({
      ticker: request.params.ticker,
      exchange: request.query.exchange,
    });

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message },
      });
    }

    const stock = await getStockByTicker(
      fastify.prisma,
      parsed.data.ticker.toUpperCase(),
      parsed.data.exchange?.toUpperCase(),
    );

    if (!stock) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Stock not found" },
      });
    }

    return reply.send({
      success: true,
      data: {
        ...stock,
        lastVolume: stock.lastVolume?.toString() ?? null,
      },
    });
  });

  /**
   * GET /stocks/:ticker/prices
   * Get OHLCV price history.
   */
  fastify.get<{
    Params: { ticker: string };
    Querystring: { from?: string; to?: string; period?: string; exchange?: string };
  }>("/stocks/:ticker/prices", async (request, reply) => {
    const stock = await getStockByTicker(
      fastify.prisma,
      request.params.ticker.toUpperCase(),
      request.query.exchange?.toUpperCase(),
    );

    if (!stock) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Stock not found" },
      });
    }

    const queryParsed = priceHistoryQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: queryParsed.error.message },
      });
    }

    const prices = await getStockPriceHistory(fastify.prisma, stock.id, {
      from: queryParsed.data.from,
      to: queryParsed.data.to,
    });

    return reply.send({
      success: true,
      data: prices.map((p) => ({
        ...p,
        date: p.date.toISOString().split("T")[0],
        volume: p.volume.toString(),
      })),
    });
  });

  /**
   * GET /stocks/:ticker/fundamentals
   * Get fundamental history (quarterly or annual).
   */
  fastify.get<{
    Params: { ticker: string };
    Querystring: { type?: string; limit?: string; exchange?: string };
  }>("/stocks/:ticker/fundamentals", async (request, reply) => {
    const stock = await getStockByTicker(
      fastify.prisma,
      request.params.ticker.toUpperCase(),
      request.query.exchange?.toUpperCase(),
    );

    if (!stock) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Stock not found" },
      });
    }

    const type = request.query.type === "annual" ? "annual" : "quarterly";
    const limit = Math.min(parseInt(request.query.limit ?? "20", 10) || 20, 100);

    const fundamentals = await getStockFundamentals(
      fastify.prisma,
      stock.id,
      type as "quarterly" | "annual",
      limit,
    );

    return reply.send({
      success: true,
      data: fundamentals,
    });
  });

  /**
   * GET /filters/options
   * Get available values for filter dropdowns.
   */
  fastify.get("/filters/options", async (_request, reply) => {
    const options = await getFilterOptions(fastify.prisma);
    return reply.send({ success: true, data: options });
  });
}
