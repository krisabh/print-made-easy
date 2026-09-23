import type { Metadata } from "next";
import Link from "next/link";

import { RegistrationDetails } from "@/components/marketing/company-identity";
import {
  FinalCtaSection,
  PricingSection,
} from "@/components/marketing/sections";
import { getCurrentPremiumPriceInr, getCurrentTrialOffer } from "@/lib/admin-settings";
import { SITE } from "@/lib/marketing";

export async function generateMetadata(): Promise<Metadata> {
  const [premiumPriceInr, trial] = await Promise.all([
    getCurrentPremiumPriceInr(),
    getCurrentTrialOffer(),
  ]);
  const trialBit =
    trial.enabled && trial.days > 0
      ? `after a ${trial.days}-day free trial`
      : "with no free trial";
  return {
    title: "Pricing",
    description: `PrintYantra Premium is ₹${premiumPriceInr}/month (INR) for print-shop owners ${trialBit}. Customers who submit print jobs do not pay PrintYantra.`,
    alternates: {
      canonical: "/pricing",
    },
    openGraph: {
      title: `PrintYantra Pricing — ₹${premiumPriceInr}/month`,
      description: `Shopkeeper subscription software for local print shops. ${trial.enabled ? `${trial.days}-day free trial, then ` : ""}₹${premiumPriceInr}/month (INR).`,
      url: `${SITE.url}/pricing`,
    },
  };
}

export default async function PricingPage() {
  const [premiumPriceInr, trial] = await Promise.all([
    getCurrentPremiumPriceInr(),
    getCurrentTrialOffer(),
  ]);
  const offer = {
    premiumPriceInr,
    trialEnabled: trial.enabled,
    trialDays: trial.days,
  };
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
              ₹{premiumPriceInr}
              <span className="text-lg font-medium text-slate-600">
                {" "}
                / month
              </span>
            </p>
            <p className="mt-2 text-sm font-medium text-slate-800">
              {trial.enabled ? `${trial.days}-day free trial` : "No free trial"}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Subscription for shopkeepers / print-shop owners who use
              PrintYantra software to run their shop.
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {trial.enabled ? "Start Free Trial" : "Sign up"}
            </Link>
          </div>

          <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Shopkeeper
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Pays ₹{premiumPriceInr}/month subscription to
                PrintYantra{trial.enabled ? " (after the free trial)" : ""} for software access,
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
      <PricingSection {...offer} />
      <FinalCtaSection trialEnabled={trial.enabled} />
    </>
  );
}
