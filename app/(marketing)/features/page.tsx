import type { Metadata } from "next";
import Link from "next/link";

import { FeaturesSection, FinalCtaSection } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Explore PrintMadeEasy features for print job management, Windows Agent connectivity, printer status, and shopkeeper workflows.",
};

export default function FeaturesPage() {
  return (
    <>
      <section className="border-b border-slate-200 bg-[#f5f7fb] py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Features
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            Built for everyday print shop work
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">
            PrintMadeEasy focuses on the practical tools shopkeepers already
            need: job tracking, Agent connectivity, printer status, and a clear
            dashboard.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Create Your Shop
          </Link>
        </div>
      </section>
      <FeaturesSection />
      <FinalCtaSection />
    </>
  );
}
