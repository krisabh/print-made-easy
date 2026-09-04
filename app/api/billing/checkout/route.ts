import { requireShopApi } from "@/lib/auth";
import { getPublicAppBaseUrl } from "@/lib/app-url";
import { createBillingCheckout } from "@/lib/billing/service";

/**
 * POST /api/billing/checkout
 * Provider-agnostic Premium checkout for the authenticated shop.
 * Amount/mode/provider come from server config — never from the client body.
 */
export async function POST() {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    const appBaseUrl = await getPublicAppBaseUrl();
    const returnUrl = `${appBaseUrl.replace(/\/$/, "")}/dashboard/pricing?payment=return`;

    const customerName =
      session.user.name || session.shop.shopName || "PrintMadeEasy Shop";
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
