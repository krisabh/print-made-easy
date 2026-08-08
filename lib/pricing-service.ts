import { PrintMode, PrintType, type PrintPrice } from "@prisma/client";

export type PricingRates = {
  bwSingle: number;
  bwDouble: number;
  colorSingle: number;
  colorDouble: number;
  minimumCharge: number;
};

export function toPricingRates(price: PrintPrice): PricingRates {
  return {
    bwSingle: Number(price.bwSingle),
    bwDouble: Number(price.bwDouble),
    colorSingle: Number(price.colorSingle),
    colorDouble: Number(price.colorDouble),
    minimumCharge: Number(price.minimumCharge),
  };
}

export async function getPricingByShopId(shopId: string): Promise<PricingRates | null> {
  const { prisma } = await import("@/lib/prisma");
  const price = await prisma.printPrice.findUnique({
    where: { shopId },
  });

  if (!price) {
    return null;
  }

  return toPricingRates(price);
}

export async function getShopWithPricing(shopCode: string) {
  const { prisma } = await import("@/lib/prisma");

  return prisma.shop.findFirst({
    where: {
      shopCode,
      isActive: true,
    },
    include: {
      printPrice: true,
    },
  });
}

function getUnitPrice(
  rates: PricingRates,
  printMode: PrintMode,
  printType: PrintType,
): number {
  if (printMode === PrintMode.BW && printType === PrintType.SINGLE) {
    return rates.bwSingle;
  }
  if (printMode === PrintMode.BW && printType === PrintType.DOUBLE) {
    return rates.bwDouble;
  }
  if (printMode === PrintMode.COLOR && printType === PrintType.SINGLE) {
    return rates.colorSingle;
  }
  return rates.colorDouble;
}

export function calculatePrintCost(
  rates: PricingRates,
  totalPages: number,
  copies: number,
  printMode: PrintMode,
  printType: PrintType,
): number {
  const pages = Math.max(0, totalPages);
  const copyCount = Math.max(1, copies);
  const rawCost = pages * copyCount * getUnitPrice(rates, printMode, printType);
  return Math.max(rawCost, rates.minimumCharge);
}
