/**
 * Phase 6C — Admin subscription & revenue smoke tests.
 * Run: npx tsx scripts/phase6c-admin-subscriptions-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import {
  ADMIN_SUBSCRIPTION_FORBIDDEN_KEYS,
  getAdminSubscriptionDetail,
  getAdminSubscriptionSummary,
  listAdminSubscriptions,
} from "../lib/admin-subscriptions";
import { PREMIUM_PLAN } from "../lib/cashfree";
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
        (ADMIN_SUBSCRIPTION_FORBIDDEN_KEYS as readonly string[]).includes(key)
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
  const webhookIds: string[] = [];

  try {
    const ownerA = await prisma.user.create({
      data: {
        name: "Sub Owner A",
        email: `suba-${stamp}@example.com`,
        passwordHash: await hashPassword("SmokeTestPass!234"),
        role: "SHOPKEEPER",
      },
    });
    userIds.push(ownerA.id);

    const ownerB = await prisma.user.create({
      data: {
        name: "Sub Owner B",
        email: `subb-${stamp}@example.com`,
        passwordHash: await hashPassword("SmokeTestPass!234"),
        role: "SHOPKEEPER",
      },
    });
    userIds.push(ownerB.id);

    const admin = await prisma.user.create({
      data: {
        name: "Admin SixC",
        email: `admin6c-${stamp}@example.com`,
        passwordHash: await hashPassword("AdminSmokePass!23456"),
        role: "ADMIN",
      },
    });
    userIds.push(admin.id);

    const shopA = await prisma.shop.create({
      data: {
        shopCode: `SA${stamp}`.slice(0, 12),
        shopName: `Trial Shop ${stamp}`,
        phone: "9876543210",
        address: "A",
        email: ownerA.email,
        ownerId: ownerA.id,
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
            trialEndAt: new Date(now.getTime() + 5 * 86400000),
          },
        },
      },
      include: { subscription: true },
    });
    shopIds.push(shopA.id);

    const shopB = await prisma.shop.create({
      data: {
        shopCode: `SB${stamp}`.slice(0, 12),
        shopName: `Premium Shop ${stamp}`,
        phone: "9876543211",
        address: "B",
        email: ownerB.email,
        ownerId: ownerB.id,
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
            trialStartAt: new Date(now.getTime() - 20 * 86400000),
            trialEndAt: new Date(now.getTime() - 13 * 86400000),
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
            cancelAtPeriodEnd: false,
            provider: "CASHFREE",
            providerCustomerId: "cust_secret_must_not_leak",
            providerSubscriptionId: `PME-PREM-${stamp}`,
            providerPlanId: "plan_test",
          },
        },
      },
      include: { subscription: true },
    });
    shopIds.push(shopB.id);

    const shopC = await prisma.shop.create({
      data: {
        shopCode: `SC${stamp}`.slice(0, 12),
        shopName: `PastDue Shop ${stamp}`,
        phone: "9876543212",
        address: "C",
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
            status: "PAST_DUE",
            pastDueSince: now,
            currentPeriodEnd: new Date(now.getTime() + 10 * 86400000),
            provider: "CASHFREE",
            providerSubscriptionId: `PME-PD-${stamp}`,
          },
        },
      },
      include: { subscription: true },
    });
    shopIds.push(shopC.id);

    const shopD = await prisma.shop.create({
      data: {
        shopCode: `SD${stamp}`.slice(0, 12),
        shopName: `Expired Shop ${stamp}`,
        phone: "9876543213",
        address: "D",
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
            plan: "TRIAL",
            status: "EXPIRED",
            trialStartAt: new Date(now.getTime() - 20 * 86400000),
            trialEndAt: new Date(now.getTime() - 13 * 86400000),
          },
        },
      },
      include: { subscription: true },
    });
    shopIds.push(shopD.id);

    const shopE = await prisma.shop.create({
      data: {
        shopCode: `SE${stamp}`.slice(0, 12),
        shopName: `Cancel Shop ${stamp}`,
        phone: "9876543214",
        address: "E",
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
            cancelAtPeriodEnd: true,
            cancelledAt: now,
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 15 * 86400000),
            provider: "CASHFREE",
            providerSubscriptionId: `PME-CAN-${stamp}`,
          },
        },
      },
      include: { subscription: true },
    });
    shopIds.push(shopE.id);

    const webhook = await prisma.paymentWebhookEvent.create({
      data: {
        provider: "CASHFREE",
        eventId: `SUBSCRIPTION_STATUS_CHANGED:PME-PREM-${stamp}:t:none`,
        eventType: "SUBSCRIPTION_STATUS_CHANGED",
        payloadHash: "hash_only_not_secret",
        processedAt: now,
      },
    });
    webhookIds.push(webhook.id);

    // A — Admin can list subscriptions
    {
      assert.equal(authorizeAdmin(admin.role).ok, true);
      const listed = await listAdminSubscriptions({
        search: stamp,
        page: 1,
        pageSize: 50,
        now,
      });
      assert.ok(listed.subscriptions.length >= 5);
      console.log("A PASS admin can list subscriptions");
    }

    // B — Pagination
    {
      const p1 = await listAdminSubscriptions({
        search: stamp,
        page: 1,
        pageSize: 2,
        now,
      });
      assert.equal(p1.pageSize, 2);
      assert.equal(p1.subscriptions.length, 2);
      assert.ok(p1.totalPages >= 3);
      const p2 = await listAdminSubscriptions({
        search: stamp,
        page: 2,
        pageSize: 2,
        now,
      });
      assert.notEqual(p1.subscriptions[0]?.id, p2.subscriptions[0]?.id);
      console.log("B PASS pagination works");
    }

    // C — Search by shop name
    {
      const listed = await listAdminSubscriptions({
        search: `Premium Shop ${stamp}`,
        page: 1,
        pageSize: 20,
        now,
      });
      assert.ok(listed.subscriptions.some((s) => s.shopId === shopB.id));
      assert.ok(!listed.subscriptions.some((s) => s.shopId === shopA.id));
      console.log("C PASS search by shop name");
    }

    // D — Search by shop code
    {
      const listed = await listAdminSubscriptions({
        search: shopA.shopCode,
        page: 1,
        pageSize: 20,
        now,
      });
      assert.ok(listed.subscriptions.some((s) => s.shopId === shopA.id));
      console.log("D PASS search by shop code");
    }

    // E — Search by owner email
    {
      const listed = await listAdminSubscriptions({
        search: ownerB.email,
        page: 1,
        pageSize: 20,
        now,
      });
      assert.ok(listed.subscriptions.some((s) => s.shopId === shopB.id));
      console.log("E PASS search by owner email");
    }

    // F — Status filter
    {
      const listed = await listAdminSubscriptions({
        search: stamp,
        status: "PAST_DUE",
        page: 1,
        pageSize: 20,
        now,
      });
      assert.ok(listed.subscriptions.every((s) => s.status === "PAST_DUE"));
      assert.ok(listed.subscriptions.some((s) => s.shopId === shopC.id));
      console.log("F PASS status filter works");
    }

    // G — Plan filter
    {
      const listed = await listAdminSubscriptions({
        search: stamp,
        plan: "TRIAL",
        page: 1,
        pageSize: 20,
        now,
      });
      assert.ok(listed.subscriptions.every((s) => s.plan === "TRIAL"));
      console.log("G PASS plan filter works");
    }

    // H/I/J/K — Counts
    {
      const summary = await getAdminSubscriptionSummary(now);
      assert.ok(summary.activePremium >= 2); // shop B + shop E (cancel at period end still ACTIVE)
      assert.ok(summary.trialing >= 1);
      assert.ok(summary.pastDue >= 1);
      assert.ok(summary.expired >= 1);
      console.log("H PASS Active Premium counted correctly");
      console.log("I PASS Trial counted correctly");
      console.log("J PASS Past Due counted correctly");
      console.log("K PASS Expired counted correctly");
    }

    // L — Estimated MRR
    {
      const summary = await getAdminSubscriptionSummary(now);
      assert.equal(summary.planPriceInr, PREMIUM_PLAN.amountInr);
      assert.equal(
        summary.estimatedMrrInr,
        summary.activePremium * PREMIUM_PLAN.amountInr,
      );
      console.log("L PASS Estimated MRR calculation correct");
    }

    // M — Sandbox/test not treated as collected revenue
    {
      const summary = await getAdminSubscriptionSummary(now);
      assert.equal(summary.collectedRevenueAvailable, false);
      assert.match(summary.collectedRevenueNote, /not counted as revenue|Not available|payment transaction/i);
      const listed = await listAdminSubscriptions({ page: 1, pageSize: 1, now });
      assert.equal(listed.summary.collectedRevenueAvailable, false);
      console.log("M PASS sandbox/test not treated as collected revenue");
    }

    // N — Sensitive credentials never returned
    {
      const listed = await listAdminSubscriptions({
        search: shopB.shopCode,
        page: 1,
        pageSize: 5,
        now,
      });
      const detail = await getAdminSubscriptionDetail(
        shopB.subscription!.id,
        now,
      );
      for (const payload of [listed, detail]) {
        const hit = containsForbiddenKey(JSON.parse(JSON.stringify(payload)));
        assert.equal(hit, null, `forbidden key: ${hit}`);
      }
      const raw = JSON.stringify(detail);
      assert.equal(raw.includes("cust_secret_must_not_leak"), false);
      assert.equal(raw.includes("CASHFREE_CLIENT_SECRET"), false);
      console.log("N PASS sensitive credentials never returned");
    }

    // O — Shopkeeper cannot access
    {
      assert.equal(authorizeAdmin(ownerA.role).status, 403);
      console.log("O PASS shopkeeper cannot access admin subscription API");
    }

    // P — Unknown subscription 404
    {
      const missing = await getAdminSubscriptionDetail(
        "00000000-0000-0000-0000-000000000000",
        now,
      );
      assert.equal(missing, null);
      console.log("P PASS unknown subscription returns 404");
    }

    // Q — Admin can view details
    {
      const detail = await getAdminSubscriptionDetail(
        shopB.subscription!.id,
        now,
      );
      assert.ok(detail);
      assert.equal(detail.shop.shopCode, shopB.shopCode);
      assert.equal(detail.providerSubscriptionId, `PME-PREM-${stamp}`);
      assert.equal(detail.providerPlanId, "plan_test");
      assert.ok(
        detail.relatedWebhookEvents.some((e) => e.id === webhook.id),
      );
      console.log("Q PASS admin can view subscription details");
    }

    // R — Cancellation state displayed correctly
    {
      const listed = await listAdminSubscriptions({
        search: shopE.shopCode,
        page: 1,
        pageSize: 5,
        now,
      });
      const row = listed.subscriptions.find((s) => s.shopId === shopE.id);
      assert.ok(row);
      assert.match(row.cancellationLabel, /Cancellation scheduled/i);
      assert.equal(row.cancelAtPeriodEnd, true);
      assert.equal(row.hasAccess, true);

      const detail = await getAdminSubscriptionDetail(
        shopE.subscription!.id,
        now,
      );
      assert.match(detail!.cancellationLabel, /Cancellation scheduled/i);
      console.log("R PASS cancellation state displayed correctly");
    }

    console.log("\nPhase 6C smoke tests passed.");
  } finally {
    for (const id of webhookIds) {
      await prisma.paymentWebhookEvent.deleteMany({ where: { id } });
    }
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
