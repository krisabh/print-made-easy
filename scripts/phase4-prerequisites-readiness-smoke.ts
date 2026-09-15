/**
 * Phase 4 — prerequisites / Agent readiness UX smoke (logic + copy helpers).
 * Run: npx tsx scripts/phase4-prerequisites-readiness-smoke.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../lib/auth";
import {
  AGENT_OFFLINE_MS,
  generateAgentToken,
  hashAgentToken,
} from "../lib/print-agent-auth";
import { getShopAgentStatus } from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function createShop(code: string, email: string) {
  const passwordHash = await hashPassword("Phase4Smoke!234");
  const user = await prisma.user.create({
    data: {
      name: `Owner ${code}`,
      email,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: code,
          shopName: `4 Shop ${code}`,
          phone: "9000000077",
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

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(
    `4P${stamp}`.slice(0, 12),
    `4p-${stamp.toLowerCase()}@example.com`,
  );

  try {
    // Never connected
    let status = await getShopAgentStatus(shop.id);
    assert.ok(status);
    assert.equal(status!.connected, false);
    assert.equal(status!.lastSeen, null);
    console.log("A PASS never-connected → offline + null lastSeen");

    const tokenA = generateAgentToken();
    const deviceA = await prisma.agentDevice.create({
      data: {
        shopId: shop.id,
        agentId: "PMEA-WINDOWS-4PA",
        tokenHash: hashAgentToken(tokenA),
        lastSeen: new Date(),
      },
    });
    const deviceB = await prisma.agentDevice.create({
      data: {
        shopId: shop.id,
        agentId: "PMEA-WINDOWS-4PB",
        tokenHash: hashAgentToken(generateAgentToken()),
        lastSeen: new Date(Date.now() - AGENT_OFFLINE_MS - 5_000),
      },
    });

    status = await getShopAgentStatus(shop.id);
    assert.equal(status!.connected, true);
    assert.ok(status!.lastSeen);
    console.log("B PASS one fresh + one stale AgentDevice → shop ONLINE");

    await prisma.agentDevice.update({
      where: { id: deviceA.id },
      data: {
        lastSeen: new Date(Date.now() - AGENT_OFFLINE_MS - 5_000),
      },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status!.connected, false);
    assert.ok(status!.lastSeen);
    console.log("C PASS all devices stale → shop OFFLINE (ever connected)");

    await prisma.agentDevice.update({
      where: { id: deviceB.id },
      data: { lastSeen: new Date() },
    });
    status = await getShopAgentStatus(shop.id);
    assert.equal(status!.connected, true);
    console.log("D PASS different device fresh → shop ONLINE again");

    // Threshold unchanged
    assert.equal(AGENT_OFFLINE_MS, 15_000);
    console.log("E PASS AGENT_OFFLINE_MS remains 15s");

    console.log("\nphase4-prerequisites-readiness-smoke: ALL PASS");
  } finally {
    const emails = await prisma.user.findMany({
      where: { email: { startsWith: "4p-" } },
      select: { id: true, shop: { select: { id: true } } },
    });
    const shopIds = emails
      .map((u) => u.shop?.id)
      .filter((id): id is string => Boolean(id));
    if (shopIds.length) {
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
