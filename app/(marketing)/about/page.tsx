import type { Metadata } from "next";
import Link from "next/link";

import {
  BrandHierarchy,
  RegistrationDetails,
} from "@/components/marketing/company-identity";
import { FinalCtaSection } from "@/components/marketing/sections";
import { getCurrentPremiumPriceInr, getCurrentTrialOffer } from "@/lib/admin-settings";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "About",
  description:
    "About PrintYantra — a Clauras product powered by Ramyad Enterprises - Abhiram. Registered enterprise details and contact.",
};

export default async function AboutPage() {
  const [premiumPriceInr, trial] = await Promise.all([
    getCurrentPremiumPriceInr(),
    getCurrentTrialOffer(),
  ]);
  return (
    <>
      <section className="border-b border-slate-200 bg-[#f5f7fb] py-14">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            About PrintYantra
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            Print-management software for local shops
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-600">
            PrintYantra is a print-management platform designed to help local
            print shops receive, manage, and print customer documents more
            easily. Shopkeepers use a dashboard, QR-based customer submissions,
            and a PrintYantra Agent from one place.
          </p>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Customers do not pay PrintYantra — they use the shop&apos;s QR
            code to submit documents. Pricing is ₹{premiumPriceInr}/month (INR)
            {trial.enabled
              ? ` after a ${trial.days}-day free trial`
              : " with no free trial"}
            . Uploaded documents are automatically deleted after 1
            hour.
          </p>

          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Our Business
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              {SITE.relationship}
            </p>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              Ramyad Enterprises - Abhiram is a registered enterprise. The
              details below are provided for transparency.
            </p>
            <div className="mt-6 border-t border-slate-100 pt-6">
              <RegistrationDetails />
            </div>
            <p className="mt-6 text-xs leading-relaxed text-slate-500">
              Udyam and GST registrations identify the registered enterprise.
              They do not mean government endorsement of PrintYantra.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              [
                "What it is",
                "Software for print shops to accept and manage customer print jobs.",
              ],
              [
                "Who operates it",
                "A Clauras product, powered by Ramyad Enterprises - Abhiram.",
              ],
              [
                "How to reach us",
                "Email, phone, and WhatsApp details are listed on Contact Us.",
              ],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
                <p className="mt-2 text-sm text-slate-600">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/contact"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Contact Us
            </Link>
            <Link
              href="/products"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Products &amp; Services
            </Link>
          </div>

          <div className="mt-10">
            <BrandHierarchy />
          </div>
        </div>
      </section>
      <FinalCtaSection trialEnabled={trial.enabled} />
    </>
  );
}
