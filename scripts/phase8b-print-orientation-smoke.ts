/**
 * Phase B — orientation + copies customer print controls smoke.
 * Run: npx tsx scripts/phase8b-print-orientation-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PDFDocument } from "pdf-lib";
import { PrintMode, PrintStatus, PrintType, PrismaClient } from "@prisma/client";

import {
  buildPrintSettingsV1,
  DEFAULT_PRINT_SETTINGS_V1,
  planJobPrint,
  resolvePrintSettings,
  shouldUseLegacyPrintBehavior,
} from "../shared/print-settings";
import {
  A4_LANDSCAPE_PT,
  A4_PORTRAIT_PT,
  createImagePrintablePdf,
  fitImageOnPage,
  PRINTABLE_MARGIN_PT,
} from "../print-agent/src/image-to-printable-pdf";
import { calculatePrintCost } from "../lib/pricing-service";
import { createPrintJob } from "../lib/job-service";

const prisma = new PrismaClient();

/** 2×1 PNG (landscape pixels) — tiny, valid. */
const PNG_LANDSCAPE_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEElEQVR42mP8z8BQz0AEYBxVSF+FBwD+9wX+4x6i6QAAAABJRU5ErkJggg==",
  "base64",
);

/** 1×2 PNG (portrait pixels). */
const PNG_PORTRAIT_1X2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZmgDzAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FBwD+9wX+qYxY3QAAAABJRU5ErkJggg==",
  "base64",
);

