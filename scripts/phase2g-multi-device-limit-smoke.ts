/**
 * Shop-scoped MULTI_DEVICE_LIMIT smoke.
 * Run: npx tsx scripts/phase2g-multi-device-limit-smoke.ts
 *
 * Does not modify production. Uses temporary shops + AgentDevice rows.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as loginPost } from "../app/api/print-agent/login/route";
import { POST as registerPost } from "../app/api/print-agent/register/route";
import {
  DEFAULT_MULTI_DEVICE_LIMIT,
  MULTI_DEVICE_LIMIT_ERROR,
  resolveMultiDeviceLimit,
} from "../lib/agent-device-limit";
import { hashPassword } from "../lib/auth";
import {
  generatePairingToken,
  hashPairingToken,
} from "../lib/print-agent-auth";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();
const PASSWORD = "DeviceLimitSmoke!234";

async function createShopWithOwner(code: string, email: string) {
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
          shopName: `Limit Shop ${code}`,
          phone: "9000000088",
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

function loginRequest(body: unknown) {
  return new NextRequest("http://localhost/api/print-agent/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function login(
  email: string,
  agentId: string,
): Promise<{ status: number; body: { error?: string; token?: string } }> {
  const res = await loginPost(
    loginRequest({ email, password: PASSWORD, agentId }),
  );
  const body = (await res.json()) as { error?: string; token?: string };
  return { status: res.status, body };
}

async function seedPairing(shopId: string) {
  const pairingRaw = generatePairingToken();
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      agentPairingTokenHash: hashPairingToken(pairingRaw),
      agentPairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      agentPairingUsedAt: null,
    },
  });
  return pairingRaw;
}

async function registerPairing(pairingToken: string, agentId: string) {
  const res = await registerPost(
    new NextRequest("http://localhost/api/print-agent/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingToken, agentId }),
    }),
  );
  const body = (await res.json()) as { error?: string; token?: string };
  return { status: res.status, body };
}

async function main() {
  const stamp = Date.now().toString(36).toLowerCase();
  const emailA = `limit-a-${stamp}@example.com`;
  const emailB = `limit-b-${stamp}@example.com`;
  const { shop: shopA } = await createShopWithOwner(
    `LDA${stamp}`.slice(0, 12).toUpperCase(),
    emailA,
  );
  const { shop: shopB } = await createShopWithOwner(
    `LDB${stamp}`.slice(0, 12).toUpperCase(),
    emailB,
  );

  const prevLimit = process.env.MULTI_DEVICE_LIMIT;
  const shopIds = [shopA.id, shopB.id];
  const emails = [emailA, emailB];

  try {
    delete process.env.MULTI_DEVICE_LIMIT;
    assert.equal(resolveMultiDeviceLimit(undefined), DEFAULT_MULTI_DEVICE_LIMIT);
    assert.equal(resolveMultiDeviceLimit(""), DEFAULT_MULTI_DEVICE_LIMIT);
    assert.equal(resolveMultiDeviceLimit("2"), 2);
    assert.equal(resolveMultiDeviceLimit("3"), 3);
    assert.equal(resolveMultiDeviceLimit("0"), DEFAULT_MULTI_DEVICE_LIMIT);
    assert.equal(resolveMultiDeviceLimit("-1"), DEFAULT_MULTI_DEVICE_LIMIT);
    assert.equal(resolveMultiDeviceLimit("abc"), DEFAULT_MULTI_DEVICE_LIMIT);
    assert.equal(resolveMultiDeviceLimit("2.5"), DEFAULT_MULTI_DEVICE_LIMIT);
    console.log("CONFIG PASS MULTI_DEVICE_LIMIT parsing + safe default");

    process.env.MULTI_DEVICE_LIMIT = "2";

    const a1 = await login(emailA, "PMEA-WINDOWS-LIMIT-A");
    assert.equal(a1.status, 200);
    assert.ok(a1.body.token);
    const b1 = await login(emailA, "PMEA-WINDOWS-LIMIT-B");
    assert.equal(b1.status, 200);
    assert.ok(b1.body.token);
    const c1 = await login(emailA, "PMEA-WINDOWS-LIMIT-C");
    assert.equal(c1.status, 403);
    assert.equal(c1.body.error, MULTI_DEVICE_LIMIT_ERROR);
    assert.equal(
      await prisma.agentDevice.count({ where: { shopId: shopA.id } }),
      2,
    );
    console.log("LIMIT=2 PASS A+B allowed, C rejected");

    const aAgain = await login(emailA, "PMEA-WINDOWS-LIMIT-A");
    assert.equal(aAgain.status, 200);
    assert.ok(aAgain.body.token);
    assert.equal(
      await prisma.agentDevice.count({ where: { shopId: shopA.id } }),
      2,
    );
    console.log("RECONNECT PASS same agentId at limit still allowed");

    const preserved = await prisma.agentDevice.findMany({
      where: { shopId: shopA.id },
      orderBy: { agentId: "asc" },
      select: { agentId: true },
    });
    assert.deepEqual(
      preserved.map((d) => d.agentId),
      ["PMEA-WINDOWS-LIMIT-A", "PMEA-WINDOWS-LIMIT-B"],
    );
    console.log("PRESERVE PASS existing AgentDevice rows unchanged by rejection");

    const bShopC = await login(emailB, "PMEA-WINDOWS-LIMIT-C");
    assert.equal(bShopC.status, 200);
    assert.equal(
      await prisma.agentDevice.count({ where: { shopId: shopB.id } }),
      1,
    );
    console.log("SHOP-SCOPE PASS Shop B evaluates devices independently");

    process.env.MULTI_DEVICE_LIMIT = "3";
    const cNow = await login(emailA, "PMEA-WINDOWS-LIMIT-C");
    assert.equal(cNow.status, 200);
    assert.equal(
      await prisma.agentDevice.count({ where: { shopId: shopA.id } }),
      3,
    );
    console.log("LIMIT=3 PASS third device allowed after raising limit");

    process.env.MULTI_DEVICE_LIMIT = "2";
    const b2 = await login(emailB, "PMEA-WINDOWS-LIMIT-B2");
    assert.equal(b2.status, 200);
    assert.equal(
      await prisma.agentDevice.count({ where: { shopId: shopB.id } }),
      2,
    );

    const pairingNew = await seedPairing(shopB.id);
    const pairReject = await registerPairing(
      pairingNew,
      "PMEA-WINDOWS-LIMIT-PAIR-NEW",
    );
    assert.equal(pairReject.status, 403);
    assert.equal(pairReject.body.error, MULTI_DEVICE_LIMIT_ERROR);
    assert.equal(
      await prisma.agentDevice.count({ where: { shopId: shopB.id } }),
      2,
    );

    const pairingReuse = await seedPairing(shopB.id);
    const pairReuse = await registerPairing(
      pairingReuse,
      "PMEA-WINDOWS-LIMIT-C",
    );
    assert.equal(pairReuse.status, 200);
    assert.equal(
      await prisma.agentDevice.count({ where: { shopId: shopB.id } }),
      2,
    );
    console.log("PAIRING PASS new device rejected; existing agentId allowed");

    console.log("\nphase2g-multi-device-limit-smoke: ALL PASS");
  } finally {
    if (prevLimit === undefined) {
      delete process.env.MULTI_DEVICE_LIMIT;
    } else {
      process.env.MULTI_DEVICE_LIMIT = prevLimit;
    }
    await prisma.agentDevice.deleteMany({
      where: { shopId: { in: shopIds } },
    });
    await prisma.printer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
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
