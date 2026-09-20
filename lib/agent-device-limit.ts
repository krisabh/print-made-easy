import type { Prisma } from "@prisma/client";

import { logWarn } from "@/lib/log";

/** Safe user-facing rejection when a shop cannot register another Agent device. */
export const MULTI_DEVICE_LIMIT_ERROR =
  "This shop has reached its device limit. Contact support to add another device.";

/** HTTP status for device-limit rejection (not an auth failure). */
export const MULTI_DEVICE_LIMIT_STATUS = 403 as const;

/**
 * Default when MULTI_DEVICE_LIMIT is unset or empty.
 * Production should set MULTI_DEVICE_LIMIT=2 explicitly.
 */
export const DEFAULT_MULTI_DEVICE_LIMIT = 2;

const POSITIVE_INT_RE = /^[1-9]\d*$/;

/**
 * Resolve MULTI_DEVICE_LIMIT from env (or an explicit override for tests).
 *
 * - Missing / empty → DEFAULT_MULTI_DEVICE_LIMIT (2)
 * - Positive integer string → that value
 * - Zero, negative, or non-numeric → reject; fall back to default and log
 *   (never invent a higher limit from garbage input)
 */
export function resolveMultiDeviceLimit(
  envValue: string | undefined = process.env.MULTI_DEVICE_LIMIT,
): number {
  const raw = envValue?.trim() ?? "";
  if (!raw) {
    return DEFAULT_MULTI_DEVICE_LIMIT;
  }

  if (!POSITIVE_INT_RE.test(raw)) {
    logWarn(
      "multi_device_limit_invalid",
      `MULTI_DEVICE_LIMIT=${JSON.stringify(raw)} — using default ${DEFAULT_MULTI_DEVICE_LIMIT}`,
    );
    return DEFAULT_MULTI_DEVICE_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  // Guard against overflow / non-safe integers
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    logWarn(
      "multi_device_limit_invalid",
      `MULTI_DEVICE_LIMIT=${JSON.stringify(raw)} — using default ${DEFAULT_MULTI_DEVICE_LIMIT}`,
    );
    return DEFAULT_MULTI_DEVICE_LIMIT;
  }

  return parsed;
}

export type AgentDeviceLimitDecision =
  | { allowed: true; reason: "existing_device" | "under_limit" }
  | { allowed: false; reason: "limit_reached"; count: number; limit: number };

/**
 * Shop-scoped registered-device gate.
 *
 * A "device" is an AgentDevice row for (shopId, agentId).
 * Count = all registered AgentDevice rows for the shop (not lastSeen freshness).
 * Same agentId always allowed (reconnect / relogin must not hit the limit).
 */
export async function evaluateAgentDeviceLimit(
  tx: Prisma.TransactionClient,
  input: {
    shopId: string;
    agentId: string;
    limit?: number;
  },
): Promise<AgentDeviceLimitDecision> {
  const limit = input.limit ?? resolveMultiDeviceLimit();
  const agentId = input.agentId.trim();

  const existing = await tx.agentDevice.findUnique({
    where: {
      shopId_agentId: {
        shopId: input.shopId,
        agentId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    return { allowed: true, reason: "existing_device" };
  }

  const count = await tx.agentDevice.count({
    where: { shopId: input.shopId },
  });

  if (count >= limit) {
    return { allowed: false, reason: "limit_reached", count, limit };
  }

  return { allowed: true, reason: "under_limit" };
}

/**
 * Serialize new-device registration per shop via SELECT … FOR UPDATE on Shop,
 * then evaluate the registered-device limit.
 *
 * Callers must only proceed to AgentDevice create/upsert when allowed.
 */
export async function assertShopAllowsAgentDevice(
  tx: Prisma.TransactionClient,
  input: {
    shopId: string;
    agentId: string;
    limit?: number;
  },
): Promise<AgentDeviceLimitDecision> {
  await tx.$queryRaw`
    SELECT \`id\` FROM \`Shop\` WHERE \`id\` = ${input.shopId} FOR UPDATE
  `;
  return evaluateAgentDeviceLimit(tx, input);
}
