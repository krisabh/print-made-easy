import type { Metadata } from "next";
import {
  Cable,
  CircleHelp,
  Headphones,
  Printer,
  Settings,
  ShieldAlert,
} from "lucide-react";

import { WhatsAppIconLink } from "@/components/marketing/whatsapp-floating-button";
import { FinalCtaSection } from "@/components/marketing/sections";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with PrintMadeEasy setup, Windows Agent installation, shop connection, printer troubleshooting, and print jobs.",
};

const TOPICS = [
  {
    icon: CircleHelp,
    title: "Getting Started",
    body: "Create your shop, sign in to the dashboard, and review the Printers page.",
  },
  {
    icon: Cable,
    title: "Agent Installation",
    body: "After login, download the Windows Agent from the Printers page and install it on the computer connected to your printer.",
  },
  {
    icon: Settings,
    title: "Connecting Your Shop",
    body: "Generate a connection link in the dashboard and paste it into the Agent.",
  },
  {
    icon: Printer,
    title: "Printer Troubleshooting",
    body: "Check Agent Connected and Printer Connected status separately in the dashboard header.",
  },
  {
    icon: ShieldAlert,
    title: "Print Job Help",
    body: "Use status filters and search by job number to find pending, printing, or ready jobs.",
  },
  {
    icon: Headphones,
    title: "Account & Subscription",
    body: "Manage trial and Premium access from your shop Settings after you sign in.",
  },
] as const;

export default function SupportPage() {
  return (
    <>
      <section className="border-b border-slate-200 bg-[#f5f7fb] py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Support
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            Help for shopkeepers
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">
            Quick guidance for the parts of PrintMadeEasy shopkeepers use every
            day.
          </p>
        </div>
      </section>

      <section className="bg-white py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOPICS.map((topic) => (
              <article
                key={topic.title}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                  <topic.icon className="size-5" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">
                  {topic.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {topic.body}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-xl font-semibold text-slate-900">Need help?</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Email
                </p>
                <a
                  href={SITE.emailHref}
                  className="mt-1 inline-block break-all text-sm font-medium text-blue-700 hover:text-blue-800"
                >
                  {SITE.email}
                </a>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  WhatsApp
                </p>
                <div className="mt-2">
                  <WhatsAppIconLink />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <FinalCtaSection />
    </>
  );
}
