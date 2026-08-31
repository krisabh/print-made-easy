import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { getPublicAppBaseUrl } from "@/lib/app-url";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { buildPasswordResetEmail, sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account exists for this email, we've sent password reset instructions.";

/** Min interval between reset emails for the same address. */
const EMAIL_COOLDOWN_MS = 60_000;
/** Max reset attempts per email per rolling window. */
const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_WINDOW_MAX = 5;
/** Max reset attempts per IP per rolling window. */
const IP_WINDOW_MS = 60 * 60 * 1000;
const IP_WINDOW_MAX = 20;

type WindowState = { count: number; windowStartedAt: number };
type CooldownState = { lastAt: number };

const emailWindows = new Map<string, WindowState>();
const emailCooldowns = new Map<string, CooldownState>();
const ipWindows = new Map<string, WindowState>();

export function hashPasswordResetToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generatePasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

function allowWindow(
  map: Map<string, WindowState>,
  key: string,
  windowMs: number,
  max: number,
  nowMs: number,
) {
  const existing = map.get(key);
  if (!existing || nowMs - existing.windowStartedAt > windowMs) {
    map.set(key, { count: 1, windowStartedAt: nowMs });
    return true;
  }
  if (existing.count >= max) return false;
  existing.count += 1;
  return true;
}

/** Test helper — clears in-memory rate-limit state. */
export function resetPasswordResetRateLimits() {
  emailWindows.clear();
  emailCooldowns.clear();
  ipWindows.clear();
}

export function checkPasswordResetRateLimit(input: {
  email: string;
  ip?: string | null;
  now?: Date;
}) {
  const nowMs = (input.now || new Date()).getTime();
  const emailKey = input.email.trim().toLowerCase();

  const last = emailCooldowns.get(emailKey);
  if (last && nowMs - last.lastAt < EMAIL_COOLDOWN_MS) {
    return { allowed: false as const, reason: "email_cooldown" as const };
  }

  if (!allowWindow(emailWindows, emailKey, EMAIL_WINDOW_MS, EMAIL_WINDOW_MAX, nowMs)) {
    return { allowed: false as const, reason: "email_window" as const };
  }

  if (input.ip) {
    if (!allowWindow(ipWindows, input.ip, IP_WINDOW_MS, IP_WINDOW_MAX, nowMs)) {
      return { allowed: false as const, reason: "ip_window" as const };
    }
  }

  emailCooldowns.set(emailKey, { lastAt: nowMs });
  return { allowed: true as const };
}

export async function createPasswordResetForUser(input: {
  userId: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const rawToken = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

  await prisma.passwordResetToken.deleteMany({
    where: { userId: input.userId, usedAt: null },
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: input.userId,
      tokenHash,
      expiresAt,
    },
  });

  return { rawToken, tokenHash, expiresAt };
}

export async function findValidPasswordResetToken(input: {
  rawToken: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const tokenHash = hashPasswordResetToken(input.rawToken);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, email: true, name: true, passwordHash: true },
      },
    },
  });

  if (!row) {
    return { ok: false as const, reason: "invalid" as const };
  }
  if (row.usedAt) {
    return { ok: false as const, reason: "used" as const };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false as const, reason: "expired" as const };
  }
  return { ok: true as const, token: row };
}

export async function requestPasswordReset(input: {
  email: string;
  ip?: string | null;
  now?: Date;
  /** Inject for tests — skips live SMTP when provided. */
  sendEmail?: typeof sendMail;
  /** Inject public base URL for tests. */
  appBaseUrl?: string;
}) {
  const now = input.now || new Date();
  const email = input.email.trim().toLowerCase();
  const generic = {
    ok: true as const,
    message: PASSWORD_RESET_GENERIC_MESSAGE,
  };

  const rate = checkPasswordResetRateLimit({
    email,
    ip: input.ip,
    now,
  });
  if (!rate.allowed) {
    return generic;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return generic;
  }

  const { rawToken } = await createPasswordResetForUser({
    userId: user.id,
    now,
  });

  const baseUrl =
    input.appBaseUrl ||
    (await getPublicAppBaseUrl()).replace(/\/$/, "");
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const content = buildPasswordResetEmail({
    resetUrl,
    recipientName: user.name,
  });

  try {
    const send = input.sendEmail || sendMail;
    await send({
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch {
    console.error("password reset email failed");
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });
  }

  return generic;
}

export async function resetPasswordWithToken(input: {
  rawToken: string;
  newPassword: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const found = await findValidPasswordResetToken({
    rawToken: input.rawToken,
    now,
  });
  if (!found.ok) {
    return {
      ok: false as const,
      reason: found.reason,
      error:
        found.reason === "expired"
          ? "This reset link has expired. Request a new one."
          : found.reason === "used"
            ? "This reset link has already been used. Request a new one."
            : "This reset link is invalid. Request a new one.",
    };
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: found.token.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.update({
      where: { id: found.token.id },
      data: { usedAt: now },
    });
    await tx.passwordResetToken.deleteMany({
      where: {
        userId: found.token.userId,
        usedAt: null,
        id: { not: found.token.id },
      },
    });
  });

  return { ok: true as const, userId: found.token.userId };
}

export async function userPasswordMatches(input: {
  userId: string;
  password: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { passwordHash: true },
  });
  if (!user) return false;
  return verifyPassword(input.password, user.passwordHash);
}

export function hashesEqual(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
