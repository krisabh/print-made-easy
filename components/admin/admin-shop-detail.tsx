import {
  formatAdminCreatedDate,
  formatAdminLastSeen,
  type AdminShopDetail,
} from "@/lib/admin-shops";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatOptionalDate(iso: string | null) {
  if (!iso) return "—";
  return formatAdminCreatedDate(iso);
}

type AdminShopDetailViewProps = {
  shop: AdminShopDetail;
};

export function AdminShopDetailView({ shop }: AdminShopDetailViewProps) {
  const sub = shop.subscriptionRaw;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Shop information
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Shop name" value={shop.shopName} />
          <Field label="Shop code" value={shop.shopCode} mono />
          <Field label="Owner name" value={shop.owner.name || "—"} />
          <Field label="Owner email" value={shop.owner.email || "—"} />
          <Field
            label="Created"
            value={formatAdminCreatedDate(shop.createdAt)}
          />
          <Field
            label="Shop status"
            value={shop.isActive ? "Active" : "Inactive"}
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Subscription
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Display" value={sub.label} />
          <Field label="Plan" value={sub.plan || "—"} />
          <Field label="Status" value={sub.status || "—"} />
          <Field
            label="Access"
            value={sub.hasAccess ? `Allowed (${sub.accessReason})` : `Denied (${sub.accessReason})`}
          />
          <Field label="Trial start" value={formatOptionalDate(sub.trialStartAt)} />
          <Field label="Trial end" value={formatOptionalDate(sub.trialEndAt)} />
          <Field
            label="Current period start"
            value={formatOptionalDate(sub.currentPeriodStart)}
          />
          <Field
            label="Current period end"
            value={formatOptionalDate(sub.currentPeriodEnd)}
          />
          <Field
            label="Cancel at period end"
            value={sub.cancelAtPeriodEnd ? "Yes" : "No"}
          />
          <Field
            label="Cancelled at"
            value={formatOptionalDate(sub.cancelledAt)}
          />
          <Field
            label="Past due since"
            value={formatOptionalDate(sub.pastDueSince)}
          />
        </dl>
        {shop.subscription?.detail ? (
          <p className="mt-4 text-sm text-slate-600">{shop.subscription.detail}</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Printing
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Total jobs"
            value={formatNumber(shop.printing.totalJobs)}
          />
          <Field
            label="Total pages"
            value={formatNumber(shop.printing.totalPages)}
          />
          <Field
            label="B&W jobs"
            value={formatNumber(shop.printing.bwJobs)}
          />
          <Field
            label="B&W pages"
            value={formatNumber(shop.printing.bwPages)}
          />
          <Field
            label="Color jobs"
            value={formatNumber(shop.printing.colorJobs)}
          />
          <Field
            label="Color pages"
            value={formatNumber(shop.printing.colorPages)}
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Printers ({formatNumber(shop.printerCount)})
        </h3>
        {shop.printers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No printers registered.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {shop.printers.map((printer) => (
              <li
                key={printer.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {printer.printerName}
                    {printer.isDefault ? (
                      <span className="ml-2 text-xs font-semibold text-blue-600">
                        Default
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[printer.printerModel, printer.printerType]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-slate-800">{printer.status}</p>
                  {printer.lastSeen ? (
                    <p className="text-xs text-slate-500">
                      {formatAdminLastSeen(printer.lastSeen)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Agent
        </h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Agent ID" value={shop.agent.agentId || "—"} mono />
          <Field label="Status" value={shop.agent.status} />
          <Field
            label="Last seen"
            value={formatAdminLastSeen(shop.agent.lastSeen) || "—"}
          />
        </dl>
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
        className={`mt-1 text-sm text-slate-900 ${mono ? "font-mono" : "font-medium"}`}
      >
        {value}
      </dd>
    </div>
  );
}
