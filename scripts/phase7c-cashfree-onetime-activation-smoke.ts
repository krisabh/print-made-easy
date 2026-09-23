/**
 * Cashfree one-time payment must activate Premium after PayU was the live provider.
 * Run: npx tsx scripts/phase7c-cashfree-onetime-activation-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { createCashfreeAdapter } from "../lib/billing/cashfree-adapter";
import {
  applyNormalizedOneTimePayment,
  confirmShopOneTimePayments,
  createBillingCheckout,
  getPublicBillingView,
} from "../lib/billing/service";
import {
  cashfreeNotifyUrl,
  createCashfreeOrder,
  getCashfreeOrder,
  withCashfreeOrderPlaceholder,
} from "../lib/cashfree";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();
const ADMIN_SETTINGS_ID = "platform";

function localOnly() {
  const dbUrl = process.env.DATABASE_URL || "";
  let host = "";
  try {
    host = new URL(dbUrl).hostname;
  } catch {
    host = "";
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Refusing to run this smoke against a non-local database.");
  }
}

async function shop(stamp: string, tag: string) {
  return prisma.shop.create({
    data: {
      shopCode: `CF${tag}${stamp}`.slice(0, 20),
      shopName: `Cashfree ${tag}`,
      phone: "9876543210",
      address: "Addr",
      email: `cf-${tag}-${stamp}@example.com`,
      subscription: { create: createNestedTrialSubscription() },
    },
    include: { subscription: true },
  });
}

async function main() {
  localOnly();
  const stamp = Date.now().toString(36);
  const prevFetch = globalThis.fetch;
  const prevProvider = process.env.BILLING_PROVIDER;
  const prevMode = process.env.BILLING_MODE;
  const prevClientId = process.env.CASHFREE_CLIENT_ID;
  const prevClientSecret = process.env.CASHFREE_CLIENT_SECRET;
  const prevEnv = process.env.CASHFREE_ENVIRONMENT;
  process.env.CASHFREE_CLIENT_ID = "test-client-id";
  process.env.CASHFREE_CLIENT_SECRET = "test-client-secret";
  process.env.CASHFREE_ENVIRONMENT = "sandbox";
  process.env.BILLING_PROVIDER = "cashfree";
  process.env.BILLING_MODE = "one_time";

  const shopIds: string[] = [];
  const couponIds: string[] = [];
  const prior = await prisma.adminSetting.findUnique({
    where: { id: ADMIN_SETTINGS_ID },
  });

  const pricing = fs.readFileSync(
    path.join(process.cwd(), "components/dashboard/saas-pricing-plans.tsx"),
    "utf8",
  );
  assert.match(pricing, /returnedOrderId/);
  assert.match(pricing, /\/api\/billing\/confirm/);
  assert.equal(pricing.includes('plan: "PREMIUM"'), false);
  console.log("UI PASS return starts server confirm and does not grant Premium itself");

  const returnUrl = "https://printyantra.com/dashboard/pricing?payment=return";
  assert.equal(
    withCashfreeOrderPlaceholder(returnUrl),
    "https://printyantra.com/dashboard/pricing?payment=return&order_id={order_id}",
  );
  assert.equal(
    cashfreeNotifyUrl(returnUrl),
    "https://printyantra.com/api/webhooks/cashfree",
  );

  try {
    await prisma.adminSetting.upsert({
      where: { id: ADMIN_SETTINGS_ID },
      update: { premiumAmountInr: 249 },
      create: {
        id: ADMIN_SETTINGS_ID,
        premiumAmountInr: 249,
        trialEnabled: true,
        trialDays: 5,
      },
    });

    const buyer = await shop(stamp, "BUY");
    shopIds.push(buyer.id);
    let createdBody: { order_amount?: number; order_meta?: { return_url?: string; notify_url?: string } } | null = null;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      createdBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          payment_session_id: `session-${stamp}`,
          order_id: createdBody?.order_meta ? "ignored" : "ignored",
          order_status: "ACTIVE",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const checkout = await createBillingCheckout({
      shopId: buyer.id,
      shopCode: buyer.shopCode,
      customer: { name: "Buyer", email: buyer.email || "b@example.com", phone: "9876543210" },
      returnUrl,
    });
    assert.equal(checkout.ok, true);
    if (checkout.ok) assert.equal(checkout.checkout.amountInr, 249);
    assert.equal(createdBody?.order_amount, 249);
    assert.match(createdBody?.order_meta?.return_url || "", /payment=return/);
    assert.match(createdBody?.order_meta?.return_url || "", /\{order_id\}/);
    assert.equal(
      createdBody?.order_meta?.notify_url,
      "https://printyantra.com/api/webhooks/cashfree",
    );
    const pending = await prisma.billingPayment.findFirstOrThrow({
      where: { shopId: buyer.id },
    });
    assert.equal(pending.amountInr, 249);
    assert.equal(pending.status, "PENDING");
    console.log("4 PASS new Cashfree checkout uses the Admin price");

    await prisma.adminSetting.update({
      where: { id: ADMIN_SETTINGS_ID },
      data: { premiumAmountInr: 299 },
    });

    const early = await confirmShopOneTimePayments(buyer.id, {
      verify: async () => ({
        status: "FAILED" as const,
        amountInr: 249,
        currency: "INR",
        providerOrderId: pending.providerOrderId,
        providerPaymentId: null,
        failureReason: "Order status: ACTIVE",
      }),
    });
    assert.notEqual(early.result, "activated");
    assert.equal(
      (await prisma.subscription.findUnique({ where: { shopId: buyer.id } }))?.status,
      "TRIALING",
    );
    assert.equal(
      (await prisma.billingPayment.findUnique({ where: { id: pending.id } }))?.status,
      "PENDING",
    );
    console.log("RACE PASS returning before payment is confirmed does not activate Premium");

    globalThis.fetch = (async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/payments")) {
        return new Response(
          JSON.stringify([
            {
              cf_payment_id: `cfpay-${stamp}`,
              payment_status: "SUCCESS",
              payment_amount: 249.0,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          order_id: pending.providerOrderId,
          order_status: "ACTIVE",
          order_amount: 249.0,
          order_currency: "INR",
          payments: { url: `${href}/payments` },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const lookedUp = await getCashfreeOrder({ orderId: pending.providerOrderId });
    assert.equal(lookedUp.orderStatus, "ACTIVE");
    assert.equal(lookedUp.paymentStatus, "SUCCESS");
    const verified = await createCashfreeAdapter().oneTime!.verifyOneTimePayment({
      providerOrderId: pending.providerOrderId,
    });
    assert.equal(verified.status, "SUCCESS");
    assert.equal(verified.amountInr, 249);

    const confirmed = await confirmShopOneTimePayments(buyer.id);
    assert.equal(confirmed.result, "activated");
    const paid = await prisma.billingPayment.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(paid.status, "SUCCESS");
    assert.equal(paid.amountInr, 249);
    const premium = await prisma.subscription.findUniqueOrThrow({ where: { shopId: buyer.id } });
    assert.equal(premium.plan, "PREMIUM");
    assert.equal(premium.status, "ACTIVE");
    assert.ok(premium.currentPeriodStart);
    assert.ok(premium.currentPeriodEnd);
    assert.ok(premium.currentPeriodEnd.getTime() > premium.currentPeriodStart.getTime());
    const view = confirmed.subscription;
    assert.equal(view?.plan, "PREMIUM");
    assert.equal(view?.status, "ACTIVE");
    assert.equal(view?.hasAccess, true);
    const again = await confirmShopOneTimePayments(buyer.id);
    assert.equal(again.result, "no_pending");
    assert.equal(
      (await prisma.subscription.findUnique({ where: { shopId: buyer.id } }))?.currentPeriodEnd?.toISOString(),
      premium.currentPeriodEnd?.toISOString(),
    );
    console.log("1 PASS Cashfree success sets BillingPayment SUCCESS");
    console.log("2 PASS subscription becomes PREMIUM ACTIVE");
    console.log("3 PASS a paid period is stored");
    console.log("5 PASS stored BillingPayment.amountInr stays authoritative");
    console.log("7 PASS a second confirmation does not extend the period");
    console.log("11 PASS the next pricing view is Premium Active");

    const couponShop = await shop(stamp, "CPN");
    shopIds.push(couponShop.id);
    const coupon = await prisma.coupon.create({
      data: {
        code: `CF${stamp}`.slice(0, 32),
        type: "FIXED",
        value: 50,
        isActive: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2027-01-01T00:00:00.000Z"),
      },
    });
    couponIds.push(coupon.id);
    const couponOrder = `PMEPAY-CPN-${stamp}`;
    const couponPayment = await prisma.billingPayment.create({
      data: {
        shopId: couponShop.id,
        provider: "CASHFREE",
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 199,
        currency: "INR",
        providerOrderId: couponOrder,
        metadataJson: JSON.stringify({ couponId: coupon.id, couponCode: coupon.code }),
      },
    });
    const couponApplied = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `coupon-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199.0,
        currency: "INR",
        providerOrderId: couponOrder,
        providerPaymentId: `cf-coupon-${stamp}`,
      },
    });
    assert.equal(couponApplied.result, "activated");
    assert.equal(
      await prisma.couponRedemption.count({ where: { billingPaymentId: couponPayment.id } }),
      1,
    );
    const couponRepeat = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "cashfree",
      eventId: `coupon-repeat-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199,
        currency: "INR",
        providerOrderId: couponOrder,
        providerPaymentId: `cf-coupon-${stamp}`,
      },
    });
    assert.equal(couponRepeat.result, "already_applied");
    assert.equal(
      await prisma.couponRedemption.count({ where: { billingPaymentId: couponPayment.id } }),
      1,
    );
    assert.equal(
      (await prisma.subscription.findUnique({ where: { shopId: couponShop.id } }))?.plan,
      "PREMIUM",
    );
    console.log("6 PASS a coupon-priced Cashfree payment activates Premium once");

    const failedShop = await shop(stamp, "BAD");
    shopIds.push(failedShop.id);
    const failedOrder = `PMEPAY-BAD-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId: failedShop.id,
        provider: "CASHFREE",
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 249,
        currency: "INR",
        providerOrderId: failedOrder,
      },
    });
    const failed = await applyNormalizedOneTimePayment({
      type: "PAYMENT_FAILED",
      provider: "cashfree",
      eventId: `fail-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "FAILED",
        amountInr: 249,
        currency: "INR",
        providerOrderId: failedOrder,
        providerPaymentId: null,
        failureReason: "Payment failed",
      },
    });
    assert.equal(failed.result, "payment_failed");
    assert.equal(
      (await prisma.billingPayment.findFirst({ where: { providerOrderId: failedOrder } }))?.status,
      "FAILED",
    );
    assert.equal(
      (await prisma.subscription.findUnique({ where: { shopId: failedShop.id } }))?.plan,
      "TRIAL",
    );
    assert.equal(await prisma.couponRedemption.count({ where: { shopId: failedShop.id } }), 0);
    console.log("8 PASS a failed Cashfree payment does not activate Premium");

    const droppedShop = await shop(stamp, "DRP");
    shopIds.push(droppedShop.id);
    const droppedOrder = `PMEPAY-DRP-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId: droppedShop.id,
        provider: "CASHFREE",
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 249,
        currency: "INR",
        providerOrderId: droppedOrder,
      },
    });
    await applyNormalizedOneTimePayment({
      type: "PAYMENT_FAILED",
      provider: "cashfree",
      eventId: `drop-${stamp}`,
      payment: {
        provider: "cashfree",
        mode: "ONE_TIME",
        status: "FAILED",
        amountInr: 249,
        currency: "INR",
        providerOrderId: droppedOrder,
        providerPaymentId: null,
        failureReason: "PAYMENT_USER_DROPPED_WEBHOOK",
      },
    });
    assert.equal(
      (await prisma.subscription.findUnique({ where: { shopId: droppedShop.id } }))?.status,
      "TRIALING",
    );
    console.log("9 PASS an abandoned Cashfree payment does not activate Premium");

    const payuShop = await shop(stamp, "PYU");
    shopIds.push(payuShop.id);
    const payuOrder = `PMEPAY-PYU-${stamp}`;
    await prisma.billingPayment.create({
      data: {
        shopId: payuShop.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 249,
        currency: "INR",
        providerOrderId: payuOrder,
      },
    });
    const payuApplied = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "payu",
      eventId: `payu-${stamp}`,
      payment: {
        provider: "payu",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 249,
        currency: "INR",
        providerOrderId: payuOrder,
        providerPaymentId: `mih-${stamp}`,
      },
    });
    assert.equal(payuApplied.result, "activated");
    assert.equal(
      (await prisma.subscription.findUnique({ where: { shopId: payuShop.id } }))?.plan,
      "PREMIUM",
    );
    console.log("10 PASS PayU one-time activation is unchanged");

    const trialShop = await shop(stamp, "TRL");
    shopIds.push(trialShop.id);
    assert.equal(trialShop.subscription?.plan, "TRIAL");
    assert.equal(trialShop.subscription?.status, "TRIALING");
    console.log("12 PASS an untouched trial subscription stays a trial");

    const direct = await createCashfreeOrder({
      orderId: `PMEPAY-DIRECT-${stamp}`.slice(0, 40),
      amountInr: 10,
      currency: "INR",
      customer: { name: "N", email: "n@example.com", phone: "9876543210" },
      returnUrl,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}")) as {
          order_meta?: { return_url?: string };
        };
        assert.match(body.order_meta?.return_url || "", /\{order_id\}/);
        return new Response(
          JSON.stringify({ payment_session_id: "sess", order_id: "x", order_status: "ACTIVE" }),
          { status: 200 },
        );
      },
    });
    assert.equal(direct.paymentSessionId, "sess");
  } finally {
    globalThis.fetch = prevFetch;
    process.env.BILLING_PROVIDER = prevProvider;
    process.env.BILLING_MODE = prevMode;
    if (prevClientId === undefined) delete process.env.CASHFREE_CLIENT_ID;
    else process.env.CASHFREE_CLIENT_ID = prevClientId;
    if (prevClientSecret === undefined) delete process.env.CASHFREE_CLIENT_SECRET;
    else process.env.CASHFREE_CLIENT_SECRET = prevClientSecret;
    if (prevEnv === undefined) delete process.env.CASHFREE_ENVIRONMENT;
    else process.env.CASHFREE_ENVIRONMENT = prevEnv;

    if (shopIds.length) {
      await prisma.couponRedemption.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.billingPayment.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    if (couponIds.length) {
      await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
    }
    if (prior) {
      await prisma.adminSetting.update({
        where: { id: ADMIN_SETTINGS_ID },
        data: {
          premiumAmountInr: prior.premiumAmountInr,
          trialEnabled: prior.trialEnabled,
          trialDays: prior.trialDays,
        },
      });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
