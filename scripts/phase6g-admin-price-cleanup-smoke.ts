/**
 * Phase 6G — Cashfree admin price, root metadata, and trial labels.
 * Run: npx tsx scripts/phase6g-admin-price-cleanup-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import {
  ADMIN_SETTINGS_ID,
  updateAdminSettings,
} from "../lib/admin-settings";
import { hashPassword } from "../lib/auth";
import {
  applyNormalizedOneTimePayment,
  createBillingCheckout,
} from "../lib/billing/service";
import { SITE } from "../lib/marketing";
import {
  createNestedTrialSubscription,
  toPublicSubscriptionView,
} from "../lib/subscription";

const prisma = new PrismaClient();

function cashfreeResponse(bodyText: string) {
  const sent = JSON.parse(bodyText || "{}") as { subscription_id?: string };
  return new Response(
    JSON.stringify({
      subscription_id: sent.subscription_id,
      cf_subscription_id: `cf_${sent.subscription_id}`,
      subscription_session_id: `sub_session_${sent.subscription_id}`,
      subscription_status: "INITIALIZED",
      plan_details: { plan_id: "plan_test" },
      customer_details: { customer_id: "cust_test" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function main() {
  assert.doesNotMatch(SITE.description, /₹\s*199/);
  assert.doesNotMatch(SITE.description, /7-day/i);
  assert.doesNotMatch(SITE.description, /7 day/i);
  console.log("E PASS root metadata has no hardcoded ₹199 or 7-day offer");

  const stamp = Date.now().toString(36);
  const prior = await prisma.adminSetting.findUnique({
    where: { id: ADMIN_SETTINGS_ID },
  });
  const admin = await prisma.user.create({
    data: {
      name: "Cleanup Admin",
      email: `cleanup-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  const owner = await prisma.user.create({
    data: {
      name: "Cleanup Shop",
      email: `cleanup-shop-${stamp}@example.com`,
      passwordHash: await hashPassword("SmokeTestPass!234"),
      role: "SHOPKEEPER",
    },
  });
  const shop = await prisma.shop.create({
    data: {
      shopCode: `CL${stamp}`.slice(0, 12),
      shopName: "Cleanup Shop",
      phone: "9876543210",
      address: "Addr",
      ownerId: owner.id,
      subscription: {
        create: createNestedTrialSubscription(new Date("2026-04-01T00:00:00.000Z"), 7),
      },
    },
    include: { subscription: true },
  });

  const prevProvider = process.env.BILLING_PROVIDER;
  const prevMode = process.env.BILLING_MODE;
  const prevClientId = process.env.CASHFREE_CLIENT_ID;
  const prevClientSecret = process.env.CASHFREE_CLIENT_SECRET;
  const prevPlanId = process.env.CASHFREE_PLAN_ID;
  const prevFetch = globalThis.fetch;
  let capturedAmount: number | null = null;

  process.env.CASHFREE_CLIENT_ID = prevClientId?.trim() || "test-client-id";
  process.env.CASHFREE_CLIENT_SECRET = prevClientSecret?.trim() || "test-client-secret";
  delete process.env.CASHFREE_PLAN_ID;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const text = String(init?.body || "{}");
    const sent = JSON.parse(text) as {
      authorization_details?: { authorization_amount?: number };
      plan_details?: { plan_amount?: number };
    };
    capturedAmount =
      sent.authorization_details?.authorization_amount ??
      sent.plan_details?.plan_amount ??
      null;
    assert.equal(sent.plan_details?.plan_amount, capturedAmount);
    return cashfreeResponse(text);
  }) as typeof fetch;

  try {
    if (prior) {
      await prisma.adminSetting.delete({ where: { id: ADMIN_SETTINGS_ID } });
    }

    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 199 },
    });
    process.env.BILLING_PROVIDER = "cashfree";
    process.env.BILLING_MODE = "SUBSCRIPTION";
    const at199 = await createBillingCheckout({
      shopId: shop.id,
      shopCode: shop.shopCode,
      customer: { name: "Cleanup Shop", email: owner.email, phone: "9876543210" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
    });
    assert.equal(at199.ok, true, at199.ok ? "" : at199.error);
    if (at199.ok) assert.equal(at199.checkout.amountInr, 199);
    assert.equal(capturedAmount, 199);
    console.log("A PASS Admin price ₹199 → Cashfree checkout uses ₹199");

    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 249 },
    });
    const at249 = await createBillingCheckout({
      shopId: shop.id,
      shopCode: shop.shopCode,
      customer: { name: "Cleanup Shop", email: owner.email, phone: "9876543210" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
    });
    assert.equal(at249.ok, true, at249.ok ? "" : at249.error);
    if (at249.ok) assert.equal(at249.checkout.amountInr, 249);
    assert.equal(capturedAmount, 249);
    console.log("B PASS Admin price ₹249 → Cashfree checkout uses ₹249");

    process.env.BILLING_PROVIDER = "payu";
    process.env.BILLING_MODE = "ONE_TIME";
    const payu = await createBillingCheckout({
      shopId: shop.id,
      shopCode: shop.shopCode,
      customer: { name: "Cleanup Shop", email: owner.email, phone: "9876543210" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
    });
    assert.equal(payu.ok, false);
    const pending = await prisma.billingPayment.findFirstOrThrow({
      where: { shopId: shop.id, provider: "PAYU" },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(pending.amountInr, 249);
    await prisma.billingPayment.update({
      where: { id: pending.id },
      data: { status: "PENDING", failureReason: null },
    });
    console.log("C PASS Admin price ₹249 → PayU checkout uses ₹249");

    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 299 },
    });
    const confirmed = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "payu",
      eventId: `cleanup-ok-${stamp}`,
      payment: {
        provider: "payu",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 249,
        currency: "INR",
        providerOrderId: pending.providerOrderId,
        providerPaymentId: `pay_cleanup_${stamp}`,
      },
    });
    assert.equal(confirmed.result, "activated");
    const paid = await prisma.billingPayment.findUniqueOrThrow({
      where: { id: pending.id },
    });
    assert.equal(paid.amountInr, 249);
    assert.equal(paid.status, "SUCCESS");
    console.log("D PASS existing BillingPayment amount stays authoritative");

    const base = shop.subscription!;
    const now = new Date("2026-01-01T00:00:00.000Z");
    for (const days of [7, 14, 30] as const) {
      const view = toPublicSubscriptionView(
        {
          ...base,
          status: "TRIALING",
          plan: "TRIAL",
          trialStartAt: now,
          trialEndAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
        },
        now,
      );
      assert.equal(view?.label, `${days}-Day Free Trial`);
    }
    console.log("F PASS valid 7-day trial displays 7 days");
    console.log("G PASS valid 14-day trial displays 14 days");
    console.log("H PASS valid 30-day trial displays 30 days");

    const missing = toPublicSubscriptionView(
      {
        ...base,
        status: "TRIALING",
        plan: "TRIAL",
        trialStartAt: null,
        trialEndAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
      now,
    );
    assert.equal(missing?.label, "Free Trial");
    assert.doesNotMatch(missing?.label || "", /7-Day Free Trial/i);
    console.log("I PASS invalid trial window does not display 7-Day Free Trial");

    console.log("\nphase6g-admin-price-cleanup-smoke: ALL PASS");
  } finally {
    process.env.BILLING_PROVIDER = prevProvider;
    process.env.BILLING_MODE = prevMode;
    if (prevClientId === undefined) delete process.env.CASHFREE_CLIENT_ID;
    else process.env.CASHFREE_CLIENT_ID = prevClientId;
    if (prevClientSecret === undefined) delete process.env.CASHFREE_CLIENT_SECRET;
    else process.env.CASHFREE_CLIENT_SECRET = prevClientSecret;
    if (prevPlanId === undefined) delete process.env.CASHFREE_PLAN_ID;
    else process.env.CASHFREE_PLAN_ID = prevPlanId;
    globalThis.fetch = prevFetch;

    await prisma.billingPayment.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: admin.id } });
    if (prior) {
      await prisma.adminSetting.upsert({
        where: { id: ADMIN_SETTINGS_ID },
        update: {
          premiumAmountInr: prior.premiumAmountInr,
          trialEnabled: prior.trialEnabled,
          trialDays: prior.trialDays,
        },
        create: {
          id: ADMIN_SETTINGS_ID,
          premiumAmountInr: prior.premiumAmountInr,
          trialEnabled: prior.trialEnabled,
          trialDays: prior.trialDays,
        },
      });
    } else {
      await prisma.adminSetting.deleteMany({ where: { id: ADMIN_SETTINGS_ID } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, owner.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
