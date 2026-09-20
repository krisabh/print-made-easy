import { NextRequest } from "next/server";
import { z } from "zod";

import {
  checkAgentLoginRateLimit,
  clearAgentLoginFailuresForEmail,
  getClientIpFromRequest,
  recordAgentLoginFailure,
} from "@/lib/agent-login-rate-limit";
import {
  MULTI_DEVICE_LIMIT_ERROR,
  MULTI_DEVICE_LIMIT_STATUS,
  assertShopAllowsAgentDevice,
  resolveMultiDeviceLimit,
} from "@/lib/agent-device-limit";
import { verifyPassword } from "@/lib/auth";
import { logError, logInfo, logWarn } from "@/lib/log";
import {
  generateAgentToken,
  hashAgentToken,
} from "@/lib/print-agent-auth";
import { prisma } from "@/lib/prisma";
import { getSubscriptionAccessForShop } from "@/lib/subscription";

const GENERIC_AUTH_ERROR = "Invalid email or password.";
const RATE_LIMIT_ERROR = "Too many login attempts. Try again later.";

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(128),
  agentId: z.string().trim().min(1).max(128),
});

/**
 * POST /api/print-agent/login
 * Feature 2 Phase 2B.2 — Agent account login (email/password → AgentDevice token).
 * Shop is derived server-side from the authenticated User → Shop relation.
 * Does not overwrite Shop.agentTokenHash / Shop.agentId.
 * Phase 2F — failed-attempt rate limit (email + IP).
 * Shop-scoped MULTI_DEVICE_LIMIT — new agentId rejected when shop is at capacity;
 * same agentId reconnect/relogin always allowed.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIpFromRequest(request);

  try {
    const body = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    }

    const email = parsed.data.email.toLowerCase();
    const { password, agentId } = parsed.data;

    const rate = checkAgentLoginRateLimit({ email, ip });
    if (!rate.allowed) {
      logWarn("agent_login_rate_limited", `${rate.reason} email=${email}`);
      return Response.json({ error: RATE_LIMIT_ERROR }, { status: 429 });
    }

    const failAuth = () => {
      recordAgentLoginFailure({ email, ip });
      return Response.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    };

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        shop: {
          select: {
            id: true,
            shopCode: true,
            shopName: true,
            isActive: true,
          },
        },
      },
    });

    // Generic failure for missing user / wrong password / wrong role / no shop.
    if (!user) {
      return failAuth();
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) {
      return failAuth();
    }

    if (user.role !== "SHOPKEEPER" || !user.shop?.isActive) {
      return failAuth();
    }

    const shop = user.shop;
    const access = await getSubscriptionAccessForShop(shop.id);
    if (!access.hasAccess) {
      logWarn("agent_login_subscription_blocked", shop.shopCode);
      return Response.json(
        {
          error: "Subscription required to connect the Print Agent.",
        },
        { status: 402 },
      );
    }

    const token = generateAgentToken();
    const tokenHash = hashAgentToken(token);
    const now = new Date();
    const limit = resolveMultiDeviceLimit();

    const gate = await prisma.$transaction(async (tx) => {
      const decision = await assertShopAllowsAgentDevice(tx, {
        shopId: shop.id,
        agentId,
        limit,
      });

      if (!decision.allowed) {
        return {
          rejected: true as const,
          count: decision.count,
          limit: decision.limit,
        };
      }

      await tx.agentDevice.upsert({
        where: {
          shopId_agentId: {
            shopId: shop.id,
            agentId,
          },
        },
        create: {
          shopId: shop.id,
          agentId,
          tokenHash,
          lastSeen: now,
        },
        update: {
          tokenHash,
          lastSeen: now,
        },
      });

      return { rejected: false as const, reason: decision.reason };
    });

    if (gate.rejected) {
      logWarn(
        "agent_login_device_limit",
        `${shop.shopCode} agent=${agentId} count=${gate.count} limit=${gate.limit}`,
      );
      return Response.json(
        { error: MULTI_DEVICE_LIMIT_ERROR },
        { status: MULTI_DEVICE_LIMIT_STATUS },
      );
    }

    clearAgentLoginFailuresForEmail(email);
    logInfo("agent_login_ok", `${shop.shopCode} agent=${agentId}`);

    return Response.json(
      {
        token,
        agentId,
        shop: {
          id: shop.id,
          shopCode: shop.shopCode,
          shopName: shop.shopName,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError("agent_login_failed", error);
    return Response.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }
}
