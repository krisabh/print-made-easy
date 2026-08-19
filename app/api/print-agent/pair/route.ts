import {
  AGENT_PAIRING_TTL_MS,
  generatePairingToken,
  hashPairingToken,
} from "@/lib/print-agent-auth";
import { logError, logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { requireProductAccessApi } from "@/lib/require-product-access";

/**
 * POST /api/print-agent/pair
 * Authenticated shopkeeper only. Returns a one-time pairing token (raw once).
 * Shop is taken from the session — never from the client body.
 */
export async function POST() {
  try {
    const gated = await requireProductAccessApi();
    if (gated instanceof Response) return gated;
    const { shop } = gated.session;

    const pairingToken = generatePairingToken();
    const expiresAt = new Date(Date.now() + AGENT_PAIRING_TTL_MS);

    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        agentPairingTokenHash: hashPairingToken(pairingToken),
        agentPairingExpiresAt: expiresAt,
        // New token invalidates any previous unused pairing credential
        agentPairingUsedAt: null,
      },
    });

    logInfo("agent_pairing_created", `shop=${shop.shopCode}`);

    return Response.json(
      {
        pairingToken,
        expiresAt: expiresAt.toISOString(),
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    logError("agent_pairing_failed", error);
    return Response.json(
      { error: "Unable to create pairing credential." },
      { status: 500 },
    );
  }
}
