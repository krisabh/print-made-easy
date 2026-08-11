import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
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

  // Ensure related rows exist even if shop was created earlier without them.
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

  console.log("Seeded shop:", shop.shopCode, shop.shopName);
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
