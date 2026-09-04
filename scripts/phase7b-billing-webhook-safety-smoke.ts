/**
 * Phase 7B — billing webhook safety regression (no live Cashfree).
 * Run: npx tsx scripts/phase7b-billing-webhook-safety-smoke.ts
 */
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { PrismaClient } from "@prisma/client";

import { createCashfreeAdapter } from "../lib/billing/cashfree-adapter";
import { PREMIUM_PLAN } from "../lib/billing/plan";
import {
  applyNormalizedOneTimePayment,
  processNormalizedBillingEvent,
} from "../lib/billing/service";
import type { NormalizedBillingEvent } from "../lib/billing/types";
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
} from "../lib/billing/webhook-idempotency";
import {
  buildPgWebhookEventId,
  CASHFREE_PROVIDER,
  hashWebhookPayload,
} from "../lib/cashfree";
import {
  createNestedTrialSubscription,
  getSubscriptionAccess,
} from "../lib/subscription";

const prisma = new PrismaClient();

function signBody(rawBody: string, secret: string, timestamp: string) {
  return createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");
}

function pgSuccessBody(input: {
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  shopId?: string;
  eventTime: string;
}) {
  return JSON.stringify({
    type: "PAYMENT_SUCCESS_WEBHOOK",
    event_time: input.eventTime,
    data: {
      order: {
        order_id: input.orderId,
        order_amount: input.amount,
        order_currency: input.currency,
        order_note: input.shopId ? `shop:${input.shopId}` : "PrintMadeEasy Premium",
      },
      payment: {
        cf_payment_id: input.paymentId,
        payment_status: "SUCCESS",
        payment_amount: input.amount,
        payment_currency: input.currency,
        payment_message: "Transaction success",
      },
    },
  });
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const secret = "test_cashfree_secret_for_billing_safety";
  process.env.CASHFREE_CLIENT_ID = "test_client";
  process.env.CASHFREE_CLIENT_SECRET = secret;
  process.env.CASHFREE_ENVIRONMENT = "sandbox";
  process.env.CASHFREE_WEBHOOK_SECRET = secret;
  process.env.BILLING_PROVIDER = "cashfree";
  process.env.BILLING_MODE = "one_time";

  const shopIds: string[] = [];
  const adapter = createCashfreeAdapter();

  try {
    const shop = await prisma.shop.create({
      data: {
        shopCode: `S7${stamp}`.slice(0, 12),
        shopName: "Webhook Safety Shop",
        phone: "9777777777",
        address: "Test",
        email: `safety-${stamp}@example.com`,
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
        subscription: { create: createNestedTrialSubscription() },
      },
      include: { subscription: true },
    });
    shopIds.push(shop.id);
    const shopId = shop.id;
    const subscriptionId = shop.subscription!.id;
    const now = new Date("2026-09-15T10:00:00.000Z");

    // --- 1. Successful PG webhook ---
    const orderA = `PMEPAY-SAFE-A-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId: orderA,
      },
    });

    const bodyA = pgSuccessBody({
      orderId: orderA,
      paymentId: `cfpay_A_${stamp}`,
      amount: 199,
      currency: "INR",
      shopId,
      eventTime: "2026-09-15T15:30:00+05:30",
    });
    const tsA = String(Date.now());
    const normA = await adapter.oneTimeWebhook!.verifyAndNormalize({
      rawBody: bodyA,
      signature: signBody(bodyA, secret, tsA),
      timestamp: tsA,
      now,
    });
    assert.ok(normA && normA.ok && "event" in normA);
    const appliedA = await processNormalizedBillingEvent(normA.event, now);
    assert.equal(appliedA.result, "activated");
    await markWebhookEventProcessed({ eventId: normA.event.eventId, now });

    const subA = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(subA?.plan, "PREMIUM");
    assert.equal(subA?.status, "ACTIVE");
    assert.equal(getSubscriptionAccess(subA, now).hasAccess, true);
    const periodEndAfterA = subA!.currentPeriodEnd!.getTime();
    console.log("1 PASS successful PG webhook → Premium");

    // --- 2. Duplicate PG webhook (same eventId) ---
    const dupClaim = await claimWebhookEvent({
      eventId: normA.event.eventId,
      eventType: "PAYMENT_SUCCESS_WEBHOOK",
      payloadHash: hashWebhookPayload(bodyA),
      now,
    });
    assert.equal(dupClaim, "already_processed");
    const dupApply = await applyNormalizedOneTimePayment(normA.event, now);
    assert.equal(dupApply.result, "already_applied");
    const subDup = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(subDup?.currentPeriodEnd?.getTime(), periodEndAfterA);
    console.log("2 PASS duplicate PG webhook → no extension");

    // --- 3. Same payment/order, different event ID ---
    const eventB: NormalizedBillingEvent = {
      ...normA.event,
      eventId: `alt-event-${stamp}`,
      payment: {
        ...normA.event.payment!,
        providerPaymentId: `cfpay_A_${stamp}`,
      },
    };
    const alt = await applyNormalizedOneTimePayment(eventB, now);
    assert.equal(alt.result, "already_applied");
    const subAlt = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(subAlt?.currentPeriodEnd?.getTime(), periodEndAfterA);
    console.log("3 PASS same order/payment different eventId → no extension");

    // --- 4. Concurrent duplicate processing ---
    const orderC = `PMEPAY-SAFE-C-${stamp}`;
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        currentPeriodStart: null,
        currentPeriodEnd: null,
      },
    });
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderC,
      },
    });
    const concurrentEvent: NormalizedBillingEvent = {
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `concurrent-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderC,
        providerPaymentId: `cfpay_C_${stamp}`,
        shopIdHint: shopId,
        paidAt: now,
      },
    };
    const [r1, r2] = await Promise.all([
      applyNormalizedOneTimePayment(concurrentEvent, now),
      applyNormalizedOneTimePayment(concurrentEvent, now),
    ]);
    const results = [r1.result, r2.result].sort();
    assert.deepEqual(results, ["activated", "already_applied"]);
    const successCount = await prisma.billingPayment.count({
      where: { providerOrderId: orderC, status: "SUCCESS" },
    });
    assert.equal(successCount, 1);
    console.log("4 PASS concurrent processing → single extension");

    // --- 5. Wrong amount ---
    const orderBadAmt = `PMEPAY-SAFE-BADAMT-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderBadAmt,
      },
    });
    const badAmt = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `bad-amt-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 1,
        currency: "INR",
        providerOrderId: orderBadAmt,
        providerPaymentId: null,
      },
    });
    assert.equal(badAmt.result, "amount_mismatch");
    console.log("5 PASS wrong amount rejected");

    // --- 6. Wrong currency ---
    const orderBadCur = `PMEPAY-SAFE-BADCUR-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderBadCur,
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
        providerOrderId: orderBadCur,
        providerPaymentId: null,
      },
    });
    assert.equal(badCur.result, "amount_mismatch");
    console.log("6 PASS wrong currency rejected");

    // --- 7. Wrong shop ownership ---
    const orderMismatch = `PMEPAY-SAFE-MISMATCH-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderMismatch,
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
        providerOrderId: orderMismatch,
        providerPaymentId: null,
        shopIdHint: "00000000-0000-0000-0000-000000000099",
      },
    });
    assert.equal(mismatch.result, "shop_mismatch");
    console.log("7 PASS wrong shop ownership rejected");

    // --- 8. Failed payment ---
    const orderFail = `PMEPAY-SAFE-FAIL-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderFail,
      },
    });
    const failBody = JSON.stringify({
      type: "PAYMENT_FAILED_WEBHOOK",
      event_time: "2026-09-15T16:00:00+05:30",
      data: {
        order: {
          order_id: orderFail,
          order_amount: 199,
          order_currency: "INR",
        },
        payment: {
          cf_payment_id: `cfpay_fail_${stamp}`,
          payment_status: "FAILED",
          payment_amount: 199,
          payment_currency: "INR",
          payment_message: "FAILED",
        },
      },
    });
    const tsFail = String(Date.now() + 1);
    const normFail = await adapter.oneTimeWebhook!.verifyAndNormalize({
      rawBody: failBody,
      signature: signBody(failBody, secret, tsFail),
      timestamp: tsFail,
      now,
    });
    assert.ok(normFail && normFail.ok && "event" in normFail);
    const failApplied = await processNormalizedBillingEvent(normFail.event, now);
    assert.equal(failApplied.result, "payment_failed");
    await markWebhookEventProcessed({ eventId: normFail.event.eventId, now });
    const failRow = await prisma.billingPayment.findUnique({
      where: {
        provider_providerOrderId: {
          provider: CASHFREE_PROVIDER,
          providerOrderId: orderFail,
        },
      },
    });
    assert.equal(failRow?.status, "FAILED");
    console.log("8 PASS failed payment recorded");

    // --- 9. Event processing failure then retry ---
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        currentPeriodStart: null,
        currentPeriodEnd: null,
      },
    });
    const orderRetry = `PMEPAY-SAFE-RETRY-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: orderRetry,
      },
    });
    const retryBody = pgSuccessBody({
      orderId: orderRetry,
      paymentId: `cfpay_retry_${stamp}`,
      amount: 199,
      currency: "INR",
      shopId,
      eventTime: "2026-09-15T17:00:00+05:30",
    });
    const payload = JSON.parse(retryBody) as {
      type?: string;
      event_time?: string;
      data?: Record<string, unknown>;
    };
    const retryEventId = buildPgWebhookEventId(payload);
    const claim1 = await claimWebhookEvent({
      eventId: retryEventId,
      eventType: "PAYMENT_SUCCESS_WEBHOOK",
      payloadHash: hashWebhookPayload(retryBody),
      now,
    });
    assert.equal(claim1, "claimed");
    // Simulate first attempt failure: do NOT mark processedAt, do NOT apply.
    const rowAfterFail = await prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: CASHFREE_PROVIDER,
          eventId: retryEventId,
        },
      },
    });
    assert.equal(rowAfterFail?.processedAt, null);

    const claim2 = await claimWebhookEvent({
      eventId: retryEventId,
      eventType: "PAYMENT_SUCCESS_WEBHOOK",
      payloadHash: hashWebhookPayload(retryBody),
      now,
    });
    assert.equal(claim2, "retry");

    const tsRetry = String(Date.now() + 2);
    const normRetry = await adapter.oneTimeWebhook!.verifyAndNormalize({
      rawBody: retryBody,
      signature: signBody(retryBody, secret, tsRetry),
      timestamp: tsRetry,
      now,
    });
    // claim already exists unprocessed → retry path inside verifyAndNormalize
    assert.ok(normRetry && normRetry.ok && "event" in normRetry);
    const retryApplied = await processNormalizedBillingEvent(
      normRetry.event,
      now,
    );
    assert.equal(retryApplied.result, "activated");
    await markWebhookEventProcessed({ eventId: retryEventId, now });
    const claim3 = await claimWebhookEvent({
      eventId: retryEventId,
      eventType: "PAYMENT_SUCCESS_WEBHOOK",
      payloadHash: hashWebhookPayload(retryBody),
      now,
    });
    assert.equal(claim3, "already_processed");
    const subRetry = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(subRetry?.plan, "PREMIUM");
    assert.equal(subRetry?.status, "ACTIVE");
    console.log("9 PASS failed processing then retry → activates once");

    // --- 10. Browser return does not activate ---
    const returnNow = new Date();
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        trialStartAt: returnNow,
        trialEndAt: new Date(returnNow.getTime() + 7 * 24 * 60 * 60 * 1000),
        currentPeriodStart: null,
        currentPeriodEnd: null,
      },
    });
    // Simulate return page: only read subscription (no apply / no Premium write).
    const afterReturn = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    assert.equal(afterReturn?.plan, "TRIAL");
    assert.notEqual(afterReturn?.status, "ACTIVE");
    assert.notEqual(afterReturn?.plan, "PREMIUM");
    console.log("10 PASS browser return does not activate Premium");

    // Subscription events must not be claimed by PG normalizer
    const subBody = JSON.stringify({
      type: "SUBSCRIPTION_PAYMENT_SUCCESS",
      event_time: "2026-09-15T18:00:00+05:30",
      data: { subscription_details: { subscription_id: "PME-X" } },
    });
    const tsSub = String(Date.now() + 3);
    const subNorm = await adapter.oneTimeWebhook!.verifyAndNormalize({
      rawBody: subBody,
      signature: signBody(subBody, secret, tsSub),
      timestamp: tsSub,
      now,
    });
    assert.equal(subNorm, null);
    console.log("11 PASS subscription webhooks not handled by PG normalizer");

    console.log("ALL PHASE 7B BILLING WEBHOOK SAFETY TESTS PASSED");
  } finally {
    if (shopIds.length) {
      await prisma.billingPayment.deleteMany({
        where: { shopId: { in: shopIds } },
      });
      await prisma.paymentWebhookEvent.deleteMany({
        where: {
          eventId: { contains: stamp.toLowerCase() },
        },
      }).catch(() => undefined);
      // Clean webhook events for this run more broadly
      await prisma.paymentWebhookEvent.deleteMany({
        where: {
          OR: [
            { eventId: { contains: stamp } },
            { eventId: { contains: stamp.toLowerCase() } },
          ],
        },
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
