import type { Metadata } from "next";
import Link from "next/link";

import { FinalCtaSection } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "About",
  description:
    "PrintMadeEasy is designed to help print shops move from manual print-job handling toward a more organized digital workflow.",
};

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-slate-200 bg-[#f5f7fb] py-14">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            About
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            Built to Make Print Shops Simpler
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-600">
            PrintMadeEasy is designed to help print shops move from manual
            print-job handling toward a more organized digital workflow.
          </p>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            We focus on simplicity, reliability, and practical automation —
            helping small businesses adopt technology without complicated setup.
            The product connects your shop dashboard with a Windows Agent on the
            computer that already runs your printer.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ["Simplicity", "Clear steps for busy shopkeepers."],
              ["Reliability", "Live Agent and printer status in the dashboard."],
              ["Practical automation", "Jobs stay organized from pending to ready."],
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
          <Link
            href="/contact"
            className="mt-8 inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Contact Us
          </Link>
        </div>
      </section>
      <FinalCtaSection />
    </>
  );
}
