import { PrintStatus } from "@prisma/client";

const STATUS_STYLES: Record<PrintStatus, string> = {
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200/80",
  PRINTING: "bg-blue-50 text-blue-800 ring-blue-200/80",
  READY_FOR_PICKUP: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
  DELIVERED: "bg-slate-100 text-slate-700 ring-slate-200/80",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200/80",
};

const STATUS_DOT: Record<PrintStatus, string> = {
  PENDING: "bg-amber-500",
  PRINTING: "bg-blue-500",
  READY_FOR_PICKUP: "bg-emerald-500",
  DELIVERED: "bg-slate-400",
  CANCELLED: "bg-red-500",
};

const STATUS_LABELS: Record<PrintStatus, string> = {
  PENDING: "Pending",
  PRINTING: "Printing",
  READY_FOR_PICKUP: "Ready",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: PrintStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
        aria-hidden="true"
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
