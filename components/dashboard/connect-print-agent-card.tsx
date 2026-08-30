"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";

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

type PairingState = {
  expiresAt: string;
  connectUrl: string;
};

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ConnectPrintAgentCard({
  shopName,
  shopCode,
  appBaseUrl,
  initialStatus,
  pairingLocked = false,
}: ConnectPrintAgentCardProps) {
  const [status, setStatus] = useState(initialStatus);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [expired, setExpired] = useState(false);
  const [remainingLabel, setRemainingLabel] = useState("10:00");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const copiedResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedResetRef.current != null) {
        window.clearTimeout(copiedResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pairing) return;

    function tick() {
      const left = new Date(pairing!.expiresAt).getTime() - Date.now();
      if (left <= 0) {
        setExpired(true);
        setRemainingLabel("00:00");
        setPairing(null);
        setCopied(false);
        return;
      }
      setExpired(false);
      setRemainingLabel(formatRemaining(left));
    }

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  function refreshStatus() {
    setError(null);
    startRefresh(async () => {
      try {
        const res = await fetch("/api/dashboard/jobs?date=today&status=ALL", {
          cache: "no-store",
        });
        if (!res.ok) {
          setError("Unable to refresh agent status.");
          return;
        }
        const data = (await res.json()) as { agentStatus?: AgentStatusSnapshot };
        if (data.agentStatus) {
          setStatus(data.agentStatus);
        }
      } catch {
        setError("Unable to refresh agent status.");
      }
    });
  }

  function generatePairing() {
    if (pairingLocked) {
      setError("Subscription required to connect a Print Agent.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/print-agent/pair", {
          method: "POST",
          cache: "no-store",
        });
        if (res.status === 401) {
          setError("Please sign in again to connect a Print Agent.");
          return;
        }
        if (res.status === 402) {
          setError("Subscription required to connect a Print Agent.");
          return;
        }
        if (!res.ok) {
          setError("Unable to create a connection link. Please try again.");
          return;
        }

        const data = (await res.json()) as {
          pairingToken?: string;
          expiresAt?: string;
        };

        if (!data.pairingToken || !data.expiresAt) {
          setError("Invalid pairing response.");
          return;
        }

        const connectUrl = `${appBaseUrl.replace(/\/$/, "")}/agent/connect?t=${encodeURIComponent(data.pairingToken)}`;

        setExpired(false);
        setCopied(false);
        setPairing({
          expiresAt: data.expiresAt,
          connectUrl,
        });
      } catch {
        setError("Unable to create a connection link. Please try again.");
      }
    });
  }

  async function copyConnectionLink() {
    if (!pairing?.connectUrl) return;
    try {
      await navigator.clipboard.writeText(pairing.connectUrl);
      setCopied(true);
      if (copiedResetRef.current != null) {
        window.clearTimeout(copiedResetRef.current);
      }
      copiedResetRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedResetRef.current = null;
      }, 2000);
    } catch {
      setError("Unable to copy the connection link. Please try again.");
    }
  }

  return (
    <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-base font-semibold text-slate-900">Print Agent</h3>
      <p className="mt-1 text-sm text-slate-500">
        Connect your printer computer to this shop.
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
            >
              <span
                className={`size-2 shrink-0 rounded-full ${
                  status.connected ? "bg-emerald-500" : "bg-amber-500"
                }`}
                aria-hidden="true"
              />
              {status.connected ? "Agent Connected" : "Agent Offline"}
            </p>
            {status.lastSeen ? (
              <p className="mt-2 text-xs text-slate-500">
                Last seen: {new Date(status.lastSeen).toLocaleString()}
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Last seen: Never</p>
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

      <div className="mt-4 rounded-xl border border-slate-200 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Connection
        </p>
        <p className="mt-2 text-sm font-medium text-slate-900">
          Connection Link
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Generate a one-time link, then paste it into the PrintMadeEasy Agent.
        </p>

        <div className="mt-4 space-y-3">
          {!pairing && !expired ? (
            <Button
              type="button"
              className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={pending || pairingLocked}
              onClick={generatePairing}
            >
              {pairingLocked
                ? "Subscribe to connect Agent"
                : pending
                  ? "Generating…"
                  : "Generate Connection Link"}
            </Button>
          ) : null}

          {expired ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-medium text-amber-900">
                Connection link expired
              </p>
              <p className="text-sm text-amber-800">
                Generate a new link to continue pairing. Previous links are no
                longer valid.
              </p>
              <Button
                type="button"
                className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
                disabled={pending || pairingLocked}
                onClick={generatePairing}
              >
                {pairingLocked
                  ? "Subscribe to connect Agent"
                  : pending
                    ? "Generating…"
                    : "Generate Connection Link"}
              </Button>
            </div>
          ) : null}

          {pairing ? (
            <div className="space-y-3">
              <p className="break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                {pairing.connectUrl}
              </p>
              <p className="text-xs text-slate-500">
                Paste this link in the PrintMadeEasy Agent. Expires in{" "}
                <span className="font-semibold text-slate-800">
                  {remainingLabel}
                </span>
              </p>
              <Button
                type="button"
                className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
                onClick={copyConnectionLink}
              >
                {copied ? (
                  <>
                    <Check className="size-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    Copy Connection Link
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                onClick={generatePairing}
                disabled={pending || pairingLocked}
              >
                {pairingLocked
                  ? "Subscribe to connect Agent"
                  : pending
                    ? "Generating…"
                    : "Generate Connection Link"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
