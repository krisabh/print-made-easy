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

type PermanentShopDeletePreview = {
  allowed: boolean;
  blockCode: string | null;
  printJobCount: number;
  submittedPageCount: number;
  totalPrintPrice: string;
};

type AdminShopPermanentDeleteProps = {
  shopId: string;
  shopName: string;
  shopCode: string;
  preview: PermanentShopDeletePreview;
};

const BLOCK_COPY: Record<string, string> = {
  SHOP_ACTIVE: "Permanent deletion requires deactivation first.",
  SHOP_HAS_BILLING_PAYMENTS:
    "This shop has billing payments, so it cannot be permanently deleted.",
  SHOP_HAS_COUPON_REDEMPTION:
    "This shop has coupon redemptions, so it cannot be permanently deleted.",
  SHOP_HAS_COUPON:
    "A coupon is limited to this shop, so it cannot be permanently deleted.",
  SHOP_HAS_PAID_SUBSCRIPTION:
    "This shop has a paid subscription, so it cannot be permanently deleted.",
  SHOP_HAS_PROVIDER_IDENTITY:
    "This shop is linked to a payment provider, so it cannot be permanently deleted.",
  OWNER_IS_ADMIN:
    "The shop owner is an administrator, so this shop cannot be permanently deleted.",
  OWNER_HAS_ADMIN_AUDIT:
    "The shop owner has admin audit history, so this shop cannot be permanently deleted.",
  UNSAFE_SUBSCRIPTION:
    "This subscription is not an unbacked trial, so the shop cannot be permanently deleted.",
};

function formatCount(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatPrice(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(parsed);
}

export function AdminShopPermanentDelete({
  shopId,
  shopName,
  shopCode,
  preview,
}: AdminShopPermanentDeleteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const codeMatches = typed === shopCode;
  const blockMessage = preview.blockCode
    ? (BLOCK_COPY[preview.blockCode] ??
      "This shop cannot be permanently deleted.")
    : null;

  function confirm() {
    if (!preview.allowed || !codeMatches) return;
    setError(null);
    startTransition(async () => {
      const response = await fetch(
        `/api/admin/shops/${shopId}/permanent-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmShopCode: typed }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { deleted?: boolean; error?: string }
        | null;
      if (!response.ok || !payload?.deleted) {
        const code = payload?.error ?? "";
        setError(BLOCK_COPY[code] ?? "Unable to delete this shop.");
        return;
      }
      setTyped("");
      setOpen(false);
      setDone(true);
      router.push("/admin/shops?deleted=1");
    });
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
      <h3 className="text-xs font-semibold tracking-wide text-red-700 uppercase">
        Delete test shop permanently
      </h3>
      <p className="mt-3 text-sm text-slate-700">
        This removes a deactivated test shop, its shopkeeper login, and its
        test print data. Billing history, coupons, and platform settings are
        not removed.
      </p>
      {blockMessage ? (
        <p className="mt-3 text-sm text-red-700">{blockMessage}</p>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          {formatCount(preview.printJobCount)} print jobs,{" "}
          {formatCount(preview.submittedPageCount)} submitted pages,{" "}
          {formatPrice(preview.totalPrintPrice)} in print-job price.
        </p>
      )}
      {done ? (
        <p className="mt-3 text-sm text-emerald-700">
          This test shop was permanently deleted.
        </p>
      ) : null}
      {error && !open ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      <Button
        type="button"
        className="mt-4 h-10 bg-red-700 px-4 text-white hover:bg-red-800"
        disabled={!preview.allowed || pending || done}
        onClick={() => {
          setError(null);
          setTyped("");
          setOpen(true);
        }}
      >
        Delete test shop permanently
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) setTyped("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete test shop permanently</DialogTitle>
            <DialogDescription>
              This cannot be undone. The shopkeeper account and test print
              data will be removed.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-500">Shop name</dt>
              <dd className="mt-1 font-medium text-slate-900">{shopName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Shop code</dt>
              <dd className="mt-1 font-mono font-medium text-slate-900">
                {shopCode}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Print jobs</dt>
              <dd className="mt-1 font-medium text-slate-900">
                {formatCount(preview.printJobCount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">
                Submitted pages
              </dt>
              <dd className="mt-1 font-medium text-slate-900">
                {formatCount(preview.submittedPageCount)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-slate-500">
                Total print-job price
              </dt>
              <dd className="mt-1 font-medium text-slate-900">
                {formatPrice(preview.totalPrintPrice)}
              </dd>
            </div>
          </dl>
          <p className="text-sm font-medium text-red-700">
            Deletion is permanent and cannot be undone.
          </p>
          <label className="text-sm text-slate-700">
            Type {shopCode} to permanently delete this test shop.
            <input
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-red-700 text-white hover:bg-red-800"
              disabled={pending || !codeMatches}
              onClick={confirm}
            >
              {pending ? "Deleting…" : "Permanently Delete Shop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
