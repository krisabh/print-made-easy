/**
 * Feature 2 Phase 2B.1 — AgentDevice auth coexistence smoke.
 * Run: npx tsx scripts/phase2b1-agent-device-auth-smoke.ts
 *
 * Covers dual-credential auth, multi-device coexistence, and legacy Shop token.
 * Does not change printers/jobs/heartbeat semantics beyond auth resolution.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as registerPost } from "../app/api/print-agent/register/route";
import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import { GET as jobsGet } from "../app/api/print-agent/jobs/route";
import {
  AGENT_PAIRING_TTL_MS,
  generateAgentToken,
  generatePairingToken,
  hashAgentToken,
  hashPairingToken,
  resolveAgentAuth,
} from "../lib/print-agent-auth";

const prisma = new PrismaClient();

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `Auth Shop ${code}`,
      phone: "9000000001",
      address: "Test",
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

function asJsonRequest(url: string, body: unknown, headers?: HeadersInit) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  });
}

async function issuePairing(shopId: string) {
  const pairingToken = generatePairingToken();
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      agentPairingTokenHash: hashPairingToken(pairingToken),
      agentPairingExpiresAt: new Date(Date.now() + AGENT_PAIRING_TTL_MS),
      agentPairingUsedAt: null,
    },
  });
  return pairingToken;
}

async function pairDevice(shopId: string, agentId: string) {
  const pairingToken = await issuePairing(shopId);
  const res = await registerPost(
    asJsonRequest("http://localhost/api/print-agent/register", {
      pairingToken,
      agentId,
    }),
  );
  assert.equal(res.status, 200, `register ${agentId}`);
  const body = (await res.json()) as { token: string };
  assert.ok(body.token);
  return body.token;
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shop = await createShop(`AD${stamp}`.slice(0, 12));
  const otherShop = await createShop(`AO${stamp}`.slice(0, 12));

  try {
    // A — Legacy Shop token still authenticates
    const legacyRaw = generateAgentToken();
    const legacyHash = hashAgentToken(legacyRaw);
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        agentId: "LEGACY-SHOP-AGENT",
        agentTokenHash: legacyHash,
        agentLastSeen: new Date(),
      },
    });
    const legacyAuth = await resolveAgentAuth(legacyRaw);
    assert.ok(legacyAuth);
    assert.equal(legacyAuth!.legacy, true);
    assert.equal(legacyAuth!.shop.id, shop.id);
    assert.equal(legacyAuth!.agentDeviceId, null);
    assert.equal(legacyAuth!.agentId, "LEGACY-SHOP-AGENT");
    console.log("A PASS legacy Shop token authenticates");

    // B — Invalid token rejected
    assert.equal(await resolveAgentAuth("not-a-real-token"), null);
    assert.equal(await resolveAgentAuth(""), null);
    const badHb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        {},
        { Authorization: "Bearer totally-invalid" },
      ),
    );
    assert.equal(badHb.status, 401);
    console.log("B PASS invalid token rejected");

    // C/D/E — AgentDevice token authenticates with correct ids
    const tokenA = await pairDevice(shop.id, "PMEA-WINDOWS-AAAA");
    const authA = await resolveAgentAuth(tokenA);
    assert.ok(authA);
    assert.equal(authA!.legacy, false);
    assert.equal(authA!.shop.id, shop.id);
    assert.ok(authA!.agentDeviceId);
    assert.equal(authA!.agentId, "PMEA-WINDOWS-AAAA");
    const deviceA = await prisma.agentDevice.findUniqueOrThrow({
      where: {
        shopId_agentId: { shopId: shop.id, agentId: "PMEA-WINDOWS-AAAA" },
      },
    });
    assert.equal(authA!.agentDeviceId, deviceA.id);
    assert.equal(deviceA.tokenHash, hashAgentToken(tokenA));
    assert.notEqual(deviceA.tokenHash, tokenA);
    console.log("C–E PASS AgentDevice token → shopId + agentDeviceId");

    // F — Device token does not auth against another shop
    const otherToken = await pairDevice(otherShop.id, "PMEA-WINDOWS-OTHER");
    const otherAuth = await resolveAgentAuth(otherToken);
    assert.ok(otherAuth);
    assert.equal(otherAuth!.shop.id, otherShop.id);
    assert.notEqual(otherAuth!.shop.id, shop.id);
    console.log("F PASS token scoped to owning shop");

    // G/H/I/J — Two devices coexist; Shop.agentTokenHash preserved; both tokens valid
    const shopHashBeforeB = (
      await prisma.shop.findUniqueOrThrow({
        where: { id: shop.id },
        select: { agentTokenHash: true },
      })
    ).agentTokenHash;
    assert.equal(shopHashBeforeB, legacyHash);

    const tokenB = await pairDevice(shop.id, "PMEA-WINDOWS-BBBB");
    const shopAfterB = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
      select: { agentTokenHash: true, agentId: true },
    });
    assert.equal(shopAfterB.agentTokenHash, legacyHash);
    assert.equal(shopAfterB.agentId, "LEGACY-SHOP-AGENT");

    const devices = await prisma.agentDevice.findMany({
      where: { shopId: shop.id },
      orderBy: { agentId: "asc" },
    });
    assert.equal(devices.length, 2);

    const stillA = await resolveAgentAuth(tokenA);
    const stillB = await resolveAgentAuth(tokenB);
    const stillLegacy = await resolveAgentAuth(legacyRaw);
    assert.ok(stillA && !stillA.legacy);
    assert.ok(stillB && !stillB.legacy);
    assert.ok(stillLegacy && stillLegacy.legacy);
    assert.equal(stillA!.agentId, "PMEA-WINDOWS-AAAA");
    assert.equal(stillB!.agentId, "PMEA-WINDOWS-BBBB");
    assert.notEqual(stillA!.agentDeviceId, stillB!.agentDeviceId);
    console.log(
      "G–J PASS two AgentDevices coexist; Shop.agentTokenHash untouched; all tokens valid",
    );

    // K — Raw token never persisted
    const rows = await prisma.agentDevice.findMany({ where: { shopId: shop.id } });
    for (const row of rows) {
      assert.notEqual(row.tokenHash, tokenA);
      assert.notEqual(row.tokenHash, tokenB);
      assert.equal(row.tokenHash.length, 64); // sha256 hex
    }
    const shopRow = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
      select: { agentTokenHash: true },
    });
    assert.notEqual(shopRow.agentTokenHash, legacyRaw);
    console.log("K PASS only hashes stored in DB");

    // L — Invalidating one device (rotate its hash) does not clear the other
    const rotated = generateAgentToken();
    await prisma.agentDevice.update({
      where: { id: deviceA.id },
      data: { tokenHash: hashAgentToken(rotated) },
    });
    assert.equal(await resolveAgentAuth(tokenA), null);
    assert.ok(await resolveAgentAuth(tokenB));
    assert.ok(await resolveAgentAuth(legacyRaw));
    const shopAfterRevoke = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
      select: { agentTokenHash: true },
    });
    assert.equal(shopAfterRevoke.agentTokenHash, legacyHash);
    const deviceBStill = await prisma.agentDevice.findUniqueOrThrow({
      where: {
        shopId_agentId: { shopId: shop.id, agentId: "PMEA-WINDOWS-BBBB" },
      },
    });
    assert.equal(deviceBStill.tokenHash, hashAgentToken(tokenB));
    console.log("L PASS device revoke does not clear sibling / Shop credentials");

    // Routes accept both device and legacy tokens
    const hbB = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        { selectedPrinter: "HP Laser", printerStatus: "online" },
        { Authorization: `Bearer ${tokenB}` },
      ),
    );
    assert.equal(hbB.status, 200);
    const jobsLegacy = await jobsGet(
      new NextRequest("http://localhost/api/print-agent/jobs", {
        method: "GET",
        headers: { Authorization: `Bearer ${legacyRaw}` },
      }),
    );
    assert.equal(jobsLegacy.status, 200);
    console.log("EXTRA PASS heartbeat/jobs accept device + legacy tokens");

    console.log("\nphase2b1-agent-device-auth-smoke: ALL PASS");
  } finally {
    await prisma.agentDevice.deleteMany({
      where: { shopId: { in: [shop.id, otherShop.id] } },
    });
    await prisma.printer.deleteMany({
      where: { shopId: { in: [shop.id, otherShop.id] } },
    });
    await prisma.shop.deleteMany({
      where: { id: { in: [shop.id, otherShop.id] } },
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
