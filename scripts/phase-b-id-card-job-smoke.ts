/**
 * Phase B — ID Card Front + Back → PrintJob integration smoke.
 * Run: npx tsx scripts/phase-b-id-card-job-smoke.ts
 *
 * Does not modify Agent, pricing formula, Prisma schema, or customer UI.
 */
import assert from "node:assert/strict";
import { access, constants } from "node:fs/promises";
import path from "path";

import { PDFDocument } from "pdf-lib";
import { PrintType, PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { submitPrintJobAction } from "../app/upload/[shopCode]/actions";
import { ID_CARD_A4_PORTRAIT_PT } from "../lib/id-card-layout";
import { JOB_MODE_ID_CARD_FRONT_BACK } from "../lib/id-card-upload";
import { calculatePrintCost, toPricingRates } from "../lib/pricing-service";
import { getStoredFilePath } from "../lib/storage";
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

async function pngFile(name: string) {
  return makeImageFile(name, "png", { r: 220, g: 220, b: 230 });
}

async function jpegFile(name: string) {
  return makeImageFile(name, "jpeg", { r: 210, g: 215, b: 220 });
}

async function makePdfFile(name: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const bytes = await pdf.save();
  return new File([Buffer.from(bytes)], name, { type: "application/pdf" });
}

function docxStub(name: string) {
  return new File([Buffer.from("PK\u0003\u0004docx-stub")], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `ID Card Shop ${code}`,
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
    include: { printPrice: true },
  });
}

function baseForm(shopCode: string, copies: number) {
  const formData = new FormData();
  formData.set("shopCode", shopCode);
  formData.set("copies", String(copies));
  formData.set("printMode", "BW");
  formData.set("orientation", "portrait");
  formData.set("scale", "fit");
  formData.set("margins", "normal");
  formData.set("pagesMode", "all");
  formData.set("pageRange", "");
  return formData;
}

async function submitIdCard(
  shopCode: string,
  front: File,
  back: File,
  copies = 1,
  extras?: File[],
) {
  const formData = baseForm(shopCode, copies);
  formData.set("jobMode", JOB_MODE_ID_CARD_FRONT_BACK);
  formData.set("front", front);
  formData.set("back", back);
  for (const extra of extras ?? []) {
    formData.append("files", extra);
  }
  return submitPrintJobAction(formData);
}

async function countJobs(shopId: string) {
  return prisma.printJob.count({ where: { shopId } });
}

async function loadJob(jobId: string) {
  return prisma.printJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { files: true },
  });
}

