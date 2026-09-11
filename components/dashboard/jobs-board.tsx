"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { PrintStatus } from "@prisma/client";
import {
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  IndianRupee,
  Loader2,
  Printer,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import type { DateFilter, StatusFilter } from "@/types";

function canPreviewInBrowser(extension: string) {
  const ext = extension.toLowerCase();
  return ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg";
}

type JobFile = {
  id: string;
  originalFileName: string;
  fileExtension: string;
  fileSize: number;
  totalPages: number;
  printedAt?: string | null;
  fileDeletedAt?: string | null;
};

type JobItem = {
  id: string;
  jobNumber: string;
  createdAt: string;
  totalPages: number;
  copies: number;
  printMode: "BW" | "COLOR";
  printType: "SINGLE" | "DOUBLE";
  totalPrice: number;
  status: PrintStatus;
  printAttempts?: number;
  lastError?: string | null;
  files: JobFile[];
};

type Summary = {
  todaysJobs: number;
  pendingJobs: number;
  printingJobs: number;
  readyJobs: number;
  todaysRevenue: number;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatCreatedParts(iso: string) {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
  return { day, time };
}

function formatTime(iso: string) {
  const { day, time } = formatCreatedParts(iso);
  return `${day} · ${time}`;
}

function primaryFileName(job: JobItem) {
  return job.files[0]?.originalFileName ?? null;
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "PRINTING", label: "Printing" },
  { value: "READY_FOR_PICKUP", label: "Ready" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
];

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 Days" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

const DATE_PERIOD_LABEL: Record<DateFilter, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  month: "This month",
  all: "All time",
};

type JobsBoardProps = {
  initialJobs: JobItem[];
  initialSummary: Summary;
  showSummary?: boolean;
  printingLocked?: boolean;
};

export function JobsBoard({
  initialJobs,
  initialSummary,
  showSummary = true,
  printingLocked = false,
}: JobsBoardProps) {
  const [jobs, setJobs] = useState(initialJobs);
  const [periodJobs, setPeriodJobs] = useState(initialJobs);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [date, setDate] = useState<DateFilter>("today");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<JobItem | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  // initialSummary remains part of the public props contract for dashboard pages.
  void initialSummary;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("date", date);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [status, date, search]);

  const periodQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", "ALL");
    params.set("date", date);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [date, search]);

  const refresh = useCallback(() => {
    startRefresh(async () => {
      try {
        const fetches: Promise<Response>[] = [
          fetch(`/api/dashboard/jobs?${query}`, { cache: "no-store" }),
        ];
        if (status !== "ALL") {
          fetches.push(
            fetch(`/api/dashboard/jobs?${periodQuery}`, { cache: "no-store" }),
          );
        }

        const [listRes, periodRes] = await Promise.all(fetches);
        const data = await listRes.json();
        if (!listRes.ok) {
          setError(data.error ?? "Unable to refresh jobs.");
          return;
        }

        setJobs(data.jobs);
        setError(null);

        if (status === "ALL") {
          setPeriodJobs(data.jobs);
        } else if (periodRes) {
          const periodData = await periodRes.json();
          if (periodRes.ok) {
            setPeriodJobs(periodData.jobs);
          }
        }

        if (selected) {
          const updated = data.jobs.find((job: JobItem) => job.id === selected.id);
          setSelected(updated ?? null);
        }
      } catch {
        setError("Unable to refresh jobs.");
      }
    });
  }, [query, periodQuery, selected, status]);

  async function handleDeleteJob(job: JobItem) {
    if (printingLocked) {
      setError("Subscription required to manage print jobs.");
      return;
    }
    const isActive =
      job.status === PrintStatus.PENDING || job.status === PrintStatus.PRINTING;
    const confirmed = window.confirm(
      isActive
        ? `Delete job ${job.jobNumber}?\n\nThis removes the job from the dashboard and stops Agent processing. If the printer already started, that page may still finish.`
        : `Delete job ${job.jobNumber}?\n\nThis permanently removes the job from the dashboard.`,
    );
    if (!confirmed) return;

    setDeletingId(job.id);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/jobs/${job.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to delete job.");
        return;
      }
      if (selected?.id === job.id) {
        setSelected(null);
        setPreviewFileId(null);
      }
      setJobs((current) => current.filter((item) => item.id !== job.id));
      setPeriodJobs((current) => current.filter((item) => item.id !== job.id));
      refresh();
    } catch {
      setError("Unable to delete job.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [status, date, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpis = useMemo(() => {
    const source = periodJobs;
    const pending = source.filter((j) => j.status === PrintStatus.PENDING).length;
    const printing = source.filter(
      (j) => j.status === PrintStatus.PRINTING,
    ).length;
    const completed = source.filter(
      (j) => j.status === PrintStatus.DELIVERED,
    ).length;
    const revenue = source
      .filter((j) => j.status !== PrintStatus.CANCELLED)
      .reduce((sum, j) => sum + j.totalPrice, 0);
    return {
      total: source.length,
      pending,
      printing,
      completed,
      revenue,
    };
  }, [periodJobs]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      ALL: periodJobs.length,
      PENDING: 0,
      PRINTING: 0,
      READY_FOR_PICKUP: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };
    for (const job of periodJobs) {
      counts[job.status] += 1;
    }
    return counts;
  }, [periodJobs]);

  const filtersActive =
    status !== "ALL" || date !== "today" || search.trim().length > 0;

  const isTrulyEmpty =
    periodJobs.length === 0 &&
    status === "ALL" &&
    date === "all" &&
    !search.trim();

  function clearFilters() {
    setStatus("ALL");
    setDate("today");
    setSearch("");
  }

  function openJob(job: JobItem) {
    setSelected(job);
    setPreviewFileId(null);
  }

  return (
    <div className="space-y-5">
      {showSummary ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Total jobs"
            value={String(kpis.total)}
            hint={DATE_PERIOD_LABEL[date]}
            icon={ClipboardList}
          />
          <KpiCard
            label="Pending"
            value={String(kpis.pending)}
            hint="Waiting to print"
            icon={Loader2}
            tone="amber"
          />
          <KpiCard
            label="Printing"
            value={String(kpis.printing)}
            hint="In progress"
            icon={Printer}
            tone="blue"
          />
          <KpiCard
            label="Completed"
            value={String(kpis.completed)}
            hint="Delivered"
            icon={CheckCircle2}
            tone="emerald"
          />
          <KpiCard
            label="Revenue"
            value={formatCurrency(kpis.revenue)}
            hint={DATE_PERIOD_LABEL[date]}
            icon={IndianRupee}
          />
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                Print Jobs
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Track customer print jobs, status and print activity.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500 ring-1 ring-slate-200">
              <span
                className={`size-1.5 rounded-full ${
                  isRefreshing ? "bg-amber-400" : "bg-emerald-500"
                }`}
                aria-hidden="true"
              />
              <span className="font-semibold text-slate-700">Live updates</span>
              <span className="text-slate-400">·</span>
              <span>
                {isRefreshing ? "Updating…" : "Auto-refreshes every 5 seconds"}
              </span>
            </div>
          </div>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
            <input
              id="dashboard-job-search"
              value={search}
              onChange={(event) => setSearch(event.target.value.toUpperCase())}
              placeholder="Search job number..."
              aria-label="Search by job number"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-10 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/20"
            />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Filter by status
              </p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {STATUS_FILTERS.map((item) => {
                  const active = status === item.value;
                  const count = statusCounts[item.value];
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setStatus(item.value)}
                      aria-pressed={active}
                      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                        active
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                      <span
                        className={`text-xs ${
                          active ? "text-blue-100" : "text-slate-400"
                        }`}
                      >
                        ({count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Date range
              </p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {DATE_FILTERS.map((item) => {
                  const active = date === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setDate(item.value)}
                      aria-pressed={active}
                      className={`inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-medium transition-colors ${
                        active
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <p className="mx-4 mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 sm:mx-5">
            {error}
          </p>
        )}

        {/* Desktop / tablet table */}
        <div className="hidden md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  {[
                    "Job",
                    "Created",
                    "Pages",
                    "Copies",
                    "Mode",
                    "Type",
                    "Price",
                    "Status",
                    "Action",
                  ].map((label) => (
                    <th
                      key={label}
                      className="px-4 py-3 text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-2">
                      <EmptyState
                        isTrulyEmpty={isTrulyEmpty}
                        filtersActive={filtersActive}
                        periodLabel={DATE_PERIOD_LABEL[date]}
                        onClear={clearFilters}
                      />
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => {
                    const created = formatCreatedParts(job.createdAt);
                    const fileName = primaryFileName(job);
                    return (
                      <tr
                        key={job.id}
                        className="border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/80"
                      >
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-slate-900">
                            #{job.jobNumber}
                          </p>
                          {fileName ? (
                            <p className="mt-0.5 max-w-[12rem] truncate text-xs text-slate-500">
                              {fileName}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">
                          <p className="text-sm text-slate-800">{created.day}</p>
                          <p className="text-xs text-slate-500">{created.time}</p>
                        </td>
                        <td className="px-4 py-3.5 text-slate-700">
                          {job.totalPages}
                        </td>
                        <td className="px-4 py-3.5 text-slate-700">
                          {job.copies}
                        </td>
                        <td className="px-4 py-3.5">
                          <ModeBadge mode={job.printMode} />
                        </td>
                        <td className="px-4 py-3.5 text-slate-700">
                          {job.printType === "SINGLE" ? "Single" : "Double"}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-slate-900">
                          {formatCurrency(job.totalPrice)}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="space-y-1">
                            <StatusBadge status={job.status} />
                            {job.lastError ? (
                              <p className="max-w-[14rem] text-xs text-red-600">
                                {job.lastError}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openJob(job)}
                            >
                              <Eye className="size-3.5" />
                              View
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              disabled={deletingId === job.id || printingLocked}
                              aria-label={`Delete job ${job.jobNumber}`}
                              title={
                                printingLocked
                                  ? "Subscribe to manage jobs"
                                  : "Delete job"
                              }
                              onClick={() => void handleDeleteJob(job)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden">
          {jobs.length === 0 ? (
            <EmptyState
              isTrulyEmpty={isTrulyEmpty}
              filtersActive={filtersActive}
              periodLabel={DATE_PERIOD_LABEL[date]}
              onClear={clearFilters}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobs.map((job) => {
                const created = formatCreatedParts(job.createdAt);
                const fileName = primaryFileName(job);
                return (
                  <li key={job.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          #{job.jobNumber}
                        </p>
                        {fileName ? (
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {fileName}
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusBadge status={job.status} />
                        <p className="mt-1.5 text-sm font-semibold text-slate-900">
                          {formatCurrency(job.totalPrice)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {created.day} · {created.time}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                      <span>Pages: {job.totalPages}</span>
                      <span>Copies: {job.copies}</span>
                      <span>
                        Mode: {job.printMode === "BW" ? "B&W" : "Color"}
                      </span>
                      <span>
                        Type:{" "}
                        {job.printType === "SINGLE" ? "Single" : "Double"}
                      </span>
                    </div>
                    {job.lastError ? (
                      <p className="mt-2 text-xs text-red-600">{job.lastError}</p>
                    ) : null}
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openJob(job)}
                      >
                        <Eye className="size-3.5" />
                        View
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={deletingId === job.id || printingLocked}
                        aria-label={`Delete job ${job.jobNumber}`}
                        title={
                          printingLocked
                            ? "Subscribe to manage jobs"
                            : "Delete job"
                        }
                        onClick={() => void handleDeleteJob(job)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close details"
            onClick={() => {
              setSelected(null);
              setPreviewFileId(null);
            }}
          />
          <aside className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Job Details
                </p>
                <h3 className="text-lg font-semibold text-slate-900">
                  #{selected.jobNumber}
                </h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSelected(null);
                  setPreviewFileId(null);
                }}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={deletingId === selected.id || printingLocked}
                  onClick={() => void handleDeleteJob(selected)}
                >
                  <Trash2 className="size-3.5" />
                  {printingLocked
                    ? "Subscribe to manage"
                    : deletingId === selected.id
                      ? "Deleting…"
                      : "Delete Job"}
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Created</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {formatTime(selected.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={selected.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Pages</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {selected.totalPages}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Copies</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {selected.copies}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Print Mode</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {selected.printMode === "BW" ? "Black & White" : "Color"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Print Type</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {selected.printType === "SINGLE"
                      ? "Single Side"
                      : "Double Side"}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-slate-500">Total Price</dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">
                    {formatCurrency(selected.totalPrice)}
                  </dd>
                </div>
              </dl>

              {selected.lastError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p className="font-medium">Print error</p>
                  <p className="mt-1">{selected.lastError}</p>
                  {typeof selected.printAttempts === "number" && (
                    <p className="mt-1 text-xs text-red-600">
                      Attempts: {selected.printAttempts}
                    </p>
                  )}
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-slate-900">Files</h4>
                <ul className="mt-2 space-y-2">
                  {selected.files.map((file) => {
                    const deleted = Boolean(file.fileDeletedAt);
                    const printed = Boolean(file.printedAt);
                    const previewable =
                      !deleted && canPreviewInBrowser(file.fileExtension);
                    return (
                      <li
                        key={file.id}
                        className="rounded-xl border border-slate-200 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2">
                            {printed ? (
                              <CheckCircle2
                                className="mt-0.5 size-4 shrink-0 text-emerald-600"
                                aria-label="Printed"
                              />
                            ) : (
                              <span
                                className="mt-0.5 size-4 shrink-0 rounded-full border border-slate-300"
                                aria-hidden="true"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {file.originalFileName}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {file.fileExtension.toUpperCase()} ·{" "}
                                {file.totalPages} page
                                {file.totalPages === 1 ? "" : "s"}
                                {printed ? " · Printed" : ""}
                                {deleted
                                  ? " · Document removed (1 hour retention)"
                                  : ""}
                              </p>
                            </div>
                          </div>
                          {previewable ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPreviewFileId(file.id)}
                            >
                              <Eye className="size-3.5" />
                              Preview
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-500">
                              {deleted
                                ? "File removed after 1 hour"
                                : "Preview not available for this file type"}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {previewFileId && (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-sm font-medium text-slate-700">Preview</p>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-800"
                      onClick={() => setPreviewFileId(null)}
                    >
                      Close preview
                    </button>
                  </div>
                  <iframe
                    title="Document preview"
                    src={`/api/preview/${previewFileId}`}
                    className="h-80 w-full bg-white"
                  />
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof ClipboardList;
  tone?: "slate" | "amber" | "blue" | "emerald";
}) {
  const toneClass =
    tone === "amber"
      ? "bg-amber-50 text-amber-700"
      : tone === "blue"
        ? "bg-blue-50 text-blue-700"
        : tone === "emerald"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-50 text-slate-600";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          {label}
        </p>
        <span
          className={`flex size-7 items-center justify-center rounded-lg ${toneClass}`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function ModeBadge({ mode }: { mode: "BW" | "COLOR" }) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        mode === "BW"
          ? "bg-slate-50 text-slate-700 ring-slate-200"
          : "bg-blue-50 text-blue-700 ring-blue-200"
      }`}
    >
      {mode === "BW" ? "B&W" : "Color"}
    </span>
  );
}

function EmptyState({
  isTrulyEmpty,
  filtersActive,
  periodLabel,
  onClear,
}: {
  isTrulyEmpty: boolean;
  filtersActive: boolean;
  periodLabel: string;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 ring-1 ring-slate-200">
        <FileText className="size-5" aria-hidden="true" />
      </span>
      {isTrulyEmpty ? (
        <>
          <p className="mt-4 text-sm font-semibold text-slate-900">
            No print jobs yet
          </p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Customer print jobs will appear here when they submit documents
            through your shop QR code.
          </p>
        </>
      ) : filtersActive ? (
        <>
          <p className="mt-4 text-sm font-semibold text-slate-900">
            No print jobs found
          </p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            There are no jobs matching the selected filters.
          </p>
          <button
            type="button"
            onClick={onClear}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm font-semibold text-slate-900">
            No print jobs for {periodLabel.toLowerCase()}
          </p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            New jobs will appear here when customers submit documents through
            your shop QR code.
          </p>
        </>
      )}
    </div>
  );
}
