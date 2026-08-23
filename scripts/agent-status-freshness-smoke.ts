/**
 * Agent/printer dashboard freshness smoke tests.
 * Run: npx tsx scripts/agent-status-freshness-smoke.ts
 *
 * Uses AGENT_OFFLINE_MS (15s, 3 missed 5s heartbeats) — not the 1-hour file TTL.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import {
  AGENT_CLOCK_SKEW_MS,
  AGENT_OFFLINE_MS,
  DOCUMENT_RETENTION_MS,
  isAgentOnline,
  isReportedPrinterOnline,
} from "../lib/print-agent-auth";
import {
  getShopAgentStatus,
  listShopPrintersWithLiveStatus,
} from "../lib/print-agent-service";

const prisma = new PrismaClient();

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `Status Shop ${code}`,
      phone: "9000000000",
      address: "Test",
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
    },
  });
}

async function main() {
  assert.equal(AGENT_OFFLINE_MS, 15_000);
  assert.ok(DOCUMENT_RETENTION_MS > AGENT_OFFLINE_MS);
  assert.ok(AGENT_CLOCK_SKEW_MS < AGENT_OFFLINE_MS);

  const now = new Date();
  assert.equal(isAgentOnline(null, now), false);
  assert.equal(isAgentOnline(new Date(now.getTime() - 5_000), now), true);
  assert.equal(isAgentOnline(new Date(now.getTime() - 16_000), now), false);
  assert.equal(
    isAgentOnline(new Date(now.getTime() + 6 * 60 * 60 * 1000), now),
    false,
  );
  assert.equal(isReportedPrinterOnline("online"), true);
  assert.equal(isReportedPrinterOnline("Idle"), true);
  assert.equal(isReportedPrinterOnline("unknown"), false);
  assert.equal(isReportedPrinterOnline("offline"), false);
  assert.equal(isReportedPrinterOnline(null), false);

  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(`ST${stamp}`.slice(0, 12));

  try {
    // Paired record with no recent heartbeat is Offline.
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        agentId: `${shop.shopCode}-AGENT`,
        agentLastSeen: new Date(Date.now() - 60_000),
      },
    });
    await prisma.printer.create({
      data: {
        shopId: shop.id,
        printerName: "Canon Test",
        status: "online",
        isDefault: true,
        lastSeen: new Date(Date.now() - 60_000),
      },
    });

    const stale = await getShopAgentStatus(shop.id);
    assert.equal(stale?.connected, false);
    assert.equal(stale?.printerOffline, true);
    assert.equal(stale?.printerStatus, "offline");

    const staleList = await listShopPrintersWithLiveStatus(shop.id);
    assert.equal(staleList[0]?.status, "offline");

    // Fresh heartbeat + offline printer report.
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date() },
    });
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { status: "offline", lastSeen: new Date() },
    });
    const agentOnly = await getShopAgentStatus(shop.id);
    assert.equal(agentOnly?.connected, true);
    assert.equal(agentOnly?.printerOffline, true);
    assert.equal(agentOnly?.printerStatus, "offline");

    // Fresh heartbeat + unknown printer is not Connected.
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { status: "unknown", lastSeen: new Date() },
    });
    const unknownPrinter = await getShopAgentStatus(shop.id);
    assert.equal(unknownPrinter?.connected, true);
    assert.equal(unknownPrinter?.printerOffline, true);

    // Fresh heartbeat + online printer.
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { status: "online", lastSeen: new Date() },
    });
    const bothOnline = await getShopAgentStatus(shop.id);
    assert.equal(bothOnline?.connected, true);
    assert.equal(bothOnline?.printerOffline, false);
    assert.equal(bothOnline?.printerStatus, "online");
    assert.equal(bothOnline?.printerName, "Canon Test");

    const liveList = await listShopPrintersWithLiveStatus(shop.id);
    assert.equal(liveList[0]?.status, "online");

    // Agent online but printer lastSeen stale → printer Offline.
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { status: "online", lastSeen: new Date(Date.now() - 60_000) },
    });
    const stalePrinter = await getShopAgentStatus(shop.id);
    assert.equal(stalePrinter?.connected, true);
    assert.equal(stalePrinter?.printerOffline, true);

    // Stopped agent after being online: stale lastSeen → both Offline.
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date(Date.now() - 60_000) },
    });
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { status: "online", lastSeen: new Date(Date.now() - 60_000) },
    });
    const stopped = await getShopAgentStatus(shop.id);
    assert.equal(stopped?.connected, false);
    assert.equal(stopped?.printerOffline, true);
    assert.ok(stopped?.agentId);

    console.log("agent-status-freshness-smoke: ok");
  } finally {
    await prisma.printer.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
