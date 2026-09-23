"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AdminSettingsView } from "@/lib/admin-settings";

type AdminSettingsFormProps = {
  initial: AdminSettingsView;
};

export function AdminSettingsForm({ initial }: AdminSettingsFormProps) {
  const [premiumAmountInr, setPremiumAmountInr] = useState(String(initial.premiumAmountInr));
  const [trialEnabled, setTrialEnabled] = useState(initial.trialEnabled);
  const [trialDays, setTrialDays] = useState(String(initial.trialDays));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          premiumAmountInr: Number(premiumAmountInr),
          trialEnabled,
          trialDays: Number(trialDays),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; settings?: AdminSettingsView }
        | null;
      if (!response.ok || !payload?.success || !payload.settings) {
        setError(payload?.error ?? "Unable to save admin settings.");
        return;
      }
      setPremiumAmountInr(String(payload.settings.premiumAmountInr));
      setTrialEnabled(payload.settings.trialEnabled);
      setTrialDays(String(payload.settings.trialDays));
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Business settings</h3>
        <p className="mt-1 text-sm text-slate-500">
          Applies to new checkouts and new shop signups. Existing payments and trials stay as they were.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="premiumAmountInr">Monthly Premium price</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-500">₹</span>
          <input
            id="premiumAmountInr"
            inputMode="numeric"
            value={premiumAmountInr}
            onChange={(event) => setPremiumAmountInr(event.target.value)}
            className="h-11 w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/20"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">Free trial</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTrialEnabled(true)}
            className={[
              "h-11 rounded-xl border text-sm font-medium",
              trialEnabled
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-700",
            ].join(" ")}
            aria-pressed={trialEnabled}
          >
            On
          </button>
          <button
            type="button"
            onClick={() => setTrialEnabled(false)}
            className={[
              "h-11 rounded-xl border text-sm font-medium",
              !trialEnabled
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-700",
            ].join(" ")}
            aria-pressed={!trialEnabled}
          >
            Off
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="trialDays">Trial duration</Label>
        <div className="flex items-center gap-2">
          <input
            id="trialDays"
            inputMode="numeric"
            value={trialDays}
            onChange={(event) => setTrialDays(event.target.value)}
            className="h-11 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/20"
            required
          />
          <span className="text-sm text-slate-500">days</span>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          Settings saved.
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        className="h-11 bg-blue-600 px-4 text-white hover:bg-blue-700"
      >
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
