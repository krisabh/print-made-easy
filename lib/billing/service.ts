import { randomBytes } from "crypto";

import { getBillingConfig } from "@/lib/billing/config";
import { PREMIUM_PLAN } from "@/lib/billing/plan";
import { getPaymentProviderAdapter } from "@/lib/billing/registry";
import type {
  BillingCheckoutResponse,
  CreateCheckoutCustomer,
  NormalizedBillingEvent,
} from "@/lib/billing/types";
import { addMonths, buildMerchantOrderId, CASHFREE_PROVIDER } from "@/lib/cashfree";
import { prisma } from "@/lib/prisma";
import {
  canInitiatePremiumCheckout,
  claimPremiumCheckoutSlot,
  finalizePremiumCheckoutClaim,
  getShopSubscription,
  releasePremiumCheckoutClaim,
  toPublicSubscriptionView,
} from "@/lib/subscription";

/**
 * Premium period extension rule (ONE_TIME):
 * - If Premium is currently ACTIVE with currentPeriodEnd in the future,
 *   extend from currentPeriodEnd (never shorten).
 * - Otherwise start from `now` (payment confirmation time).
 * - Always add exactly one calendar month via addMonths().
 */
export function computeOneTimePremiumPeriod(input: {
  currentPeriodEnd: Date | null | undefined;
  plan: string | null | undefined;
  status: string | null | undefined;
  now: Date;
}) {
  const now = input.now;
  const end = input.currentPeriodEnd;
  const activePremium =
    input.plan === "PREMIUM" &&
    input.status === "ACTIVE" &&
    end != null &&
    end.getTime() > now.getTime();

  const periodStart = activePremium ? end! : now;
  const periodEnd = addMonths(periodStart, PREMIUM_PLAN.intervals);
  return { periodStart, periodEnd };
}

export async function createBillingCheckout(input: {
  shopId: string;
  shopCode: string;
  customer: CreateCheckoutCustomer;
  returnUrl: string;
  now?: Date;
}): Promise<
  | { ok: true; checkout: BillingCheckoutResponse }
  | { ok: false; error: string; status: 409 | 502 | 500 }
> {
  const now = input.now || new Date();
  const config = getBillingConfig();
  const adapter = getPaymentProviderAdapter(config.provider);
  const subscription = await getShopSubscription(input.shopId);
  const gate = canInitiatePremiumCheckout(subscription, now);
  if (!gate.ok) {
    return { ok: false, error: gate.error, status: 409 };
  }

  if (config.mode === "ONE_TIME") {
    if (!adapter.oneTime) {
      return {
        ok: false,
        error: "One-time billing is not available for this provider.",
        status: 502,
      };
    }

    const providerOrderId = buildMerchantOrderId(input.shopCode);

    await prisma.billingPayment.create({
      data: {
        shopId: input.shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId,
        metadataJson: JSON.stringify({ shopCode: input.shopCode }),
      },
    });

    try {
      const created = await adapter.oneTime.createOneTimeCheckout({
        shopId: input.shopId,
        shopCode: input.shopCode,
        customer: input.customer,
        returnUrl: input.returnUrl,
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId,
      });

      return {
        ok: true,
        checkout: {
          provider: created.provider,
          mode: "ONE_TIME",
          checkoutKind: created.checkoutKind,
          checkoutSessionId: created.checkoutSessionId,
          orderId: created.orderId,
          environment: created.environment,
          amountInr: PREMIUM_PLAN.amountInr,
          currency: PREMIUM_PLAN.currency,
        },
      };
    } catch (error) {
      await prisma.billingPayment.updateMany({
        where: {
          provider: CASHFREE_PROVIDER,
          providerOrderId,
          status: "PENDING",
        },
        data: {
          status: "FAILED",
          failureReason:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Checkout create failed",
        },
      });
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to start payment checkout.",
        status: 502,
      };
    }
  }

  // SUBSCRIPTION mode — preserve existing claim + Cashfree subscription create.
  if (!adapter.subscription) {
    return {
      ok: false,
      error: "Subscription billing is not available for this provider.",
      status: 502,
    };
  }

  const claim = await claimPremiumCheckoutSlot({ shopId: input.shopId, now });
  if (!claim.ok) {
    return { ok: false, error: claim.error, status: claim.status === 404 ? 409 : claim.status };
  }

  try {
    const created = await adapter.subscription.createSubscriptionCheckout({
      shopId: input.shopId,
      shopCode: input.shopCode,
      customer: input.customer,
      returnUrl: input.returnUrl,
    });

    const finalized = await finalizePremiumCheckoutClaim({
      subscriptionId: claim.subscription.id,
      claimToken: claim.claimToken,
      providerSubscriptionId: created.subscriptionId,
      providerCustomerId: created.providerCustomerId,
      providerPlanId: created.providerPlanId || PREMIUM_PLAN.internalKey,
    });

    if (finalized.count === 0) {
      try {
        await adapter.subscription.cancelSubscription({
          providerSubscriptionId: created.subscriptionId,
        });
      } catch {
        // best-effort
      }
      return {
        ok: false,
        error:
          "This shop already has an active Premium subscription or another checkout finished first.",
        status: 409,
      };
    }

    return {
      ok: true,
      checkout: {
        provider: created.provider,
        mode: "SUBSCRIPTION",
        checkoutKind: created.checkoutKind,
        checkoutSessionId: created.checkoutSessionId,
        subscriptionId: created.subscriptionId,
        environment: created.environment,
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
      },
    };
  } catch (error) {
    await releasePremiumCheckoutClaim({
      subscriptionId: claim.subscription.id,
      claimToken: claim.claimToken,
      restoreProviderSubscriptionId: claim.previousProviderSubscriptionId,
    }).catch(() => undefined);

    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to start subscription checkout.",
      status: 502,
    };
  }
}

