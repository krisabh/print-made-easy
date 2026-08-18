import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export const AGENT_OFFLINE_MS = 15_000;
export const MAX_PRINT_ATTEMPTS = 3;
export const DOCUMENT_RETENTION_MS = 60 * 60 * 1000; // 1 hour
/** Stuck PRINTING jobs return to PENDING after this (Agent crash / auth race). */
export const STALE_PRINTING_MS = 2 * 60 * 1000; // 2 minutes
/** One-time agent pairing token lifetime. */
export const AGENT_PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function hashAgentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateAgentToken() {
  return randomBytes(32).toString("hex");
}

/** High-entropy one-time pairing credential (URL-safe). */
export function generatePairingToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPairingToken(token: string) {
  return hashAgentToken(token);
}

export function getBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function authenticateAgent(request: NextRequest) {
  const token = getBearerToken(request);
  if (!token) return null;

  const tokenHash = hashAgentToken(token);
  const shop = await prisma.shop.findFirst({
    where: {
      agentTokenHash: tokenHash,
      isActive: true,
    },
  });

  if (!shop) return null;
  return shop;
}

export function isAgentOnline(lastSeen: Date | null | undefined) {
  if (!lastSeen) return false;
  return Date.now() - lastSeen.getTime() <= AGENT_OFFLINE_MS;
}

/** Constant-time compare for setup secrets (when both present). */
export function safeEqualString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
