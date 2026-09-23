"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
const MAX_TRIAL_EXTENSION_DAYS = 365;

type AdminShopTrialControlProps = {
  shopId: string;
  plan: string | null;
  status: string | null;
  trialEndAt: string | null;
  hasAccess: boolean;
  label: string;
};

function trialStatusText(input: {
  plan: string | null;
  status: string | null;
  hasAccess: boolean;
  label: string;
}) {
  if (!input.status) return "No subscription";
  if (input.status === "TRIALING" && input.hasAccess) return "Active trial";
  if (input.status === "TRIALING") return "Expired trial";
  if (input.status === "EXPIRED" && input.plan === "TRIAL") return "Expired trial";
  return input.label;
}

function canExtend(plan: string | null, status: string | null) {
  if (status === "TRIALING") return true;
  return status === "EXPIRED" && plan === "TRIAL";
}

export function AdminShopTrialControl({
  shopId,
  plan,
  status,
  trialEndAt,
  hasAccess,
  label,
}: AdminShopTrialControlProps) {
  const router = useRouter();
  const [days, setDays] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const extendable = canExtend(plan, status);
  const parsedDays = Number(days);
  const daysValid =
    Number.isInteger(parsedDays) &&
    parsedDays >= 1 &&
    parsedDays <= MAX_TRIAL_EXTENSION_DAYS;

  function askConfirm() {
    setSuccess(null);
    if (!daysValid) {
      setError(`Enter a whole number from 1 to ${MAX_TRIAL_EXTENSION_DAYS}.`);
      return;
    }
    setError(null);
    setOpen(true);
  }

  function confirm() {
    if (!daysValid) return;
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/shops/${shopId}/trial`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: parsedDays }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; days?: number }
        | null;
      if (!response.ok || !payload?.success) {
        setError(payload?.error ?? "Unable to extend this trial.");
        return;
      }
      setOpen(false);
      setDays("");
      setSuccess(`Trial extended by ${payload.days ?? parsedDays} days.`);
      router.refresh();
    });
  }

  const endLabel = trialEndAt
    ? new Date(trialEndAt).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not set";

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="text-sm font-semibold text-slate-900">Extend Trial</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">Trial status</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {trialStatusText({ plan, status, hasAccess, label })}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">Trial end</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{endLabel}</dd>
        </div>
      </dl>
      {extendable ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            Number of days
            <input
              type="number"
              min={1}
              max={MAX_TRIAL_EXTENSION_DAYS}
              step={1}
              inputMode="numeric"
              value={days}
              onChange={(event) => {
                setDays(event.target.value);
                setError(null);
                setSuccess(null);
              }}
              className="mt-1 block h-10 w-28 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
          </label>
          <Button
            type="button"
            className="h-10 bg-blue-600 px-4 text-white hover:bg-blue-700"
            onClick={askConfirm}
          >
            Extend
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          {status
            ? "Trial extension is available for trial subscriptions only. This shop's paid subscription was left unchanged."
            : "This shop has no subscription, so a trial cannot be extended."}
        </p>
      )}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend this trial?</DialogTitle>
            <DialogDescription>
              Add {daysValid ? parsedDays : ""} days to this shop only. The
              global trial setting, other shops, and payment history stay as
              they are.
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-blue-600 text-white hover:bg-blue-700"
              disabled={pending || !daysValid}
              onClick={confirm}
            >
              {pending ? "Saving…" : "Extend Trial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
