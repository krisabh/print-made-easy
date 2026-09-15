/**
 * Feature 2 Phase 2E — AgentDevice job ownership / multi-computer queue smoke.
 * Run: npx tsx scripts/phase2e-job-ownership-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient, PrintStatus } from "@prisma/client";

import { GET as jobsGet } from "../app/api/print-agent/jobs/route";
import { POST as statusPost } from "../app/api/print-agent/jobs/[jobId]/status/route";
import { hashPassword } from "../lib/auth";
import {
  generateAgentToken,
  hashAgentToken,
  STALE_PRINTING_MS,
} from "../lib/print-agent-auth";
import {
  claimJob,
  cleanupExpiredDocuments,
  releaseJobToPending,
} from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();

async function createShop(code: string, email: string) {
  const passwordHash = await hashPassword("Phase2ESmoke!234");
  const user = await prisma.user.create({
    data: {
      name: `Owner ${code}`,
      email,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: code,
          shopName: `2E Shop ${code}`,
          phone: "9000000055",
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
      },
    },
    include: { shop: true },
  });
  assert.ok(user.shop);
  return user.shop!;
}

async function createDevice(shopId: string, agentId: string) {
  const token = generateAgentToken();
  const device = await prisma.agentDevice.create({
    data: {
      shopId,
      agentId,
      tokenHash: hashAgentToken(token),
      lastSeen: new Date(),
    },
  });
  return { device, token };
}

let jobSeq = 1;
async function createPendingJob(shopId: string, withFile = true) {
  const seq = jobSeq++;
  const job = await prisma.printJob.create({
    data: {
      shopId,
      jobSequence: seq,
      jobNumber: `PME-${String(seq).padStart(6, "0")}`,
      copies: 1,
      totalPages: 1,
      printMode: "BW",
      printType: "SINGLE",
      totalPrice: 2,
      status: PrintStatus.PENDING,
      ...(withFile
        ? {
            files: {
              create: {
                originalFileName: "doc.pdf",
                storedFileName: `smoke-2e-${seq}.pdf`,
                fileExtension: "pdf",
                fileSize: 100,
                totalPages: 1,
              },
            },
          }
        : {}),
    },
  });
  return job;
}

function statusRequest(token: string, jobId: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/print-agent/jobs/${jobId}/status`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
}

function listRequest(token: string) {
  return new NextRequest("http://localhost/api/print-agent/jobs", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(
    `2E${stamp}`.slice(0, 12),
    `2e-${stamp.toLowerCase()}@example.com`,
  );
  const { device: deviceA, token: tokenA } = await createDevice(
    shop.id,
    "PMEA-WINDOWS-A",
  );
  const { device: deviceB, token: tokenB } = await createDevice(
    shop.id,
    "PMEA-WINDOWS-B",
  );

  const legacyToken = generateAgentToken();
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      agentId: "LEGACY-SHOP-AGENT",
      agentTokenHash: hashAgentToken(legacyToken),
      agentLastSeen: new Date(),
    },
  });

  try {
    // A–D — Device A claims
    const job1 = await createPendingJob(shop.id);
    const claimA = await statusPost(statusRequest(tokenA, job1.id, {
      status: "PRINTING",
    }), { params: Promise.resolve({ jobId: job1.id }) });
    assert.equal(claimA.status, 200);
    const owned1 = await prisma.printJob.findUniqueOrThrow({
      where: { id: job1.id },
    });
    assert.equal(owned1.status, PrintStatus.PRINTING);
    assert.equal(owned1.claimedByAgentDeviceId, deviceA.id);
    assert.ok(owned1.claimedAt);
    console.log("A–D PASS Device A claim sets ownership + PRINTING");

    // E — B cannot claim A's PRINTING job
    const claimBSteal = await statusPost(
      statusRequest(tokenB, job1.id, { status: "PRINTING" }),
      { params: Promise.resolve({ jobId: job1.id }) },
    );
    assert.equal(claimBSteal.status, 409);
    const stillA = await prisma.printJob.findUniqueOrThrow({
      where: { id: job1.id },
    });
    assert.equal(stillA.claimedByAgentDeviceId, deviceA.id);
    console.log("E PASS Device B cannot claim A's PRINTING job");

    // F — B can claim another PENDING job (multi-computer)
    const job2 = await createPendingJob(shop.id);
    const claimB = await statusPost(
      statusRequest(tokenB, job2.id, { status: "PRINTING" }),
      { params: Promise.resolve({ jobId: job2.id }) },
    );
    assert.equal(claimB.status, 200);
    const owned2 = await prisma.printJob.findUniqueOrThrow({
      where: { id: job2.id },
    });
    assert.equal(owned2.claimedByAgentDeviceId, deviceB.id);
    console.log("F PASS Device B claims a different PENDING job");

    // I — claimed jobs not in pending poll for others
    const listA = await jobsGet(listRequest(tokenA));
    const listABody = (await listA.json()) as { jobs: Array<{ id: string }> };
    assert.equal(
      listABody.jobs.some((j) => j.id === job1.id || j.id === job2.id),
      false,
    );
    // A already has PRINTING → empty list
    assert.equal(listABody.jobs.length, 0);
    const listB = await jobsGet(listRequest(tokenB));
    const listBBody = (await listB.json()) as { jobs: Array<{ id: string }> };
    assert.equal(listBBody.jobs.length, 0);
    console.log("I PASS claimed jobs absent from pending polls");

    // G — concurrent claim same job → exactly one winner
    const job3 = await createPendingJob(shop.id);
    // Finish A and B current jobs first so they can claim again
    await prisma.printJob.updateMany({
      where: { id: { in: [job1.id, job2.id] } },
      data: { status: PrintStatus.READY_FOR_PICKUP },
    });
    const [r1, r2] = await Promise.all([
      claimJob(shop.id, job3.id, { agentDeviceId: deviceA.id }),
      claimJob(shop.id, job3.id, { agentDeviceId: deviceB.id }),
    ]);
    const winners = [r1, r2].filter(Boolean);
    assert.equal(winners.length, 1);
    const job3Row = await prisma.printJob.findUniqueOrThrow({
      where: { id: job3.id },
    });
    assert.equal(job3Row.status, PrintStatus.PRINTING);
    assert.ok(job3Row.claimedByAgentDeviceId);
    assert.ok(
      job3Row.claimedByAgentDeviceId === deviceA.id ||
        job3Row.claimedByAgentDeviceId === deviceB.id,
    );
    console.log("G PASS concurrent same-job claim → exactly one owner");

    // H — concurrent different jobs → both succeed
    await prisma.printJob.update({
      where: { id: job3.id },
      data: { status: PrintStatus.READY_FOR_PICKUP },
    });
    const job4 = await createPendingJob(shop.id);
    const job5 = await createPendingJob(shop.id);
    const [c4, c5] = await Promise.all([
      claimJob(shop.id, job4.id, { agentDeviceId: deviceA.id }),
      claimJob(shop.id, job5.id, { agentDeviceId: deviceB.id }),
    ]);
    assert.ok(c4);
    assert.ok(c5);
    assert.equal(c4!.claimedByAgentDeviceId, deviceA.id);
    assert.equal(c5!.claimedByAgentDeviceId, deviceB.id);
    console.log("H PASS concurrent different jobs → both succeed");

    // N — B cannot complete A's job
    const stealComplete = await statusPost(
      statusRequest(tokenB, job4.id, { status: "READY_FOR_PICKUP" }),
      { params: Promise.resolve({ jobId: job4.id }) },
    );
    assert.equal(stealComplete.status, 409);
    const stealRelease = await statusPost(
      statusRequest(tokenB, job4.id, {
        status: "PENDING",
        error: "fake",
      }),
      { params: Promise.resolve({ jobId: job4.id }) },
    );
    assert.equal(stealRelease.status, 409);
    console.log("N PASS other Agent cannot complete/fail owned PRINTING job");

    // L — completion retains ownership history
    const done = await statusPost(
      statusRequest(tokenA, job4.id, { status: "READY_FOR_PICKUP" }),
      { params: Promise.resolve({ jobId: job4.id }) },
    );
    assert.equal(done.status, 200);
    const doneRow = await prisma.printJob.findUniqueOrThrow({
      where: { id: job4.id },
    });
    assert.equal(doneRow.status, PrintStatus.READY_FOR_PICKUP);
    assert.equal(doneRow.claimedByAgentDeviceId, deviceA.id);
    assert.ok(doneRow.claimedAt);
    console.log("L PASS completion retains ownership history");

    // M — release clears ownership; failed path retains if we complete-as-fail via exhausted?
    // Release to PENDING clears ownership (preferred for PENDING).
    const failRelease = await releaseJobToPending(
      shop.id,
      job5.id,
      "printer offline",
      { agentDeviceId: deviceB.id },
    );
    assert.ok(failRelease);
    assert.equal(failRelease!.status, PrintStatus.PENDING);
    assert.equal(failRelease!.claimedByAgentDeviceId, null);
    assert.equal(failRelease!.claimedAt, null);
    console.log("M/P PASS release clears ownership; retry path works");

    // Re-claim and mark ready after failure message with ownership retained on complete
    const reclaim = await claimJob(shop.id, job5.id, {
      agentDeviceId: deviceB.id,
    });
    assert.ok(reclaim);
    await statusPost(
      statusRequest(tokenB, job5.id, { status: "READY_FOR_PICKUP" }),
      { params: Promise.resolve({ jobId: job5.id }) },
    );
    const hist = await prisma.printJob.findUniqueOrThrow({
      where: { id: job5.id },
    });
    assert.equal(hist.claimedByAgentDeviceId, deviceB.id);
    console.log("M PASS completed job retains ownership history");

    // J–K — stale PRINTING recovery clears ownership; another device can claim
    const job6 = await createPendingJob(shop.id);
    const staleClaim = await claimJob(shop.id, job6.id, {
      agentDeviceId: deviceA.id,
    });
    assert.ok(staleClaim);
    await prisma.printJob.update({
      where: { id: job6.id },
      data: {
        updatedAt: new Date(Date.now() - STALE_PRINTING_MS - 5_000),
      },
    });
    await cleanupExpiredDocuments();
    const recovered = await prisma.printJob.findUniqueOrThrow({
      where: { id: job6.id },
    });
    assert.equal(recovered.status, PrintStatus.PENDING);
    assert.equal(recovered.claimedByAgentDeviceId, null);
    assert.equal(recovered.claimedAt, null);
    const reclaimByB = await claimJob(shop.id, job6.id, {
      agentDeviceId: deviceB.id,
    });
    assert.ok(reclaimByB);
    assert.equal(reclaimByB!.claimedByAgentDeviceId, deviceB.id);
    console.log("J–K PASS stale recovery clears ownership; other device claims");

    // Idempotent claim retry
    const again = await claimJob(shop.id, job6.id, {
      agentDeviceId: deviceB.id,
    });
    assert.ok(again);
    assert.equal(again!.id, job6.id);
    console.log("EXTRA PASS idempotent claim retry by owner succeeds");

    // O — legacy Shop-token still works
    await prisma.printJob.update({
      where: { id: job6.id },
      data: { status: PrintStatus.READY_FOR_PICKUP },
    });
    const job7 = await createPendingJob(shop.id);
    // Device-owned PRINTING must not block legacy shop-wide gate if none active
    const legacyClaim = await statusPost(
      statusRequest(legacyToken, job7.id, { status: "PRINTING" }),
      { params: Promise.resolve({ jobId: job7.id }) },
    );
    assert.equal(legacyClaim.status, 200);
    const legacyRow = await prisma.printJob.findUniqueOrThrow({
      where: { id: job7.id },
    });
    assert.equal(legacyRow.status, PrintStatus.PRINTING);
    assert.equal(legacyRow.claimedByAgentDeviceId, null);
    assert.ok(legacyRow.claimedAt);
    const legacyReady = await statusPost(
      statusRequest(legacyToken, job7.id, { status: "READY_FOR_PICKUP" }),
      { params: Promise.resolve({ jobId: job7.id }) },
    );
    assert.equal(legacyReady.status, 200);
    console.log("O PASS legacy Shop-token claim/complete still works");

    // Q — billing fields unchanged by claim
    const priced = await createPendingJob(shop.id);
    const beforePrice = await prisma.printJob.findUniqueOrThrow({
      where: { id: priced.id },
      select: { totalPrice: true, copies: true, totalPages: true },
    });
    await claimJob(shop.id, priced.id, { agentDeviceId: deviceA.id });
    const afterPrice = await prisma.printJob.findUniqueOrThrow({
      where: { id: priced.id },
      select: { totalPrice: true, copies: true, totalPages: true },
    });
    assert.equal(String(afterPrice.totalPrice), String(beforePrice.totalPrice));
    assert.equal(afterPrice.copies, beforePrice.copies);
    assert.equal(afterPrice.totalPages, beforePrice.totalPages);
    console.log("Q PASS billing fields unchanged by claim");

    // Invariants PENDING
    const pendingCheck = await createPendingJob(shop.id);
    assert.equal(pendingCheck.status, PrintStatus.PENDING);
    const pendingRow = await prisma.printJob.findUniqueOrThrow({
      where: { id: pendingCheck.id },
    });
    assert.equal(pendingRow.claimedByAgentDeviceId, null);
    assert.equal(pendingRow.claimedAt, null);
    console.log("INVARIANT PASS PENDING has null ownership");

    console.log("\nphase2e-job-ownership-smoke: ALL PASS");
  } finally {
    const emails = await prisma.user.findMany({
      where: { email: { startsWith: "2e-" } },
      select: { id: true, shop: { select: { id: true } } },
    });
    const shopIds = emails
      .map((u) => u.shop?.id)
      .filter((id): id is string => Boolean(id));
    if (shopIds.length) {
      await prisma.printJobFile.deleteMany({
        where: { printJob: { shopId: { in: shopIds } } },
      });
      await prisma.printJob.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.agentDevice.updateMany({
        where: { shopId: { in: shopIds } },
        data: { localDefaultPrinterId: null },
      });
      await prisma.printer.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.agentDevice.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.printPrice.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.settings.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.inventory.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.subscription.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
      await prisma.user.deleteMany({
        where: { id: { in: emails.map((u) => u.id) } },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
