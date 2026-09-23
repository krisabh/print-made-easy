import { requireShopApi } from "@/lib/auth";
import { getPublicAppBaseUrl } from "@/lib/app-url";
import { createBillingCheckout } from "@/lib/billing/service";
import { parseCheckoutCouponRequest } from "@/lib/coupon-checkout";

/**
 * POST /api/billing/checkout
 * Provider-agnostic Premium checkout for the authenticated shop.
 * The server resolves the price. The body may only include couponCode.
 */
export async function POST(request: Request) {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    let body: unknown = null;
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json({ error: "Invalid checkout." }, { status: 400 });
      }
    }
    const parsed = parseCheckoutCouponRequest(body);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    const appBaseUrl = await getPublicAppBaseUrl();
    const returnUrl = `${appBaseUrl.replace(/\/$/, "")}/dashboard/pricing?payment=return`;

    const customerName =
      session.user.name || session.shop.shopName || "PrintYantra Shop";
    const customerEmail =
      session.user.email ||
      session.shop.email ||
      `shop-${session.shop.shopCode}@printmadeeasy.local`;
    const customerPhone = session.shop.phone || "9999999999";

    const result = await createBillingCheckout({
      shopId: session.shop.id,
      shopCode: session.shop.shopCode,
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
      },
      returnUrl,
      addressLine1: session.shop.address || undefined,
      couponCode: parsed.couponCode,
    });

    if (!result.ok) {
      return Response.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return Response.json({
      success: true,
      ...result.checkout,
      message:
        result.checkout.mode === "ONE_TIME"
          ? "Redirecting to payment."
          : "Redirecting to subscription checkout.",
    });
  } catch {
    console.error("POST /api/billing/checkout failed");
    return Response.json(
      { error: "Unable to create billing checkout." },
      { status: 500 },
    );
  }
}
