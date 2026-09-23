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

type AdminShopStatusControlProps = {
  shopId: string;
  isActive: boolean;
  /** Table cells show only the action. The detail page also shows the status line. */
  layout?: "detail" | "compact";
};

export function AdminShopStatusControl({
  shopId,
  isActive,
  layout = "detail",
}: AdminShopStatusControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextActive = !isActive;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/shops/${shopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!response.ok || !payload?.success) {
        setError(payload?.error ?? "Unable to update this shop.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const actionButton = (
    <Button
      type="button"
      className={
        isActive
          ? "h-10 bg-red-600 px-4 text-white hover:bg-red-700"
          : "h-10 bg-emerald-600 px-4 text-white hover:bg-emerald-700"
      }
      onClick={() => {
        setError(null);
        setOpen(true);
      }}
    >
      {isActive ? "Deactivate Shop" : "Reactivate Shop"}
    </Button>
  );

  return (
    <div
      className={
        layout === "compact"
          ? "flex items-center"
          : "mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"
      }
    >
      {layout === "detail" ? (
        <p className="text-sm text-slate-700">
          Status:{" "}
          <span className="font-semibold text-slate-900">
            {isActive ? "Active" : "Deactivated"}
          </span>
        </p>
      ) : null}
      {actionButton}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isActive ? "Deactivate this shop?" : "Reactivate this shop?"}
            </DialogTitle>
            <DialogDescription>
              {isActive
                ? "The shopkeeper will no longer be able to log in. The Windows Agent will no longer authenticate. The shop will be unable to operate. Existing billing, print history, and other records will be preserved."
                : "Normal shop access will be restored. The existing subscription, billing history, and shop records stay as they are."}
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
              variant={isActive ? "destructive" : "default"}
              disabled={pending}
              onClick={confirm}
            >
              {pending
                ? "Saving…"
                : isActive
                  ? "Deactivate Shop"
                  : "Reactivate Shop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
