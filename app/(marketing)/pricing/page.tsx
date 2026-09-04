import type { Metadata } from "next";

import {
  FinalCtaSection,
  PricingSection,
} from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start with a 7-day free trial, then continue with PrintMadeEasy Premium for organized print shop management.",
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
            Simple pricing for growing print shops
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">
            PrintMadeEasy Premium is{" "}
            <span className="font-medium text-slate-800">₹199 per month (INR)</span>{" "}
            after a 7-day free trial. Only shopkeepers pay PrintMadeEasy;
            customers do not pay through this billing.
          </p>
        </div>
      </section>
      <PricingSection />
      <FinalCtaSection />
    </>
  );
}
