/**
 * One-time helper: attach an existing User (or create one) as owner of PME001
 * when Shop.ownerId is still null.
 *
 * Usage (never commit real passwords):
 *   CLAIM_DEMO_SHOP_EMAIL=you@example.com \
 *   CLAIM_DEMO_SHOP_PASSWORD='your-strong-password' \
 *   npx tsx scripts/claim-pme001.ts
 *
 * Safe on Hostinger only when you intentionally set those env vars.
 * Does not delete PME001 jobs/files.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.CLAIM_DEMO_SHOP_EMAIL?.trim().toLowerCase();
  const password = process.env.CLAIM_DEMO_SHOP_PASSWORD;

  if (!email || !password || password.length < 8) {
    console.error(
      "Set CLAIM_DEMO_SHOP_EMAIL and CLAIM_DEMO_SHOP_PASSWORD (min 8 chars).",
    );
    process.exit(1);
  }

  const shop = await prisma.shop.findUnique({
    where: { shopCode: "PME001" },
    select: { id: true, ownerId: true, shopName: true },
  });

  if (!shop) {
    console.error("PME001 not found. Nothing to claim.");
    process.exit(1);
  }

  if (shop.ownerId) {
    console.log("PME001 already has an owner. No changes made.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: "Demo Shopkeeper" },
    create: {
      email,
      name: "Demo Shopkeeper",
      passwordHash,
    },
  });

  await prisma.shop.update({
    where: { id: shop.id },
    data: { ownerId: user.id, email },
  });

  console.log(`Claimed ${shop.shopName} (PME001) for ${email}`);
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
