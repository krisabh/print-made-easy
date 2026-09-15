import Link from "next/link";
import {
  Check,
  Download,
  Printer,
  QrCode,
  MonitorSmartphone,
} from "lucide-react";

export type ShopSetupChecklistProps = {
  agentConnected: boolean;
  printerDetected: boolean;
  defaultPrinterSelected: boolean;
  defaultPrinterName?: string | null;
};

type Step = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  icon: typeof Download;
};

export function ShopSetupChecklist({
  agentConnected,
  printerDetected,
  defaultPrinterSelected,
  defaultPrinterName,
}: ShopSetupChecklistProps) {
  const readyForCustomers =
    agentConnected && printerDetected && defaultPrinterSelected;

  const steps: Step[] = [
    {
      id: "agent",
      title: "Connect your PrintMadeEasy Agent",
      description:
        "Keep the Agent running on your computer so customer orders can reach your printer.",
      done: agentConnected,
      href: "/dashboard/printers",
      cta: "Open Printers",
      icon: Download,
    },
    {
      id: "printers",
      title: "Connect your printer",
      description:
        "Keep your printer connected and ready. The Agent detects printers on this computer.",
      done: printerDetected,
      href: "/dashboard/printers",
      cta: "View printers",
      icon: MonitorSmartphone,
    },
    {
      id: "default",
      title: "Choose your default printer",
      description:
        "If you have multiple printers, choose which detected printer should be used as the default.",
      done: defaultPrinterSelected,
      href: "/dashboard/printers",
      cta: "Choose default",
      icon: Printer,
    },
    {
      id: "accept",
      title: "Start accepting print jobs",
      description:
        "Display your shop QR code and let customers upload documents from their phones.",
      done: readyForCustomers,
      href: "/dashboard/qr",
      cta: "Show QR code",
      icon: QrCode,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const nextIncomplete = steps.find((s) => !s.done);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
            First 5 minutes
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">
            Set up your shop to accept print jobs
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Keep internet on, keep the PrintMadeEasy Agent running, then show
            your QR so customers can upload.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill done={agentConnected} label="Agent connected" />
          <StatusPill done={printerDetected} label="Printer detected" />
          <StatusPill
            done={defaultPrinterSelected}
            label={
              defaultPrinterSelected && defaultPrinterName
                ? `Default: ${defaultPrinterName}`
                : "Default printer selected"
            }
          />
          <StatusPill done={readyForCustomers} label="Ready for customers" />
        </div>
      </div>

      <p className="mt-4 text-xs font-medium text-slate-500">
        {completedCount} of {steps.length} steps complete
      </p>

      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className={`flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
                step.done
                  ? "border-emerald-100 bg-emerald-50/60"
                  : "border-slate-200 bg-slate-50/50"
              }`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.done
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200"
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="size-3.5" /> : index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`size-4 shrink-0 ${
                        step.done ? "text-emerald-700" : "text-blue-600"
                      }`}
                      aria-hidden="true"
                    />
                    <p className="text-sm font-semibold text-slate-900">
                      {step.title}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {step.description}
                  </p>
                </div>
              </div>
              {!step.done ? (
                <Link
                  href={step.href}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:self-center"
                >
                  {step.cta}
                </Link>
              ) : (
                <span className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 px-3 text-xs font-semibold text-emerald-800 sm:self-center">
                  Done
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {readyForCustomers ? (
          <p className="text-sm font-medium text-emerald-700">
            Setup complete — you&apos;re ready for customers.
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            About 5 minutes. You can keep using the dashboard anytime.
          </p>
        )}
        <Link
          href={nextIncomplete?.href ?? "/dashboard/qr"}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {readyForCustomers
            ? "View shop QR"
            : nextIncomplete?.id === "accept"
              ? "Complete Setup"
              : "Set Up My Shop"}
        </Link>
      </div>
    </section>
  );
}

function StatusPill({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        done
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
          : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"
      }`}
      title={label}
    >
      {done ? "✓" : "○"} {label}
    </span>
  );
}
