import { NextRequest } from "next/server";
import { z } from "zod";

import { runDocumentCleanupIfDue } from "@/lib/cleanup";
import { logError, logInfo, logWarn } from "@/lib/log";
import {
  generateAgentToken,
  hashAgentToken,
} from "@/lib/print-agent-auth";
import { upsertShopPrinter } from "@/lib/print-agent-service";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
  shopCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  agentId: z.string().trim().min(1).max(128),
  selectedPrinter: z.string().trim().min(1).max(255).optional(),
  printerStatus: z.string().trim().min(1).max(64).optional(),
  setupSecret: z.string().trim().min(1).max(256).optional(),
});

function getSetupSecret(request: NextRequest, bodySecret?: string) {
  return (
    request.headers.get("x-agent-setup-secret")?.trim() ||
    bodySecret?.trim() ||
    ""
  );
}

/**
 * Register / rotate Agent token for a shop.
 * In production, AGENT_SETUP_SECRET must be set and provided by the Agent.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid registration." },
        { status: 400 },
      );
    }

    const requiredSecret = process.env.AGENT_SETUP_SECRET?.trim();
    const providedSecret = getSetupSecret(request, parsed.data.setupSecret);

    if (requiredSecret) {
      if (!providedSecret || providedSecret !== requiredSecret) {
        logWarn("agent_register_unauthorized", parsed.data.shopCode);
        return Response.json({ error: "Unauthorized." }, { status: 401 });
      }
    } else if (process.env.NODE_ENV === "production") {
      logError("agent_register_blocked", "AGENT_SETUP_SECRET is not configured");
      return Response.json(
        { error: "Agent registration is not configured." },
        { status: 503 },
      );
    }

    const shop = await prisma.shop.findFirst({
      where: {
        shopCode: parsed.data.shopCode,
        isActive: true,
      },
    });

    if (!shop) {
      return Response.json({ error: "Shop not found." }, { status: 404 });
    }

    const token = generateAgentToken();
    const tokenHash = hashAgentToken(token);

    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        agentId: parsed.data.agentId,
        agentTokenHash: tokenHash,
        agentLastSeen: new Date(),
      },
    });

    if (parsed.data.selectedPrinter) {
      await upsertShopPrinter({
        shopId: shop.id,
        printerName: parsed.data.selectedPrinter,
        status: (parsed.data.printerStatus || "online").toLowerCase(),
        isDefault: true,
      });
    }

    void runDocumentCleanupIfDue();
    logInfo("agent_registered", `${parsed.data.shopCode} agent=${parsed.data.agentId}`);

    return Response.json({
      token,
      shop: {
        id: shop.id,
        shopCode: shop.shopCode,
        shopName: shop.shopName,
      },
    });
  } catch (error) {
    logError("agent_register_failed", error);
    return Response.json(
      { error: "Unable to register print agent." },
      { status: 500 },
    );
  }
}
