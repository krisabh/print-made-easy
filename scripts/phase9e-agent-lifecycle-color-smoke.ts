/**
 * Agent lifecycle / color capability regressions (1.2.0 fixes).
 * Run: npx tsx scripts/phase9e-agent-lifecycle-color-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import {
  PATCH as printersPatch,
  POST as printersPost,
} from "../app/api/print-agent/printers/route";
import { generateAgentToken, hashAgentToken } from "../lib/print-agent-auth";
import { setShopPrinterColorSupported } from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";
import {
  detectPrinters,
  getDetectPrintersStats,
  resetDetectPrintersCacheForTests,
} from "../print-agent/src/printer-service";

const prisma = new PrismaClient();

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `Lifecycle Shop ${code}`,
      phone: "9000000000",
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
  });
}

async function attachAgentToken(shopId: string) {
  const token = generateAgentToken();
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      agentId: `agent-${shopId.slice(0, 8)}`,
      agentTokenHash: hashAgentToken(token),
      agentLastSeen: new Date(),
    },
  });
  return token;
}

function asJsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers?: HeadersInit,
) {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  // Concurrent detectPrinters coalesce to one uncached start
  resetDetectPrintersCacheForTests();
  const before = getDetectPrintersStats().starts;
  const [a, b, c] = await Promise.all([
    detectPrinters(),
    detectPrinters(),
    detectPrinters(),
  ]);
  const after = getDetectPrintersStats().starts;
  assert.equal(after - before, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  console.log("PASS concurrent detectPrinters uses single in-flight scan");

  // Cache hit does not start another scan
  const mid = getDetectPrintersStats().starts;
  await detectPrinters();
  await detectPrinters();
  assert.equal(getDetectPrintersStats().starts, mid);
  console.log("PASS detectPrinters cache prevents immediate re-scan");

  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(`LC${stamp}`.slice(0, 12));
  const token = await attachAgentToken(shop.id);

  try {
    // Upsert color when printer row missing
    const created = await setShopPrinterColorSupported({
      shopId: shop.id,
      printerName: "New Color Printer",
      colorSupported: true,
    });
    assert.equal(created.ok, true);
    if (created.ok) assert.equal(created.printer.colorSupported, true);
    console.log("PASS colorSupported creates missing Printer row");

    // PATCH endpoint
    const patch = await printersPatch(
      asJsonRequest(
        "http://localhost/api/print-agent/printers",
        "PATCH",
        { printerName: "New Color Printer", colorSupported: false },
        { Authorization: `Bearer ${token}` },
      ),
    );
    assert.equal(patch.status, 200);
    assert.equal(((await patch.json()) as { colorSupported: boolean }).colorSupported, false);

    // POST alias
    const post = await printersPost(
      asJsonRequest(
        "http://localhost/api/print-agent/printers",
        "POST",
        { printerName: "New Color Printer", colorSupported: true },
        { Authorization: `Bearer ${token}` },
      ),
    );
    assert.equal(post.status, 200);
    assert.equal(((await post.json()) as { colorSupported: boolean }).colorSupported, true);
    console.log("PASS PATCH and POST printer capability endpoints");

    // Heartbeat colorUpdate persists and is not wiped by status sync
    const hb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        "POST",
        {
          selectedPrinter: "New Color Printer",
          printerStatus: "Online",
          printers: [{ name: "New Color Printer", status: "Online" }],
          colorUpdate: {
            printerName: "New Color Printer",
            colorSupported: true,
          },
        },
        { Authorization: `Bearer ${token}` },
      ),
    );
    assert.equal(hb.status, 200);
    const hbBody = (await hb.json()) as {
      printers: Array<{ printerName: string; colorSupported: boolean }>;
    };
    assert.equal(
      hbBody.printers.find((p) => p.printerName === "New Color Printer")
        ?.colorSupported,
      true,
    );

    const hb2 = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        "POST",
        {
          selectedPrinter: "New Color Printer",
          printerStatus: "Online",
          printers: [{ name: "New Color Printer", status: "Online" }],
        },
        { Authorization: `Bearer ${token}` },
      ),
    );
    assert.equal(hb2.status, 200);
    const row = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "New Color Printer",
        },
      },
    });
    assert.equal(row.colorSupported, true);
    console.log("PASS heartbeat colorUpdate persists across later heartbeats");

    console.log("\nphase9e-agent-lifecycle-color-smoke: ALL PASS");
  } finally {
    await prisma.printer.deleteMany({ where: { shopId: shop.id } });
    await prisma.subscription.deleteMany({ where: { shopId: shop.id } });
    await prisma.printPrice.deleteMany({ where: { shopId: shop.id } });
    await prisma.settings.deleteMany({ where: { shopId: shop.id } });
    await prisma.inventory.deleteMany({ where: { shopId: shop.id } });
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
