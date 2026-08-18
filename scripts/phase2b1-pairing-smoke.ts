/**
 * Phase 2B-1 smoke tests: agent pairing backend.
 * Run: npx tsx scripts/phase2b1-pairing-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as registerPost } from "../app/api/print-agent/register/route";
import { POST as heartbeatPost } from "../app/api/print-agent/heartbeat/route";
import { GET as jobsGet } from "../app/api/print-agent/jobs/route";
import {
  AGENT_PAIRING_TTL_MS,
  generatePairingToken,
  hashAgentToken,
  hashPairingToken,
} from "../lib/print-agent-auth";

const prisma = new PrismaClient();

async function createShop(code: string) {
  return prisma.shop.create({
    data: {
      shopCode: code,
      shopName: `Pair Shop ${code}`,
      phone: "9000000000",
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
  const expiresAt = new Date(Date.now() + AGENT_PAIRING_TTL_MS);
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      agentPairingTokenHash: hashPairingToken(pairingToken),
      agentPairingExpiresAt: expiresAt,
      agentPairingUsedAt: null,
    },
  });
  return { pairingToken, expiresAt };
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const shopA = await createShop(`PA${stamp}`.slice(0, 12));
  const shopB = await createShop(`PB${stamp}`.slice(0, 12));

  try {
    // 1) Token generation + hashed storage
    const { pairingToken } = await issuePairing(shopA.id);
    assert.ok(pairingToken.length >= 32);
    const stored = await prisma.shop.findUniqueOrThrow({
      where: { id: shopA.id },
      select: {
        agentPairingTokenHash: true,
        agentPairingExpiresAt: true,
        agentPairingUsedAt: true,
      },
    });
    assert.equal(stored.agentPairingTokenHash, hashPairingToken(pairingToken));
    assert.notEqual(stored.agentPairingTokenHash, pairingToken);
    assert.equal(stored.agentPairingUsedAt, null);

    // 2) New token invalidates previous hash
    const second = await issuePairing(shopA.id);
    const afterRotate = await prisma.shop.findUniqueOrThrow({
      where: { id: shopA.id },
      select: { agentPairingTokenHash: true },
    });
    assert.equal(afterRotate.agentPairingTokenHash, hashPairingToken(second.pairingToken));
    assert.notEqual(afterRotate.agentPairingTokenHash, hashPairingToken(pairingToken));

    // 3) Register via pairing
    const registerRes = await registerPost(
      asJsonRequest("http://localhost/api/print-agent/register", {
        pairingToken: second.pairingToken,
        agentId: `${shopA.shopCode}-AGENT-01`,
      }),
    );
    assert.equal(registerRes.status, 200);
    const registerBody = (await registerRes.json()) as {
      token?: string;
      shop?: { shopCode: string };
    };
    assert.ok(registerBody.token);
    assert.equal(registerBody.shop?.shopCode, shopA.shopCode);
    assert.notEqual(registerBody.token, second.pairingToken);

    const afterUse = await prisma.shop.findUniqueOrThrow({
      where: { id: shopA.id },
      select: {
        agentTokenHash: true,
        agentPairingUsedAt: true,
        agentId: true,
      },
    });
    assert.ok(afterUse.agentPairingUsedAt);
    assert.equal(afterUse.agentTokenHash, hashAgentToken(registerBody.token!));
    assert.equal(afterUse.agentId, `${shopA.shopCode}-AGENT-01`);

    // 4) Reuse fails
    const reuse = await registerPost(
      asJsonRequest("http://localhost/api/print-agent/register", {
        pairingToken: second.pairingToken,
        agentId: `${shopA.shopCode}-AGENT-02`,
      }),
    );
    assert.equal(reuse.status, 401);

    // 5) Cross-shop: Shop B token cannot register as Shop A (hash scoped to shop)
    const bPair = await issuePairing(shopB.id);
    const cross = await registerPost(
      asJsonRequest("http://localhost/api/print-agent/register", {
        pairingToken: bPair.pairingToken,
        agentId: `${shopB.shopCode}-AGENT-01`,
      }),
    );
    assert.equal(cross.status, 200);
    const crossBody = (await cross.json()) as { shop?: { shopCode: string } };
    assert.equal(crossBody.shop?.shopCode, shopB.shopCode);

    // 6) Expired pairing fails
    const expiredToken = generatePairingToken();
    await prisma.shop.update({
      where: { id: shopA.id },
      data: {
        agentPairingTokenHash: hashPairingToken(expiredToken),
        agentPairingExpiresAt: new Date(Date.now() - 1000),
        agentPairingUsedAt: null,
      },
    });
    const expiredRes = await registerPost(
      asJsonRequest("http://localhost/api/print-agent/register", {
        pairingToken: expiredToken,
        agentId: `${shopA.shopCode}-EXPIRED`,
      }),
    );
    assert.equal(expiredRes.status, 401);

    // 7) Permanent token works for heartbeat + jobs poll
    const hb = await heartbeatPost(
      asJsonRequest(
        "http://localhost/api/print-agent/heartbeat",
        { selectedPrinter: "Test Printer", printerStatus: "online" },
        { Authorization: `Bearer ${registerBody.token}` },
      ),
    );
    assert.equal(hb.status, 200);

    // jobs route is GET
    const jobsRes = await jobsGet(
      new NextRequest("http://localhost/api/print-agent/jobs", {
        method: "GET",
        headers: { Authorization: `Bearer ${registerBody.token}` },
      }),
    );
    assert.equal(jobsRes.status, 200);

    // 8) Legacy AGENT_SETUP_SECRET path still works when secret configured
    const setupSecret = process.env.AGENT_SETUP_SECRET?.trim();
    if (setupSecret) {
      const legacy = await registerPost(
        asJsonRequest(
          "http://localhost/api/print-agent/register",
          {
            shopCode: shopA.shopCode,
            agentId: `${shopA.shopCode}-LEGACY`,
            setupSecret,
          },
          { "X-Agent-Setup-Secret": setupSecret },
        ),
      );
      assert.equal(legacy.status, 200);
      console.log("legacy setup-secret registration: ok");
    } else {
      console.log("legacy setup-secret registration: skipped (no AGENT_SETUP_SECRET)");
    }

    console.log("phase2b1-pairing-smoke: ok");
  } finally {
    await prisma.printer.deleteMany({
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
