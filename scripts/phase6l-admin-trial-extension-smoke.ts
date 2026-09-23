/**
 * Phase 6L — per-shop trial extension and shop-status UI reachability.
 * Run: npx tsx scripts/phase6l-admin-trial-extension-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import {
  extendAdminShopTrial,
  parseAdminTrialExtensionDays,
  setAdminShopActive,
} from "../lib/admin-shops";
import { hashPassword } from "../lib/auth";
import { getSubscriptionAccess } from "../lib/subscription";

const prisma = new PrismaClient();
const DAY_MS = 24 * 60 * 60 * 1000;

function preservedSubscription(shopId: string) {
  return prisma.subscription.findUnique({
    where: { shopId },
    select: {
      plan: true,
      status: true,
      trialStartAt: true,
      trialEndAt: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancelledAt: true,
      pastDueSince: true,
      provider: true,
      providerCustomerId: true,
      providerSubscriptionId: true,
      providerPlanId: true,
    },
  });
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
  assert.match(pricing, /const signupTrialDays =\s*!subscription/);
  assert.match(pricing, /\{subscription \? null : \(/);
  assert.doesNotMatch(pricing, /trialDays = 7/);
  console.log("A PASS logged-in pricing does not render a second trial duration");

  const table = fs.readFileSync(
    path.join(process.cwd(), "components/admin/admin-shops-table.tsx"),
    "utf8",
  );
  const detail = fs.readFileSync(
    path.join(process.cwd(), "components/admin/admin-shop-detail.tsx"),
    "utf8",
  );
  const shopsPage = fs.readFileSync(
    path.join(process.cwd(), "app/admin/shops/page.tsx"),
    "utf8",
  );
  const statusControl = fs.readFileSync(
    path.join(process.cwd(), "components/admin/admin-shop-status-control.tsx"),
    "utf8",
  );
  assert.match(table, /AdminShopStatusControl/);
  assert.match(table, /layout="compact"/);
  assert.match(statusControl, /Deactivate Shop/);
  assert.match(statusControl, /Reactivate Shop/);
  assert.match(detail, /AdminShopStatusControl/);
  assert.doesNotMatch(shopsPage, /Read-only directory/);
  console.log("B PASS Deactivate Shop is rendered on the shops list and shop detail");

  const route = fs.readFileSync(
    path.join(process.cwd(), "app/api/admin/shops/[shopId]/trial/route.ts"),
    "utf8",
  );
  const patch = route.slice(route.indexOf("export async function PATCH"));
  const guardAt = patch.indexOf("requireAdminApi()");
  const mutateAt = patch.indexOf("extendAdminShopTrial");
  assert.ok(guardAt >= 0 && mutateAt > guardAt);
  assert.match(patch, /if \(session instanceof Response\) return session/);
  console.log("C PASS trial extension route requires an admin before the database write");

  const invalidBodies = [
    { days: 0 },
    { days: -3 },
    { days: 1.5 },
    { days: "5" },
    { days: Number.NaN },
    { days: Number.POSITIVE_INFINITY },
    { days: 2, isActive: false },
    { isActive: false },
    {},
  ];
  for (const body of invalidBodies) {
    const parsed = parseAdminTrialExtensionDays(body);
    assert.equal(parsed.ok, false);
  }
  assert.equal(parseAdminTrialExtensionDays({ days: 5 }).ok, true);
  assert.equal(parseAdminTrialExtensionDays({ days: 365 }).ok, true);
  assert.equal(parseAdminTrialExtensionDays({ days: 366 }).ok, false);
  console.log("D PASS invalid extension values are rejected");

  const stamp = Date.now().toString(36);
  const now = new Date("2026-09-23T12:00:00.000Z");
  const admin = await prisma.user.create({
    data: {
      name: "Trial Admin",
      email: `trial-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  const owner = await prisma.user.create({
    data: {
      name: "Trial Shop",
      email: `trial-shop-${stamp}@example.com`,
      passwordHash: await hashPassword("ShopSmokePass!23456"),
      role: "SHOPKEEPER",
    },
  });
  const trialStart = new Date("2026-09-16T12:00:00.000Z");
  const activeEnd = new Date(now.getTime() + 7 * DAY_MS);
  const extraShopIds: string[] = [];
  const extraUserIds: string[] = [];
  const shop = await prisma.shop.create({
    data: {
      shopCode: `TR${stamp}`.slice(0, 12),
      shopName: "Trial Shop",
      phone: "9876543210",
      address: "Addr",
      ownerId: owner.id,
      subscription: {
        create: {
          plan: "TRIAL",
          status: "TRIALING",
          trialStartAt: trialStart,
          trialEndAt: activeEnd,
          provider: "CASHFREE",
          providerSubscriptionId: `keep-${stamp}`,
          currentPeriodEnd: new Date("2026-10-23T12:00:00.000Z"),
          cancelAtPeriodEnd: false,
        },
      },
    },
  });

  const settingsBefore = await prisma.adminSetting.findUnique({
    where: { id: "platform" },
  });

  try {
    const auditsBefore = await prisma.adminAuditLog.count({
      where: { adminUserId: admin.id, action: "SHOP_TRIAL_EXTENDED" },
    });
    const rejected = await extendAdminShopTrial({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { days: 0 },
      now,
    });
    assert.equal(rejected.ok, false);
    const auditsAfterReject = await prisma.adminAuditLog.count({
      where: { adminUserId: admin.id, action: "SHOP_TRIAL_EXTENDED" },
    });
    assert.equal(auditsAfterReject, auditsBefore);
    console.log("E PASS a failed extension does not write an audit entry");

    const active = await extendAdminShopTrial({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { days: 5 },
      now,
    });
    assert.equal(active.ok, true);
    const afterActive = await preservedSubscription(shop.id);
    assert.ok(afterActive);
    assert.equal(afterActive?.status, "TRIALING");
    assert.equal(afterActive?.plan, "TRIAL");
    assert.equal(afterActive?.trialStartAt?.toISOString(), trialStart.toISOString());
    assert.equal(
      afterActive?.trialEndAt?.toISOString(),
      new Date(activeEnd.getTime() + 5 * DAY_MS).toISOString(),
    );
    assert.equal(afterActive?.providerSubscriptionId, `keep-${stamp}`);
    assert.equal(
      afterActive?.currentPeriodEnd?.toISOString(),
      "2026-10-23T12:00:00.000Z",
    );
    assert.equal(afterActive?.cancelAtPeriodEnd, false);
    const activeAccess = getSubscriptionAccess(
      {
        ...(await prisma.subscription.findUniqueOrThrow({ where: { shopId: shop.id } })),
      },
      now,
    );
    assert.equal(activeAccess.hasAccess, true);
    assert.equal(activeAccess.reason, "trialing");
    console.log("F PASS an active trial is extended from the existing end date");

    const activeAudit = await prisma.adminAuditLog.findFirst({
      where: { adminUserId: admin.id, action: "SHOP_TRIAL_EXTENDED", targetId: shop.id },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(activeAudit);
    assert.equal(activeAudit?.targetType, "Shop");
    const beforeJson = activeAudit?.beforeJson as { trialStartAt: string; trialEndAt: string };
    const afterJson = activeAudit?.afterJson as { trialEndAt: string; status: string };
    assert.equal(beforeJson.trialStartAt, trialStart.toISOString());
    assert.equal(beforeJson.trialEndAt, activeEnd.toISOString());
    assert.equal(afterJson.trialEndAt, new Date(activeEnd.getTime() + 5 * DAY_MS).toISOString());
    assert.equal(afterJson.status, "TRIALING");
    console.log("G PASS SHOP_TRIAL_EXTENDED audit records the trial before and after");

    const expiredEnd = new Date(now.getTime() - 2 * DAY_MS);
    await prisma.subscription.update({
      where: { shopId: shop.id },
      data: { status: "TRIALING", trialEndAt: expiredEnd, trialStartAt: trialStart },
    });
    const expired = await extendAdminShopTrial({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { days: 4 },
      now,
    });
    assert.equal(expired.ok, true);
    const afterExpired = await preservedSubscription(shop.id);
    assert.equal(afterExpired?.status, "TRIALING");
    assert.equal(afterExpired?.plan, "TRIAL");
    assert.equal(afterExpired?.trialStartAt?.toISOString(), trialStart.toISOString());
    assert.equal(
      afterExpired?.trialEndAt?.toISOString(),
      new Date(now.getTime() + 4 * DAY_MS).toISOString(),
    );
    assert.equal(afterExpired?.provider, "CASHFREE");
    assert.equal(afterExpired?.providerSubscriptionId, `keep-${stamp}`);
    const expiredAccess = getSubscriptionAccess(
      await prisma.subscription.findUniqueOrThrow({ where: { shopId: shop.id } }),
      now,
    );
    assert.equal(expiredAccess.hasAccess, true);
    assert.equal(expiredAccess.reason, "trialing");
    console.log("H PASS an expired trial restarts from now and restores trial access");

    await prisma.subscription.update({
      where: { shopId: shop.id },
      data: {
        plan: "TRIAL",
        status: "EXPIRED",
        trialStartAt: trialStart,
        trialEndAt: expiredEnd,
      },
    });
    const fromExpiredStatus = await extendAdminShopTrial({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { days: 3 },
      now,
    });
    assert.equal(fromExpiredStatus.ok, true);
    const restored = await preservedSubscription(shop.id);
    assert.equal(restored?.status, "TRIALING");
    assert.equal(restored?.plan, "TRIAL");
    assert.equal(restored?.trialStartAt?.toISOString(), trialStart.toISOString());
    assert.equal(
      restored?.trialEndAt?.toISOString(),
      new Date(now.getTime() + 3 * DAY_MS).toISOString(),
    );
    assert.equal(restored?.currentPeriodEnd?.toISOString(), "2026-10-23T12:00:00.000Z");
    console.log("I PASS an EXPIRED trial status becomes TRIALING without rewriting other fields");

    await prisma.subscription.update({
      where: { shopId: shop.id },
      data: {
        plan: "PREMIUM",
        status: "ACTIVE",
        trialStartAt: trialStart,
        trialEndAt: activeEnd,
      },
    });
    const paidBefore = await preservedSubscription(shop.id);
    const paid = await extendAdminShopTrial({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { days: 2 },
      now,
    });
    assert.equal(paid.ok, false);
    assert.deepEqual(await preservedSubscription(shop.id), paidBefore);
    console.log("J PASS a paid subscription is not converted into a trial");

    const bareOwner = await prisma.user.create({
      data: {
        name: "No Sub",
        email: `nosub-${stamp}@example.com`,
        passwordHash: await hashPassword("ShopSmokePass!23456"),
        role: "SHOPKEEPER",
      },
    });
    extraUserIds.push(bareOwner.id);
    const bare = await prisma.shop.create({
      data: {
        shopCode: `NS${stamp}`.slice(0, 12),
        shopName: "No Subscription Shop",
        phone: "9876543210",
        address: "Addr",
        ownerId: bareOwner.id,
      },
    });
    extraShopIds.push(bare.id);
    const missingSub = await extendAdminShopTrial({
      adminUserId: admin.id,
      shopId: bare.id,
      body: { days: 2 },
      now,
    });
    assert.equal(missingSub.ok, false);
    assert.equal(await prisma.subscription.count({ where: { shopId: bare.id } }), 0);
    console.log("K PASS a shop without a subscription is not given a new one");

    await prisma.subscription.update({
      where: { shopId: shop.id },
      data: { plan: "TRIAL", status: "TRIALING", trialStartAt: trialStart, trialEndAt: activeEnd },
    });
    const beforeDeactivate = await preservedSubscription(shop.id);
    const deactivated = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { isActive: false },
    });
    assert.equal(deactivated.ok, true);
    const reactivated = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { isActive: true },
    });
    assert.equal(reactivated.ok, true);
    assert.deepEqual(await preservedSubscription(shop.id), beforeDeactivate);
    const flag = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
    assert.equal(flag.isActive, true);
    console.log("L PASS deactivate and reactivate still leave the subscription unchanged");

    const settingsAfter = await prisma.adminSetting.findUnique({
      where: { id: "platform" },
    });
    assert.equal(settingsAfter?.trialDays ?? null, settingsBefore?.trialDays ?? null);
    console.log("M PASS the global Admin trial setting is unchanged");

    console.log("\nphase6l-admin-trial-extension-smoke: ALL PASS");
  } finally {
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: admin.id } });
    await prisma.shop.deleteMany({
      where: { id: { in: [shop.id, ...extraShopIds] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, owner.id, ...extraUserIds] } },
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
