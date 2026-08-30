import { requireShopApi } from "@/lib/auth";
import { getPublicAppBaseUrl } from "@/lib/app-url";
import {
  buildMerchantSubscriptionId,
  cancelCashfreeSubscription,
  createCashfreeSubscription,
  getCashfreeJsMode,
  PREMIUM_PLAN,
} from "@/lib/cashfree";
import {
  abandonPendingCashfreeCheckout,
  claimPremiumCheckoutSlot,
  finalizePremiumCheckoutClaim,
  releasePremiumCheckoutClaim,
} from "@/lib/subscription";

export async function POST() {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    const claim = await claimPremiumCheckoutSlot({ shopId: session.shop.id });
    if (!claim.ok) {
      return Response.json({ error: claim.error }, { status: claim.status });
    }

    // Best-effort cancel of a previous pending Cashfree subscription (never ACTIVE).
    if (claim.previousProviderSubscriptionId) {
      await abandonPendingCashfreeCheckout({
        subscription: {
          ...claim.subscription,
          providerSubscriptionId: claim.previousProviderSubscriptionId,
        },
      });
    }

    const appBaseUrl = await getPublicAppBaseUrl();
    const returnUrl = `${appBaseUrl.replace(/\/$/, "")}/dashboard/pricing?payment=return`;
    const merchantSubscriptionId = buildMerchantSubscriptionId(
      session.shop.shopCode,
    );

    const customerName =
      session.user.name || session.shop.shopName || "PrintMadeEasy Shop";
    const customerEmail =
      session.user.email ||
      session.shop.email ||
      `shop-${session.shop.shopCode}@printmadeeasy.local`;
    const customerPhone = session.shop.phone || "9999999999";

    let created;
    try {
      created = await createCashfreeSubscription({
        merchantSubscriptionId,
        customer: {
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
        },
        returnUrl,
      });
    } catch (error) {
      console.error("Cashfree create subscription failed");
      // Release claim so the shopkeeper can retry.
      await releasePremiumCheckoutClaim({
        subscriptionId: claim.subscription.id,
        claimToken: claim.claimToken,
        restoreProviderSubscriptionId: claim.previousProviderSubscriptionId,
      }).catch(() => undefined);

      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to start Cashfree checkout.",
        },
        { status: 502 },
      );
    }

    // Persist provider references only — do NOT activate Premium here.
    // Prefer merchant subscription_id (required by Cashfree manage/cancel API).
    const providerSubscriptionId =
      created.subscriptionId || created.cfSubscriptionId;

    const finalized = await finalizePremiumCheckoutClaim({
      subscriptionId: claim.subscription.id,
      claimToken: claim.claimToken,
      providerSubscriptionId,
      providerCustomerId: created.customerId,
      providerPlanId: created.planId || String(PREMIUM_PLAN.internalKey),
    });

    if (finalized.count === 0) {
      // Row became ACTIVE or claim was lost — abandon the new Cashfree sub.
      try {
        await cancelCashfreeSubscription({
          subscriptionId: providerSubscriptionId,
        });
      } catch {
        console.warn(
          "Unable to cancel orphan Cashfree subscription after lost checkout claim",
        );
      }
      return Response.json(
        {
          error:
            "This shop already has an active Premium subscription or another checkout finished first.",
        },
        { status: 409 },
      );
    }

    return Response.json({
      success: true,
      environment: getCashfreeJsMode(),
      subscriptionId: created.subscriptionId,
      subscriptionSessionId: created.subscriptionSessionId,
      // Informational only — status remains trial/previous until webhook.
      message: "Redirecting to Cashfree checkout.",
    });
  } catch (error) {
    console.error("POST /api/subscription/create failed");
    return Response.json(
      { error: "Unable to create subscription checkout." },
      { status: 500 },
    );
  }
}
