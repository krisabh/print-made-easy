"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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
import { Label } from "@/components/ui/label";
import {
  getAdminCouponEffectiveStatus,
  type AdminCouponView,
} from "@/lib/admin-coupons";

type ShopOption = { id: string; shopName: string; shopCode: string };

type AdminCouponsPanelProps = {
  coupons: AdminCouponView[];
  shops: ShopOption[];
  page: number;
  totalPages: number;
  total: number;
};

type FormState = {
  code: string;
  type: "PERCENT" | "FIXED";
  value: string;
  validFrom: string;
  validUntil: string;
  scope: "global" | "shop";
  shopId: string;
  maxRedemptions: string;
  perShopLimit: string;
  isActive: boolean;
};

const fieldClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/20";

function emptyForm(): FormState {
  return {
    code: "",
    type: "PERCENT",
    value: "",
    validFrom: "",
    validUntil: "",
    scope: "global",
    shopId: "",
    maxRedemptions: "",
    perShopLimit: "",
    isActive: true,
  };
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function discountLabel(coupon: Pick<AdminCouponView, "type" | "value">) {
  return coupon.type === "PERCENT" ? `${coupon.value}%` : `₹${coupon.value}`;
}

function effectiveStatusClass(
  status: ReturnType<typeof getAdminCouponEffectiveStatus>,
) {
  if (status === "Active") return "font-medium text-emerald-700";
  if (status === "Scheduled") return "font-medium text-blue-700";
  if (status === "Expired") return "font-medium text-amber-700";
  return "text-slate-500";
}

function CouponEffectiveStatusBadge(
  coupon: Pick<AdminCouponView, "isActive" | "validFrom" | "validUntil">,
) {
  const status = getAdminCouponEffectiveStatus(coupon);
  return <span className={effectiveStatusClass(status)}>{status}</span>;
}

function optionalLimit(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export function AdminCouponsPanel({
  coupons,
  shops,
  page,
  totalPages,
  total,
}: AdminCouponsPanelProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminCouponView | null>(null);
  const [confirm, setConfirm] = useState<AdminCouponView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          className="h-11 bg-blue-600 px-4 text-white hover:bg-blue-700"
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
        >
          Create Coupon
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Valid from</th>
              <th className="px-4 py-3">Valid until</th>
              <th className="px-4 py-3">Redeemed</th>
              <th className="px-4 py-3">Max</th>
              <th className="px-4 py-3">Per shop</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                  No coupons yet.
                </td>
              </tr>
            ) : (
              coupons.map((coupon) => (
                <tr key={coupon.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-mono font-medium text-slate-900">{coupon.code}</td>
                  <td className="px-4 py-3">{discountLabel(coupon)}</td>
                  <td className="px-4 py-3">
                    {coupon.shopId ? (
                      <span>
                        {coupon.shopName}
                        <span className="mt-0.5 block font-mono text-xs text-slate-500">
                          {coupon.shopCode}
                        </span>
                      </span>
                    ) : (
                      "Global"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatWhen(coupon.validFrom)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatWhen(coupon.validUntil)}</td>
                  <td className="px-4 py-3">
                    {coupon.redemptionCount}
                    {coupon.remainingRedemptions != null
                      ? ` · ${coupon.remainingRedemptions} left`
                      : ""}
                  </td>
                  <td className="px-4 py-3">{coupon.maxRedemptions ?? "—"}</td>
                  <td className="px-4 py-3">{coupon.perShopLimit ?? "—"}</td>
                  <td className="px-4 py-3">
                    <CouponEffectiveStatusBadge {...coupon} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-sm font-medium text-blue-700 hover:underline"
                        onClick={() => {
                          setError(null);
                          setEditing(coupon);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-sm font-medium text-slate-700 hover:underline"
                        onClick={() => {
                          setError(null);
                          setConfirm(coupon);
                        }}
                      >
                        {coupon.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>
          {total === 0
            ? "0 coupons"
            : `Showing page ${page} of ${totalPages} · ${total} total`}
        </p>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={`/admin/coupons?page=${page - 1}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-100 px-3 py-2 text-slate-300">Previous</span>
          )}
          {page < totalPages ? (
            <Link
              href={`/admin/coupons?page=${page + 1}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-100 px-3 py-2 text-slate-300">Next</span>
          )}
        </div>
      </div>

      <CouponFormDialog
        open={creating}
        title="Create coupon"
        shops={shops}
        pending={pending}
        error={error}
        onClose={() => {
          if (!pending) setCreating(false);
        }}
        onSubmit={(body) => {
          setError(null);
          startTransition(async () => {
            const response = await fetch("/api/admin/coupons", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            if (!response.ok) {
              setError(payload?.error ?? "Unable to create coupon.");
              return;
            }
            setCreating(false);
            refresh();
          });
        }}
      />

      <CouponFormDialog
        open={Boolean(editing)}
        title="Edit coupon"
        shops={shops}
        coupon={editing}
        pending={pending}
        error={error}
        onClose={() => {
          if (!pending) setEditing(null);
        }}
        onSubmit={(body) => {
          if (!editing) return;
          setError(null);
          startTransition(async () => {
            const response = await fetch(`/api/admin/coupons/${editing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            if (!response.ok) {
              setError(payload?.error ?? "Unable to update coupon.");
              return;
            }
            setEditing(null);
            refresh();
          });
        }}
      />

      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(next) => {
          if (!pending && !next) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.isActive ? "Deactivate this coupon?" : "Activate this coupon?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.isActive
                ? `${confirm.code} will no longer be available for new use. Existing redemption records stay in place.`
                : `${confirm?.code ?? "This coupon"} will be marked active again.`}
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirm?.isActive ? "destructive" : "default"}
              disabled={pending || !confirm}
              onClick={() => {
                if (!confirm) return;
                const nextActive = !confirm.isActive;
                setError(null);
                startTransition(async () => {
                  const response = await fetch(`/api/admin/coupons/${confirm.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ isActive: nextActive }),
                  });
                  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                  if (!response.ok) {
                    setError(payload?.error ?? "Unable to update coupon.");
                    return;
                  }
                  setConfirm(null);
                  refresh();
                });
              }}
            >
              {pending ? "Saving…" : confirm?.isActive ? "Deactivate" : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CouponFormDialog({
  open,
  title,
  shops,
  coupon,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  shops: ShopOption[];
  coupon?: AdminCouponView | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending && !next) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Codes are stored in uppercase. Checkout does not apply coupons yet.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CouponForm
            key={coupon?.id ?? "create"}
            shops={shops}
            coupon={coupon}
            pending={pending}
            error={error}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CouponForm({
  shops,
  coupon,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  shops: ShopOption[];
  coupon?: AdminCouponView | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    coupon
      ? {
          code: coupon.code,
          type: coupon.type,
          value: String(coupon.value),
          validFrom: toLocalInput(coupon.validFrom),
          validUntil: toLocalInput(coupon.validUntil),
          scope: coupon.shopId ? "shop" : "global",
          shopId: coupon.shopId ?? "",
          maxRedemptions: coupon.maxRedemptions == null ? "" : String(coupon.maxRedemptions),
          perShopLimit: coupon.perShopLimit == null ? "" : String(coupon.perShopLimit),
          isActive: coupon.isActive,
        }
      : emptyForm(),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setLocalError(null);
    const value = Number(form.value);
    if (!Number.isInteger(value)) {
      setLocalError("Discount value must be a whole number.");
      return;
    }
    const maxRedemptions = optionalLimit(form.maxRedemptions);
    const perShopLimit = optionalLimit(form.perShopLimit);
    if (Number.isNaN(maxRedemptions) || Number.isNaN(perShopLimit)) {
      setLocalError("Limits must be positive whole numbers, or left blank.");
      return;
    }
    const from = new Date(form.validFrom);
    const until = new Date(form.validUntil);
    if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
      setLocalError("Enter a valid from and until date.");
      return;
    }
    if (form.scope === "shop" && !form.shopId) {
      setLocalError("Select a shop for a shop-specific coupon.");
      return;
    }
    const body: Record<string, unknown> = {
      type: form.type,
      value,
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
      maxRedemptions,
      perShopLimit,
      shopId: form.scope === "global" ? null : form.shopId,
      isActive: form.isActive,
    };
    if (!coupon) body.code = form.code;
    onSubmit(body);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="coupon-code">Coupon code</Label>
        <input
          id="coupon-code"
          value={form.code}
          disabled={Boolean(coupon)}
          onChange={(event) => setForm({ ...form, code: event.target.value })}
          className={fieldClass}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="coupon-type">Discount type</Label>
          <select
            id="coupon-type"
            value={form.type}
            onChange={(event) =>
              setForm({ ...form, type: event.target.value === "FIXED" ? "FIXED" : "PERCENT" })
            }
            className={fieldClass}
          >
            <option value="PERCENT">Percentage</option>
            <option value="FIXED">Fixed amount</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="coupon-value">Discount value</Label>
          <input
            id="coupon-value"
            inputMode="numeric"
            value={form.value}
            onChange={(event) => setForm({ ...form, value: event.target.value })}
            className={fieldClass}
            required
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="coupon-from">Valid from</Label>
          <input
            id="coupon-from"
            type="datetime-local"
            value={form.validFrom}
            onChange={(event) => setForm({ ...form, validFrom: event.target.value })}
            className={fieldClass}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="coupon-until">Valid until</Label>
          <input
            id="coupon-until"
            type="datetime-local"
            value={form.validUntil}
            onChange={(event) => setForm({ ...form, validUntil: event.target.value })}
            className={fieldClass}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">Scope</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setForm({ ...form, scope: "global", shopId: "" })}
            className={[
              "h-11 rounded-xl border text-sm font-medium",
              form.scope === "global"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-700",
            ].join(" ")}
          >
            Global
          </button>
          <button
            type="button"
            onClick={() => setForm({ ...form, scope: "shop" })}
            className={[
              "h-11 rounded-xl border text-sm font-medium",
              form.scope === "shop"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-700",
            ].join(" ")}
          >
            Specific shop
          </button>
        </div>
      </div>
      {form.scope === "shop" ? (
        <div className="space-y-2">
          <Label htmlFor="coupon-shop">Shop</Label>
          <select
            id="coupon-shop"
            value={form.shopId}
            onChange={(event) => setForm({ ...form, shopId: event.target.value })}
            className={fieldClass}
            required
          >
            <option value="">Select a shop</option>
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.shopName} ({shop.shopCode})
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="coupon-max">Maximum total redemptions</Label>
          <input
            id="coupon-max"
            inputMode="numeric"
            value={form.maxRedemptions}
            placeholder="Optional"
            onChange={(event) => setForm({ ...form, maxRedemptions: event.target.value })}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="coupon-per-shop">Per-shop redemption limit</Label>
          <input
            id="coupon-per-shop"
            inputMode="numeric"
            value={form.perShopLimit}
            placeholder="Optional"
            onChange={(event) => setForm({ ...form, perShopLimit: event.target.value })}
            className={fieldClass}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
        />
        Active
      </label>
      {localError || error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          {localError || error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="bg-blue-600 text-white hover:bg-blue-700">
          {pending ? "Saving…" : coupon ? "Save changes" : "Create Coupon"}
        </Button>
      </DialogFooter>
    </form>
  );
}
