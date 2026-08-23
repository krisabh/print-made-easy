"use client";

import { useEffect, useState } from "react";

type AgentStatus = {
  connected: boolean;
  lastSeen: string | null;
  printerName: string | null;
  printerStatus: string | null;
  printerOffline: boolean;
};

function isPrinterOnline(status: AgentStatus) {
  if (!status.printerName) return false;
  if (status.printerOffline) return false;
  return status.printerStatus?.toLowerCase() !== "offline";
}

export function AgentStatusBadge() {
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/dashboard/jobs?date=today&status=ALL", {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && data.agentStatus) {
          setStatus(data.agentStatus);
        }
      } catch {
        if (!cancelled) setStatus(null);
      }
    }

    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StatusPill tone="neutral" label="Checking Agent…" />
      </div>
    );
  }

  const printerOnline = isPrinterOnline(status);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <StatusPill
        tone={status.connected ? "ok" : "warn"}
        label={status.connected ? "Agent Connected" : "Agent Offline"}
      />
      <StatusPill
        tone={printerOnline ? "ok" : "bad"}
        label={printerOnline ? "Printer Connected" : "Printer Offline"}
        detail={status.printerName}
      />
    </div>
  );
}

function StatusPill({
  tone,
  label,
  detail,
}: {
  tone: "ok" | "warn" | "bad" | "neutral";
  label: string;
  detail?: string | null;
}) {
  const styles = {
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warn: "bg-amber-50 text-amber-700 ring-amber-200",
    bad: "bg-red-50 text-red-700 ring-red-200",
    neutral: "bg-slate-100 text-slate-600 ring-slate-200",
  } as const;

  const dot = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    neutral: "bg-slate-400",
  } as const;

  return (
    <div
      className={`max-w-[16rem] rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${styles[tone]}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className={`size-1.5 shrink-0 rounded-full ${dot[tone]}`} />
        {label}
      </span>
      {detail ? (
        <span className="mt-0.5 block truncate font-normal opacity-80">
          {detail}
        </span>
      ) : null}
    </div>
  );
}
