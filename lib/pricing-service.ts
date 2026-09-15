import { PrintMode, PrintType, type PrintPrice } from "@prisma/client";

export type PricingRates = {
  bwSingle: number;
  bwDouble: number;
  colorSingle: number;
  colorDouble: number;
  minimumCharge: number;
};

/** New-shop defaults. B&W single-side per page is the Phase 5 shop print price. */
export const DEFAULT_PRINT_PRICING = {
  bwSingle: 5,
  bwDouble: 1.5,
  colorSingle: 10,
  colorDouble: 8,
  minimumCharge: 5,
} as const;

/** Shopkeeper B&W per-page edit limits (INR). */
export const BW_PRICE_PER_PAGE_MIN = 0.5;
export const BW_PRICE_PER_PAGE_MAX = 100;

export function toPricingRates(price: PrintPrice): PricingRates {
  return {
    bwSingle: Number(price.bwSingle),
    bwDouble: Number(price.bwDouble),
    colorSingle: Number(price.colorSingle),
    colorDouble: Number(price.colorDouble),
    minimumCharge: Number(price.minimumCharge),
  };
}

/** True when value is finite and has at most 2 decimal places. */
export function isValidMoneyAmount(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-8;
}

/** Normalize to 2 decimal places for Decimal(10,2) storage. */
export function normalizeMoneyAmount(value: number): number {
  return Math.round(value * 100) / 100;
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

/**
 * Job total at creation time.
 * pages × copies × unitRate, floored by minimumCharge.
 * Caller must persist the result on PrintJob.totalPrice (historical snapshot).
 */
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
