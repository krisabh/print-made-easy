/**
 * Phase 9 — PayU webhook readiness smoke (mocked; no live PayU / no dashboard connect).
 * Run: npx tsx scripts/phase9-payu-webhook-readiness-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { createPayUAdapter } from "../lib/billing/payu-adapter";
import { PREMIUM_PLAN } from "../lib/billing/plan";
import {
  applyNormalizedOneTimePayment,
  confirmShopOneTimePayments,
} from "../lib/billing/service";
import {
  buildPayuReverseHashString,
  computePayuReverseHash,
  PAYU_PROVIDER,
  verifyPayuWebhookHash,
} from "../lib/payu";
import { CASHFREE_PROVIDER } from "../lib/cashfree";
import {
  createNestedTrialSubscription,
  getSubscriptionAccess,
} from "../lib/subscription";
import { markWebhookEventProcessed } from "../lib/billing/webhook-idempotency";

const prisma = new PrismaClient();

const SALT = "test_payu_webhook_salt_32chars_xx";
const KEY = "tstKey";

function buildForm(params: Record<string, string>) {
  const hash = computePayuReverseHash({
    salt: SALT,
    status: params.status || "",
    udf1: params.udf1,
    udf2: params.udf2,
    udf3: params.udf3,
    udf4: params.udf4,
    udf5: params.udf5,
    email: params.email,
    firstname: params.firstname,
    productinfo: params.productinfo,
    amount: params.amount,
    txnid: params.txnid,
    key: params.key,
    additionalCharges: params.additional_charges,
  });
  return new URLSearchParams({ ...params, hash }).toString();
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  process.env.PAYU_MERCHANT_KEY = KEY;
  process.env.PAYU_MERCHANT_SECRET = SALT;
  process.env.PAYU_ENVIRONMENT = "test";
  process.env.BILLING_PROVIDER = "payu";
  process.env.BILLING_MODE = "one_time";
  process.env.CASHFREE_CLIENT_ID = "test_client";
  process.env.CASHFREE_CLIENT_SECRET = "test_secret";
  process.env.CASHFREE_ENVIRONMENT = "sandbox";

  const shopIds: string[] = [];
  const adapter = createPayUAdapter();
  const now = new Date("2026-09-15T12:00:00.000Z");

  try {
    // --- Hash formula vs PayU docs ---
    const formula = buildPayuReverseHashString({
      salt: "SALT",
      status: "success",
      udf5: "u5",
      udf4: "u4",
      udf3: "u3",
      udf2: "u2",
      udf1: "u1",
      email: "a@b.c",
      firstname: "A",
      productinfo: "P",
      amount: "199.00",
      txnid: "T1",
      key: "K",
    });
    assert.equal(
      formula,
      "SALT|success||||||u5|u4|u3|u2|u1|a@b.c|A|P|199.00|T1|K",
    );
    const withCharges = buildPayuReverseHashString({
      salt: "SALT",
      status: "success",
      amount: "199.00",
      txnid: "T1",
      key: "K",
      additionalCharges: "10.00",
    });
    assert.ok(withCharges.startsWith("10.00|SALT|success|"));
    console.log("A PASS reverse-hash formula matches PayU docs (+ additional_charges)");

    const shop = await prisma.shop.create({
      data: {
        shopCode: `W9${stamp}`.slice(0, 12),
        shopName: "PayU Webhook Shop",
        phone: "9666666666",
        address: "99 Audit Road",
        email: `payu-wh-${stamp}@example.com`,
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

    // --- Route GET must be JSON probe, not redirect ---
    const { GET, POST } = await import("../app/api/webhooks/payu/route");
    const probe = await GET();
    assert.equal(probe.status, 200);
    const probeJson = (await probe.json()) as { service?: string };
    assert.equal(probeJson.service, "payu-webhook");
    console.log("B PASS webhook GET is JSON probe (no login redirect)");

    // --- Invalid hash rejected ---
    const txnBad = `PMEPAY-WH-BAD-${stamp}`.slice(0, 45);
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: txnBad,
      },
    });
    const badBody = new URLSearchParams({
      mihpayid: `MIH_BAD_${stamp}`,
      status: "success",
      key: KEY,
      txnid: txnBad,
      amount: "199.00",
      productinfo: "PrintYantra Premium",
      firstname: "A",
      email: shop.email!,
      udf1: shop.id,
      hash: "0".repeat(128),
    }).toString();
    const badNorm = await adapter.oneTimeWebhook!.verifyAndNormalize({
      rawBody: badBody,
      signature: null,
      timestamp: null,
      now,
    });
    assert.equal(badNorm?.ok, false);
    if (badNorm && !badNorm.ok) assert.equal(badNorm.status, 401);

    const badRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: badBody,
      }),
    );
    assert.equal(badRoute.status, 401);
    console.log("C PASS invalid hash rejected (adapter + route)");

    // --- Valid success webhook ---
    const txnOk = `PMEPAY-WH-OK-${stamp}`.slice(0, 45);
    const mihOk = `MIH_OK_${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: txnOk,
      },
    });
    const okBody = buildForm({
      mihpayid: mihOk,
      status: "success",
      key: KEY,
      txnid: txnOk,
      amount: "199.00",
      productinfo: "PrintYantra Premium",
      firstname: "Shop",
      email: shop.email!,
      udf1: shop.id,
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: "",
      unmappedstatus: "captured",
    });
    assert.equal(
      verifyPayuWebhookHash({
        params: Object.fromEntries(new URLSearchParams(okBody)),
        salt: SALT,
      }),
      true,
    );

    const okRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: okBody,
      }),
    );
    assert.equal(okRoute.status, 200);
    const okJson = (await okRoute.json()) as { result?: string; duplicate?: boolean };
    assert.equal(okJson.duplicate, false);
    assert.equal(okJson.result, "activated");

    const payOk = await prisma.billingPayment.findUniqueOrThrow({
      where: {
        provider_providerOrderId: {
          provider: PAYU_PROVIDER,
          providerOrderId: txnOk,
        },
      },
    });
    assert.equal(payOk.status, "SUCCESS");
    assert.equal(payOk.providerPaymentId, mihOk);

    const subOk = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(subOk.plan, "PREMIUM");
    assert.equal(subOk.status, "ACTIVE");
    assert.equal(subOk.provider, PAYU_PROVIDER);
    const periodEndAfterWebhook = subOk.currentPeriodEnd;
    console.log("D PASS valid success webhook → BillingPayment SUCCESS + Premium");

    // --- Duplicate success idempotent ---
    const dupRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: okBody,
      }),
    );
    assert.equal(dupRoute.status, 200);
    const dupJson = (await dupRoute.json()) as { duplicate?: boolean };
    assert.equal(dupJson.duplicate, true);
    const subDup = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(
      subDup.currentPeriodEnd?.toISOString(),
      periodEndAfterWebhook?.toISOString(),
    );
    console.log("E PASS duplicate success webhook is idempotent");

    // --- Browser confirm after webhook: no second month ---
    const confirmAfter = await confirmShopOneTimePayments(shop.id, {
      now,
      verify: async () => ({
        status: "SUCCESS" as const,
        amountInr: 199,
        currency: "INR",
        providerOrderId: txnOk,
        providerPaymentId: mihOk,
        provider: "payu" as const,
        paidAt: now,
      }),
    });
    assert.ok(
      confirmAfter.result === "already_applied" ||
        confirmAfter.result === "no_pending" ||
        confirmAfter.result === "pending_unpaid",
    );
    const subConfirm = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(
      subConfirm.currentPeriodEnd?.toISOString(),
      periodEndAfterWebhook?.toISOString(),
    );
    console.log("F PASS browser confirm after webhook does not double-extend");

    // --- Browser confirm first, then webhook ---
    const txnRace = `PMEPAY-WH-RACE-${stamp}`.slice(0, 45);
    const mihRace = `MIH_RACE_${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: txnRace,
      },
    });
    // Simulate browser verify path applying first
    const browserFirst = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_SUCCEEDED",
        provider: "payu",
        eventId: `confirm:${txnRace}:${mihRace}`,
        payment: {
          provider: "payu",
          mode: "ONE_TIME",
          status: "SUCCESS",
          amountInr: 199,
          currency: "INR",
          providerOrderId: txnRace,
          providerPaymentId: mihRace,
          shopIdHint: shop.id,
          paidAt: now,
        },
      },
      now,
    );
    assert.equal(browserFirst.result, "activated");
    const subAfterBrowser = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    const endAfterBrowser = subAfterBrowser.currentPeriodEnd;

    const raceBody = buildForm({
      mihpayid: mihRace,
      status: "success",
      key: KEY,
      txnid: txnRace,
      amount: "199.00",
      productinfo: "PrintYantra Premium",
      firstname: "Shop",
      email: shop.email!,
      udf1: shop.id,
      unmappedstatus: "captured",
    });
    const raceRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: raceBody,
      }),
    );
    assert.equal(raceRoute.status, 200);
    const raceJson = (await raceRoute.json()) as { result?: string };
    assert.equal(raceJson.result, "already_applied");
    const subAfterRaceWh = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(
      subAfterRaceWh.currentPeriodEnd?.toISOString(),
      endAfterBrowser?.toISOString(),
    );
    console.log("G PASS webhook after browser confirm does not double-extend");

    // --- Failed payment ---
    const txnFail = `PMEPAY-WH-FAIL-${stamp}`.slice(0, 45);
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: txnFail,
      },
    });
    const endBeforeFail = (
      await prisma.subscription.findUniqueOrThrow({ where: { shopId: shop.id } })
    ).currentPeriodEnd;
    const failBody = buildForm({
      mihpayid: `MIH_FAIL_${stamp}`,
      status: "failure",
      key: KEY,
      txnid: txnFail,
      amount: "199.00",
      productinfo: "PrintYantra Premium",
      firstname: "Shop",
      email: shop.email!,
      udf1: shop.id,
      unmappedstatus: "failed",
      error_Message: "Bank declined",
    });
    const failRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: failBody,
      }),
    );
    assert.equal(failRoute.status, 200);
    const payFail = await prisma.billingPayment.findUniqueOrThrow({
      where: {
        provider_providerOrderId: {
          provider: PAYU_PROVIDER,
          providerOrderId: txnFail,
        },
      },
    });
    assert.equal(payFail.status, "FAILED");
    const subFail = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(
      subFail.currentPeriodEnd?.toISOString(),
      endBeforeFail?.toISOString(),
    );
    console.log("H PASS failed webhook → BillingPayment FAILED, no Premium extend");

    // --- Pending ignored ---
    const pendingNorm = await adapter.oneTimeWebhook!.verifyAndNormalize({
      rawBody: new URLSearchParams({
        mihpayid: `MIH_PEND_${stamp}`,
        status: "pending",
        key: KEY,
        txnid: "x",
        amount: "199.00",
        hash: "dead",
      }).toString(),
      signature: null,
      timestamp: null,
      now,
    });
    assert.ok(pendingNorm && pendingNorm.ok && "event" in pendingNorm);
    if (pendingNorm && pendingNorm.ok && "event" in pendingNorm) {
      assert.equal(pendingNorm.event.type, "IGNORED");
    }
    console.log("I PASS pending/unknown status does not activate Premium");

    // --- Unknown transaction ---
    const unknownBody = buildForm({
      mihpayid: `MIH_UNK_${stamp}`,
      status: "success",
      key: KEY,
      txnid: `PMEPAY-WH-UNK-${stamp}`.slice(0, 45),
      amount: "199.00",
      productinfo: "PrintYantra Premium",
      firstname: "Shop",
      email: shop.email!,
      udf1: shop.id,
      unmappedstatus: "captured",
    });
    const unkRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: unknownBody,
      }),
    );
    assert.equal(unkRoute.status, 200);
    const unkJson = (await unkRoute.json()) as { result?: string };
    assert.equal(unkJson.result, "unknown_order");
    console.log("J PASS unknown txnid does not activate Premium");

    // --- Amount mismatch ---
    const txnAmt = `PMEPAY-WH-AMT-${stamp}`.slice(0, 45);
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: txnAmt,
      },
    });
    const endBeforeAmt = (
      await prisma.subscription.findUniqueOrThrow({ where: { shopId: shop.id } })
    ).currentPeriodEnd;
    const amtBody = buildForm({
      mihpayid: `MIH_AMT_${stamp}`,
      status: "success",
      key: KEY,
      txnid: txnAmt,
      amount: "1.00",
      productinfo: "PrintYantra Premium",
      firstname: "Shop",
      email: shop.email!,
      udf1: shop.id,
      unmappedstatus: "captured",
    });
    const amtRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: amtBody,
      }),
    );
    assert.equal(amtRoute.status, 200);
    const amtJson = (await amtRoute.json()) as { result?: string };
    assert.equal(amtJson.result, "amount_mismatch");
    const payAmt = await prisma.billingPayment.findUniqueOrThrow({
      where: {
        provider_providerOrderId: {
          provider: PAYU_PROVIDER,
          providerOrderId: txnAmt,
        },
      },
    });
    assert.equal(payAmt.status, "FAILED");
    const subAmt = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(
      subAmt.currentPeriodEnd?.toISOString(),
      endBeforeAmt?.toISOString(),
    );
    console.log("K PASS amount mismatch rejected");

    // --- Provider isolation: PayU webhook must not touch CASHFREE row ---
    const sharedTxn = `PMEPAY-WH-ISO-${stamp}`.slice(0, 45);
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: CASHFREE_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: sharedTxn,
      },
    });
    const isoBody = buildForm({
      mihpayid: `MIH_ISO_${stamp}`,
      status: "success",
      key: KEY,
      txnid: sharedTxn,
      amount: "199.00",
      productinfo: "PrintYantra Premium",
      firstname: "Shop",
      email: shop.email!,
      udf1: shop.id,
      unmappedstatus: "captured",
    });
    const isoRoute = await POST(
      new Request("http://localhost:3000/api/webhooks/payu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: isoBody,
      }),
    );
    assert.equal(isoRoute.status, 200);
    const isoJson = (await isoRoute.json()) as { result?: string };
    assert.equal(isoJson.result, "unknown_order");
    const cfRow = await prisma.billingPayment.findUniqueOrThrow({
      where: {
        provider_providerOrderId: {
          provider: CASHFREE_PROVIDER,
          providerOrderId: sharedTxn,
        },
      },
    });
    assert.equal(cfRow.status, "PENDING");
    console.log("L PASS PayU webhook does not modify CASHFREE BillingPayment");

    // --- Event ID stability ---
    const params = Object.fromEntries(new URLSearchParams(okBody));
    const id1 = params.mihpayid;
    assert.equal(id1, mihOk);
    const claimRow = await prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_eventId: { provider: PAYU_PROVIDER, eventId: mihOk },
      },
    });
    assert.ok(claimRow?.processedAt);
    console.log("M PASS event ID = mihpayid; PaymentWebhookEvent PAYU unique+processed");

    // --- Retry after apply failure leaves processedAt null path ---
    // Covered by claimWebhookEvent retry semantics (same as Cashfree 7b).
    const retryEventId = `MIH_RETRY_${stamp}`;
    const { claimWebhookEvent } = await import(
      "../lib/billing/webhook-idempotency"
    );
    const c1 = await claimWebhookEvent({
      provider: PAYU_PROVIDER,
      eventId: retryEventId,
      eventType: "Successful",
      payloadHash: "abc",
    });
    assert.equal(c1, "claimed");
    const c2 = await claimWebhookEvent({
      provider: PAYU_PROVIDER,
      eventId: retryEventId,
      eventType: "Successful",
      payloadHash: "abc",
    });
    assert.equal(c2, "retry");
    await markWebhookEventProcessed({
      provider: PAYU_PROVIDER,
      eventId: retryEventId,
    });
    const c3 = await claimWebhookEvent({
      provider: PAYU_PROVIDER,
      eventId: retryEventId,
      eventType: "Successful",
      payloadHash: "abc",
    });
    assert.equal(c3, "already_processed");
    console.log("N PASS claim/retry/processedAt semantics");

    assert.equal(PREMIUM_PLAN.amountInr, 199);
    const access = getSubscriptionAccess(
      await prisma.subscription.findUniqueOrThrow({ where: { shopId: shop.id } }),
      now,
    );
    assert.equal(access.hasAccess, true);

    console.log("\nALL PHASE 9 PAYU WEBHOOK READINESS CHECKS PASSED");
  } finally {
    if (shopIds.length) {
      await prisma.paymentWebhookEvent.deleteMany({
        where: { provider: PAYU_PROVIDER },
      });
      await prisma.billingPayment.deleteMany({
        where: { shopId: { in: shopIds } },
      });
      await prisma.subscription.deleteMany({
        where: { shopId: { in: shopIds } },
      });
      await prisma.printPrice.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.settings.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.inventory.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
