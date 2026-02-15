import type { FastifyInstance } from "fastify";
import { screenerRequestSchema } from "@stock-screener/shared";
import { executeScreenerQuery } from "../services/screener.service.js";

export async function screenerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /screener
   * Run a screener query with filters, sort, and pagination.
   */
  fastify.post<{
    Body: unknown;
  }>("/screener", async (request, reply) => {
    const parsed = screenerRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid screener request",
          details: parsed.error.flatten(),
        },
      });
    }

    const { filters, sort, cursor, limit } = parsed.data;

    try {
      const result = await executeScreenerQuery(
        fastify.prisma,
        filters,
        sort,
        cursor,
        limit,
      );

      return reply.send({
        success: true,
        data: result.results.map((stock) => ({
          ...stock,
          lastVolume: stock.lastVolume?.toString() ?? null,
          exchange: stock.exchangeId,
        })),
        pagination: {
          totalCount: result.totalCount,
          nextCursor: result.nextCursor,
          limit,
        },
        appliedFilters: filters,
      });
    } catch (error) {
      fastify.log.error(error, "Screener query failed");
      return reply.status(500).send({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Screener query failed",
        },
      });
    }
  });
}
