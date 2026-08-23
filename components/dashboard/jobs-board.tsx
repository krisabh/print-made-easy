"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { PrintStatus } from "@prisma/client";
import { CheckCircle2, Eye, Search, Trash2, X } from "lucide-react";

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

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
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

type JobsBoardProps = {
  initialJobs: JobItem[];
  initialSummary: Summary;
  showSummary?: boolean;
};

export function JobsBoard({
  initialJobs,
  initialSummary,
  showSummary = false,
}: JobsBoardProps) {
  const [jobs, setJobs] = useState(initialJobs);
  const [summary, setSummary] = useState(initialSummary);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [date, setDate] = useState<DateFilter>("today");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<JobItem | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("date", date);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [status, date, search]);

  const refresh = useCallback(() => {
    startRefresh(async () => {
      try {
        const res = await fetch(`/api/dashboard/jobs?${query}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Unable to refresh jobs.");
          return;
        }
        setJobs(data.jobs);
        setSummary(data.summary);
        setError(null);
        if (selected) {
          const updated = data.jobs.find((job: JobItem) => job.id === selected.id);
          setSelected(updated ?? null);
        }
      } catch {
        setError("Unable to refresh jobs.");
      }
    });
  }, [query, selected]);

  async function handleDeleteJob(job: JobItem) {
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

  return (
    <div className="space-y-5">
      {showSummary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Today's Jobs", value: summary.todaysJobs },
            { label: "Pending Jobs", value: summary.pendingJobs },
            { label: "Printing", value: summary.printingJobs },
            { label: "Ready for Pickup", value: summary.readyJobs },
            {
              label: "Today's Revenue",
              value: formatCurrency(summary.todaysRevenue),
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {card.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Print Jobs</h2>
            <p className="mt-1 text-sm text-slate-500">
              Auto-refreshes every 5 seconds
              {isRefreshing ? " · Updating…" : ""}
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs sm:shrink-0">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              id="dashboard-job-search"
              value={search}
              onChange={(event) => setSearch(event.target.value.toUpperCase())}
              placeholder="Search job number"
              aria-label="Search by job number"
              className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white py-1 pr-2.5 pl-9 text-sm outline-none placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/20"
            />
          </div>
        </div>

        <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Status
            </p>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((item) => {
                const active = status === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setStatus(item.value)}
                    aria-pressed={active}
                    className={`min-h-8 rounded-full px-3 text-sm font-medium transition-colors ${
                      active
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Date
            </p>
            <div className="flex flex-wrap gap-2">
              {DATE_FILTERS.map((item) => {
                const active = date === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setDate(item.value)}
                    aria-pressed={active}
                    className={`min-h-8 rounded-full px-3 text-sm font-medium transition-colors ${
                      active
                        ? "bg-slate-900 text-white shadow-sm"
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

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-3 font-medium">Job</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-3 py-3 font-medium">Pages</th>
                <th className="px-3 py-3 font-medium">Copies</th>
                <th className="px-3 py-3 font-medium">Mode</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Price</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                    No jobs found for this filter.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {job.jobNumber}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {formatTime(job.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{job.totalPages}</td>
                    <td className="px-3 py-3 text-slate-600">{job.copies}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {job.printMode === "BW" ? "B&W" : "Color"}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {job.printType === "SINGLE" ? "Single" : "Double"}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {formatCurrency(job.totalPrice)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        <StatusBadge status={job.status} />
                        {job.lastError && (
                          <p className="max-w-[14rem] text-xs text-red-600">
                            {job.lastError}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelected(job);
                            setPreviewFileId(null);
                          }}
                        >
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={deletingId === job.id}
                          aria-label={`Delete job ${job.jobNumber}`}
                          title="Delete job"
                          onClick={() => void handleDeleteJob(job)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
                  {selected.jobNumber}
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
                  disabled={deletingId === selected.id}
                  onClick={() => void handleDeleteJob(selected)}
                >
                  <Trash2 className="size-3.5" />
                  {deletingId === selected.id ? "Deleting…" : "Delete Job"}
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
                    {selected.printType === "SINGLE" ? "Single Side" : "Double Side"}
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
