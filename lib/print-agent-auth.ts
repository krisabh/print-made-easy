import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { Shop } from "@prisma/client";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Agent heartbeat interval is 5s (print-agent main.ts).
 * Offline after 3 missed heartbeats. Not related to 1-hour file retention.
 */
export const AGENT_OFFLINE_MS = 15_000;
/** Allow tiny clock skew; reject multi-hour "future" lastSeen (TZ mis-parse). */
export const AGENT_CLOCK_SKEW_MS = 5_000;
export const MAX_PRINT_ATTEMPTS = 3;
export const DOCUMENT_RETENTION_MS = 60 * 60 * 1000; // 1 hour — files only, not agent status
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

/**
 * Feature 2 Phase 2B.1 — resolved Agent credential.
 * Prefer AgentDevice token; fall back to legacy Shop.agentTokenHash.
 */
export type AgentAuthContext = {
  shop: Shop;
  /** Populated when authenticated via AgentDevice.tokenHash. */
  agentDeviceId: string | null;
  agentId: string | null;
  /** true = matched Shop.agentTokenHash (pre–multi-device shim). */
  legacy: boolean;
};

/**
 * Resolve a Bearer agent token to shop (+ optional AgentDevice).
 * Does not update lastSeen (heartbeat remains the sole writer of online state).
 * Does not clear or mutate any credentials.
 */
export async function resolveAgentAuth(
  token: string,
): Promise<AgentAuthContext | null> {
  const tokenHash = hashAgentToken(token);

  const device = await prisma.agentDevice.findFirst({
    where: { tokenHash },
    include: { shop: true },
  });

  if (device?.shop?.isActive) {
    return {
      shop: device.shop,
      agentDeviceId: device.id,
      agentId: device.agentId,
      legacy: false,
    };
  }

  const shop = await prisma.shop.findFirst({
    where: {
      agentTokenHash: tokenHash,
      isActive: true,
    },
  });

  if (!shop) return null;

  return {
    shop,
    agentDeviceId: null,
    agentId: shop.agentId,
    legacy: true,
  };
}

/**
 * Full auth context for routes that need device identity later.
 * Existing callers that only need the Shop should keep using authenticateAgent().
 */
export async function authenticateAgentContext(
  request: NextRequest,
): Promise<AgentAuthContext | null> {
  const token = getBearerToken(request);
  if (!token) return null;
  return resolveAgentAuth(token);
}

/**
 * Authenticate Print Agent Bearer token → Shop.
 * Phase 2B.1: AgentDevice credentials preferred; Shop.agentTokenHash remains valid.
 * Return type stays Shop | null so existing API routes are unchanged.
 */
export async function authenticateAgent(request: NextRequest) {
  const ctx = await authenticateAgentContext(request);
  return ctx?.shop ?? null;
}

export function isAgentOnline(
  lastSeen: Date | null | undefined,
  now: Date = new Date(),
) {
  if (!lastSeen) return false;
  const ageMs = now.getTime() - lastSeen.getTime();
  // Far-future timestamps are timezone artifacts, not a live heartbeat.
  if (ageMs < -AGENT_CLOCK_SKEW_MS) return false;
  if (ageMs < 0) return true;
  return ageMs <= AGENT_OFFLINE_MS;
}

/** Status strings that mean the printer is currently usable. */
export function isReportedPrinterOnline(status: string | null | undefined) {
  const value = (status || "").trim().toLowerCase();
  return (
    value === "online" ||
    value === "idle" ||
    value === "printing" ||
    value === "ready" ||
    value === "warmup"
  );
}

/** Constant-time compare for setup secrets (when both present). */
export function safeEqualString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
