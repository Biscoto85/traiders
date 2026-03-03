/**
 * Reset a user's password from the command line.
 *
 * Usage (from VPS, inside the api container):
 *   docker exec -it traiders-api-1 node -e "
 *     import('./scripts/reset-password.js').then(m => m.default('EMAIL', 'NEW_PASSWORD'))
 *   "
 *
 * Or build and run directly:
 *   npx tsx apps/api/scripts/reset-password.ts <email> <new-password>
 */
import { PrismaClient } from "@prisma/client";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export default async function resetPassword(email: string, newPassword: string) {
  if (!email || !newPassword) {
    console.error("Usage: reset-password <email> <new-password>");
    process.exit(1);
  }
  if (newPassword.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }

    const hashed = await hashPassword(newPassword);
    await prisma.user.update({
      where: { email },
      data: { password: hashed, isActive: true },
    });

    console.log(`Password reset for ${email} (role: ${user.role}). Account is active.`);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI mode
const [email, password] = process.argv.slice(2);
if (email) {
  resetPassword(email, password).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
