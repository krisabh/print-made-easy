import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.printJob.findMany({
    select: { id: true, shopId: true, jobNumber: true },
    orderBy: { jobNumber: "asc" },
  });
  console.log("total", rows.length);
  for (const row of rows) {
    console.log(`${row.shopId.slice(0, 8)}… ${row.jobNumber}`);
  }
  const bad = rows.filter((r) => !/^PME-\d{6}$/.test(r.jobNumber));
  console.log("nonstandard", bad.length, bad);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
