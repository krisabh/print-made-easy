import Link from "next/link";
import { Check } from "lucide-react";

/**
 * Compact shopkeeper prerequisites — internet, Agent, printer.
 * Does not invent live "internet connected" telemetry.
 */
export function PrintingPrerequisites({
  agentConnected,
  agentEverConnected,
}: {
  agentConnected: boolean;
  agentEverConnected: boolean;
}) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      aria-labelledby="printing-prerequisites-heading"
    >
      <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
        Before you start printing
      </p>
      <h3
        id="printing-prerequisites-heading"
        className="mt-1 text-base font-semibold text-slate-900"
      >
        Printing prerequisites
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Customer orders can be received only when your computer is online and
        the PrintYantra Agent is running.
      </p>

      <ul className="mt-4 space-y-2.5">
        <PrerequisiteItem>
          Keep your computer connected to the internet
        </PrerequisiteItem>
        <PrerequisiteItem highlighted={!agentConnected}>
          The PrintYantra Agent starts automatically with Windows, but keep it
          running so customer orders can be printed.
        </PrerequisiteItem>
        <PrerequisiteItem>
          Keep your printer connected and ready
        </PrerequisiteItem>
      </ul>

      {!agentConnected ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3">
          <p className="text-sm font-medium text-amber-900">
            {agentEverConnected
              ? "Agent offline"
              : "Connect your PrintYantra Agent"}
          </p>
          <p className="mt-1 text-sm text-amber-800/90">
            {agentEverConnected
              ? "Start the PrintYantra Agent to receive and print customer orders."
              : "Install and sign in to the PrintYantra Agent to start receiving orders."}
          </p>
          <Link
            href="/dashboard/printers"
            className="mt-2 inline-flex text-sm font-semibold text-blue-700 hover:underline"
          >
            Open Agent download &amp; setup
          </Link>
        </div>
      ) : (
        <p className="mt-4 text-sm font-medium text-emerald-700">
          Agent connected — your shop is ready to receive and print orders.
        </p>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          How printing works
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-slate-600">
          <li>Keep your computer connected to the internet.</li>
          <li>
            The PrintYantra Agent starts automatically with Windows — keep it
            running so customer orders can be printed.
          </li>
          <li>Customers upload documents using your shop&apos;s QR code.</li>
          <li>
            The Agent receives the order and sends it to your selected printer.
          </li>
        </ol>
      </div>
    </section>
  );
}

function PrerequisiteItem({
  children,
  highlighted = false,
}: {
  children: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <li
      className={`flex items-start gap-2.5 text-sm ${
        highlighted ? "font-medium text-slate-900" : "text-slate-700"
      }`}
    >
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
        aria-hidden="true"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </li>
  );
}
