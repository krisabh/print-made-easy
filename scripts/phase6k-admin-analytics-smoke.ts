/**
 * Phase 6K — Admin analytics list-price MRR, ledger revenue, and coupons.
 * Run: npx tsx scripts/phase6k-admin-analytics-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

import { ADMIN_SETTINGS_ID, updateAdminSettings } from "../lib/admin-settings";
import { getAdminAnalytics } from "../lib/admin-analytics";
import { getAdminSubscriptionSummary, computeTrialConversion } from "../lib/admin-subscriptions";
import { hashPassword } from "../lib/auth";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

function databaseHost() {
  const line = fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((row) => row.startsWith("DATABASE_URL="));
  if (!line) return "";
  const raw = line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
  return new URL(raw).hostname;
}

async function main() {
  const host = databaseHost();
  assert.ok(host === "127.0.0.1" || host === "localhost", `refusing non-local database host ${host}`);
  console.log("V PASS local database only");

  const analyticsSource = fs.readFileSync("lib/admin-analytics.ts", "utf8");
  const subscriptionSource = fs.readFileSync("lib/admin-subscriptions.ts", "utf8");
  assert.equal(analyticsSource.includes("PREMIUM_PLAN.amountInr"), false);
  assert.equal(subscriptionSource.includes("PREMIUM_PLAN.amountInr"), false);
  assert.match(analyticsSource, /getCurrentPremiumPriceInr/);
  assert.match(subscriptionSource, /getCurrentPremiumPriceInr/);
  console.log("S PASS Analytics MRR does not use PREMIUM_PLAN.amountInr");

  const stamp = Date.now().toString(36).toUpperCase();
  const now = new Date("2099-06-15T08:00:00.000Z");
  const inToday = new Date("2099-06-15T04:00:00.000Z");
  const inWeekOnly = new Date("2099-06-10T06:30:00.000Z");
  const outside = new Date("2099-01-01T04:00:00.000Z");
  const prior = await prisma.adminSetting.findUnique({ where: { id: ADMIN_SETTINGS_ID } });
  const admin = await prisma.user.create({
    data: {
      name: "Analytics Admin",
      email: `analytics-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  const shopIds: string[] = [];

  async function shop(suffix: string, input: { isActive?: boolean; createdAt?: Date }) {
    const created = await prisma.shop.create({
      data: {
        shopCode: `${suffix}${stamp}`.slice(0, 20),
        shopName: `Analytics ${suffix}`,
        phone: "9876543210",
        address: "Addr",
        isActive: input.isActive ?? true,
        createdAt: input.createdAt,
        subscription: { create: createNestedTrialSubscription(new Date("2098-01-01T00:00:00.000Z"), 7) },
      },
    });
    shopIds.push(created.id);
    return created;
  }

  try {
    if (prior) await prisma.adminSetting.delete({ where: { id: ADMIN_SETTINGS_ID } });
    await updateAdminSettings({ adminUserId: admin.id, patch: { premiumAmountInr: 250 } });

    const before = await getAdminAnalytics({ range: "today", now });
    const beforeWeek = await getAdminAnalytics({ range: "7d", now });
    assert.equal(before.payments.successfulCount, 0);
    assert.equal(beforeWeek.payments.successfulCount, 0);
    assert.equal(before.printing.totalJobs, 0);
    const premiumA = await shop("PA", {});
    const premiumB = await shop("PB", {});
    const trialing = await shop("TR", { createdAt: inToday });
    const deactivated = await shop("DX", { isActive: false });
    await prisma.subscription.update({
      where: { shopId: premiumA.id },
      data: {
        plan: "PREMIUM",
        status: "ACTIVE",
        trialStartAt: new Date("2019-12-01T00:00:00.000Z"),
        trialEndAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await prisma.subscription.update({
      where: { shopId: premiumB.id },
      data: { plan: "PREMIUM", status: "ACTIVE", trialStartAt: null, trialEndAt: null },
    });
    await prisma.subscription.update({
      where: { shopId: deactivated.id },
      data: {
        plan: "TRIAL",
        status: "TRIALING",
        trialStartAt: new Date("2019-12-01T00:00:00.000Z"),
        trialEndAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });

    const priced = await getAdminAnalytics({ range: "today", now });
    assert.equal(priced.business.listPriceInr, 250);
    assert.equal(priced.business.premiumShops, before.business.premiumShops + 2);
    assert.equal(priced.business.listPriceMrrInr, priced.business.premiumShops * 250);
    assert.equal(priced.business.deactivatedShops, before.business.deactivatedShops + 1);
    assert.equal(priced.business.activeShops, before.business.activeShops + 3);
    console.log("A PASS current Admin price is reflected in list-price MRR");
    console.log("C PASS active Premium count is used for list-price MRR");
    console.log("D PASS deactivated shop count is separate from subscription status");

    await updateAdminSettings({ adminUserId: admin.id, patch: { premiumAmountInr: 400 } });
    const repriced = await getAdminAnalytics({ range: "today", now });
    assert.equal(repriced.business.premiumShops, priced.business.premiumShops);
    assert.equal(repriced.business.listPriceInr, 400);
    assert.equal(repriced.business.listPriceMrrInr, repriced.business.premiumShops * 400);
    console.log("B PASS changing the Admin price changes list-price MRR");

    const summary = await getAdminSubscriptionSummary(now);
    assert.equal(summary.planPriceInr, 400);
    assert.equal(summary.estimatedMrrInr, summary.activePremium * 400);
    assert.equal(summary.activePremium, repriced.business.premiumShops);
    console.log("T PASS Subscriptions MRR uses the same current Admin price");

    const historical = await prisma.billingPayment.create({
      data: {
        shopId: premiumA.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 240,
        currency: "INR",
        providerOrderId: `AN-OLD-${stamp}`,
        paidAt: inToday,
        createdAt: inToday,
      },
    });
    const discounted = await prisma.billingPayment.create({
      data: {
        shopId: premiumA.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 180,
        currency: "INR",
        providerOrderId: `AN-DISC-${stamp}`,
        paidAt: inToday,
        createdAt: inToday,
      },
    });
    const weekPayment = await prisma.billingPayment.create({
      data: {
        shopId: premiumB.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 100,
        currency: "INR",
        providerOrderId: `AN-WEEK-${stamp}`,
        paidAt: inWeekOnly,
        createdAt: inWeekOnly,
      },
    });
    await prisma.billingPayment.create({
      data: {
        shopId: premiumB.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 50,
        currency: "INR",
        providerOrderId: `AN-OUT-${stamp}`,
        paidAt: outside,
        createdAt: outside,
      },
    });
    await prisma.billingPayment.create({
      data: {
        shopId: premiumA.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 400,
        currency: "INR",
        providerOrderId: `AN-PEND-${stamp}`,
        createdAt: inToday,
      },
    });
    await prisma.billingPayment.create({
      data: {
        shopId: premiumA.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "FAILED",
        amountInr: 400,
        currency: "INR",
        providerOrderId: `AN-FAIL-${stamp}`,
        createdAt: inToday,
      },
    });
    await prisma.billingPayment.create({
      data: {
        shopId: premiumB.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: 400,
        currency: "INR",
        providerOrderId: `AN-OLD-PEND-${stamp}`,
        createdAt: outside,
      },
    });

    const coupon = await prisma.coupon.create({
      data: {
        code: `AN${stamp}`.slice(0, 32),
        type: "FIXED",
        value: 20,
        validFrom: new Date("2099-01-01T00:00:00.000Z"),
        validUntil: new Date("2099-12-31T00:00:00.000Z"),
        isActive: true,
      },
    });
    await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        shopId: premiumA.id,
        billingPaymentId: discounted.id,
        redeemedAt: inToday,
      },
    });
    await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        shopId: premiumB.id,
        billingPaymentId: weekPayment.id,
        redeemedAt: inWeekOnly,
      },
    });

    const today = await getAdminAnalytics({ range: "today", now });
    assert.equal(today.payments.successfulCount, before.payments.successfulCount + 2);
    assert.equal(today.payments.collectedRevenueInr, before.payments.collectedRevenueInr + 420);
    assert.equal(today.payments.collectedRevenueInr, before.payments.collectedRevenueInr + historical.amountInr + discounted.amountInr);
    assert.equal(today.payments.pendingCount, before.payments.pendingCount + 1);
    assert.equal(today.payments.failedCount, before.payments.failedCount + 1);
    assert.equal(today.payments.averageSuccessfulPaymentInr, today.payments.collectedRevenueInr / today.payments.successfulCount);
    assert.equal(today.coupons.redemptionCount, before.coupons.redemptionCount + 1);
    assert.equal(today.coupons.successfulPaymentsUsingCoupons, before.coupons.successfulPaymentsUsingCoupons + 1);
    console.log("E PASS successful payment count");
    console.log("F PASS collected revenue sums BillingPayment.amountInr");
    console.log("G PASS a historical payment is counted at its stored amount");
    console.log("H PASS a coupon payment is counted at its stored final amount");
    console.log("I PASS pending payments counted");
    console.log("J PASS failed payments counted");
    console.log("K PASS average successful payment");
    console.log("L PASS coupon redemption count");
    console.log("M PASS successful payments using coupons");

    const week = await getAdminAnalytics({ range: "7d", now });
    assert.equal(week.payments.collectedRevenueInr, beforeWeek.payments.collectedRevenueInr + 520);
    assert.equal(week.payments.successfulCount, beforeWeek.payments.successfulCount + 3);
    assert.equal(week.coupons.redemptionCount, beforeWeek.coupons.redemptionCount + 2);
    assert.equal(week.coupons.successfulPaymentsUsingCoupons, beforeWeek.coupons.successfulPaymentsUsingCoupons + 2);
    assert.equal(today.payments.collectedRevenueInr, before.payments.collectedRevenueInr + 420);
    console.log("N PASS successful revenue is filtered by paidAt");
    console.log("O PASS coupon redemptions are filtered by redeemedAt");

    const empty = await getAdminAnalytics({
      range: "today",
      now: new Date("1900-01-15T12:00:00.000Z"),
    });
    assert.equal(empty.payments.successfulCount, 0);
    assert.equal(empty.payments.collectedRevenueInr, 0);
    assert.equal(empty.payments.pendingCount, 0);
    assert.equal(empty.payments.failedCount, 0);
    assert.equal(empty.payments.averageSuccessfulPaymentInr, 0);
    assert.equal(empty.coupons.redemptionCount, 0);
    assert.equal(empty.printing.totalJobs, 0);
    assert.equal(empty.business.premiumShops, today.business.premiumShops);
    assert.equal(empty.business.trialShops, today.business.trialShops);
    assert.equal(empty.business.deactivatedShops, today.business.deactivatedShops);
    console.log("P PASS an empty period returns zero payment totals");
    console.log("U PASS current-state counts stay current when the reporting period changes");

    await prisma.printJob.create({
      data: {
        shopId: trialing.id,
        jobSequence: 1,
        jobNumber: `AN-BW-${stamp}`,
        copies: 1,
        totalPages: 7,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: 35,
        status: "DELIVERED",
        createdAt: inToday,
      },
    });
    await prisma.printJob.create({
      data: {
        shopId: trialing.id,
        jobSequence: 2,
        jobNumber: `AN-CL-${stamp}`,
        copies: 1,
        totalPages: 3,
        printMode: "COLOR",
        printType: "SINGLE",
        totalPrice: 30,
        status: "CANCELLED",
        lastError: "paper jam",
        createdAt: inToday,
      },
    });
    await prisma.printJob.create({
      data: {
        shopId: trialing.id,
        jobSequence: 3,
        jobNumber: `AN-OUT-${stamp}`,
        copies: 1,
        totalPages: 99,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: 99,
        status: "DELIVERED",
        createdAt: outside,
      },
    });
    const printed = await getAdminAnalytics({ range: "today", now });
    assert.equal(printed.printing.totalJobs, before.printing.totalJobs + 2);
    assert.equal(printed.printing.submittedPages, before.printing.submittedPages + 10);
    assert.equal(printed.printing.completedJobs, before.printing.completedJobs + 1);
    assert.equal(printed.printing.cancelledJobs, before.printing.cancelledJobs + 1);
    assert.equal(printed.printing.jobsWithRecordedError, before.printing.jobsWithRecordedError + 1);
    assert.equal(printed.printing.modes.find((row) => row.mode === "BW")?.submittedPages, (before.printing.modes.find((row) => row.mode === "BW")?.submittedPages || 0) + 7);
    assert.equal(printed.printing.modes.find((row) => row.mode === "COLOR")?.submittedPages, (before.printing.modes.find((row) => row.mode === "COLOR")?.submittedPages || 0) + 3);
    assert.equal(printed.shopGrowth.reduce((sum, row) => sum + row.shops, 0), before.shopGrowth.reduce((sum, row) => sum + row.shops, 0) + 1);
    console.log("Q PASS print metrics still use submitted pages in the reporting period");

    const conversion = await computeTrialConversion(now);
    assert.equal(printed.subscriptions.trialConversion.isApproximate, true);
    assert.equal(printed.subscriptions.trialConversion.endedTrialCount, conversion.endedTrialCount);
    assert.equal(printed.subscriptions.trialConversion.convertedCount, conversion.convertedCount);
    assert.match(
      printed.subscriptions.trialConversion.note,
      /not a period-specific conversion funnel/,
    );
    const weekState = await getAdminAnalytics({ range: "7d", now });
    assert.equal(weekState.subscriptions.trialConversion.endedTrialCount, printed.subscriptions.trialConversion.endedTrialCount);
    assert.equal(weekState.business.premiumShops, printed.business.premiumShops);
    console.log("R PASS trial conversion stays the current approximate classification");

    console.log("\nphase6k-admin-analytics-smoke: ALL PASS");
  } finally {
    if (shopIds.length) {
      await prisma.couponRedemption.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.billingPayment.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.printJob.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.coupon.deleteMany({ where: { code: { contains: stamp } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
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
