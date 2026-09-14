/**
 * Phase E1 — Optional customer print preview smoke (server-side).
 * Run: npx tsx scripts/phase-e1-preview-smoke.ts
 *
 * Does not require a browser. Verifies ID-card preview composition path,
 * no PrintJob / billing / persistent raw sides, and regression of submit.
 */
import assert from "node:assert/strict";
import { access, constants, readdir } from "node:fs/promises";
import path from "path";

import { PDFDocument } from "pdf-lib";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

import {
  previewIdCardPdfAction,
  submitPrintJobAction,
} from "../app/upload/[shopCode]/actions";
import { classifyPreviewExtension } from "../components/print-preview-dialog";
import { buildIdCardPreviewFormData } from "../lib/id-card-client";
import {
  ID_CARD_A4_PORTRAIT_PT,
} from "../lib/id-card-layout";
import {
  composeIdCardPdfInMemory,
  JOB_MODE_ID_CARD_FRONT_BACK,
  validateIdCardFormFiles,
} from "../lib/id-card-upload";
import { getUploadDir } from "../lib/storage";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function makeImageFile(
  name: string,
  format: "png" | "jpeg",
  color: { r: number; g: number; b: number },
) {
  const pipeline = sharp({
    create: {
      width: 64,
      height: 40,
      channels: 3,
      background: color,
    },
  });
  const bytes =
    format === "png"
      ? await pipeline.png().toBuffer()
      : await pipeline.jpeg({ quality: 90 }).toBuffer();
  return new File([bytes], name, {
    type: format === "png" ? "image/png" : "image/jpeg",
  });
}

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `Preview Shop ${code}`,
      phone: "9000000001",
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

async function listUploadNames(): Promise<Set<string>> {
  try {
    const dir = getUploadDir();
    const names = await readdir(dir);
    return new Set(names);
  } catch {
    return new Set();
  }
}

