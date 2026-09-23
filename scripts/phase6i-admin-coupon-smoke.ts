/**
 * Phase 6I — Admin coupon infrastructure.
 * Run: npx tsx scripts/phase6i-admin-coupon-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import {
  createAdminCoupon,
  getAdminCoupon,
  getAdminCouponEffectiveStatus,
  updateAdminCoupon,
} from "../lib/admin-coupons";
import { hashPassword } from "../lib/auth";

const prisma = new PrismaClient();

function authorizeAdmin(role: string | undefined) {
  if (!role) return { ok: false as const, status: 401 as const };
  if (role !== "ADMIN") return { ok: false as const, status: 403 as const };
  return { ok: true as const, status: 200 as const };
}

function baseCoupon(code: string, shopId: string | null, value = 20) {
  return {
    code,
    type: "PERCENT" as const,
    value,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-12-31T00:00:00.000Z",
    maxRedemptions: 100,
    perShopLimit: 1,
    shopId,
    isActive: true,
  };
}

async function main() {
  for (const file of [
    "app/api/admin/coupons/route.ts",
    "app/api/admin/coupons/[couponId]/route.ts",
    "app/admin/coupons/page.tsx",
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    if (file.endsWith("page.tsx")) {
      assert.match(source, /requireAdmin\(\)/);
    } else {
      const handlers = source.split("export async function ").slice(1);
      assert.ok(handlers.length > 0, file);
      for (const handler of handlers) {
        const guardAt = handler.indexOf("requireAdminApi()");
        const dataAt = handler.search(
          /listAdminCoupons|createAdminCoupon|getAdminCoupon|updateAdminCoupon/,
        );
        assert.ok(guardAt >= 0 && dataAt > guardAt, file);
        assert.match(handler, /if \(session instanceof Response\) return session/);
      }
    }
  }
  assert.equal(authorizeAdmin(undefined).status, 401);
  assert.equal(authorizeAdmin("SHOPKEEPER").status, 403);
  assert.equal(authorizeAdmin("ADMIN").status, 200);
  console.log("S PASS admin authorization is enforced");

  const statusNow = new Date("2026-06-15T12:00:00.000Z");
  assert.equal(
    getAdminCouponEffectiveStatus(
      {
        isActive: true,
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2026-12-31T00:00:00.000Z",
      },
      statusNow,
    ),
    "Active",
  );
  assert.equal(
    getAdminCouponEffectiveStatus(
      {
        isActive: true,
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2026-01-31T00:00:00.000Z",
      },
      statusNow,
    ),
    "Expired",
  );
  assert.equal(
    getAdminCouponEffectiveStatus(
      {
        isActive: true,
        validFrom: "2026-07-01T00:00:00.000Z",
        validUntil: "2026-12-31T00:00:00.000Z",
      },
      statusNow,
    ),
    "Scheduled",
  );
  assert.equal(
    getAdminCouponEffectiveStatus(
      {
        isActive: false,
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2026-12-31T00:00:00.000Z",
      },
      statusNow,
    ),
    "Inactive",
  );
  const panelSource = fs.readFileSync(
    path.join(process.cwd(), "components/admin/admin-coupons-panel.tsx"),
    "utf8",
  );
  assert.match(panelSource, /getAdminCouponEffectiveStatus/);
  assert.equal(panelSource.includes('coupon.isActive ? "Active" : "Inactive"'), false);
  console.log("STATUS PASS Admin coupon badge uses effective status");

  const stamp = Date.now().toString(36);
  const admin = await prisma.user.create({
    data: {
      name: "Coupon Admin",
      email: `coupon-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  const shop = await prisma.shop.create({
    data: {
      shopCode: `CP${stamp}`.slice(0, 12),
      shopName: "Coupon Shop",
      phone: "9876543210",
      address: "Addr",
      isActive: true,
    },
  });
  const inactive = await prisma.shop.create({
    data: {
      shopCode: `CI${stamp}`.slice(0, 12),
      shopName: "Inactive Coupon Shop",
      phone: "9876543211",
      address: "Addr",
      isActive: false,
    },
  });
  const createdIds: string[] = [];

  try {
    const created = await createAdminCoupon({
      adminUserId: admin.id,
      body: baseCoupon(`welcome${stamp}`, null),
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    createdIds.push(created.coupon.id);
    assert.equal(created.coupon.code, `WELCOME${stamp}`.toUpperCase());
    assert.equal(created.coupon.shopId, null);
    assert.equal(created.coupon.type, "PERCENT");
    assert.equal(created.coupon.value, 20);
    console.log("A PASS create global percentage coupon");
    console.log("B PASS code is normalized to uppercase");
    console.log("Q PASS global coupon has shopId null");

    const duplicate = await createAdminCoupon({
      adminUserId: admin.id,
      body: baseCoupon(`WELCOME${stamp}`.toUpperCase(), null),
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.status, 409);
    console.log("C PASS duplicate code rejected");

    const badPercent = await createAdminCoupon({
      adminUserId: admin.id,
      body: { ...baseCoupon(`badp${stamp}`, null), value: 0 },
    });
    assert.equal(badPercent.ok, false);
    console.log("D PASS invalid percentage rejected");

    const overPercent = await createAdminCoupon({
      adminUserId: admin.id,
      body: { ...baseCoupon(`over${stamp}`, null), value: 101 },
    });
    assert.equal(overPercent.ok, false);
    console.log("E PASS percentage over 100 rejected");

    const badFixed = await createAdminCoupon({
      adminUserId: admin.id,
      body: { ...baseCoupon(`fix${stamp}`, null), type: "FIXED", value: 0 },
    });
    assert.equal(badFixed.ok, false);
    console.log("F PASS invalid fixed amount rejected");

    const badDates = await createAdminCoupon({
      adminUserId: admin.id,
      body: {
        ...baseCoupon(`date${stamp}`, null),
        validFrom: "2026-12-31T00:00:00.000Z",
        validUntil: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.equal(badDates.ok, false);
    console.log("G PASS invalid date range rejected");

    const badMax = await createAdminCoupon({
      adminUserId: admin.id,
      body: { ...baseCoupon(`max${stamp}`, null), maxRedemptions: 0 },
    });
    assert.equal(badMax.ok, false);
    console.log("H PASS invalid maxRedemptions rejected");

    const badPerShop = await createAdminCoupon({
      adminUserId: admin.id,
      body: { ...baseCoupon(`per${stamp}`, null), perShopLimit: -1 },
    });
    assert.equal(badPerShop.ok, false);
    console.log("I PASS invalid perShopLimit rejected");

    const specific = await createAdminCoupon({
      adminUserId: admin.id,
      body: { ...baseCoupon(`shop${stamp}`, shop.id), type: "FIXED", value: 50 },
    });
    assert.equal(specific.ok, true);
    if (!specific.ok) return;
    createdIds.push(specific.coupon.id);
    assert.equal(specific.coupon.shopId, shop.id);
    console.log("J PASS create shop-specific coupon");
    console.log("R PASS specific coupon has the correct shopId");

    const missingShop = await createAdminCoupon({
      adminUserId: admin.id,
      body: baseCoupon(`miss${stamp}`, "missing-shop-id"),
    });
    assert.equal(missingShop.ok, false);
    if (!missingShop.ok) assert.equal(missingShop.status, 404);
    const inactiveShop = await createAdminCoupon({
      adminUserId: admin.id,
      body: baseCoupon(`off${stamp}`, inactive.id),
    });
    assert.equal(inactiveShop.ok, false);
    console.log("K PASS invalid or inactive shop rejected");

    const updated = await updateAdminCoupon({
      adminUserId: admin.id,
      couponId: created.coupon.id,
      body: { value: 25, maxRedemptions: 10 },
    });
    assert.equal(updated.ok, true);
    if (updated.ok) {
      assert.equal(updated.coupon.value, 25);
      assert.equal(updated.coupon.maxRedemptions, 10);
      assert.equal(updated.coupon.code, created.coupon.code);
    }
    console.log("L PASS update coupon");

    const deactivated = await updateAdminCoupon({
      adminUserId: admin.id,
      couponId: created.coupon.id,
      body: { isActive: false },
    });
    assert.equal(deactivated.ok, true);
    if (deactivated.ok) assert.equal(deactivated.coupon.isActive, false);
    const activated = await updateAdminCoupon({
      adminUserId: admin.id,
      couponId: created.coupon.id,
      body: { isActive: true },
    });
    assert.equal(activated.ok, true);
    if (activated.ok) assert.equal(activated.coupon.isActive, true);
    console.log("M PASS activate and deactivate coupon");

    const beforeNoop = await prisma.adminAuditLog.count({
      where: { adminUserId: admin.id, targetId: created.coupon.id },
    });
    const noop = await updateAdminCoupon({
      adminUserId: admin.id,
      couponId: created.coupon.id,
      body: { isActive: true, value: 25 },
    });
    assert.equal(noop.ok, true);
    const afterNoop = await prisma.adminAuditLog.count({
      where: { adminUserId: admin.id, targetId: created.coupon.id },
    });
    assert.equal(afterNoop, beforeNoop);
    console.log("N PASS no-op mutation does not create a duplicate audit entry");

    const audits = await prisma.adminAuditLog.findMany({
      where: { adminUserId: admin.id, targetId: created.coupon.id },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(audits[0]?.action, "COUPON_CREATED");
    assert.equal(audits[0]?.targetType, "Coupon");
    assert.equal(audits[0]?.beforeJson, null);
    assert.equal((audits[0]?.afterJson as { code?: string } | null)?.code, created.coupon.code);
    assert.ok(audits.some((row) => row.action === "COUPON_UPDATED"));
    assert.ok(audits.some((row) => row.action === "COUPON_DEACTIVATED"));
    assert.ok(audits.some((row) => row.action === "COUPON_ACTIVATED"));
    console.log("O PASS audit entries created correctly");

    const payment = await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199,
        currency: "INR",
        providerOrderId: `PMEPAY-CPN-${stamp}`.slice(0, 40),
      },
    });
    await prisma.couponRedemption.create({
      data: {
        couponId: specific.coupon.id,
        shopId: shop.id,
        billingPaymentId: payment.id,
      },
    });
    const detail = await getAdminCoupon(specific.coupon.id);
    assert.equal(detail?.redemptionCount, 1);
    assert.equal(detail?.remainingRedemptions, 99);
    console.log("P PASS redemption count query works");

    console.log("\nphase6i-admin-coupon-smoke: ALL PASS");
  } finally {
    await prisma.couponRedemption.deleteMany({
      where: { couponId: { in: createdIds } },
    });
    await prisma.coupon.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.billingPayment.deleteMany({
      where: { shopId: { in: [shop.id, inactive.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shop.id, inactive.id] } } });
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