export async function applyNormalizedOneTimePayment(
  event: NormalizedBillingEvent,
  now: Date = new Date(),
) {
  const payment = event.payment;
  if (!payment?.providerOrderId) {
    return { ok: true as const, result: "ignored_missing_order" as const };
  }

  if (event.type === "PAYMENT_FAILED" || payment.status === "FAILED") {
    await prisma.billingPayment.updateMany({
      where: {
        provider: CASHFREE_PROVIDER,
        providerOrderId: payment.providerOrderId,
        status: { in: ["PENDING", "FAILED"] },
      },
      data: {
        status: "FAILED",
        failureReason: payment.failureReason?.slice(0, 500) || "Payment failed",
        providerPaymentId: payment.providerPaymentId || undefined,
      },
    });
    return { ok: true as const, result: "payment_failed" as const };
  }

  if (event.type !== "PAYMENT_SUCCEEDED" || payment.status !== "SUCCESS") {
    return { ok: true as const, result: "ignored" as const };
  }

  if (
    payment.amountInr !== PREMIUM_PLAN.amountInr ||
    payment.currency.toUpperCase() !== PREMIUM_PLAN.currency
  ) {
    await prisma.billingPayment.updateMany({
      where: {
        provider: CASHFREE_PROVIDER,
        providerOrderId: payment.providerOrderId,
      },
      data: {
        status: "FAILED",
        failureReason: `Amount/currency mismatch: ${payment.amountInr} ${payment.currency}`,
        providerPaymentId: payment.providerPaymentId || undefined,
      },
    });
    return { ok: false as const, result: "amount_mismatch" as const };
  }

  const existing = await prisma.billingPayment.findUnique({
    where: {
      provider_providerOrderId: {
        provider: CASHFREE_PROVIDER,
        providerOrderId: payment.providerOrderId,
      },
    },
  });

  if (!existing) {
    return { ok: false as const, result: "unknown_order" as const };
  }

  if (existing.status === "SUCCESS") {
    // Idempotent: already applied — do not extend again.
    return {
      ok: true as const,
      result: "already_applied" as const,
      shopId: existing.shopId,
    };
  }

  // Same provider payment id already succeeded on another order → no second extension.
  if (payment.providerPaymentId) {
    const priorPayment = await prisma.billingPayment.findFirst({
      where: {
        provider: CASHFREE_PROVIDER,
        providerPaymentId: payment.providerPaymentId,
        status: "SUCCESS",
        NOT: { id: existing.id },
      },
    });
    if (priorPayment) {
      await prisma.billingPayment.updateMany({
        where: {
          id: existing.id,
          status: { not: "SUCCESS" },
        },
        data: {
          status: "FAILED",
          failureReason: "Duplicate provider payment id",
          providerPaymentId: payment.providerPaymentId,
        },
      });
      return {
        ok: true as const,
        result: "already_applied" as const,
        shopId: priorPayment.shopId,
      };
    }
  }

  if (payment.shopIdHint && payment.shopIdHint !== existing.shopId) {
    return { ok: false as const, result: "shop_mismatch" as const };
  }

  const subscription = await getShopSubscription(existing.shopId);
  if (!subscription) {
    return { ok: false as const, result: "subscription_missing" as const };
  }

  const { periodStart, periodEnd } = computeOneTimePremiumPeriod({
    currentPeriodEnd: subscription.currentPeriodEnd,
    plan: subscription.plan,
    status: subscription.status,
    now,
  });

  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.billingPayment.updateMany({
      where: {
        id: existing.id,
        status: { not: "SUCCESS" },
      },
      data: {
        status: "SUCCESS",
        providerPaymentId: payment.providerPaymentId,
        paidAt: payment.paidAt || now,
        periodStart,
        periodEnd,
        failureReason: null,
      },
    });

    // Another concurrent worker already marked SUCCESS — do not extend again.
    if (updated.count === 0) {
      return false;
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        plan: "PREMIUM",
        status: "ACTIVE",
        provider: CASHFREE_PROVIDER,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        pastDueSince: null,
      },
    });
    return true;
  });

  if (!applied) {
    return {
      ok: true as const,
      result: "already_applied" as const,
      shopId: existing.shopId,
    };
  }

  return {
    ok: true as const,
    result: "activated" as const,
    shopId: existing.shopId,
    periodStart,
    periodEnd,
  };
}

