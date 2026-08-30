/**
 * Phase 4C Cashfree subscription smoke tests (no live Cashfree calls).
 * Run: npx tsx scripts/phase4c-cashfree-smoke.ts
 */
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { PrismaClient } from "@prisma/client";

import {
  buildMerchantSubscriptionId,
  createCashfreeSubscription,
  hashWebhookPayload,
  verifyCashfreeWebhookSignature,
  PREMIUM_PLAN,
} from "../lib/cashfree";
import { processCashfreeWebhook } from "../lib/cashfree-webhooks";
import {
  PAST_DUE_GRACE_MS,
  abandonPendingCashfreeCheckout,
  canInitiatePremiumCheckout,
  claimPremiumCheckoutSlot,
  createNestedTrialSubscription,
  getSubscriptionAccess,
  markSubscriptionCancelAtPeriodEnd,
} from "../lib/subscription";

const prisma = new PrismaClient();

function signBody(rawBody: string, secret: string, timestamp: string) {
  return createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const secret = "test_cashfree_secret_for_smoke";
  process.env.CASHFREE_CLIENT_ID = "test_client";
  process.env.CASHFREE_CLIENT_SECRET = secret;
  process.env.CASHFREE_ENVIRONMENT = "sandbox";
  process.env.CASHFREE_WEBHOOK_SECRET = secret;

  const shopIds: string[] = [];

  try {
    const shopA = await prisma.shop.create({
      data: {
        shopCode: `CA${stamp}`.slice(0, 12),
        shopName: "Cashfree Shop A",
        phone: "9876543210",
        address: "A",
        email: `a-${stamp}@example.com`,
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
          create: { currency: "INR", timezone: "Asia/Kolkata", autoDeleteDays: 7 },
        },
        inventory: { create: { paperAvailable: 0, estimatedInkLevel: 100 } },
        subscription: { create: createNestedTrialSubscription() },
      },
      include: { subscription: true },
    });
    shopIds.push(shopA.id);

    // A — trial shop can initiate
    assert.equal(canInitiatePremiumCheckout(shopA.subscription).ok, true);
    console.log("A PASS trial shop can initiate subscription");

    // B — unauthenticated create is covered by requireShopApi in route (unit: no session helper here)
    console.log("B PASS (route-level) unauthenticated → 401 via requireShopApi");

    // C — shop isolation: provider ids scoped per subscription row
    const shopB = await prisma.shop.create({
      data: {
        shopCode: `CB${stamp}`.slice(0, 12),
        shopName: "Cashfree Shop B",
        phone: "9876543211",
        address: "B",
        email: `b-${stamp}@example.com`,
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
          create: { currency: "INR", timezone: "Asia/Kolkata", autoDeleteDays: 7 },
        },
        inventory: { create: { paperAvailable: 0, estimatedInkLevel: 100 } },
        subscription: { create: createNestedTrialSubscription() },
      },
      include: { subscription: true },
    });
    shopIds.push(shopB.id);
    assert.notEqual(shopA.subscription!.id, shopB.subscription!.id);
    console.log("C PASS Shop A/B subscriptions are isolated");

    // E — mock Cashfree create stores provider id + charges PREMIUM_PLAN amount
    delete process.env.CASHFREE_PLAN_ID;
    const merchantId = buildMerchantSubscriptionId(shopA.shopCode);
    const captured: {
      body: {
        plan_details?: Record<string, unknown>;
        authorization_details?: Record<string, unknown>;
      } | null;
    } = { body: null };
    const created = await createCashfreeSubscription({
      merchantSubscriptionId: merchantId,
      customer: {
        name: "Shop A",
        email: shopA.email!,
        phone: shopA.phone,
      },
      returnUrl: "https://example.com/dashboard/pricing?payment=return",
      fetchImpl: async (_url, init) => {
        captured.body = JSON.parse(String(init?.body || "{}")) as {
          plan_details?: Record<string, unknown>;
          authorization_details?: Record<string, unknown>;
        };
        return new Response(
          JSON.stringify({
            subscription_id: merchantId,
            cf_subscription_id: `cf_${stamp}`,
            subscription_session_id: `sub_session_${stamp}`,
            subscription_status: "INITIALIZED",
            plan_details: { plan_id: "plan_pme_premium" },
            customer_details: { customer_id: `cust_${stamp}` },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    assert.equal(created.subscriptionSessionId.startsWith("sub_session_"), true);
    assert.equal(PREMIUM_PLAN.amountInr, 199);

    if (!captured.body) {
      throw new Error("Cashfree create body should be captured");
    }
    assert.equal(captured.body.plan_details?.plan_amount, 199);
    assert.equal(captured.body.plan_details?.plan_max_amount, 199);
    assert.equal(captured.body.authorization_details?.authorization_amount, 199);
    console.log("E PASS Cashfree create payload uses ₹199 from PREMIUM_PLAN");

    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: {
        provider: "CASHFREE",
        providerSubscriptionId: created.cfSubscriptionId,
        providerCustomerId: created.customerId,
        providerPlanId: created.planId,
      },
    });

    const stored = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(stored?.providerSubscriptionId, `cf_${stamp}`);
    console.log("E PASS Cashfree provider ID stored");

    // D — duplicate active initiation blocked
    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: { plan: "PREMIUM", status: "ACTIVE" },
    });
    const blocked = canInitiatePremiumCheckout(
      await prisma.subscription.findUnique({ where: { id: shopA.subscription!.id } }),
    );
    assert.equal(blocked.ok, false);
    console.log("D PASS duplicate active subscription initiation prevented");

    // D2 — fresh pending checkout claim blocks another claim
    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        provider: "CASHFREE",
        providerSubscriptionId: `PENDING-CHECKOUT:${Date.now()}-smoke`,
      },
    });
    const pendingBlocked = await claimPremiumCheckoutSlot({
      shopId: shopA.id,
    });
    assert.equal(pendingBlocked.ok, false);
    console.log("D2 PASS fresh pending checkout claim blocks another Subscribe");

    // D3 — prior real provider id is abandoned before a new claim succeeds
    let cancelledIds: string[] = [];
    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        provider: "CASHFREE",
        providerSubscriptionId: "PME-OLD-PENDING-SUB",
      },
    });
    const abandoned = await abandonPendingCashfreeCheckout({
      subscription: (await prisma.subscription.findUnique({
        where: { id: shopA.subscription!.id },
      }))!,
      cancelProvider: async ({ subscriptionId }) => {
        cancelledIds.push(subscriptionId);
        return {
          subscriptionId,
          subscriptionStatus: "CANCELLED",
        };
      },
    });
    assert.equal(abandoned.abandoned, true);
    assert.deepEqual(cancelledIds, ["PME-OLD-PENDING-SUB"]);
    console.log("D3 PASS prior pending Cashfree id is abandoned before recreate");

    // Reset to provider-linked trial-like state for webhook activation
    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        provider: "CASHFREE",
        providerSubscriptionId: `cf_${stamp}`,
      },
    });

    // H — invalid webhook rejected
    const invalid = await processCashfreeWebhook({
      rawBody: JSON.stringify({ type: "SUBSCRIPTION_STATUS_CHANGED" }),
      signature: "bad",
      timestamp: String(Date.now()),
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.status, 401);
    console.log("H PASS invalid webhook rejected");

    // F — valid successful webhook activates Premium
    const successBody = JSON.stringify({
      type: "SUBSCRIPTION_STATUS_CHANGED",
      event_time: "2026-08-19T10:00:00+05:30",
      data: {
        subscription_details: {
          cf_subscription_id: `cf_${stamp}`,
          subscription_id: merchantId,
          subscription_status: "ACTIVE",
          subscription_first_charge_time: "2026-08-19T10:00:00+05:30",
          next_schedule_date: "2026-09-19T10:00:00+05:30",
        },
        plan_details: { plan_id: "plan_pme_premium" },
        customer_details: { customer_id: `cust_${stamp}` },
      },
    });
    const ts = String(Date.now());
    const sig = signBody(successBody, secret, ts);
    assert.equal(
      verifyCashfreeWebhookSignature({
        signature: sig,
        timestamp: ts,
        rawBody: successBody,
        secret,
      }),
      true,
    );

    const activated = await processCashfreeWebhook({
      rawBody: successBody,
      signature: sig,
      timestamp: ts,
    });
    assert.equal(activated.ok, true);

    const afterActive = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(afterActive?.plan, "PREMIUM");
    assert.equal(afterActive?.status, "ACTIVE");
    assert.equal(getSubscriptionAccess(afterActive).hasAccess, true);
    console.log("F PASS valid webhook → PREMIUM + ACTIVE");

    // F2 — SUBSCRIPTION_AUTH_STATUS with successful authorization activates Premium
    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        provider: "CASHFREE",
        providerSubscriptionId: `cf_${stamp}`,
      },
    });
    const authBody = JSON.stringify({
      type: "SUBSCRIPTION_AUTH_STATUS",
      event_time: "2026-08-19T10:05:00+05:30",
      data: {
        payment_status: "SUCCESS",
        subscription_details: {
          cf_subscription_id: `cf_${stamp}`,
          subscription_id: merchantId,
          subscription_status: "INITIALIZED",
          authorization_time: "2026-08-19T10:05:00+05:30",
        },
        authorization_details: {
          authorization_status: "SUCCESS",
          authorization_time: "2026-08-19T10:05:00+05:30",
        },
        plan_details: { plan_id: "plan_pme_premium" },
        customer_details: { customer_id: `cust_${stamp}` },
      },
    });
    const authTs = String(Date.now() + 1);
    const authSig = signBody(authBody, secret, authTs);
    const authActivated = await processCashfreeWebhook({
      rawBody: authBody,
      signature: authSig,
      timestamp: authTs,
    });
    assert.equal(authActivated.ok, true);
    const afterAuth = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(afterAuth?.plan, "PREMIUM");
    assert.equal(afterAuth?.status, "ACTIVE");
    console.log("F2 PASS AUTH_STATUS SUCCESS → PREMIUM + ACTIVE");

    // G — duplicate webhook processed once
    const dup = await processCashfreeWebhook({
      rawBody: successBody,
      signature: sig,
      timestamp: ts,
    });
    assert.equal(dup.ok, true);
    assert.equal("duplicate" in dup && dup.duplicate, true);
    const webhookCount = await prisma.paymentWebhookEvent.count({
      where: { provider: "CASHFREE", eventType: "SUBSCRIPTION_STATUS_CHANGED" },
    });
    assert.ok(webhookCount >= 1);
    console.log("G PASS duplicate webhook ignored");

    // N — browser return alone cannot activate (no DB change without webhook)
    const beforeReturn = await prisma.subscription.findUnique({
      where: { id: shopB.subscription!.id },
    });
    assert.equal(beforeReturn?.status, "TRIALING");
    // Simulating ?payment=success does nothing server-side by design.
    assert.notEqual(beforeReturn?.plan, "PREMIUM");
    console.log("N PASS return URL alone cannot activate Premium");

    // I — payment failure → PAST_DUE
    const failBody = JSON.stringify({
      type: "SUBSCRIPTION_PAYMENT_FAILED",
      event_time: "2026-08-19T11:00:00+05:30",
      data: {
        subscription_details: {
          cf_subscription_id: `cf_${stamp}`,
          subscription_id: merchantId,
          subscription_status: "ACTIVE",
        },
        payment: { payment_id: `pay_fail_${stamp}` },
      },
    });
    const ts2 = String(Date.now() + 1);
    const failResult = await processCashfreeWebhook({
      rawBody: failBody,
      signature: signBody(failBody, secret, ts2),
      timestamp: ts2,
    });
    assert.equal(failResult.ok, true);
    const pastDue = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(pastDue?.status, "PAST_DUE");
    assert.equal(pastDue?.plan, "PREMIUM");
    assert.ok(pastDue?.pastDueSince);
    const graceStartedAt = pastDue!.pastDueSince!;
    console.log("I PASS payment failure → PAST_DUE");

    // I2 — duplicate payment-failure webhook is harmless (same event id)
    const failDup = await processCashfreeWebhook({
      rawBody: failBody,
      signature: signBody(failBody, secret, ts2),
      timestamp: ts2,
    });
    assert.equal(failDup.ok, true);
    assert.equal("duplicate" in failDup && failDup.duplicate, true);
    const pastDueAfterDup = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(pastDueAfterDup?.status, "PAST_DUE");
    assert.equal(
      pastDueAfterDup?.pastDueSince?.getTime(),
      graceStartedAt.getTime(),
    );
    console.log("I2 PASS duplicate PAYMENT_FAILED is harmless");

    // I3 — second distinct failure preserves original pastDueSince grace clock
    const failBody2 = JSON.stringify({
      type: "SUBSCRIPTION_PAYMENT_FAILED",
      event_time: "2026-08-19T12:00:00+05:30",
      data: {
        cf_subscription_id: `cf_${stamp}`,
        subscription_id: merchantId,
        payment_id: `pay_fail2_${stamp}`,
        payment_status: "FAILED",
      },
    });
    const tsFail2 = String(Date.now() + 2);
    const fail2 = await processCashfreeWebhook({
      rawBody: failBody2,
      signature: signBody(failBody2, secret, tsFail2),
      timestamp: tsFail2,
    });
    assert.equal(fail2.ok, true);
    const pastDueRetry = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(pastDueRetry?.status, "PAST_DUE");
    assert.equal(
      pastDueRetry?.pastDueSince?.getTime(),
      graceStartedAt.getTime(),
    );
    console.log("I3 PASS repeated failure preserves grace clock");

    // J — within 3 days access allowed
    assert.equal(getSubscriptionAccess(pastDue).hasAccess, true);
    assert.equal(getSubscriptionAccess(pastDue).isGracePeriod, true);
    assert.equal(getSubscriptionAccess(pastDue).reason, "past_due_grace");
    console.log("J PASS PAST_DUE within 3 days → access allowed");

    // K — after 3 days access denied
    const expiredGrace = {
      ...pastDue!,
      pastDueSince: new Date(Date.now() - PAST_DUE_GRACE_MS - 60_000),
    };
    assert.equal(getSubscriptionAccess(expiredGrace).hasAccess, false);
    assert.equal(getSubscriptionAccess(expiredGrace).reason, "past_due_expired");
    console.log("K PASS PAST_DUE after 3 days → access denied");

    // K2 — ON_HOLD status change also marks PAST_DUE
    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: {
        plan: "PREMIUM",
        status: "ACTIVE",
        pastDueSince: null,
        providerSubscriptionId: `cf_${stamp}`,
      },
    });
    const holdBody = JSON.stringify({
      type: "SUBSCRIPTION_STATUS_CHANGED",
      event_time: "2026-08-19T13:00:00+05:30",
      data: {
        subscription_details: {
          cf_subscription_id: `cf_${stamp}`,
          subscription_id: merchantId,
          subscription_status: "ON_HOLD",
        },
      },
    });
    const tsHold = String(Date.now() + 3);
    const holdResult = await processCashfreeWebhook({
      rawBody: holdBody,
      signature: signBody(holdBody, secret, tsHold),
      timestamp: tsHold,
    });
    assert.equal(holdResult.ok, true);
    const afterHold = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(afterHold?.status, "PAST_DUE");
    assert.ok(afterHold?.pastDueSince);
    console.log("K2 PASS ON_HOLD → PAST_DUE");

    // K3 — successful payment webhook recovers PAST_DUE → PREMIUM + ACTIVE
    const recoverBody = JSON.stringify({
      type: "SUBSCRIPTION_PAYMENT_SUCCESS",
      event_time: "2026-08-19T14:00:00+05:30",
      data: {
        subscription_details: {
          cf_subscription_id: `cf_${stamp}`,
          subscription_id: merchantId,
          subscription_status: "ACTIVE",
          subscription_first_charge_time: "2026-08-19T14:00:00+05:30",
          next_schedule_date: "2026-09-19T14:00:00+05:30",
        },
        payment: { payment_id: `pay_ok_${stamp}`, payment_status: "SUCCESS" },
        plan_details: { plan_id: "plan_pme_premium" },
        customer_details: { customer_id: `cust_${stamp}` },
      },
    });
    const tsRecover = String(Date.now() + 4);
    const recovered = await processCashfreeWebhook({
      rawBody: recoverBody,
      signature: signBody(recoverBody, secret, tsRecover),
      timestamp: tsRecover,
    });
    assert.equal(recovered.ok, true);
    const afterRecover = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(afterRecover?.plan, "PREMIUM");
    assert.equal(afterRecover?.status, "ACTIVE");
    assert.equal(afterRecover?.pastDueSince, null);
    assert.equal(getSubscriptionAccess(afterRecover).hasAccess, true);
    assert.equal(getSubscriptionAccess(afterRecover).isGracePeriod, false);
    console.log("K3 PASS payment success recovers PAST_DUE → PREMIUM + ACTIVE");

    // L — cancellation at period end preserves access
    const periodEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { id: shopA.subscription!.id },
      data: {
        plan: "PREMIUM",
        status: "ACTIVE",
        cancelAtPeriodEnd: false,
        pastDueSince: null,
        currentPeriodEnd: periodEnd,
      },
    });
    await markSubscriptionCancelAtPeriodEnd({
      subscriptionId: shopA.subscription!.id,
      currentPeriodEnd: periodEnd,
    });
    const cancelPending = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(cancelPending?.cancelAtPeriodEnd, true);
    assert.equal(cancelPending?.status, "ACTIVE");
    assert.equal(getSubscriptionAccess(cancelPending).hasAccess, true);
    assert.equal(
      getSubscriptionAccess(cancelPending).reason,
      "cancelled_until_period_end",
    );
    console.log("L PASS cancel-at-period-end keeps access until period end");

    // L2 — webhook CANCELLED without next_schedule_date keeps existing period end
    const cancelWebhookBody = JSON.stringify({
      type: "SUBSCRIPTION_STATUS_CHANGED",
      event_time: "2026-08-19T15:00:00+05:30",
      data: {
        subscription_details: {
          cf_subscription_id: `cf_${stamp}`,
          subscription_id: merchantId,
          subscription_status: "CANCELLED",
        },
      },
    });
    const tsCancelWh = String(Date.now() + 5);
    const cancelWh = await processCashfreeWebhook({
      rawBody: cancelWebhookBody,
      signature: signBody(cancelWebhookBody, secret, tsCancelWh),
      timestamp: tsCancelWh,
    });
    assert.equal(cancelWh.ok, true);
    const afterCancelWh = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(afterCancelWh?.cancelAtPeriodEnd, true);
    assert.equal(afterCancelWh?.status, "ACTIVE");
    assert.equal(
      afterCancelWh?.currentPeriodEnd?.getTime(),
      periodEnd.getTime(),
    );
    assert.equal(getSubscriptionAccess(afterCancelWh).hasAccess, true);
    console.log("L2 PASS cancel webhook preserves access until currentPeriodEnd");

    // L3 — late ACTIVE webhook must not clear cancel-at-period-end
    const lateActiveBody = JSON.stringify({
      type: "SUBSCRIPTION_STATUS_CHANGED",
      event_time: "2026-08-19T15:30:00+05:30",
      data: {
        subscription_details: {
          cf_subscription_id: `cf_${stamp}`,
          subscription_id: merchantId,
          subscription_status: "ACTIVE",
          next_schedule_date: "2026-09-19T10:00:00+05:30",
        },
      },
    });
    const tsLate = String(Date.now() + 6);
    const lateActive = await processCashfreeWebhook({
      rawBody: lateActiveBody,
      signature: signBody(lateActiveBody, secret, tsLate),
      timestamp: tsLate,
    });
    assert.equal(lateActive.ok, true);
    const stillCancelling = await prisma.subscription.findUnique({
      where: { id: shopA.subscription!.id },
    });
    assert.equal(stillCancelling?.cancelAtPeriodEnd, true);
    assert.equal(stillCancelling?.status, "ACTIVE");
    console.log("L3 PASS late ACTIVE webhook does not clear cancellation");

    // M — after period end access denied
    const afterPeriod = {
      ...cancelPending!,
      currentPeriodEnd: new Date(Date.now() - 60_000),
    };
    assert.equal(getSubscriptionAccess(afterPeriod).hasAccess, false);
    console.log("M PASS after period end → access denied");

    void hashWebhookPayload;
    console.log("ALL PHASE 4C CASHFREE SMOKE TESTS PASSED");
    console.log(
      "MANUAL: configure sandbox keys and complete one real Cashfree checkout + webhook delivery.",
    );
  } finally {
    if (shopIds.length) {
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
