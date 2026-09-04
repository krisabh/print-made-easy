"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  Check,
  Headphones,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type { BillingMode } from "@/lib/billing/types";
import { resolveBillingPlanCta } from "@/lib/billing/plan-cta";
import type { PublicSubscriptionView } from "@/lib/subscription";

type SaasPricingPlansProps = {
  subscription: PublicSubscriptionView | null;
  cashfreeJsMode: "sandbox" | "production";
  /** Shopkeeper Premium monthly price in INR (from server PREMIUM_PLAN). */
  premiumPriceInr: number;
  /** Server billing mode — drives CTA copy and checkout path. */
  billingMode: BillingMode;
};

const START_FREE_FEATURES = [
  "Full access to all features",
  "Add your printers",
  "Upload and print jobs",
  "Priority support",
];

const PREMIUM_FEATURES = [
  "Add up to 10 printers",
  "All premium features included",
  "Upload and print unlimited jobs",
  "Advanced analytics",
  "Priority support",
  "Automatic updates",
];

declare global {
  interface Window {
    Cashfree?: (options: { mode: string }) => {
      checkout: (options: {
        paymentSessionId: string;
        redirectTarget?: string;
      }) => Promise<{ error?: { message?: string } }>;
      subscriptionsCheckout: (options: {
        subsSessionId: string;
        redirectTarget?: string;
      }) => Promise<{ error?: { message?: string } }>;
    };
  }
}

function loadCashfreeSdk() {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cashfree SDK requires a browser."));
      return;
    }
    if (window.Cashfree) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-pme-cashfree="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Unable to load Cashfree checkout.")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.dataset.pmeCashfree = "true";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Unable to load Cashfree checkout."));
    document.body.appendChild(script);
  });
}

function reasonMessage(reason: string | null) {
  switch (reason) {
    case "trial_expired":
      return "Your free trial has ended. Subscribe to continue using PrintMadeEasy.";
    case "expired":
    case "cancelled":
    case "past_due_expired":
    case "missing":
      return "Your subscription has expired. Subscribe again to restore access.";
    default:
      return null;
  }
}

