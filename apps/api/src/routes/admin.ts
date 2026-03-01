import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

const VALID_ROLES = ["super_admin", "admin", "viewer"] as const;

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  role: z.enum(VALID_ROLES).default("viewer"),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(VALID_ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

/** Middleware: require super_admin role */
async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.user.role !== "super_admin") {
    return reply.status(403).send({
      success: false,
      error: { code: "FORBIDDEN", message: "Super-admin access required" },
    });
  }
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // All admin routes require super_admin
  fastify.addHook("onRequest", requireSuperAdmin);

  /**
   * GET /admin/users — List all users
   */
  fastify.get("/admin/users", async (_request, reply) => {
    const users = await fastify.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { presets: true, emailDigests: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({ success: true, data: users });
  });

  /**
   * POST /admin/users — Create a new user (invited by super_admin)
   */
  fastify.post<{ Body: unknown }>("/admin/users", async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid user data", details: parsed.error.flatten() },
      });
    }

    const existing = await fastify.prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Email already registered" },
      });
    }

    const hashedPassword = await hashPassword(parsed.data.password);

    const user = await fastify.prisma.user.create({
      data: {
        email: parsed.data.email,
        password: hashedPassword,
        name: parsed.data.name,
        role: parsed.data.role,
      },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });

    return reply.status(201).send({ success: true, data: user });
  });

  /**
   * PUT /admin/users/:id — Update a user (role, active status, name, password)
   */
  fastify.put<{ Params: { id: string }; Body: unknown }>(
    "/admin/users/:id",
    async (request, reply) => {
      const { id } = request.params;
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid update data" },
        });
      }

      const existing = await fastify.prisma.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "User not found" },
        });
      }

      // Prevent deactivating yourself
      if (id === request.user.userId && parsed.data.isActive === false) {
        return reply.status(400).send({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Cannot deactivate your own account" },
        });
      }

      const updateData: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
      if (parsed.data.password !== undefined) {
        updateData.password = await hashPassword(parsed.data.password);
      }

      const user = await fastify.prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, email: true, name: true, role: true, isActive: true, updatedAt: true },
      });

      return reply.send({ success: true, data: user });
    },
  );

  /**
   * DELETE /admin/users/:id — Delete a user
   */
  fastify.delete<{ Params: { id: string } }>(
    "/admin/users/:id",
    async (request, reply) => {
      const { id } = request.params;

      if (id === request.user.userId) {
        return reply.status(400).send({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Cannot delete your own account" },
        });
      }

      const existing = await fastify.prisma.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "User not found" },
        });
      }

      await fastify.prisma.user.delete({ where: { id } });
      return reply.send({ success: true, data: null });
    },
  );

  /**
   * GET /admin/sync-status — View sync job statuses
   */
  fastify.get("/admin/sync-status", async (_request, reply) => {
    const jobs = await fastify.prisma.syncJob.findMany({
      orderBy: { updatedAt: "desc" },
    });
    const pending = await fastify.prisma.systemConfig.findUnique({
      where: { key: "PENDING_SYNC" },
    });
    const pendingSync = pending?.value ?? null;

    // Derive status & details from raw fields for the frontend
    const enriched = jobs.map((job) => ({
      jobName: job.jobName,
      lastRunAt: job.lastRunAt?.toISOString() ?? null,
      updatedAt: job.updatedAt.toISOString(),
      status: pendingSync === job.jobName
        ? "pending"
        : job.lastError
          ? "error"
          : job.lastSuccessAt
            ? "success"
            : "unknown",
      details: job.lastError
        ?? (job.tickersProcessed
          ? `${job.tickersProcessed} tickers en ${((job.durationMs ?? 0) / 1000).toFixed(0)}s`
          : null),
    }));

    return reply.send({ success: true, data: enriched, pendingSync });
  });

  /**
   * POST /admin/sync-trigger/:jobName — Request a manual sync
   * The worker polls for PENDING_SYNC and executes it.
   */
  const VALID_SYNC_JOBS = ["sync-eod", "sync-tickers", "sync-fundamentals"] as const;

  fastify.post<{ Params: { jobName: string } }>(
    "/admin/sync-trigger/:jobName",
    async (request, reply) => {
      const { jobName } = request.params;

      if (!VALID_SYNC_JOBS.includes(jobName as (typeof VALID_SYNC_JOBS)[number])) {
        return reply.status(400).send({
          success: false,
          error: { code: "VALIDATION_ERROR", message: `Job invalide. Valides: ${VALID_SYNC_JOBS.join(", ")}` },
        });
      }

      // Check if a trigger is already pending
      const existing = await fastify.prisma.systemConfig.findUnique({
        where: { key: "PENDING_SYNC" },
      });
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: { code: "CONFLICT", message: `Un sync "${existing.value}" est deja en attente` },
        });
      }

      // Set the trigger for the worker to pick up
      await fastify.prisma.systemConfig.upsert({
        where: { key: "PENDING_SYNC" },
        create: { key: "PENDING_SYNC", value: jobName },
        update: { value: jobName },
      });

      return reply.send({ success: true, data: { message: `Sync "${jobName}" demandee`, jobName } });
    },
  );

  // ── System Configuration ──────────────────────────────────

  /**
   * GET /admin/config — Read all system config entries
   */
  fastify.get("/admin/config", async (_request, reply) => {
    const rows = await fastify.prisma.systemConfig.findMany();
    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    // Ensure SYNC_MODE always has a value
    if (!config.SYNC_MODE) {
      config.SYNC_MODE = process.env.SYNC_MODE ?? "daily";
    }
    return reply.send({ success: true, data: config });
  });

  const updateConfigSchema = z.object({
    key: z.string().min(1),
    value: z.string().min(1),
  });

  /** Allowed config keys and their valid values */
  const CONFIG_RULES: Record<string, string[]> = {
    SYNC_MODE: ["daily", "full"],
  };

  /**
   * PUT /admin/config — Upsert a single config key/value
   */
  fastify.put<{ Body: unknown }>("/admin/config", async (request, reply) => {
    const parsed = updateConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid config data" },
      });
    }

    const { key, value } = parsed.data;

    // Validate against allowed keys
    const allowedValues = CONFIG_RULES[key];
    if (!allowedValues) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: `Unknown config key: ${key}` },
      });
    }
    if (!allowedValues.includes(value)) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: `Invalid value for ${key}. Allowed: ${allowedValues.join(", ")}` },
      });
    }

    const row = await fastify.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    return reply.send({ success: true, data: row });
  });
}
