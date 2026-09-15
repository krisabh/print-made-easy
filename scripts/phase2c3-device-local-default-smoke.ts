/**
 * Feature 2 Phase 2C.3 — device-local default printer smoke.
 * Run: npx tsx scripts/phase2c3-device-local-default-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import { POST as loginPost } from "../app/api/print-agent/login/route";
import { hashPassword } from "../lib/auth";
import {
  generateAgentToken,
  hashAgentToken,
} from "../lib/print-agent-auth";
import {
  PrinterOwnershipError,
  setAgentDeviceLocalDefault,
  upsertShopPrinter,
} from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();
const PASSWORD = "Phase2C3Smoke!234";

async function createShop(code: string, email: string) {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: {
      name: `Owner ${code}`,
      email,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: code,
          shopName: `2C3 Shop ${code}`,
          phone: "9000000033",
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
  return { user, shop: user.shop! };
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
  const email = `2c3-${stamp.toLowerCase()}@example.com`;
  const { shop } = await createShop(`2C3${stamp}`.slice(0, 12), email);
  const { shop: shopOther } = await createShop(
    `2CY${stamp}`.slice(0, 12),
    `2c3y-${stamp.toLowerCase()}@example.com`,
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
    // Seed printers on each device (including same name Canon)
    const hbASeed = await heartbeatPost(
      heartbeatRequest(tokenA, {
        selectedPrinter: "Canon",
        printerStatus: "online",
        printers: [
          { name: "Canon", status: "online" },
          { name: "HP", status: "online" },
        ],
      }),
    );
    assert.equal(hbASeed.status, 200);

    const hbBSeed = await heartbeatPost(
      heartbeatRequest(tokenB, {
        selectedPrinter: "Epson",
        printerStatus: "online",
        printers: [
          { name: "Canon", status: "online" },
          { name: "Epson", status: "online" },
        ],
      }),
    );
    assert.equal(hbBSeed.status, 200);

    const canonA = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceA.id,
          printerName: "Canon",
        },
      },
    });
    const hpA = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceA.id,
          printerName: "HP",
        },
      },
    });
    const canonB = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceB.id,
          printerName: "Canon",
        },
      },
    });
    const epsonB = await prisma.printer.findUniqueOrThrow({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId: deviceB.id,
          printerName: "Epson",
        },
      },
    });

    // A–D — local defaults from selectedPrinter
    let deviceARow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    let deviceBRow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceARow.localDefaultPrinterId, canonA.id);
    assert.equal(deviceBRow.localDefaultPrinterId, epsonB.id);
    console.log("A–D PASS device A default Canon; device B default Epson");

    // E — change A's default to HP without changing B
    const hbA2 = await heartbeatPost(
      heartbeatRequest(tokenA, {
        selectedPrinter: "HP",
        printerStatus: "online",
        printers: [
          { name: "Canon", status: "online" },
          { name: "HP", status: "online" },
        ],
      }),
    );
    assert.equal(hbA2.status, 200);
    deviceARow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    deviceBRow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceARow.localDefaultPrinterId, hpA.id);
    assert.equal(deviceBRow.localDefaultPrinterId, epsonB.id);
    console.log("E PASS changing A default does not change B");

    // F — change B to Canon; A stays HP
    const hbB2 = await heartbeatPost(
      heartbeatRequest(tokenB, {
        selectedPrinter: "Canon",
        printerStatus: "online",
        printers: [
          { name: "Canon", status: "online" },
          { name: "Epson", status: "online" },
        ],
      }),
    );
    assert.equal(hbB2.status, 200);
    deviceARow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    deviceBRow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceARow.localDefaultPrinterId, hpA.id);
    assert.equal(deviceBRow.localDefaultPrinterId, canonB.id);
    console.log("F PASS changing B default does not change A");

    // G–H — cannot select sibling device printer
    await assert.rejects(
      () =>
        setAgentDeviceLocalDefault({
          shopId: shop.id,
          agentDeviceId: deviceA.id,
          printerId: epsonB.id,
        }),
      (err: unknown) => err instanceof PrinterOwnershipError,
    );
    await assert.rejects(
      () =>
        setAgentDeviceLocalDefault({
          shopId: shop.id,
          agentDeviceId: deviceB.id,
          printerId: hpA.id,
        }),
      (err: unknown) => err instanceof PrinterOwnershipError,
    );
    deviceARow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    deviceBRow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceARow.localDefaultPrinterId, hpA.id);
    assert.equal(deviceBRow.localDefaultPrinterId, canonB.id);
    console.log("G–H PASS cannot select printer owned by the other device");

    // I — cross-shop rejected
    const otherPrinter = await prisma.printer.create({
      data: {
        shopId: shopOther.id,
        agentDeviceId: deviceOther.id,
        printerName: "Alien",
        status: "online",
        isDefault: false,
      },
    });
    await assert.rejects(
      () =>
        setAgentDeviceLocalDefault({
          shopId: shop.id,
          agentDeviceId: deviceA.id,
          printerId: otherPrinter.id,
        }),
      (err: unknown) => err instanceof PrinterOwnershipError,
    );
    console.log("I PASS cross-shop printer selection rejected");

    // J — heartbeat capability list reflects device-local isDefault for Agent UI
    const hbCaps = await heartbeatPost(
      heartbeatRequest(tokenA, {
        selectedPrinter: "HP",
        printers: [
          { name: "Canon", status: "online" },
          { name: "HP", status: "online" },
        ],
      }),
    );
    const capsBody = (await hbCaps.json()) as {
      printers?: Array<{ printerName: string; isDefault: boolean }>;
    };
    const hpCap = capsBody.printers?.find((p) => p.printerName === "HP");
    const canonCap = capsBody.printers?.find((p) => p.printerName === "Canon");
    assert.equal(hpCap?.isDefault, true);
    assert.equal(canonCap?.isDefault, false);
    console.log("J PASS Agent capability list uses device-local default");

    // K–L — legacy Shop-token still uses Printer.isDefault shop-wide
    const hbLegacy = await heartbeatPost(
      heartbeatRequest(legacyToken, {
        selectedPrinter: "Legacy Default",
        printerStatus: "online",
        printers: [{ name: "Legacy Default", status: "online" }],
      }),
    );
    assert.equal(hbLegacy.status, 200);
    const legacyPrinter = await prisma.printer.findFirstOrThrow({
      where: {
        shopId: shop.id,
        printerName: "Legacy Default",
        agentDeviceId: null,
      },
    });
    assert.equal(legacyPrinter.isDefault, true);
    // Device local defaults unchanged
    deviceARow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    deviceBRow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceARow.localDefaultPrinterId, hpA.id);
    assert.equal(deviceBRow.localDefaultPrinterId, canonB.id);
    // Device printers must not have been cleared by legacy shop-wide default
    assert.equal(canonA.isDefault, false);
    assert.equal(
      (
        await prisma.printer.findUniqueOrThrow({ where: { id: hpA.id } })
      ).isDefault,
      false,
    );
    console.log("K–L PASS legacy isDefault still works; devices untouched");

    // M — local default survives token rotation (relogin same agentId)
    const beforeRelogin = deviceARow.localDefaultPrinterId;
    const loginRes = await loginPost(
      new NextRequest("http://localhost/api/print-agent/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: PASSWORD,
          agentId: "PMEA-WINDOWS-A",
        }),
      }),
    );
    assert.equal(loginRes.status, 200);
    const afterRelogin = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    assert.equal(afterRelogin.localDefaultPrinterId, beforeRelogin);
    assert.equal(afterRelogin.localDefaultPrinterId, hpA.id);
    console.log("M PASS device-local default survives Agent relogin");

    // N — same printerName independent defaults (already Canon on both)
    assert.notEqual(canonA.id, canonB.id);
    assert.equal(deviceBRow.localDefaultPrinterId, canonB.id);
    assert.notEqual(deviceARow.localDefaultPrinterId, canonA.id);
    console.log("N PASS same printerName independent per device");

    // Concurrency: A→Canon, B→Epson simultaneously
    await Promise.all([
      upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceA.id,
        printerName: "Canon",
        status: "online",
        isDefault: true,
      }),
      upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceB.id,
        printerName: "Epson",
        status: "online",
        isDefault: true,
      }),
    ]);
    deviceARow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    deviceBRow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceARow.localDefaultPrinterId, canonA.id);
    assert.equal(deviceBRow.localDefaultPrinterId, epsonB.id);

    // Concurrent swap: A→HP, B→Canon
    await Promise.all([
      upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceA.id,
        printerName: "HP",
        status: "online",
        isDefault: true,
      }),
      upsertShopPrinter({
        shopId: shop.id,
        agentDeviceId: deviceB.id,
        printerName: "Canon",
        status: "online",
        isDefault: true,
      }),
    ]);
    deviceARow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceA.id },
    });
    deviceBRow = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceB.id },
    });
    assert.equal(deviceARow.localDefaultPrinterId, hpA.id);
    assert.equal(deviceBRow.localDefaultPrinterId, canonB.id);
    console.log("CONCURRENCY PASS simultaneous default changes stay device-local");

    console.log("\nphase2c3-device-local-default-smoke: ALL PASS");
  } finally {
    const emails = await prisma.user.findMany({
      where: { email: { startsWith: "2c3" } },
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
