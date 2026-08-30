"use client";

import { useState, useTransition } from "react";

import { updatePricingAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PricingRates } from "@/lib/pricing-service";

type PricingFormProps = {
  initialPricing: PricingRates;
  editingLocked?: boolean;
};

type PricingDrafts = Record<keyof PricingRates, string>;

const PRICE_FIELDS: { key: keyof PricingRates; label: string }[] = [
  { key: "bwSingle", label: "B&W Single" },
  { key: "bwDouble", label: "B&W Double" },
  { key: "colorSingle", label: "Color Single" },
  { key: "colorDouble", label: "Color Double" },
  { key: "minimumCharge", label: "Minimum Charge" },
];

function toDrafts(pricing: PricingRates): PricingDrafts {
  return {
    bwSingle: String(pricing.bwSingle),
    bwDouble: String(pricing.bwDouble),
    colorSingle: String(pricing.colorSingle),
    colorDouble: String(pricing.colorDouble),
    minimumCharge: String(pricing.minimumCharge),
  };
}

function isAllowedPriceInput(value: string) {
  return value === "" || /^\d*\.?\d*$/.test(value);
}

export function PricingForm({
  initialPricing,
  editingLocked = false,
}: PricingFormProps) {
  const [drafts, setDrafts] = useState<PricingDrafts>(() =>
    toDrafts(initialPricing),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(key: keyof PricingRates, value: string) {
    if (!isAllowedPriceInput(value)) return;
    setDrafts((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (editingLocked) {
      setError("Subscription required to update print pricing.");
      return;
    }
    setMessage(null);
    setError(null);

    const parsed: PricingRates = {
      bwSingle: Number(drafts.bwSingle),
      bwDouble: Number(drafts.bwDouble),
      colorSingle: Number(drafts.colorSingle),
      colorDouble: Number(drafts.colorDouble),
      minimumCharge: Number(drafts.minimumCharge),
    };

    for (const field of PRICE_FIELDS) {
      const raw = drafts[field.key].trim();
      if (raw === "" || !Number.isFinite(parsed[field.key])) {
        setError(`Enter a valid amount for ${field.label}.`);
        return;
      }
    }

    startTransition(async () => {
      const result = await updatePricingAction(parsed);
      if (!result.success) {
        setError(result.error ?? "Unable to update pricing.");
        return;
      }
      setDrafts(toDrafts(parsed));
      setMessage("Pricing updated successfully.");
    });
  }

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
        {PRICE_FIELDS.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={field.key}>{field.label}</Label>
            <Input
              id={field.key}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={drafts[field.key]}
              onChange={(event) => updateField(field.key, event.target.value)}
              className="h-11"
              required
              disabled={editingLocked}
              readOnly={editingLocked}
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
        disabled={isPending || editingLocked}
        className="h-11 bg-blue-600 text-white hover:bg-blue-700"
      >
        {editingLocked
          ? "Subscribe to edit pricing"
          : isPending
            ? "Saving…"
            : "Save Pricing"}
      </Button>
    </form>
  );
}
