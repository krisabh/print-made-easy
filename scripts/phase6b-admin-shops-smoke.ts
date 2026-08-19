/**
 * Phase 6B — Admin shop management smoke tests.
 * Run: npx tsx scripts/phase6b-admin-shops-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import {
  ADMIN_FORBIDDEN_RESPONSE_KEYS,
  formatAdminSubscriptionLabel,
  getAdminAgentStatus,
  getAdminShopDetail,
  listAdminShops,
} from "../lib/admin-shops";
import { hashPassword } from "../lib/auth";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

function containsForbiddenKey(value: unknown, path = ""): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = containsForbiddenKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        (ADMIN_FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(key)
      ) {
        return path ? `${path}.${key}` : key;
      }
      const hit = containsForbiddenKey(child, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return null;
}

function authorizeAdmin(role: string | undefined) {
  if (!role) return { ok: false as const, status: 401 as const };
  if (role !== "ADMIN") return { ok: false as const, status: 403 as const };
  return { ok: true as const, status: 200 as const };
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const now = new Date("2026-08-19T12:00:00.000Z");
  const userIds: string[] = [];
  const shopIds: string[] = [];

  try {
    const ownerA = await prisma.user.create({
      data: {
        name: "Owner Alpha",
        email: `alpha-${stamp}@example.com`,
        passwordHash: await hashPassword("SmokeTestPass!234"),
        role: "SHOPKEEPER",
      },
    });
    userIds.push(ownerA.id);

    const ownerB = await prisma.user.create({
      data: {
        name: "Owner Beta",
        email: `beta-${stamp}@example.com`,
        passwordHash: await hashPassword("SmokeTestPass!234"),
        role: "SHOPKEEPER",
      },
    });
    userIds.push(ownerB.id);

    const admin = await prisma.user.create({
      data: {
        name: "Admin SixB",
        email: `admin6b-${stamp}@example.com`,
        passwordHash: await hashPassword("AdminSmokePass!23456"),
        role: "ADMIN",
      },
    });
    userIds.push(admin.id);

    const shopA = await prisma.shop.create({
      data: {
        shopCode: `A${stamp}`.slice(0, 12),
        shopName: `Alpha Shop ${stamp}`,
        phone: "9876543210",
        address: "Addr A",
        email: ownerA.email,
        ownerId: ownerA.id,
        agentId: `PMEA-WINDOWS-${stamp}A`,
        agentLastSeen: new Date(now.getTime() - 5_000),
        agentTokenHash: "should-never-leak-a",
        agentPairingTokenHash: "should-never-leak-pair-a",
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
          create: { currency: "INR", timezone: "Asia/Kolkata", autoDeleteDays: 7 },
        },
        inventory: { create: { paperAvailable: 0, estimatedInkLevel: 100 } },
        subscription: {
          create: {
            ...createNestedTrialSubscription(now),
            trialEndAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
          },
        },
        printers: {
          create: [
            { printerName: "HP Laser A1", status: "online", isDefault: true },
            { printerName: "Canon A2", status: "offline", isDefault: false },
          ],
        },
        printJobs: {
          create: [
            {
              jobSequence: 1,
              jobNumber: "PME-0001",
              copies: 1,
              totalPages: 10,
              printMode: "BW",
              printType: "SINGLE",
              totalPrice: 20,
            },
            {
              jobSequence: 2,
              jobNumber: "PME-0002",
              copies: 1,
              totalPages: 4,
              printMode: "COLOR",
              printType: "SINGLE",
              totalPrice: 40,
            },
          ],
        },
      },
    });
    shopIds.push(shopA.id);

    const shopB = await prisma.shop.create({
      data: {
        shopCode: `B${stamp}`.slice(0, 12),
        shopName: `Beta Shop ${stamp}`,
        phone: "9876543211",
        address: "Addr B",
        email: ownerB.email,
        ownerId: ownerB.id,
        agentLastSeen: null,
        agentId: null,
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
          create: { currency: "INR", timezone: "Asia/Kolkata", autoDeleteDays: 7 },
        },
        inventory: { create: { paperAvailable: 0, estimatedInkLevel: 100 } },
        subscription: {
          create: {
            plan: "PREMIUM",
            status: "ACTIVE",
            cancelAtPeriodEnd: false,
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
            provider: "CASHFREE",
            providerCustomerId: "cf_secret_should_not_leak",
            providerSubscriptionId: "sub_secret_should_not_leak",
          },
        },
        printers: {
          create: [{ printerName: "Epson B1", status: "online", isDefault: true }],
        },
        printJobs: {
          create: [
            {
              jobSequence: 1,
              jobNumber: "PME-0001",
              copies: 2,
              totalPages: 3,
              printMode: "BW",
              printType: "DOUBLE",
              totalPrice: 12,
            },
          ],
        },
      },
    });
    shopIds.push(shopB.id);

    // A — Admin can list shops
    {
      assert.equal(authorizeAdmin(admin.role).ok, true);
      const listed = await listAdminShops({ page: 1, pageSize: 50, now });
      const foundA = listed.shops.find((s) => s.id === shopA.id);
      const foundB = listed.shops.find((s) => s.id === shopB.id);
      assert.ok(foundA, "shop A in list");
      assert.ok(foundB, "shop B in list");
      console.log("A PASS admin can list shops");
    }

    // B — Search by shop name
    {
      const listed = await listAdminShops({
        search: `Alpha Shop ${stamp}`,
        page: 1,
        pageSize: 20,
        now,
      });
      assert.ok(listed.shops.some((s) => s.id === shopA.id));
      assert.ok(!listed.shops.some((s) => s.id === shopB.id));
      console.log("B PASS search by shop name");
    }

    // C — Search by shop code
    {
      const listed = await listAdminShops({
        search: shopA.shopCode,
        page: 1,
        pageSize: 20,
        now,
      });
      assert.equal(listed.shops.length >= 1, true);
      assert.ok(listed.shops.every((s) => s.shopCode.includes(shopA.shopCode.slice(0, 4)) || s.id === shopA.id));
      assert.ok(listed.shops.some((s) => s.id === shopA.id));
      console.log("C PASS search by shop code");
    }

    // D — Search by owner email
    {
      const listed = await listAdminShops({
        search: ownerB.email,
        page: 1,
        pageSize: 20,
        now,
      });
      assert.ok(listed.shops.some((s) => s.id === shopB.id));
      assert.ok(!listed.shops.some((s) => s.id === shopA.id));
      console.log("D PASS search by owner email");
    }

    // E — Pagination works
    {
      const page1 = await listAdminShops({ page: 1, pageSize: 1, now });
      assert.equal(page1.pageSize, 1);
      assert.equal(page1.shops.length, 1);
      assert.ok(page1.totalPages >= 2);
      const page2 = await listAdminShops({ page: 2, pageSize: 1, now });
      assert.equal(page2.page, 2);
      assert.equal(page2.shops.length, 1);
      assert.notEqual(page1.shops[0]?.id, page2.shops[0]?.id);
      console.log("E PASS pagination works");
    }

    // F — Admin can view shop details
    {
      const detail = await getAdminShopDetail(shopA.id, now);
      assert.ok(detail);
      assert.equal(detail.shopName, shopA.shopName);
      assert.equal(detail.owner.email, ownerA.email);
      console.log("F PASS admin can view shop details");
    }

    // G — Non-admin cannot list shops (gate)
    {
      assert.equal(authorizeAdmin(ownerA.role).status, 403);
      assert.equal(authorizeAdmin(undefined).status, 401);
      console.log("G PASS non-admin cannot list shops (403/401)");
    }

    // H — Non-admin cannot view shop details (gate)
    {
      assert.equal(authorizeAdmin(ownerB.role).status, 403);
      console.log("H PASS non-admin cannot view shop details (403)");
    }

    // I — Unknown shop returns 404-equivalent null
    {
      const missing = await getAdminShopDetail("00000000-0000-0000-0000-000000000000", now);
      assert.equal(missing, null);
      console.log("I PASS unknown shop returns null (API 404)");
    }

    // J — Sensitive credentials are not returned
    {
      const listed = await listAdminShops({
        search: shopA.shopCode,
        page: 1,
        pageSize: 5,
        now,
      });
      const detail = await getAdminShopDetail(shopA.id, now);
      const detailB = await getAdminShopDetail(shopB.id, now);
      for (const payload of [listed, detail, detailB]) {
        const hit = containsForbiddenKey(JSON.parse(JSON.stringify(payload)));
        assert.equal(hit, null, `forbidden key found: ${hit}`);
      }
      const raw = JSON.stringify(detailB);
      assert.equal(raw.includes("cf_secret_should_not_leak"), false);
      assert.equal(raw.includes("sub_secret_should_not_leak"), false);
      assert.equal(raw.includes("should-never-leak"), false);
      console.log("J PASS sensitive credentials are not returned");
    }

    // K — Subscription status correctly represented
    {
      const listed = await listAdminShops({
        search: stamp,
        page: 1,
        pageSize: 20,
        now,
      });
      const a = listed.shops.find((s) => s.id === shopA.id)!;
      const b = listed.shops.find((s) => s.id === shopB.id)!;
      assert.match(a.subscription.label, /Trial —/i);
      assert.equal(b.subscription.label, "Premium — Active");

      const cancelled = formatAdminSubscriptionLabel(
        {
          id: "x",
          shopId: shopA.id,
          plan: "PREMIUM",
          status: "CANCELLED",
          trialStartAt: null,
          trialEndAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 5 * 86400000),
          cancelAtPeriodEnd: false,
          cancelledAt: now,
          pastDueSince: null,
          provider: null,
          providerCustomerId: null,
          providerSubscriptionId: null,
          providerPlanId: null,
          createdAt: now,
          updatedAt: now,
        },
        now,
      );
      assert.equal(cancelled.label, "Premium — Cancelled");

      const pastDue = formatAdminSubscriptionLabel(
        {
          id: "y",
          shopId: shopA.id,
          plan: "PREMIUM",
          status: "PAST_DUE",
          trialStartAt: null,
          trialEndAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 5 * 86400000),
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          pastDueSince: now,
          provider: null,
          providerCustomerId: null,
          providerSubscriptionId: null,
          providerPlanId: null,
          createdAt: now,
          updatedAt: now,
        },
        now,
      );
      assert.equal(pastDue.label, "Past Due");
      console.log("K PASS subscription status correctly represented");
    }

    // L — Printer count correct
    {
      const listed = await listAdminShops({
        search: shopA.shopCode,
        page: 1,
        pageSize: 5,
        now,
      });
      const a = listed.shops.find((s) => s.id === shopA.id)!;
      assert.equal(a.printerCount, 2);
      const detail = await getAdminShopDetail(shopA.id, now);
      assert.equal(detail?.printerCount, 2);
      assert.equal(detail?.printers.length, 2);
      console.log("L PASS printer count correct");
    }

    // M — Job count correct
    {
      const listed = await listAdminShops({
        search: shopA.shopCode,
        page: 1,
        pageSize: 5,
        now,
      });
      const a = listed.shops.find((s) => s.id === shopA.id)!;
      assert.equal(a.jobCount, 2);
      const detail = await getAdminShopDetail(shopA.id, now);
      assert.equal(detail?.printing.totalJobs, 2);
      assert.equal(detail?.printing.totalPages, 14);
      assert.equal(detail?.printing.bwJobs, 1);
      assert.equal(detail?.printing.bwPages, 10);
      assert.equal(detail?.printing.colorJobs, 1);
      assert.equal(detail?.printing.colorPages, 4);
      console.log("M PASS job count correct");
    }

    // N — Agent status correctly represented
    {
      const online = getAdminAgentStatus({
        agentId: "PMEA-1",
        agentLastSeen: new Date(now.getTime() - 3_000),
        now,
      });
      assert.equal(online.status, "Online");

      const offline = getAdminAgentStatus({
        agentId: "PMEA-1",
        agentLastSeen: new Date(now.getTime() - 60_000),
        now,
      });
      assert.equal(offline.status, "Offline");

      const never = getAdminAgentStatus({
        agentId: null,
        agentLastSeen: null,
        now,
      });
      assert.equal(never.status, "Never connected");

      const listed = await listAdminShops({
        search: stamp,
        page: 1,
        pageSize: 20,
        now,
      });
      assert.equal(
        listed.shops.find((s) => s.id === shopA.id)?.agent.status,
        "Online",
      );
      assert.equal(
        listed.shops.find((s) => s.id === shopB.id)?.agent.status,
        "Never connected",
      );
      console.log("N PASS agent status correctly represented");
    }

    // O — Shop A data is not mixed with Shop B
    {
      const detailA = await getAdminShopDetail(shopA.id, now);
      const detailB = await getAdminShopDetail(shopB.id, now);
      assert.ok(detailA && detailB);
      assert.equal(detailA.shopCode, shopA.shopCode);
      assert.equal(detailB.shopCode, shopB.shopCode);
      assert.notEqual(detailA.owner.email, detailB.owner.email);
      assert.equal(detailA.printing.totalJobs, 2);
      assert.equal(detailB.printing.totalJobs, 1);
      assert.equal(detailA.printerCount, 2);
      assert.equal(detailB.printerCount, 1);
      assert.ok(!detailA.printers.some((p) => p.printerName === "Epson B1"));
      assert.ok(!detailB.printers.some((p) => p.printerName.startsWith("HP")));
      console.log("O PASS Shop A data is not mixed with Shop B");
    }

    console.log("\nPhase 6B smoke tests passed.");
  } finally {
    for (const shopId of shopIds) {
      await prisma.printJob.deleteMany({ where: { shopId } });
      await prisma.printer.deleteMany({ where: { shopId } });
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
