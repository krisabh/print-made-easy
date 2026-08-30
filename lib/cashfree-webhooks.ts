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
  const authorization = asRecord(data.authorization_details);

  const candidates = [
    details.cf_subscription_id,
    details.subscription_id,
    data.cf_subscription_id,
    data.subscription_id,
    gateway.gateway_subscription_id,
    payment.cf_subscription_id,
    payment.subscription_id,
    authorization.cf_subscription_id,
    authorization.subscription_id,
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

/** Prefer merchant subscription_id (PME-…) for cancel API; keep existing if still valid. */
function resolveProviderSubscriptionId(input: {
  details: Record<string, unknown>;
  ids: string[];
  existing: string | null;
}) {
  const merchantFromPayload = String(input.details.subscription_id || "").trim();
  if (merchantFromPayload) return merchantFromPayload;

  if (input.existing && input.ids.includes(input.existing)) {
    return input.existing;
  }

  const existingMerchant = input.existing?.startsWith("PME-") ? input.existing : null;
  if (existingMerchant) return existingMerchant;

  return (
    String(input.details.cf_subscription_id || "").trim() ||
    input.ids[0] ||
    input.existing ||
    ""
  );
}

async function findSubscriptionForWebhook(ids: string[]) {
  if (ids.length === 0) return null;

  const byProvider = await prisma.subscription.findFirst({
    where: {
      provider: CASHFREE_PROVIDER,
      providerSubscriptionId: { in: ids },
    },
  });
  if (byProvider) return byProvider;

  // Fallback: ID match even if provider column was unset during a partial create.
  return prisma.subscription.findFirst({
    where: {
      providerSubscriptionId: { in: ids },
    },
  });
}

function logWebhookDiagnostic(fields: Record<string, string | boolean | null | undefined>) {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value === null ? "null" : String(value)}`);
  console.info(`[CASHFREE WEBHOOK] ${parts.join(" ")}`);
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
    logWebhookDiagnostic({
      result: "invalid_signature",
    });
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
    logWebhookDiagnostic({
      event: eventType,
      result: "duplicate",
      eventId,
    });
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
    logWebhookDiagnostic({
      event: eventType,
      result: "subscription_not_found",
      eventId,
      providerSubscriptionId: ids[0] || null,
      matchedIds: ids.join(",") || null,
    });
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
  const authorization = asRecord(data.authorization_details);
  const payment = asRecord(data.payment || data.payment_details);
  const providerSubscriptionId = resolveProviderSubscriptionId({
    details,
    ids,
    existing: subscription.providerSubscriptionId,
  });

  const providerStatus = String(details.subscription_status || "").toUpperCase();
  const authorizationStatus = String(
    authorization.authorization_status || "",
  ).toUpperCase();
  const paymentStatus = String(
    data.payment_status || payment.payment_status || "",
  ).toUpperCase();

  const authSucceeded =
    eventType === "SUBSCRIPTION_AUTH_STATUS" &&
    (authorizationStatus === "SUCCESS" ||
      authorizationStatus === "ACTIVE" ||
      paymentStatus === "SUCCESS") &&
    paymentStatus !== "FAILED" &&
    authorizationStatus !== "FAILED";

  const shouldActivatePremium =
    providerStatus === "ACTIVE" ||
    eventType === "SUBSCRIPTION_PAYMENT_SUCCESS" ||
    authSucceeded;

  let resultLabel = "ignored";

  if (
    eventType === "SUBSCRIPTION_STATUS_CHANGED" ||
    eventType === "SUBSCRIPTION_AUTH_STATUS" ||
    eventType === "SUBSCRIPTION_PAYMENT_SUCCESS"
  ) {
    if (shouldActivatePremium) {
      const periodStart =
        parseMaybeDate(details.subscription_first_charge_time) ||
        parseMaybeDate(details.authorization_time) ||
        parseMaybeDate(authorization.authorization_time) ||
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
      resultLabel = "activated";
    } else if (providerStatus === "ON_HOLD") {
      await markSubscriptionPastDue({
        subscriptionId: subscription.id,
        now,
      });
      resultLabel = "past_due";
    } else if (
      providerStatus === "CUSTOMER_CANCELLED" ||
      providerStatus === "CANCELLED"
    ) {
      const periodEnd = parseMaybeDate(details.next_schedule_date);
      if (periodEnd && periodEnd.getTime() > now.getTime()) {
        await markSubscriptionCancelAtPeriodEnd({
          subscriptionId: subscription.id,
          currentPeriodEnd: periodEnd,
          now,
        });
        resultLabel = "cancel_at_period_end";
      } else {
        await markSubscriptionCancelled({
          subscriptionId: subscription.id,
          now,
        });
        resultLabel = "cancelled";
      }
    } else if (
      providerStatus === "EXPIRED" ||
      providerStatus === "COMPLETED" ||
      providerStatus === "LINK_EXPIRED" ||
      providerStatus === "CARD_EXPIRED"
    ) {
      await markSubscriptionExpired({ subscriptionId: subscription.id });
      resultLabel = "expired";
    } else {
      resultLabel = `ignored_status_${providerStatus || "unknown"}`;
    }
  } else if (eventType === "SUBSCRIPTION_PAYMENT_FAILED") {
    await markSubscriptionPastDue({
      subscriptionId: subscription.id,
      now,
    });
    resultLabel = "past_due";
  } else {
    resultLabel = "ignored_event";
  }

  await prisma.paymentWebhookEvent.update({
    where: {
      provider_eventId: { provider: CASHFREE_PROVIDER, eventId },
    },
    data: { processedAt: now },
  });

  logWebhookDiagnostic({
    event: eventType,
    result: resultLabel,
    providerSubscriptionId,
    shopId: subscription.shopId,
    subscriptionId: subscription.id,
    providerStatus: providerStatus || null,
    authorizationStatus: authorizationStatus || null,
    paymentStatus: paymentStatus || null,
  });

  return {
    ok: true as const,
    status: 200 as const,
    duplicate: false,
    eventId,
    eventType,
    subscriptionId: subscription.id,
    result: resultLabel,
  };
}

/** Test helper: stable hash for smoke scripts. */
export function fingerprintPayload(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
}
