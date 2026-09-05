"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "What is PrintMadeEasy?",
    a: "PrintMadeEasy is print-shop management software for shopkeepers. It helps print shops accept QR-based customer print requests, manage jobs, connect a Windows Print Agent, and track printer/agent status.",
  },
  {
    q: "Who pays for PrintMadeEasy?",
    a: "The shopkeeper (print-shop owner) pays PrintMadeEasy. Premium is ₹199 per month (INR) after a 7-day free trial. Customers who scan a shop QR code and submit documents do not pay PrintMadeEasy.",
  },
  {
    q: "Who is PrintMadeEasy for?",
    a: "It is built for print shops, photocopy shops, stationery shops, cyber cafes, and small digital service centers that handle print orders.",
  },
  {
    q: "Do I need a special printer?",
    a: "No special PrintMadeEasy printer is required. The Windows Agent works with printers already installed on your Windows computer.",
  },
  {
    q: "What is the Windows Print Agent?",
    a: "The PrintMadeEasy Agent is a Windows application that runs on the computer connected to your printer and keeps that shop connected to PrintMadeEasy.",
  },
  {
    q: "How do I connect my shop?",
    a: "From the Printers page in your dashboard, generate a connection link and paste it into the PrintMadeEasy Agent. The link is one-time and expires after a short period.",
  },
  {
    q: "What happens if my printer is offline?",
    a: "The dashboard can show Agent and Printer status separately. If the printer environment is offline, jobs may remain pending until the printer is available again.",
  },
  {
    q: "Can I track print jobs?",
    a: "Yes. Shopkeepers can track jobs in the dashboard. Customers can also watch live status after submitting — including Pending, Printing, and Ready — on the upload page.",
  },
  {
    q: "What happens to uploaded documents?",
    a: "Documents uploaded for printing are automatically deleted from the PrintMadeEasy server after 1 hour. Job history can remain in the dashboard, but the document files are removed.",
  },
  {
    q: "Is the Windows Agent required?",
    a: "Yes. After you create your shop and sign in, download the Agent from the Printers page in your dashboard. The Agent is required to connect your shop computer and process printing through PrintMadeEasy.",
  },
  {
    q: "How do I get support or cancel?",
    a: "Visit Support or Contact Us, email abhiram12sep@gmail.com, or use WhatsApp. Cancellation and refund details are in the Refund & Cancellation Policy. Shopkeepers can also manage billing from My Plan / Billing in the dashboard.",
  },
] as const;

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();

  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            FAQ
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            Frequently asked questions
          </h2>
        </div>

        <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
          {FAQS.map((item, index) => {
            const open = openIndex === index;
            const panelId = `${baseId}-panel-${index}`;
            const buttonId = `${baseId}-button-${index}`;
            return (
              <div key={item.q} className="px-4 sm:px-5">
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={open}
                  aria-controls={panelId}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left"
                  onClick={() => setOpenIndex(open ? null : index)}
                >
                  <span className="text-sm font-semibold text-slate-900 sm:text-base">
                    {item.q}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-5 shrink-0 text-slate-400 transition-transform",
                      open && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>
                {open ? (
                  <p
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="pb-4 text-sm leading-relaxed text-slate-600"
                  >
                    {item.a}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
