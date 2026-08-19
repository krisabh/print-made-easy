import { AdminSubscriptionsFilters } from "@/components/admin/admin-subscriptions-filters";
import { AdminSubscriptionsSummary } from "@/components/admin/admin-subscriptions-summary";
import { AdminSubscriptionsTable } from "@/components/admin/admin-subscriptions-table";
import { listAdminSubscriptions } from "@/lib/admin-subscriptions";
import { requireAdmin } from "@/lib/auth";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    q?: string;
    page?: string;
    status?: string;
    plan?: string;
  }>;
};

export default async function AdminSubscriptionsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const search = (params.search || params.q || "").trim();
  const status = (params.status || "").trim().toUpperCase();
  const plan = (params.plan || "").trim().toUpperCase();
  const page = Number(params.page || "1");

  const result = await listAdminSubscriptions({
    search,
    status,
    plan,
    page,
    pageSize: 20,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Subscription Management
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Read-only view of trials, Premium plans, and estimated MRR.
        </p>
      </div>

      <AdminSubscriptionsSummary
        summary={result.summary}
        recentWebhookEvents={result.recentWebhookEvents}
      />

      <AdminSubscriptionsFilters
        initialSearch={search}
        initialStatus={status}
        initialPlan={plan}
      />

      <AdminSubscriptionsTable
        result={result}
        search={search}
        status={status}
        plan={plan}
      />
    </div>
  );
}
