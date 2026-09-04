/**
 * Billing My Plan CTA + post-payment confirm regression.
 * Run: npx tsx scripts/phase7c-billing-plan-cta-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { resolveBillingPlanCta } from "../lib/billing/plan-cta";
import { confirmShopOneTimePayments } from "../lib/billing/service";
import { CASHFREE_PROVIDER } from "../lib/cashfree";
import type { PublicSubscriptionView } from "../lib/subscription";
import {
  canInitiatePremiumCheckout,
  createNestedTrialSubscription,
  toPublicSubscriptionView,
} from "../lib/subscription";

const prisma = new PrismaClient();

function viewFrom(
  partial: Partial<PublicSubscriptionView> &
    Pick<
      PublicSubscriptionView,
      "plan" | "status" | "hasAccess" | "canSubscribe"
    >,
): PublicSubscriptionView {
  return {
    trialStartAt: null,
    trialEndAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    daysRemaining: null,
    label: "x",
    detail: "x",
    isPastDue: false,
    isExpired: !partial.hasAccess,
    canCancel: false,
    ...partial,
  };
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shopIds: string[] = [];
  const now = new Date();

  try {
    const trialCta = resolveBillingPlanCta(
      viewFrom({
        plan: "TRIAL",
        status: "TRIALING",
        hasAccess: true,
        canSubscribe: true,
      }),
      { billingMode: "ONE_TIME", premiumPriceInr: 199 },
    );
    assert.equal(trialCta.kind, "checkout");
    assert.equal(trialCta.payEnabled, true);
    assert.equal(trialCta.label, "Pay ₹199");
    console.log("A PASS trial → Pay ₹199 enabled");

    const periodEnd = new Date(now.getTime() + 30 * 86400000).toISOString();
    const premiumCta = resolveBillingPlanCta(
      viewFrom({
        plan: "PREMIUM",
        status: "ACTIVE",
        hasAccess: true,
        canSubscribe: false,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
        detail: "₹199/month · Current period ends …",
      }),
      { billingMode: "ONE_TIME", premiumPriceInr: 199 },
    );
    assert.equal(premiumCta.kind, "premium_active");
    assert.equal(premiumCta.payEnabled, false);
    assert.equal(premiumCta.label, "Premium Active");
    assert.match(premiumCta.headline || "", /already a Premium member/i);
    assert.ok(premiumCta.validUntil);
    console.log("B PASS PREMIUM ACTIVE → Premium Active / no Pay ₹199");

    const expiredCta = resolveBillingPlanCta(
      viewFrom({
        plan: "PREMIUM",
        status: "EXPIRED",
        hasAccess: false,
        canSubscribe: true,
        isExpired: true,
      }),
      { billingMode: "ONE_TIME", premiumPriceInr: 199 },
    );
    assert.equal(expiredCta.kind, "checkout");
    assert.equal(expiredCta.payEnabled, true);
    console.log("C PASS expired → Pay ₹199 enabled");

    const shop = await prisma.shop.create({
      data: {
        shopCode: `C7${stamp}`.slice(0, 12),
        shopName: "CTA Smoke Shop",
        phone: "9666666666",
        address: "Test",
        email: `cta-${stamp}@example.com`,
        printPrice: {
          create: {
            bwSingle: 2,
            bwDouble: 1.5,
            colorSingle: 10,
            colorDouble: 8,
            minimumCharge: 5,
          },
        },
        settings: {
          create: {
            currency: "INR",
            timezone: "Asia/Kolkata",
            autoDeleteDays: 7,
          },
        },
        inventory: { create: { paperAvailable: 0, estimatedInkLevel: 100 } },
        subscription: { create: createNestedTrialSubscription(now) },
      },
      include: { subscription: true },
    });
    shopIds.push(shop.id);
    const subscriptionId = shop.subscription!.id;

    assert.equal(canInitiatePremiumCheckout(shop.subscription!, now).ok, true);

    const orderId = `PMEPAY-CTA-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderId,
      },
    });

    // Post-payment path: TRIAL → confirm with injected provider verify → PREMIUM
    const confirmed = await confirmShopOneTimePayments(shop.id, {
      now,
      verify: async (providerOrderId) => ({
        status: "SUCCESS" as const,
        amountInr: 199,
        currency: "INR",
        providerOrderId,
        providerPaymentId: `pay_${stamp}`,
        paidAt: now,
      }),
    });
    assert.equal(confirmed.result, "activated");
    assert.equal(confirmed.subscription?.plan, "PREMIUM");
    assert.equal(confirmed.subscription?.status, "ACTIVE");
    assert.equal(confirmed.subscription?.canSubscribe, false);

    const after = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(after?.plan, "PREMIUM");
    assert.equal(after?.status, "ACTIVE");
    assert.equal(canInitiatePremiumCheckout(after!, now).ok, false);

    const cta = resolveBillingPlanCta(confirmed.subscription!, {
      billingMode: "ONE_TIME",
      premiumPriceInr: 199,
    });
    assert.equal(cta.kind, "premium_active");
    assert.equal(cta.payEnabled, false);
    console.log(
      "D PASS TRIAL → confirm payment → PREMIUM ACTIVE → Premium Active CTA / checkout blocked",
    );

    // Idempotent second confirm
    const again = await confirmShopOneTimePayments(shop.id, {
      now,
      verify: async (providerOrderId) => ({
        status: "SUCCESS" as const,
        amountInr: 199,
        currency: "INR",
        providerOrderId,
        providerPaymentId: `pay_${stamp}`,
        paidAt: now,
      }),
    });
    assert.ok(
      again.result === "already_applied" || again.result === "no_pending",
    );
    console.log("E PASS second confirm does not double-extend");

    const expiredSub = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: "EXPIRED",
        currentPeriodEnd: new Date(now.getTime() - 86400000),
      },
    });
    assert.equal(canInitiatePremiumCheckout(expiredSub, now).ok, true);
    assert.equal(toPublicSubscriptionView(expiredSub, now)!.canSubscribe, true);
    console.log("F PASS expired Premium → Pay ₹199 can be initiated");

    console.log("ALL PHASE 7C BILLING PLAN CTA SMOKE TESTS PASSED");
  } finally {
    if (shopIds.length) {
      await prisma.billingPayment.deleteMany({
        where: { shopId: { in: shopIds } },
      });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
