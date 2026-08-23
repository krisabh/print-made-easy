import { ChangePasswordForm } from "@/components/dashboard/change-password-form";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { serializeShopForDashboard } from "@/lib/dashboard-service";
import { requireProductAccess } from "@/lib/require-product-access";

export default async function ProfilePage() {
  const { session } = await requireProductAccess();
  const { shop, user } = session;
  const serialized = serializeShopForDashboard(shop);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Profile</h2>
        <p className="mt-1 text-sm text-slate-500">
          Shop account details and password security.
        </p>
      </div>

      <div className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Account</h3>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as the shop owner for this PrintMadeEasy shop.
        </p>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Name
            </dt>
            <dd className="mt-1 font-medium text-slate-900">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Email
            </dt>
            <dd className="mt-1 break-all font-medium text-slate-900">
              {user.email}
            </dd>
          </div>
        </dl>
      </div>

      <SettingsForm
        initialValues={{
          shopName: serialized.shopName,
          phone: serialized.phone,
          address: serialized.address,
          currency: serialized.settings.currency,
          timezone: serialized.settings.timezone,
        }}
      />

      <ChangePasswordForm />
    </div>
  );
}
