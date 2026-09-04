/**
 * Canonical Premium plan — server-side source of truth.
 * Never accept amount/currency from the browser.
 */
export const PREMIUM_PLAN = {
  internalKey: "PREMIUM",
  amountInr: 199,
  currency: "INR",
  intervalType: "MONTH" as const,
  intervals: 1,
  planName: "PrintMadeEasy Premium",
} as const;

export type PremiumPlan = typeof PREMIUM_PLAN;
