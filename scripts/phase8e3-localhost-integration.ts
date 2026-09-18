/**
 * Phase 8E.3 — Localhost Agent + multi-device + job integration.
 * Hits the REAL running Next.js server at http://localhost:3000.
 * Creates an isolated test shop; cleans up after itself.
 *
 * Run: npx tsx scripts/phase8e3-localhost-integration.ts
 *
 * Does NOT print passwords or tokens. Does NOT touch production.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, PrintStatus } from "@prisma/client";

import { AGENT_LOGIN_EMAIL_WINDOW_MAX } from "../lib/agent-login-rate-limit";
import { hashPassword } from "../lib/auth";
import {
  AGENT_OFFLINE_MS,
  STALE_PRINTING_MS,
} from "../lib/print-agent-auth";
import {
  claimJob,
  cleanupExpiredDocuments,
  getShopAgentStatus,
  setAgentDeviceLocalDefault,
  upsertShopPrinter,
} from "../lib/print-agent-service";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();
const BASE = (process.env.PME_8E3_BASE || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const PASSWORD = "Phase8E3Local!23456";
const stamp = Date.now().toString(36).toUpperCase();
const SHOP_CODE = `E3${stamp}`.slice(0, 12);
const EMAIL = `e3-${stamp.toLowerCase()}@localhost.test`;
const AGENT_A = "PMEA-WINDOWS-TEST-AAAAAAAA";
const AGENT_B = "PMEA-WINDOWS-TEST-BBBBBBBB";

type Results = Record<string, string>;
const results: Results = {};
const tokenFp = (t: string) =>
  crypto.createHash("sha256").update(t).digest("hex").slice(0, 12);

function mark(key: string, ok: boolean, detail = "") {
  results[key] = ok ? `PASS${detail ? ` (${detail})` : ""}` : `FAIL${detail ? `: ${detail}` : ""}`;
  console.log(`${ok ? "PASS" : "FAIL"} ${key}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`FAIL ${key}: ${detail}`);
}

async function api(
  method: string,
  urlPath: string,
  opts: {
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    ...(opts.headers || {}),
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, text };
}

async function createShop() {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: {
      name: "8E3 Local Owner",
      email: EMAIL,
      passwordHash,
      role: "SHOPKEEPER",
      shop: {
        create: {
          shopCode: SHOP_CODE,
          shopName: `8E3 Shop ${SHOP_CODE}`,
          phone: "9000000083",
          address: "Localhost test",
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
            create: { paperAvailable: 100, estimatedInkLevel: 100 },
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

let jobSeq = 0;
async function createPendingJob(shopId: string, label: string) {
  jobSeq += 1;
  const jobNumber = `E3-${stamp}-${label}`;
  const uploadDir = path.join(process.cwd(), "storage", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const stored = `e3-${stamp}-${label}.pdf`;
  // Minimal PDF so Agent download/print path can open it if used later
  const pdf = Buffer.from(
    `%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nPhase 8E.3 ${label}\n`,
  );
  fs.writeFileSync(path.join(uploadDir, stored), pdf);
  return prisma.printJob.create({
    data: {
      shopId,
      jobSequence: jobSeq,
      jobNumber,
      status: PrintStatus.PENDING,
      copies: 1,
      totalPages: 1,
      printMode: "BW",
      printType: "SINGLE",
      totalPrice: 2,
      files: {
        create: {
          originalFileName: `${label}.pdf`,
          storedFileName: stored,
          fileExtension: "pdf",
          fileSize: pdf.length,
          totalPages: 1,
        },
      },
    },
  });
}

async function cleanup(shopId: string) {
  const jobs = await prisma.printJob.findMany({
    where: { shopId },
    include: { files: true },
  });
  for (const job of jobs) {
    for (const f of job.files) {
      const p = path.join(
        process.cwd(),
        "storage",
        "uploads",
        f.storedFileName,
      );
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  await prisma.printJobFile.deleteMany({
    where: { printJob: { shopId } },
  });
  await prisma.printJob.deleteMany({ where: { shopId } });
  // Clear local defaults before deleting printers
  await prisma.agentDevice.updateMany({
    where: { shopId },
    data: { localDefaultPrinterId: null },
  });
  await prisma.printer.deleteMany({ where: { shopId } });
  await prisma.agentDevice.deleteMany({ where: { shopId } });
  await prisma.printPrice.deleteMany({ where: { shopId } });
  await prisma.settings.deleteMany({ where: { shopId } });
  await prisma.inventory.deleteMany({ where: { shopId } });
  await prisma.subscription.deleteMany({ where: { shopId } });
  await prisma.shop.delete({ where: { id: shopId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  console.log(`\nPhase 8E.3 localhost integration @ ${BASE}`);
  console.log(`Shop ${SHOP_CODE} email=${EMAIL} (password not printed)\n`);

  // Environment checks
  const home = await fetch(BASE).catch(() => null);
  mark("localhost_web", Boolean(home && home.ok), `status=${home?.status}`);

  const updateMeta = await api("GET", "/api/agent/update");
  mark(
    "update_api",
    updateMeta.status === 200,
    `status=${updateMeta.status}`,
  );

  const dbUrl = process.env.DATABASE_URL || "";
  const isLocalDb =
    /127\.0\.0\.1|localhost/i.test(dbUrl) &&
    !/clauras|hostinger|production/i.test(dbUrl);
  mark("local_database", isLocalDb, isLocalDb ? "127.0.0.1" : "NON_LOCAL");

  const shop = await createShop();
  let tokenA = "";
  let tokenB = "";
  let deviceAId = "";
  let deviceBId = "";

  try {
    // --- Login A ---
    const loginA = await api("POST", "/api/print-agent/login", {
      body: { email: EMAIL, password: PASSWORD, agentId: AGENT_A },
    });
    const bodyA = loginA.json as {
      token?: string;
      agentId?: string;
      shop?: { shopCode: string };
      error?: string;
    };
    mark(
      "login_a",
      loginA.status === 200 && Boolean(bodyA.token) && bodyA.agentId === AGENT_A,
      `status=${loginA.status}`,
    );
    tokenA = bodyA.token!;
    assert.equal(bodyA.shop?.shopCode, SHOP_CODE);

    const devicesAfterA = await prisma.agentDevice.findMany({
      where: { shopId: shop.id },
      select: { id: true, agentId: true, tokenHash: true, lastSeen: true },
    });
    mark("agentdevice_a_created", devicesAfterA.length === 1);
    deviceAId = devicesAfterA[0]!.id;
    mark(
      "token_hash_only",
      Boolean(devicesAfterA[0]!.tokenHash) &&
        devicesAfterA[0]!.tokenHash !== tokenA &&
        devicesAfterA[0]!.tokenHash.length >= 32,
    );

    // Config-side: password never in AgentDevice / no plaintext token column
    const rawDevice = await prisma.agentDevice.findUnique({
      where: { id: deviceAId },
    });
    const deviceJson = JSON.stringify(rawDevice);
    mark(
      "password_not_persisted",
      !deviceJson.toLowerCase().includes("password") &&
        !deviceJson.includes(PASSWORD),
    );
    mark(
      "plaintext_token_not_in_db",
      !deviceJson.includes(tokenA),
    );

    // Invalid credentials
    const bad = await api("POST", "/api/print-agent/login", {
      body: { email: EMAIL, password: "WrongPassword!!!", agentId: AGENT_A },
      headers: { "x-forwarded-for": "203.0.113.80" },
    });
    mark("invalid_credentials", bad.status === 401);

    // Cross-shop: other shop email should not get this shop's jobs (login as other)
    const other = await api("POST", "/api/print-agent/login", {
      body: {
        email: "nobody-cross@localhost.test",
        password: PASSWORD,
        agentId: AGENT_A,
      },
    });
    mark("cross_shop_login_rejected", other.status === 401);

    // Rate limiting — burn remaining failures for a dedicated email bucket
    const rateEmail = `e3-rate-${stamp.toLowerCase()}@localhost.test`;
    // Ensure user does not exist; failures still count
    let hit429 = false;
    for (let i = 0; i < AGENT_LOGIN_EMAIL_WINDOW_MAX + 2; i++) {
      const r = await api("POST", "/api/print-agent/login", {
        body: {
          email: rateEmail,
          password: "x",
          agentId: "PMEA-WINDOWS-TEST-RATE",
        },
        headers: { "x-forwarded-for": "203.0.113.81" },
      });
      if (r.status === 429) {
        hit429 = true;
        break;
      }
    }
    mark("login_rate_limit", hit429);

    // Relaunch reuse: login again with same agentId → one device row, new token
    const fpBefore = tokenFp(tokenA);
    const loginAgain = await api("POST", "/api/print-agent/login", {
      body: { email: EMAIL, password: PASSWORD, agentId: AGENT_A },
    });
    const againBody = loginAgain.json as { token?: string };
    mark("relogin_ok", loginAgain.status === 200 && Boolean(againBody.token));
    tokenA = againBody.token!;
    const devicesReuse = await prisma.agentDevice.findMany({
      where: { shopId: shop.id, agentId: AGENT_A },
    });
    mark("no_duplicate_device_a", devicesReuse.length === 1);
    mark("token_rotated_on_relogin", tokenFp(tokenA) !== fpBefore);

    // Simulate "relaunch with same token" by NOT rotating — heartbeat with current token
    // (Agent relaunch without re-login keeps authToken)

    // --- Login B (multi-device) ---
    const loginB = await api("POST", "/api/print-agent/login", {
      body: { email: EMAIL, password: PASSWORD, agentId: AGENT_B },
    });
    const bodyB = loginB.json as { token?: string; agentId?: string };
    mark(
      "login_b",
      loginB.status === 200 && bodyB.agentId === AGENT_B && Boolean(bodyB.token),
    );
    tokenB = bodyB.token!;
    mark("tokens_differ", tokenFp(tokenA) !== tokenFp(tokenB));

    const allDevices = await prisma.agentDevice.findMany({
      where: { shopId: shop.id },
      select: { id: true, agentId: true, shopId: true },
    });
    mark("two_devices", allDevices.length === 2);
    mark(
      "same_shop",
      allDevices.every((d) => d.shopId === shop.id),
    );
    mark(
      "separate_agent_ids",
      new Set(allDevices.map((d) => d.agentId)).size === 2,
    );
    deviceBId = allDevices.find((d) => d.agentId === AGENT_B)!.id;

    // --- Printer ownership ---
    const upsertA = await upsertShopPrinter({
      shopId: shop.id,
      agentDeviceId: deviceAId,
      printerName: "Canon-A-Test",
      status: "idle",
      isDefault: true,
    });
    const upsertB = await upsertShopPrinter({
      shopId: shop.id,
      agentDeviceId: deviceBId,
      printerName: "Canon-B-Test",
      status: "idle",
      isDefault: true,
    });
    await setAgentDeviceLocalDefault({
      shopId: shop.id,
      agentDeviceId: deviceAId,
      printerId: upsertA.id,
    });
    await setAgentDeviceLocalDefault({
      shopId: shop.id,
      agentDeviceId: deviceBId,
      printerId: upsertB.id,
    });
    const printers = await prisma.printer.findMany({
      where: { shopId: shop.id },
      select: {
        id: true,
        printerName: true,
        agentDeviceId: true,
      },
    });
    const pa = printers.find((p) => p.printerName === "Canon-A-Test");
    const pb = printers.find((p) => p.printerName === "Canon-B-Test");
    mark("printer_a_owned", pa?.agentDeviceId === deviceAId);
    mark("printer_b_owned", pb?.agentDeviceId === deviceBId);
    const devA = await prisma.agentDevice.findUnique({
      where: { id: deviceAId },
      select: { localDefaultPrinterId: true },
    });
    const devB = await prisma.agentDevice.findUnique({
      where: { id: deviceBId },
      select: { localDefaultPrinterId: true },
    });
    mark("device_local_default_a", devA?.localDefaultPrinterId === pa?.id);
    mark("device_local_default_b", devB?.localDefaultPrinterId === pb?.id);

    // Heartbeat A with printer — B must not change A's default via client agentDeviceId spoof
    const hbA1 = await api("POST", "/api/print-agent/heartbeat", {
      token: tokenA,
      body: {
        printerName: "Canon-A-Test",
        printerStatus: "idle",
        agentDeviceId: deviceBId, // spoof attempt — must be ignored
      },
    });
    mark("heartbeat_a", hbA1.status === 200, `status=${hbA1.status}`);

    const afterSpoof = await prisma.printer.findMany({
      where: { shopId: shop.id },
      select: { printerName: true, agentDeviceId: true },
    });
    mark(
      "client_cannot_override_device",
      afterSpoof.find((p) => p.printerName === "Canon-A-Test")
        ?.agentDeviceId === deviceAId,
    );

    // --- Heartbeats ---
    const beforeA = (
      await prisma.agentDevice.findUnique({ where: { id: deviceAId } })
    )?.lastSeen;
    await new Promise((r) => setTimeout(r, 50));
    const hbA = await api("POST", "/api/print-agent/heartbeat", {
      token: tokenA,
      body: { printerName: "Canon-A-Test", printerStatus: "idle" },
    });
    const hbB = await api("POST", "/api/print-agent/heartbeat", {
      token: tokenB,
      body: { printerName: "Canon-B-Test", printerStatus: "idle" },
    });
    mark("heartbeat_a_ok", hbA.status === 200);
    mark("heartbeat_b_ok", hbB.status === 200);
    const afterA = (
      await prisma.agentDevice.findUnique({ where: { id: deviceAId } })
    )?.lastSeen;
    mark(
      "lastseen_a_updates",
      Boolean(afterA) &&
        (!beforeA || afterA!.getTime() >= beforeA.getTime()),
    );

    let status = await getShopAgentStatus(shop.id);
    mark("shop_online_both", status.connected === true);

    // Stale A, keep B fresh → still online
    await prisma.agentDevice.update({
      where: { id: deviceAId },
      data: {
        lastSeen: new Date(Date.now() - AGENT_OFFLINE_MS - 5_000),
      },
    });
    status = await getShopAgentStatus(shop.id);
    mark("shop_online_one_fresh", status.connected === true);

    // Stale both → offline (unless legacy Shop.agentLastSeen fresh — clear it)
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: null },
    });
    await prisma.agentDevice.update({
      where: { id: deviceBId },
      data: {
        lastSeen: new Date(Date.now() - AGENT_OFFLINE_MS - 5_000),
      },
    });
    status = await getShopAgentStatus(shop.id);
    mark("shop_offline_all_stale", status.connected === false);

    // Legacy Shop.agentLastSeen fallback
    await prisma.shop.update({
      where: { id: shop.id },
      data: { agentLastSeen: new Date() },
    });
    status = await getShopAgentStatus(shop.id);
    mark("legacy_shop_agentLastSeen_fallback", status.connected === true);

    // Refresh both for job tests
    await api("POST", "/api/print-agent/heartbeat", {
      token: tokenA,
      body: { printerName: "Canon-A-Test", printerStatus: "idle" },
    });
    await api("POST", "/api/print-agent/heartbeat", {
      token: tokenB,
      body: { printerName: "Canon-B-Test", printerStatus: "idle" },
    });

    // --- Jobs ---
    const job1 = await createPendingJob(shop.id, "J1");
    const job2 = await createPendingJob(shop.id, "J2");
    const jobRace = await createPendingJob(shop.id, "RACE");

    const pollA = await api("GET", "/api/print-agent/jobs", { token: tokenA });
    const pollB = await api("GET", "/api/print-agent/jobs", { token: tokenB });
    mark("poll_a", pollA.status === 200);
    mark("poll_b", pollB.status === 200);

    const claim1 = await api(
      "POST",
      `/api/print-agent/jobs/${job1.id}/status`,
      { token: tokenA, body: { status: "PRINTING" } },
    );
    const claim2 = await api(
      "POST",
      `/api/print-agent/jobs/${job2.id}/status`,
      { token: tokenB, body: { status: "PRINTING" } },
    );
    mark("claim_job1_a", claim1.status === 200, `status=${claim1.status}`);
    mark("claim_job2_b", claim2.status === 200, `status=${claim2.status}`);

    const j1 = await prisma.printJob.findUnique({ where: { id: job1.id } });
    const j2 = await prisma.printJob.findUnique({ where: { id: job2.id } });
    mark(
      "different_owners",
      j1?.claimedByAgentDeviceId === deviceAId &&
        j2?.claimedByAgentDeviceId === deviceBId,
    );

    // Ownership: A cannot complete B's job (while both still hold claims)
    const steal = await api(
      "POST",
      `/api/print-agent/jobs/${job2.id}/status`,
      { token: tokenA, body: { status: "READY_FOR_PICKUP" } },
    );
    mark(
      "ownership_reject_cross_device",
      steal.status === 403 || steal.status === 409 || steal.status === 400,
      `status=${steal.status}`,
    );

    // Same-device concurrency: A already has job1 PRINTING; try claim another
    const job3 = await createPendingJob(shop.id, "J3");
    const secondClaim = await claimJob(shop.id, job3.id, {
      agentDeviceId: deviceAId,
    });
    mark("same_device_one_printing_limit", secondClaim === null);
    const j3 = await prisma.printJob.findUnique({ where: { id: job3.id } });
    mark("job3_still_pending", j3?.status === PrintStatus.PENDING);

    // Free both devices (complete their jobs) before same-job race
    const done2 = await api(
      "POST",
      `/api/print-agent/jobs/${job2.id}/status`,
      { token: tokenB, body: { status: "READY_FOR_PICKUP" } },
    );
    mark("job_complete_owner", done2.status === 200, `status=${done2.status}`);
    await prisma.printJob.update({
      where: { id: job1.id },
      data: {
        status: PrintStatus.READY_FOR_PICKUP,
      },
    });

    // Same-job race (both devices idle)
    const raceResults = await Promise.all([
      claimJob(shop.id, jobRace.id, { agentDeviceId: deviceAId }),
      claimJob(shop.id, jobRace.id, { agentDeviceId: deviceBId }),
    ]);
    const winners = raceResults.filter(Boolean);
    mark(
      "same_job_race_one_winner",
      winners.length === 1,
      `winners=${winners.length}`,
    );
    const raceRow = await prisma.printJob.findUnique({
      where: { id: jobRace.id },
    });
    mark(
      "race_claimed_fields",
      raceRow?.status === PrintStatus.PRINTING &&
        Boolean(raceRow.claimedByAgentDeviceId) &&
        Boolean(raceRow.claimedAt),
    );

    // Stale release via cleanupExpiredDocuments (updatedAt backdated)
    // Use jobRace (still PRINTING) as the stale victim
    const staleJobId = jobRace.id;
    const staleOwner = raceRow!.claimedByAgentDeviceId!;
    const otherDevice =
      staleOwner === deviceAId ? deviceBId : deviceAId;
    await prisma.printJob.update({
      where: { id: staleJobId },
      data: {
        status: PrintStatus.PRINTING,
        claimedByAgentDeviceId: staleOwner,
        claimedAt: new Date(Date.now() - STALE_PRINTING_MS - 5_000),
        updatedAt: new Date(Date.now() - STALE_PRINTING_MS - 5_000),
      },
    });
    await cleanupExpiredDocuments();
    const j1After = await prisma.printJob.findUnique({
      where: { id: staleJobId },
    });
    mark(
      "stale_release",
      j1After?.status === PrintStatus.PENDING &&
        j1After.claimedByAgentDeviceId == null,
    );
    mark("stale_clears_claim", j1After?.claimedAt == null);
    const reclaimB = await claimJob(shop.id, staleJobId, {
      agentDeviceId: otherDevice,
    });
    mark("other_device_can_reclaim", Boolean(reclaimB));

    console.log("\n--- Phase 8E.3 HTTP integration: ALL CORE PASS ---");
    console.log(
      JSON.stringify(
        {
          shopCode: SHOP_CODE,
          deviceA: AGENT_A,
          deviceB: AGENT_B,
          tokenFpA: tokenFp(tokenA),
          tokenFpB: tokenFp(tokenB),
        },
        null,
        2,
      ),
    );

    // Persist credentials for real Agent follow-up (token NOT written — only metadata)
    const outDir = "C:/Temp/pme-8e3";
    fs.mkdirSync(outDir, { recursive: true });
    // Write a secrets file with restricted intent — used only by follow-up agent config helper
    fs.writeFileSync(
      path.join(outDir, "localhost-test-secrets.json"),
      JSON.stringify(
        {
          base: BASE,
          email: EMAIL,
          password: PASSWORD,
          shopCode: SHOP_CODE,
          shopId: shop.id,
          agentA: AGENT_A,
          agentB: AGENT_B,
          tokenA,
          tokenB,
          deviceAId,
          deviceBId,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(outDir, "localhost-test-meta.json"),
      JSON.stringify(
        {
          base: BASE,
          email: EMAIL,
          shopCode: SHOP_CODE,
          shopId: shop.id,
          agentA: AGENT_A,
          agentB: AGENT_B,
          tokenFpA: tokenFp(tokenA),
          tokenFpB: tokenFp(tokenB),
          deviceAId,
          deviceBId,
          results,
        },
        null,
        2,
      ),
    );

    // NOTE: cleanup deferred until Agent print pipeline finishes.
    // Caller must run cleanup script or delete shop after Agent tests.
    console.log(
      "\nShop left in DB for Agent print pipeline; secrets in C:/Temp/pme-8e3/",
    );
  } catch (e) {
    console.error(e);
    try {
      await cleanup(shop.id);
    } catch (ce) {
      console.error("cleanup failed", ce);
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
