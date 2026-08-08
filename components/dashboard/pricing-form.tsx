"use client";

import { useState, useTransition } from "react";

import { updatePricingAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PricingRates } from "@/lib/pricing-service";

type PricingFormProps = {
  initialPricing: PricingRates;
};

export function PricingForm({ initialPricing }: PricingFormProps) {
  const [values, setValues] = useState(initialPricing);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(key: keyof PricingRates, value: string) {
    const next = Number(value);
    setValues((current) => ({
      ...current,
      [key]: Number.isFinite(next) ? next : 0,
    }));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const result = await updatePricingAction(values);
      if (!result.success) {
        setError(result.error ?? "Unable to update pricing.");
        return;
      }
      setMessage("Pricing updated successfully.");
    });
  }

  const fields: { key: keyof PricingRates; label: string }[] = [
    { key: "bwSingle", label: "B&W Single" },
    { key: "bwDouble", label: "B&W Double" },
    { key: "colorSingle", label: "Color Single" },
    { key: "colorDouble", label: "Color Double" },
    { key: "minimumCharge", label: "Minimum Charge" },
  ];

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">Print Pricing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Changes apply immediately to new customer uploads.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={field.key}>{field.label}</Label>
            <Input
              id={field.key}
              type="number"
              min={0}
              step="0.01"
              value={values[field.key]}
              onChange={(event) => updateField(field.key, event.target.value)}
              className="h-11"
              required
            />
          </div>
        ))}
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
        {isPending ? "Saving…" : "Save Pricing"}
      </Button>
    </form>
  );
}
