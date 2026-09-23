import Link from "next/link";

import { listAdminAuditLogs } from "@/lib/admin-audit";
import { requireAdmin } from "@/lib/auth";

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function formatJson(value: unknown) {
  if (value == null) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

export default async function AdminAuditLogPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const page = Number(params.page || "1");
  const result = await listAdminAuditLogs({ page });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Audit log</h2>
        <p className="mt-1 text-sm text-slate-500">
          Recent administrative changes.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Before</th>
              <th className="px-4 py-3">After</th>
            </tr>
          </thead>
          <tbody>
            {result.entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No audit entries yet.
                </td>
              </tr>
            ) : (
              result.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatWhen(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{entry.adminName}</p>
                    <p className="text-xs text-slate-500">{entry.adminEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{entry.action}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {entry.targetType}
                    {entry.targetId ? ` · ${entry.targetId}` : ""}
                  </td>
                  <td className="max-w-xs px-4 py-3 break-all text-xs text-slate-600">
                    {formatJson(entry.before)}
                  </td>
                  <td className="max-w-xs px-4 py-3 break-all text-xs text-slate-600">
                    {formatJson(entry.after)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <p>
          Page {result.page} of {result.totalPages}
        </p>
        <div className="flex gap-2">
          {result.page > 1 ? (
            <Link
              href={`/admin/audit-log?page=${result.page - 1}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700"
            >
              Previous
            </Link>
          ) : null}
          {result.page < result.totalPages ? (
            <Link
              href={`/admin/audit-log?page=${result.page + 1}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700"
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
