/**
 * Feature 2 Phase 2C.2 — device-scoped printer discovery/upsert smoke.
 * Run: npx tsx scripts/phase2c2-device-scoped-printer-upsert-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import { hashPassword } from "../lib/auth";
import {
  generateAgentToken,
  hashAgentToken,
} from "../lib/print-agent-auth";
import {
  PrinterOwnershipError,
  upsertShopPrinter,
} from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function createShop(code: string, email: string) {
  const passwordHash = await hashPassword("Phase2C2Smoke!234");
  const user = await prisma.user.create({
    data: {
      name: `Owner ${code}`,
      email,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: code,
          shopName: `2C2 Shop ${code}`,
          phone: "9000000022",
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
      lastSeen: new Date(),
    },
  });
  return { device, token };
}

function heartbeatRequest(token: string, body: unknown) {
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
  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(
    `2C2${stamp}`.slice(0, 12),
    `2c2-${stamp.toLowerCase()}@example.com`,
  );
  const shopOther = await createShop(
    `2CX${stamp}`.slice(0, 12),
    `2c2x-${stamp.toLowerCase()}@example.com`,
  );

  const { device: deviceA, token: tokenA } = await createDevice(
    shop.id,
    "PMEA-WINDOWS-A",
  );
  const { device: deviceB, token: tokenB } = await createDevice(
    shop.id,
    "PMEA-WINDOWS-B",
  );
  const { device: deviceOther } = await createDevice(
    shopOther.id,
    "PMEA-WINDOWS-OTHER",
  );

  // Seed legacy NULL printer that must survive device heartbeats
  const legacyNull = await prisma.printer.create({
    data: {
      shopId: shop.id,
      agentDeviceId: null,
      printerName: "Legacy Null HP",
      colorSupported: true,
      status: "offline",
      isDefault: false,
      printerModel: "LaserJet",
      lastSeen: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const legacySnapshot = { ...legacyNull };

  // Legacy Shop-token Agent
  const legacyToken = generateAgentToken();
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      agentId: "LEGACY-SHOP-AGENT",
      agentTokenHash: hashAgentToken(legacyToken),
      agentLastSeen: new Date(),
    },
  });

  try {
    // A — Device A creates Canon
    const hbA1 = await heartbeatPost(
      heartbeatRequest(tokenA, {
        selectedPrinter: "Canon",
        printerStatus: "online",
        printers: [{ name: "Canon", status: "online" }],
      }),
    );
    assert.equal(hbA1.status, 200);
    const rowA1 = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceA.id,
          printerName: "Canon",
        },
      },
    });
    assert.equal(rowA1.shopId, shop.id);
    assert.equal(rowA1.agentDeviceId, deviceA.id);
    assert.equal(rowA1.status, "online");
    console.log("A PASS AgentDevice A heartbeat creates/updates Printer A");

    // B — Device B creates Canon
    const hbB1 = await heartbeatPost(
      heartbeatRequest(tokenB, {
        selectedPrinter: "Canon",
        printerStatus: "offline",
        printers: [{ name: "Canon", status: "offline" }],
      }),
    );
    assert.equal(hbB1.status, 200);
    const rowB1 = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceB.id,
          printerName: "Canon",
        },
      },
    });
    assert.equal(rowB1.shopId, shop.id);
    assert.equal(rowB1.agentDeviceId, deviceB.id);
    console.log("B PASS AgentDevice B heartbeat creates/updates Printer B");

    // C–E — distinct rows, no overwrite
    assert.notEqual(rowA1.id, rowB1.id);
    assert.equal(rowA1.printerName, "Canon");
    assert.equal(rowB1.printerName, "Canon");
    console.log("C–E PASS A and B both have Canon without overwriting each other");

    // F–G — ownership
    assert.equal(rowA1.agentDeviceId, deviceA.id);
    assert.equal(rowB1.agentDeviceId, deviceB.id);
    assert.equal(rowA1.shopId, deviceA.shopId);
    assert.equal(rowB1.shopId, deviceB.shopId);
    console.log("F–G PASS agentDeviceId + shopId ownership correct");

    // H — cross-shop rejected
    await assert.rejects(
      () =>
        upsertShopPrinter({
          shopId: shop.id,
          agentDeviceId: deviceOther.id,
          printerName: "EvilCross",
          status: "online",
          isDefault: false,
        }),
      (err: unknown) => err instanceof PrinterOwnershipError,
    );
    const crossCount = await prisma.printer.count({
      where: { shopId: shop.id, printerName: "EvilCross" },
    });
    assert.equal(crossCount, 0);
    console.log("H PASS cross-shop printer ownership rejected");

    // Regression: distinct colorSupported + status
    await setDeviceColor(deviceA.id, shop.id, "Canon", true);
    await setDeviceColor(deviceB.id, shop.id, "Canon", false);

    const hbA2 = await heartbeatPost(
      heartbeatRequest(tokenA, {
        printers: [{ name: "Canon", status: "online" }],
      }),
    );
    const hbB2 = await heartbeatPost(
      heartbeatRequest(tokenB, {
        printers: [{ name: "Canon", status: "offline" }],
      }),
    );
    assert.equal(hbA2.status, 200);
    assert.equal(hbB2.status, 200);

    const rowA2 = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceA.id,
          printerName: "Canon",
        },
      },
    });
    const rowB2 = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceB.id,
          printerName: "Canon",
        },
      },
    });
    assert.equal(rowA2.status, "online");
    assert.equal(rowA2.colorSupported, true);
    assert.equal(rowB2.status, "offline");
    assert.equal(rowB2.colorSupported, false);
    assert.equal(rowA2.id, rowA1.id);
    assert.equal(rowB2.id, rowB1.id);
    console.log(
      "I–J + REGRESSION PASS independent status/colorSupported per AgentDevice Canon",
    );

    // K — legacy shop-token still shop-scoped (NULL agentDeviceId)
    const hbLegacy = await heartbeatPost(
      heartbeatRequest(legacyToken, {
        selectedPrinter: "Legacy Shop Epson",
        printerStatus: "online",
        printers: [{ name: "Legacy Shop Epson", status: "online" }],
      }),
    );
    assert.equal(hbLegacy.status, 200);
    const legacyCreated = await prisma.printer.findFirst({
      where: {
        shopId: shop.id,
        printerName: "Legacy Shop Epson",
        agentDeviceId: null,
      },
    });
    assert.ok(legacyCreated);
    assert.equal(legacyCreated!.status, "online");
    // Must not create a device-scoped row for legacy
    const legacyDeviceRows = await prisma.printer.count({
      where: {
        shopId: shop.id,
        printerName: "Legacy Shop Epson",
        agentDeviceId: { not: null },
      },
    });
    assert.equal(legacyDeviceRows, 0);
    console.log("K PASS legacy Shop-token Agent uses shop-scoped NULL behavior");

    // L–M — existing NULL row survives with fields intact
    const nullAfter = await prisma.printer.findUniqueOrThrow({
      where: { id: legacyNull.id },
    });
    assert.equal(nullAfter.agentDeviceId, null);
    assert.equal(nullAfter.printerName, legacySnapshot.printerName);
    assert.equal(nullAfter.colorSupported, legacySnapshot.colorSupported);
    assert.equal(nullAfter.printerModel, legacySnapshot.printerModel);
    assert.equal(nullAfter.status, legacySnapshot.status);
    console.log("L–M PASS legacy NULL printer rows + capability fields survive");

    // Concurrency: parallel upserts same name on two devices
    await Promise.all([
      upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceA.id,
        printerName: "Concurrent Xerox",
        status: "online",
        isDefault: false,
      }),
      upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceB.id,
        printerName: "Concurrent Xerox",
        status: "offline",
        isDefault: false,
      }),
      upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceA.id,
        printerName: "Concurrent Xerox",
        status: "idle",
        isDefault: false,
      }),
    ]);
    const concurrent = await prisma.printer.findMany({
      where: { shopId: shop.id, printerName: "Concurrent Xerox" },
    });
    assert.equal(concurrent.length, 2);
    const byDevice = new Map(
      concurrent.map((p) => [p.agentDeviceId, p] as const),
    );
    assert.ok(byDevice.get(deviceA.id));
    assert.ok(byDevice.get(deviceB.id));
    assert.equal(byDevice.get(deviceA.id)!.status, "idle");
    assert.equal(byDevice.get(deviceB.id)!.status, "offline");
    console.log(
      "CONCURRENCY PASS one row per (agentDeviceId, printerName); both devices retained",
    );

    // Unique constraint present; shop unique gone
    const indexes = await prisma.$queryRawUnsafe<
      Array<{ INDEX_NAME: string }>
    >(`
      SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Printer'
        AND INDEX_NAME IN (
          'Printer_shopId_printerName_key',
          'Printer_agentDeviceId_printerName_key',
          'Printer_shopId_printerName_idx'
        )
      GROUP BY INDEX_NAME
    `);
    const names = new Set(indexes.map((r) => r.INDEX_NAME));
    assert.equal(names.has("Printer_shopId_printerName_key"), false);
    assert.ok(names.has("Printer_agentDeviceId_printerName_key"));
    assert.ok(names.has("Printer_shopId_printerName_idx"));
    console.log("EXTRA PASS shop unique dropped; device unique retained");

    console.log("\nphase2c2-device-scoped-printer-upsert-smoke: ALL PASS");
  } finally {
    const emails = await prisma.user.findMany({
      where: { email: { startsWith: "2c2" } },
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

async function setDeviceColor(
  agentDeviceId: string,
  shopId: string,
  printerName: string,
  colorSupported: boolean,
) {
  await prisma.printer.update({
    where: {
      agentDeviceId_printerName: { agentDeviceId, printerName },
    },
    data: { colorSupported, shopId },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
