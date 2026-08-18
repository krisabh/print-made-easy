import { Printer } from "lucide-react";

import { ConnectPrintAgentCard } from "@/components/dashboard/connect-print-agent-card";
import { DownloadWindowsAgentCard } from "@/components/dashboard/download-windows-agent-card";
import { requireShop } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/app-url";
import { getShopAgentStatus } from "@/lib/print-agent-service";
import { prisma } from "@/lib/prisma";

export default async function PrintersPage() {
  const { shop } = await requireShop();
  const [agentStatus, printers, appBaseUrl] = await Promise.all([
    getShopAgentStatus(shop.id),
    prisma.printer.findMany({
      where: { shopId: shop.id },
      orderBy: [{ isDefault: "desc" }, { printerName: "asc" }],
    }),
    getAppBaseUrl(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Printers</h2>
        <p className="mt-1 text-sm text-slate-500">
          Printers reported by the Windows Print Agent.
        </p>
      </div>

      <DownloadWindowsAgentCard />

      <ConnectPrintAgentCard
        shopName={shop.shopName}
        shopCode={shop.shopCode}
        appBaseUrl={appBaseUrl}
        initialStatus={{
          connected: agentStatus?.connected ?? false,
          lastSeen: agentStatus?.lastSeen ?? null,
          printerName: agentStatus?.printerName ?? null,
          printerStatus: agentStatus?.printerStatus ?? null,
          printerOffline: agentStatus?.printerOffline ?? false,
        }}
      />

      <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Printer className="size-5" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">
          Printer details
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          Default printer: {agentStatus?.printerName || "Not selected"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Printer status: {agentStatus?.printerStatus || "unknown"}
        </p>
        {agentStatus?.printerOffline && agentStatus.connected && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            ⚠ Printer Offline — jobs will stay pending until the printer is
            available.
          </p>
        )}
      </section>

      <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Detected printers</h3>
        {printers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No printers reported yet. Connect the PrintMadeEasy Agent and select a
            printer.
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
