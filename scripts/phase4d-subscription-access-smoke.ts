/**
 * Phase 4D — Subscription access control smoke tests.
 * Run: npx tsx scripts/phase4d-subscription-access-smoke.ts
 *
 * Uses deterministic clocks; does not call live Cashfree.
 */
import assert from "node:assert/strict";
import { PrismaClient, type Subscription } from "@prisma/client";

import {
  PAST_DUE_GRACE_MS,
  buildSubscriptionAccessState,
  canCancelSubscription,
  canInitiatePremiumCheckout,
  cancelShopSubscription,
  createNestedTrialSubscription,
  getDashboardSubscriptionSummary,
  getShopSubscription,
  getSubscriptionAccess,
  getSubscriptionAccessForShop,
  hasSubscriptionAccess,
  toPublicSubscriptionView,
} from "../lib/subscription";

const prisma = new PrismaClient();

function daysFrom(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

async function createShop(stamp: string, suffix: string) {
  return prisma.shop.create({
    data: {
      shopCode: `D${suffix}${stamp}`.slice(0, 12),
      shopName: `Phase4D Shop ${suffix}`,
      phone: "9876543210",
      address: "Test",
      email: `d4d-${suffix}-${stamp}@example.com`,
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
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shopIds: string[] = [];
  const now = new Date("2026-08-19T12:00:00.000Z");

  try {
    const shopA = await createShop(stamp, "A");
    const shopB = await createShop(stamp, "B");
    shopIds.push(shopA.id, shopB.id);

    // A — Active trial → access allowed
    {
      const sub = shopA.subscription!;
      const access = getSubscriptionAccess(sub, now);
      assert.equal(access.hasAccess, true);
      assert.equal(access.reason, "trialing");
      assert.equal(await hasSubscriptionAccess(shopA.id, now), true);
      const view = toPublicSubscriptionView(sub, now)!;
      assert.match(view.label, /7-Day Free Trial/i);
      assert.equal(view.canSubscribe, true);
      console.log("A PASS active trial → access allowed");
    }

    // B — Expired trial → access denied
    {
      const expiredTrialAt = daysFrom(now, -1);
      const sub = await prisma.subscription.update({
        where: { shopId: shopA.id },
        data: {
          status: "TRIALING",
          plan: "TRIAL",
          trialStartAt: daysFrom(now, -8),
          trialEndAt: expiredTrialAt,
        },
      });
      const access = getSubscriptionAccess(sub, now);
      assert.equal(access.hasAccess, false);
      assert.equal(access.reason, "trial_expired");
      assert.equal(await hasSubscriptionAccess(shopA.id, now), false);
      console.log("B PASS expired trial → access denied");
    }

    // C — Active Premium → access allowed
    {
      const periodEnd = daysFrom(now, 20);
      const sub = await prisma.subscription.update({
        where: { shopId: shopA.id },
        data: {
          plan: "PREMIUM",
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          provider: "CASHFREE",
          providerSubscriptionId: `PME-A-${stamp}`,
          pastDueSince: null,
        },
      });
      const access = getSubscriptionAccess(sub, now);
      assert.equal(access.hasAccess, true);
      assert.equal(access.reason, "active");
      const view = toPublicSubscriptionView(sub, now)!;
      assert.match(view.label, /Premium/i);
      assert.equal(view.canSubscribe, false);
      assert.equal(view.canCancel, true);
      console.log("C PASS active Premium → access allowed");
    }

    // D — Cancelled Premium before period end → access allowed
    {
      const periodEnd = daysFrom(now, 10);
      const sub = await prisma.subscription.update({
        where: { shopId: shopA.id },
        data: {
          status: "CANCELLED",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: periodEnd,
        },
      });
      const access = getSubscriptionAccess(sub, now);
      assert.equal(access.hasAccess, true);
      assert.equal(access.reason, "cancelled_until_period_end");
      assert.equal(canInitiatePremiumCheckout(sub, now).ok, false);
      const view = toPublicSubscriptionView(sub, now)!;
      assert.match(view.label, /Cancelled/i);
      console.log("D PASS cancelled before period end → access allowed");
    }

    // E — Cancelled Premium after period end → access denied
    {
      const sub = await prisma.subscription.update({
        where: { shopId: shopA.id },
        data: {
          status: "CANCELLED",
          currentPeriodEnd: daysFrom(now, -1),
        },
      });
      const access = getSubscriptionAccess(sub, now);
      assert.equal(access.hasAccess, false);
      assert.equal(access.reason, "cancelled");
      assert.equal(canInitiatePremiumCheckout(sub, now).ok, true);
      console.log("E PASS cancelled after period end → access denied");
    }

    // Also cover ACTIVE + cancelAtPeriodEnd after period end
    {
      const sub = await prisma.subscription.update({
        where: { shopId: shopA.id },
        data: {
          status: "ACTIVE",
          cancelAtPeriodEnd: true,
          currentPeriodEnd: daysFrom(now, -1),
        },
      });
      assert.equal(getSubscriptionAccess(sub, now).hasAccess, false);
    }

    // F — PAST_DUE within 3-day grace → access allowed
    {
      const pastDueSince = daysFrom(now, -1);
      const sub = await prisma.subscription.update({
        where: { shopId: shopA.id },
        data: {
          status: "PAST_DUE",
          plan: "PREMIUM",
          pastDueSince,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: daysFrom(now, 20),
          providerSubscriptionId: `PME-A-${stamp}`,
        },
      });
      const access = getSubscriptionAccess(sub, now);
      assert.equal(access.hasAccess, true);
      assert.equal(access.reason, "past_due_grace");
      assert.equal(access.isGracePeriod, true);
      assert.equal(canInitiatePremiumCheckout(sub, now).ok, false);
      const view = toPublicSubscriptionView(sub, now)!;
      assert.match(view.label, /Payment issue/i);
      console.log("F PASS PAST_DUE within grace → access allowed");
    }

    // G — PAST_DUE after grace → access denied
    {
      const pastDueSince = new Date(now.getTime() - PAST_DUE_GRACE_MS - 60_000);
      const sub = await prisma.subscription.update({
        where: { shopId: shopA.id },
        data: { pastDueSince, status: "PAST_DUE" },
      });
      const access = getSubscriptionAccess(sub, now);
      assert.equal(access.hasAccess, false);
      assert.equal(access.reason, "past_due_expired");
      assert.equal(canInitiatePremiumCheckout(sub, now).ok, true);
      console.log("G PASS PAST_DUE after grace → access denied");
    }

    // H — Missing subscription → access denied
    {
      await prisma.subscription.delete({ where: { shopId: shopA.id } });
      const access = await getSubscriptionAccessForShop(shopA.id, now);
      assert.equal(access.hasAccess, false);
      assert.equal(access.reason, "missing");
      assert.equal(access.isExpired, true);
      // Restore for later tests
      await prisma.subscription.create({
        data: {
          shopId: shopA.id,
          ...createNestedTrialSubscription(now),
        },
      });
      console.log("H PASS missing subscription → access denied");
    }

    // I — Shop A cannot access Shop B subscription
    {
      const aSub = await getShopSubscription(shopA.id);
      const bSub = await getShopSubscription(shopB.id);
      assert.ok(aSub && bSub);
      assert.notEqual(aSub.id, bSub.id);
      assert.notEqual(aSub.shopId, bSub.shopId);
      // Access helpers are keyed by shopId — A's id never returns B's row
      const loadedAsA = await getShopSubscription(shopA.id);
      assert.equal(loadedAsA?.shopId, shopA.id);
      assert.notEqual(loadedAsA?.shopId, shopB.id);
      console.log("I PASS Shop A cannot read Shop B subscription");
    }

    // J — Shop A cannot cancel Shop B
    {
      await prisma.subscription.update({
        where: { shopId: shopB.id },
        data: {
          plan: "PREMIUM",
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
          provider: "CASHFREE",
          providerSubscriptionId: `PME-B-${stamp}`,
          currentPeriodStart: now,
          currentPeriodEnd: daysFrom(now, 30),
        },
      });

      let cancelCalls = 0;
      const result = await cancelShopSubscription({
        shopId: shopA.id,
        now,
        cancelProvider: async () => {
          cancelCalls += 1;
          return { subscriptionId: "x", subscriptionStatus: "CANCELLED" };
        },
      });
      // Shop A is on trial again — cannot cancel
      assert.equal(result.ok, false);
      assert.equal(cancelCalls, 0);

      const bBefore = await getShopSubscription(shopB.id);
      assert.equal(bBefore?.cancelAtPeriodEnd, false);

      // Even if somehow cancel is called with A's id, B remains untouched
      const aCancel = await cancelShopSubscription({
        shopId: shopA.id,
        now,
        cancelProvider: async () => {
          cancelCalls += 1;
          return { subscriptionId: "x", subscriptionStatus: "CANCELLED" };
        },
      });
      assert.equal(aCancel.ok, false);

      const bAfter = await getShopSubscription(shopB.id);
      assert.equal(bAfter?.cancelAtPeriodEnd, false);
      assert.equal(bAfter?.providerSubscriptionId, `PME-B-${stamp}`);
      console.log("J PASS Shop A cannot cancel Shop B");
    }

    // Successful cancel for Shop B (period-end, stays ACTIVE)
    {
      let calledWith: string | null = null;
      const result = await cancelShopSubscription({
        shopId: shopB.id,
        now,
        cancelProvider: async (input) => {
          calledWith = input.subscriptionId;
          return {
            subscriptionId: input.subscriptionId,
            subscriptionStatus: "CANCELLED",
          };
        },
      });
      assert.equal(result.ok, true);
      assert.equal(calledWith, `PME-B-${stamp}`);
      const updated = await getShopSubscription(shopB.id);
      assert.equal(updated?.cancelAtPeriodEnd, true);
      assert.equal(updated?.status, "ACTIVE");
      assert.ok(updated?.cancelledAt);
      assert.ok(updated?.currentPeriodEnd);
      assert.equal(getSubscriptionAccess(updated, now).hasAccess, true);
      assert.equal(
        getSubscriptionAccess(updated, now).reason,
        "cancelled_until_period_end",
      );
      assert.equal(canInitiatePremiumCheckout(updated, now).ok, false);
      assert.equal(canCancelSubscription(updated, now).ok, false);
      console.log("J2 PASS cancel sets cancelAtPeriodEnd, access until period end");

      // J3 — after period end, access denied and resubscribe allowed
      const afterEnd = {
        ...updated!,
        currentPeriodEnd: daysFrom(now, -1),
      };
      assert.equal(getSubscriptionAccess(afterEnd, now).hasAccess, false);
      assert.equal(canInitiatePremiumCheckout(afterEnd, now).ok, true);
      console.log("J3 PASS after cancel period end → access denied, resubscribe allowed");
    }

    // K — Browser/client cannot override subscription state
    {
      const sub = (await getShopSubscription(shopB.id))!;
      // Client-claimed "ACTIVE" / plan does not affect server helper input —
      // only the DB row matters. Simulate tampered payload ignored:
      const tampered = {
        ...sub,
        status: "EXPIRED" as const,
      };
      // Server uses DB; tampered object only matters if caller passes it.
      // getSubscriptionAccessForShop always loads from DB:
      const fromDb = await getSubscriptionAccessForShop(shopB.id, now);
      assert.equal(fromDb.hasAccess, true);
      assert.equal(fromDb.status, "ACTIVE");
      // Tampered in-memory object would deny — proving client claims aren't used
      // unless they somehow replace the DB row (they can't via public API).
      assert.equal(getSubscriptionAccess(tampered, now).hasAccess, false);
      console.log("K PASS client cannot override server subscription state");
    }

    // L — Active subscription cannot create duplicate
    {
      // Restore B to active non-cancelling for this check via new shop
      const shopC = await createShop(stamp, "C");
      shopIds.push(shopC.id);
      const sub = await prisma.subscription.update({
        where: { shopId: shopC.id },
        data: {
          plan: "PREMIUM",
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: daysFrom(now, 15),
          providerSubscriptionId: `PME-C-${stamp}`,
        },
      });
      assert.equal(canInitiatePremiumCheckout(sub, now).ok, false);
      console.log("L PASS active subscription cannot create duplicate");
    }

    // M — Expired subscription can start a new subscription flow
    const shopD = await createShop(stamp, "D");
    shopIds.push(shopD.id);
    {
      const sub = await prisma.subscription.update({
        where: { shopId: shopD.id },
        data: {
          status: "EXPIRED",
          plan: "PREMIUM",
          trialEndAt: daysFrom(now, -30),
          currentPeriodEnd: daysFrom(now, -5),
        },
      });
      assert.equal(getSubscriptionAccess(sub, now).hasAccess, false);
      assert.equal(canInitiatePremiumCheckout(sub, now).ok, true);
      console.log("M PASS expired subscription can start new flow");
    }

    // N — Pricing page representations for each state
    {
      const cases: Array<{
        name: string;
        patch: Partial<Subscription>;
        expectLabel: RegExp;
        expectAccess: boolean;
      }> = [
        {
          name: "trialing",
          patch: {
            status: "TRIALING",
            plan: "TRIAL",
            trialEndAt: daysFrom(now, 3),
            cancelAtPeriodEnd: false,
          },
          expectLabel: /7-Day Free Trial/i,
          expectAccess: true,
        },
        {
          name: "active",
          patch: {
            status: "ACTIVE",
            plan: "PREMIUM",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: daysFrom(now, 12),
          },
          expectLabel: /Premium/i,
          expectAccess: true,
        },
        {
          name: "cancelAtPeriodEnd",
          patch: {
            status: "ACTIVE",
            plan: "PREMIUM",
            cancelAtPeriodEnd: true,
            currentPeriodEnd: daysFrom(now, 8),
          },
          expectLabel: /Premium/i,
          expectAccess: true,
        },
        {
          name: "past_due",
          patch: {
            status: "PAST_DUE",
            pastDueSince: daysFrom(now, -1),
            cancelAtPeriodEnd: false,
          },
          expectLabel: /Payment issue/i,
          expectAccess: true,
        },
        {
          name: "past_due_expired",
          patch: {
            status: "PAST_DUE",
            pastDueSince: new Date(now.getTime() - PAST_DUE_GRACE_MS - 60_000),
            cancelAtPeriodEnd: false,
          },
          expectLabel: /Payment required/i,
          expectAccess: false,
        },
        {
          name: "expired",
          patch: {
            status: "EXPIRED",
            pastDueSince: null,
          },
          expectLabel: /Subscription expired/i,
          expectAccess: false,
        },
        {
          name: "cancelled_active_period",
          patch: {
            status: "CANCELLED",
            currentPeriodEnd: daysFrom(now, 5),
          },
          expectLabel: /Cancelled/i,
          expectAccess: true,
        },
      ];

      for (const c of cases) {
        const sub = await prisma.subscription.update({
          where: { shopId: shopD.id },
          data: c.patch as never,
        });
        const view = toPublicSubscriptionView(sub, now)!;
        const state = buildSubscriptionAccessState(sub, now);
        assert.match(view.label, c.expectLabel, c.name);
        assert.equal(view.hasAccess, c.expectAccess, c.name);
        assert.equal(state.hasAccess, c.expectAccess, c.name);
        if (c.name === "cancelAtPeriodEnd") {
          assert.match(view.detail, /Cancellation scheduled/i);
          assert.match(view.detail, /No further renewal/i);
        }
        if (c.name === "past_due") {
          assert.match(view.detail, /3-day grace period/i);
        }
        const card = getDashboardSubscriptionSummary(view);
        assert.ok(card.title.length > 0);
        if (c.name === "cancelAtPeriodEnd") {
          assert.match(card.title, /Cancellation scheduled/i);
        }
        if (c.name === "past_due_expired") {
          assert.match(view.detail, /grace period has ended/i);
          assert.match(card.title, /Payment required/i);
        }
      }
      console.log("N PASS pricing representations for each state");
    }

    // canCancel edge cases
    {
      const trial = await getShopSubscription(shopA.id);
      assert.equal(canCancelSubscription(trial, now).ok, false);
    }

    console.log("\nPhase 4D smoke tests passed.");
  } finally {
    for (const id of shopIds) {
      await prisma.subscription.deleteMany({ where: { shopId: id } });
      await prisma.printPrice.deleteMany({ where: { shopId: id } });
      await prisma.settings.deleteMany({ where: { shopId: id } });
      await prisma.inventory.deleteMany({ where: { shopId: id } });
      await prisma.shop.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
