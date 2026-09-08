import { getPaymentProviderAdapter } from "@/lib/billing/registry";
import { processNormalizedBillingEvent } from "@/lib/billing/service";
import { markWebhookEventProcessed } from "@/lib/billing/webhook-idempotency";
import { PAYU_PROVIDER } from "@/lib/payu";

export const runtime = "nodejs";

/** Safe probe for PayU dashboard webhook URL checks. Does not activate Premium. */
export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "payu-webhook",
    },
    { status: 200 },
  );
}

/**
 * PayU payment webhooks are application/x-www-form-urlencoded (not JSON).
 * Reverse-hash must be verified before applying entitlement.
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const rawBody = await request.text();
    // Safe connectivity/diagnostics only — never log secrets, hash, or auth material.
    console.info("[payu-webhook] received", {
      contentType,
      bodyBytes: Buffer.byteLength(rawBody, "utf8"),
      formEncoded: contentType
        .toLowerCase()
        .includes("application/x-www-form-urlencoded"),
    });

    const adapter = getPaymentProviderAdapter("payu");

    if (!adapter.oneTimeWebhook) {
      return Response.json(
        { error: "PayU webhook normalizer is unavailable." },
        { status: 500 },
      );
    }

    const normalized = await adapter.oneTimeWebhook.verifyAndNormalize({
      rawBody,
      signature: null,
      timestamp: null,
    });

    if (!normalized) {
      return Response.json({ received: true, ignored: true });
    }

    if (!normalized.ok) {
      console.info("[payu-webhook] rejected", {
        status: normalized.status,
        error: normalized.error,
      });
      return Response.json(
        { error: normalized.error },
        { status: normalized.status },
      );
    }

    if ("duplicate" in normalized && normalized.duplicate) {
      console.info("[payu-webhook] duplicate", {
        eventId: normalized.eventId,
        eventType: normalized.eventType,
      });
      return Response.json({
        received: true,
        duplicate: true,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
      });
    }

    if (!("event" in normalized)) {
      return Response.json({ received: true, ignored: true });
    }

    if (normalized.event.type === "IGNORED") {
      console.info("[payu-webhook] ignored", {
        eventId: normalized.event.eventId,
        type: normalized.event.type,
      });
      return Response.json({
        received: true,
        ignored: true,
        eventId: normalized.event.eventId,
      });
    }

    try {
      const payment = normalized.event.payment;
      console.info("[payu-webhook] applying", {
        eventId: normalized.event.eventId,
        type: normalized.event.type,
        provider: normalized.event.provider,
        providerOrderId: payment?.providerOrderId || null,
        providerPaymentId: payment?.providerPaymentId || null,
        amountInr: payment?.amountInr ?? null,
        currency: payment?.currency || null,
        status: payment?.status || null,
      });
      const applied = await processNormalizedBillingEvent(normalized.event);
      await markWebhookEventProcessed({
        provider: PAYU_PROVIDER,
        eventId: normalized.event.eventId,
      });
      const result = "result" in applied ? applied.result : "processed";
      console.info("[payu-webhook] processed", {
        eventId: normalized.event.eventId,
        result,
      });
      return Response.json({
        received: true,
        duplicate: false,
        result,
      });
    } catch {
      console.error("POST /api/webhooks/payu apply failed (retryable)");
      return Response.json(
        { error: "Webhook processing failed." },
        { status: 500 },
      );
    }
  } catch {
    console.error("POST /api/webhooks/payu failed");
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
}