async function main() {
  const shop = await createShop(`PREVE1${Date.now().toString(36).toUpperCase()}`);
  const front = await makeImageFile("front.jpg", "jpeg", {
    r: 220,
    g: 220,
    b: 230,
  });
  const back = await makeImageFile("back.png", "png", {
    r: 210,
    g: 215,
    b: 220,
  });

  const beforeJobs = await prisma.printJob.count({ where: { shopId: shop.id } });
  const beforeUploads = await listUploadNames();

  // A — ID-card preview generation succeeds
  {
    const formData = buildIdCardPreviewFormData({
      shopCode: shop.shopCode,
      front,
      back,
    });
    const result = await previewIdCardPdfAction(formData);
    assert.equal(result.success, true);
    assert.ok(result.data?.pdfBase64);
    assert.ok(result.data!.pdfBase64.length > 100);
    console.log("A PASS ID-card preview generation succeeds");
  }

  // B — exactly one A4 page
  {
    const formData = buildIdCardPreviewFormData({
      shopCode: shop.shopCode,
      front,
      back,
    });
    const result = await previewIdCardPdfAction(formData);
    assert.equal(result.data?.pageCount, 1);
    assert.equal(result.data?.widthPt, ID_CARD_A4_PORTRAIT_PT.width);
    assert.equal(result.data?.heightPt, ID_CARD_A4_PORTRAIT_PT.height);
    const bytes = Buffer.from(result.data!.pdfBase64, "base64");
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    const page = pdf.getPage(0);
    const { width, height } = page.getSize();
    assert.equal(Math.round(width), ID_CARD_A4_PORTRAIT_PT.width);
    assert.equal(Math.round(height), ID_CARD_A4_PORTRAIT_PT.height);
    console.log("B PASS ID-card preview produces exactly one A4 page");
  }

  // C — front/back both present (validation)
  {
    const formData = buildIdCardPreviewFormData({
      shopCode: shop.shopCode,
      front,
      back,
    });
    const sides = validateIdCardFormFiles(formData);
    assert.equal(sides.ok, true);
    if (sides.ok) {
      assert.ok(sides.front.size > 0);
      assert.ok(sides.back.size > 0);
    }
    console.log("C PASS front/back both present");
  }

  // D — shared in-memory composition path (same as submit uses)
  {
    const composed = await composeIdCardPdfInMemory(front, back);
    assert.equal(composed.pageCount, 1);
    assert.ok(composed.pdfBytes.byteLength > 0);
    console.log("D PASS normalization invoked through shared compose path");
  }

  // E — no PrintJob created by preview
  {
    const afterJobs = await prisma.printJob.count({ where: { shopId: shop.id } });
    assert.equal(afterJobs, beforeJobs);
    console.log("E PASS no PrintJob created");
  }

  // F — no billing/payment state changes
  {
    const sub = await prisma.subscription.findFirst({
      where: { shopId: shop.id },
    });
    assert.ok(sub);
    // Preview must not touch subscription records
    const formData = buildIdCardPreviewFormData({
      shopCode: shop.shopCode,
      front,
      back,
    });
    await previewIdCardPdfAction(formData);
    const subAfter = await prisma.subscription.findFirst({
      where: { shopId: shop.id },
    });
    assert.equal(subAfter?.id, sub?.id);
    assert.equal(String(subAfter?.updatedAt), String(sub?.updatedAt));
    console.log("F PASS no billing/subscription state changes");
  }

  // G — no persistent raw front/back (and no new upload artifacts from preview)
  {
    const afterUploads = await listUploadNames();
    for (const name of afterUploads) {
      if (!beforeUploads.has(name)) {
        // Preview must not write job artifacts; ignore unrelated concurrent files.
        assert.fail(`Unexpected new upload file after preview: ${name}`);
      }
    }
    console.log("G PASS no persistent raw front/back files created");
  }

  // H — missing front rejected
  {
    const formData = new FormData();
    formData.set("shopCode", shop.shopCode);
    formData.set("back", back);
    const result = await previewIdCardPdfAction(formData);
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /front/i);
    console.log("H PASS missing front rejected cleanly");
  }

  // I — missing back rejected
  {
    const formData = new FormData();
    formData.set("shopCode", shop.shopCode);
    formData.set("front", front);
    const result = await previewIdCardPdfAction(formData);
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /back/i);
    console.log("I PASS missing back rejected cleanly");
  }

  // J — invalid image rejected
  {
    const bad = new File([Buffer.from("not-an-image")], "front.jpg", {
      type: "image/jpeg",
    });
    const formData = buildIdCardPreviewFormData({
      shopCode: shop.shopCode,
      front: bad,
      back,
    });
    const result = await previewIdCardPdfAction(formData);
    assert.equal(result.success, false);
    assert.ok(result.error);
    console.log("J PASS invalid image rejected");
  }

  // K — existing ID-card submission still works
  {
    const formData = new FormData();
    formData.set("shopCode", shop.shopCode);
    formData.set("copies", "1");
    formData.set("printMode", "BW");
    formData.set("jobMode", JOB_MODE_ID_CARD_FRONT_BACK);
    formData.set("orientation", "portrait");
    formData.set("scale", "fit");
    formData.set("margins", "normal");
    formData.set("pagesMode", "all");
    formData.set("pageRange", "");
    formData.set("front", front);
    formData.set("back", back);
    const result = await submitPrintJobAction(formData);
    assert.equal(result.success, true);
    assert.equal(result.data?.totalPages, 1);
    assert.ok(result.data?.jobNumber);
    const job = await prisma.printJob.findUniqueOrThrow({
      where: { id: result.data!.jobId },
      include: { files: true },
    });
    assert.equal(job.files.length, 1);
    assert.equal(job.files[0]!.fileExtension.toLowerCase(), "pdf");
    const stored = path.join(
      getUploadDir(),
      job.files[0]!.storedFileName,
    );
    await access(stored, constants.R_OK);
    console.log("K PASS existing ID-card submission still works");
  }

  // L — normal upload behavior + client preview classification
  {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const pdfBytes = await pdf.save();
    const pdfFile = new File([Buffer.from(pdfBytes)], "doc.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.set("shopCode", shop.shopCode);
    formData.set("copies", "1");
    formData.set("printMode", "BW");
    formData.set("orientation", "portrait");
    formData.set("scale", "fit");
    formData.set("margins", "normal");
    formData.set("pagesMode", "all");
    formData.set("pageRange", "");
    formData.append("files", pdfFile);
    const result = await submitPrintJobAction(formData);
    assert.equal(result.success, true);
    assert.ok((result.data?.totalPages ?? 0) >= 1);

    assert.equal(classifyPreviewExtension("photo.jpg"), "image");
    assert.equal(classifyPreviewExtension("scan.PNG"), "image");
    assert.equal(classifyPreviewExtension("file.pdf"), "pdf");
    assert.equal(classifyPreviewExtension("notes.docx"), "unavailable");
    console.log("L PASS normal upload unchanged + preview classification");
  }

  // cleanup
  const jobs = await prisma.printJob.findMany({
    where: { shopId: shop.id },
    include: { files: true },
  });
  await prisma.printJobFile.deleteMany({
    where: { printJobId: { in: jobs.map((j) => j.id) } },
  });
  await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
  await prisma.subscription.deleteMany({ where: { shopId: shop.id } });
  await prisma.inventory.deleteMany({ where: { shopId: shop.id } });
  await prisma.settings.deleteMany({ where: { shopId: shop.id } });
  await prisma.printPrice.deleteMany({ where: { shopId: shop.id } });
  await prisma.shop.delete({ where: { id: shop.id } });
  await prisma.$disconnect();

  console.log("\nPhase E1 preview smoke tests passed.");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
