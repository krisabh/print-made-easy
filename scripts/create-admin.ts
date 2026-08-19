/**
 * Bootstrap / promote an ADMIN user (CLI only — not exposed via web).
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_NAME="Admin" ADMIN_PASSWORD="..." npx tsx scripts/create-admin.ts
 *
 * Does not create a Shop. Does not print the password.
 */
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../lib/auth";

const prisma = new PrismaClient();

const UNSAFE_PASSWORDS = new Set([
  "password",
  "password123",
  "admin",
  "admin123",
  "12345678",
  "qwerty",
  "changeme",
  "printmadeeasy",
]);

function isUnsafePassword(password: string) {
  const normalized = password.trim().toLowerCase();
  if (password.length < 12) return true;
  if (UNSAFE_PASSWORDS.has(normalized)) return true;
  if (/^(.)\1+$/.test(password)) return true;
  return false;
}

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME || "Admin").trim() || "Admin";
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !email.includes("@")) {
    console.error("Set ADMIN_EMAIL to a valid email address.");
    process.exitCode = 1;
    return;
  }
  if (!password) {
    console.error("Set ADMIN_PASSWORD (min 12 characters, not a common default).");
    process.exitCode = 1;
    return;
  }
  if (isUnsafePassword(password)) {
    console.error(
      "ADMIN_PASSWORD is too weak or a known default. Use at least 12 characters.",
    );
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, shop: { select: { id: true } } },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name,
        role: "ADMIN",
        passwordHash,
      },
    });
    console.log(
      existing.role === "ADMIN"
        ? `Updated existing ADMIN user: ${email}`
        : `Promoted existing user to ADMIN: ${email}`,
    );
    if (existing.shop) {
      console.log(
        "Note: this user still has a linked Shop record; admin access does not use it.",
      );
    }
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "ADMIN",
      },
    });
    console.log(`Created ADMIN user: ${email}`);
  }

  console.log("No Shop was created for this admin.");
}

main()
  .catch((error) => {
    console.error("create-admin failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
