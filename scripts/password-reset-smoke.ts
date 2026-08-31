/**
 * Password reset smoke tests (no live Gmail SMTP).
 * Run: npx tsx scripts/password-reset-smoke.ts
 */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

import { hashPassword, verifyPassword } from "../lib/auth";
import { createNestedTrialSubscription } from "../lib/subscription";
import {
  PASSWORD_RESET_GENERIC_MESSAGE,
  PASSWORD_RESET_TTL_MS,
  createPasswordResetForUser,
  findValidPasswordResetToken,
  hashPasswordResetToken,
  requestPasswordReset,
  resetPasswordResetRateLimits,
  resetPasswordWithToken,
  userPasswordMatches,
} from "../lib/password-reset";

const prisma = new PrismaClient();

async function main() {
  const stamp = Date.now().toString(36);
  const email = `reset-smoke-${stamp}@example.com`.toLowerCase();
  const missingEmail = `missing-smoke-${stamp}@example.com`.toLowerCase();
  const oldPassword = "OldPassword123!";
  const newPassword = "NewPassword456!";
  const shopIds: string[] = [];
  const userIds: string[] = [];

  resetPasswordResetRateLimits();

  const sent: Array<{ to: string; subject: string; text: string; html: string }> =
    [];

  try {
    const passwordHash = await hashPassword(oldPassword);
    const user = await prisma.user.create({
      data: {
        name: "Reset Smoke",
        email,
        passwordHash,
        role: "SHOPKEEPER",
        shop: {
          create: {
            shopCode: `R${stamp.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(-7).padStart(7, "2")}`,
            shopName: "Reset Smoke Shop",
            phone: "9999999999",
            address: "Test Address",
            email,
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
            subscription: {
              create: createNestedTrialSubscription(),
            },
          },
        },
      },
      include: { shop: true },
    });
    userIds.push(user.id);
    if (user.shop) shopIds.push(user.shop.id);

    // 1 + 14 — existing email: accepted, token created, email sent
    const existingResult = await requestPasswordReset({
      email,
      ip: "127.0.0.1",
      appBaseUrl: "https://clauras.com",
      sendEmail: async (payload) => {
        sent.push(payload);
      },
    });
    assert.equal(existingResult.ok, true);
    assert.equal(existingResult.message, PASSWORD_RESET_GENERIC_MESSAGE);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, email);
    assert.match(sent[0]?.subject || "", /Reset your PrintMadeEasy password/i);
    assert.match(sent[0]?.text || "", /https:\/\/clauras\.com\/reset-password\?token=/);
    assert.doesNotMatch(sent[0]?.text || "", /tokenHash/i);

    const tokensAfterFirst = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    assert.equal(tokensAfterFirst.length, 1);
    const firstToken = tokensAfterFirst[0]!;
    assert.equal(firstToken.usedAt, null);
    assert.ok(firstToken.expiresAt.getTime() > Date.now());

    // Extract raw token from emailed URL for later checks
    const match = /token=([^&\s]+)/.exec(sent[0]!.text);
    assert.ok(match?.[1]);
    const rawToken = decodeURIComponent(match![1]!);

    // 3 — only hash stored; raw token never in DB
    assert.equal(firstToken.tokenHash, hashPasswordResetToken(rawToken));
    assert.notEqual(firstToken.tokenHash, rawToken);
    const rawInDb = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: rawToken },
    });
    assert.equal(rawInDb, null);
    console.log("1/3/14 PASS existing email → token hash stored, email sent, generic message");

    // 2 + 14 — non-existing email: same generic response, no email
    resetPasswordResetRateLimits();
    const missingBefore = sent.length;
    const missingResult = await requestPasswordReset({
      email: missingEmail,
      ip: "127.0.0.1",
      appBaseUrl: "https://clauras.com",
      sendEmail: async (payload) => {
        sent.push(payload);
      },
    });
    assert.equal(missingResult.ok, true);
    assert.equal(missingResult.message, existingResult.message);
    assert.equal(sent.length, missingBefore);
    console.log("2/14 PASS non-existing email → same generic response, no email");

    // 6 — new reset request invalidates previous unused token
    resetPasswordResetRateLimits();
    await requestPasswordReset({
      email,
      ip: "127.0.0.2",
      appBaseUrl: "https://clauras.com",
      sendEmail: async (payload) => {
        sent.push(payload);
      },
    });
    const afterSecond = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    assert.equal(afterSecond.length, 1);
    assert.notEqual(afterSecond[0]!.tokenHash, firstToken.tokenHash);
    const oldLookup = await findValidPasswordResetToken({ rawToken });
    assert.equal(oldLookup.ok, false);
    console.log("6 PASS new reset request invalidates previous unused token");

    const match2 = /token=([^&\s]+)/.exec(sent[sent.length - 1]!.text);
    assert.ok(match2?.[1]);
    const rawToken2 = decodeURIComponent(match2![1]!);

    // 4 — expired token rejected
    await prisma.passwordResetToken.update({
      where: { id: afterSecond[0]!.id },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const expired = await resetPasswordWithToken({
      rawToken: rawToken2,
      newPassword,
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, "expired");
    console.log("4 PASS expired token rejected");

    // Recreate a fresh valid token for reuse / success tests
    resetPasswordResetRateLimits();
    const created = await createPasswordResetForUser({ userId: user.id });
    assert.equal(
      created.tokenHash,
      hashPasswordResetToken(created.rawToken),
    );

    // 8/9 — invalid token rejected
    const invalid = await resetPasswordWithToken({
      rawToken: "not-a-real-token",
      newPassword,
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.reason, "invalid");
    console.log("8/9 PASS invalid token rejected");

    // 7/10/11/12 — valid reset changes password (bcrypt), old fails, new works
    const resetOk = await resetPasswordWithToken({
      rawToken: created.rawToken,
      newPassword,
    });
    assert.equal(resetOk.ok, true);

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    assert.ok(updated);
    assert.match(updated!.passwordHash, /^\$2[aby]?\$/);
    assert.equal(await bcrypt.compare(newPassword, updated!.passwordHash), true);
    assert.equal(await userPasswordMatches({ userId: user.id, password: oldPassword }), false);
    assert.equal(await userPasswordMatches({ userId: user.id, password: newPassword }), true);
    assert.equal(await verifyPassword(newPassword, updated!.passwordHash), true);
    console.log("7/10/11/12 PASS valid reset → bcrypt hash, old fails, new works");

    // 5 — used token rejected
    const reuse = await resetPasswordWithToken({
      rawToken: created.rawToken,
      newPassword: "AnotherPassword789!",
    });
    assert.equal(reuse.ok, false);
    if (!reuse.ok) assert.equal(reuse.reason, "used");
    console.log("5 PASS used token rejected");

    // TTL constant sanity
    assert.equal(PASSWORD_RESET_TTL_MS, 30 * 60 * 1000);

    // 13 — existing auth helpers still hash/verify
    const roundTrip = await hashPassword("LoginStillWorks1!");
    assert.equal(await verifyPassword("LoginStillWorks1!", roundTrip), true);
    console.log("13 PASS existing password hashing still works");

    console.log("ALL PASSWORD RESET SMOKE TESTS PASSED");
  } finally {
    if (userIds.length) {
      await prisma.passwordResetToken.deleteMany({
        where: { userId: { in: userIds } },
      });
    }
    if (shopIds.length) {
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
