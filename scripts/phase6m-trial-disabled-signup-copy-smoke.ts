/**
 * Phase 6M — trial-disabled signup must not look like an expired subscription.
 * Run: npx tsx scripts/phase6m-trial-disabled-signup-copy-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, type Subscription } from "@prisma/client";

import { hashPassword } from "../lib/auth";
import { getCurrentPremiumPriceInr, updateAdminSettings } from "../lib/admin-settings";
import { ADMIN_SETTINGS_ID } from "../lib/admin-settings";
import {
  createNestedSubscriptionForNewShop,
  createNestedSubscriptionWithoutTrial,
  toPublicSubscriptionView,
} from "../lib/subscription";

const prisma = new PrismaClient();

function asSubscription(
  partial: Partial<Subscription> & Pick<Subscription, "plan" | "status">,
): Subscription {
  const now = new Date("2026-09-23T12:00:00.000Z");
  return {
    id: "sub",
    shopId: "shop",
    trialStartAt: null,
    trialEndAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    pastDueSince: null,
    provider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerPlanId: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

async function main() {
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

  const pricing = fs.readFileSync(
    path.join(process.cwd(), "components/dashboard/saas-pricing-plans.tsx"),
    "utf8",
  );
  assert.match(pricing, /trialActive \? \([\s\S]*Free Trial/);
  assert.match(pricing, /Your trial is active/);
  assert.match(
    pricing,
    /subscription\?\.label === "No active subscription"[\s\S]*Get started/,
  );
  assert.match(pricing, /After your free trial/);
  const checkout = fs.readFileSync(
    path.join(process.cwd(), "lib/billing/service.ts"),
    "utf8",
  );
  assert.match(checkout, /getCurrentPremiumPriceInr\(\)/);
  console.log("A PASS active-trial card still uses Free Trial, not the span title");

  const fresh = asSubscription(createNestedSubscriptionWithoutTrial());
  const freshView = toPublicSubscriptionView(fresh)!;
  assert.equal(freshView.label, "No active subscription");
  assert.equal(freshView.detail, "Choose PrintYantra Premium to get started.");
  assert.equal(freshView.hasAccess, false);
  assert.equal(freshView.canSubscribe, true);
  assert.doesNotMatch(freshView.label, /Subscription expired/i);
  console.log("B PASS new shop with trial disabled is not shown as subscription expired");

  const now = new Date("2026-09-23T12:00:00.000Z");
  const expiredTrial = toPublicSubscriptionView(
    asSubscription({
      plan: "TRIAL",
      status: "TRIALING",
      trialStartAt: new Date("2026-09-01T12:00:00.000Z"),
      trialEndAt: new Date("2026-09-08T12:00:00.000Z"),
    }),
    now,
  )!;
  assert.equal(expiredTrial.label, "Your free trial has ended");
  assert.equal(expiredTrial.detail, "Subscribe to continue using PrintYantra.");
  console.log("C PASS a finished trial window keeps the existing trial-ended copy");

  const expiredPaid = toPublicSubscriptionView(
    asSubscription({
      plan: "PREMIUM",
      status: "EXPIRED",
      trialStartAt: new Date("2026-08-01T12:00:00.000Z"),
      trialEndAt: new Date("2026-08-08T12:00:00.000Z"),
      currentPeriodStart: new Date("2026-08-08T12:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-08T12:00:00.000Z"),
      provider: "CASHFREE",
      providerSubscriptionId: "pay-1",
    }),
    now,
  )!;
  assert.equal(expiredPaid.label, "Subscription expired");
  assert.equal(expiredPaid.detail, "Subscribe again to restore access.");
  console.log("D PASS a finished paid Premium subscription stays expired");

  const activeTrial = toPublicSubscriptionView(
    asSubscription({
      plan: "TRIAL",
      status: "TRIALING",
      trialStartAt: new Date("2026-09-16T12:00:00.000Z"),
      trialEndAt: new Date("2026-09-25T12:00:00.000Z"),
    }),
    now,
  )!;
  assert.equal(activeTrial.hasAccess, true);
  assert.equal(activeTrial.detail, "2 days remaining");
  console.log("E PASS an active trial still reports remaining days");

  const activePremium = toPublicSubscriptionView(
    asSubscription({
      plan: "PREMIUM",
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: new Date("2026-10-23T12:00:00.000Z"),
    }),
    now,
  )!;
  assert.equal(activePremium.label, "Premium");
  assert.equal(activePremium.hasAccess, true);
  console.log("F PASS an active Premium subscription is unchanged");

  const prior = await prisma.adminSetting.findUnique({
    where: { id: ADMIN_SETTINGS_ID },
  });
  const stamp = Date.now().toString(36);
  const admin = await prisma.user.create({
    data: {
      name: "Copy Admin",
      email: `copy-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });

  try {
    await updateAdminSettings({
      adminUserId: admin.id,
      patch: { trialEnabled: false, trialDays: 0 },
    });
    const created = await createNestedSubscriptionForNewShop();
    assert.equal(created.status, "EXPIRED");
    assert.equal(created.trialStartAt, null);
    assert.equal(created.trialEndAt, null);
    const signedUp = toPublicSubscriptionView(asSubscription(created))!;
    assert.equal(signedUp.label, "No active subscription");
    const price = await getCurrentPremiumPriceInr();
    assert.equal(typeof price, "number");
    assert.ok(price >= 1);
    console.log("G PASS signup with trial disabled has no trial and checkout still reads the Admin price");
    console.log("\nphase6m-trial-disabled-signup-copy-smoke: ALL PASS");
  } finally {
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
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: admin.id } });
    await prisma.user.delete({ where: { id: admin.id } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