export async function processNormalizedBillingEvent(
  event: NormalizedBillingEvent,
  now: Date = new Date(),
) {
  if (
    event.type === "PAYMENT_SUCCEEDED" ||
    event.type === "PAYMENT_FAILED" ||
    event.type === "PAYMENT_CANCELLED"
  ) {
    return applyNormalizedOneTimePayment(event, now);
  }

  return { ok: true as const, result: "ignored_event" as const };
}

/**
 * Server-side reconcile for ONE_TIME checkouts.
 * Verifies pending orders with the payment provider (never trusts the browser).
 * Used when the shopkeeper returns from checkout before/without a webhook delivery
 * (common on localhost without a public webhook URL).
 */
export async function confirmShopOneTimePayments(
  shopId: string,
  options?: {
    now?: Date;
    verify?: (providerOrderId: string) => Promise<{
      status: "SUCCESS" | "FAILED" | "CANCELLED";
      amountInr: number;
      currency: string;
      providerOrderId: string;
      providerPaymentId: string | null;
      paidAt?: Date | null;
      failureReason?: string | null;
    }>;
  },
) {
  const now = options?.now || new Date();
  const adapter = getPaymentProviderAdapter();
  const verify =
    options?.verify ||
    (adapter.oneTime
      ? (providerOrderId: string) =>
          adapter.oneTime!.verifyOneTimePayment({ providerOrderId })
      : null);

  if (!verify) {
    return {
      ok: false as const,
      result: "unsupported" as const,
      subscription: await getPublicBillingView(shopId, now),
    };
  }

  const pending = await prisma.billingPayment.findMany({
    where: {
      shopId,
      mode: "ONE_TIME",
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  let lastResult:
    | "no_pending"
    | "pending_unpaid"
    | "activated"
    | "already_applied"
    | "amount_mismatch"
    | "rejected" = pending.length ? "pending_unpaid" : "no_pending";

  for (const row of pending) {
    let verified;
    try {
      verified = await verify(row.providerOrderId);
    } catch {
      continue;
    }

    if (verified.status !== "SUCCESS") {
      continue;
    }

    const applied = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_SUCCEEDED",
        provider: "cashfree",
        eventId: `confirm:${row.providerOrderId}:${verified.providerPaymentId || "none"}`,
        payment: {
          provider: "cashfree",
          mode: "ONE_TIME",
          status: "SUCCESS",
          amountInr: verified.amountInr,
          currency: verified.currency,
          providerOrderId: verified.providerOrderId || row.providerOrderId,
          providerPaymentId: verified.providerPaymentId,
          shopIdHint: shopId,
          paidAt: verified.paidAt || now,
          failureReason: verified.failureReason || null,
        },
      },
      now,
    );

    if (applied.result === "activated") {
      lastResult = "activated";
      break;
    }
    if (applied.result === "already_applied") {
      lastResult = "already_applied";
      break;
    }
    if (applied.result === "amount_mismatch") {
      lastResult = "amount_mismatch";
    } else if (!applied.ok) {
      lastResult = "rejected";
    }
  }

  return {
    ok: true as const,
    result: lastResult,
    subscription: await getPublicBillingView(shopId, now),
  };
}

/** Test helper — generate a unique-ish order id without Cashfree. */
export function makeTestOrderId(shopCode: string) {
  return `PMEPAY-${shopCode}-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`.slice(
    0,
    45,
  );
}

export async function getPublicBillingView(shopId: string, now: Date = new Date()) {
  const subscription = await getShopSubscription(shopId);
  return toPublicSubscriptionView(subscription, now);
}
