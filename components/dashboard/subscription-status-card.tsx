import Link from "next/link";

import type { PublicSubscriptionView } from "@/lib/subscription";

type SubscriptionStatusCardProps = {
  subscription: PublicSubscriptionView | null;
};

export function SubscriptionStatusCard({
  subscription,
}: SubscriptionStatusCardProps) {
  if (!subscription) {
    return (
      <section className="max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
        <p className="text-sm font-semibold text-amber-900">Subscription</p>
        <p className="mt-1 text-sm text-amber-800">
          No subscription found.{" "}
          <Link href="/dashboard/pricing" className="font-medium underline">
            View plans
          </Link>
        </p>
      </section>
    );
  }

  const tone = subscription.hasAccess
    ? subscription.status === "TRIALING"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-blue-200 bg-blue-50 text-blue-900"
    : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <section className={`max-w-xl rounded-2xl border px-4 py-4 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase opacity-80">
            Subscription
          </p>
          <p className="mt-1 text-sm font-semibold">{subscription.label}</p>
          <p className="mt-1 text-sm opacity-90">{subscription.detail}</p>
        </div>
        <Link
          href="/dashboard/pricing"
          className="text-sm font-medium underline underline-offset-2"
        >
          Manage plan
        </Link>
      </div>
    </section>
  );
}
