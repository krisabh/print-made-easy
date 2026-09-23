import { getCurrentPremiumPriceInr } from "@/lib/admin-settings";
import { requireShopApi } from "@/lib/auth";
import { parseCheckoutCouponRequest, quoteCouponForCheckout } from "@/lib/coupon-checkout";

/**
 * POST /api/billing/coupon-quote
 * Validates a coupon for the authenticated shop and returns the server total.
 */
export async function POST(request: Request) {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid checkout." }, { status: 400 });
    }
    const parsed = parseCheckoutCouponRequest(body);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    if (!parsed.couponCode) {
      return Response.json({ error: "Enter a valid coupon code." }, { status: 400 });
    }

    const basePriceInr = await getCurrentPremiumPriceInr();
    const quote = await quoteCouponForCheckout({
      shopId: session.shop.id,
      couponCode: parsed.couponCode,
      basePriceInr,
    });
    if (!quote.ok) {
      return Response.json({ error: quote.error }, { status: quote.status });
    }

    return Response.json({
      success: true,
      code: quote.quote.code,
      basePriceInr: quote.quote.basePriceInr,
      discountInr: quote.quote.discountInr,
      finalAmountInr: quote.quote.finalAmountInr,
    });
  } catch {
    console.error("POST /api/billing/coupon-quote failed");
    return Response.json(
      { error: "Unable to apply this coupon." },
      { status: 500 },
    );
  }
}
