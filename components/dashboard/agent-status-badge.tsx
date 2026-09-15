"use client";

import { useEffect, useState } from "react";

type AgentStatus = {
  connected: boolean;
  lastSeen: string | null;
  printerName: string | null;
  printerStatus: string | null;
  printerOffline: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "network_error" }
  | { kind: "ready"; status: AgentStatus };

function isPrinterOnline(status: AgentStatus) {
  if (!status.connected) return false;
  if (!status.printerName) return false;
  if (status.printerOffline) return false;
  const value = status.printerStatus?.toLowerCase();
  return (
    value === "online" ||
    value === "idle" ||
    value === "printing" ||
    value === "ready" ||
    value === "warmup"
  );
}

function agentPresentation(status: AgentStatus): {
  tone: "ok" | "warn" | "bad" | "neutral";
  label: string;
  meaning: string;
} {
  if (status.connected) {
    return {
      tone: "ok",
      label: "Agent Connected",
      meaning: "Your shop is ready to receive and print orders.",
    };
  }
  if (!status.lastSeen) {
    return {
      tone: "warn",
      label: "Connect Agent",
      meaning:
        "Install and sign in to the PrintMadeEasy Agent to start receiving orders.",
    };
  }
  return {
    tone: "warn",
    label: "Agent Offline",
    meaning:
      "Start the PrintMadeEasy Agent to receive and print customer orders.",
  };
}

export function AgentStatusBadge() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/dashboard/jobs?date=today&status=ALL", {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setState({ kind: "network_error" });
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.agentStatus) {
          setState({ kind: "ready", status: data.agentStatus });
        } else {
          setState({ kind: "network_error" });
        }
      } catch {
        if (!cancelled) setState({ kind: "network_error" });
      }
    }

    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StatusPill tone="neutral" label="Checking Agent…" />
      </div>
    );
  }

  if (state.kind === "network_error") {
    return (
      <div className="flex max-w-xs flex-col items-end gap-1 sm:max-w-sm">
        <StatusPill tone="bad" label="Connection issue" />
        <p className="text-right text-[11px] leading-snug text-slate-500">
          Unable to connect. Please check your internet connection and try
          again.
        </p>
      </div>
    );
  }

  const { status } = state;
  const agent = agentPresentation(status);
  const printerOnline = isPrinterOnline(status);

  return (
    <div className="flex max-w-xs flex-col items-end gap-1 sm:max-w-md">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StatusPill
          tone={agent.tone}
          label={agent.label}
          ariaLabel={`${agent.label}. ${agent.meaning}`}
        />
        <StatusPill
          tone={printerOnline ? "ok" : "bad"}
          label={printerOnline ? "Printer Connected" : "Printer Offline"}
          detail={status.printerName}
          ariaLabel={
            printerOnline
              ? `Printer Connected${status.printerName ? `: ${status.printerName}` : ""}`
              : `Printer Offline. Keep your printer connected and ready.`
          }
        />
      </div>
      <p className="hidden text-right text-[11px] leading-snug text-slate-500 sm:block">
        {agent.meaning}
      </p>
    </div>
  );
}

function StatusPill({
  tone,
  label,
  detail,
  ariaLabel,
}: {
  tone: "ok" | "warn" | "bad" | "neutral";
  label: string;
  detail?: string | null;
  ariaLabel?: string;
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
      role="status"
      aria-label={ariaLabel || label}
      className={`max-w-[16rem] rounded-xl px-3 py-1.5 text-xs font-medium ring-1 ${styles[tone]}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className={`size-2 shrink-0 rounded-full ${dot[tone]}`} aria-hidden="true" />
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
