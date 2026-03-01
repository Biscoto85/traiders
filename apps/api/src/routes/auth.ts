import type { FastifyInstance } from "fastify";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const scryptAsync = promisify(scrypt);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(hashBuffer, derivedKey);
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /auth/register
   * Create a new user account.
   * First user automatically gets admin role.
   */
  fastify.post<{ Body: unknown }>("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid registration data",
          details: parsed.error.flatten(),
        },
      });
    }

    const { email, password, name } = parsed.data;

    // Check if user already exists
    const existing = await fastify.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Email already registered" },
      });
    }

    // First user is super_admin
    const userCount = await fastify.prisma.user.count();
    const role = userCount === 0 ? "super_admin" : "viewer";

    const hashedPassword = await hashPassword(password);

    const user = await fastify.prisma.user.create({
      data: { email, password: hashedPassword, name, role },
      select: { id: true, email: true, name: true, role: true },
    });

    const token = fastify.jwt.sign({ userId: user.id, role: user.role });

    return reply.status(201).send({
      success: true,
      data: { user, token },
    });
  });

  /**
   * POST /auth/login
   */
  fastify.post<{ Body: unknown }>("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid credentials format" },
      });
    }

    const { email, password } = parsed.data;

    const user = await fastify.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid email or password" },
      });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid email or password" },
      });
    }

    const token = fastify.jwt.sign({ userId: user.id, role: user.role });

    return reply.send({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        token,
      },
    });
  });

  /**
   * GET /auth/me
   * Get current user info (requires auth).
   */
  fastify.get(
    "/auth/me",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "User not found" },
        });
      }

      return reply.send({ success: true, data: user });
    },
  );
}
