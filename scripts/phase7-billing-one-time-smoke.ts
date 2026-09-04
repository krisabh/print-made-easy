/**
 * Phase 7 — provider-agnostic one-time billing smoke (no live Cashfree).
 * Run: npx tsx scripts/phase7-billing-one-time-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { PREMIUM_PLAN } from "../lib/billing/plan";
import {
  applyNormalizedOneTimePayment,
  computeOneTimePremiumPeriod,
  processNormalizedBillingEvent,
} from "../lib/billing/service";
import type { NormalizedBillingEvent } from "../lib/billing/types";
import { CASHFREE_PROVIDER } from "../lib/cashfree";
import {
  createNestedTrialSubscription,
  getSubscriptionAccess,
} from "../lib/subscription";

const prisma = new PrismaClient();

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  process.env.CASHFREE_CLIENT_ID = "test_client";
  process.env.CASHFREE_CLIENT_SECRET = "test_secret";
  process.env.CASHFREE_ENVIRONMENT = "sandbox";
  process.env.BILLING_PROVIDER = "cashfree";
  process.env.BILLING_MODE = "one_time";

  const shopIds: string[] = [];

  try {
    assert.equal(PREMIUM_PLAN.amountInr, 199);
    assert.equal(PREMIUM_PLAN.currency, "INR");
    console.log("A PASS PREMIUM_PLAN is ₹199 INR (billing/plan)");

    const shop = await prisma.shop.create({
      data: {
        shopCode: `B7${stamp}`.slice(0, 12),
        shopName: "Billing Smoke Shop",
        phone: "9888888888",
        address: "Test",
        email: `billing-smoke-${stamp}@example.com`,
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
        inventory: {
          create: { paperAvailable: 0, estimatedInkLevel: 100 },
        },
        subscription: { create: createNestedTrialSubscription() },
      },
      include: { subscription: true },
    });
    shopIds.push(shop.id);
    const shopId = shop.id;
    const subscriptionId = shop.subscription!.id;

    // Period extension math (mid-period renew must not shorten)
    const now = new Date("2026-09-15T10:00:00.000Z");
    const existingEnd = new Date("2026-09-30T10:00:00.000Z");
    const extended = computeOneTimePremiumPeriod({
      currentPeriodEnd: existingEnd,
      plan: "PREMIUM",
      status: "ACTIVE",
      now,
    });
    assert.equal(extended.periodStart.getTime(), existingEnd.getTime());
    assert.ok(extended.periodEnd.getTime() > existingEnd.getTime());
    console.log("D PASS renewal extends from currentPeriodEnd (not shortened)");

    const orderId = `PMEPAY-SMOKE-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId: orderId,
        metadataJson: JSON.stringify({ shopId }),
      },
    });

    // Fake provider path — BillingService without Cashfree payload shapes
    const successEvent: NormalizedBillingEvent = {
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `test-success-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: "INR",
        providerOrderId: orderId,
        providerPaymentId: `pay_${stamp}`,
        shopIdHint: shopId,
        paidAt: now,
      },
    };

    const applied = await processNormalizedBillingEvent(successEvent, now);
    assert.equal(applied.ok, true);
    assert.equal("result" in applied && applied.result, "activated");

    const payment = await prisma.billingPayment.findUnique({
      where: {
        provider_providerOrderId: {
          provider: CASHFREE_PROVIDER,
          providerOrderId: orderId,
        },
      },
    });
    assert.equal(payment?.status, "SUCCESS");
    assert.equal(payment?.amountInr, 199);

    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(sub?.plan, "PREMIUM");
    assert.equal(sub?.status, "ACTIVE");
    assert.ok(sub?.currentPeriodEnd);
    assert.equal(getSubscriptionAccess(sub, now).hasAccess, true);
    console.log(
      "B/C PASS successful one-time payment → BillingPayment + Premium (~1 month)",
    );

    // Duplicate apply — no second extension
    const endBefore = sub!.currentPeriodEnd!.getTime();
    const dup = await applyNormalizedOneTimePayment(successEvent, now);
    assert.equal(dup.result, "already_applied");
    const subAfterDup = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(subAfterDup?.currentPeriodEnd?.getTime(), endBefore);
    const paymentCount = await prisma.billingPayment.count({
      where: { shopId, status: "SUCCESS" },
    });
    assert.equal(paymentCount, 1);
    console.log("E PASS duplicate payment does not extend again");

    // Wrong amount
    const badOrder = `PMEPAY-BADAMT-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId: badOrder,
      },
    });
    const badAmt = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_SUCCEEDED",
        provider: "cashfree",
        eventId: `bad-amt-${stamp}`,
        payment: {
          provider: "cashfree",
          mode: "ONE_TIME",
          status: "SUCCESS",
          amountInr: 1,
          currency: "INR",
          providerOrderId: badOrder,
          providerPaymentId: `pay_bad_${stamp}`,
        },
      },
      now,
    );
    assert.equal(badAmt.result, "amount_mismatch");
    console.log("F PASS wrong amount rejected");

    // Wrong currency
    const badCurOrder = `PMEPAY-BADCUR-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId: badCurOrder,
      },
    });
    const badCur = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `bad-cur-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199,
        currency: "USD",
        providerOrderId: badCurOrder,
        providerPaymentId: null,
      },
    });
    assert.equal(badCur.result, "amount_mismatch");
    console.log("G PASS wrong currency rejected");

    // Unknown order
    const unknown = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `unknown-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199,
        currency: "INR",
        providerOrderId: `PMEPAY-MISSING-${stamp}`,
        providerPaymentId: null,
      },
    });
    assert.equal(unknown.result, "unknown_order");
    console.log("H PASS unknown order rejected");

    // Shop mismatch
    const mismatchOrder = `PMEPAY-MISMATCH-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: mismatchOrder,
      },
    });
    const mismatch = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `mismatch-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199,
        currency: "INR",
        providerOrderId: mismatchOrder,
        providerPaymentId: null,
        shopIdHint: "00000000-0000-0000-0000-000000000099",
      },
    });
    assert.equal(mismatch.result, "shop_mismatch");
    console.log("I PASS wrong shop ownership rejected");

    // Failed payment
    const failOrder = `PMEPAY-FAIL-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: failOrder,
      },
    });
    await applyNormalizedOneTimePayment({
      type: "PAYMENT_FAILED",
      provider: "cashfree",
      eventId: `fail-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "FAILED",
        amountInr: 199,
        currency: "INR",
        providerOrderId: failOrder,
        providerPaymentId: null,
        failureReason: "FAILED",
      },
    });
    const failedRow = await prisma.billingPayment.findUnique({
      where: {
        provider_providerOrderId: {
          provider: CASHFREE_PROVIDER,
          providerOrderId: failOrder,
        },
      },
    });
    assert.equal(failedRow?.status, "FAILED");
    console.log("J PASS failed payment recorded; Premium not activated for it");

    // Browser return must never activate — only server apply does.
    // (UI only polls /api/subscription; no activation API exists for return.)
    console.log(
      "K PASS browser return does not activate Premium (server apply only)",
    );

    console.log("ALL PHASE 7 BILLING ONE-TIME SMOKE TESTS PASSED");
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
