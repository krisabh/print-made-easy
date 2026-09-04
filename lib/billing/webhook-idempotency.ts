import { CASHFREE_PROVIDER } from "@/lib/cashfree";
import { prisma } from "@/lib/prisma";

/**
 * Claim a provider webhook for processing.
 *
 * - `claimed`: first delivery — proceed
 * - `retry`: row exists but processedAt is null (prior attempt failed) — proceed again
 * - `already_processed`: processedAt set — skip (duplicate success)
 *
 * processedAt must only be set AFTER billing/entitlement work succeeds
 * (or after a definitive non-retryable outcome).
 */
export async function claimWebhookEvent(input: {
  provider?: string;
  eventId: string;
  eventType: string;
  payloadHash: string;
  now?: Date;
}): Promise<"claimed" | "retry" | "already_processed"> {
  const provider = input.provider || CASHFREE_PROVIDER;
  const now = input.now || new Date();

  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        provider,
        eventId: input.eventId,
        eventType: input.eventType,
        payloadHash: input.payloadHash,
        receivedAt: now,
        processedAt: null,
      },
    });
    return "claimed";
  } catch {
    const existing = await prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_eventId: { provider, eventId: input.eventId },
      },
    });
    if (existing?.processedAt) {
      return "already_processed";
    }
    return "retry";
  }
}

export async function markWebhookEventProcessed(input: {
  provider?: string;
  eventId: string;
  now?: Date;
}) {
  const provider = input.provider || CASHFREE_PROVIDER;
  const now = input.now || new Date();
  await prisma.paymentWebhookEvent.updateMany({
    where: {
      provider,
      eventId: input.eventId,
      processedAt: null,
    },
    data: { processedAt: now },
  });
}
