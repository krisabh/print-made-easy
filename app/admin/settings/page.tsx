import { AdminSettingsForm } from "@/components/admin/admin-settings-form";
import { getOrCreateAdminSettings } from "@/lib/admin-settings";
import { requireAdmin } from "@/lib/auth";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await getOrCreateAdminSettings();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Platform price and trial configuration.
        </p>
      </div>
      <AdminSettingsForm initial={settings} />
    </div>
  );
}
