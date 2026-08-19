import {
  formatAdminMoneyInr,
  type AdminSubscriptionSummary,
  type AdminWebhookEventSafe,
} from "@/lib/admin-subscriptions";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
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
  summary: AdminSubscriptionSummary;
  recentWebhookEvents: AdminWebhookEventSafe[];
};

export function AdminSubscriptionsSummary({
  summary,
  recentWebhookEvents,
}: Props) {
  const cards = [
    { label: "Total Subscriptions", value: formatNumber(summary.totalSubscriptions) },
    { label: "Active Premium", value: formatNumber(summary.activePremium) },
    { label: "Trialing", value: formatNumber(summary.trialing) },
    { label: "Past Due", value: formatNumber(summary.pastDue) },
    { label: "Expired", value: formatNumber(summary.expired) },
    {
      label: "Estimated MRR",
      value: formatAdminMoneyInr(summary.estimatedMrrInr),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm"
          >
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {card.label}
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Estimated MRR
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Active Premium: {formatNumber(summary.activePremium)} · Plan price:{" "}
            {formatAdminMoneyInr(summary.planPriceInr)}/month
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {formatAdminMoneyInr(summary.estimatedMrrInr)}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Does not include trials, past-due, expired, or cancelled subscriptions.
            Sandbox/test payments are not counted as collected revenue.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Collected Revenue
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            Not available yet
          </p>
          <p className="mt-3 text-xs text-slate-500">
            {summary.collectedRevenueNote}
          </p>
          {summary.trialConversion.available ? (
            <p className="mt-4 text-sm text-slate-600">
              Approx. trial conversion:{" "}
              {summary.trialConversion.ratePercent == null
                ? "—"
                : `${summary.trialConversion.ratePercent}%`}{" "}
              ({formatNumber(summary.trialConversion.convertedCount ?? 0)} /{" "}
              {formatNumber(summary.trialConversion.endedTrialCount ?? 0)} ended
              trials)
            </p>
          ) : (
            <p className="mt-4 text-sm text-slate-600">
              Historical conversion rate unavailable with current schema.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {summary.trialConversion.note}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Recent Payment/Webhook Events
        </p>
        {recentWebhookEvents.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No webhook events recorded.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {recentWebhookEvents.map((event) => (
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
        <p className="mt-2 text-xs text-slate-500">
          Event metadata only — raw payloads and secrets are not shown.
        </p>
      </div>
    </div>
  );
}
