/**
 * Phase 6N — permanent deletion of one deactivated test shop.
 * Run: npx tsx scripts/phase6n-admin-permanent-shop-delete-smoke.ts
 */
import assert from "node:assert/strict";
import { access, constants } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import {
  getPermanentShopDeletePreview,
  permanentlyDeleteAdminShop,
  setAdminShopActive,
} from "../lib/admin-shops";
import { hashPassword } from "../lib/auth";
import { createNestedTrialSubscription } from "../lib/subscription";
import { getStoredFilePath, } from "../lib/storage";
import { deleteStoredUploadFile, saveGeneratedPdfFile } from "../lib/upload-service";

const prisma = new PrismaClient();

function authorizeAdmin(role: string | undefined) {
  if (!role) return { ok: false as const, status: 401 as const };
  if (role !== "ADMIN") return { ok: false as const, status: 403 as const };
  return { ok: true as const, status: 200 as const };
}

function trialSubscription(overrides: Record<string, unknown> = {}) {
  return {
    ...createNestedTrialSubscription(),
    ...overrides,
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

  const routePath = path.join(
    process.cwd(),
    "app/api/admin/shops/[shopId]/permanent-delete/route.ts",
  );
  const patchPath = path.join(
    process.cwd(),
    "app/api/admin/shops/[shopId]/route.ts",
  );
  const route = fs.readFileSync(routePath, "utf8");
  const patch = fs.readFileSync(patchPath, "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  const guardAt = post.indexOf("requireAdminApi()");
  const mutateAt = post.indexOf("permanentlyDeleteAdminShop");
  assert.ok(guardAt >= 0 && mutateAt > guardAt);
  assert.match(post, /if \(session instanceof Response\) return session/);
  assert.doesNotMatch(patch, /permanentlyDeleteAdminShop/);
  assert.match(patch, /setAdminShopActive/);
  assert.equal(authorizeAdmin(undefined).status, 401);
  console.log("D PASS missing auth is 401 before any delete");
  assert.equal(authorizeAdmin("SHOPKEEPER").status, 403);
  console.log("E PASS shopkeeper auth is 403 before any delete");

  const detail = fs.readFileSync(
    path.join(process.cwd(), "components/admin/admin-shop-detail.tsx"),
    "utf8",
  );
  const control = fs.readFileSync(
    path.join(process.cwd(), "components/admin/admin-shop-permanent-delete.tsx"),
    "utf8",
  );
  const statusControl = fs.readFileSync(
    path.join(process.cwd(), "components/admin/admin-shop-status-control.tsx"),
    "utf8",
  );
  assert.match(detail, /AdminShopStatusControl/);
  assert.match(detail, /AdminShopPermanentDelete/);
  assert.match(statusControl, /Deactivate Shop/);
  assert.match(statusControl, /Reactivate Shop/);
  assert.match(control, /Delete test shop permanently/);
  assert.match(control, /Permanently Delete Shop/);
  assert.match(control, /Permanent deletion requires deactivation first/);
  assert.match(control, /Type \{shopCode\} to permanently delete this test shop/);
  assert.match(control, /cannot be undone/);
  assert.match(control, /shopkeeper account and test print/);
  assert.match(control, /data will be removed/);
  assert.match(control, /typed === shopCode/);
  console.log("UI PASS detail page keeps deactivate and adds a separate typed confirmation");

  const stamp = Date.now().toString(36);
  const shopIds: string[] = [];
  const userIds: string[] = [];
  const couponIds: string[] = [];
  const webhookIds: string[] = [];
  const leftoverFiles: string[] = [];

  const admin = await prisma.user.create({
    data: {
      name: "Delete Admin",
      email: `delete-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });
  userIds.push(admin.id);

  async function ownerUser(tag: string, role: "SHOPKEEPER" | "ADMIN" = "SHOPKEEPER") {
    const user = await prisma.user.create({
      data: {
        name: `Owner ${tag}`,
        email: `delete-owner-${tag}-${stamp}@example.com`,
        passwordHash: await hashPassword("ShopSmokePass!23456"),
        role,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function makeShop(input: {
    tag: string;
    isActive?: boolean;
    ownerId?: string | null;
    subscription?: Record<string, unknown> | null;
  }) {
    const shop = await prisma.shop.create({
      data: {
        shopCode: `PD${input.tag}${stamp}`.slice(0, 32),
        shopName: `Delete ${input.tag}`,
        phone: "9876543210",
        address: "Addr",
        isActive: input.isActive ?? false,
        ownerId: input.ownerId === undefined ? (await ownerUser(input.tag)).id : input.ownerId,
        subscription:
          input.subscription === null
            ? undefined
            : { create: input.subscription ?? trialSubscription() },
      },
    });
    shopIds.push(shop.id);
    return shop;
  }

  async function refuse(
    shopId: string,
    shopCode: string,
    body: unknown,
    error: string,
  ) {
    const before = await prisma.adminAuditLog.count({
      where: { targetId: shopId, action: "SHOP_PERMANENTLY_DELETED" },
    });
    const result = await permanentlyDeleteAdminShop({
      adminUserId: admin.id,
      shopId,
      body,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, error);
    }
    const after = await prisma.adminAuditLog.count({
      where: { targetId: shopId, action: "SHOP_PERMANENTLY_DELETED" },
    });
    assert.equal(after, before);
    const still = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, shopCode: true },
    });
    assert.equal(still?.shopCode, shopCode);
    return result;
  }

  const couponWindow = {
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: new Date("2027-01-01T00:00:00.000Z"),
    isActive: true,
  };

  try {
    const active = await makeShop({ tag: "ACT", isActive: true });
    const activePreview = await getPermanentShopDeletePreview(active.id);
    assert.equal(activePreview?.allowed, false);
    assert.equal(activePreview?.blockCode, "SHOP_ACTIVE");
    await refuse(active.id, active.shopCode, { confirmShopCode: active.shopCode }, "SHOP_ACTIVE");
    console.log("A PASS an active shop is refused");

    const wrong = await makeShop({ tag: "WR" });
    await refuse(wrong.id, wrong.shopCode, { confirmShopCode: "NOT-THE-CODE" }, "CONFIRMATION_MISMATCH");
    console.log("B PASS a wrong shop code is refused");

    const missingBody = await makeShop({ tag: "MB" });
    for (const body of [{}, { confirmShopCode: "" }, { confirmShopCode: missingBody.shopCode, extra: true }, { days: 1 }]) {
      await refuse(missingBody.id, missingBody.shopCode, body, "CONFIRMATION_REQUIRED");
    }
    console.log("C PASS missing or extra confirmation is refused");

    const absent = await permanentlyDeleteAdminShop({
      adminUserId: admin.id,
      shopId: "00000000-0000-4000-8000-000000000000",
      body: { confirmShopCode: "MISSING" },
    });
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.equal(absent.status, 404);
    console.log("404 PASS a missing shop is not deleted");

    const billed = await makeShop({ tag: "BIL" });
    const billedPayment = await prisma.billingPayment.create({
      data: {
        shopId: billed.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "FAILED",
        amountInr: 50,
        providerOrderId: `pd-fail-${stamp}`.slice(0, 40),
      },
    });
    await refuse(billed.id, billed.shopCode, { confirmShopCode: billed.shopCode }, "SHOP_HAS_BILLING_PAYMENTS");
    const billedStill = await prisma.billingPayment.findUnique({ where: { id: billedPayment.id } });
    assert.equal(billedStill?.status, "FAILED");
    assert.equal(billedStill?.shopId, billed.id);
    console.log("F PASS any billing payment blocks deletion and the row remains");

    const redeemedOwner = await ownerUser("RED");
    const redeemed = await makeShop({ tag: "RED", ownerId: redeemedOwner.id });
    const globalForRedemption = await prisma.coupon.create({
      data: {
        code: `RD${stamp}`.slice(0, 32),
        type: "FIXED",
        value: 10,
        shopId: null,
        ...couponWindow,
      },
    });
    couponIds.push(globalForRedemption.id);
    const redeemedPayment = await prisma.billingPayment.create({
      data: {
        shopId: redeemed.id,
        provider: "PAYU",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 100,
        providerOrderId: `pd-red-${stamp}`.slice(0, 40),
      },
    });
    const redemption = await prisma.couponRedemption.create({
      data: {
        couponId: globalForRedemption.id,
        shopId: redeemed.id,
        billingPaymentId: redeemedPayment.id,
      },
    });
    await refuse(
      redeemed.id,
      redeemed.shopCode,
      { confirmShopCode: redeemed.shopCode },
      "SHOP_HAS_COUPON_REDEMPTION",
    );
    assert.equal(
      (await prisma.couponRedemption.findUnique({ where: { id: redemption.id } }))?.shopId,
      redeemed.id,
    );
    assert.equal(
      (await prisma.billingPayment.findUnique({ where: { id: redeemedPayment.id } }))?.status,
      "SUCCESS",
    );
    console.log("G PASS a coupon redemption blocks deletion and the ledger remains");
    console.log("V PASS billing payments on a blocked shop remain unchanged");

    const scoped = await makeShop({ tag: "CP" });
    const scopedCoupon = await prisma.coupon.create({
      data: {
        code: `SC${stamp}`.slice(0, 32),
        type: "PERCENT",
        value: 15,
        shopId: scoped.id,
        ...couponWindow,
      },
    });
    couponIds.push(scopedCoupon.id);
    await refuse(scoped.id, scoped.shopCode, { confirmShopCode: scoped.shopCode }, "SHOP_HAS_COUPON");
    assert.equal(
      (await prisma.coupon.findUnique({ where: { id: scopedCoupon.id } }))?.shopId,
      scoped.id,
    );
    console.log("H PASS a shop-scoped coupon blocks deletion and is not made global");

    const premium = await makeShop({
      tag: "PR",
      subscription: trialSubscription({ plan: "PREMIUM", status: "ACTIVE" }),
    });
    await refuse(premium.id, premium.shopCode, { confirmShopCode: premium.shopCode }, "SHOP_HAS_PAID_SUBSCRIPTION");
    console.log("I PASS a Premium subscription blocks deletion");

    const providerBacked = await makeShop({
      tag: "PV",
      subscription: trialSubscription({
        provider: "CASHFREE",
        providerSubscriptionId: `cf-sub-${stamp}`,
      }),
    });
    await refuse(
      providerBacked.id,
      providerBacked.shopCode,
      { confirmShopCode: providerBacked.shopCode },
      "SHOP_HAS_PROVIDER_IDENTITY",
    );
    console.log("J PASS a provider-backed subscription blocks deletion");

    const paidPeriod = await makeShop({
      tag: "PP",
      subscription: trialSubscription({
        currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      }),
    });
    await refuse(
      paidPeriod.id,
      paidPeriod.shopCode,
      { confirmShopCode: paidPeriod.shopCode },
      "SHOP_HAS_PAID_SUBSCRIPTION",
    );
    console.log("K PASS paid period dates block deletion");

    const adminOwner = await ownerUser("AO", "ADMIN");
    const adminOwned = await makeShop({ tag: "AO", ownerId: adminOwner.id });
    await refuse(adminOwned.id, adminOwned.shopCode, { confirmShopCode: adminOwned.shopCode }, "OWNER_IS_ADMIN");
    assert.equal((await prisma.user.findUnique({ where: { id: adminOwner.id } }))?.role, "ADMIN");
    console.log("L PASS an ADMIN owner blocks deletion and the admin user remains");

    const auditedOwner = await ownerUser("AU");
    const audited = await makeShop({ tag: "AU", ownerId: auditedOwner.id });
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: auditedOwner.id,
        action: "COUPON_UPDATED",
        targetType: "Coupon",
      },
    });
    await refuse(audited.id, audited.shopCode, { confirmShopCode: audited.shopCode }, "OWNER_HAS_ADMIN_AUDIT");
    assert.ok(await prisma.user.findUnique({ where: { id: auditedOwner.id } }));
    console.log("M PASS an owner with an admin audit row blocks deletion");

    const unsafe = await makeShop({
      tag: "US",
      subscription: trialSubscription({ status: "PAST_DUE", pastDueSince: new Date("2026-09-01T00:00:00.000Z") }),
    });
    await refuse(unsafe.id, unsafe.shopCode, { confirmShopCode: unsafe.shopCode }, "UNSAFE_SUBSCRIPTION");
    console.log("UNSAFE PASS a past-due subscription blocks deletion");

    const statusShop = await makeShop({ tag: "ST", isActive: true });
    const beforeStatus = await prisma.subscription.findUnique({ where: { shopId: statusShop.id } });
    const extraBody = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: statusShop.id,
      body: { isActive: false, confirmShopCode: statusShop.shopCode },
    });
    assert.equal(extraBody.ok, false);
    assert.equal(
      (await prisma.shop.findUnique({ where: { id: statusShop.id } }))?.isActive,
      true,
    );
    const deactivated = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: statusShop.id,
      body: { isActive: false },
    });
    assert.equal(deactivated.ok, true);
    if (deactivated.ok) assert.equal(deactivated.shop.isActive, false);
    const reactivated = await setAdminShopActive({
      adminUserId: admin.id,
      shopId: statusShop.id,
      body: { isActive: true },
    });
    assert.equal(reactivated.ok, true);
    if (reactivated.ok) assert.equal(reactivated.shop.isActive, true);
    const afterStatus = await prisma.subscription.findUnique({ where: { shopId: statusShop.id } });
    assert.equal(afterStatus?.plan, beforeStatus?.plan);
    assert.equal(afterStatus?.status, beforeStatus?.status);
    assert.equal(afterStatus?.trialEndAt?.toISOString(), beforeStatus?.trialEndAt?.toISOString());
    assert.equal(await prisma.billingPayment.count({ where: { shopId: statusShop.id } }), 0);
    console.log("Z PASS deactivate and reactivate still change only isActive");

    const keeper = await ownerUser("OK");
    await prisma.passwordResetToken.create({
      data: {
        userId: keeper.id,
        tokenHash: `reset-${stamp}`.padEnd(40, "a"),
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
      },
    });
    const success = await makeShop({
      tag: "OK",
      ownerId: keeper.id,
      subscription: trialSubscription({
        provider: "CASHFREE",
        providerSubscriptionId: `PENDING-CHECKOUT:${stamp}`,
      }),
    });
    const device = await prisma.agentDevice.create({
      data: {
        shopId: success.id,
        agentId: `dev-${stamp}`.slice(0, 40),
        tokenHash: "b".repeat(64),
      },
    });
    const printer = await prisma.printer.create({
      data: {
        shopId: success.id,
        agentDeviceId: device.id,
        printerName: "Smoke Printer",
        status: "offline",
      },
    });
    await prisma.agentDevice.update({
      where: { id: device.id },
      data: { localDefaultPrinterId: printer.id },
    });
    await prisma.printPrice.create({
      data: {
        shopId: success.id,
        bwSingle: 5,
        bwDouble: 8,
        colorSingle: 10,
        colorDouble: 15,
        minimumCharge: 5,
      },
    });
    await prisma.inventory.create({ data: { shopId: success.id } });
    await prisma.settings.create({ data: { shopId: success.id } });
    const liveFile = await saveGeneratedPdfFile({
      pdfBytes: Uint8Array.from([37, 80, 68, 70]),
      originalFileName: "live-test.pdf",
      totalPages: 1,
    });
    const expiredFile = await saveGeneratedPdfFile({
      pdfBytes: Uint8Array.from([37, 80, 68, 70, 45]),
      originalFileName: "already-deleted.pdf",
      totalPages: 1,
    });
    leftoverFiles.push(liveFile.storedFileName, expiredFile.storedFileName);
    await prisma.printJob.create({
      data: {
        shopId: success.id,
        jobSequence: 1,
        jobNumber: `PDJ-${stamp}`.slice(0, 32),
        copies: 1,
        totalPages: 4,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: "12.50",
        status: "PENDING",
        files: {
          create: [
            {
              originalFileName: liveFile.originalFileName,
              storedFileName: liveFile.storedFileName,
              fileExtension: liveFile.fileExtension,
              fileSize: liveFile.fileSize,
              totalPages: 1,
            },
            {
              originalFileName: expiredFile.originalFileName,
              storedFileName: expiredFile.storedFileName,
              fileExtension: expiredFile.fileExtension,
              fileSize: expiredFile.fileSize,
              totalPages: 1,
              fileDeletedAt: new Date("2026-09-01T00:00:00.000Z"),
            },
          ],
        },
      },
    });

    const ready = await getPermanentShopDeletePreview(success.id);
    assert.equal(ready?.allowed, true);
    assert.equal(ready?.printJobCount, 1);
    assert.equal(ready?.submittedPageCount, 4);
    assert.equal(ready?.totalPrintPrice, "12.50");

    const globalCoupon = await prisma.coupon.create({
      data: {
        code: `GL${stamp}`.slice(0, 32),
        type: "FIXED",
        value: 5,
        shopId: null,
        ...couponWindow,
      },
    });
    couponIds.push(globalCoupon.id);
    const webhook = await prisma.paymentWebhookEvent.create({
      data: {
        provider: "CASHFREE",
        eventId: `pd-webhook-${stamp}`,
        eventType: "PAYMENT_SUCCESS_WEBHOOK",
        payloadHash: "hash-only",
      },
    });
    webhookIds.push(webhook.id);
    const settingsBefore = await prisma.adminSetting.findUnique({ where: { id: "platform" } });
    const paymentCountBefore = await prisma.billingPayment.count();
    const webhookCountBefore = await prisma.paymentWebhookEvent.count();

    const deleted = await permanentlyDeleteAdminShop({
      adminUserId: admin.id,
      shopId: success.id,
      body: { confirmShopCode: success.shopCode },
    });
    assert.equal(deleted.ok, true);
    if (deleted.ok) {
      assert.equal(deleted.shopId, success.id);
      assert.equal(deleted.shopCode, success.shopCode);
    }
    assert.equal(await prisma.shop.count({ where: { id: success.id } }), 0);
    assert.equal(await prisma.user.count({ where: { id: keeper.id } }), 0);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: keeper.id } }), 0);
    assert.equal(await prisma.agentDevice.count({ where: { shopId: success.id } }), 0);
    assert.equal(await prisma.printer.count({ where: { shopId: success.id } }), 0);
    assert.equal(await prisma.printJob.count({ where: { shopId: success.id } }), 0);
    assert.equal(await prisma.printJobFile.count({ where: { printJob: { shopId: success.id } } }), 0);
    assert.equal(await prisma.subscription.count({ where: { shopId: success.id } }), 0);
    assert.equal(await prisma.printPrice.count({ where: { shopId: success.id } }), 0);
    assert.equal(await prisma.inventory.count({ where: { shopId: success.id } }), 0);
    assert.equal(await prisma.settings.count({ where: { shopId: success.id } }), 0);
    await assert.rejects(() => access(getStoredFilePath(liveFile.storedFileName), constants.F_OK));
    await access(getStoredFilePath(expiredFile.storedFileName), constants.F_OK);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: success.id, action: "SHOP_PERMANENTLY_DELETED" },
    });
    assert.ok(audit);
    const beforeJson = JSON.stringify(audit?.beforeJson ?? {});
    assert.match(beforeJson, new RegExp(success.shopCode));
    assert.doesNotMatch(beforeJson, /passwordHash|tokenHash|agentToken/i);
    assert.deepEqual(audit?.afterJson, { deleted: true });
    const settingsAfter = await prisma.adminSetting.findUnique({ where: { id: "platform" } });
    assert.deepEqual(settingsAfter, settingsBefore);
    assert.equal(
      (await prisma.coupon.findUnique({ where: { id: globalCoupon.id } }))?.shopId,
      null,
    );
    assert.ok(await prisma.paymentWebhookEvent.findUnique({ where: { id: webhook.id } }));
    assert.equal(await prisma.billingPayment.count(), paymentCountBefore);
    assert.equal(await prisma.paymentWebhookEvent.count(), webhookCountBefore);
    console.log("N PASS a deactivated unbacked trial shop is deleted");
    console.log("O PASS a shop with an agent device and printer is deleted");
    console.log("P PASS print jobs and print job files cascade");
    console.log("Q PASS the shopkeeper and password reset token are removed");
    console.log("R PASS the admin audit row remains after deletion");
    console.log("S PASS AdminSetting is unchanged");
    console.log("T PASS a global coupon is unchanged");
    console.log("U PASS payment webhook events are unchanged");
    console.log("W PASS an upload that was still on disk is removed after commit");
    console.log("X PASS a file already marked fileDeletedAt does not fail the delete");

    const overlapOwner = await ownerUser("Y1");
    const overlap = await makeShop({ tag: "Y1", ownerId: overlapOwner.id });
    const [first, second] = await Promise.all([
      permanentlyDeleteAdminShop({
        adminUserId: admin.id,
        shopId: overlap.id,
        body: { confirmShopCode: overlap.shopCode },
      }),
      permanentlyDeleteAdminShop({
        adminUserId: admin.id,
        shopId: overlap.id,
        body: { confirmShopCode: overlap.shopCode },
      }),
    ]);
    const results = [first, second];
    assert.equal(results.filter((item) => item.ok).length, 1);
    const loser = results.find((item) => !item.ok);
    assert.ok(loser);
    if (loser && !loser.ok) assert.equal(loser.status, 404);
    assert.equal(await prisma.shop.count({ where: { id: overlap.id } }), 0);
    assert.equal(
      await prisma.adminAuditLog.count({
        where: { targetId: overlap.id, action: "SHOP_PERMANENTLY_DELETED" },
      }),
      1,
    );
    console.log("Y PASS one overlapping delete succeeds and the other returns 404");
  } finally {
    if (couponIds.length > 0 || shopIds.length > 0) {
      await prisma.couponRedemption.deleteMany({
        where: {
          OR: [
            ...(shopIds.length ? [{ shopId: { in: shopIds } }] : []),
            ...(couponIds.length ? [{ couponId: { in: couponIds } }] : []),
          ],
        },
      });
    }
    if (couponIds.length > 0) {
      await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
    }
    if (shopIds.length > 0) {
      await prisma.billingPayment.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    if (userIds.length > 0) {
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (webhookIds.length > 0) {
      await prisma.paymentWebhookEvent.deleteMany({ where: { id: { in: webhookIds } } });
    }
    for (const storedFileName of leftoverFiles) {
      await deleteStoredUploadFile(storedFileName);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
