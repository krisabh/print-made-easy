"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type AgentStatusSnapshot = {
  connected: boolean;
  lastSeen: string | null;
  printerName: string | null;
  printerStatus: string | null;
  printerOffline: boolean;
};

type ConnectPrintAgentCardProps = {
  shopName: string;
  shopCode: string;
  appBaseUrl: string;
  initialStatus: AgentStatusSnapshot;
  pairingLocked?: boolean;
};

/**
 * Dashboard Agent status card.
 * Multi-computer setup: install Agent on each PC and sign in with the same
 * PrintYantra email/password. No QR / pairing-link UX.
 */
export function ConnectPrintAgentCard({
  shopName,
  shopCode,
  initialStatus,
  pairingLocked = false,
}: ConnectPrintAgentCardProps) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  function refreshStatus() {
    setError(null);
    startRefresh(async () => {
      try {
        const res = await fetch("/api/dashboard/jobs?date=today&status=ALL", {
          cache: "no-store",
        });
        if (!res.ok) {
          setError(
            "Unable to connect. Please check your internet connection and try again.",
          );
          return;
        }
        const data = (await res.json()) as { agentStatus?: AgentStatusSnapshot };
        if (data.agentStatus) {
          setStatus(data.agentStatus);
        }
      } catch {
        setError(
          "Unable to connect. Please check your internet connection and try again.",
        );
      }
    });
  }

  const everConnected = Boolean(status.lastSeen);
  const agentTitle = status.connected
    ? "Agent Connected"
    : everConnected
      ? "Agent Offline"
      : "Connect your PrintYantra Agent";
  const agentMeaning = status.connected
    ? "Your shop is ready to receive and print orders."
    : everConnected
      ? "Start the PrintYantra Agent to receive and print customer orders."
      : "Install and sign in to the PrintYantra Agent to start receiving orders.";

  return (
    <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-base font-semibold text-slate-900">Print Agent</h3>
      <p className="mt-1 text-sm text-slate-500">
        Install the Windows Agent on your printer computer and sign in with your
        PrintYantra account. Keep the Agent running while you accept orders.
      </p>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <p className="font-medium text-slate-900">{shopName}</p>
        <p className="mt-1 text-slate-500">Shop Code: {shopCode}</p>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Agent
            </p>
            <p
              className={`mt-2 inline-flex items-center gap-2 text-sm font-semibold ${
                status.connected ? "text-emerald-700" : "text-amber-700"
              }`}
              role="status"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${
                  status.connected ? "bg-emerald-500" : "bg-amber-500"
                }`}
                aria-hidden="true"
              />
              {agentTitle}
            </p>
            <p className="mt-2 text-sm text-slate-600">{agentMeaning}</p>
            {status.lastSeen ? (
              <p className="mt-2 text-xs text-slate-500">
                Last seen: {new Date(status.lastSeen).toLocaleString()}
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Not connected yet — download the Agent above and sign in.
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={refreshStatus}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh status
          </Button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        {pairingLocked ? (
          <p>Subscribe to connect a Print Agent and start printing.</p>
        ) : (
          <p>
            Use the same PrintYantra account on multiple computers. Open the
            Agent on each PC and sign in with your shop email and password. Your
            shop stays connected when at least one Agent is running.
          </p>
        )}
      </div>
    </section>
  );
}
