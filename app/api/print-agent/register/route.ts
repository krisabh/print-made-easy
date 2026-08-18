import { NextRequest } from "next/server";
import { z } from "zod";

import { runDocumentCleanupIfDue } from "@/lib/cleanup";
import { logError, logInfo, logWarn } from "@/lib/log";
import {
  generateAgentToken,
  hashAgentToken,
  hashPairingToken,
  safeEqualString,
} from "@/lib/print-agent-auth";
import { upsertShopPrinter } from "@/lib/print-agent-service";
import { prisma } from "@/lib/prisma";

const registerSchema = z
  .object({
    pairingToken: z.string().trim().min(20).max(256).optional(),
    shopCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    agentId: z.string().trim().min(1).max(128),
    selectedPrinter: z.string().trim().min(1).max(255).optional(),
    printerStatus: z.string().trim().min(1).max(64).optional(),
    setupSecret: z.string().trim().min(1).max(256).optional(),
  })
  .refine((data) => Boolean(data.pairingToken) || Boolean(data.shopCode), {
    message: "pairingToken or shopCode is required.",
  });

function getSetupSecret(request: NextRequest, bodySecret?: string) {
  return (
    request.headers.get("x-agent-setup-secret")?.trim() ||
    bodySecret?.trim() ||
    ""
  );
}

async function registerWithPairingToken(input: {
  pairingToken: string;
  agentId: string;
  selectedPrinter?: string;
  printerStatus?: string;
}) {
  const pairingHash = hashPairingToken(input.pairingToken);
  const now = new Date();
  const permanentToken = generateAgentToken();
  const permanentHash = hashAgentToken(permanentToken);

  const result = await prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<
      Array<{
        id: string;
        shopCode: string;
        shopName: string;
        agentPairingExpiresAt: Date | null;
        agentPairingUsedAt: Date | null;
      }>
    >`
      SELECT \`id\`, \`shopCode\`, \`shopName\`, \`agentPairingExpiresAt\`, \`agentPairingUsedAt\`
      FROM \`Shop\`
      WHERE \`agentPairingTokenHash\` = ${pairingHash}
        AND \`isActive\` = true
      LIMIT 1
      FOR UPDATE
    `;

    const shop = candidates[0];
    if (!shop) {
      return { error: "Invalid pairing credential.", status: 401 as const };
    }

    if (shop.agentPairingUsedAt) {
      return { error: "Pairing credential already used.", status: 401 as const };
    }

    if (
      !shop.agentPairingExpiresAt ||
      new Date(shop.agentPairingExpiresAt).getTime() <= now.getTime()
    ) {
      return { error: "Pairing credential expired.", status: 401 as const };
    }

    await tx.shop.update({
      where: { id: shop.id },
      data: {
        agentId: input.agentId,
        agentTokenHash: permanentHash,
        agentLastSeen: now,
        agentPairingUsedAt: now,
      },
    });

    return {
      shop: {
        id: shop.id,
        shopCode: shop.shopCode,
        shopName: shop.shopName,
      },
    };
  });

  if ("error" in result && result.error) {
    logWarn("agent_pairing_register_rejected", result.error);
    return Response.json({ error: result.error }, { status: result.status });
  }

  if (input.selectedPrinter && "shop" in result && result.shop) {
    await upsertShopPrinter({
      shopId: result.shop.id,
      printerName: input.selectedPrinter,
      status: (input.printerStatus || "online").toLowerCase(),
      isDefault: true,
    });
  }

  void runDocumentCleanupIfDue();
  if ("shop" in result && result.shop) {
    logInfo(
      "agent_registered_via_pairing",
      `${result.shop.shopCode} agent=${input.agentId}`,
    );
  }

  return Response.json({
    token: permanentToken,
    shop: "shop" in result ? result.shop : undefined,
  });
}

/**
 * Register / rotate Agent token for a shop.
 *
 * Paths:
 * 1) pairingToken + agentId  (secure SaaS pairing — Phase 2B-1)
 * 2) shopCode + AGENT_SETUP_SECRET (legacy/dev — preserved)
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

    if (parsed.data.pairingToken) {
      return registerWithPairingToken({
        pairingToken: parsed.data.pairingToken,
        agentId: parsed.data.agentId,
        selectedPrinter: parsed.data.selectedPrinter,
        printerStatus: parsed.data.printerStatus,
      });
    }

    const shopCode = parsed.data.shopCode!;
    const requiredSecret = process.env.AGENT_SETUP_SECRET?.trim();
    const providedSecret = getSetupSecret(request, parsed.data.setupSecret);

    if (requiredSecret) {
      if (
        !providedSecret ||
        !safeEqualString(providedSecret, requiredSecret)
      ) {
        logWarn("agent_register_unauthorized", shopCode);
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
        shopCode,
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
    logInfo("agent_registered", `${shopCode} agent=${parsed.data.agentId}`);

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
