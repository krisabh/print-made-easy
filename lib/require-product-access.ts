import { redirect } from "next/navigation";

import { requireShop, requireShopApi, type AuthSession } from "@/lib/auth";
import {
  getSubscriptionAccessForShop,
  type SubscriptionAccessState,
} from "@/lib/subscription";

export function pricingRedirectPath(reason?: string) {
  if (!reason) return "/dashboard/pricing";
  return `/dashboard/pricing?reason=${encodeURIComponent(reason)}`;
}

/**
 * Server-side product access for dashboard pages.
 * Pricing / billing remain reachable without this check.
 */
export async function requireProductAccess(): Promise<{
  session: AuthSession;
  access: SubscriptionAccessState;
}> {
  const session = await requireShop();
  const access = await getSubscriptionAccessForShop(session.shop.id);
  if (!access.hasAccess) {
    redirect(pricingRedirectPath(access.reason));
  }
  return { session, access };
}

/**
 * Server-side product access for authenticated shop APIs.
 * Returns a Response when denied (402 Payment Required).
 */
export async function requireProductAccessApi(): Promise<
  | { session: AuthSession; access: SubscriptionAccessState }
  | Response
> {
  const session = await requireShopApi();
  if (session instanceof Response) return session;

  const access = await getSubscriptionAccessForShop(session.shop.id);
  if (!access.hasAccess) {
    return Response.json(
      {
        error: "Subscription required to use this feature.",
        reason: access.reason,
        redirect: "/dashboard/pricing",
      },
      { status: 402 },
    );
  }

  return { session, access };
}
