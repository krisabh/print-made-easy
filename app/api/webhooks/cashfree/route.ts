import { processCashfreeWebhook } from "@/lib/cashfree-webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature =
      request.headers.get("x-webhook-signature") ||
      request.headers.get("X-Webhook-Signature");
    const timestamp =
      request.headers.get("x-webhook-timestamp") ||
      request.headers.get("X-Webhook-Timestamp");

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
    });
  } catch (error) {
    console.error("POST /api/webhooks/cashfree failed");
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
