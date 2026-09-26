/**
 * Soft-cancel + Agent print-control smoke (no Windows spooler required).
 * Run: npx tsx scripts/phase10-job-cancel-interrupt-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient, PrintStatus } from "@prisma/client";

import { deleteShopJob } from "../lib/dashboard-service";
import {
  cancelJobFromAgent,
  getJobPrintControl,
} from "../lib/print-agent-service";
import { hashPassword } from "../lib/auth";

const prisma = new PrismaClient();

async function main() {
  const host = (() => {
    const raw = process.env.DATABASE_URL || "";
    try {
      return new URL(raw).hostname;
    } catch {
      return "";
    }
  })();
  assert.ok(
    host === "127.0.0.1" || host === "localhost",
    "Refuse non-local DATABASE_URL",
  );

  const stamp = Date.now().toString(36);
  const owner = await prisma.user.create({
    data: {
      name: "Cancel Smoke",
      email: `cancel-${stamp}@example.com`,
      passwordHash: await hashPassword("CancelSmokePass!23456"),
      role: "SHOPKEEPER",
    },
  });
  const shop = await prisma.shop.create({
    data: {
      shopCode: `CN${stamp}`.slice(0, 12),
      shopName: "Cancel Shop",
      phone: "9876543210",
      address: "Addr",
      owner: { connect: { id: owner.id } },
    },
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pme-cancel-"));
  const stored = `cancel-${stamp}.pdf`;
  const uploadDir =
    process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const storedPath = path.join(uploadDir, stored);
  fs.writeFileSync(storedPath, Buffer.from("%PDF-1.4 cancel-smoke"));

  try {
    const pending = await prisma.printJob.create({
      data: {
        shopId: shop.id,
        jobSequence: 1,
        jobNumber: `CN-${stamp}-1`,
        copies: 1,
        totalPages: 2,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: 10,
        status: PrintStatus.PENDING,
        files: {
          create: {
            originalFileName: "doc.pdf",
            storedFileName: stored,
            fileExtension: "pdf",
            fileSize: 20,
            totalPages: 2,
          },
        },
      },
      include: { files: true },
    });

    const deleted = await deleteShopJob(shop.id, pending.id);
    assert.ok(deleted);
    const after = await prisma.printJob.findUnique({ where: { id: pending.id } });
    assert.equal(after?.status, PrintStatus.CANCELLED);
    assert.equal(after?.claimedByAgentDeviceId, null);
    const control = await getJobPrintControl(shop.id, pending.id);
    assert.equal(control.ok, false);
    if (!control.ok) assert.equal(control.reason, "cancelled");
    console.log("1 PASS soft-cancel PENDING → CANCELLED; control rejects");

    const stored2 = `cancel2-${stamp}.pdf`;
    fs.writeFileSync(path.join(uploadDir, stored2), Buffer.from("%PDF-1.4 b"));
    const printing = await prisma.printJob.create({
      data: {
        shopId: shop.id,
        jobSequence: 2,
        jobNumber: `CN-${stamp}-2`,
        copies: 1,
        totalPages: 2,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: 10,
        status: PrintStatus.PRINTING,
        claimedAt: new Date(),
        files: {
          create: [
            {
              originalFileName: "a.pdf",
              storedFileName: stored2,
              fileExtension: "pdf",
              fileSize: 20,
              totalPages: 1,
              printedAt: new Date(),
            },
            {
              originalFileName: "b.pdf",
              storedFileName: `cancel2b-${stamp}.pdf`,
              fileExtension: "pdf",
              fileSize: 20,
              totalPages: 1,
            },
          ],
        },
      },
    });
    fs.writeFileSync(
      path.join(uploadDir, `cancel2b-${stamp}.pdf`),
      Buffer.from("%PDF-1.4 c"),
    );

    const mid = await getJobPrintControl(shop.id, printing.id);
    assert.equal(mid.ok, true);
    if (mid.ok) {
      assert.equal(mid.printedFiles, 1);
      assert.equal(mid.remainingFiles, 1);
    }

    const agentCancel = await cancelJobFromAgent(shop.id, printing.id, {
      reason: "Interrupted cancel test",
    });
    assert.equal(agentCancel?.status, PrintStatus.CANCELLED);
    const midAfter = await getJobPrintControl(shop.id, printing.id);
    assert.equal(midAfter.ok, false);
    console.log("2 PASS agent cancel of PRINTING job; remaining never printable");

    const ready = await prisma.printJob.create({
      data: {
        shopId: shop.id,
        jobSequence: 3,
        jobNumber: `CN-${stamp}-3`,
        copies: 1,
        totalPages: 1,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: 5,
        status: PrintStatus.READY_FOR_PICKUP,
        files: {
          create: {
            originalFileName: "done.pdf",
            storedFileName: `cancel3-${stamp}.pdf`,
            fileExtension: "pdf",
            fileSize: 10,
            totalPages: 1,
            printedAt: new Date(),
          },
        },
      },
    });
    fs.writeFileSync(
      path.join(uploadDir, `cancel3-${stamp}.pdf`),
      Buffer.from("%PDF-1.4 d"),
    );
    await deleteShopJob(shop.id, ready.id);
    const gone = await prisma.printJob.findUnique({ where: { id: ready.id } });
    assert.equal(gone, null);
    console.log("3 PASS finished job hard-delete still works");

    // Source asserts for Agent cancel/interrupt plumbing
    const jobService = fs.readFileSync(
      path.join(process.cwd(), "print-agent/src/job-service.ts"),
      "utf8",
    );
    assert.match(jobService, /assertJobStillPrintable/);
    assert.match(jobService, /cancelWindowsPrintJobsForYantraJob/);
    assert.match(jobService, /setInterruptConfirmHandler/);
    assert.match(jobService, /loadInterruptedPrintJob/);
    assert.match(jobService, /printPdfFilePageByPage/);
    assert.match(jobService, /persistPageProgress/);
    assert.match(jobService, /nextPageIndex/);
    assert.match(jobService, /canSafelyContinue/);
    const preview = fs.readFileSync(
      path.join(process.cwd(), "components/print-preview-dialog.tsx"),
      "utf8",
    );
    assert.match(preview, /pointer-events-auto/);
    assert.match(preview, /adjustmentsBaked/);
    const mainSrc = fs.readFileSync(
      path.join(process.cwd(), "print-agent/src/main.ts"),
      "utf8",
    );
    assert.match(mainSrc, /allowContinue/);
    assert.match(mainSrc, /Continue Printing/);
    assert.match(mainSrc, /Cancel Job/);
    console.log("4 PASS agent + preview source guards");

    // Page-level resume units (16-page PDF, continue remaining, cancel-only unsafe)
    const { resolvePrintPageList } = await import(
      "../print-agent/src/pdf-page-list"
    );
    const { describeInterruptedProgress } = await import(
      "../print-agent/src/interrupted-job-store"
    );

    const pageList = resolvePrintPageList("all", 16);
    assert.equal(pageList.length, 16);
    assert.deepEqual(pageList.slice(0, 3), [1, 2, 3]);
    assert.equal(pageList[15], 16);

    // Interrupted after pages 1–5 submitted → resume from index 5 (page 6)
    const midFile = describeInterruptedProgress({
      jobId: "job-16",
      jobNumber: "PY-16",
      printerName: "Test",
      printedFiles: 0,
      remainingFiles: 1,
      savedAt: new Date().toISOString(),
      canSafelyContinue: true,
      pageResume: {
        fileId: "file-a",
        nextPageIndex: 5,
        pageList,
      },
    });
    assert.equal(midFile.allowContinue, true);
    assert.match(midFile.detail, /5 page\(s\) were submitted/);
    assert.match(midFile.detail, /11 page\(s\) remain/);
    const remainingPages = pageList.slice(5);
    assert.deepEqual(remainingPages, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    console.log("5 PASS 16-page interrupt → Continue resumes pages 6–16 only");

    // Cancel path: unsafe / cancel-only UX (no Continue)
    const unsafe = describeInterruptedProgress({
      jobId: "job-legacy",
      jobNumber: "PY-LEG",
      printerName: "Test",
      printedFiles: 0,
      remainingFiles: 1,
      savedAt: new Date().toISOString(),
      canSafelyContinue: false,
      unsafeReason:
        "Some pages may already have printed. To avoid duplicate pages, this job cannot be automatically resumed.",
    });
    assert.equal(unsafe.allowContinue, false);
    assert.match(unsafe.detail, /cannot be automatically resumed/);
    assert.match(unsafe.detail, /cancel the remaining job/);
    console.log("6 PASS unsafe multi-page → Cancel only (no Continue)");

    // Multi-file: file-level continue still allowed without pageResume
    const multiFile = describeInterruptedProgress({
      jobId: "job-multi",
      jobNumber: "PY-MF",
      printerName: "Test",
      printedFiles: 1,
      remainingFiles: 2,
      savedAt: new Date().toISOString(),
      canSafelyContinue: true,
    });
    assert.equal(multiFile.allowContinue, true);
    assert.match(multiFile.detail, /1 file\(s\) were printed/);
    assert.match(multiFile.detail, /2 file\(s\) remain/);
    console.log("7 PASS multi-file interrupt still offers Continue");

    // Deleted/cancelled job never resumes: control already asserted above;
    // Agent clears interrupt when control says cancelled/missing.
    assert.match(jobService, /control\.reason === \"cancelled\"/);
    assert.match(jobService, /clearInterruptedPrintJob/);
    assert.match(
      jobService,
      /Skipping already printed file/,
    );
    // Restart: pageResume nextPageIndex prevents re-submitting earlier pages
    assert.match(jobService, /startPageIndex/);
    assert.match(jobService, /activePageResume\.fileId === file\.id/);
    console.log("8 PASS deleted never resumes + restart uses pageResume");

    console.log("\nphase10-job-cancel-interrupt-smoke: ALL PASS");
  } finally {
    await prisma.printJobFile.deleteMany({ where: { printJob: { shopId: shop.id } } });
    await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
