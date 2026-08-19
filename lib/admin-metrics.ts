import { prisma } from "@/lib/prisma";

export type AdminOverviewMetrics = {
  totalShops: number;
  activeShops: number;
  trialShops: number;
  premiumShops: number;
  expiredSubscriptions: number;
  pastDueSubscriptions: number;
  totalPrintJobs: number;
  totalPagesPrinted: number;
};

/**
 * System-wide admin metrics using Prisma count/aggregate only.
 * Does not load Job rows into memory.
 */
export async function getAdminOverviewMetrics(): Promise<AdminOverviewMetrics> {
  const [
    totalShops,
    activeShops,
    trialShops,
    premiumShops,
    expiredSubscriptions,
    pastDueSubscriptions,
    totalPrintJobs,
    pagesAgg,
  ] = await Promise.all([
    prisma.shop.count(),
    prisma.shop.count({ where: { isActive: true } }),
    prisma.subscription.count({
      where: { status: "TRIALING" },
    }),
    prisma.subscription.count({
      where: {
        plan: "PREMIUM",
        status: "ACTIVE",
      },
    }),
    prisma.subscription.count({
      where: { status: "EXPIRED" },
    }),
    prisma.subscription.count({
      where: { status: "PAST_DUE" },
    }),
    prisma.printJob.count(),
    prisma.printJob.aggregate({
      _sum: { totalPages: true },
    }),
  ]);

  return {
    totalShops,
    activeShops,
    trialShops,
    premiumShops,
    expiredSubscriptions,
    pastDueSubscriptions,
    totalPrintJobs,
    totalPagesPrinted: pagesAgg._sum.totalPages ?? 0,
  };
}
