import { getPaymentProviderAdapter } from "@/lib/billing/registry";
import { processNormalizedBillingEvent } from "@/lib/billing/service";
import { markWebhookEventProcessed } from "@/lib/billing/webhook-idempotency";
import { processCashfreeWebhook } from "@/lib/cashfree-webhooks";

export const runtime = "nodejs";

/** Safe probe for Cashfree dashboard webhook URL checks. Does not activate subscriptions. */
export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "cashfree-webhook",
    },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature =
      request.headers.get("x-webhook-signature") ||
      request.headers.get("X-Webhook-Signature");
    const timestamp =
      request.headers.get("x-webhook-timestamp") ||
      request.headers.get("X-Webhook-Timestamp");

    // Prefer provider-agnostic PG (one-time) normalization when applicable.
    const adapter = getPaymentProviderAdapter("cashfree");
    if (adapter.oneTimeWebhook) {
      const normalized = await adapter.oneTimeWebhook.verifyAndNormalize({
        rawBody,
        signature,
        timestamp,
      });

      if (normalized) {
        if (!normalized.ok) {
          return Response.json(
            { error: normalized.error },
            { status: normalized.status },
          );
        }

        if ("duplicate" in normalized && normalized.duplicate) {
          return Response.json({
            received: true,
            duplicate: true,
            eventId: normalized.eventId,
            eventType: normalized.eventType,
          });
        }

        if ("event" in normalized) {
          try {
            const applied = await processNormalizedBillingEvent(
              normalized.event,
            );
            // Mark processed only after apply completes (including definitive rejects).
            // Transient throws leave processedAt null so Cashfree can retry.
            await markWebhookEventProcessed({
              eventId: normalized.event.eventId,
            });
            return Response.json({
              received: true,
              duplicate: false,
              result: "result" in applied ? applied.result : "processed",
            });
          } catch {
            console.error(
              "POST /api/webhooks/cashfree PG apply failed (retryable)",
            );
            return Response.json(
              { error: "Webhook processing failed." },
              { status: 500 },
            );
          }
        }
      }
    }

    // Subscription (and other) Cashfree events — existing processor (unchanged behavior).
    const result = await processCashfreeWebhook({
      rawBody,
      signature,
      timestamp,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({
      received: true,
      duplicate: Boolean("duplicate" in result && result.duplicate),
      ignored: Boolean("ignored" in result && result.ignored),
      reason: "reason" in result ? result.reason : undefined,
    });
  } catch {
    console.error("POST /api/webhooks/cashfree failed");
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
