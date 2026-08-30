import { requireShopApi } from "@/lib/auth";
import { getPublicAppBaseUrl } from "@/lib/app-url";
import {
  buildMerchantSubscriptionId,
  createCashfreeSubscription,
  getCashfreeJsMode,
  CASHFREE_PROVIDER,
  PREMIUM_PLAN,
} from "@/lib/cashfree";
import { prisma } from "@/lib/prisma";
import {
  canInitiatePremiumCheckout,
  getShopSubscription,
} from "@/lib/subscription";

export async function POST() {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    const subscription = await getShopSubscription(session.shop.id);
    const gate = canInitiatePremiumCheckout(subscription);
    if (!gate.ok) {
      return Response.json({ error: gate.error }, { status: 409 });
    }

    if (!subscription) {
      return Response.json({ error: "Subscription not found." }, { status: 404 });
    }

    const appBaseUrl = await getPublicAppBaseUrl();
    const returnUrl = `${appBaseUrl.replace(/\/$/, "")}/dashboard/pricing?payment=return`;
    const merchantSubscriptionId = buildMerchantSubscriptionId(
      session.shop.shopCode,
    );

    const customerName =
      session.user.name || session.shop.shopName || "PrintMadeEasy Shop";
    const customerEmail =
      session.user.email || session.shop.email || `shop-${session.shop.shopCode}@printmadeeasy.local`;
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
    // Webhook lookup still matches via subscription_id / cf_subscription_id lists.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        provider: CASHFREE_PROVIDER,
        providerSubscriptionId:
          created.subscriptionId || created.cfSubscriptionId,
        providerCustomerId: created.customerId,
        providerPlanId: created.planId || String(PREMIUM_PLAN.internalKey),
      },
    });

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
