import { Printer } from "lucide-react";

import { ConnectPrintAgentCard } from "@/components/dashboard/connect-print-agent-card";
import { DownloadWindowsAgentCard } from "@/components/dashboard/download-windows-agent-card";
import { SubscriptionGateBanner } from "@/components/dashboard/subscription-gate-banner";
import { getAppBaseUrl } from "@/lib/app-url";
import {
  getShopAgentStatus,
  listShopPrintersWithLiveStatus,
} from "@/lib/print-agent-service";
import { requireDashboardSession } from "@/lib/require-product-access";

export default async function PrintersPage() {
  const { session, access } = await requireDashboardSession();
  const { shop } = session;
  const [agentStatus, printers, appBaseUrl] = await Promise.all([
    getShopAgentStatus(shop.id),
    listShopPrintersWithLiveStatus(shop.id),
    getAppBaseUrl(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Printers</h2>
        <p className="mt-1 text-sm text-slate-500">
          Download the Windows Agent, connect it to this shop, then review
          printers reported by the Agent.
        </p>
      </div>

      <SubscriptionGateBanner access={access} />
      {!access.hasAccess ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          Printing is currently disabled because your subscription is inactive.
          You can still review Agent and printer status below.
        </p>
      ) : null}

      <DownloadWindowsAgentCard />

      <ConnectPrintAgentCard
        shopName={shop.shopName}
        shopCode={shop.shopCode}
        appBaseUrl={appBaseUrl}
        pairingLocked={!access.hasAccess}
        initialStatus={{
          connected: agentStatus?.connected ?? false,
          lastSeen: agentStatus?.lastSeen ?? null,
          printerName: agentStatus?.printerName ?? null,
          printerStatus: agentStatus?.printerStatus ?? null,
          printerOffline: agentStatus?.printerOffline ?? false,
        }}
      />

      <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Printer className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">
              Printer details
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Default printer:{" "}
              <span className="font-medium text-slate-700">
                {agentStatus?.printerName || "Not selected"}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Printer status:{" "}
              <span className="font-medium text-slate-700">
                {agentStatus?.printerStatus || "unknown"}
              </span>
            </p>
          </div>
        </div>
        {agentStatus?.printerOffline && agentStatus.connected && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Printer Offline — jobs will stay pending until the printer is
            available.
          </p>
        )}
      </section>

      <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">
          Detected printers
        </h3>
        {printers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No printers reported yet. Connect the PrintMadeEasy Agent and select
            a printer.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {printers.map((printer) => (
              <li
                key={printer.id}
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm"
              >
                <p className="font-medium text-slate-900">
                  {printer.printerName}
                  {printer.isDefault ? " (Default)" : ""}
                </p>
                <p className="mt-1 text-slate-500">
                  Status: {printer.status}
                  {printer.lastSeen
                    ? ` · Last seen ${printer.lastSeen.toLocaleString()}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
