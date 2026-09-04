import { requireShopApi } from "@/lib/auth";
import { confirmShopOneTimePayments } from "@/lib/billing/service";

/**
 * POST /api/billing/confirm
 * Server-side reconcile: verify pending Cashfree PG orders for this shop
 * and activate Premium only after provider confirmation.
 * Never trusts browser/query params as payment proof.
 */
export async function POST() {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    const result = await confirmShopOneTimePayments(session.shop.id);

    return Response.json({
      success: true,
      result: result.result,
      subscription: result.subscription,
    });
  } catch {
    console.error("POST /api/billing/confirm failed");
    return Response.json(
      { error: "Unable to confirm payment." },
      { status: 500 },
    );
  }
}
