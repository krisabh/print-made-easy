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
 * Authenticated shopkeeper session for dashboard pages.
 * Always allows viewing dashboard sections; callers must gate core
 * printing/write actions with hasAccess / requireProductAccessApi.
 */
export async function requireDashboardSession(): Promise<{
  session: AuthSession;
  access: SubscriptionAccessState;
}> {
  const session = await requireShop();
  const access = await getSubscriptionAccessForShop(session.shop.id);
  return { session, access };
}

/**
 * @deprecated Prefer requireDashboardSession for pages.
 * Kept for any callers that still need hard redirect — now aliases view access.
 */
export async function requireProductAccess(): Promise<{
  session: AuthSession;
  access: SubscriptionAccessState;
}> {
  return requireDashboardSession();
}

/**
 * Server-side product access for authenticated shop APIs that perform
 * core printing / billing-gated write operations.
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

/** Shop session for read-only dashboard APIs (jobs list, etc.). */
export async function requireShopApiSession(): Promise<
  | { session: AuthSession; access: SubscriptionAccessState }
  | Response
> {
  const session = await requireShopApi();
  if (session instanceof Response) return session;
  const access = await getSubscriptionAccessForShop(session.shop.id);
  return { session, access };
}
