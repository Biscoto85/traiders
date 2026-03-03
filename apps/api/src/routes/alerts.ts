import type { FastifyInstance } from "fastify";
import { z } from "zod";

const ALERT_METRICS = [
  "lastPrice",
  "marketCap",
  "peRatio",
  "forwardPe",
  "pegRatio",
  "pbRatio",
  "psRatio",
  "evToEbitda",
  "evToRevenue",
  "dividendYield",
  "revenueGrowth",
  "earningsGrowth",
  "grossMargin",
  "operatingMargin",
  "netMargin",
  "roe",
  "roa",
  "debtToEquity",
  "currentRatio",
  "fcfYield",
  "beta",
  "qualityScore",
] as const;

const createAlertSchema = z.object({
  stockId: z.string().min(1),
  metric: z.enum(ALERT_METRICS),
  operator: z.enum(["above", "below"]),
  threshold: z.number(),
});

const ALERT_SELECT = {
  id: true,
  stockId: true,
  metric: true,
  operator: true,
  threshold: true,
  isTriggered: true,
  lastTriggeredAt: true,
  isActive: true,
  createdAt: true,
  stock: {
    select: {
      ticker: true,
      exchangeId: true,
      name: true,
      lastPrice: true,
    },
  },
} as const;

export async function alertRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /alerts — List current user's alerts
   */
  fastify.get("/alerts", async (request, reply) => {
    const alerts = await fastify.prisma.alert.findMany({
      where: { userId: request.user.userId },
      orderBy: { createdAt: "desc" },
      select: ALERT_SELECT,
    });

    return reply.send({ success: true, data: alerts });
  });

  /**
   * POST /alerts — Create a new alert
   */
  fastify.post<{ Body: unknown }>("/alerts", async (request, reply) => {
    const parsed = createAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid alert data", details: parsed.error.flatten() },
      });
    }

    // Verify stock exists
    const stock = await fastify.prisma.stock.findUnique({
      where: { id: parsed.data.stockId },
      select: { id: true },
    });
    if (!stock) {
      return reply.status(404).send({
        success: false,
        error: { code: "NOT_FOUND", message: "Stock not found" },
      });
    }

    // Max 50 alerts per user
    const count = await fastify.prisma.alert.count({
      where: { userId: request.user.userId },
    });
    if (count >= 50) {
      return reply.status(400).send({
        success: false,
        error: { code: "LIMIT_REACHED", message: "Maximum 50 alertes atteint" },
      });
    }

    const alert = await fastify.prisma.alert.create({
      data: {
        userId: request.user.userId,
        stockId: parsed.data.stockId,
        metric: parsed.data.metric,
        operator: parsed.data.operator,
        threshold: parsed.data.threshold,
      },
      select: ALERT_SELECT,
    });

    return reply.status(201).send({ success: true, data: alert });
  });

  /**
   * PUT /alerts/:id/toggle — Toggle active state
   */
  fastify.put<{ Params: { id: string } }>(
    "/alerts/:id/toggle",
    async (request, reply) => {
      const { id } = request.params;
      const existing = await fastify.prisma.alert.findUnique({ where: { id } });
      if (!existing || existing.userId !== request.user.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Alert not found" },
        });
      }

      const updated = await fastify.prisma.alert.update({
        where: { id },
        data: {
          isActive: !existing.isActive,
          // Re-arm: if re-activating, reset triggered state
          ...(!existing.isActive && { isTriggered: false }),
        },
        select: ALERT_SELECT,
      });

      return reply.send({ success: true, data: updated });
    },
  );

  /**
   * PUT /alerts/:id/rearm — Rearm a triggered alert
   */
  fastify.put<{ Params: { id: string } }>(
    "/alerts/:id/rearm",
    async (request, reply) => {
      const { id } = request.params;
      const existing = await fastify.prisma.alert.findUnique({ where: { id } });
      if (!existing || existing.userId !== request.user.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Alert not found" },
        });
      }

      const updated = await fastify.prisma.alert.update({
        where: { id },
        data: { isTriggered: false, isActive: true },
        select: ALERT_SELECT,
      });

      return reply.send({ success: true, data: updated });
    },
  );

  /**
   * DELETE /alerts/:id — Delete an alert
   */
  fastify.delete<{ Params: { id: string } }>(
    "/alerts/:id",
    async (request, reply) => {
      const { id } = request.params;
      const existing = await fastify.prisma.alert.findUnique({ where: { id } });
      if (!existing || existing.userId !== request.user.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Alert not found" },
        });
      }

      await fastify.prisma.alert.delete({ where: { id } });
      return reply.send({ success: true, data: null });
    },
  );

  /**
   * GET /alerts/metrics — List available metrics for alerts
   */
  fastify.get("/alerts/metrics", async (_request, reply) => {
    return reply.send({ success: true, data: ALERT_METRICS });
  });
}