async function createShop(suffix: string) {
  const shopCode = `PB${suffix}`.slice(0, 12);
  return prisma.shop.create({
    data: {
      shopCode,
      shopName: `Phase8B Shop ${suffix}`,
      phone: "9999999999",
      address: "Test Address",
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
  // Keep shared <-> agent print-settings identical
  assert.equal(
    fs
      .readFileSync(path.join(process.cwd(), "shared", "print-settings.ts"), "utf8")
      .replace(/\r\n/g, "\n"),
    fs
      .readFileSync(
        path.join(process.cwd(), "print-agent", "src", "print-settings.ts"),
        "utf8",
      )
      .replace(/\r\n/g, "\n"),
  );
  console.log("PASS sync: shared === agent print-settings");

  // A. Default orientation = portrait
  const defaults = buildPrintSettingsV1({ copies: 1 });
  assert.equal(defaults.orientation, "portrait");
  assert.equal(defaults.orientation, DEFAULT_PRINT_SETTINGS_V1.orientation);
  console.log("A PASS default orientation = portrait");

  // B. Customer selects landscape
  const landscapeSettings = buildPrintSettingsV1({
    copies: 1,
    orientation: "landscape",
  });
  assert.equal(landscapeSettings.orientation, "landscape");
  console.log("B PASS landscape settings");

  // C + D. 3 copies; printSettings.copies === job copies
  const three = buildPrintSettingsV1({ copies: 3, orientation: "portrait" });
  assert.equal(three.copies, 3);
  console.log("C/D PASS copies=3 and settings.copies matches");

  // E. Legacy null
  const legacy = resolvePrintSettings(null);
  assert.equal(legacy.source, "legacy");
  assert.equal(shouldUseLegacyPrintBehavior(legacy), true);
  const legacyPlan = planJobPrint(null, 1);
  assert.equal(legacyPlan.imageOrientation, "portrait");
  assert.equal(legacyPlan.sumatraOrientation, undefined);
  console.log("E PASS legacy null → portrait image, no Sumatra orientation");

  // F. Invalid settings fallback
  const bad = resolvePrintSettings({
    v: 1,
    orientation: "sideways",
    copies: -5,
    paperSize: "A4",
    scale: "fit",
    margins: "normal",
  }, { fallbackCopies: 2 });
  assert.equal(bad.source, "v1");
  assert.equal(bad.settings?.orientation, "portrait");
  assert.equal(bad.settings?.copies, 2);
  const badPlan = planJobPrint({ v: 99 }, 1);
  assert.equal(badPlan.sumatraOrientation, undefined);
  console.log("F PASS invalid settings fallback");

  // G. PDF portrait path — Sumatra flag omitted
  const portraitPlan = planJobPrint(
    buildPrintSettingsV1({ copies: 1, orientation: "portrait" }),
    1,
  );
  assert.equal(portraitPlan.imageOrientation, "portrait");
  assert.equal(portraitPlan.sumatraOrientation, undefined);
  console.log("G PASS PDF portrait → no Sumatra orientation flag");

  // H. PDF landscape path — Sumatra landscape
  const landscapePlan = planJobPrint(
    buildPrintSettingsV1({ copies: 2, orientation: "landscape" }),
    2,
  );
  assert.equal(landscapePlan.imageOrientation, "landscape");
  assert.equal(landscapePlan.sumatraOrientation, "landscape");
  console.log("H PASS PDF landscape → Sumatra landscape");

  // I. Image portrait conversion page size
  const portraitPdfBytes = await createImagePrintablePdf(
    PNG_PORTRAIT_1X2,
    "png",
    "portrait",
  );
  const portraitPdf = await PDFDocument.load(portraitPdfBytes);
  const portraitPage = portraitPdf.getPage(0);
  const portraitSize = portraitPage.getSize();
  assert.equal(Math.round(portraitSize.width), A4_PORTRAIT_PT.width);
  assert.equal(Math.round(portraitSize.height), A4_PORTRAIT_PT.height);
  console.log("I PASS image portrait → A4 595×842");

  // J. Image landscape conversion page size
  const landscapePdfBytes = await createImagePrintablePdf(
    PNG_LANDSCAPE_2X1,
    "png",
    "landscape",
  );
  const landscapePdf = await PDFDocument.load(landscapePdfBytes);
  const landscapePage = landscapePdf.getPage(0);
  const landscapeSize = landscapePage.getSize();
  assert.equal(Math.round(landscapeSize.width), A4_LANDSCAPE_PT.width);
  assert.equal(Math.round(landscapeSize.height), A4_LANDSCAPE_PT.height);
  console.log("J PASS image landscape → A4 842×595");

  // K. Landscape image fitted without cropping (aspect preserved, inside margins)
  const fit = fitImageOnPage(800, 400, A4_LANDSCAPE_PT.width, A4_LANDSCAPE_PT.height);
  assert.ok(fit.width <= A4_LANDSCAPE_PT.width - PRINTABLE_MARGIN_PT * 2);
  assert.ok(fit.height <= A4_LANDSCAPE_PT.height - PRINTABLE_MARGIN_PT * 2);
  assert.ok(Math.abs(fit.width / fit.height - 800 / 400) < 1e-6);
  // Not stretched to full page in both axes
  assert.ok(
    fit.width < A4_LANDSCAPE_PT.width - PRINTABLE_MARGIN_PT * 2 ||
      fit.height < A4_LANDSCAPE_PT.height - PRINTABLE_MARGIN_PT * 2,
  );
  console.log("K PASS landscape fit without crop/stretch");

  // L. Pricing still uses PrintJob.copies
  const rates = {
    bwSingle: 2,
    bwDouble: 3,
    colorSingle: 5,
    colorDouble: 7,
    minimumCharge: 10,
  };
  const jobCopies = 3;
  const settingsCopiesDivergent = 99;
  const price = calculatePrintCost(
    rates,
    10,
    jobCopies,
    PrintMode.BW,
    PrintType.SINGLE,
  );
  assert.equal(price, Math.max(10 * 3 * 2, 10));
  assert.notEqual(
    price,
    calculatePrintCost(
      rates,
      10,
      settingsCopiesDivergent,
      PrintMode.BW,
      PrintType.SINGLE,
    ),
  );
  console.log("L PASS pricing uses PrintJob.copies");

  // M. Job lifecycle fields + persisted settings
  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(stamp);
  try {
    const jobLandscape = await createPrintJob({
      shopId: shop.id,
      copies: 3,
      totalPages: 1,
      printMode: PrintMode.BW,
      printType: PrintType.SINGLE,
      totalPrice: 6,
      printSettings: buildPrintSettingsV1({
        copies: 3,
        orientation: "landscape",
      }),
      files: [
        {
          originalFileName: "a.pdf",
          storedFileName: `pb-${stamp}-a.pdf`,
          fileExtension: "pdf",
          fileSize: 10,
          totalPages: 1,
        },
      ],
    });

    assert.equal(jobLandscape.status, PrintStatus.PENDING);
    assert.equal(jobLandscape.copies, 3);
    assert.equal(jobLandscape.printAttempts, 0);
    const stored = resolvePrintSettings(jobLandscape.printSettings, {
      fallbackCopies: jobLandscape.copies,
    });
    assert.equal(stored.source, "v1");
    assert.equal(stored.settings?.orientation, "landscape");
    assert.equal(stored.settings?.copies, jobLandscape.copies);

    const jobLegacy = await createPrintJob({
      shopId: shop.id,
      copies: 1,
      totalPages: 1,
      printMode: PrintMode.BW,
      printType: PrintType.SINGLE,
      totalPrice: 5,
      files: [
        {
          originalFileName: "b.pdf",
          storedFileName: `pb-${stamp}-b.pdf`,
          fileExtension: "pdf",
          fileSize: 10,
          totalPages: 1,
        },
      ],
    });
    assert.equal(jobLegacy.printSettings, null);
    assert.equal(jobLegacy.status, PrintStatus.PENDING);
    console.log("M PASS job create stores settings; legacy omit stays null; lifecycle unchanged");
  } finally {
    await prisma.shop.delete({ where: { id: shop.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log("\nphase8b-print-orientation-smoke: ALL PASS");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
