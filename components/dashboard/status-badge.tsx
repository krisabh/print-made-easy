import { PrintStatus } from "@prisma/client";

const STATUS_STYLES: Record<PrintStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
  PRINTING: "bg-blue-50 text-blue-700 ring-blue-200",
  READY_FOR_PICKUP: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  DELIVERED: "bg-slate-100 text-slate-600 ring-slate-200",
  CANCELLED: "bg-red-50 text-red-600 ring-red-200",
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
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
