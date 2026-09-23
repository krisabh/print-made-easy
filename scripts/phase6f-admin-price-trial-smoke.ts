/**
 * Phase 6F — Admin price and trial wired into checkout and signup.
 * Run: npx tsx scripts/phase6f-admin-price-trial-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import {
  ADMIN_SETTINGS_ID,
  getCurrentPremiumPriceInr,
  getCurrentTrialOffer,
  updateAdminSettings,
} from "../lib/admin-settings";
import { createBillingCheckout, applyNormalizedOneTimePayment } from "../lib/billing/service";
import { PREMIUM_PLAN } from "../lib/billing/plan";
import { hashPassword } from "../lib/auth";
import {
  buildTrialWindow,
  createNestedSubscriptionForNewShop,
  createNestedTrialSubscription,
  getSubscriptionAccess,
} from "../lib/subscription";

const prisma = new PrismaClient();

async function main() {
  const checkoutRoute = fs.readFileSync(
    path.join(process.cwd(), "app/api/billing/checkout/route.ts"),
    "utf8",
  );
  assert.match(checkoutRoute, /parseCheckoutCouponRequest/);
  assert.equal(/amountInr\s*:/.test(checkoutRoute), false);
  assert.match(
    fs.readFileSync(path.join(process.cwd(), "app/api/admin/settings/route.ts"), "utf8"),
    /requireAdminApi\(\)/,
  );
  console.log("S PASS checkout route does not read a client amount");
  console.log("T PASS admin settings API still requires an admin");

  const stamp = Date.now().toString(36);
  const prior = await prisma.adminSetting.findUnique({
    where: { id: ADMIN_SETTINGS_ID },
  });
  const admin = await prisma.user.create({
    data: {
      name: "Price Admin",
      email: `price-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  const owner = await prisma.user.create({
    data: {
      name: "Price Shop",
      email: `price-shop-${stamp}@example.com`,
      passwordHash: await hashPassword("SmokeTestPass!234"),
      role: "SHOPKEEPER",
    },
  });
  const shop = await prisma.shop.create({
    data: {
      shopCode: `PR${stamp}`.slice(0, 12),
      shopName: "Price Shop",
      phone: "9876543210",
      address: "Addr",
      ownerId: owner.id,
      subscription: { create: createNestedTrialSubscription(new Date("2026-03-01T00:00:00.000Z"), 7) },
    },
    include: { subscription: true },
  });
  const shopB = await prisma.shop.create({
    data: {
      shopCode: `PB${stamp}`.slice(0, 12),
      shopName: "Price Shop B",
      phone: "9876543211",
      address: "Addr",
      subscription: { create: createNestedTrialSubscription() },
    },
  });
  const prevProvider = process.env.BILLING_PROVIDER;
  const prevMode = process.env.BILLING_MODE;
  process.env.BILLING_PROVIDER = "payu";
  process.env.BILLING_MODE = "ONE_TIME";

  try {
    if (prior) {
      await prisma.adminSetting.delete({ where: { id: ADMIN_SETTINGS_ID } });
    }
    assert.equal(await getCurrentPremiumPriceInr(), 199);
    assert.deepEqual(await getCurrentTrialOffer(), { enabled: true, days: 7 });
    const fallbackWindow = buildTrialWindow(new Date("2026-06-01T00:00:00.000Z"));
    assert.equal(
      (fallbackWindow.trialEndAt.getTime() - fallbackWindow.trialStartAt.getTime()) /
        86400000,
      7,
    );
    console.log("A PASS default price ₹199");
    console.log("J PASS default trial 7 days");

    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 249, trialEnabled: true, trialDays: 7 },
    });
    assert.equal(await getCurrentPremiumPriceInr(), 249);
    console.log("B PASS admin price ₹249");

    const first = await createBillingCheckout({
      shopId: shop.id,
      shopCode: shop.shopCode,
      customer: { name: "Price Shop", email: owner.email, phone: "9876543210" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
    });
    assert.equal(first.ok, false);
    const pending = await prisma.billingPayment.findFirstOrThrow({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(pending.amountInr, 249);
    await prisma.billingPayment.update({
      where: { id: pending.id },
      data: { status: "PENDING", failureReason: null },
    });
    console.log("C PASS new checkout uses ₹249");
    console.log("D PASS BillingPayment.amountInr is ₹249");

    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 299 },
    });
    assert.equal(await getCurrentPremiumPriceInr(), 299);
    console.log("E PASS admin price changed to ₹299");

    const confirmed = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: pending.provider === "PAYU" ? "payu" : "cashfree",
      eventId: `ok-${stamp}`,
      payment: {
        provider: pending.provider === "PAYU" ? "payu" : "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 249,
        currency: "INR",
        providerOrderId: pending.providerOrderId,
        providerPaymentId: `pay_${stamp}`,
      },
    });
    assert.equal(confirmed.result, "activated");
    const paid = await prisma.billingPayment.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(paid.amountInr, 249);
    assert.equal(paid.status, "SUCCESS");
    const again = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: pending.provider === "PAYU" ? "payu" : "cashfree",
      eventId: `dup-${stamp}`,
      payment: {
        provider: pending.provider === "PAYU" ? "payu" : "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 249,
        currency: "INR",
        providerOrderId: pending.providerOrderId,
        providerPaymentId: `pay_${stamp}`,
      },
    });
    assert.equal(again.result, "already_applied");
    const active = await prisma.subscription.findUniqueOrThrow({ where: { shopId: shop.id } });
    assert.equal(getSubscriptionAccess(active).reason, "active");
    console.log("F PASS ₹249 payment verifies against its own amount");
    console.log("G PASS ₹249 payment is not rejected because current price is ₹299");
    console.log("H PASS historical amount stays ₹249");
    console.log("V PASS entitlement becomes active");
    console.log("W PASS duplicate confirmation stays idempotent");

    const mismatchOrder = `PMEPAY-MIS-${stamp}`.slice(0, 40);
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: pending.provider,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 249,
        currency: "INR",
        providerOrderId: mismatchOrder,
      },
    });
    const mismatch = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: pending.provider === "PAYU" ? "payu" : "cashfree",
      eventId: `bad-${stamp}`,
      payment: {
        provider: pending.provider === "PAYU" ? "payu" : "cashfree",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 299,
        currency: "INR",
        providerOrderId: mismatchOrder,
        providerPaymentId: `pay_bad_${stamp}`,
      },
    });
    assert.equal(mismatch.result, "amount_mismatch");
    const mismatchRow = await prisma.billingPayment.findFirstOrThrow({
      where: { providerOrderId: mismatchOrder },
    });
    assert.equal(mismatchRow.amountInr, 249);
    assert.equal(mismatchRow.status, "FAILED");
    console.log("I PASS provider amount that differs from the ledger is rejected");

    const second = await createBillingCheckout({
      shopId: shopB.id,
      shopCode: shopB.shopCode,
      customer: { name: "Price Shop B", email: owner.email, phone: "9876543211" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
    });
    assert.equal(second.ok, false);
    const newest = await prisma.billingPayment.findFirstOrThrow({
      where: { shopId: shopB.id },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(newest.amountInr, 299);
    console.log("U PASS a new checkout after the price change uses ₹299");

    const existingTrialEnd = shop.subscription!.trialEndAt!;
    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { trialEnabled: true, trialDays: 14 },
    });
    const fourteen = await createNestedSubscriptionForNewShop(
      new Date("2026-04-01T00:00:00.000Z"),
    );
    assert.equal(fourteen.status, "TRIALING");
    assert.equal(
      (fourteen.trialEndAt!.getTime() - fourteen.trialStartAt!.getTime()) / 86400000,
      14,
    );
    const untouched = await prisma.subscription.findUniqueOrThrow({
      where: { id: shop.subscription!.id },
    });
    assert.equal(untouched.trialEndAt?.toISOString(), existingTrialEnd.toISOString());
    console.log("K PASS trial setting is 14 days");
    console.log("L PASS new signup trial is 14 days");
    console.log("M PASS existing 7-day trial dates unchanged");

    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { trialDays: 30 },
    });
    const thirty = await createNestedSubscriptionForNewShop(
      new Date("2026-05-01T00:00:00.000Z"),
    );
    assert.equal(
      (thirty.trialEndAt!.getTime() - thirty.trialStartAt!.getTime()) / 86400000,
      30,
    );
    assert.equal(
      (fourteen.trialEndAt!.getTime() - fourteen.trialStartAt!.getTime()) / 86400000,
      14,
    );
    console.log("N PASS trial setting is 30 days");
    console.log("O PASS the 14-day window object is unchanged");

    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { trialEnabled: false, trialDays: 0 },
    });
    const none = await createNestedSubscriptionForNewShop();
    assert.equal(none.status, "EXPIRED");
    assert.equal(none.trialStartAt, null);
    assert.equal(none.trialEndAt, null);
    const still = await prisma.subscription.findUniqueOrThrow({
      where: { id: shop.subscription!.id },
    });
    assert.equal(still.trialEndAt?.toISOString(), existingTrialEnd.toISOString());
    console.log("P PASS trial disabled");
    console.log("Q PASS new signup has no trial period");
    console.log("R PASS existing trial remains unchanged");

    assert.equal(PREMIUM_PLAN.amountInr, 199);
    console.log("\nphase6f-admin-price-trial-smoke: ALL PASS");
  } finally {
    process.env.BILLING_PROVIDER = prevProvider;
    process.env.BILLING_MODE = prevMode;
    await prisma.billingPayment.deleteMany({
      where: { shopId: { in: [shop.id, shopB.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shop.id, shopB.id] } } });
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
