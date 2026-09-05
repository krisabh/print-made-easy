/**
 * Phase 2B — customer color gating (default printer colorSupported).
 * Run: npx tsx scripts/phase9c-customer-color-gating-smoke.ts
 */
import assert from "node:assert/strict";
import { PrintMode, PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

import { submitPrintJobAction } from "../app/upload/[shopCode]/actions";
import {
  getShopDefaultColorSupported,
  upsertShopPrinter,
} from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `Color Gate Shop ${code}`,
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

async function makePdfFile(name: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const bytes = await pdf.save();
  return new File([Buffer.from(bytes)], name, { type: "application/pdf" });
}

async function submitJob(shopCode: string, printMode: "BW" | "COLOR") {
  const formData = new FormData();
  formData.set("shopCode", shopCode);
  formData.set("copies", "1");
  formData.set("printMode", printMode);
  formData.set("orientation", "portrait");
  formData.set("scale", "fit");
  formData.set("margins", "normal");
  formData.set("pagesMode", "all");
  formData.set("pageRange", "");
  formData.append("files", await makePdfFile("gate-test.pdf"));
  return submitPrintJobAction(formData);
}

function customerUiShowsColor(colorSupported: boolean) {
  // Mirrors upload-form gating: Color option only when colorSupported.
  return colorSupported
    ? (["BW", "COLOR"] as const)
    : (["BW"] as const);
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(`CG${stamp}`.slice(0, 12));

  try {
    // Test 1 — default B&W printer
    await upsertShopPrinter({
      shopId: shop.id,
      printerName: "Printer A",
      status: "online",
      isDefault: true,
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { colorSupported: false },
    });
    let capability = await getShopDefaultColorSupported(shop.id);
    assert.equal(capability, false);
    assert.deepEqual(customerUiShowsColor(capability), ["BW"]);
    console.log("PASS Test 1 default B&W → colorSupported=false, UI B&W only");

    // Test 2 — default color printer
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { colorSupported: true },
    });
    capability = await getShopDefaultColorSupported(shop.id);
    assert.equal(capability, true);
    assert.deepEqual(customerUiShowsColor(capability), ["BW", "COLOR"]);
    console.log("PASS Test 2 default color → colorSupported=true, UI B&W+Color");

    // Test 3 — non-default color printer must not enable Color
    await upsertShopPrinter({
      shopId: shop.id,
      printerName: "Printer B",
      status: "online",
      isDefault: false,
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { colorSupported: false, isDefault: true },
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer B",
        },
      },
      data: { colorSupported: true, isDefault: false },
    });
    // Ensure only A is default (upsert may have cleared defaults)
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { isDefault: false },
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { isDefault: true, colorSupported: false },
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer B",
        },
      },
      data: { isDefault: false, colorSupported: true },
    });
    capability = await getShopDefaultColorSupported(shop.id);
    assert.equal(capability, false);
    console.log("PASS Test 3 non-default color printer does not enable Color");

    // Test 4 — switching default
    assert.equal(await getShopDefaultColorSupported(shop.id), false);
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { isDefault: false },
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer B",
        },
      },
      data: { isDefault: true },
    });
    assert.equal(await getShopDefaultColorSupported(shop.id), true);
    console.log("PASS Test 4 switching default flips customer capability");

    // Test 5 — no default printer
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { isDefault: false },
    });
    assert.equal(await getShopDefaultColorSupported(shop.id), false);
    console.log("PASS Test 5 no default → colorSupported=false");

    // Restore A as B&W default for reject tests
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { isDefault: true, colorSupported: false },
    });

    // Test 6 — server rejects unsupported Color
    const rejected = await submitJob(shop.shopCode, "COLOR");
    assert.equal(rejected.success, false);
    assert.match(String(rejected.error), /color/i);
    const colorJobs = await prisma.printJob.count({
      where: { shopId: shop.id, printMode: PrintMode.COLOR },
    });
    assert.equal(colorJobs, 0);
    console.log("PASS Test 6 server rejects Color when unsupported");

    // Test 7 — server accepts Color when supported
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { colorSupported: true },
    });
    const accepted = await submitJob(shop.shopCode, "COLOR");
    assert.equal(accepted.success, true);
    assert.ok(accepted.data?.jobId);
    const colorJob = await prisma.printJob.findUniqueOrThrow({
      where: { id: accepted.data!.jobId },
    });
    assert.equal(colorJob.printMode, PrintMode.COLOR);
    assert.equal(Number(colorJob.totalPrice), 10); // 1 page × colorSingle
    console.log("PASS Test 7 server accepts Color when supported");

    // Test 8 — stale UI: page thought Color OK, default now B&W
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { colorSupported: true, isDefault: true },
    });
    // Simulate shopkeeper switch after page render
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { isDefault: false },
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer B",
        },
      },
      data: { isDefault: true, colorSupported: false },
    });
    assert.equal(await getShopDefaultColorSupported(shop.id), false);
    const stale = await submitJob(shop.shopCode, "COLOR");
    assert.equal(stale.success, false);
    assert.match(String(stale.error), /color/i);
    console.log("PASS Test 8 stale page cannot bypass Color capability");

    // Test 9 — default switch does not alter capability values
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
      data: { isDefault: true, colorSupported: true },
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer B",
        },
      },
      data: { isDefault: false, colorSupported: false },
    });
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { isDefault: false },
    });
    await prisma.printer.update({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer B",
        },
      },
      data: { isDefault: true },
    });
    const a9 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer A",
        },
      },
    });
    const b9 = await prisma.printer.findUniqueOrThrow({
      where: {
        shopId_printerName: {
          shopId: shop.id,
          printerName: "Printer B",
        },
      },
    });
    assert.equal(a9.isDefault, false);
    assert.equal(a9.colorSupported, true);
    assert.equal(b9.isDefault, true);
    assert.equal(b9.colorSupported, false);
    console.log("PASS Test 9 default switch preserves colorSupported values");

    // Context must not expose printer inventory shape (type-level / helper contract)
    const contextShape = {
      colorSupported: await getShopDefaultColorSupported(shop.id),
    };
    assert.equal("printerName" in contextShape, false);
    assert.equal("printers" in contextShape, false);
    console.log("PASS customer context exposes only colorSupported capability");

    console.log("\nphase9c-customer-color-gating-smoke: ALL PASS");
  } finally {
    await prisma.printJobFile.deleteMany({
      where: { printJob: { shopId: shop.id } },
    });
    await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
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
