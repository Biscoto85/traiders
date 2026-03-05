import type { FastifyInstance } from "fastify";

export async function bookmarkRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /bookmarks — List user's bookmarked stocks
   */
  fastify.get("/bookmarks", async (request, reply) => {
    const bookmarks = await fastify.prisma.bookmark.findMany({
      where: { userId: request.user.userId },
      orderBy: { createdAt: "desc" },
      include: {
        stock: {
          select: {
            id: true,
            ticker: true,
            exchangeId: true,
            name: true,
            sector: true,
            industry: true,
            lastPrice: true,
            marketCap: true,
            peRatio: true,
            dividendYield: true,
            revenueGrowth: true,
            qualityScore: true,
            priceChange1D: true,
            priceChange1W: true,
            priceChange1M: true,
          },
        },
      },
    });

    return reply.send({ success: true, data: bookmarks });
  });

  /**
   * GET /bookmarks/ids — Just the stockIds (for quick lookup in screener)
   */
  fastify.get("/bookmarks/ids", async (request, reply) => {
    const bookmarks = await fastify.prisma.bookmark.findMany({
      where: { userId: request.user.userId },
      select: { stockId: true },
    });

    return reply.send({
      success: true,
      data: bookmarks.map((b) => b.stockId),
    });
  });

  /**
   * POST /bookmarks/:stockId — Bookmark a stock
   */
  fastify.post<{ Params: { stockId: string } }>(
    "/bookmarks/:stockId",
    async (request, reply) => {
      const { stockId } = request.params;

      const stock = await fastify.prisma.stock.findUnique({ where: { id: stockId } });
      if (!stock) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Stock not found" },
        });
      }

      const bookmark = await fastify.prisma.bookmark.upsert({
        where: {
          userId_stockId: {
            userId: request.user.userId,
            stockId,
          },
        },
        create: { userId: request.user.userId, stockId },
        update: {},
      });

      return reply.status(201).send({ success: true, data: bookmark });
    },
  );

  /**
   * DELETE /bookmarks/:stockId — Remove a bookmark
   */
  fastify.delete<{ Params: { stockId: string } }>(
    "/bookmarks/:stockId",
    async (request, reply) => {
      const { stockId } = request.params;

      const existing = await fastify.prisma.bookmark.findUnique({
        where: {
          userId_stockId: {
            userId: request.user.userId,
            stockId,
          },
        },
      });

      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Bookmark not found" },
        });
      }

      await fastify.prisma.bookmark.delete({
        where: { id: existing.id },
      });

      return reply.send({ success: true, data: null });
    },
  );
}
