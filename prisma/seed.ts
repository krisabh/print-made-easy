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
