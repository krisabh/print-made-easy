/**
 * Phase 2A — per-printer colorSupported (manual, no auto-detection).
 * Run: npx tsx scripts/phase9b-printer-color-capability-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import { PATCH as printersPatch } from "../app/api/print-agent/printers/route";
import { generateAgentToken, hashAgentToken } from "../lib/print-agent-auth";
import {
  setShopPrinterColorSupported,
  upsertShopPrinter,
} from "../lib/print-agent-service";

const prisma = new PrismaClient();

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `Color Cap Shop ${code}`,
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
  const stamp = Date.now().toString(36).toUpperCase();
  const shopA = await createShop(`CA${stamp}`.slice(0, 12));
  const shopB = await createShop(`CB${stamp}`.slice(0, 12));
  const tokenA = await attachAgentToken(shopA.id);
  const tokenB = await attachAgentToken(shopB.id);

  try {
    // Test 1 — new printer defaults to false
    await upsertShopPrinter({
      shopId: shopA.id,
      printerName: "Printer A",
      status: "online",
      isDefault: true,
    });
    let rowA = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    assert.equal(rowA.colorSupported, false);
    console.log("PASS Test 1 new printer colorSupported=false");

    // Test 2 — explicit enable
    let setResult = await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: true,
    });
    assert.equal(setResult.ok, true);
    if (setResult.ok) assert.equal(setResult.printer.colorSupported, true);
    rowA = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    assert.equal(rowA.colorSupported, true);
    console.log("PASS Test 2 explicit enable");

    // Test 3 — explicit disable
    setResult = await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: false,
    });
    assert.equal(setResult.ok, true);
    rowA = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    assert.equal(rowA.colorSupported, false);
    console.log("PASS Test 3 explicit disable");

    // Re-enable for heartbeat preserve tests
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: true,
    });

    // Test 4 — heartbeat preserves true
    let hb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        "POST",
        {
          selectedPrinter: "Printer A",
          printerStatus: "Online",
          printers: [
            { name: "Printer A", status: "Online" },
            { name: "Printer B", status: "Online" },
          ],
        },
        { Authorization: `Bearer ${tokenA}` },
      ),
    );
    assert.equal(hb.status, 200);
    const hbBody = (await hb.json()) as {
      printers: Array<{ printerName: string; colorSupported: boolean }>;
    };
    rowA = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    assert.equal(rowA.colorSupported, true);
    assert.equal(
      hbBody.printers.find((p) => p.printerName === "Printer A")
        ?.colorSupported,
      true,
    );
    console.log("PASS Test 4 heartbeat preserves true");

    // Test 5 — heartbeat does not reset false
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: false,
    });
    hb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        "POST",
        {
          selectedPrinter: "Printer A",
          printerStatus: "Online",
          printers: [{ name: "Printer A", status: "Online" }],
        },
        { Authorization: `Bearer ${tokenA}` },
      ),
    );
    assert.equal(hb.status, 200);
    rowA = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    assert.equal(rowA.colorSupported, false);
    console.log("PASS Test 5 heartbeat preserves false");

    // Test 6 — separate printer capabilities
    await upsertShopPrinter({
      shopId: shopA.id,
      printerName: "Printer B",
      status: "online",
      isDefault: false,
    });
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: true,
    });
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer B",
      colorSupported: false,
    });
    const a6 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    const b6 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer B",
        },
      },
    });
    assert.equal(a6.colorSupported, true);
    assert.equal(b6.colorSupported, false);
    console.log("PASS Test 6 separate capabilities");

    // Test 7 — default switch does not change capability
    await upsertShopPrinter({
      shopId: shopA.id,
      printerName: "Printer A",
      status: "online",
      isDefault: true,
    });
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: true,
    });
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer B",
      colorSupported: false,
    });
    // Switch default to B via heartbeat (same as Agent set-printer)
    hb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        "POST",
        {
          selectedPrinter: "Printer B",
          printerStatus: "Online",
          printers: [
            { name: "Printer A", status: "Online" },
            { name: "Printer B", status: "Online" },
          ],
        },
        { Authorization: `Bearer ${tokenA}` },
      ),
    );
    assert.equal(hb.status, 200);
    const a7 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    const b7 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer B",
        },
      },
    });
    assert.equal(a7.isDefault, false);
    assert.equal(a7.colorSupported, true);
    assert.equal(b7.isDefault, true);
    assert.equal(b7.colorSupported, false);
    console.log("PASS Test 7 default switch keeps colorSupported");

    // Test 8 — disappearing printer retains capability
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: true,
    });
    // Make A default again, then heartbeat without A in detected list
    await upsertShopPrinter({
      shopId: shopA.id,
      printerName: "Printer A",
      status: "offline",
      isDefault: true,
    });
    await setShopPrinterColorSupported({
      shopId: shopA.id,
      printerName: "Printer A",
      colorSupported: true,
    });
    hb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        "POST",
        {
          selectedPrinter: "Printer A",
          printerStatus: "Offline",
          printers: [{ name: "Printer B", status: "Online" }],
        },
        { Authorization: `Bearer ${tokenA}` },
      ),
    );
    assert.equal(hb.status, 200);
    const a8 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    assert.equal(a8.isDefault, true);
    assert.equal(a8.colorSupported, true);
    const stillExists = await prisma.printer.count({
      where: { shopId: shopA.id, printerName: "Printer A" },
    });
    assert.equal(stillExists, 1);
    console.log("PASS Test 8 disappear retains colorSupported + default");

    // Test 9 — printer returns, capability remains
    hb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        "POST",
        {
          selectedPrinter: "Printer A",
          printerStatus: "Online",
          printers: [
            { name: "Printer A", status: "Online" },
            { name: "Printer B", status: "Online" },
          ],
        },
        { Authorization: `Bearer ${tokenA}` },
      ),
    );
    assert.equal(hb.status, 200);
    const a9 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer A",
        },
      },
    });
    assert.equal(a9.colorSupported, true);
    assert.equal(a9.isDefault, true);
    console.log("PASS Test 9 return keeps colorSupported=true");

    // Test 10 — authorization: Agent A cannot update shop B's printer row
    await upsertShopPrinter({
      shopId: shopB.id,
      printerName: "Printer B-Only",
      status: "online",
      isDefault: true,
    });
    await setShopPrinterColorSupported({
      shopId: shopB.id,
      printerName: "Printer B-Only",
      colorSupported: false,
    });

    // Shop A token + shop B printer name: creates/updates only within shop A.
    const cross = await printersPatch(
      asJsonRequest(
        "http://localhost/api/print-agent/printers",
        "PATCH",
        {
          printerName: "Printer B-Only",
          colorSupported: true,
        },
        { Authorization: `Bearer ${tokenA}` },
      ),
    );
    assert.equal(cross.status, 200);

    const bOnly = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shopB.id,
          printerName: "Printer B-Only",
        },
      },
    });
    assert.equal(bOnly.colorSupported, false);

    const aCross = await prisma.printer.findUnique({
      where: {
        shopId_printerName: {
          shopId: shopA.id,
          printerName: "Printer B-Only",
        },
      },
    });
    assert.equal(aCross?.colorSupported, true);

    // Shop B agent can update its own printer
    const own = await printersPatch(
      asJsonRequest(
        "http://localhost/api/print-agent/printers",
        "PATCH",
        {
          printerName: "Printer B-Only",
          colorSupported: true,
        },
        { Authorization: `Bearer ${tokenB}` },
      ),
    );
    assert.equal(own.status, 200);
    const ownBody = (await own.json()) as { colorSupported: boolean };
    assert.equal(ownBody.colorSupported, true);

    // Unauthenticated rejected
    const unauth = await printersPatch(
      asJsonRequest(
        "http://localhost/api/print-agent/printers",
        "PATCH",
        { printerName: "Printer A", colorSupported: true },
      ),
    );
    assert.equal(unauth.status, 401);
    console.log("PASS Test 10 authorization scoped to Agent shop");

    console.log("\nphase9b-printer-color-capability-smoke: ALL PASS");
    console.log(
      "Confirmed: Color capability is manually configured; there is no automatic detection.",
    );
  } finally {
    await prisma.printer.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    await prisma.printPrice.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    await prisma.settings.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    await prisma.inventory.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
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
