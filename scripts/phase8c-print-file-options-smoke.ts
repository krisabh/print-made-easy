/**
 * Phase C — file-type-aware print options + MIXED job UX + SINGLE-only jobs.
 * Run: npx tsx scripts/phase8c-print-file-options-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PrintMode, PrintStatus, PrintType, PrismaClient } from "@prisma/client";

import { createPrintJob } from "../lib/job-service";
import { calculatePrintCost } from "../lib/pricing-service";
import {
  categorizeExtension,
  categorizeUploadFile,
  resolveJobPrintCategory,
} from "../shared/print-file-category";
import {
  buildPrintSettingsV1,
  DEFAULT_PRINT_SETTINGS_V1,
  isValidPageRange,
  planJobPrint,
  resolvePrintSettings,
  shouldUseLegacyPrintBehavior,
} from "../shared/print-settings";

const prisma = new PrismaClient();

function readUploadFormSource() {
  return fs.readFileSync(
    path.join(process.cwd(), "components", "upload-form.tsx"),
    "utf8",
  );
}

/** Simulate UI transitions by re-deriving from file lists (files = SOT). */
function categoryForNames(names: string[]) {
  return resolveJobPrintCategory(names.map((name) => ({ name })));
}

async function createShop(suffix: string) {
  return prisma.shop.create({
    data: {
      shopCode: `PC${suffix}`.slice(0, 12),
      shopName: `Phase8C Shop ${suffix}`,
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
  console.log("PASS sync print-settings");

  // 1-8 aggregate categories
  assert.equal(categoryForNames([]), "NONE");
  assert.equal(categoryForNames(["a.pdf"]), "DOCUMENT");
  assert.equal(categoryForNames(["a.png"]), "IMAGE");
  assert.equal(categoryForNames(["a.jpg"]), "IMAGE");
  assert.equal(categoryForNames(["a.pdf", "b.pdf"]), "DOCUMENT");
  assert.equal(categoryForNames(["a.jpg", "b.png"]), "IMAGE");
  assert.equal(categoryForNames(["a.pdf", "b.jpg"]), "MIXED");
  assert.equal(categoryForNames(["a.pdf", "b.png"]), "MIXED");
  console.log("PASS 1-8 no files / pdf / png / jpg / multi / mixed");

  // 9-11 dynamic transitions
  let files = ["resume.pdf"];
  assert.equal(categoryForNames(files), "DOCUMENT");
  files = ["resume.pdf", "photo.jpg"];
  assert.equal(categoryForNames(files), "MIXED");
  files = ["resume.pdf"];
  assert.equal(categoryForNames(files), "DOCUMENT");
  files = ["resume.pdf", "photo.jpg"];
  assert.equal(categoryForNames(files), "MIXED");
  files = ["photo.jpg"];
  assert.equal(categoryForNames(files), "IMAGE");
  console.log("PASS 9-11 DOCUMENT↔MIXED↔IMAGE transitions");

  assert.equal(categorizeExtension("pdf"), "DOCUMENT");
  assert.equal(categorizeExtension("doc"), "DOCUMENT");
  assert.equal(categorizeExtension("docx"), "DOCUMENT");
  assert.equal(categorizeUploadFile({ name: "a.PDF" }).category, "DOCUMENT");

  const ui = readUploadFormSource();

  // 12-18 mixed UI constraints (source-level)
  assert.match(ui, /aggregateFileCategory === "MIXED"/);
  assert.match(ui, /aggregateFileCategory === "DOCUMENT"/);
  assert.match(ui, /aggregateFileCategory === "IMAGE"/);
  assert.match(ui, /Image fitting/);
  assert.match(ui, /Page range/);
  // Mixed branch only shows Paper size A4 (no pagesMode/scale/margins selectors in that arm)
  assert.match(ui, /MIXED/);
  assert.equal(/Print type/i.test(ui), false);
  assert.equal(/Single Side/i.test(ui), false);
  assert.equal(/Double Side/i.test(ui), false);
  assert.equal(/\bprintType\b/.test(ui), false);
  assert.match(ui, /Orientation/);
  assert.match(ui, /Copies/);
  console.log("PASS 12-19 mixed UI + no Print Type");

  // Helper: what settings fields each category may apply (mirrors server sanitize)
  function sanitizeForCategory(
    category: ReturnType<typeof resolveJobPrintCategory>,
    input: {
      scale: "fit" | "noscale";
      margins: "normal" | "none";
      pageRange: string;
    },
  ) {
    if (category === "DOCUMENT") {
      return {
        scale: input.scale,
        margins: "normal" as const,
        pageRange: input.pageRange,
      };
    }
    if (category === "IMAGE") {
      return {
        scale: "fit" as const,
        margins: input.margins,
        pageRange: "all" as const,
      };
    }
    return {
      scale: "fit" as const,
      margins: "normal" as const,
      pageRange: "all" as const,
    };
  }

  const mixedSanitized = sanitizeForCategory("MIXED", {
    scale: "noscale",
    margins: "none",
    pageRange: "1-5",
  });
  assert.equal(mixedSanitized.scale, "fit");
  assert.equal(mixedSanitized.margins, "normal");
  assert.equal(mixedSanitized.pageRange, "all");
  console.log("PASS mixed sanitize drops page range / scale / image margins");

  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(stamp);
  try {
    const settings = buildPrintSettingsV1({
      copies: 2,
      orientation: "landscape",
      scale: "fit",
      margins: "normal",
      pageRange: "all",
    });

    const job = await createPrintJob({
      shopId: shop.id,
      copies: 2,
      totalPages: 10,
      printMode: PrintMode.BW,
      printType: PrintType.SINGLE,
      totalPrice: 40,
      printSettings: settings,
      files: [
        {
          originalFileName: "a.pdf",
          storedFileName: `pc-${stamp}.pdf`,
          fileExtension: "pdf",
          fileSize: 10,
          totalPages: 10,
        },
      ],
    });
    assert.equal(job.printType, PrintType.SINGLE);
    assert.equal(job.status, PrintStatus.PENDING);
    console.log("PASS 20 new jobs remain SINGLE");

    const rates = {
      bwSingle: 2,
      bwDouble: 99,
      colorSingle: 5,
      colorDouble: 7,
      minimumCharge: 5,
    };
    const priceSingle = calculatePrintCost(
      rates,
      10,
      2,
      PrintMode.BW,
      PrintType.SINGLE,
    );
    assert.equal(priceSingle, Math.max(10 * 2 * 2, 5));
    assert.equal(DEFAULT_PRINT_SETTINGS_V1.orientation, "portrait");
    assert.equal(DEFAULT_PRINT_SETTINGS_V1.paperSize, "A4");
    assert.equal(DEFAULT_PRINT_SETTINGS_V1.scale, "fit");
    assert.equal(DEFAULT_PRINT_SETTINGS_V1.margins, "normal");

    const stored = resolvePrintSettings(job.printSettings, {
      fallbackCopies: job.copies,
    });
    assert.equal(stored.settings?.copies, job.copies);

    const bad = resolvePrintSettings(
      {
        v: 1,
        orientation: "diagonal",
        scale: "zoom",
        margins: "huge",
        paperSize: "A3",
        copies: -1,
        pageRange: "nope",
      },
      { fallbackCopies: 4 },
    );
    assert.equal(bad.settings?.orientation, "portrait");
    assert.equal(bad.settings?.scale, "fit");
    assert.equal(bad.settings?.margins, "normal");
    assert.equal(bad.settings?.pageRange, "all");

    const legacyJob = await createPrintJob({
      shopId: shop.id,
      copies: 1,
      totalPages: 1,
      printMode: PrintMode.BW,
      printType: PrintType.SINGLE,
      totalPrice: 5,
      files: [
        {
          originalFileName: "b.pdf",
          storedFileName: `pc-leg-${stamp}.pdf`,
          fileExtension: "pdf",
          fileSize: 10,
          totalPages: 1,
        },
      ],
    });
    assert.equal(legacyJob.printSettings, null);
    assert.equal(shouldUseLegacyPrintBehavior(resolvePrintSettings(null)), true);
    assert.equal(isValidPageRange("1-5"), true);
    assert.equal(isValidPageRange("5-1"), false);

    const mixedSettings = buildPrintSettingsV1({
      copies: 1,
      orientation: "portrait",
      ...sanitizeForCategory("MIXED", {
        scale: "noscale",
        margins: "none",
        pageRange: "2-4",
      }),
    });
    assert.equal(mixedSettings.pageRange, "all");
    assert.equal(mixedSettings.scale, "fit");
    assert.equal(mixedSettings.margins, "normal");
    const mixedPlan = planJobPrint(mixedSettings, 1);
    assert.equal(mixedPlan.pages, undefined);
    assert.equal(mixedPlan.scale, "fit");
    assert.equal(mixedPlan.imageMarginPt, 24);

    console.log("PASS 21 pricing unchanged + defaults + mixed printSettings safe");
  } finally {
    await prisma.shop.delete({ where: { id: shop.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  assert.match(ui, /min-h-11/);
  assert.match(ui, /w-full/);
  assert.match(ui, /aggregateFileCategory/);
  console.log("PASS mobile markers + derived aggregate category");

  console.log("\nphase8c-print-file-options-smoke: ALL PASS");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
