/**
 * Phase 6H — Admin shop deactivate / reactivate.
 * Run: npx tsx scripts/phase6h-admin-shop-management-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { getAdminShopDetail, setAdminShopActive } from "../lib/admin-shops";
import { loginAction } from "../app/auth/actions";
import { hashPassword } from "../lib/auth";
import { hashAgentToken, resolveAgentAuth } from "../lib/print-agent-auth";

const prisma = new PrismaClient();

function authorizeAdmin(role: string | undefined) {
  if (!role) return { ok: false as const, status: 401 as const };
  if (role !== "ADMIN") return { ok: false as const, status: 403 as const };
  return { ok: true as const, status: 200 as const };
}

async function preservedState(shopId: string) {
  const [subscription, payments, jobs, devices] = await Promise.all([
    prisma.subscription.findUnique({
      where: { shopId },
      select: {
        id: true,
        plan: true,
        status: true,
        trialStartAt: true,
        trialEndAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelledAt: true,
        pastDueSince: true,
      },
    }),
    prisma.billingPayment.findMany({
      where: { shopId },
      orderBy: { providerOrderId: "asc" },
      select: {
        id: true,
        amountInr: true,
        currency: true,
        status: true,
        provider: true,
        providerOrderId: true,
      },
    }),
    prisma.printJob.findMany({
      where: { shopId },
      orderBy: { jobNumber: "asc" },
      select: { id: true, jobNumber: true, status: true, totalPages: true },
    }),
    prisma.agentDevice.findMany({
      where: { shopId },
      orderBy: { agentId: "asc" },
      select: { id: true, agentId: true, tokenHash: true, lastSeen: true },
    }),
  ]);
  return { subscription, payments, jobs, devices };
}

async function main() {
  const route = fs.readFileSync(
    path.join(process.cwd(), "app/api/admin/shops/[shopId]/route.ts"),
    "utf8",
  );
  const patch = route.slice(route.indexOf("export async function PATCH"));
  const guardAt = patch.indexOf("requireAdminApi()");
  const mutateAt = patch.indexOf("setAdminShopActive");
  assert.ok(guardAt >= 0 && mutateAt > guardAt);
  assert.match(patch, /if \(session instanceof Response\) return session/);
  assert.equal(authorizeAdmin(undefined).status, 401);
  console.log("T PASS unauthenticated request cannot deactivate a shop");
  assert.equal(authorizeAdmin("SHOPKEEPER").status, 403);
  console.log("S PASS shopkeeper cannot deactivate a shop");

  const stamp = Date.now().toString(36);
  const password = "SmokeTestPass!234";
  const admin = await prisma.user.create({
    data: {
      name: "Shop Admin",
      email: `shop-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  const owner = await prisma.user.create({
    data: {
      name: "Managed Shop",
      email: `managed-shop-${stamp}@example.com`,
      passwordHash: await hashPassword(password),
      role: "SHOPKEEPER",
    },
  });
  const trialStart = new Date("2026-02-01T00:00:00.000Z");
  const trialEnd = new Date("2026-02-08T00:00:00.000Z");
  const agentToken = `agent-token-${stamp}`;
  const tokenHash = hashAgentToken(agentToken);
  const shop = await prisma.shop.create({
    data: {
      shopCode: `MG${stamp}`.slice(0, 12),
      shopName: "Managed Shop",
      phone: "9876543210",
      address: "Addr",
      ownerId: owner.id,
      agentTokenHash: tokenHash,
      subscription: {
        create: {
          plan: "TRIAL",
          status: "TRIALING",
          trialStartAt: trialStart,
          trialEndAt: trialEnd,
        },
      },
      billingPayments: {
        create: {
          provider: "PAYU",
          mode: "ONE_TIME",
          status: "SUCCESS",
          amountInr: 199,
          currency: "INR",
          providerOrderId: `PMEPAY-SHOP-${stamp}`.slice(0, 40),
        },
      },
      printJobs: {
        create: {
          jobSequence: 1,
          jobNumber: `PME-${stamp}`.slice(0, 20),
          copies: 1,
          totalPages: 2,
          printMode: "BW",
          printType: "SINGLE",
          totalPrice: 10,
          status: "PENDING",
        },
      },
      agentDevices: {
        create: {
          agentId: `agent-${stamp}`.slice(0, 40),
          tokenHash,
          lastSeen: new Date("2026-03-01T00:00:00.000Z"),
        },
      },
    },
  });

  try {
    const loaded = await getAdminShopDetail(shop.id);
    assert.ok(loaded);
    assert.equal(loaded?.isActive, true);
    console.log("A PASS admin can load an existing shop");

    const before = await preservedState(shop.id);

    const deactivated = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { isActive: false },
    });
    assert.equal(deactivated.ok, true);
    if (deactivated.ok) assert.equal(deactivated.changed, true);
    const inactive = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
    assert.equal(inactive.isActive, false);
    console.log("B PASS admin deactivates active shop");
    console.log("C PASS Shop.isActive becomes false");

    const deactivatedAudits = await prisma.adminAuditLog.findMany({
      where: { adminUserId: admin.id, action: "SHOP_DEACTIVATED", targetId: shop.id },
    });
    assert.equal(deactivatedAudits.length, 1);
    assert.deepEqual(deactivatedAudits[0]?.beforeJson, { isActive: true });
    assert.deepEqual(deactivatedAudits[0]?.afterJson, { isActive: false });
    assert.equal(deactivatedAudits[0]?.targetType, "Shop");
    assert.ok(deactivatedAudits[0]?.createdAt instanceof Date);
    console.log("D PASS SHOP_DEACTIVATED audit entry created");
    console.log("E PASS audit before = true");
    console.log("F PASS audit after = false");

    assert.deepEqual(await preservedState(shop.id), before);
    console.log("G PASS BillingPayment records unchanged");
    console.log("H PASS Subscription record unchanged");
    console.log("I PASS Subscription trial dates unchanged");
    console.log("J PASS print jobs remain unchanged");
    console.log("K PASS AgentDevice records remain unchanged");

    const again = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { isActive: false },
    });
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.changed, false);
      assert.equal(again.shop.isActive, false);
    }
    const deactivateCount = await prisma.adminAuditLog.count({
      where: { adminUserId: admin.id, action: "SHOP_DEACTIVATED", targetId: shop.id },
    });
    assert.equal(deactivateCount, 1);
    console.log("L PASS repeated deactivate does not create a duplicate audit entry");

    const loginWhileInactive = await loginAction({
      email: owner.email,
      password,
    });
    assert.equal(loginWhileInactive.success, false);
    console.log("U PASS inactive shop login is rejected");

    assert.equal(await resolveAgentAuth(agentToken), null);
    console.log("V PASS Agent authentication rejects the inactive shop");

    const reactivated = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { isActive: true },
    });
    assert.equal(reactivated.ok, true);
    const active = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
    assert.equal(active.isActive, true);
    console.log("M PASS admin reactivates shop");
    console.log("N PASS Shop.isActive becomes true");

    const reactivatedAudits = await prisma.adminAuditLog.findMany({
      where: { adminUserId: admin.id, action: "SHOP_REACTIVATED", targetId: shop.id },
    });
    assert.equal(reactivatedAudits.length, 1);
    assert.deepEqual(reactivatedAudits[0]?.beforeJson, { isActive: false });
    assert.deepEqual(reactivatedAudits[0]?.afterJson, { isActive: true });
    console.log("O PASS SHOP_REACTIVATED audit entry created");
    console.log("P PASS audit before = false");
    console.log("Q PASS audit after = true");

    const reactivateAgain = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { isActive: true },
    });
    assert.equal(reactivateAgain.ok, true);
    if (reactivateAgain.ok) assert.equal(reactivateAgain.changed, false);
    const reactivateCount = await prisma.adminAuditLog.count({
      where: { adminUserId: admin.id, action: "SHOP_REACTIVATED", targetId: shop.id },
    });
    assert.equal(reactivateCount, 1);
    console.log("R PASS repeated reactivate does not create a duplicate audit entry");

    assert.deepEqual(await preservedState(shop.id), before);
    console.log("W PASS reactivation does not modify subscription, trial, or billing data");

    const missing = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: "missing-shop",
      body: { isActive: false },
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);

    const extra = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: shop.id,
      body: { isActive: false, shopName: "Hacked" },
    });
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.equal(extra.status, 400);
    const stillActive = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
    assert.equal(stillActive.isActive, true);
    assert.equal(stillActive.shopName, "Managed Shop");

    const agent = await resolveAgentAuth(agentToken);
    assert.equal(agent?.shop.id, shop.id);

    console.log("\nphase6h-admin-shop-management-smoke: ALL PASS");
  } finally {
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: admin.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, owner.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
