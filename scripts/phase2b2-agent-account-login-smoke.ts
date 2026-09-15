/**
 * Feature 2 Phase 2B.2 — Agent same-account login smoke.
 * Run: npx tsx scripts/phase2b2-agent-account-login-smoke.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

import { POST as loginPost } from "../app/api/print-agent/login/route";
import { hashPassword } from "../lib/auth";
import {
  generateAgentToken,
  hashAgentToken,
  resolveAgentAuth,
} from "../lib/print-agent-auth";
import { createNestedTrialSubscription } from "../lib/subscription";

const prisma = new PrismaClient();
const PASSWORD = "AgentLoginSmoke!234";

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
          shopName: `Login Shop ${code}`,
          phone: "9000000099",
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

function asJsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/print-agent/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  const stamp = Date.now().toString(36).toLowerCase();
  const emailA = `agent-login-a-${stamp}@example.com`;
  const emailB = `agent-login-b-${stamp}@example.com`;
  const { shop: shopA } = await createShopWithOwner(
    `LA${stamp}`.slice(0, 12).toUpperCase(),
    emailA,
  );
  const { shop: shopB } = await createShopWithOwner(
    `LB${stamp}`.slice(0, 12).toUpperCase(),
    emailB,
  );

  // Seed legacy Shop token that must survive logins
  const legacyRaw = generateAgentToken();
  await prisma.shop.update({
    where: { id: shopA.id },
    data: {
      agentId: "LEGACY-KEEP",
      agentTokenHash: hashAgentToken(legacyRaw),
      agentLastSeen: new Date(),
    },
  });

  try {
    // A — valid login
    const loginA1 = await loginPost(
      asJsonRequest({
        email: emailA,
        password: PASSWORD,
        agentId: "PMEA-WINDOWS-PC1",
      }),
    );
    assert.equal(loginA1.status, 200);
    const bodyA1 = (await loginA1.json()) as {
      token?: string;
      agentId?: string;
      shop?: { id: string; shopCode: string };
    };
    assert.ok(bodyA1.token);
    assert.equal(bodyA1.agentId, "PMEA-WINDOWS-PC1");
    assert.equal(bodyA1.shop?.id, shopA.id);
    const authA1 = await resolveAgentAuth(bodyA1.token!);
    assert.ok(authA1 && !authA1.legacy);
    assert.equal(authA1!.shop.id, shopA.id);
    console.log("A PASS valid shop account can authenticate Agent login");

    // B — invalid password
    const badPass = await loginPost(
      asJsonRequest({
        email: emailA,
        password: "WrongPassword!!!",
        agentId: "PMEA-WINDOWS-PC1",
      }),
    );
    assert.equal(badPass.status, 401);
    const badPassBody = (await badPass.json()) as { error?: string };
    assert.equal(badPassBody.error, "Invalid email or password.");
    console.log("B PASS invalid password rejected");

    // C — unknown email (generic)
    const unknown = await loginPost(
      asJsonRequest({
        email: `no-such-${stamp}@example.com`,
        password: PASSWORD,
        agentId: "PMEA-WINDOWS-PC1",
      }),
    );
    assert.equal(unknown.status, 401);
    const unknownBody = (await unknown.json()) as { error?: string };
    assert.equal(unknownBody.error, "Invalid email or password.");
    console.log("C PASS unknown email rejected generically");

    // D — account cannot create device for another shop (shop derived server-side)
    const cross = await loginPost(
      asJsonRequest({
        email: emailB,
        password: PASSWORD,
        agentId: "PMEA-WINDOWS-CROSS",
      }),
    );
    assert.equal(cross.status, 200);
    const crossBody = (await cross.json()) as {
      token: string;
      shop: { id: string };
    };
    assert.equal(crossBody.shop.id, shopB.id);
    const crossAuth = await resolveAgentAuth(crossBody.token);
    assert.equal(crossAuth!.shop.id, shopB.id);
    assert.notEqual(crossAuth!.shop.id, shopA.id);
    console.log("D PASS account only receives its own Shop");

    // E/F — second computer under same account
    const loginA2 = await loginPost(
      asJsonRequest({
        email: emailA,
        password: PASSWORD,
        agentId: "PMEA-WINDOWS-PC2",
      }),
    );
    assert.equal(loginA2.status, 200);
    const bodyA2 = (await loginA2.json()) as { token: string };
    const devices = await prisma.agentDevice.findMany({
      where: { shopId: shopA.id },
      orderBy: { agentId: "asc" },
    });
    assert.equal(devices.length, 2);
    assert.ok(devices.some((d) => d.agentId === "PMEA-WINDOWS-PC1"));
    assert.ok(devices.some((d) => d.agentId === "PMEA-WINDOWS-PC2"));
    console.log("E–F PASS first and second computers create AgentDevices");

    // G/H — both tokens valid
    assert.ok(await resolveAgentAuth(bodyA1.token!));
    assert.ok(await resolveAgentAuth(bodyA2.token));
    console.log("G–H PASS AgentDevice A and B tokens remain valid");

    // I/J — Shop legacy fields preserved
    const shopAfter = await prisma.shop.findUniqueOrThrow({
      where: { id: shopA.id },
      select: { agentTokenHash: true, agentId: true },
    });
    assert.equal(shopAfter.agentTokenHash, hashAgentToken(legacyRaw));
    assert.equal(shopAfter.agentId, "LEGACY-KEEP");
    assert.ok(await resolveAgentAuth(legacyRaw));
    console.log("I–J PASS Shop.agentTokenHash / agentId not overwritten");

    // K/L — same agentId relogin rotates, no duplicate
    const relogin = await loginPost(
      asJsonRequest({
        email: emailA,
        password: PASSWORD,
        agentId: "PMEA-WINDOWS-PC1",
      }),
    );
    assert.equal(relogin.status, 200);
    const reloginBody = (await relogin.json()) as { token: string };
    const afterRelogin = await prisma.agentDevice.findMany({
      where: { shopId: shopA.id },
    });
    assert.equal(afterRelogin.length, 2);
    assert.equal(await resolveAgentAuth(bodyA1.token!), null);
    assert.ok(await resolveAgentAuth(reloginBody.token));
    assert.ok(await resolveAgentAuth(bodyA2.token));
    console.log("K–L PASS same agentId relogin rotates without duplicate");

    // M/N — raw password/token never persisted
    const deviceRows = await prisma.agentDevice.findMany({
      where: { shopId: shopA.id },
    });
    const blob = JSON.stringify(deviceRows);
    assert.ok(!blob.includes(PASSWORD));
    assert.ok(!blob.includes(reloginBody.token));
    assert.ok(!blob.includes(bodyA2.token));
    for (const row of deviceRows) {
      assert.equal(row.tokenHash.length, 64);
      assert.notEqual(row.tokenHash, reloginBody.token);
    }
    console.log("M–N PASS raw password and Agent token never persisted");

    // O — legacy Shop token still works
    assert.ok(await resolveAgentAuth(legacyRaw));
    console.log("O PASS existing legacy Agent token authentication still works");

    console.log("\nphase2b2-agent-account-login-smoke: ALL PASS");
  } finally {
    await prisma.agentDevice.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    await prisma.printer.deleteMany({
      where: { shopId: { in: [shopA.id, shopB.id] } },
    });
    await prisma.shop.deleteMany({
      where: { id: { in: [shopA.id, shopB.id] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [emailA, emailB] } },
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