async function assertOnePageA4Pdf(storedFileName: string) {
  const filePath = getStoredFilePath(storedFileName);
  await access(filePath, constants.R_OK);
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(filePath);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const size = pdf.getPage(0).getSize();
  assert.equal(size.width, ID_CARD_A4_PORTRAIT_PT.width);
  assert.equal(size.height, ID_CARD_A4_PORTRAIT_PT.height);
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(`IC${stamp}`.slice(0, 12));
  const rates = toPricingRates(shop.printPrice!);
  const createdJobIds: string[] = [];

  try {
    // A — JPEG + JPEG
    {
      const before = await countJobs(shop.id);
      const result = await submitIdCard(
        shop.shopCode,
        await jpegFile("front.jpg"),
        await jpegFile("back.jpeg"),
        1,
      );
      assert.equal(result.success, true, String(result.error));
      assert.equal(result.data?.totalPages, 1);
      assert.equal(result.data?.copies, 1);
      const after = await countJobs(shop.id);
      assert.equal(after, before + 1);

      const job = await loadJob(result.data!.jobId);
      createdJobIds.push(job.id);
      assert.equal(job.files.length, 1);
      assert.equal(job.files[0]!.fileExtension, "pdf");
      assert.equal(job.files[0]!.totalPages, 1);
      assert.equal(job.totalPages, 1);
      assert.equal(job.printType, PrintType.SINGLE);
      assert.equal(Number(job.totalPrice), calculatePrintCost(rates, 1, 1, "BW", "SINGLE"));
      await assertOnePageA4Pdf(job.files[0]!.storedFileName);
      console.log("A PASS JPEG + JPEG → one job, one PDF file, totalPages=1");
    }

    // B — JPEG + PNG
    {
      const result = await submitIdCard(
        shop.shopCode,
        await jpegFile("front.jpg"),
        await pngFile("back.png"),
        1,
      );
      assert.equal(result.success, true, String(result.error));
      const job = await loadJob(result.data!.jobId);
      createdJobIds.push(job.id);
      assert.equal(job.files.length, 1);
      assert.equal(job.totalPages, 1);
      await assertOnePageA4Pdf(job.files[0]!.storedFileName);
      console.log("B PASS JPEG + PNG → same result");
    }

    // C — front missing
    {
      const before = await countJobs(shop.id);
      const formData = baseForm(shop.shopCode, 1);
      formData.set("jobMode", JOB_MODE_ID_CARD_FRONT_BACK);
      formData.set("back", await pngFile("back.png"));
      const result = await submitPrintJobAction(formData);
      assert.equal(result.success, false);
      assert.match(String(result.error), /front/i);
      assert.equal(await countJobs(shop.id), before);
      console.log("C PASS front missing → rejected, no job");
    }

    // D — back missing
    {
      const before = await countJobs(shop.id);
      const formData = baseForm(shop.shopCode, 1);
      formData.set("jobMode", JOB_MODE_ID_CARD_FRONT_BACK);
      formData.set("front", await pngFile("front.png"));
      const result = await submitPrintJobAction(formData);
      assert.equal(result.success, false);
      assert.match(String(result.error), /back/i);
      assert.equal(await countJobs(shop.id), before);
      console.log("D PASS back missing → rejected, no job");
    }

    // E — PDF as a side
    {
      const before = await countJobs(shop.id);
      const result = await submitIdCard(
        shop.shopCode,
        await makePdfFile("front.pdf"),
        await pngFile("back.png"),
      );
      assert.equal(result.success, false);
      assert.equal(await countJobs(shop.id), before);
      console.log("E PASS PDF side → rejected");
    }

    // F — DOCX as a side
    {
      const before = await countJobs(shop.id);
      const result = await submitIdCard(
        shop.shopCode,
        await pngFile("front.png"),
        docxStub("back.docx"),
      );
      assert.equal(result.success, false);
      assert.equal(await countJobs(shop.id), before);
      console.log("F PASS DOCX side → rejected");
    }

    // G — three source images (extra files)
    {
      const before = await countJobs(shop.id);
      const result = await submitIdCard(
        shop.shopCode,
        await pngFile("front.png"),
        await pngFile("back.png"),
        1,
        [await pngFile("extra.png")],
      );
      assert.equal(result.success, false);
      assert.equal(await countJobs(shop.id), before);
      console.log("G PASS three sources → rejected");
    }

    // H — copies = 1 pricing (1 page)
    {
      const result = await submitIdCard(
        shop.shopCode,
        await pngFile("front.png"),
        await pngFile("back.png"),
        1,
      );
      assert.equal(result.success, true, String(result.error));
      createdJobIds.push(result.data!.jobId);
      const expected = calculatePrintCost(rates, 1, 1, "BW", "SINGLE");
      assert.equal(result.data!.totalPrice, expected);
      assert.equal(result.data!.totalPages, 1);
      console.log("H PASS copies=1 → pricing uses 1 page");
    }

    // I — copies > 1 preserves copies behavior
    {
      const result = await submitIdCard(
        shop.shopCode,
        await pngFile("front.png"),
        await pngFile("back.png"),
        3,
      );
      assert.equal(result.success, true, String(result.error));
      createdJobIds.push(result.data!.jobId);
      const job = await loadJob(result.data!.jobId);
      assert.equal(job.copies, 3);
      assert.equal(job.totalPages, 1);
      const expected = calculatePrintCost(rates, 1, 3, "BW", "SINGLE");
      assert.equal(Number(job.totalPrice), expected);
      console.log("I PASS copies=3 → existing copies pricing preserved");
    }

    // J — normal upload unchanged (no jobMode)
    {
      const formData = baseForm(shop.shopCode, 1);
      formData.append("files", await makePdfFile("normal.pdf"));
      formData.append("files", await pngFile("photo.png"));
      const result = await submitPrintJobAction(formData);
      assert.equal(result.success, true, String(result.error));
      createdJobIds.push(result.data!.jobId);
      const job = await loadJob(result.data!.jobId);
      assert.equal(job.files.length, 2);
      assert.equal(job.totalPages, 2); // pdf 1 + image 1
      assert.equal(
        Number(job.totalPrice),
        calculatePrintCost(rates, 2, 1, "BW", "SINGLE"),
      );
      console.log("J PASS normal upload flow unchanged");
    }

    // K — already covered via assertOnePageA4Pdf in A/B
    console.log("K PASS generated artifact is valid one-page A4 PDF");

    // Privacy — only one PrintJobFile (PDF); no front/back stored names
    {
      const job = await loadJob(createdJobIds[0]!);
      assert.equal(job.files.length, 1);
      assert.equal(job.files[0]!.fileExtension, "pdf");
      assert.equal(path.extname(job.files[0]!.storedFileName), ".pdf");
      assert.ok(!/front|back/i.test(job.files[0]!.storedFileName));
      console.log("Privacy PASS only generated PDF is the job artifact");
    }

    console.log("\nPhase B ID card job smoke tests passed.");
  } finally {
    // Cleanup created jobs + disk files for this shop
    const jobs = await prisma.printJob.findMany({
      where: { shopId: shop.id },
      include: { files: true },
    });
    for (const job of jobs) {
      for (const file of job.files) {
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(getStoredFilePath(file.storedFileName));
        } catch {
          // ignore
        }
      }
    }
    await prisma.printJobFile.deleteMany({
      where: { printJob: { shopId: shop.id } },
    });
    await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
    await prisma.subscription.deleteMany({ where: { shopId: shop.id } });
    await prisma.inventory.deleteMany({ where: { shopId: shop.id } });
    await prisma.settings.deleteMany({ where: { shopId: shop.id } });
    await prisma.printPrice.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
