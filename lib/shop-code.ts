import { randomInt } from "crypto";

import { prisma } from "@/lib/prisma";

/** PME + 6 unambiguous uppercase alphanumeric chars (no 0/O/1/I). */
const SHOP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateShopCodeCandidate() {
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += SHOP_CODE_ALPHABET[randomInt(SHOP_CODE_ALPHABET.length)];
  }
  return `PME${suffix}`;
}

/** Allocate a unique shop code, retrying on collision. */
export async function allocateUniqueShopCode(maxAttempts = 12) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const shopCode = generateShopCodeCandidate();
    const existing = await prisma.shop.findUnique({
      where: { shopCode },
      select: { id: true },
    });
    if (!existing) {
      return shopCode;
    }
  }

  throw new Error("Unable to allocate a unique shop code.");
}
