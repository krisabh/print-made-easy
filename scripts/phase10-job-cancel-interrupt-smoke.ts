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
  claimJob,
  getJobPrintControl,
  listOwnedPrintingJobs,
  listPendingJobsForShop,
  releaseJobToPending,
} from "../lib/print-agent-service";
import { hashPassword } from "../lib/auth";
import { spoolJobMatchesYantraJob } from "../print-agent/src/windows-print-jobs";
import { resolvePrintPageList } from "../print-agent/src/pdf-page-list";

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

    // Source asserts: cancellation stays, automatic resume popup is gone
    const jobService = fs.readFileSync(
      path.join(process.cwd(), "print-agent/src/job-service.ts"),
      "utf8",
    );
    assert.match(jobService, /assertJobStillPrintable/);
    assert.match(jobService, /cancelWindowsPrintJobsForYantraJob/);
    assert.match(jobService, /printPdfFilePageByPage/);
    assert.match(jobService, /abandonOwnedPrintingJobs/);
    assert.equal(jobService.includes("Continue Printing"), false);
    assert.equal(jobService.includes("setInterruptConfirmHandler"), false);
    assert.equal(jobService.includes("reportJobFailed"), false);
    assert.equal(jobService.includes("handleInterruptedDecision"), false);
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
    assert.equal(mainSrc.includes("Continue Printing"), false);
    assert.equal(mainSrc.includes("setInterruptConfirmHandler"), false);
    const serviceSrc = fs.readFileSync(
      path.join(process.cwd(), "lib/print-agent-service.ts"),
      "utf8",
    );
    assert.equal(
      serviceSrc.includes("Recovered stale PRINTING job after Agent disconnect."),
      false,
    );
    assert.match(serviceSrc, /automatic resume/i);
    console.log("4 PASS cancel plumbing kept; resume popup removed");

    // 16-page custom range still selects only those pages (no auto-resume)
    const pageList = resolvePrintPageList("all", 16);
    assert.equal(pageList.length, 16);
    const custom = resolvePrintPageList("6-16", 16);
    assert.deepEqual(custom, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    console.log("5 PASS custom page range 6-16 still works");

    // Spooler identity: job number in Sumatra document / recorded name
    assert.equal(
      spoolJobMatchesYantraJob(
        {
          document: "PrintYantra-CN-1-file.pdf",
          name: "HP LaserJet, 4",
        },
        "CN-1",
      ),
      true,
    );
    assert.equal(
      spoolJobMatchesYantraJob(
        { document: "other-customer.pdf", name: "HP LaserJet, 9" },
        "CN-1",
      ),
      false,
    );
    console.log("6 PASS spooler match uses job number and ignores unrelated jobs");

    // Claim after cancel must fail (PENDING delete race)
    const claimAfter = await claimJob(shop.id, pending.id, {
      agentDeviceId: null,
    });
    assert.equal(claimAfter, null);
    const stillCancelled = await getJobPrintControl(shop.id, pending.id);
    assert.equal(stillCancelled.ok, false);
    console.log("7 PASS claim after PENDING delete returns null");

    // PRINTING delete then release must not return the job to the queue
    const storedRace = `cancel-race-${stamp}.pdf`;
    fs.writeFileSync(
      path.join(uploadDir, storedRace),
      Buffer.from("%PDF-1.4 race"),
    );
    const racing = await prisma.printJob.create({
      data: {
        shopId: shop.id,
        jobSequence: 4,
        jobNumber: `CN-${stamp}-4`,
        copies: 1,
        totalPages: 16,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: 10,
        status: PrintStatus.PRINTING,
        claimedAt: new Date(),
        files: {
          create: {
            originalFileName: "sixteen.pdf",
            storedFileName: storedRace,
            fileExtension: "pdf",
            fileSize: 20,
            totalPages: 16,
          },
        },
      },
    });
    await deleteShopJob(shop.id, racing.id);
    const released = await releaseJobToPending(
      shop.id,
      racing.id,
      "should not retry",
    );
    assert.equal(released, null);
    const afterRace = await prisma.printJob.findUnique({
      where: { id: racing.id },
    });
    assert.equal(afterRace?.status, PrintStatus.CANCELLED);
    const pendingList = await listPendingJobsForShop(shop.id);
    assert.equal(
      pendingList.some((job) => job.id === racing.id),
      false,
    );
    const owned = await listOwnedPrintingJobs(shop.id);
    assert.equal(
      owned.some((job) => job.id === racing.id),
      false,
    );
    console.log("8 PASS PRINTING delete is not released back to PENDING");

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
