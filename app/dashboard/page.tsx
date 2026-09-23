import { JobsBoard } from "@/components/dashboard/jobs-board";
import { PrintingPrerequisites } from "@/components/dashboard/printing-prerequisites";
import { ShopSetupChecklist } from "@/components/dashboard/shop-setup-checklist";
import { SubscriptionGateBanner } from "@/components/dashboard/subscription-gate-banner";
import { SubscriptionStatusCard } from "@/components/dashboard/subscription-status-card";
import {
  getDashboardSummary,
  getShopJobs,
} from "@/lib/dashboard-service";
import {
  getShopAgentStatus,
  listShopPrintersWithLiveStatus,
} from "@/lib/print-agent-service";
import { getCurrentPremiumPriceInr } from "@/lib/admin-settings";
import { requireDashboardSession } from "@/lib/require-product-access";
import {
  getShopSubscription,
  toPublicSubscriptionView,
} from "@/lib/subscription";

export default async function DashboardPage() {
  const { session, access } = await requireDashboardSession();
  const { shop } = session;

  const [summary, jobs, subscription, agentStatus, printers, premiumPriceInr] =
    await Promise.all([
      getDashboardSummary(shop.id),
      getShopJobs({ shopId: shop.id, date: "today", status: "ALL" }),
      getShopSubscription(shop.id),
      getShopAgentStatus(shop.id),
      listShopPrintersWithLiveStatus(shop.id),
      getCurrentPremiumPriceInr(),
    ]);

  const agentConnected = Boolean(agentStatus?.connected);
  const agentEverConnected = Boolean(agentStatus?.lastSeen);
  const printerDetected = printers.length > 0;
  const defaultPrinter =
    printers.find((printer) => printer.isDefault) ?? null;
  const defaultPrinterSelected = Boolean(
    defaultPrinter?.printerName || agentStatus?.printerName,
  );
  const defaultPrinterName =
    defaultPrinter?.printerName || agentStatus?.printerName || null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-500">
          Overview of today&apos;s print activity for your shop.
        </p>
      </div>
      <SubscriptionGateBanner access={access} />
      <SubscriptionStatusCard
        subscription={toPublicSubscriptionView(subscription, new Date(), premiumPriceInr)}
        showGraceWarning={access.isGracePeriod}
      />
      <PrintingPrerequisites
        agentConnected={agentConnected}
        agentEverConnected={agentEverConnected}
      />
      <ShopSetupChecklist
        agentConnected={agentConnected}
        printerDetected={printerDetected}
        defaultPrinterSelected={defaultPrinterSelected}
        defaultPrinterName={defaultPrinterName}
      />
      <JobsBoard
        initialJobs={jobs}
        initialSummary={summary}
        showSummary
        printingLocked={!access.hasAccess}
      />
    </div>
  );
}
