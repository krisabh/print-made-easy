import { NextRequest } from "next/server";
import { z } from "zod";

import { runDocumentCleanupIfDue } from "@/lib/cleanup";
import { logError } from "@/lib/log";
import { authenticateAgentContext } from "@/lib/print-agent-auth";
import {
  listShopPrinterCapabilities,
  PrinterOwnershipError,
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
    const auth = await authenticateAgentContext(request);
    if (!auth) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { shop, agentDeviceId } = auth;

    const body = await request.json().catch(() => ({}));
    const parsed = heartbeatSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid heartbeat payload." }, { status: 400 });
    }

    const now = new Date();

    // Feature 2 Phase 2D — device heartbeat writes AgentDevice.lastSeen only.
    // Legacy Shop-token heartbeat writes Shop.agentLastSeen only.
    // Do not invent AgentDevice rows; do not update sibling devices.
    if (agentDeviceId) {
      await prisma.agentDevice.update({
        where: { id: agentDeviceId },
        data: { lastSeen: now },
      });
    } else {
      await prisma.shop.update({
        where: { id: shop.id },
        data: { agentLastSeen: now },
      });
    }

    // Device scope always from auth — never trust a client-supplied agentDeviceId.
    const deviceScope = agentDeviceId;

    if (parsed.data.selectedPrinter) {
      // Agent selectedPrinter → device-local default (AgentDevice) or shop-wide
      // Printer.isDefault (legacy). Never modifies another device's default.
      await upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceScope,
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
          agentDeviceId: deviceScope,
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
        agentDeviceId: deviceScope,
        printerName: parsed.data.colorUpdate.printerName,
        colorSupported: parsed.data.colorUpdate.colorSupported,
      });
    }

    void runDocumentCleanupIfDue();

    // Device Agents only see their own capability rows (avoid sibling-name clash).
    // Legacy Agents still receive the full shop list.
    const printers = await listShopPrinterCapabilities(shop.id, {
      agentDeviceId: deviceScope,
    });

    return Response.json({
      ok: true,
      serverTime: new Date().toISOString(),
      printers,
    });
  } catch (error) {
    if (error instanceof PrinterOwnershipError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    logError("agent_heartbeat_failed", error);
    return Response.json(
      { error: "Unable to process heartbeat." },
      { status: 500 },
    );
  }
}
