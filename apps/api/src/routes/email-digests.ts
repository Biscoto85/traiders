import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { screenerFiltersSchema } from "@stock-screener/shared";

const createDigestSchema = z.object({
  name: z.string().min(1).max(100),
  filters: screenerFiltersSchema,
  schedule: z.enum(["daily", "weekly"]).default("weekly"),
});

const updateDigestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  filters: screenerFiltersSchema.optional(),
  schedule: z.enum(["daily", "weekly"]).optional(),
  isActive: z.boolean().optional(),
});

export async function emailDigestRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /email-digests — List current user's digests
   */
  fastify.get("/email-digests", async (request, reply) => {
    const digests = await fastify.prisma.emailDigest.findMany({
      where: { userId: request.user.userId },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({ success: true, data: digests });
  });

  /**
   * POST /email-digests — Create a new digest
   */
  fastify.post<{ Body: unknown }>("/email-digests", async (request, reply) => {
    const parsed = createDigestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid digest data", details: parsed.error.flatten() },
      });
    }

    const digest = await fastify.prisma.emailDigest.create({
      data: {
        userId: request.user.userId,
        name: parsed.data.name,
        filters: parsed.data.filters as object,
        schedule: parsed.data.schedule,
      },
    });

    return reply.status(201).send({ success: true, data: digest });
  });

  /**
   * PUT /email-digests/:id — Update a digest
   */
  fastify.put<{ Params: { id: string }; Body: unknown }>(
    "/email-digests/:id",
    async (request, reply) => {
      const { id } = request.params;
      const parsed = updateDigestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid update data" },
        });
      }

      const existing = await fastify.prisma.emailDigest.findUnique({ where: { id } });
      if (!existing || existing.userId !== request.user.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Digest not found" },
        });
      }

      const updated = await fastify.prisma.emailDigest.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.filters !== undefined && { filters: parsed.data.filters as object }),
          ...(parsed.data.schedule !== undefined && { schedule: parsed.data.schedule }),
          ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        },
      });

      return reply.send({ success: true, data: updated });
    },
  );

  /**
   * DELETE /email-digests/:id — Delete a digest
   */
  fastify.delete<{ Params: { id: string } }>(
    "/email-digests/:id",
    async (request, reply) => {
      const { id } = request.params;
      const existing = await fastify.prisma.emailDigest.findUnique({ where: { id } });
      if (!existing || existing.userId !== request.user.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Digest not found" },
        });
      }

      await fastify.prisma.emailDigest.delete({ where: { id } });
      return reply.send({ success: true, data: null });
    },
  );
}
