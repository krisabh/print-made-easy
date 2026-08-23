"use client";

import { useState, useTransition } from "react";

import { updateShopSettingsAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SettingsFormProps = {
  initialValues: {
    shopName: string;
    phone: string;
    address: string;
    currency: string;
    timezone: string;
  };
};

export function SettingsForm({ initialValues }: SettingsFormProps) {
  const [values, setValues] = useState(initialValues);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const result = await updateShopSettingsAction(values);
      if (!result.success) {
        setError(result.error ?? "Unable to save settings.");
        return;
      }
      setMessage("Profile saved successfully.");
    });
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSubmit}
        className="max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">Shop Profile</h2>
          <p className="mt-1 text-sm text-slate-500">
            Basic shop information for your dashboard and customer page.
          </p>
        </div>

        {(
          [
            ["shopName", "Shop Name"],
            ["phone", "Phone"],
            ["address", "Address"],
            ["currency", "Currency"],
            ["timezone", "Timezone"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              value={values[key]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [key]: event.target.value }))
              }
              className="h-11"
              required
            />
          </div>
        ))}

        <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Document Auto-Delete</p>
          <p className="mt-1">
            Customer files stay available for preview for up to 1 hour after
            upload, then are deleted automatically. Job history remains in the
            dashboard.
          </p>
        </div>

        {message && (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <Button
          type="submit"
          disabled={isPending}
          className="h-11 bg-blue-600 text-white hover:bg-blue-700"
        >
          {isPending ? "Saving…" : "Save Profile"}
        </Button>
      </form>

      <section className="max-w-xl rounded-2xl border border-blue-100 bg-blue-50 p-5">
        <h3 className="text-sm font-semibold text-blue-900">
          Customer documents are temporary.
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-blue-800">
          Documents are automatically removed after printing or within 1 hour.
          Job metadata is retained for shop records.
        </p>
      </section>
    </div>
  );
}
