/**
 * Feature 2 Phase 2D — device-aware heartbeat / shop online aggregate smoke.
 * Run: npx tsx scripts/phase2d-device-heartbeat-status-smoke.ts
 *
 * Stale threshold: AGENT_OFFLINE_MS (15_000). isAgentOnline uses ageMs <= threshold.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import { hashPassword } from "../lib/auth";
import {
  AGENT_OFFLINE_MS,
  generateAgentToken,
  hashAgentToken,
  isAgentOnline,
  resolveAgentAuth,
} from "../lib/print-agent-auth";
import { getShopAgentStatus } from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function createShop(code: string, email: string) {
  const passwordHash = await hashPassword("Phase2DSmoke!234");
  const user = await prisma.user.create({
    data: {
      name: `Owner ${code}`,
      email,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: code,
          shopName: `2D Shop ${code}`,
          phone: "9000000044",
          address: "Test",
          isActive: true,
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
  assert.ok(user.shop);
  return user.shop!;
}

async function createDevice(shopId: string, agentId: string) {
  const token = generateAgentToken();
  const device = await prisma.agentDevice.create({
    data: {
      shopId,
      agentId,
      tokenHash: hashAgentToken(token),
      lastSeen: null,
    },
  });
  return { device, token };
}

function heartbeatRequest(token: string, body: unknown = {}) {
  return new NextRequest("http://localhost/api/print-agent/heartbeat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  assert.equal(AGENT_OFFLINE_MS, 15_000);

  // Threshold boundary (JS helper — exact ms convention)
  const now = new Date();
  assert.equal(
    isAgentOnline(new Date(now.getTime() - AGENT_OFFLINE_MS), now),
    true,
    "age == AGENT_OFFLINE_MS → ONLINE",
  );
  assert.equal(
    isAgentOnline(new Date(now.getTime() - (AGENT_OFFLINE_MS + 1)), now),
    false,
    "age == AGENT_OFFLINE_MS + 1 → OFFLINE",
  );
  console.log(
    "THRESHOLD PASS ageMs <= AGENT_OFFLINE_MS online; +1ms offline (isAgentOnline)",
  );

  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(
    `2D${stamp}`.slice(0, 12),
    `2d-${stamp.toLowerCase()}@example.com`,
  );

  const { device: deviceA, token: tokenA } = await createDevice(
    shop.id,
    "PMEA-WINDOWS-A",
  );
  const { device: deviceB, token: tokenB } = await createDevice(
    shop.id,
    "PMEA-WINDOWS-B",
  );

  const legacyToken = generateAgentToken();
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      agentId: "LEGACY-SHOP-AGENT",
      agentTokenHash: hashAgentToken(legacyToken),
      agentLastSeen: null,
    },
  });

  try {
    // A — Device A heartbeat updates A.lastSeen only
    const beforeB = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    const shopBeforeA = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
      select: { agentLastSeen: true },
    });

    const hbA = await heartbeatPost(heartbeatRequest(tokenA));
    assert.equal(hbA.status, 200);

    const afterA = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    const afterB = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    const shopAfterA = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
      select: { agentLastSeen: true },
    });
    assert.ok(afterA.lastSeen);
    assert.equal(afterB.lastSeen?.toISOString() ?? null, beforeB.lastSeen?.toISOString() ?? null);
    assert.equal(
      shopAfterA.agentLastSeen?.toISOString() ?? null,
      shopBeforeA.agentLastSeen?.toISOString() ?? null,
    );
    console.log("A+C PASS Device A heartbeat updates A only (not B, not Shop.agentLastSeen)");

    // B — Device B heartbeat updates B only
    const aSnapshot = afterA.lastSeen!.toISOString();
    await new Promise((r) => setTimeout(r, 20));
    const hbB = await heartbeatPost(heartbeatRequest(tokenB));
    assert.equal(hbB.status, 200);
    const afterA2 = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    const afterB2 = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(afterA2.lastSeen!.toISOString(), aSnapshot);
    assert.ok(afterB2.lastSeen);
    console.log("B+D PASS Device B heartbeat updates B only");

    // E–F — one or multiple fresh → ONLINE
    let status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, true);
    console.log("E–F PASS fresh AgentDevice(s) → Shop ONLINE");

    // G — one fresh + one stale → ONLINE
    await prisma.agentDevice.update({
      where: { id: deviceB.id },
      data: { lastSeen: new Date(Date.now() - 60_000) },
    });
    await prisma.agentDevice.update({
      where: { id: deviceA.id },
      data: { lastSeen: new Date() },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, true);
    console.log("G PASS one fresh + one stale → Shop ONLINE");

    // H — all devices stale → OFFLINE (legacy also null/stale)
    await prisma.agentDevice.updateMany({
      where: { shopId: shop.id },
      data: { lastSeen: new Date(Date.now() - 60_000) },
    });
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date(Date.now() - 60_000) },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, false);
    console.log("H PASS all AgentDevices stale → Shop OFFLINE");

    // I — no devices fresh, fresh legacy → ONLINE
    await prisma.agentDevice.deleteMany({ where: { shopId: shop.id } });
    // recreate tokens after delete — need new devices for later tests? recreate after I-J
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date() },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, true);
    console.log("I PASS no AgentDevices + fresh legacy → ONLINE");

    // J — no devices + stale legacy → OFFLINE
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date(Date.now() - 60_000) },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, false);
    console.log("J PASS no AgentDevices + stale legacy → OFFLINE");

    // Recreate devices for K
    const reA = await createDevice(shop.id, "PMEA-WINDOWS-A");
    const reB = await createDevice(shop.id, "PMEA-WINDOWS-B");
    await prisma.agentDevice.updateMany({
      where: { shopId: shop.id },
      data: { lastSeen: new Date(Date.now() - 60_000) },
    });
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date() },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, true);
    console.log("K PASS devices stale + fresh legacy → ONLINE");

    // L — legacy heartbeat updates Shop.agentLastSeen (not devices)
    const devicesBeforeLegacy = await prisma.agentDevice.findMany({
      where: { shopId: shop.id },
      select: { id: true, lastSeen: true },
    });
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date(Date.now() - 60_000) },
    });
    const hbLegacy = await heartbeatPost(heartbeatRequest(legacyToken));
    assert.equal(hbLegacy.status, 200);
    const shopAfterLegacy = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
      select: { agentLastSeen: true },
    });
    assert.ok(shopAfterLegacy.agentLastSeen);
    assert.ok(
      Date.now() - shopAfterLegacy.agentLastSeen!.getTime() < 5_000,
    );
    const devicesAfterLegacy = await prisma.agentDevice.findMany({
      where: { shopId: shop.id },
      select: { id: true, lastSeen: true },
    });
    for (const before of devicesBeforeLegacy) {
      const after = devicesAfterLegacy.find((d) => d.id === before.id);
      assert.equal(
        after?.lastSeen?.toISOString() ?? null,
        before.lastSeen?.toISOString() ?? null,
      );
    }
    console.log("L PASS legacy heartbeat updates Shop.agentLastSeen only");

    // M — legacy auth still works
    const legacyAuth = await resolveAgentAuth(legacyToken);
    assert.ok(legacyAuth);
    assert.equal(legacyAuth!.legacy, true);
    assert.equal(legacyAuth!.shop.id, shop.id);
    console.log("M PASS legacy Agent continues to authenticate");

    // N — customer readiness uses shop aggregate (connected flag shape unchanged)
    status = await getShopAgentStatus(shop.id);
    assert.equal(typeof status?.connected, "boolean");
    assert.ok("lastSeen" in (status || {}));
    assert.ok("printerOffline" in (status || {}));
    // Fresh legacy from L → connected
    assert.equal(status?.connected, true);
    console.log("N PASS customer/dashboard status shape + aggregate connected");

    // Concurrency: A and B heartbeat together
    await Promise.all([
      heartbeatPost(heartbeatRequest(reA.token)),
      heartbeatPost(heartbeatRequest(reB.token)),
    ]);
    const concurrentA = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: reA.device.id },
    });
    const concurrentB = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: reB.device.id },
    });
    assert.ok(concurrentA.lastSeen);
    assert.ok(concurrentB.lastSeen);
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, true);

    await prisma.agentDevice.updateMany({
      where: { shopId: shop.id },
      data: { lastSeen: new Date(Date.now() - 60_000) },
    });
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date(Date.now() - 60_000) },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, false);
    console.log("CONCURRENCY PASS independent lastSeen; both stale → OFFLINE");

    // Device count alone must not imply online
    await prisma.agentDevice.updateMany({
      where: { shopId: shop.id },
      data: { lastSeen: null },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status?.connected, false);
    console.log("EXTRA PASS device count > 0 with null lastSeen → OFFLINE");

    console.log("\nphase2d-device-heartbeat-status-smoke: ALL PASS");
  } finally {
    const emails = await prisma.user.findMany({
      where: { email: { startsWith: "2d-" } },
      select: { id: true, shop: { select: { id: true } } },
    });
    const shopIds = emails
      .map((u) => u.shop?.id)
      .filter((id): id is string => Boolean(id));
    if (shopIds.length) {
      await prisma.agentDevice.updateMany({
        where: { shopId: { in: shopIds } },
        data: { localDefaultPrinterId: null },
      });
      await prisma.printer.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.agentDevice.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.printPrice.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.settings.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.inventory.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.subscription.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
      await prisma.user.deleteMany({
        where: { id: { in: emails.map((u) => u.id) } },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
