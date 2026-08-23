import type { Metadata } from "next";

import {
  PrivacyWorkflowSection,
  ProductWorkflowSection,
} from "@/components/marketing/product-workflow";
import {
  AgentOverviewSection,
  FinalCtaSection,
} from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "See how shopkeepers and customers use PrintMadeEasy — from shop QR setup to upload, live status, printing, and automatic document deletion after 1 hour.",
};

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-slate-200 bg-[#f5f7fb] py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            How it works
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            From shop setup to customer pickup
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">
            Two simple journeys — one for shopkeepers, one for customers —
            connected by PrintMadeEasy.
          </p>
        </div>
      </section>
      <ProductWorkflowSection />
      <PrivacyWorkflowSection />
      <AgentOverviewSection />
      <FinalCtaSection />
    </>
  );
}
