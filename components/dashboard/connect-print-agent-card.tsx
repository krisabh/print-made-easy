"use client";

import { useEffect, useState, useTransition } from "react";
import QRCode from "qrcode";
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
};

type PairingState = {
  pairingToken: string;
  expiresAt: string;
  qrDataUrl: string;
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
}: ConnectPrintAgentCardProps) {
  const [status, setStatus] = useState(initialStatus);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [expired, setExpired] = useState(false);
  const [remainingLabel, setRemainingLabel] = useState("10:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    if (!pairing) return;

    function tick() {
      const left = new Date(pairing!.expiresAt).getTime() - Date.now();
      if (left <= 0) {
        setExpired(true);
        setRemainingLabel("00:00");
        setPairing(null);
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
        if (!res.ok) {
          setError("Unable to create a connection code. Please try again.");
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
        const qrDataUrl = await QRCode.toDataURL(connectUrl, {
          margin: 2,
          width: 512,
          color: { dark: "#0f172a", light: "#ffffff" },
        });

        setExpired(false);
        setPairing({
          pairingToken: data.pairingToken,
          expiresAt: data.expiresAt,
          qrDataUrl,
        });
      } catch {
        setError("Unable to create a connection code. Please try again.");
      }
    });
  }

  return (
    <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">Print Agent</h3>
      <p className="mt-1 text-sm text-slate-500">
        Connect your printer computer to this shop.
      </p>

      <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm">
        <p className="font-medium text-slate-900">{shopName}</p>
        <p className="mt-1 text-slate-500">Shop Code: {shopCode}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p
          className={`text-sm font-medium ${
            status.connected ? "text-emerald-700" : "text-amber-700"
          }`}
        >
          Status: {status.connected ? "Agent Online" : "Agent Offline"}
        </p>
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

      {status.lastSeen ? (
        <p className="mt-2 text-xs text-slate-500">
          Last seen: {new Date(status.lastSeen).toLocaleString()}
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {!pairing && !expired ? (
        <Button
          type="button"
          className="mt-5 h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
          onClick={generatePairing}
          disabled={pending}
        >
          {pending ? "Generating…" : "Generate Connection QR"}
        </Button>
      ) : null}

      {expired ? (
        <div className="mt-5 space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-medium text-amber-900">
            Connection code expired
          </p>
          <p className="text-sm text-amber-800">
            Generate a new code to continue pairing. Previous codes are no longer
            valid.
          </p>
          <Button
            type="button"
            className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
            onClick={generatePairing}
            disabled={pending}
          >
            {pending ? "Generating…" : "Generate New Code"}
          </Button>
        </div>
      ) : null}

      {pairing ? (
        <div className="mt-5 space-y-4 text-center">
          <p className="text-sm font-medium text-slate-900">
            Scan this QR using PrintMadeEasy Agent
          </p>
          <img
            src={pairing.qrDataUrl}
            alt="Print Agent pairing QR code"
            className="mx-auto size-56 rounded-xl border border-slate-200 bg-white p-3 sm:size-64"
          />
          <p className="text-sm text-slate-600">
            Valid for 10 minutes · Expires in:{" "}
            <span className="font-semibold text-slate-900">{remainingLabel}</span>
          </p>
          <p className="text-xs text-slate-400">
            Pairing code expires automatically. Generating a new code invalidates
            this one.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={generatePairing}
            disabled={pending}
          >
            {pending ? "Generating…" : "Generate New Code"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
