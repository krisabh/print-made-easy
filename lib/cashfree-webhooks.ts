import { createHash } from "crypto";

import {
  buildWebhookEventId,
  CASHFREE_PROVIDER,
  hashWebhookPayload,
  verifyCashfreeWebhookSignature,
} from "@/lib/cashfree";
import { prisma } from "@/lib/prisma";
import {
  markSubscriptionCancelAtPeriodEnd,
  markSubscriptionCancelled,
  markSubscriptionExpired,
  markSubscriptionPastDue,
  markSubscriptionPremiumActive,
} from "@/lib/subscription";

type CashfreeWebhookPayload = {
  type?: string;
  event_time?: string;
  data?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function pickSubscriptionIds(data: Record<string, unknown>) {
  const details = asRecord(data.subscription_details);
  const gateway = asRecord(data.payment_gateway_details);
  const payment = asRecord(data.payment || data.payment_details);

  const candidates = [
    details.cf_subscription_id,
    details.subscription_id,
    data.cf_subscription_id,
    data.subscription_id,
    gateway.gateway_subscription_id,
    payment.cf_subscription_id,
    payment.subscription_id,
  ]
    .map((value) => (value == null ? "" : String(value).trim()))
    .filter(Boolean);

  return [...new Set(candidates)];
}

function parseMaybeDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function findSubscriptionForWebhook(ids: string[]) {
  if (ids.length === 0) return null;

  return prisma.subscription.findFirst({
    where: {
      provider: CASHFREE_PROVIDER,
      providerSubscriptionId: { in: ids },
    },
  });
}

export async function processCashfreeWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  now?: Date;
}) {
  const valid = verifyCashfreeWebhookSignature({
    signature: input.signature,
    timestamp: input.timestamp,
    rawBody: input.rawBody,
  });

  if (!valid) {
    return { ok: false as const, status: 401 as const, error: "Invalid webhook signature." };
  }

  let payload: CashfreeWebhookPayload;
  try {
    payload = JSON.parse(input.rawBody) as CashfreeWebhookPayload;
  } catch {
    return { ok: false as const, status: 400 as const, error: "Invalid webhook payload." };
  }

  const eventType = String(payload.type || "UNKNOWN");
  const eventId = buildWebhookEventId(payload);
  const payloadHash = hashWebhookPayload(input.rawBody);
  const now = input.now || new Date();

  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: CASHFREE_PROVIDER,
        eventId,
        eventType,
        payloadHash,
        receivedAt: now,
      },
    });
  } catch {
    // Unique constraint → already processed/received
    return {
      ok: true as const,
      status: 200 as const,
      duplicate: true,
      eventId,
      eventType,
    };
  }

  const data = asRecord(payload.data);
  const ids = pickSubscriptionIds(data);
  const subscription = await findSubscriptionForWebhook(ids);

  if (!subscription) {
    await prisma.paymentWebhookEvent.update({
      where: {
        provider_eventId: { provider: CASHFREE_PROVIDER, eventId },
      },
      data: { processedAt: now },
    });
    return {
      ok: true as const,
      status: 200 as const,
      ignored: true,
      reason: "subscription_not_found",
      eventId,
      eventType,
    };
  }

  const details = asRecord(data.subscription_details);
  const plan = asRecord(data.plan_details);
  const customer = asRecord(data.customer_details);
  const providerSubscriptionId =
    String(
      details.cf_subscription_id ||
        details.subscription_id ||
        subscription.providerSubscriptionId ||
        "",
    ) || subscription.providerSubscriptionId!;

  const providerStatus = String(details.subscription_status || "").toUpperCase();

  if (
    eventType === "SUBSCRIPTION_STATUS_CHANGED" ||
    eventType === "SUBSCRIPTION_AUTH_STATUS" ||
    eventType === "SUBSCRIPTION_PAYMENT_SUCCESS"
  ) {
    if (
      providerStatus === "ACTIVE" ||
      eventType === "SUBSCRIPTION_PAYMENT_SUCCESS"
    ) {
      const periodStart =
        parseMaybeDate(details.subscription_first_charge_time) ||
        parseMaybeDate(details.authorization_time) ||
        now;
      const periodEnd =
        parseMaybeDate(details.next_schedule_date) ||
        parseMaybeDate(plan.plan_next_charge_date) ||
        null;

      await markSubscriptionPremiumActive({
        subscriptionId: subscription.id,
        providerSubscriptionId,
        providerCustomerId: customer.customer_id
          ? String(customer.customer_id)
          : customer.customer_email
            ? String(customer.customer_email)
            : subscription.providerCustomerId,
        providerPlanId: plan.plan_id
          ? String(plan.plan_id)
          : subscription.providerPlanId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        now,
      });
    } else if (providerStatus === "ON_HOLD") {
      await markSubscriptionPastDue({
        subscriptionId: subscription.id,
        now,
      });
    } else if (
      providerStatus === "CUSTOMER_CANCELLED" ||
      providerStatus === "CANCELLED"
    ) {
      const periodEnd = parseMaybeDate(details.next_schedule_date);
      if (
        periodEnd &&
        periodEnd.getTime() > now.getTime()
      ) {
        await markSubscriptionCancelAtPeriodEnd({
          subscriptionId: subscription.id,
          currentPeriodEnd: periodEnd,
          now,
        });
      } else {
        await markSubscriptionCancelled({
          subscriptionId: subscription.id,
          now,
        });
      }
    } else if (
      providerStatus === "EXPIRED" ||
      providerStatus === "COMPLETED" ||
      providerStatus === "LINK_EXPIRED" ||
      providerStatus === "CARD_EXPIRED"
    ) {
      await markSubscriptionExpired({ subscriptionId: subscription.id });
    }
  } else if (eventType === "SUBSCRIPTION_PAYMENT_FAILED") {
    await markSubscriptionPastDue({
      subscriptionId: subscription.id,
      now,
    });
  }

  await prisma.paymentWebhookEvent.update({
    where: {
      provider_eventId: { provider: CASHFREE_PROVIDER, eventId },
    },
    data: { processedAt: now },
  });

  return {
    ok: true as const,
    status: 200 as const,
    duplicate: false,
    eventId,
    eventType,
    subscriptionId: subscription.id,
  };
}

/** Test helper: stable hash for smoke scripts. */
export function fingerprintPayload(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
}
