import { NextRequest } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/log";
import { authenticateAgent } from "@/lib/print-agent-auth";
import { setShopPrinterColorSupported } from "@/lib/print-agent-service";

const bodySchema = z.object({
  printerName: z.string().trim().min(1).max(255),
  colorSupported: z.boolean(),
});

async function handleColorUpdate(request: NextRequest) {
  const shop = await authenticateAgent(request);
  if (!shop) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid printer capability payload." },
      { status: 400 },
    );
  }

  const result = await setShopPrinterColorSupported({
    shopId: shop.id,
    printerName: parsed.data.printerName,
    colorSupported: parsed.data.colorSupported,
  });

  if (!result.ok) {
    return Response.json({ error: "Invalid printer name." }, { status: 400 });
  }

  return Response.json({
    printerName: result.printer.printerName,
    colorSupported: result.printer.colorSupported,
    isDefault: result.printer.isDefault,
    status: result.printer.status,
  });
}

/**
 * PATCH /api/print-agent/printers
 * Manually set colorSupported for one printer in the authenticated Agent's shop.
 */
export async function PATCH(request: NextRequest) {
  try {
    return await handleColorUpdate(request);
  } catch (error) {
    logError("agent_printer_color_update_failed", error);
    return Response.json(
      { error: "Unable to update printer capability." },
      { status: 500 },
    );
  }
}

/**
 * POST alias — some hosts mishandle PATCH; same auth + body as PATCH.
 */
export async function POST(request: NextRequest) {
  try {
    return await handleColorUpdate(request);
  } catch (error) {
    logError("agent_printer_color_update_failed", error);
    return Response.json(
      { error: "Unable to update printer capability." },
      { status: 500 },
    );
  }
}
