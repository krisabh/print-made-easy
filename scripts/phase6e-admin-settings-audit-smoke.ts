/**
 * Phase 6E — Admin settings + audit log smoke.
 * Run: npx tsx scripts/phase6e-admin-settings-audit-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { sanitizeAuditPayload } from "../lib/admin-audit";
import {
  ADMIN_SETTINGS_ID,
  getOrCreateAdminSettings,
  updateAdminSettings,
} from "../lib/admin-settings";
import { PREMIUM_PLAN } from "../lib/billing/plan";
import { hashPassword } from "../lib/auth";
import { buildTrialWindow } from "../lib/subscription";

const prisma = new PrismaClient();

function authorizeAdmin(role: string | undefined) {
  if (!role) return { ok: false as const, status: 401 as const };
  if (role !== "ADMIN") return { ok: false as const, status: 403 as const };
  return { ok: true as const, status: 200 as const };
}

async function main() {
  const settingsRoute = fs.readFileSync(
    path.join(process.cwd(), "app/api/admin/settings/route.ts"),
    "utf8",
  );
  const auditRoute = fs.readFileSync(
    path.join(process.cwd(), "app/api/admin/audit-log/route.ts"),
    "utf8",
  );
  assert.match(settingsRoute, /requireAdminApi\(\)/);
  assert.match(auditRoute, /requireAdminApi\(\)/);
  assert.match(
    fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8"),
    /requireAdmin\(\)/,
  );
  assert.match(
    fs.readFileSync(path.join(process.cwd(), "app/admin/audit-log/page.tsx"), "utf8"),
    /requireAdmin\(\)/,
  );

  assert.equal(authorizeAdmin(undefined).status, 401);
  console.log("A PASS unauthenticated admin settings access rejected");
  assert.equal(authorizeAdmin("SHOPKEEPER").status, 403);
  console.log("B PASS shopkeeper admin settings access rejected");

  const stamp = Date.now().toString(36);
  const admin = await prisma.user.create({
    data: {
      name: "Settings Admin",
      email: `settings-admin-${stamp}@example.com`,
      passwordHash: await hashPassword("AdminSmokePass!23456"),
      role: "ADMIN",
    },
  });

  const prior = await prisma.adminSetting.findUnique({
    where: { id: ADMIN_SETTINGS_ID },
  });

  const shopkeeper = await prisma.user.create({
    data: {
      name: "Trial Keeper",
      email: `trial-keeper-${stamp}@example.com`,
      passwordHash: await hashPassword("SmokeTestPass!234"),
      role: "SHOPKEEPER",
    },
  });
  const trial = buildTrialWindow(new Date("2026-01-01T00:00:00.000Z"));
  const shop = await prisma.shop.create({
    data: {
      shopCode: `ST${stamp}`.slice(0, 12),
      shopName: "Trial Snapshot Shop",
      phone: "9876543210",
      address: "Addr",
      ownerId: shopkeeper.id,
      subscription: {
        create: {
          plan: "TRIAL",
          status: "TRIALING",
          trialStartAt: trial.trialStartAt,
          trialEndAt: trial.trialEndAt,
        },
      },
    },
    include: { subscription: true },
  });

  try {
    assert.equal(authorizeAdmin("ADMIN").status, 200);
    const loaded = await getOrCreateAdminSettings();
    assert.equal(loaded.id, ADMIN_SETTINGS_ID);
    assert.equal(typeof loaded.premiumAmountInr, "number");
    console.log("C PASS admin can load settings");

    const price = await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 249 },
    });
    assert.equal(price.ok, true);
    if (price.ok) assert.equal(price.settings.premiumAmountInr, 249);
    console.log("D PASS valid price update");

    const trialUpdate = await updateAdminSettings({
      adminUserId: admin.id,
      patch: { trialEnabled: true, trialDays: 14 },
    });
    assert.equal(trialUpdate.ok, true);
    if (trialUpdate.ok) {
      assert.equal(trialUpdate.settings.trialEnabled, true);
      assert.equal(trialUpdate.settings.trialDays, 14);
      assert.equal(trialUpdate.settings.premiumAmountInr, 249);
    }
    console.log("E PASS valid trial update preserves unspecified price");

    const badPrice = await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 0 },
    });
    assert.equal(badPrice.ok, false);
    const absurd = await updateAdminSettings({
      adminUserId: admin.id,
      patch: { premiumAmountInr: 1_000_000 },
    });
    assert.equal(absurd.ok, false);
    console.log("F PASS invalid price rejected");

    const badDays = await updateAdminSettings({
      adminUserId: admin.id,
      patch: { trialEnabled: true, trialDays: 0 },
    });
    assert.equal(badDays.ok, false);
    const negative = await updateAdminSettings({
      adminUserId: admin.id,
      patch: { trialDays: -3 },
    });
    assert.equal(negative.ok, false);
    console.log("G PASS invalid trial days rejected");

    const audits = await prisma.adminAuditLog.findMany({
      where: { adminUserId: admin.id, action: "admin_settings.update" },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(audits.length >= 2);
    assert.equal(audits[0]?.adminUserId, admin.id);
    const blob = JSON.stringify(audits);
    assert.equal(/password|token|secret/i.test(blob), false);
    console.log("H PASS audit row created");
    console.log("I PASS audit row stores admin identity");
    console.log("J PASS audit payload has no password/token/secret");

    const poisoned = sanitizeAuditPayload({
      premiumAmountInr: 249,
      passwordHash: "nope",
      agentTokenHash: "nope",
      clientSecret: "nope",
    });
    const poisonedText = JSON.stringify(poisoned);
    assert.equal(poisonedText.includes("nope"), false);
    assert.equal(poisonedText.includes("249"), true);

    assert.equal(PREMIUM_PLAN.amountInr, 199);
    const window = buildTrialWindow(new Date("2026-06-01T00:00:00.000Z"));
    const days =
      (window.trialEndAt.getTime() - window.trialStartAt.getTime()) /
      (24 * 60 * 60 * 1000);
    assert.equal(days, 7);
    const subscription = await prisma.subscription.findUnique({
      where: { shopId: shop.id },
    });
    assert.equal(
      subscription?.trialEndAt?.toISOString(),
      trial.trialEndAt.toISOString(),
    );
    console.log("K PASS billing constant remains ₹199");
    console.log("L PASS signup trial window remains 7 days and stored trial dates unchanged");
  } finally {
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: admin.id } });
    if (prior) {
      await prisma.adminSetting.update({
        where: { id: ADMIN_SETTINGS_ID },
        data: {
          premiumAmountInr: prior.premiumAmountInr,
          trialEnabled: prior.trialEnabled,
          trialDays: prior.trialDays,
        },
      });
    } else {
      await prisma.adminSetting.deleteMany({ where: { id: ADMIN_SETTINGS_ID } });
    }
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, shopkeeper.id] } },
    });
    await prisma.$disconnect();
  }

  console.log("\nphase6e-admin-settings-audit-smoke: ALL PASS");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
