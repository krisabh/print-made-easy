import { NextResponse } from "next/server";

import { getPublicAppBaseUrl, toBrowserFacingBaseUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * PayU Hosted Checkout browser return bridge.
 *
 * PayU completes checkout with a cross-site POST to success/failure/cancel URLs.
 * Our auth cookie is SameSite=Lax, so it is NOT sent on that cross-site POST.
 * If PayU posted directly to /dashboard/pricing, requireShop() would see no
 * session and redirect to /login — even though the cookie still exists.
 *
 * This route accepts the PayU browser POST (and GET), ignores the body for
 * entitlement, and 303-redirects to a public-origin GET of the pricing page
 * so the existing pme_session cookie is sent normally.
 *
 * Behind Hostinger (and similar reverse proxies), request.url origin may be
 * the internal bind host (localhost:3000). Browser-facing redirects MUST use
 * NEXT_PUBLIC_APP_URL via getPublicAppBaseUrl() — never request.origin.
 *
 * Premium activation remains server-side via /api/billing/confirm + Verify Payment.
 */
async function pricingReturnRedirect(request: Request) {
  const incoming = new URL(request.url);
  const raw = (incoming.searchParams.get("payment") || "return").trim();
  const payment =
    raw === "failed" || raw === "cancel" || raw === "return" ? raw : "return";

  // Prefer configured public app URL (e.g. https://clauras.com).
  // Do not trust request.origin behind a reverse proxy.
  const browserOrigin = toBrowserFacingBaseUrl(await getPublicAppBaseUrl());
  const destination = new URL("/dashboard/pricing", browserOrigin);
  destination.searchParams.set("payment", payment);
  return NextResponse.redirect(destination, 303);
}

export async function GET(request: Request) {
  return pricingReturnRedirect(request);
}

export async function POST(request: Request) {
  // Intentionally do not parse/trust the PayU form body for entitlement.
  // Drain the body so proxies/clients are happy, then redirect.
  try {
    await request.arrayBuffer();
  } catch {
    // ignore
  }
  return pricingReturnRedirect(request);
}
