import { NextRequest } from "next/server";
import { z } from "zod";

import { runDocumentCleanupIfDue } from "@/lib/cleanup";
import { logError } from "@/lib/log";
import { authenticateAgent } from "@/lib/print-agent-auth";
import {
  listShopPrinterCapabilities,
  setShopPrinterColorSupported,
  upsertShopPrinter,
} from "@/lib/print-agent-service";
import { prisma } from "@/lib/prisma";

const heartbeatSchema = z.object({
  selectedPrinter: z.string().trim().min(1).max(255).optional(),
  printerStatus: z.string().trim().min(1).max(64).optional(),
  printers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        status: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .max(50)
    .optional(),
  /** Explicit shopkeeper capability change (does not reset others). */
  colorUpdate: z
    .object({
      printerName: z.string().trim().min(1).max(255),
      colorSupported: z.boolean(),
    })
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
      // Authoritative shop default from Agent config — even if the printer is
      // temporarily absent from the detected list (do not promote another).
      // colorSupported is never written here (preserve / default false on create).
      await upsertShopPrinter({
        shopId: shop.id,
        printerName: parsed.data.selectedPrinter,
        status: (parsed.data.printerStatus || "unknown").toLowerCase(),
        isDefault: true,
      });
    }

    if (parsed.data.printers?.length) {
      for (const printer of parsed.data.printers) {
        const isSelected =
          Boolean(parsed.data.selectedPrinter) &&
          printer.name === parsed.data.selectedPrinter;
        await upsertShopPrinter({
          shopId: shop.id,
          printerName: printer.name,
          status: (printer.status || "unknown").toLowerCase(),
          // Never mark a non-selected detected printer as default.
          isDefault: isSelected,
        });
      }
    }

    if (parsed.data.colorUpdate) {
      await setShopPrinterColorSupported({
        shopId: shop.id,
        printerName: parsed.data.colorUpdate.printerName,
        colorSupported: parsed.data.colorUpdate.colorSupported,
      });
    }

    void runDocumentCleanupIfDue();

    const printers = await listShopPrinterCapabilities(shop.id);

    return Response.json({
      ok: true,
      serverTime: new Date().toISOString(),
      printers,
    });
  } catch (error) {
    logError("agent_heartbeat_failed", error);
    return Response.json(
      { error: "Unable to process heartbeat." },
      { status: 500 },
    );
  }
}
