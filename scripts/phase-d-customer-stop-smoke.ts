/**
 * Customer STOP PRINTING smoke.
 * Run: npx tsx scripts/phase-d-customer-stop-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, PrintStatus } from "@prisma/client";

import { hashPassword } from "../lib/auth";
import {
  CUSTOMER_CANCEL_REASON,
  SHOPKEEPER_CANCEL_REASON,
  cancelCustomerOwnedJob,
  deleteShopJob,
} from "../lib/dashboard-service";
import { releaseJobToPending } from "../lib/print-agent-service";

const prisma = new PrismaClient();

function assertLocalDb() {
  const raw = process.env.DATABASE_URL || "";
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    host = "";
  }
  assert.ok(host === "127.0.0.1" || host === "localhost", "Refuse non-local DATABASE_URL");
}

async function main() {
  assertLocalDb();
  const stamp = Date.now().toString(36);
  const owner = await prisma.user.create({
    data: {
      name: "Customer Stop",
      email: `cust-stop-${stamp}@example.com`,
      passwordHash: await hashPassword("CustomerStopPass!23456"),
      role: "SHOPKEEPER",
    },
  });
  const shop = await prisma.shop.create({
    data: {
      shopCode: `CS${stamp}`.slice(0, 12),
      shopName: "Customer Stop Shop",
      phone: "9876543210",
      address: "Addr",
      owner: { connect: { id: owner.id } },
    },
  });
  const otherOwner = await prisma.user.create({
    data: {
      name: "Other Customer",
      email: `cust-stop-b-${stamp}@example.com`,
      passwordHash: await hashPassword("CustomerStopPass!23456"),
      role: "SHOPKEEPER",
    },
  });
  const other = await prisma.shop.create({
    data: {
      shopCode: `CO${stamp}`.slice(0, 12),
      shopName: "Other Shop",
      phone: "9876543211",
      address: "Other",
      owner: { connect: { id: otherOwner.id } },
    },
  });

  const uploadDir =
    process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });

  async function makeJob(
    sequence: number,
    status: PrintStatus,
    pages = 8,
  ) {
    const stored = `cust-stop-${stamp}-${sequence}.pdf`;
    fs.writeFileSync(path.join(uploadDir, stored), Buffer.from("%PDF-1.4 stop"));
    return prisma.printJob.create({
      data: {
        shopId: shop.id,
        jobSequence: sequence,
        jobNumber: `CS-${stamp}-${sequence}`,
        copies: 1,
        totalPages: pages,
        printMode: "BW",
        printType: "SINGLE",
        totalPrice: 10,
        status,
        claimedAt: status === PrintStatus.PRINTING ? new Date() : null,
        files: {
          create: {
            originalFileName: "doc.pdf",
            storedFileName: stored,
            fileExtension: "pdf",
            fileSize: 20,
            totalPages: pages,
          },
        },
      },
    });
  }

  try {
    const pending = await makeJob(1, PrintStatus.PENDING);
    const stopped = await cancelCustomerOwnedJob(shop.shopCode, pending.id);
    assert.equal(stopped.outcome, "cancelled");
    const pendingAfter = await prisma.printJob.findUniqueOrThrow({
      where: { id: pending.id },
    });
    assert.equal(pendingAfter.status, PrintStatus.CANCELLED);
    assert.equal(pendingAfter.lastError, CUSTOMER_CANCEL_REASON);
    assert.equal(pendingAfter.claimedByAgentDeviceId, null);
    console.log("1 PASS customer cancels own PENDING job");

    const printing = await makeJob(2, PrintStatus.PRINTING);
    const mid = await cancelCustomerOwnedJob(shop.shopCode, printing.id);
    assert.equal(mid.outcome, "cancelled");
    const printingAfter = await prisma.printJob.findUniqueOrThrow({
      where: { id: printing.id },
    });
    assert.equal(printingAfter.status, PrintStatus.CANCELLED);
    const released = await releaseJobToPending(
      shop.id,
      printing.id,
      "should not retry",
    );
    assert.equal(released, null);
    const still = await prisma.printJob.findUniqueOrThrow({
      where: { id: printing.id },
    });
    assert.equal(still.status, PrintStatus.CANCELLED);
    console.log("2 PASS customer cancels own PRINTING job; it stays cancelled");

    const foreign = await makeJob(3, PrintStatus.PENDING);
    const denied = await cancelCustomerOwnedJob(other.shopCode, foreign.id);
    assert.equal(denied.outcome, "not_found");
    const foreignAfter = await prisma.printJob.findUniqueOrThrow({
      where: { id: foreign.id },
    });
    assert.equal(foreignAfter.status, PrintStatus.PENDING);
    assert.equal(foreignAfter.lastError, null);
    console.log("3 PASS another shop code cannot cancel the job");

    const again = await cancelCustomerOwnedJob(shop.shopCode, pending.id);
    assert.equal(again.outcome, "already_cancelled");
    const once = await prisma.printJob.findUniqueOrThrow({
      where: { id: pending.id },
    });
    assert.equal(once.status, PrintStatus.CANCELLED);
    assert.equal(once.lastError, CUSTOMER_CANCEL_REASON);
    console.log("4 PASS a second stop does not rewrite the cancelled job");

    const done = await makeJob(4, PrintStatus.READY_FOR_PICKUP, 8);
    const late = await cancelCustomerOwnedJob(shop.shopCode, done.id);
    assert.equal(late.outcome, "not_active");
    if (late.outcome === "not_active") {
      assert.equal(late.job.status, PrintStatus.READY_FOR_PICKUP);
    }
    const doneAfter = await prisma.printJob.findUniqueOrThrow({
      where: { id: done.id },
    });
    assert.equal(doneAfter.status, PrintStatus.READY_FOR_PICKUP);
    assert.notEqual(doneAfter.lastError, CUSTOMER_CANCEL_REASON);
    console.log("5 PASS a finished job is not reported as cancelled");

    const keeper = await makeJob(5, PrintStatus.PRINTING);
    const keeperResult = await deleteShopJob(shop.id, keeper.id);
    assert.ok(keeperResult);
    assert.equal(
      "stopApplied" in keeperResult && keeperResult.stopApplied,
      true,
    );
    const keeperAfter = await prisma.printJob.findUniqueOrThrow({
      where: { id: keeper.id },
    });
    assert.equal(keeperAfter.status, PrintStatus.CANCELLED);
    assert.equal(keeperAfter.lastError, SHOPKEEPER_CANCEL_REASON);
    console.log("6 PASS shopkeeper stop still uses the shopkeeper reason");

    const root = process.cwd();
    const upload = fs.readFileSync(
      path.join(root, "components/upload-form.tsx"),
      "utf8",
    );
    const board = fs.readFileSync(
      path.join(root, "components/dashboard/jobs-board.tsx"),
      "utf8",
    );
    const route = fs.readFileSync(
      path.join(root, "app/api/customer/jobs/[jobId]/route.ts"),
      "utf8",
    );
    const dashboardRoute = fs.readFileSync(
      path.join(root, "app/api/dashboard/jobs/[jobId]/route.ts"),
      "utf8",
    );
    assert.match(upload, /STOP PRINTING/);
    assert.match(upload, /Stopping print\.\.\./);
    assert.match(
      upload,
      /Amount shown before cancellation is not the final amount\./,
    );
    assert.match(upload, /liveStatus === "CANCELLED" \? null :/);
    assert.match(board, /Amount not finalized/);
    assert.equal(upload.includes("partial refund"), false);
    assert.equal(board.includes("partial refund"), false);
    assert.match(upload, /The remaining pages will not be printed\./);
    assert.match(upload, /Job cancelled\./);
    assert.equal(upload.includes("pages were printed"), false);
    assert.equal(upload.includes("of ${"), false);
    assert.equal(/window\.confirm\(/.test(upload), false);
    assert.match(upload, /stoppingRef\.current/);
    assert.match(upload, /STATUS_POLL_MS/);
    assert.match(upload, /method: "POST"/);
    assert.equal(route.includes("searchParams.get(\"shopId\")"), false);
    assert.equal(route.includes("body.shopId"), false);
    assert.match(route, /cancelCustomerOwnedJob/);
    assert.match(dashboardRoute, /deleteShopJob/);
    assert.match(board, /STOP JOB/);
    const stopFn = board.slice(
      board.indexOf("async function handleStopJob"),
      board.indexOf("async function handleDeleteJob"),
    );
    assert.equal(stopFn.includes("window.confirm"), false);
    console.log("7 PASS customer UI has no confirm dialog and no invented page counts");
    console.log("8 PASS shopkeeper STOP JOB still has no confirmation");

    const refreshed = await cancelCustomerOwnedJob(shop.shopCode, pending.id);
    assert.equal(refreshed.outcome, "already_cancelled");
    console.log("9 PASS a later check still sees the cancelled job");
  } finally {
    await prisma.printJobFile.deleteMany({
      where: { printJob: { shopId: { in: [shop.id, other.id] } } },
    });
    await prisma.printJob.deleteMany({
      where: { shopId: { in: [shop.id, other.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shop.id, other.id] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, otherOwner.id] } },
    });
    await prisma.$disconnect();
  }

  console.log("\nPhase D customer stop smoke: ALL PASS");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
