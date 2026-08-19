/**
 * Phase 4B subscription foundation smoke tests.
 * Run: npx tsx scripts/phase4b-subscription-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import {
  TRIAL_DURATION_MS,
  createNestedTrialSubscription,
  createTrialSubscriptionData,
  getSubscriptionAccess,
  isSubscriptionActive,
  isTrialActive,
  toPublicSubscriptionView,
} from "../lib/subscription";

const prisma = new PrismaClient();

async function countRelated(shopId: string) {
  const [jobs, printers, prices, settings, inventory, subs] = await Promise.all([
    prisma.printJob.count({ where: { shopId } }),
    prisma.printer.count({ where: { shopId } }),
    prisma.printPrice.count({ where: { shopId } }),
    prisma.settings.count({ where: { shopId } }),
    prisma.inventory.count({ where: { shopId } }),
    prisma.subscription.count({ where: { shopId } }),
  ]);
  return { jobs, printers, prices, settings, inventory, subs };
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const createdShopIds: string[] = [];
  const createdUserIds: string[] = [];

  try {
    // H — capture existing shops before creating test data
    const existingBefore = await prisma.shop.findMany({
      select: {
        id: true,
        shopCode: true,
        shopName: true,
        ownerId: true,
        agentId: true,
        agentTokenHash: true,
      },
      take: 50,
    });
    const existingSubs = await prisma.subscription.findMany({
      where: { shopId: { in: existingBefore.map((s) => s.id) } },
      select: { shopId: true, plan: true, status: true },
    });
    for (const shop of existingBefore) {
      const sub = existingSubs.find((s) => s.shopId === shop.id);
      assert.ok(sub, `Existing shop ${shop.shopCode} missing subscription`);
      assert.equal(sub.plan, "TRIAL");
      assert.equal(sub.status, "TRIALING");
    }
    console.log(`H PASS existing shops preserved with TRIALING (${existingBefore.length} sampled)`);

    // A/B — new shop trial
    const now = new Date();
    const shopA = await prisma.shop.create({
      data: {
        shopCode: `SA${stamp}`.slice(0, 12),
        shopName: "Sub Shop A",
        phone: "9000000001",
        address: "A",
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
        subscription: { create: createNestedTrialSubscription(now) },
      },
      include: { subscription: true },
    });
    createdShopIds.push(shopA.id);

    assert.ok(shopA.subscription);
    assert.equal(shopA.subscription!.plan, "TRIAL");
    assert.equal(shopA.subscription!.status, "TRIALING");
    console.log("A PASS new shop TRIALING");

    const duration =
      shopA.subscription!.trialEndAt!.getTime() -
      shopA.subscription!.trialStartAt!.getTime();
    assert.equal(duration, TRIAL_DURATION_MS);
    console.log("B PASS trial duration exactly 7 days");

    // C
    assert.equal(isTrialActive(shopA.subscription), true);
    assert.equal(getSubscriptionAccess(shopA.subscription).hasAccess, true);
    console.log("C PASS active trial access=true");

    // D — expired trial
    const expired = {
      ...shopA.subscription!,
      trialEndAt: new Date(Date.now() - 60_000),
    };
    assert.equal(isTrialActive(expired), false);
    assert.equal(getSubscriptionAccess(expired).hasAccess, false);
    console.log("D PASS expired trial access=false");

    // E — premium active
    const premium = await prisma.subscription.update({
      where: { shopId: shopA.id },
      data: {
        plan: "PREMIUM",
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    assert.equal(isSubscriptionActive(premium), true);
    assert.equal(getSubscriptionAccess(premium).hasAccess, true);
    console.log("E PASS premium ACTIVE access=true");

    // F — shop isolation
    const shopB = await prisma.shop.create({
      data: {
        shopCode: `SB${stamp}`.slice(0, 12),
        shopName: "Sub Shop B",
        phone: "9000000002",
        address: "B",
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
        subscription: { create: createNestedTrialSubscription() },
      },
      include: { subscription: true },
    });
    createdShopIds.push(shopB.id);

    const aSub = await prisma.subscription.findUnique({ where: { shopId: shopA.id } });
    const bSub = await prisma.subscription.findUnique({ where: { shopId: shopB.id } });
    assert.ok(aSub && bSub);
    assert.notEqual(aSub!.id, bSub!.id);
    assert.notEqual(aSub!.shopId, bSub!.shopId);
    const viewA = toPublicSubscriptionView(aSub);
    const viewB = toPublicSubscriptionView(bSub);
    assert.equal(viewA?.plan, "PREMIUM");
    assert.equal(viewB?.plan, "TRIAL");
    console.log("F PASS Shop A cannot see Shop B subscription state");

    // I — API-shaped view never includes secrets / provider IDs by default
    assert.ok(viewA);
    assert.equal("providerSubscriptionId" in (viewA as object), false);
    assert.equal("passwordHash" in (viewA as object), false);
    console.log("I PASS public subscription view is safe");

    // G — signup rollback leaves no orphan subscription
    const email = `rollback-${stamp}@example.com`.toLowerCase();
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: "Rollback",
            email,
            passwordHash: "x".repeat(60),
          },
        });
        createdUserIds.push(user.id);

        await tx.shop.create({
          data: {
            shopCode: `SR${stamp}`.slice(0, 12),
            shopName: "Rollback Shop",
            phone: "9000000003",
            address: "R",
            ownerId: user.id,
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
        });

        throw new Error("forced_rollback");
      });
      assert.fail("expected rollback");
    } catch (error) {
      assert.equal((error as Error).message, "forced_rollback");
    }

    const orphanUser = await prisma.user.findUnique({ where: { email } });
    assert.equal(orphanUser, null);
    const orphanShop = await prisma.shop.findFirst({
      where: { shopCode: `SR${stamp}`.slice(0, 12) },
    });
    assert.equal(orphanShop, null);
    const orphanSub = await prisma.subscription.findFirst({
      where: { shop: { shopCode: `SR${stamp}`.slice(0, 12) } },
    });
    assert.equal(orphanSub, null);
    console.log("G PASS signup rollback leaves no orphan subscription");

    // Existing data not mutated for unrelated shops
    for (const shop of existingBefore) {
      const current = await prisma.shop.findUnique({
        where: { id: shop.id },
        select: {
          shopCode: true,
          shopName: true,
          ownerId: true,
          agentId: true,
          agentTokenHash: true,
        },
      });
      assert.deepEqual(current, {
        shopCode: shop.shopCode,
        shopName: shop.shopName,
        ownerId: shop.ownerId,
        agentId: shop.agentId,
        agentTokenHash: shop.agentTokenHash,
      });
    }
    console.log("H2 PASS existing shop ownership/agent fields unchanged");

    // helper duration constant sanity
    const data = createTrialSubscriptionData("x");
    assert.equal(
      data.trialEndAt.getTime() - data.trialStartAt.getTime(),
      TRIAL_DURATION_MS,
    );

    void countRelated;
    console.log("ALL PHASE 4B SUBSCRIPTION TESTS PASSED");
  } finally {
    if (createdShopIds.length) {
      await prisma.shop.deleteMany({ where: { id: { in: createdShopIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
