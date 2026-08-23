import type { Metadata } from "next";

import { WhatsAppIconLink } from "@/components/marketing/whatsapp-floating-button";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact PrintMadeEasy about your print shop, Windows Agent setup, or product questions.",
};

export default function ContactPage() {
  return (
    <section className="bg-[#f5f7fb] py-14 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
          Contact
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
          Contact PrintMadeEasy
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          We&apos;d love to hear from print shop owners, operators, and
          businesses interested in PrintMadeEasy.
        </p>

        <div className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Email
            </p>
            <a
              href="mailto:abhiram12sep@gmail.com"
              className="mt-1 inline-block break-all text-base font-medium text-blue-700 underline-offset-2 hover:text-blue-800 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              abhiram12sep@gmail.com
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
    </section>
  );
}
