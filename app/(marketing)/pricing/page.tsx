import type { Metadata } from "next";
import Link from "next/link";

import { RegistrationDetails } from "@/components/marketing/company-identity";
import {
  FinalCtaSection,
  PricingSection,
} from "@/components/marketing/sections";
import { PREMIUM_PLAN } from "@/lib/cashfree";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Pricing",
  description: `PrintYantra Premium is ₹${PREMIUM_PLAN.amountInr}/month (INR) for print-shop owners after a 7-day free trial. Customers who submit print jobs do not pay PrintYantra.`,
  alternates: {
    canonical: "/pricing",
  },
  openGraph: {
    title: "PrintYantra Pricing — ₹199/month",
    description:
      "Shopkeeper subscription software for local print shops. 7-day free trial, then ₹199/month (INR).",
    url: `${SITE.url}/pricing`,
  },
};

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-slate-200 bg-white py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Pricing
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            PrintYantra pricing
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">
            Clear software subscription pricing for print-shop owners
            (shopkeepers). Amounts are shown in Indian Rupees (INR).
          </p>

          <div className="mt-8 max-w-xl rounded-2xl border border-blue-200 bg-blue-50/50 p-6">
            <p className="text-sm font-semibold text-blue-700">PrintYantra</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              ₹{PREMIUM_PLAN.amountInr}
              <span className="text-lg font-medium text-slate-600">
                {" "}
                / month
              </span>
            </p>
            <p className="mt-2 text-sm font-medium text-slate-800">
              7-day free trial
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Subscription for shopkeepers / print-shop owners who use
              PrintYantra software to run their shop.
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Start Free Trial
            </Link>
          </div>

          <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Shopkeeper
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Pays ₹{PREMIUM_PLAN.amountInr}/month subscription to
                PrintYantra (after the free trial) for software access,
                dashboard, QR workflow, and Windows Agent connectivity.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-5">
              <h2 className="text-sm font-semibold text-slate-900">Customer</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Uses the shop&apos;s QR code to submit documents for printing.
                Does not pay PrintYantra. Any print charges at the counter are
                between the customer and the shop, not PrintYantra.
              </p>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-sm text-slate-500">
            Related:{" "}
            <Link href="/products" className="font-medium text-blue-700 hover:underline">
              Products &amp; Services
            </Link>
            {" · "}
            <Link href="/refunds" className="font-medium text-blue-700 hover:underline">
              Refund &amp; Cancellation Policy
            </Link>
            {" · "}
            <Link href="/terms" className="font-medium text-blue-700 hover:underline">
              Terms &amp; Conditions
            </Link>
          </p>

          <aside className="mt-10 max-w-xl rounded-2xl border border-slate-200 bg-[#f8fafc] p-5 sm:p-6">
            <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Built by a registered business
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {SITE.relationship}
            </p>
            <div className="mt-4 border-t border-slate-200 pt-4">
              <RegistrationDetails compact />
            </div>
            <p className="mt-4 text-xs text-slate-500">
              <Link href="/about" className="font-medium text-blue-700 hover:underline">
                More about our business
              </Link>
            </p>
          </aside>
        </div>
      </section>
      <PricingSection />
      <FinalCtaSection />
    </>
  );
}
