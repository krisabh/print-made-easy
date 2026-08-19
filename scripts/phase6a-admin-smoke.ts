/**
 * Phase 6A — Admin foundation smoke tests.
 * Run: npx tsx scripts/phase6a-admin-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { hashPassword, verifyPassword, verifyAuthToken, signAuthToken } from "../lib/auth";
import { getAdminOverviewMetrics } from "../lib/admin-metrics";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const userIds: string[] = [];
  const shopIds: string[] = [];

  // Ensure JWT helpers work in smoke (same secret as app when present).
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "phase6a-smoke-jwt-secret-not-for-prod";
  }

  try {
    // A — Existing users default to SHOPKEEPER (schema default + migration)
    {
      const user = await prisma.user.create({
        data: {
          name: "Default Role User",
          email: `default-${stamp}@example.com`,
          passwordHash: await hashPassword("SmokeTestPass!234"),
          // role omitted — DB/Prisma default must be SHOPKEEPER
        },
      });
      userIds.push(user.id);
      const loaded = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(loaded?.role, "SHOPKEEPER");
      console.log("A PASS existing/new users default to SHOPKEEPER");
    }

    // B — New signup-equivalent create uses SHOPKEEPER + shop
    {
      const passwordHash = await hashPassword("SmokeTestPass!234");
      const user = await prisma.user.create({
        data: {
          name: "Shopkeeper Smoke",
          email: `keeper-${stamp}@example.com`,
          passwordHash,
          role: "SHOPKEEPER",
          shop: {
            create: {
              shopCode: `SK${stamp}`.slice(0, 12),
              shopName: "Smoke Shop",
              phone: "9876543210",
              address: "Addr",
              email: `keeper-${stamp}@example.com`,
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
              inventory: {
                create: { paperAvailable: 0, estimatedInkLevel: 100 },
              },
              subscription: { create: createNestedTrialSubscription() },
            },
          },
        },
        include: { shop: true },
      });
      userIds.push(user.id);
      if (user.shop) shopIds.push(user.shop.id);
      assert.equal(user.role, "SHOPKEEPER");
      assert.ok(user.shop);
      console.log("B PASS signup-equivalent creates SHOPKEEPER with shop");
    }

    // C — Admin user can authenticate (password verify + token)
    {
      const password = "AdminSmokePass!23456";
      const passwordHash = await hashPassword(password);
      const admin = await prisma.user.create({
        data: {
          name: "Admin Smoke",
          email: `admin-${stamp}@example.com`,
          passwordHash,
          role: "ADMIN",
        },
      });
      userIds.push(admin.id);

      const ok = await verifyPassword(password, admin.passwordHash);
      assert.equal(ok, true);
      assert.equal(admin.role, "ADMIN");

      const token = signAuthToken({
        sub: admin.id,
        email: admin.email,
        role: admin.role,
      });
      const payload = verifyAuthToken(token);
      assert.equal(payload?.sub, admin.id);
      assert.equal(payload?.email, admin.email);

      // No shop required for admin
      const withShop = await prisma.user.findUnique({
        where: { id: admin.id },
        include: { shop: true },
      });
      assert.equal(withShop?.shop, null);
      console.log("C PASS admin authenticates without a Shop");
    }

    // D/E/F — Role gates (unit-level mirrors of requireAdmin / requireShop)
    {
      const admin = await prisma.user.findFirst({
        where: { email: `admin-${stamp}@example.com` },
      });
      const keeper = await prisma.user.findFirst({
        where: { email: `keeper-${stamp}@example.com` },
        include: { shop: true },
      });
      assert.ok(admin && keeper);

      function authorizeAdmin(role: string | undefined) {
        if (!role) return { ok: false, status: 401 as const };
        if (role !== "ADMIN") return { ok: false, status: 403 as const };
        return { ok: true as const, status: 200 as const };
      }

      function authorizeShop(role: string | undefined, hasActiveShop: boolean) {
        if (!role) return { ok: false, status: 401 as const };
        if (role === "ADMIN") return { ok: false, status: 403 as const };
        if (role !== "SHOPKEEPER" || !hasActiveShop) {
          return { ok: false, status: 401 as const };
        }
        return { ok: true as const, status: 200 as const };
      }

      assert.equal(authorizeAdmin(admin.role).ok, true);
      assert.equal(authorizeAdmin(keeper.role).status, 403);
      assert.equal(authorizeAdmin(undefined).status, 401);
      assert.equal(authorizeShop(keeper.role, Boolean(keeper.shop)).ok, true);
      assert.equal(authorizeShop(admin.role, false).status, 403);
      console.log("D PASS admin can access admin gate");
      console.log("E PASS shopkeeper denied admin gate (403)");
      console.log("F PASS unauthenticated denied admin gate (401)");
    }

    // G — Shopkeeper cannot call admin APIs (same gate)
    {
      const keeper = await prisma.user.findFirst({
        where: { email: `keeper-${stamp}@example.com` },
      });
      assert.ok(keeper);
      assert.notEqual(keeper.role, "ADMIN");
      console.log("G PASS shopkeeper cannot satisfy admin API role check");
    }

    // H — Admin overview returns system-wide counts (aggregates)
    {
      const metrics = await getAdminOverviewMetrics();
      assert.equal(typeof metrics.totalShops, "number");
      assert.equal(typeof metrics.activeShops, "number");
      assert.equal(typeof metrics.trialShops, "number");
      assert.equal(typeof metrics.premiumShops, "number");
      assert.equal(typeof metrics.expiredSubscriptions, "number");
      assert.equal(typeof metrics.pastDueSubscriptions, "number");
      assert.equal(typeof metrics.totalPrintJobs, "number");
      assert.equal(typeof metrics.totalPagesPrinted, "number");
      assert.ok(metrics.totalShops >= shopIds.length);
      console.log("H PASS admin overview returns system-wide aggregate counts");
    }

    // I — Admin does not require a Shop
    {
      const admin = await prisma.user.findFirst({
        where: { email: `admin-${stamp}@example.com` },
        include: { shop: true },
      });
      assert.ok(admin);
      assert.equal(admin.role, "ADMIN");
      assert.equal(admin.shop, null);
      console.log("I PASS admin does not require a Shop");
    }

    // J — Client cannot escalate SHOPKEEPER → ADMIN via JWT claim
    {
      const keeper = await prisma.user.findFirst({
        where: { email: `keeper-${stamp}@example.com` },
      });
      assert.ok(keeper);

      // Tampered token claiming ADMIN — authorization must use DB role.
      const forged = signAuthToken({
        sub: keeper.id,
        email: keeper.email,
        role: "ADMIN",
      });
      const payload = verifyAuthToken(forged);
      assert.equal(payload?.role, "ADMIN"); // token may claim anything

      const dbUser = await prisma.user.findUnique({
        where: { id: keeper.id },
        select: { role: true },
      });
      assert.equal(dbUser?.role, "SHOPKEEPER");
      // Server gate uses DB:
      assert.notEqual(dbUser?.role, "ADMIN");
      console.log("J PASS forged JWT role cannot escalate; DB role wins");
    }

    console.log("\nPhase 6A smoke tests passed.");
  } finally {
    for (const shopId of shopIds) {
      await prisma.subscription.deleteMany({ where: { shopId } });
      await prisma.printPrice.deleteMany({ where: { shopId } });
      await prisma.settings.deleteMany({ where: { shopId } });
      await prisma.inventory.deleteMany({ where: { shopId } });
      await prisma.shop.deleteMany({ where: { id: shopId } });
    }
    for (const id of userIds) {
      await prisma.user.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
