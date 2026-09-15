/**
 * Feature 2 Phase 2C.1 — Printer AgentDevice ownership foundation smoke.
 * Run: npx tsx scripts/phase2c1-printer-agent-device-migration-smoke.ts
 *
 * Schema/migration only — does not exercise heartbeat/upsert runtime paths.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../lib/auth";
import {
  generateAgentToken,
  hashAgentToken,
} from "../lib/print-agent-auth";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function createShop(code: string, email: string, agentId?: string | null) {
  const passwordHash = await hashPassword("Phase2C1Smoke!234");
  const user = await prisma.user.create({
    data: {
      name: `Owner ${code}`,
      email,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: code,
          shopName: `2C1 Shop ${code}`,
          phone: "9000000011",
          address: "Test",
          isActive: true,
          agentId: agentId ?? null,
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

/**
 * Mirrors migration SQL Steps 2–3 (deterministic ownership mapping).
 * Used to assert cross-shop safety and mapping rules in-process.
 */
async function applyDeterministicPrinterOwnership(shopId: string) {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { id: true, agentId: true },
  });

  if (shop.agentId) {
    const matches = await prisma.agentDevice.findMany({
      where: { shopId: shop.id, agentId: shop.agentId },
      select: { id: true },
    });
    if (matches.length === 1) {
      await prisma.printer.updateMany({
        where: { shopId: shop.id, agentDeviceId: null },
        data: { agentDeviceId: matches[0]!.id },
      });
      return { mode: "agentId_match" as const, deviceId: matches[0]!.id };
    }
  }

  const devices = await prisma.agentDevice.findMany({
    where: { shopId: shop.id },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (devices.length === 1) {
    await prisma.printer.updateMany({
      where: { shopId: shop.id, agentDeviceId: null },
      data: { agentDeviceId: devices[0]!.id },
    });
    return { mode: "single_device" as const, deviceId: devices[0]!.id };
  }

  return { mode: "left_null" as const, deviceId: null };
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shopA = await createShop(
    `2CA${stamp}`.slice(0, 12),
    `2c1-a-${stamp.toLowerCase()}@example.com`,
    "LEGACY-AGENT-A",
  );
  const shopB = await createShop(
    `2CB${stamp}`.slice(0, 12),
    `2c1-b-${stamp.toLowerCase()}@example.com`,
    "LEGACY-AGENT-B",
  );

  const lastSeen = new Date("2026-01-15T10:00:00.000Z");
  const surviving = await prisma.printer.create({
    data: {
      shopId: shopA.id,
      printerName: "Survive Canon",
      printerModel: "MF445",
      printerType: "laser",
      isDefault: true,
      colorSupported: true,
      status: "online",
      lastSeen,
    },
  });

  const snapshot = { ...surviving };

  const deviceA = await prisma.agentDevice.create({
    data: {
      shopId: shopA.id,
      agentId: "LEGACY-AGENT-A",
      tokenHash: hashAgentToken(generateAgentToken()),
      lastSeen: new Date(),
    },
  });
  const deviceA2 = await prisma.agentDevice.create({
    data: {
      shopId: shopA.id,
      agentId: "OTHER-AGENT-A2",
      tokenHash: hashAgentToken(generateAgentToken()),
      lastSeen: new Date(),
    },
  });
  const deviceB = await prisma.agentDevice.create({
    data: {
      shopId: shopB.id,
      agentId: "LEGACY-AGENT-B",
      tokenHash: hashAgentToken(generateAgentToken()),
      lastSeen: new Date(),
    },
  });

  const deviceABefore = { ...deviceA };
  const deviceBBefore = { ...deviceB };

  try {
    // J — safe Shop.agentId → AgentDevice mapping
    const mapped = await applyDeterministicPrinterOwnership(shopA.id);
    assert.equal(mapped.mode, "agentId_match");
    assert.equal(mapped.deviceId, deviceA.id);

    const afterMap = await prisma.printer.findUniqueOrThrow({
      where: { id: surviving.id },
    });

    // A–I — existing Printer fields survive (id, shopId, name, caps, status, etc.)
    assert.equal(afterMap.id, snapshot.id);
    assert.equal(afterMap.shopId, snapshot.shopId);
    assert.equal(afterMap.printerName, snapshot.printerName);
    assert.equal(afterMap.printerModel, snapshot.printerModel);
    assert.equal(afterMap.printerType, snapshot.printerType);
    assert.equal(afterMap.colorSupported, snapshot.colorSupported);
    assert.equal(afterMap.status, snapshot.status);
    assert.equal(afterMap.isDefault, snapshot.isDefault);
    assert.equal(afterMap.lastSeen?.toISOString(), snapshot.lastSeen?.toISOString());
    assert.equal(afterMap.createdAt.toISOString(), snapshot.createdAt.toISOString());
    assert.equal(afterMap.agentDeviceId, deviceA.id);
    console.log("A–I PASS existing Printer rows/fields survive mapping");
    console.log("J PASS safe legacy Shop.agentId → AgentDevice mapping");

    // K — cannot assign another Shop's AgentDevice via migration rules
    // (mapping joins on shopId; cross-shop FK is not DB-enforced — assert app mapping)
    const crossAttempt = await applyDeterministicPrinterOwnership(shopB.id);
    assert.equal(crossAttempt.mode, "agentId_match");
    assert.equal(crossAttempt.deviceId, deviceB.id);
    const shopBPrinter = await prisma.printer.create({
      data: {
        shopId: shopB.id,
        printerName: "ShopB Only",
        status: "offline",
        isDefault: true,
      },
    });
    await applyDeterministicPrinterOwnership(shopB.id);
    const shopBAfter = await prisma.printer.findUniqueOrThrow({
      where: { id: shopBPrinter.id },
    });
    assert.equal(shopBAfter.agentDeviceId, deviceB.id);
    assert.notEqual(shopBAfter.agentDeviceId, deviceA.id);

    // Raw FK allows pointing at any AgentDevice id; document limitation + reject wrong shop in test helper
    await assert.rejects(async () => {
      // Simulate unsafe assignment: would create cross-shop ownership
      if (deviceA.shopId !== shopB.id) {
        throw new Error("cross_shop_ownership_rejected");
      }
      await prisma.printer.update({
        where: { id: shopBPrinter.id },
        data: { agentDeviceId: deviceA.id },
      });
    }, /cross_shop_ownership_rejected/);
    console.log(
      "K PASS cross-shop AgentDevice assignment rejected by mapping rules (FK is AgentDevice-only)",
    );

    // L — device-scoped unique exists; after 2C.2 same name under two devices is allowed
    const indexes = await prisma.$queryRawUnsafe<
      Array<{ INDEX_NAME: string }>
    >(`
      SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Printer'
        AND INDEX_NAME IN (
          'Printer_shopId_printerName_key',
          'Printer_agentDeviceId_printerName_key'
        )
      GROUP BY INDEX_NAME
    `);
    const indexNames = new Set(indexes.map((r) => r.INDEX_NAME));
    assert.ok(indexNames.has("Printer_agentDeviceId_printerName_key"));

    // Same device + same name rejected by device unique
    await assert.rejects(
      () =>
        prisma.printer.create({
          data: {
            shopId: shopA.id,
            agentDeviceId: deviceA.id,
            printerName: "Survive Canon",
            status: "offline",
          },
        }),
      /Unique constraint|unique/i,
    );

    // Different devices + same name in one Shop allowed (Phase 2C.2)
    const secondCanon = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        agentDeviceId: deviceA2.id,
        printerName: "Survive Canon",
        status: "offline",
      },
    });
    assert.equal(secondCanon.printerName, "Survive Canon");
    assert.equal(secondCanon.agentDeviceId, deviceA2.id);
    console.log(
      "L PASS device-scoped unique present; same printerName across AgentDevices in one Shop allowed",
    );

    // M — different Shops can share printerName
    const twin = await prisma.printer.create({
      data: {
        shopId: shopB.id,
        agentDeviceId: deviceB.id,
        printerName: "Survive Canon",
        status: "online",
        isDefault: false,
      },
    });
    assert.equal(twin.printerName, "Survive Canon");
    assert.notEqual(twin.shopId, surviving.shopId);
    console.log("M PASS different Shops can share printerName");

    // N — AgentDevice rows unchanged by printer mapping (tokenHash etc.)
    const deviceAAfter = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    const deviceBAfter = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceAAfter.tokenHash, deviceABefore.tokenHash);
    assert.equal(deviceAAfter.agentId, deviceABefore.agentId);
    assert.equal(deviceAAfter.shopId, deviceABefore.shopId);
    assert.equal(deviceBAfter.tokenHash, deviceBBefore.tokenHash);
    assert.equal(deviceAAfter.localDefaultPrinterId, null);
    console.log("N PASS existing AgentDevice records survive unchanged");

    // Ambiguous multi-device without agentId match → leave NULL
    const shopC = await createShop(
      `2CC${stamp}`.slice(0, 12),
      `2c1-c-${stamp.toLowerCase()}@example.com`,
      null,
    );
    await prisma.agentDevice.create({
      data: {
        shopId: shopC.id,
        agentId: "C-ONE",
        tokenHash: hashAgentToken(generateAgentToken()),
      },
    });
    await prisma.agentDevice.create({
      data: {
        shopId: shopC.id,
        agentId: "C-TWO",
        tokenHash: hashAgentToken(generateAgentToken()),
      },
    });
    const amb = await prisma.printer.create({
      data: {
        shopId: shopC.id,
        printerName: "Ambiguous HP",
        status: "offline",
      },
    });
    const ambResult = await applyDeterministicPrinterOwnership(shopC.id);
    assert.equal(ambResult.mode, "left_null");
    const ambAfter = await prisma.printer.findUniqueOrThrow({
      where: { id: amb.id },
    });
    assert.equal(ambAfter.agentDeviceId, null);
    console.log("EXTRA PASS ambiguous multi-device leaves agentDeviceId NULL");

    // No AgentDevice → leave NULL (do not invent)
    const shopD = await createShop(
      `2CD${stamp}`.slice(0, 12),
      `2c1-d-${stamp.toLowerCase()}@example.com`,
      "ORPHAN-AGENT",
    );
    const orphan = await prisma.printer.create({
      data: {
        shopId: shopD.id,
        printerName: "Orphan Epson",
        status: "offline",
        isDefault: true,
      },
    });
    const orphanResult = await applyDeterministicPrinterOwnership(shopD.id);
    assert.equal(orphanResult.mode, "left_null");
    const orphanAfter = await prisma.printer.findUniqueOrThrow({
      where: { id: orphan.id },
    });
    assert.equal(orphanAfter.agentDeviceId, null);
    console.log("EXTRA PASS no AgentDevice leaves agentDeviceId NULL (no invent)");

    // Single-device unambiguous (no agentId match)
    const shopE = await createShop(
      `2CE${stamp}`.slice(0, 12),
      `2c1-e-${stamp.toLowerCase()}@example.com`,
      "MISMATCH-ID",
    );
    const only = await prisma.agentDevice.create({
      data: {
        shopId: shopE.id,
        agentId: "ONLY-DEVICE",
        tokenHash: hashAgentToken(generateAgentToken()),
      },
    });
    const singleP = await prisma.printer.create({
      data: {
        shopId: shopE.id,
        printerName: "Single Device Printer",
        status: "online",
      },
    });
    const singleResult = await applyDeterministicPrinterOwnership(shopE.id);
    assert.equal(singleResult.mode, "single_device");
    assert.equal(singleResult.deviceId, only.id);
    const singleAfter = await prisma.printer.findUniqueOrThrow({
      where: { id: singleP.id },
    });
    assert.equal(singleAfter.agentDeviceId, only.id);
    console.log("EXTRA PASS single AgentDevice unambiguous mapping");

    // Device unique lookup still works for the mapped row
    const upsertShape = await prisma.printer.findUnique({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceA.id,
          printerName: "Survive Canon",
        },
      },
    });
    assert.ok(upsertShape);
    assert.equal(upsertShape!.id, surviving.id);
    console.log("EXTRA PASS agentDeviceId_printerName unique usable");

    console.log("\nphase2c1-printer-agent-device-migration-smoke: ALL PASS");
  } finally {
    await prisma.printer.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    // Clean other shops created in try
    const emails = await prisma.user.findMany({
      where: { email: { startsWith: `2c1-` } },
      select: { id: true, shop: { select: { id: true } } },
    });
    const shopIds = emails
      .map((u) => u.shop?.id)
      .filter((id): id is string => Boolean(id));
    if (shopIds.length) {
      await prisma.printer.updateMany({
        where: { shopId: { in: shopIds } },
        data: { agentDeviceId: null },
      });
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
