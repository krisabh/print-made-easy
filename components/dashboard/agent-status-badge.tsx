"use client";

import { useEffect, useState } from "react";

type AgentStatus = {
  connected: boolean;
  lastSeen: string | null;
  printerName: string | null;
  printerStatus: string | null;
  printerOffline: boolean;
};

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
      <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
        Checking Agent…
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
        Agent Offline
      </div>
    );
  }

  if (status.printerOffline) {
    return (
      <div className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
        ⚠ Printer Offline
        {status.printerName ? ` · ${status.printerName}` : ""}
      </div>
    );
  }

  return (
    <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
      Agent Connected
      {status.printerName ? ` · ${status.printerName}` : ""}
    </div>
  );
}
