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

const PRICE_FIELDS: {
  key: keyof PricingRates;
  label: string;
  hint?: string;
}[] = [
  {
    key: "bwSingle",
    label: "Black & White (₹ per page)",
    hint: "Used for new Black & White print orders.",
  },
  { key: "bwDouble", label: "B&W Double (₹ per page)" },
  { key: "colorSingle", label: "Color Single (₹ per page)" },
  { key: "colorDouble", label: "Color Double (₹ per page)" },
  { key: "minimumCharge", label: "Minimum Charge (₹)" },
];

function toDrafts(pricing: PricingRates): PricingDrafts {
  return {
    bwSingle: Number(pricing.bwSingle).toFixed(2),
    bwDouble: Number(pricing.bwDouble).toFixed(2),
    colorSingle: Number(pricing.colorSingle).toFixed(2),
    colorDouble: Number(pricing.colorDouble).toFixed(2),
    minimumCharge: Number(pricing.minimumCharge).toFixed(2),
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
          This price is used for new Black &amp; White print orders. Changing it
          does not change past orders.
        </p>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
        <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">
          Black &amp; White
        </p>
        <p className="mt-1 text-sm text-slate-700">
          Default for new shops is{" "}
          <span className="font-semibold text-slate-900">₹5.00 per page</span>.
          You can change it anytime.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PRICE_FIELDS.map((field) => (
          <div
            key={field.key}
            className={`space-y-2 ${
              field.key === "bwSingle" ? "sm:col-span-2" : ""
            }`}
          >
            <Label htmlFor={field.key}>{field.label}</Label>
            <div className="relative">
              <span
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400"
                aria-hidden="true"
              >
                ₹
              </span>
              <Input
                id={field.key}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={drafts[field.key]}
                onChange={(event) => updateField(field.key, event.target.value)}
                className="h-11 pl-7"
                required
                disabled={editingLocked}
                readOnly={editingLocked}
              />
            </div>
            {field.hint ? (
              <p className="text-xs text-slate-500">{field.hint}</p>
            ) : null}
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
