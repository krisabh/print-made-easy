import { requireAdmin } from "@/lib/auth";

export default async function AdminAnalyticsPage() {
  await requireAdmin();

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900">Analytics</h2>
      <p className="text-sm text-slate-500">
        Analytics will be available in a later phase.
      </p>
    </div>
  );
}
