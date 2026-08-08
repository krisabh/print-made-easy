import { NextRequest } from "next/server";
import { z } from "zod";

import { authenticateAgent } from "@/lib/print-agent-auth";
import {
  cleanupExpiredDocuments,
  upsertShopPrinter,
} from "@/lib/print-agent-service";
import { prisma } from "@/lib/prisma";

const heartbeatSchema = z.object({
  selectedPrinter: z.string().trim().min(1).optional(),
  printerStatus: z.string().trim().min(1).optional(),
  printers: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        status: z.string().trim().min(1).optional(),
      }),
    )
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const shop = await authenticateAgent(request);
    if (!shop) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = heartbeatSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid heartbeat payload." }, { status: 400 });
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date() },
    });

    if (parsed.data.selectedPrinter) {
      await upsertShopPrinter({
        shopId: shop.id,
        printerName: parsed.data.selectedPrinter,
        status: (parsed.data.printerStatus || "online").toLowerCase(),
        isDefault: true,
      });
    }

    if (parsed.data.printers?.length) {
      for (const printer of parsed.data.printers) {
        await upsertShopPrinter({
          shopId: shop.id,
          printerName: printer.name,
          status: (printer.status || "unknown").toLowerCase(),
          isDefault: printer.name === parsed.data.selectedPrinter,
        });
      }
    }

    // Lightweight safety cleanup on heartbeat
    await cleanupExpiredDocuments();

    return Response.json({
      ok: true,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Agent heartbeat failed:", error);
    return Response.json(
      { error: "Unable to process heartbeat." },
      { status: 500 },
    );
  }
}
