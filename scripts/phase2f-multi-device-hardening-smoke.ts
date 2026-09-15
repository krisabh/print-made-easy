/**
 * Feature 2 Phase 2F — multi-device integration & hardening smoke.
 * Covers auth lifecycle, claim serialization, ownership, printers, billing.
 * Does NOT claim physical two-computer printing was tested.
 *
 * Run: npx tsx scripts/phase2f-multi-device-hardening-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient, PrintStatus } from "@prisma/client";

import { POST as loginPost } from "../app/api/print-agent/login/route";
import { POST as statusPost } from "../app/api/print-agent/jobs/[jobId]/status/route";
import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import {
  AGENT_LOGIN_EMAIL_WINDOW_MAX,
  checkAgentLoginRateLimit,
  clearAgentLoginFailuresForEmail,
  recordAgentLoginFailure,
  resetAgentLoginRateLimits,
} from "../lib/agent-login-rate-limit";
import { hashPassword } from "../lib/auth";
import {
  generateAgentToken,
  hashAgentToken,
  resolveAgentAuth,
  STALE_PRINTING_MS,
} from "../lib/print-agent-auth";
import {
  claimJob,
  cleanupExpiredDocuments,
  releaseJobToPending,
  setAgentDeviceLocalDefault,
  upsertShopPrinter,
} from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();
const PASSWORD = "Phase2FSmoke!234";

async function createShop(code: string, email: string) {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: {
      name: `Owner ${code}`,
      email,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: code,
          shopName: `2F Shop ${code}`,
          phone: "9000000066",
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
  return { user, shop: user.shop! };
}

function loginRequest(body: unknown, ip = "203.0.113.50") {
  return new NextRequest("http://localhost/api/print-agent/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
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

function heartbeatRequest(token: string, printers: Array<{ name: string; status: string }>) {
  return new NextRequest("http://localhost/api/print-agent/heartbeat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      printers,
      selectedPrinter: printers[0]?.name ?? null,
    }),
  });
}

async function loginAs(
  email: string,
  agentId: string,
): Promise<{ token: string; agentDeviceId: string }> {
  const res = await loginPost(
    loginRequest({ email, password: PASSWORD, agentId }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string };
  const auth = await resolveAgentAuth(body.token);
  assert.ok(auth?.agentDeviceId);
  return { token: body.token, agentDeviceId: auth!.agentDeviceId! };
}

let jobSeq = 1;
async function createPendingJob(shopId: string) {
  const seq = jobSeq++;
  return prisma.printJob.create({
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
      files: {
        create: {
          originalFileName: "doc.pdf",
          storedFileName: `smoke-2f-${seq}.pdf`,
          fileExtension: "pdf",
          fileSize: 100,
          totalPages: 1,
        },
      },
    },
  });
}

async function main() {
  resetAgentLoginRateLimits();
  const stamp = Date.now().toString(36).toUpperCase();
  const emailA = `2f-a-${stamp.toLowerCase()}@example.com`;
  const emailB = `2f-b-${stamp.toLowerCase()}@example.com`;
  const { shop: shopA } = await createShop(`2FA${stamp}`.slice(0, 12), emailA);
  const { shop: shopB } = await createShop(`2FB${stamp}`.slice(0, 12), emailB);

  const legacyRaw = generateAgentToken();
  await prisma.shop.update({
    where: { id: shopA.id },
    data: {
      agentId: "LEGACY-2F",
      agentTokenHash: hashAgentToken(legacyRaw),
      agentLastSeen: new Date(),
    },
  });
  const legacyHashBefore = (
    await prisma.shop.findUniqueOrThrow({ where: { id: shopA.id } })
  ).agentTokenHash;
  const legacyLastSeenBefore = (
    await prisma.shop.findUniqueOrThrow({ where: { id: shopA.id } })
  ).agentLastSeen!.getTime();

  try {
    // A — same shop + same agentId → one AgentDevice
    const agentIdShared = "PMEA-WINDOWS-2F000001";
    const first = await loginAs(emailA, agentIdShared);
    const second = await loginAs(emailA, agentIdShared);
    assert.notEqual(first.token, second.token, "relogin rotates token");
    assert.equal(first.agentDeviceId, second.agentDeviceId);
    const devicesSameId = await prisma.agentDevice.findMany({
      where: { shopId: shopA.id, agentId: agentIdShared },
    });
    assert.equal(devicesSameId.length, 1);
    assert.equal(await resolveAgentAuth(first.token), null);
    console.log("A PASS same shop + same agentId → one AgentDevice (token rotated)");

    // B — different agentId → two devices; sibling token intact
    const agentIdB = "PMEA-WINDOWS-2F000002";
    const deviceBLogin = await loginAs(emailA, agentIdB);
    const devicesShopA = await prisma.agentDevice.findMany({
      where: { shopId: shopA.id },
    });
    assert.equal(devicesShopA.length, 2);
    assert.notEqual(deviceBLogin.agentDeviceId, second.agentDeviceId);
    assert.ok(await resolveAgentAuth(second.token));
    console.log("B PASS same shop + different agentId → two AgentDevices; sibling token intact");

    // C — different shop + same agentId → separate ownership
    const otherShop = await loginAs(emailB, agentIdShared);
    assert.equal((await resolveAgentAuth(otherShop.token))!.shop.id, shopB.id);
    assert.notEqual(otherShop.agentDeviceId, second.agentDeviceId);
    assert.equal(
      (
        await prisma.agentDevice.findMany({
          where: { agentId: agentIdShared },
        })
      ).length,
      2,
    );
    console.log("C PASS different shop + same agentId → separate AgentDevices");

    // D — device token scoped to own shop/device
    const authA = await resolveAgentAuth(second.token);
    assert.ok(authA);
    assert.equal(authA!.shop.id, shopA.id);
    assert.equal(authA!.agentDeviceId, second.agentDeviceId);
    console.log("D PASS device token authenticates own shop/device context");

    // Fresh tokens for remaining tests (avoid earlier rotations)
    const freshA = await loginAs(emailA, agentIdShared);
    const freshB = await loginAs(emailA, agentIdB);
    const deviceAId = freshA.agentDeviceId;
    const deviceBId = freshB.agentDeviceId;

    // N — privacy + legacy Shop fields
    const shopAfter = await prisma.shop.findUniqueOrThrow({
      where: { id: shopA.id },
    });
    assert.equal(shopAfter.agentTokenHash, legacyHashBefore);
    assert.equal(shopAfter.agentId, "LEGACY-2F");
    const loginRes = await loginPost(
      loginRequest({
        email: emailA,
        password: PASSWORD,
        agentId: agentIdShared,
      }),
    );
    const loginJson = JSON.stringify(await loginRes.json());
    assert.equal(loginJson.includes(PASSWORD), false);
    assert.equal(/password/i.test(loginJson), false);
    // Re-login again for a clean token after the privacy probe consumed one response
    const tokenA = (await loginAs(emailA, agentIdShared)).token;
    const tokenB = freshB.token;
    const hashes = await prisma.agentDevice.findMany({
      where: { shopId: shopA.id },
      select: { tokenHash: true },
    });
    for (const h of hashes) {
      assert.notEqual(h.tokenHash, tokenA);
      assert.notEqual(h.tokenHash, tokenB);
      assert.equal(h.tokenHash.length, 64);
    }
    console.log(
      "N PASS token hashed in DB; password absent from login JSON; legacy Shop fields intact",
    );

    // Re-bind device ids after privacy probe login rotation of A
    const authFreshA = (await resolveAgentAuth(tokenA))!;
    const authFreshB = (await resolveAgentAuth(tokenB))!;
    assert.equal(authFreshA.agentDeviceId, deviceAId);
    assert.equal(authFreshB.agentDeviceId, deviceBId);

    // L — printer ownership cannot cross AgentDevice
    await upsertShopPrinter({
      shopId: shopA.id,
      agentDeviceId: deviceAId,
      printerName: "Canon-A",
      status: "online",
      isDefault: true,
    });
    await upsertShopPrinter({
      shopId: shopA.id,
      agentDeviceId: deviceBId,
      printerName: "Epson-B",
      status: "online",
      isDefault: true,
    });
    const printersA = await prisma.printer.findMany({
      where: { agentDeviceId: deviceAId },
    });
    const printersB = await prisma.printer.findMany({
      where: { agentDeviceId: deviceBId },
    });
    assert.equal(printersA.length, 1);
    assert.equal(printersB.length, 1);
    assert.equal(printersA[0].printerName, "Canon-A");
    assert.equal(printersB[0].printerName, "Epson-B");
    await assert.rejects(() =>
      setAgentDeviceLocalDefault({
        shopId: shopA.id,
        agentDeviceId: deviceAId,
        printerId: printersB[0].id,
      }),
    );
    console.log("L PASS printer rows device-scoped; cross-device default rejected");

    // Heartbeat: device A updates own lastSeen; not Shop.agentLastSeen; not B
    const beforeB = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceBId },
    });
    await new Promise((r) => setTimeout(r, 30));
    const hb = await heartbeatPost(
      heartbeatRequest(tokenA, [{ name: "Canon-A", status: "online" }]),
    );
    assert.equal(hb.status, 200);
    const afterB = await prisma.agentDevice.findUniqueOrThrow({
      where: { id: deviceBId },
    });
    assert.equal(afterB.lastSeen!.getTime(), beforeB.lastSeen!.getTime());
    const shopAfterHb = await prisma.shop.findUniqueOrThrow({
      where: { id: shopA.id },
    });
    assert.equal(shopAfterHb.agentLastSeen!.getTime(), legacyLastSeenBefore);
    console.log("EXTRA PASS device heartbeat isolates lastSeen (sibling + legacy)");

    // E — cross-device job ownership denied
    const job1 = await createPendingJob(shopA.id);
    const claimA = await statusPost(
      statusRequest(tokenA, job1.id, { status: "PRINTING" }),
      { params: Promise.resolve({ jobId: job1.id }) },
    );
    assert.equal(claimA.status, 200);
    const steal = await statusPost(
      statusRequest(tokenB, job1.id, { status: "READY_FOR_PICKUP" }),
      { params: Promise.resolve({ jobId: job1.id }) },
    );
    assert.equal(steal.status, 409);
    const stealClaim = await statusPost(
      statusRequest(tokenB, job1.id, { status: "PRINTING" }),
      { params: Promise.resolve({ jobId: job1.id }) },
    );
    assert.equal(stealClaim.status, 409);
    console.log("E PASS cross-device complete/claim denied");

    // F — same-job concurrent claim → one winner
    await prisma.printJob.update({
      where: { id: job1.id },
      data: { status: PrintStatus.READY_FOR_PICKUP },
    });
    const job2 = await createPendingJob(shopA.id);
    const [c1, c2] = await Promise.all([
      claimJob(shopA.id, job2.id, { agentDeviceId: deviceAId }),
      claimJob(shopA.id, job2.id, { agentDeviceId: deviceBId }),
    ]);
    assert.equal([c1, c2].filter(Boolean).length, 1);
    console.log("F PASS same-job concurrent claim → exactly one winner");

    // G — different jobs concurrently
    await prisma.printJob.update({
      where: { id: job2.id },
      data: { status: PrintStatus.READY_FOR_PICKUP },
    });
    const job3 = await createPendingJob(shopA.id);
    const job4 = await createPendingJob(shopA.id);
    const [d3, d4] = await Promise.all([
      claimJob(shopA.id, job3.id, { agentDeviceId: deviceAId }),
      claimJob(shopA.id, job4.id, { agentDeviceId: deviceBId }),
    ]);
    assert.ok(d3 && d4);
    assert.equal(d3!.claimedByAgentDeviceId, deviceAId);
    assert.equal(d4!.claimedByAgentDeviceId, deviceBId);
    console.log("G PASS different jobs claimable concurrently by different devices");

    // Same-device concurrent different jobs → at most one PRINTING (2F row lock)
    await prisma.printJob.updateMany({
      where: { id: { in: [job3.id, job4.id] } },
      data: { status: PrintStatus.READY_FOR_PICKUP },
    });
    const job5 = await createPendingJob(shopA.id);
    const job6 = await createPendingJob(shopA.id);
    const [s1, s2] = await Promise.all([
      claimJob(shopA.id, job5.id, { agentDeviceId: deviceAId }),
      claimJob(shopA.id, job6.id, { agentDeviceId: deviceAId }),
    ]);
    const sameDeviceWins = [s1, s2].filter(Boolean);
    assert.equal(sameDeviceWins.length, 1);
    assert.equal(
      await prisma.printJob.count({
        where: {
          shopId: shopA.id,
          status: PrintStatus.PRINTING,
          claimedByAgentDeviceId: deviceAId,
        },
      }),
      1,
    );
    console.log("EXTRA PASS same-device concurrent claims → at most one PRINTING");

    // H — release clears ownership
    const owned = sameDeviceWins[0]!;
    const released = await releaseJobToPending(
      shopA.id,
      owned.id,
      "test release",
      { agentDeviceId: deviceAId },
    );
    assert.ok(released);
    assert.equal(released!.status, PrintStatus.PENDING);
    assert.equal(released!.claimedByAgentDeviceId, null);
    assert.equal(released!.claimedAt, null);
    console.log("H PASS release clears ownership");

    // I — stale recovery clears ownership
    const staleJob = await createPendingJob(shopA.id);
    assert.ok(
      await claimJob(shopA.id, staleJob.id, { agentDeviceId: deviceAId }),
    );
    await prisma.printJob.update({
      where: { id: staleJob.id },
      data: {
        updatedAt: new Date(Date.now() - STALE_PRINTING_MS - 5_000),
      },
    });
    await cleanupExpiredDocuments();
    const recovered = await prisma.printJob.findUniqueOrThrow({
      where: { id: staleJob.id },
    });
    assert.equal(recovered.status, PrintStatus.PENDING);
    assert.equal(recovered.claimedByAgentDeviceId, null);
    assert.equal(recovered.claimedAt, null);
    console.log("I PASS stale recovery clears ownership");

    // J — completion retains ownership
    const doneJob = await createPendingJob(shopA.id);
    assert.ok(
      await claimJob(shopA.id, doneJob.id, { agentDeviceId: deviceBId }),
    );
    const doneRes = await statusPost(
      statusRequest(tokenB, doneJob.id, { status: "READY_FOR_PICKUP" }),
      { params: Promise.resolve({ jobId: doneJob.id }) },
    );
    assert.equal(doneRes.status, 200);
    const doneRow = await prisma.printJob.findUniqueOrThrow({
      where: { id: doneJob.id },
    });
    assert.equal(doneRow.status, PrintStatus.READY_FOR_PICKUP);
    assert.equal(doneRow.claimedByAgentDeviceId, deviceBId);
    assert.ok(doneRow.claimedAt);
    console.log("J PASS completion retains ownership");

    // K — legacy Shop-token still works
    await prisma.printJob.updateMany({
      where: { shopId: shopA.id, status: PrintStatus.PRINTING },
      data: { status: PrintStatus.READY_FOR_PICKUP },
    });
    const legacyJob = await createPendingJob(shopA.id);
    const legacyClaim = await statusPost(
      statusRequest(legacyRaw, legacyJob.id, { status: "PRINTING" }),
      { params: Promise.resolve({ jobId: legacyJob.id }) },
    );
    assert.equal(legacyClaim.status, 200);
    const legacyRow = await prisma.printJob.findUniqueOrThrow({
      where: { id: legacyJob.id },
    });
    assert.equal(legacyRow.claimedByAgentDeviceId, null);
    assert.ok(legacyRow.claimedAt);
    console.log("K PASS legacy Shop-token claim compatible");

    // M — billing/pricing unchanged by claim
    const priced = await createPendingJob(shopA.id);
    const before = await prisma.printJob.findUniqueOrThrow({
      where: { id: priced.id },
      select: { totalPrice: true, copies: true, totalPages: true },
    });
    await claimJob(shopA.id, priced.id, { agentDeviceId: deviceAId });
    const after = await prisma.printJob.findUniqueOrThrow({
      where: { id: priced.id },
      select: { totalPrice: true, copies: true, totalPages: true },
    });
    assert.equal(String(after.totalPrice), String(before.totalPrice));
    assert.equal(after.copies, before.copies);
    assert.equal(after.totalPages, before.totalPages);
    console.log("M PASS billing/pricing unchanged by claim");

    // Rate limit
    resetAgentLoginRateLimits();
    const rateEmail = `2f-rate-${stamp.toLowerCase()}@example.com`;
    for (let i = 0; i < AGENT_LOGIN_EMAIL_WINDOW_MAX; i++) {
      recordAgentLoginFailure({ email: rateEmail, ip: "198.51.100.10" });
    }
    assert.equal(
      checkAgentLoginRateLimit({ email: rateEmail, ip: "198.51.100.10" })
        .allowed,
      false,
    );
    const limited = await loginPost(
      loginRequest(
        {
          email: rateEmail,
          password: "wrong",
          agentId: "PMEA-WINDOWS-RATE0001",
        },
        "198.51.100.10",
      ),
    );
    assert.equal(limited.status, 429);
    clearAgentLoginFailuresForEmail(rateEmail);
    console.log("EXTRA PASS agent login rate limit returns 429");

    // Cross-shop job claim denied
    const otherJob = await createPendingJob(shopB.id);
    const crossClaim = await statusPost(
      statusRequest(tokenA, otherJob.id, { status: "PRINTING" }),
      { params: Promise.resolve({ jobId: otherJob.id }) },
    );
    assert.equal(crossClaim.status, 404);
    console.log("EXTRA PASS cross-shop job claim denied");

    console.log("\nphase2f-multi-device-hardening-smoke: ALL PASS");
    console.log("NOTE: Physical two-computer printing test NOT PERFORMED.");
  } finally {
    resetAgentLoginRateLimits();
    const emails = await prisma.user.findMany({
      where: { email: { startsWith: "2f-" } },
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
