import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Hostinger / production: never seed demo data unless explicitly opted in.
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

  console.log("Seeded local demo shop:", shop.shopCode, shop.shopName);
  console.log("Do not run this seed against production Hostinger databases.");
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
