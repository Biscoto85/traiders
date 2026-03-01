import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { screenerFiltersSchema, screenerSortSchema } from "@stock-screener/shared";

const createPresetSchema = z.object({
  name: z.string().min(1).max(100),
  filters: screenerFiltersSchema,
  sort: screenerSortSchema.optional(),
  isPublic: z.boolean().default(false),
});

const updatePresetSchema = createPresetSchema.partial();

export async function presetRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /presets — List user's presets + public presets
   */
  fastify.get("/presets", async (request, reply) => {
    const presets = await fastify.prisma.screenerPreset.findMany({
      where: {
        OR: [{ userId: request.user.userId }, { isPublic: true }],
      },
      orderBy: { updatedAt: "desc" },
      include: { user: { select: { name: true } } },
    });

    return reply.send({ success: true, data: presets });
  });

  /**
   * POST /presets — Create a new preset
   */
  fastify.post<{ Body: unknown }>("/presets", async (request, reply) => {
    const parsed = createPresetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid preset data", details: parsed.error.flatten() },
      });
    }

    const preset = await fastify.prisma.screenerPreset.create({
      data: {
        userId: request.user.userId,
        name: parsed.data.name,
        filters: parsed.data.filters as object,
        sort: parsed.data.sort as object | undefined,
        isPublic: parsed.data.isPublic,
      },
    });

    return reply.status(201).send({ success: true, data: preset });
  });

  /**
   * PUT /presets/:id — Update a preset
   */
  fastify.put<{ Params: { id: string }; Body: unknown }>(
    "/presets/:id",
    async (request, reply) => {
      const { id } = request.params;
      const parsed = updatePresetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid preset data" },
        });
      }

      // Only owner or super_admin can update
      const existing = await fastify.prisma.screenerPreset.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Preset not found" } });
      }
      if (existing.userId !== request.user.userId && request.user.role !== "super_admin") {
        return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "Not allowed" } });
      }

      const updated = await fastify.prisma.screenerPreset.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.filters !== undefined && { filters: parsed.data.filters as object }),
          ...(parsed.data.sort !== undefined && { sort: parsed.data.sort as object }),
          ...(parsed.data.isPublic !== undefined && { isPublic: parsed.data.isPublic }),
        },
      });

      return reply.send({ success: true, data: updated });
    },
  );

  /**
   * DELETE /presets/:id — Delete a preset
   */
  fastify.delete<{ Params: { id: string } }>(
    "/presets/:id",
    async (request, reply) => {
      const { id } = request.params;
      const existing = await fastify.prisma.screenerPreset.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Preset not found" } });
      }
      if (existing.userId !== request.user.userId && request.user.role !== "super_admin") {
        return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "Not allowed" } });
      }

      await fastify.prisma.screenerPreset.delete({ where: { id } });
      return reply.send({ success: true, data: null });
    },
  );
}
