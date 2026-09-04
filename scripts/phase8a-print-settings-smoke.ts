/**
 * Phase A — printSettings foundation smoke.
 * Run: npx tsx scripts/phase8a-print-settings-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PrintMode, PrintStatus, PrintType, PrismaClient } from "@prisma/client";

import {
  buildDefaultPrintSettingsV1,
  DEFAULT_PRINT_SETTINGS_V1,
  resolvePrintSettings,
  shouldUseLegacyPrintBehavior,
} from "../shared/print-settings";
import { calculatePrintCost } from "../lib/pricing-service";

const prisma = new PrismaClient();

function assertLegacy(raw: unknown, label: string) {
  const resolved = resolvePrintSettings(raw);
  assert.equal(resolved.source, "legacy", label);
  assert.equal(resolved.settings, null, label);
  assert.equal(shouldUseLegacyPrintBehavior(resolved), true, label);
}

async function main() {
  const sharedPath = path.join(process.cwd(), "shared", "print-settings.ts");
  const agentPath = path.join(
    process.cwd(),
    "print-agent",
    "src",
    "print-settings.ts",
  );
  assert.equal(
    fs.readFileSync(sharedPath, "utf8").replace(/\r\n/g, "\n"),
    fs.readFileSync(agentPath, "utf8").replace(/\r\n/g, "\n"),
    "shared/print-settings.ts must match print-agent copy",
  );
  console.log("PASS sync: shared === print-agent print-settings");

  // 1 + 3. null / missing → legacy
  assertLegacy(null, "null");
  assertLegacy(undefined, "undefined");
  console.log("PASS null/missing → legacy");

  // 2. valid v1
  const valid = buildDefaultPrintSettingsV1(3);
  assert.deepEqual(valid, {
    v: 1,
    orientation: "portrait",
    copies: 3,
    paperSize: "A4",
    scale: "fit",
    margins: "normal",
  });
  const resolvedValid = resolvePrintSettings(valid, { fallbackCopies: 3 });
  assert.equal(resolvedValid.source, "v1");
  assert.deepEqual(resolvedValid.settings, valid);
  assert.equal(shouldUseLegacyPrintBehavior(resolvedValid), false);
  console.log("PASS valid v1 settings");

  // 4. malformed
  assertLegacy("not-json{{{", "bad string");
  assertLegacy(42, "number");
  assertLegacy(["portrait"], "array");
  assertLegacy({ v: 99, orientation: "portrait" }, "unknown version");
  console.log("PASS malformed → legacy");

  // 5. invalid orientation → portrait fallback (still v1 object)
  const badOrientation = resolvePrintSettings(
    {
      v: 1,
      orientation: "something-invalid",
      copies: 2,
      paperSize: "A4",
      scale: "fit",
      margins: "normal",
    },
    { fallbackCopies: 2 },
  );
  assert.equal(badOrientation.source, "v1");
  assert.equal(badOrientation.settings?.orientation, "portrait");
  assert.equal(badOrientation.repaired, true);
  console.log("PASS invalid orientation → portrait");

  // 6. invalid copies → fallbackCopies / default
  const badCopies = resolvePrintSettings(
    {
      v: 1,
      orientation: "landscape",
      copies: -5,
      paperSize: "A4",
      scale: "fit",
      margins: "normal",
    },
    { fallbackCopies: 4 },
  );
  assert.equal(badCopies.source, "v1");
  assert.equal(badCopies.settings?.copies, 4);
  assert.equal(badCopies.settings?.orientation, "landscape");

  const badCopiesNoFallback = resolvePrintSettings({
    v: 1,
    orientation: "portrait",
    copies: 0,
    paperSize: "A4",
    scale: "fit",
    margins: "normal",
  });
  assert.equal(
    badCopiesNoFallback.settings?.copies,
    DEFAULT_PRINT_SETTINGS_V1.copies,
  );
  console.log("PASS invalid copies → safe fallback");

  // Unknown fields must not crash
  const withExtra = resolvePrintSettings({
    v: 1,
    orientation: "landscape",
    copies: 1,
    paperSize: "A4",
    scale: "fit",
    margins: "normal",
    pageRange: "1-3",
    evil: { nested: true },
  });
  assert.equal(withExtra.source, "v1");
  assert.equal(withExtra.settings?.orientation, "landscape");
  console.log("PASS unknown fields ignored");

  // 7. PrintJob.copies remains pricing SOT — printSettings.copies must not affect cost
  const rates = {
    bwSingle: 2,
    bwDouble: 3,
    colorSingle: 5,
    colorDouble: 7,
    minimumCharge: 10,
  };
  const jobCopies = 5;
  const settingsCopies = 99;
  const priceFromJobCopies = calculatePrintCost(
    rates,
    10,
    jobCopies,
    PrintMode.BW,
    PrintType.SINGLE,
  );
  const priceIfSomeoneUsedSettings = calculatePrintCost(
    rates,
    10,
    settingsCopies,
    PrintMode.BW,
    PrintType.SINGLE,
  );
  assert.notEqual(priceFromJobCopies, priceIfSomeoneUsedSettings);
  assert.equal(priceFromJobCopies, Math.max(10 * 5 * 2, 10));
  // Canonical pricing API only takes PrintJob.copies-shaped args — not printSettings.
  console.log("PASS pricing uses copies arg (PrintJob.copies), not printSettings");

  // 8 + 9. Agent payload shapes (old without printSettings, new with)
  const oldPayload = {
    id: "job-old",
    jobNumber: "PME-000001",
    copies: 1,
    totalPages: 2,
    printMode: "BW" as const,
    printType: "SINGLE" as const,
    status: "PENDING",
    printAttempts: 0,
    files: [],
  };
  assertLegacy(
    (oldPayload as { printSettings?: unknown }).printSettings,
    "old agent payload",
  );

  const newPayload = {
    ...oldPayload,
    printSettings: buildDefaultPrintSettingsV1(2),
  };
  const newResolved = resolvePrintSettings(newPayload.printSettings, {
    fallbackCopies: newPayload.copies,
  });
  assert.equal(newResolved.source, "v1");
  assert.equal(newResolved.settings?.copies, 2);
  // Agent Phase A still prints using job.copies (pricing/print path SOT for count today).
  assert.equal(newPayload.copies, 1);
  console.log("PASS agent old + new payloads parse safely");

  // DB: create job with null printSettings; store valid v1 on another job
  const stamp = Date.now().toString(36).toUpperCase();
  const shopCode = `PS${stamp}`.slice(0, 10);
  let shopId: string | null = null;

  try {
    const shop = await prisma.shop.create({
      data: {
        shopCode,
        shopName: `PrintSettings Smoke ${stamp}`,
        phone: "9999999999",
        address: "Test Address",
        isActive: true,
        printPrice: {
          create: {
            bwSingle: 1,
            bwDouble: 1,
            colorSingle: 1,
            colorDouble: 1,
            minimumCharge: 1,
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
    shopId = shop.id;

    const { createPrintJob } = await import("../lib/job-service");
    const legacyJob = await createPrintJob({
      shopId: shop.id,
      copies: 2,
      totalPages: 3,
      printMode: PrintMode.BW,
      printType: PrintType.SINGLE,
      totalPrice: 6,
      files: [
        {
          originalFileName: "legacy.pdf",
          storedFileName: `ps-legacy-${stamp}.pdf`,
          fileExtension: "pdf",
          fileSize: 10,
          totalPages: 3,
        },
      ],
    });
    assert.equal(legacyJob.printSettings, null);
    assertLegacy(legacyJob.printSettings, "db null printSettings");
    console.log("PASS DB job printSettings=null (createPrintJob Option B)");

    const settings = buildDefaultPrintSettingsV1(legacyJob.copies);
    assert.equal(settings.copies, legacyJob.copies);

    const withSettings = await prisma.printJob.create({
      data: {
        shopId: shop.id,
        jobSequence: 2,
        jobNumber: "PME-000002",
        copies: 3,
        totalPages: 1,
        printMode: PrintMode.BW,
        printType: PrintType.SINGLE,
        totalPrice: 3,
        status: PrintStatus.PENDING,
        printSettings: buildDefaultPrintSettingsV1(3),
      },
    });
    const fromDb = resolvePrintSettings(withSettings.printSettings, {
      fallbackCopies: withSettings.copies,
    });
    assert.equal(fromDb.source, "v1");
    assert.equal(fromDb.settings?.copies, withSettings.copies);
    console.log("PASS DB job with valid v1 printSettings");
  } finally {
    if (shopId) {
      await prisma.shop.delete({ where: { id: shopId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log("\nphase8a-print-settings-smoke: ALL PASS");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
