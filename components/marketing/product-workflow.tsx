import Link from "next/link";
import {
  ArrowDown,
  Cable,
  CheckCircle2,
  Clock3,
  FileUp,
  LayoutDashboard,
  Link2,
  Printer,
  QrCode,
  ScanLine,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
} from "lucide-react";

function FlowArrow() {
  return (
    <div className="flex justify-center py-1 text-slate-300" aria-hidden="true">
      <ArrowDown className="size-4" />
    </div>
  );
}

function StepCard({
  step,
  title,
  body,
  icon: Icon,
}: {
  step: number;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {step}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Icon className="size-4" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
        </div>
      </div>
    </article>
  );
}

export function ProductWorkflowSection() {
  const shopkeeperSteps = [
    {
      icon: Store,
      title: "Create Your Shop",
      body: "Create your PrintMadeEasy shop account and get ready to receive print orders.",
    },
    {
      icon: QrCode,
      title: "Create Your Shop QR Code",
      body: "Generate your unique shop QR code from the dashboard. Customers use it to reach your print service.",
    },
    {
      icon: ScanLine,
      title: "Download / Display Your QR Code",
      body: "Download the shop QR code and place it at your counter.",
    },
    {
      icon: Cable,
      title: "Install PrintMadeEasy Agent",
      body: "Install the Windows Agent on the Windows computer connected to your printer. The Agent automatically detects the available printer.",
    },
    {
      icon: Link2,
      title: "Connect the Agent to Your Shop",
      body: "Generate a connection link from the dashboard and enter it in the Windows Agent.",
    },
    {
      icon: LayoutDashboard,
      title: "Start Receiving Print Jobs",
      body: "Customers can scan your QR code, upload documents, and submit print jobs. Monitor everything from the dashboard.",
    },
    {
      icon: Printer,
      title: "Print & Complete",
      body: "The Agent sends the job to the available printer. Manage the job in the dashboard and mark it ready when complete.",
    },
  ] as const;

  const customerSteps = [
    {
      icon: ScanLine,
      title: "Scan the Shop QR Code",
      body: "Scan the QR code displayed at the print shop counter. No app install required.",
    },
    {
      icon: Upload,
      title: "Upload Your Document",
      body: "Upload the document you want the shop to print (PDF, JPG, PNG, or DOCX).",
    },
    {
      icon: FileUp,
      title: "Choose & Submit Your Print Request",
      body: "Select copies, black & white or color, and single or double side, then submit your print request.",
    },
    {
      icon: Clock3,
      title: "Track Your Print Job",
      body: "Watch live status updates such as Pending, Printing, and Ready on the same page.",
    },
    {
      icon: CheckCircle2,
      title: "Collect Your Prints",
      body: "Visit the counter when your print job is ready and collect your documents.",
    },
  ] as const;

  return (
    <section className="border-y border-slate-200 bg-white py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            How PrintMadeEasy Works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            How PrintMadeEasy Works
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            From shop setup to customer pickup — PrintMadeEasy keeps the entire
            print journey simple.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-[#f5f7fb] p-4 sm:p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">
                Shopkeeper
              </p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">
                For Shopkeepers
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Set up once. Let PrintMadeEasy handle the workflow.
              </p>
            </div>
            <div className="space-y-0">
              {shopkeeperSteps.map((step, index) => (
                <div key={step.title}>
                  <StepCard
                    step={index + 1}
                    title={step.title}
                    body={step.body}
                    icon={step.icon}
                  />
                  {index < shopkeeperSteps.length - 1 ? <FlowArrow /> : null}
                </div>
              ))}
            </div>
            <Link
              href="/signup"
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create Your Shop
            </Link>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-[#f5f7fb] p-4 sm:p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">
                Customer
              </p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">
                For Customers
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Scan. Upload. Track. Collect.
              </p>
            </div>
            <div className="space-y-0">
              {customerSteps.map((step, index) => (
                <div key={step.title}>
                  <StepCard
                    step={index + 1}
                    title={step.title}
                    body={step.body}
                    icon={step.icon}
                  />
                  {index < customerSteps.length - 1 ? <FlowArrow /> : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-blue-100 bg-blue-50/60 p-5 sm:p-6">
          <p className="text-center text-xs font-semibold tracking-wide text-blue-700 uppercase">
            Where both journeys meet
          </p>
          <h3 className="mt-2 text-center text-lg font-semibold text-slate-900">
            The shared print workflow
          </h3>
          <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-2">
            {[
              "Customer submits",
              "PrintMadeEasy",
              "Shop dashboard",
              "Windows Agent",
              "Printer",
              "Ready",
              "Customer collects",
            ].map((label, index, list) => (
              <div key={label} className="flex items-center gap-2 sm:contents">
                <div className="flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-center text-sm font-medium text-slate-800 sm:flex-none">
                  {label}
                </div>
                {index < list.length - 1 ? (
                  <span
                    className="hidden text-blue-300 sm:inline"
                    aria-hidden="true"
                  >
                    →
                  </span>
                ) : null}
                {index < list.length - 1 ? (
                  <div className="flex justify-center sm:hidden" aria-hidden="true">
                    <ArrowDown className="size-4 text-blue-300" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-slate-600">
            The customer&apos;s document moves through PrintMadeEasy without
            them needing to understand the technical details.
          </p>
        </div>
      </div>
    </section>
  );
}

export function PrivacyWorkflowSection() {
  return (
    <section className="bg-[#f5f7fb] py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
            Privacy Built Into the Print Workflow
          </h2>
          <p className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-sm font-medium text-blue-700 ring-1 ring-blue-100">
            Documents automatically deleted after 1 hour
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">
              Shopkeeper
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              Less Storage. Less Cleanup.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              PrintMadeEasy automatically removes uploaded documents after 1
              hour, so unnecessary documents don&apos;t remain on your system
              and consume storage.
            </p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">
              Customer
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              Your Documents Are Automatically Removed.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Documents uploaded for printing are automatically deleted from the
              PrintMadeEasy server after 1 hour. They are not kept indefinitely
              after the print workflow is complete.
            </p>
          </article>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-2">
            {[
              { label: "Document", icon: FileUp },
              { label: "Uploaded", icon: Upload },
              { label: "Print workflow", icon: Printer },
              { label: "1 hour", icon: Clock3 },
              { label: "Automatically deleted", icon: Trash2 },
            ].map((item, index, list) => (
              <div key={item.label} className="contents">
                <div className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800">
                  <item.icon className="size-4 text-blue-700" aria-hidden="true" />
                  {item.label}
                </div>
                {index < list.length - 1 ? (
                  <>
                    <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
                      →
                    </span>
                    <div className="flex justify-center sm:hidden" aria-hidden="true">
                      <ArrowDown className="size-4 text-slate-300" />
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">
              Why Shopkeepers Love the Workflow
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li>
                <span className="font-semibold text-slate-900">Less manual work</span>
                <br />
                Customers submit documents themselves.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Less storage</span>
                <br />
                Documents are automatically removed after 1 hour.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Better visibility</span>
                <br />
                Track print jobs from one dashboard.
              </li>
            </ul>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">
              Why Customers Love It
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li>
                <span className="font-semibold text-slate-900">
                  No long wait at the computer
                </span>
                <br />
                Scan and submit your document from your phone.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Easy status tracking</span>
                <br />
                Know where your print job stands with live status updates.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Privacy minded</span>
                <br />
                Uploaded documents are automatically deleted after 1 hour.
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
