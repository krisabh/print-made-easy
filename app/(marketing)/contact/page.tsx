import type { Metadata } from "next";
import Link from "next/link";

import { WhatsAppIconLink } from "@/components/marketing/whatsapp-floating-button";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Contact PrintMadeEasy about your print shop subscription, Windows Agent setup, billing questions, or product support.",
  alternates: {
    canonical: "/contact",
  },
};

export default function ContactPage() {
  return (
    <section className="bg-[#f5f7fb] py-14 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
          Contact Us
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
          Contact Us
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          Reach PrintMadeEasy for product questions, shopkeeper onboarding,
          Windows Agent help, or billing and cancellation questions. We support
          print-shop owners who subscribe to PrintMadeEasy software.
        </p>

        <div className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Email
            </p>
            <a
              href={SITE.emailHref}
              className="mt-1 inline-block break-all text-base font-medium text-blue-700 underline-offset-2 hover:text-blue-800 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {SITE.email}
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              WhatsApp
            </p>
            <p className="mt-1 text-sm text-slate-600">{SITE.whatsappDisplay}</p>
            <div className="mt-2">
              <WhatsAppIconLink />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Website
            </p>
            <a
              href={SITE.url}
              className="mt-1 inline-block text-base font-medium text-blue-700 hover:underline"
            >
              {SITE.url}
            </a>
          </div>
        </div>

        <p className="mt-6 text-sm text-slate-500">
          Related policies:{" "}
          <Link href="/refunds" className="font-medium text-blue-700 hover:underline">
            Refund &amp; Cancellation Policy
          </Link>
          {" · "}
          <Link href="/terms" className="font-medium text-blue-700 hover:underline">
            Terms &amp; Conditions
          </Link>
          {" · "}
          <Link href="/privacy" className="font-medium text-blue-700 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </section>
  );
}
