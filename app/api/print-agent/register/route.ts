import { NextRequest } from "next/server";
import { z } from "zod";

import {
  generateAgentToken,
  hashAgentToken,
} from "@/lib/print-agent-auth";
import {
  cleanupExpiredDocuments,
  upsertShopPrinter,
} from "@/lib/print-agent-service";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
  shopCode: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  selectedPrinter: z.string().trim().min(1).optional(),
  printerStatus: z.string().trim().min(1).optional(),
});

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

    await cleanupExpiredDocuments();

    return Response.json({
      token,
      shop: {
        id: shop.id,
        shopCode: shop.shopCode,
        shopName: shop.shopName,
      },
    });
  } catch (error) {
    console.error("Agent register failed:", error);
    return Response.json(
      { error: "Unable to register print agent." },
      { status: 500 },
    );
  }
}
