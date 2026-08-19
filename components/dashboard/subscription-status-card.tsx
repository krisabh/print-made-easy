import Link from "next/link";

import {
  getDashboardSubscriptionSummary,
  type PublicSubscriptionView,
} from "@/lib/subscription";

type SubscriptionStatusCardProps = {
  subscription: PublicSubscriptionView | null;
  showGraceWarning?: boolean;
};

export function SubscriptionStatusCard({
  subscription,
  showGraceWarning = false,
}: SubscriptionStatusCardProps) {
  const summary = getDashboardSubscriptionSummary(subscription);

  const tone = !subscription
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : showGraceWarning || subscription.status === "PAST_DUE"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : subscription.hasAccess
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
          <p className="mt-1 text-sm font-semibold">
            {summary.title}
            {summary.subtitle ? ` — ${summary.subtitle}` : null}
          </p>
          {showGraceWarning ? (
            <p className="mt-1 text-sm opacity-90">
              Payment needs attention. You still have access during the grace
              period.
            </p>
          ) : null}
        </div>
        <Link
          href="/dashboard/pricing"
          className="text-sm font-medium underline underline-offset-2"
        >
          Manage Subscription
        </Link>
      </div>
    </section>
  );
}
