/**
 * Phase 2A smoke tests: shop-scoped job numbering + isolation.
 * Run: npx tsx scripts/phase2a-job-numbering-smoke.ts
 */
import assert from "node:assert/strict";
import { PrintMode, PrintType, PrismaClient } from "@prisma/client";

import { createPrintJob } from "../lib/job-service";

const prisma = new PrismaClient();

async function createShop(suffix: string) {
  const shopCode = `T2A${suffix}`.slice(0, 12);
  return prisma.shop.create({
    data: {
      shopCode,
      shopName: `Phase2A Shop ${suffix}`,
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

async function makeJob(shopId: string) {
  return createPrintJob({
    shopId,
    copies: 1,
    totalPages: 1,
    printMode: PrintMode.BW,
    printType: PrintType.SINGLE,
    totalPrice: 5,
    files: [
      {
        originalFileName: "t.pdf",
        storedFileName: `test-${Date.now()}-${Math.random()}.pdf`,
        fileExtension: "pdf",
        fileSize: 10,
        totalPages: 1,
      },
    ],
  });
}

async function main() {
  const shopA = await createShop("A");
  const shopB = await createShop("B");

  try {
    const a1 = await makeJob(shopA.id);
    assert.equal(a1.jobNumber, "PME-000001");
    assert.equal(a1.jobSequence, 1);

    const a2 = await makeJob(shopA.id);
    assert.equal(a2.jobNumber, "PME-000002");
    assert.equal(a2.jobSequence, 2);

    const b1 = await makeJob(shopB.id);
    assert.equal(b1.jobNumber, "PME-000001");
    assert.equal(b1.jobSequence, 1);

    const b2 = await makeJob(shopB.id);
    assert.equal(b2.jobNumber, "PME-000002");
    assert.equal(b2.jobSequence, 2);

    const a3 = await makeJob(shopA.id);
    assert.equal(a3.jobNumber, "PME-000003");
    assert.equal(a3.jobSequence, 3);

    const aJobs = await prisma.printJob.findMany({ where: { shopId: shopA.id } });
    const bJobs = await prisma.printJob.findMany({ where: { shopId: shopB.id } });
    assert.equal(aJobs.every((j) => j.shopId === shopA.id), true);
    assert.equal(bJobs.every((j) => j.shopId === shopB.id), true);
    assert.equal(aJobs.some((j) => j.shopId === shopB.id), false);
    assert.equal(bJobs.some((j) => j.shopId === shopA.id), false);

    // Concurrent creates for same shop
    const concurrent = await Promise.all([
      makeJob(shopA.id),
      makeJob(shopA.id),
      makeJob(shopA.id),
    ]);
    const sequences = concurrent.map((j) => j.jobSequence).sort((x, y) => x - y);
    assert.deepEqual(sequences, [4, 5, 6]);
    const numbers = new Set(concurrent.map((j) => j.jobNumber));
    assert.equal(numbers.size, 3);

    // Existing PME001 shop jobs (if any) still present and unchanged
    const pme001 = await prisma.shop.findUnique({ where: { shopCode: "PME001" } });
    if (pme001) {
      const existing = await prisma.printJob.findMany({
        where: { shopId: pme001.id },
        orderBy: { jobSequence: "asc" },
      });
      for (const job of existing) {
        assert.equal(job.jobNumber, `PME-${String(job.jobSequence).padStart(6, "0")}`);
      }
      console.log(`PME001 preserved jobs: ${existing.length}`);
    }

    console.log("phase2a-job-numbering-smoke: ok");
  } finally {
    await prisma.printJob.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    await prisma.shop.deleteMany({
      where: { id: { in: [shopA.id, shopB.id] } },
    });
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
