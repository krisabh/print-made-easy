import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Local / intentional demo seed.
 * Preserves PME001. Optionally claims it for a shopkeeper when:
 *   CLAIM_DEMO_SHOP_EMAIL + CLAIM_DEMO_SHOP_PASSWORD are set
 * Never hardcodes a production password.
 */
async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    console.error(
      "Refusing to seed production. Demo seed is local-only. Set ALLOW_DEMO_SEED=true only if intentional.",
    );
    process.exit(1);
  }

  if (process.env.DISABLE_DEMO_SEED === "true") {
    console.log("Seed skipped (DISABLE_DEMO_SEED=true).");
    return;
  }

  const shop = await prisma.shop.upsert({
    where: { shopCode: "PME001" },
    update: {},
    create: {
      shopCode: "PME001",
      shopName: "Demo Print Shop",
      phone: "9876543210",
      address: "Demo Address",
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
        create: {
          paperAvailable: 0,
          estimatedInkLevel: 100,
        },
      },
    },
  });

  await prisma.printPrice.upsert({
    where: { shopId: shop.id },
    update: {},
    create: {
      shopId: shop.id,
      bwSingle: 2,
      bwDouble: 1.5,
      colorSingle: 10,
      colorDouble: 8,
      minimumCharge: 5,
    },
  });

  await prisma.settings.upsert({
    where: { shopId: shop.id },
    update: {},
    create: {
      shopId: shop.id,
      currency: "INR",
      timezone: "Asia/Kolkata",
      autoDeleteDays: 7,
    },
  });

  await prisma.inventory.upsert({
    where: { shopId: shop.id },
    update: {},
    create: {
      shopId: shop.id,
      paperAvailable: 0,
      estimatedInkLevel: 100,
    },
  });

  const claimEmail = process.env.CLAIM_DEMO_SHOP_EMAIL?.trim().toLowerCase();
  const claimPassword = process.env.CLAIM_DEMO_SHOP_PASSWORD;

  if (claimEmail && claimPassword && claimPassword.length >= 8) {
    const existingOwner = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { ownerId: true },
    });

    if (!existingOwner?.ownerId) {
      const passwordHash = await bcrypt.hash(claimPassword, 12);
      const user = await prisma.user.upsert({
        where: { email: claimEmail },
        update: {
          name: "Demo Shopkeeper",
          passwordHash,
        },
        create: {
          name: "Demo Shopkeeper",
          email: claimEmail,
          passwordHash,
        },
      });

      await prisma.shop.update({
        where: { id: shop.id },
        data: { ownerId: user.id, email: claimEmail },
      });

      console.log("Linked PME001 to user:", claimEmail);
    } else {
      console.log("PME001 already has an owner; claim skipped.");
    }
  } else {
    console.log(
      "PME001 seeded without owner. To claim later, set CLAIM_DEMO_SHOP_EMAIL and CLAIM_DEMO_SHOP_PASSWORD then re-run seed.",
    );
  }

  console.log("Seeded local demo shop:", shop.shopCode, shop.shopName);
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
