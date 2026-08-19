import Link from "next/link";

import {
  formatAdminCreatedDate,
  type AdminSubscriptionDetail,
} from "@/lib/admin-subscriptions";

function formatOptionalDate(iso: string | null) {
  if (!iso) return "—";
  return formatAdminCreatedDate(iso);
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  subscription: AdminSubscriptionDetail;
};

export function AdminSubscriptionDetailView({ subscription }: Props) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Shop
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Shop name" value={subscription.shop.shopName} />
          <Field label="Shop code" value={subscription.shop.shopCode} mono />
          <Field label="Owner" value={subscription.shop.ownerName || "—"} />
          <Field label="Email" value={subscription.shop.ownerEmail || "—"} />
          <div className="sm:col-span-2">
            <Link
              href={`/admin/shops/${subscription.shop.id}`}
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              View shop details
            </Link>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Subscription
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Plan"
            value={subscription.plan === "PREMIUM" ? "Premium" : "Trial"}
          />
          <Field label="Status" value={subscription.statusLabel} />
          <Field
            label="Access"
            value={`${subscription.accessLabel} (${subscription.accessReason})`}
          />
          <Field
            label="Days remaining"
            value={
              subscription.daysRemaining == null
                ? "—"
                : String(subscription.daysRemaining)
            }
          />
          <Field
            label="Trial start"
            value={formatOptionalDate(subscription.trialStartAt)}
          />
          <Field
            label="Trial end"
            value={formatOptionalDate(subscription.trialEndAt)}
          />
          <Field
            label="Current period start"
            value={formatOptionalDate(subscription.currentPeriodStart)}
          />
          <Field
            label="Current period end"
            value={formatOptionalDate(subscription.currentPeriodEnd)}
          />
          <Field
            label="Cancel at period end"
            value={subscription.cancelAtPeriodEnd ? "Yes" : "No"}
          />
          <Field
            label="Cancellation"
            value={subscription.cancellationLabel}
          />
          <Field
            label="Cancelled at"
            value={formatOptionalDate(subscription.cancelledAt)}
          />
          <Field
            label="Past due since"
            value={formatOptionalDate(subscription.pastDueSince)}
          />
        </dl>
        {subscription.detail ? (
          <p className="mt-4 text-sm text-slate-600">{subscription.detail}</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Cashfree
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Provider" value={subscription.provider || "—"} />
          <Field
            label="Provider subscription ID"
            value={subscription.providerSubscriptionId || "—"}
            mono
          />
          <Field
            label="Provider plan ID"
            value={subscription.providerPlanId || "—"}
            mono
          />
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Client secrets and webhook secrets are never displayed.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Collected Revenue
        </h3>
        <p className="mt-2 text-lg font-semibold text-slate-900">
          Not available yet
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {subscription.collectedRevenueNote}
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Related Payment/Webhook Events
        </h3>
        {subscription.relatedWebhookEvents.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No related webhook events found for this provider subscription ID.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {subscription.relatedWebhookEvents.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">{event.eventType}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">
                    {event.eventId}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>{formatDateTime(event.receivedAt)}</p>
                  <p className="mt-0.5 capitalize">{event.processingStatus}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd
        className={`mt-1 text-sm text-slate-900 ${mono ? "font-mono break-all" : "font-medium"}`}
      >
        {value}
      </dd>
    </div>
  );
}