export function SaasPricingPlans({
  subscription: initialSubscription,
  cashfreeJsMode,
  premiumPriceInr,
  billingMode,
}: SaasPricingPlansProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [subscription, setSubscription] = useState(initialSubscription);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // Server props are authoritative after refresh / navigation.
    setSubscription(initialSubscription);
  }, [initialSubscription]);

  useEffect(() => {
    const reason = searchParams.get("reason");
    const msg = reasonMessage(reason);
    if (msg) setNotice(msg);
  }, [searchParams]);

  useEffect(() => {
    const payment = searchParams.get("payment");
    if (!payment) return;

    let cancelled = false;
    let attempts = 0;

    async function refreshFromServer() {
      setConfirming(true);
      setError(null);
      setNotice(
        "Payment received. We are confirming your payment. This usually takes a moment.",
      );

      while (!cancelled && attempts < 8) {
        attempts += 1;
        try {
          // Server verifies pending orders with Cashfree (not the browser).
          // Covers localhost when Cashfree cannot deliver webhooks to 127.0.0.1.
          const confirmRes = await fetch("/api/billing/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            cache: "no-store",
          });
          if (confirmRes.ok) {
            const confirmData = (await confirmRes.json()) as {
              subscription?: PublicSubscriptionView | null;
            };
            if (confirmData.subscription) {
              setSubscription(confirmData.subscription);
              if (
                confirmData.subscription.status === "ACTIVE" &&
                confirmData.subscription.plan === "PREMIUM" &&
                confirmData.subscription.hasAccess
              ) {
                setNotice("Premium is active.");
                setConfirming(false);
                router.replace("/dashboard/pricing");
                router.refresh();
                return;
              }
            }
          }

          const res = await fetch("/api/subscription", { cache: "no-store" });
          if (!res.ok) {
            throw new Error("Unable to refresh subscription status.");
          }
          const data = (await res.json()) as PublicSubscriptionView;
          if (cancelled) return;
          setSubscription(data);

          if (data.status === "ACTIVE" && data.plan === "PREMIUM" && data.hasAccess) {
            setNotice("Premium is active.");
            setConfirming(false);
            router.replace("/dashboard/pricing");
            router.refresh();
            return;
          }
        } catch {
          // keep polling briefly
        }

        if (attempts < 8) {
          await new Promise((resolve) => window.setTimeout(resolve, 2500));
        }
      }

      if (cancelled) return;

      if (payment === "failed") {
        setNotice("Checkout was not completed. You can try again.");
      } else {
        setNotice(
          "Payment processing. Your payment was received and your subscription is being confirmed. Refresh this page in a moment if Premium is not active yet.",
        );
      }
      setConfirming(false);
      router.replace("/dashboard/pricing");
      router.refresh();
    }

    void refreshFromServer();
    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  const trialActive =
    subscription?.status === "TRIALING" && subscription.hasAccess;
  const trialEnded =
    subscription?.status === "TRIALING" && !subscription.hasAccess;
  const premiumActive =
    subscription?.status === "ACTIVE" &&
    subscription.plan === "PREMIUM" &&
    subscription.hasAccess &&
    !subscription.cancelAtPeriodEnd;
  const cancelAtPeriodEnd =
    Boolean(subscription?.cancelAtPeriodEnd) &&
    subscription?.status === "ACTIVE" &&
    subscription.hasAccess;
  const cancelledUntilPeriodEnd =
    subscription?.status === "CANCELLED" && subscription.hasAccess;
  const pastDue =
    subscription?.status === "PAST_DUE" && subscription.hasAccess;
  const expired = Boolean(subscription && !subscription.hasAccess);
  const canCancel = Boolean(subscription?.canCancel);
  const planCta = resolveBillingPlanCta(subscription, {
    billingMode,
    premiumPriceInr,
    busy,
  });

  async function startPremiumCheckout() {
    setBusy(true);
    setError(null);
    setNotice(
      billingMode === "ONE_TIME"
        ? "Creating payment…"
        : "Creating subscription…",
    );

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        checkoutSessionId?: string;
        checkoutKind?: "cashfree_payment" | "cashfree_subscription";
        environment?: "sandbox" | "production";
      };

      if (!res.ok || !data.checkoutSessionId || !data.checkoutKind) {
        throw new Error(data.error || "Payment initiation failed.");
      }

      setNotice("Redirecting to payment…");
      await loadCashfreeSdk();
      if (!window.Cashfree) {
        throw new Error("Cashfree checkout is unavailable.");
      }

      const cashfree = window.Cashfree({
        mode: data.environment || cashfreeJsMode,
      });

      if (data.checkoutKind === "cashfree_payment") {
        const result = await cashfree.checkout({
          paymentSessionId: data.checkoutSessionId,
          redirectTarget: "_self",
        });
        if (result?.error?.message) {
          throw new Error(result.error.message);
        }
        return;
      }

      if (data.checkoutKind === "cashfree_subscription") {
        const result = await cashfree.subscriptionsCheckout({
          subsSessionId: data.checkoutSessionId,
          redirectTarget: "_self",
        });
        if (result?.error?.message) {
          throw new Error(result.error.message);
        }
        return;
      }

      throw new Error("Unsupported checkout type.");
    } catch (err) {
      setNotice(null);
      setError(
        err instanceof Error ? err.message : "Payment initiation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelSubscription() {
    setCancelling(true);
    setError(null);
    setNotice("Cancelling subscription…");

    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        subscription?: PublicSubscriptionView;
      };

      if (!res.ok) {
        throw new Error(data.error || "Unable to cancel subscription.");
      }

      if (data.subscription) {
        setSubscription(data.subscription);
      } else {
        const refresh = await fetch("/api/subscription", { cache: "no-store" });
        if (refresh.ok) {
          setSubscription((await refresh.json()) as PublicSubscriptionView);
        }
      }
      setNotice(
        data.message ||
          "Subscription cancelled. Access continues until the end of the billing period.",
      );
    } catch (err) {
      setNotice(null);
      setError(
        err instanceof Error ? err.message : "Unable to cancel subscription.",
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold tracking-[0.16em] text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Simple, transparent pricing
        </h2>
        <p className="mt-3 text-base text-slate-500 sm:text-lg">
          Choose the plan that fits your printing business
        </p>
      </header>

      {subscription ? (
        <div
          className={`mx-auto mt-8 max-w-xl rounded-2xl border px-4 py-5 text-left sm:px-5 ${
            pastDue || expired
              ? "border-amber-200 bg-amber-50"
              : subscription.hasAccess
                ? trialActive
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-blue-200 bg-blue-50"
                : "border-amber-200 bg-amber-50"
          }`}
        >
          <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
            Current plan
          </p>
          {premiumActive || cancelAtPeriodEnd || cancelledUntilPeriodEnd ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xl font-semibold text-slate-900">Premium</p>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                  {cancelAtPeriodEnd || cancelledUntilPeriodEnd
                    ? "Active until period end"
                    : "Active"}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-800">
                ₹{premiumPriceInr} / month
              </p>
              {subscription.currentPeriodEnd ? (
                <p className="text-sm text-slate-600">
                  {cancelAtPeriodEnd || cancelledUntilPeriodEnd
                    ? "Access until: "
                    : "Next billing date: "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                    "en-IN",
                    {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    },
                  )}
                </p>
              ) : null}
              {subscription.currentPeriodStart && subscription.currentPeriodEnd ? (
                <p className="text-sm text-slate-600">
                  Subscription period:{" "}
                  {new Date(subscription.currentPeriodStart).toLocaleDateString(
                    "en-IN",
                    {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    },
                  )}{" "}
                  –{" "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                    "en-IN",
                    {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    },
                  )}
                </p>
              ) : null}
              {cancelAtPeriodEnd || cancelledUntilPeriodEnd ? (
                <p className="text-sm font-medium text-amber-800">
                  Cancellation scheduled · No further renewal
                  {subscription.currentPeriodEnd
                    ? ` · Active until ${new Date(
                        subscription.currentPeriodEnd,
                      ).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}`
                    : ""}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {subscription.label}
              </p>
              <p className="mt-1 text-sm text-slate-600">{subscription.detail}</p>
            </>
          )}
          {trialActive ? (
            <p className="mt-2 text-sm font-medium text-emerald-700">
              Trial is active
            </p>
          ) : null}
          {confirming ? (
            <p className="mt-2 text-sm text-slate-500">
              Checking subscription status…
            </p>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              disabled={cancelling || busy}
              className="mt-4 text-sm font-medium text-slate-700 underline underline-offset-2 disabled:opacity-60"
              onClick={() => void cancelSubscription()}
            >
              {cancelling ? "Cancelling…" : "Cancel subscription"}
            </button>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className="mx-auto mt-4 max-w-xl rounded-xl bg-slate-100 px-4 py-3 text-center text-sm text-slate-700">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mx-auto mt-4 max-w-xl rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
        <article className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="inline-flex w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700 uppercase">
            7-Day Free Trial
          </p>
          <h3 className="mt-4 text-2xl font-semibold text-slate-900">Start Free</h3>
          <p className="mt-1 text-sm text-slate-500">
            Try all premium features, risk-free
          </p>
          <p className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            7 Days Free Trial
          </p>
          {trialActive ? (
            <p className="mt-2 text-sm font-medium text-emerald-700">
              {subscription?.daysRemaining === 1
                ? "1 day remaining"
                : `${subscription?.daysRemaining ?? 0} days remaining`}
            </p>
          ) : trialEnded ? (
            <p className="mt-2 text-sm font-medium text-amber-700">
              Trial ended · Subscribe to continue
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Explore PrintMadeEasy with your shop before you subscribe.
            </p>
          )}

          <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
            <p className="text-sm font-semibold text-emerald-800">
              No payment details required
            </p>
            <p className="mt-1 text-sm text-emerald-700">
              Try everything for 7 days. Cancel anytime.
            </p>
          </div>

          <ul className="mt-6 space-y-3">
            {START_FREE_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                {feature}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-1 flex-col justify-end">
            <div className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-50 text-sm font-semibold text-emerald-800">
              {trialActive ? "Trial in progress" : "Included with signup"}
            </div>
            <p className="mt-3 text-center text-sm text-slate-400">
              No card required to get started
            </p>
          </div>
        </article>

        <article className="relative flex flex-col rounded-3xl border-2 border-blue-600 bg-white p-6 shadow-md sm:p-8 lg:-mt-2 lg:mb-[-8px]">
          <p className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
            Recommended
          </p>
          <div className="flex items-center gap-2 text-blue-600">
            <Sparkles className="size-4" aria-hidden="true" />
            <p className="text-xs font-semibold tracking-[0.14em] uppercase">
              For growing shops
            </p>
          </div>
          <h3 className="mt-4 text-2xl font-semibold text-slate-900">Premium</h3>
          <p className="mt-1 text-sm text-slate-500">
            Everything you need to grow your business
          </p>
          <p className="mt-6 text-4xl font-semibold tracking-tight text-slate-900">
            ₹{premiumPriceInr}
            <span className="text-lg font-medium text-slate-500"> /month</span>
          </p>
          {premiumActive ? (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium text-blue-700">
                {planCta.headline || "You are already a Premium member."}
              </p>
              {planCta.validUntil ? (
                <p className="text-sm text-slate-600">
                  Valid until: {planCta.validUntil}
                </p>
              ) : subscription?.detail ? (
                <p className="text-sm text-slate-600">{subscription.detail}</p>
              ) : null}
            </div>
          ) : cancelAtPeriodEnd || cancelledUntilPeriodEnd ? (
            <p className="mt-2 text-sm font-medium text-amber-800">
              {subscription?.detail}
            </p>
          ) : pastDue ? (
            <p className="mt-2 text-sm font-medium text-amber-700">
              {subscription?.detail}
            </p>
          ) : expired ? (
            <p className="mt-2 text-sm font-medium text-amber-700">
              {subscription?.status === "PAST_DUE"
                ? subscription.detail ||
                  "Payment failed and the grace period has ended. Restore Premium to continue."
                : "Subscribe again to restore access."}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              {billingMode === "ONE_TIME"
                ? "Pay monthly. Renew manually when your period ends."
                : "Billed monthly. Cancel anytime."}
            </p>
          )}

          <ul className="mt-8 space-y-3">
            {PREMIUM_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                {feature}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-1 flex-col justify-end">
            {planCta.kind === "premium_active" ? (
              <div className="space-y-2">
                <div className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-blue-50 text-sm font-semibold text-blue-800">
                  {planCta.label}
                </div>
                <p className="text-center text-sm text-slate-600">
                  {planCta.headline}
                </p>
                {planCta.validUntil ? (
                  <p className="text-center text-xs text-slate-500">
                    Valid until: {planCta.validUntil}
                  </p>
                ) : null}
              </div>
            ) : planCta.kind === "access_until_period_end" ? (
              <div className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-700">
                {planCta.label}
              </div>
            ) : planCta.kind === "past_due_grace" ? (
              <div className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-amber-50 text-sm font-semibold text-amber-800">
                {planCta.label}
              </div>
            ) : (
              <button
                type="button"
                disabled={!planCta.payEnabled}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                onClick={() => void startPremiumCheckout()}
              >
                {planCta.label}
              </button>
            )}
            <p className="mt-3 text-center text-xs text-slate-500">
              {billingMode === "ONE_TIME"
                ? "Manual monthly renewal · Secure checkout"
                : "Secure payments powered by Cashfree"}
            </p>
          </div>
        </article>
      </div>

      <section className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TrustItem
          icon={ShieldCheck}
          title="Secure Payments"
          text="Encrypted checkout"
        />
        <TrustItem
          icon={Ban}
          title={billingMode === "ONE_TIME" ? "No auto-renewal" : "Cancel Anytime"}
          text={
            billingMode === "ONE_TIME"
              ? "You choose when to renew."
              : "No lock-in. Cancel anytime."
          }
        />
        <TrustItem
          icon={Lock}
          title="100% Safe"
          text="Your data is always protected."
        />
        <TrustItem
          icon={Headphones}
          title="24/7 Support"
          text="We're here to help."
        />
      </section>

      <p className="mt-8 text-center text-sm text-slate-500">
        {billingMode === "ONE_TIME"
          ? "All plans include 7-day free trial · Renew manually each month"
          : "All plans include 7-day free trial • Cancel anytime"}
      </p>
    </div>
  );
}

function TrustItem({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof ShieldCheck;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-center shadow-sm">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}
