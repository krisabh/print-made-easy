/**
 * Phase 6J — coupon checkout pricing and redemption.
 * Run: npx tsx scripts/phase6j-coupon-checkout-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { updateAdminSettings, ADMIN_SETTINGS_ID } from "../lib/admin-settings";
import { applyNormalizedOneTimePayment, createBillingCheckout } from "../lib/billing/service";
import { hashPassword } from "../lib/auth";
import {
  parseCheckoutCouponRequest,
  quoteCouponForCheckout,
} from "../lib/coupon-checkout";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function shop(stamp: string, suffix: string) {
  return prisma.shop.create({
    data: {
      shopCode: `${suffix}${stamp}`.slice(0, 12),
      shopName: `Coupon ${suffix}`,
      phone: "9876543210",
      address: "Addr",
      subscription: { create: createNestedTrialSubscription() },
    },
  });
}

async function main() {
  const fakeAmount = parseCheckoutCouponRequest({
    couponCode: "WELCOME20",
    amount: 1,
    discount: 100,
    finalAmount: 1,
  });
  assert.equal(fakeAmount.ok, false);
  console.log("M PASS browser-supplied amount cannot alter checkout");

  const stamp = Date.now().toString(36).toUpperCase();
  const prior = await prisma.adminSetting.findUnique({ where: { id: ADMIN_SETTINGS_ID } });
  const admin = await prisma.user.create({
    data: {
      name: "Coupon Checkout Admin",
      email: `coupon-checkout-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  const shopA = await shop(stamp, "CA");
  const shopB = await shop(stamp, "CB");
  const prevProvider = process.env.BILLING_PROVIDER;
  const prevMode = process.env.BILLING_MODE;
  process.env.BILLING_PROVIDER = "payu";
  process.env.BILLING_MODE = "ONE_TIME";
  const now = new Date("2026-06-15T00:00:00.000Z");
  const window = {
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: new Date("2026-12-31T00:00:00.000Z"),
  };

  try {
    if (prior) await prisma.adminSetting.delete({ where: { id: ADMIN_SETTINGS_ID } });
    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 200 },
    });

    const plain = await createBillingCheckout({
      shopId: shopA.id,
      shopCode: shopA.shopCode,
      customer: { name: "A", email: "a@example.com", phone: "9876543210" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
      now,
    });
    assert.equal(plain.ok, false);
    const plainRow = await prisma.billingPayment.findFirstOrThrow({ where: { shopId: shopA.id } });
    assert.equal(plainRow.amountInr, 200);
    assert.equal(plainRow.metadataJson?.includes("couponId"), false);
    console.log("A PASS no coupon uses the current Admin price");

    const percent = await prisma.coupon.create({
      data: { code: `P20${stamp}`, type: "PERCENT", value: 20, isActive: true, ...window },
    });
    const percentCheckout = await createBillingCheckout({
      shopId: shopB.id,
      shopCode: shopB.shopCode,
      customer: { name: "B", email: "b@example.com", phone: "9876543210" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
      couponCode: `p20${stamp}`,
      now,
    });
    assert.equal(percentCheckout.ok, false);
    const percentRow = await prisma.billingPayment.findFirstOrThrow({ where: { shopId: shopB.id } });
    assert.equal(percentRow.amountInr, 160);
    assert.equal(percentCheckout.ok, false);
    console.log("B PASS global percentage coupon discounts the checkout");

    const fixedShop = await shop(stamp, "CF");
    const fixed = await prisma.coupon.create({
      data: { code: `F60${stamp}`, type: "FIXED", value: 60, isActive: true, ...window },
    });
    await createBillingCheckout({
      shopId: fixedShop.id,
      shopCode: fixedShop.shopCode,
      customer: { name: "F", email: "f@example.com", phone: "9876543210" },
      returnUrl: "http://localhost:3000/dashboard/pricing?payment=return",
      couponCode: fixed.code,
      now,
    });
    const fixedRow = await prisma.billingPayment.findFirstOrThrow({ where: { shopId: fixedShop.id } });
    assert.equal(fixedRow.amountInr, 140);
    console.log("C PASS global fixed coupon discounts the checkout");

    const specificShop = await shop(stamp, "CS");
    const otherShop = await shop(stamp, "CO");
    const specific = await prisma.coupon.create({
      data: {
        code: `SHOP${stamp}`,
        type: "FIXED",
        value: 25,
        isActive: true,
        shopId: specificShop.id,
        ...window,
      },
    });
    const specificQuote = await quoteCouponForCheckout({
      shopId: specificShop.id,
      couponCode: specific.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(specificQuote.ok, true);
    if (specificQuote.ok) assert.equal(specificQuote.quote.finalAmountInr, 175);
    const wrongShop = await quoteCouponForCheckout({
      shopId: otherShop.id,
      couponCode: specific.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(wrongShop.ok, false);
    console.log("D PASS shop-specific coupon applies to its shop");
    console.log("E PASS wrong shop is rejected");
    console.log("W PASS shop-specific coupon works only for its shop");

    const otherGlobal = await quoteCouponForCheckout({
      shopId: otherShop.id,
      couponCode: percent.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(otherGlobal.ok, true);
    console.log("V PASS global coupon works for another eligible shop");

    await prisma.coupon.update({ where: { id: percent.id }, data: { isActive: false } });
    const inactive = await quoteCouponForCheckout({
      shopId: shopA.id,
      couponCode: percent.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(inactive.ok, false);
    await prisma.coupon.update({ where: { id: percent.id }, data: { isActive: true } });
    console.log("F PASS inactive coupon is rejected");

    const future = await prisma.coupon.create({
      data: {
        code: `FUT${stamp}`,
        type: "FIXED",
        value: 10,
        isActive: true,
        validFrom: new Date("2026-07-01T00:00:00.000Z"),
        validUntil: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const futureQuote = await quoteCouponForCheckout({
      shopId: shopA.id,
      couponCode: future.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(futureQuote.ok, false);
    console.log("G PASS future coupon is rejected");

    const expired = await prisma.coupon.create({
      data: {
        code: `EXP${stamp}`,
        type: "FIXED",
        value: 10,
        isActive: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    const expiredQuote = await quoteCouponForCheckout({
      shopId: shopA.id,
      couponCode: expired.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(expiredQuote.ok, false);
    console.log("H PASS expired coupon is rejected");

    const capped = await prisma.coupon.create({
      data: {
        code: `MAX${stamp}`,
        type: "FIXED",
        value: 10,
        isActive: true,
        maxRedemptions: 1,
        ...window,
      },
    });
    const capPayment = await prisma.billingPayment.create({
      data: {
        shopId: shopA.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 190,
        currency: "INR",
        providerOrderId: `CAP-${stamp}`,
      },
    });
    await prisma.couponRedemption.create({
      data: { couponId: capped.id, shopId: shopA.id, billingPaymentId: capPayment.id },
    });
    const cappedQuote = await quoteCouponForCheckout({
      shopId: otherShop.id,
      couponCode: capped.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(cappedQuote.ok, false);
    console.log("I PASS max redemptions reached");

    const perShop = await prisma.coupon.create({
      data: {
        code: `PER${stamp}`,
        type: "FIXED",
        value: 10,
        isActive: true,
        perShopLimit: 1,
        ...window,
      },
    });
    const perPayment = await prisma.billingPayment.create({
      data: {
        shopId: shopA.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 190,
        currency: "INR",
        providerOrderId: `PER-${stamp}`,
      },
    });
    await prisma.couponRedemption.create({
      data: { couponId: perShop.id, shopId: shopA.id, billingPaymentId: perPayment.id },
    });
    const perShopBlocked = await quoteCouponForCheckout({
      shopId: shopA.id,
      couponCode: perShop.code,
      basePriceInr: 200,
      now,
    });
    const perShopOther = await quoteCouponForCheckout({
      shopId: shopB.id,
      couponCode: perShop.code,
      basePriceInr: 200,
      now,
    });
    assert.equal(perShopBlocked.ok, false);
    assert.equal(perShopOther.ok, true);
    console.log("J PASS per-shop redemption limit reached");

    const tooBig = await quoteCouponForCheckout({
      shopId: shopA.id,
      couponCode: (
        await prisma.coupon.create({
          data: { code: `BIG${stamp}`, type: "FIXED", value: 500, isActive: true, ...window },
        })
      ).code,
      basePriceInr: 200,
      now,
    });
    assert.equal(tooBig.ok, false);
    console.log("K PASS fixed discount greater than price is rejected");

    const free = await quoteCouponForCheckout({
      shopId: shopA.id,
      couponCode: (
        await prisma.coupon.create({
          data: { code: `FREE${stamp}`, type: "PERCENT", value: 100, isActive: true, ...window },
        })
      ).code,
      basePriceInr: 200,
      now,
    });
    assert.equal(free.ok, false);
    console.log("L PASS discount that produces zero is rejected");

    assert.equal(percentRow.amountInr, 160);
    console.log("N PASS BillingPayment stores the discounted final amount");

    await prisma.billingPayment.update({
      where: { id: percentRow.id },
      data: { status: "PENDING", failureReason: null },
    });
    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 349 },
    });
    const confirmed = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_SUCCEEDED",
        provider: "payu",
        eventId: `ok-${stamp}`,
        payment: {
          provider: "payu",
          mode: "ONE_TIME",
          status: "SUCCESS",
          amountInr: 160,
          currency: "INR",
          providerOrderId: percentRow.providerOrderId,
          providerPaymentId: `pay-${stamp}`,
        },
      },
      now,
    );
    assert.equal(confirmed.result, "activated");
    const paid = await prisma.billingPayment.findUniqueOrThrow({ where: { id: percentRow.id } });
    assert.equal(paid.amountInr, 160);
    const redemptions = await prisma.couponRedemption.count({
      where: { billingPaymentId: percentRow.id },
    });
    assert.equal(redemptions, 1);
    console.log("O PASS provider amount matches BillingPayment.amountInr");
    console.log("P PASS existing payment stays valid after the Admin price changes");
    console.log("Q PASS successful payment creates one CouponRedemption");
    console.log("X PASS Admin price change does not change the stored payment amount");

    const again = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_SUCCEEDED",
        provider: "payu",
        eventId: `dup-${stamp}`,
        payment: {
          provider: "payu",
          mode: "ONE_TIME",
          status: "SUCCESS",
          amountInr: 160,
          currency: "INR",
          providerOrderId: percentRow.providerOrderId,
          providerPaymentId: `pay-${stamp}`,
        },
      },
      now,
    );
    assert.equal(again.result, "already_applied");
    assert.equal(
      await prisma.couponRedemption.count({ where: { billingPaymentId: percentRow.id } }),
      1,
    );
    console.log("R PASS repeated success does not create a duplicate redemption");

    const mismatch = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_SUCCEEDED",
        provider: "payu",
        eventId: `bad-${stamp}`,
        payment: {
          provider: "payu",
          mode: "ONE_TIME",
          status: "SUCCESS",
          amountInr: 349,
          currency: "INR",
          providerOrderId: fixedRow.providerOrderId,
          providerPaymentId: `bad-${stamp}`,
        },
      },
      now,
    );
    assert.equal(mismatch.result, "amount_mismatch");
    assert.equal(
      await prisma.couponRedemption.count({ where: { billingPaymentId: fixedRow.id } }),
      0,
    );
    console.log("O PASS a provider amount that differs from the ledger is rejected");

    await prisma.billingPayment.update({
      where: { id: plainRow.id },
      data: { status: "PENDING", failureReason: null },
    });
    const failed = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_FAILED",
        provider: "payu",
        eventId: `fail-${stamp}`,
        payment: {
          provider: "payu",
          mode: "ONE_TIME",
          status: "FAILED",
          amountInr: plainRow.amountInr,
          currency: "INR",
          providerOrderId: plainRow.providerOrderId,
          providerPaymentId: `fail-${stamp}`,
        },
      },
      now,
    );
    assert.equal(failed.result, "payment_failed");
    assert.equal(
      await prisma.couponRedemption.count({ where: { billingPaymentId: plainRow.id } }),
      0,
    );
    console.log("S PASS failed payment creates no redemption");
    console.log("U PASS no coupon creates no CouponRedemption");

    const abandoned = await prisma.billingPayment.create({
      data: {
        shopId: otherShop.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 160,
        currency: "INR",
        providerOrderId: `ABN-${stamp}`,
        metadataJson: JSON.stringify({ couponId: percent.id, couponCode: percent.code }),
      },
    });
    const cancelled = await applyNormalizedOneTimePayment(
      {
        type: "PAYMENT_CANCELLED",
        provider: "payu",
        eventId: `cancel-${stamp}`,
        payment: {
          provider: "payu",
          mode: "ONE_TIME",
          status: "CANCELLED",
          amountInr: 160,
          currency: "INR",
          providerOrderId: abandoned.providerOrderId,
          providerPaymentId: null,
        },
      },
      now,
    );
    assert.equal(cancelled.result, "ignored");
    assert.equal(
      await prisma.couponRedemption.count({ where: { billingPaymentId: abandoned.id } }),
      0,
    );
    console.log("T PASS cancelled or abandoned checkout creates no redemption");

    console.log("\nphase6j-coupon-checkout-smoke: ALL PASS");
  } finally {
    process.env.BILLING_PROVIDER = prevProvider;
    process.env.BILLING_MODE = prevMode;
    const shopIds = (
      await prisma.shop.findMany({
        where: { shopCode: { contains: stamp.slice(0, 6) } },
        select: { id: true },
      })
    ).map((row) => row.id);
    const scoped = [shopA.id, shopB.id, ...shopIds];
    await prisma.couponRedemption.deleteMany({ where: { shopId: { in: scoped } } });
    await prisma.coupon.deleteMany({ where: { code: { contains: stamp } } });
    await prisma.billingPayment.deleteMany({ where: { shopId: { in: scoped } } });
    await prisma.shop.deleteMany({ where: { id: { in: scoped } } });
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
    await prisma.user.delete({ where: { id: admin.id } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
