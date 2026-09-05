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
            PrintMadeEasy is print-shop management software for local print
            shops. Shopkeepers subscribe to run QR-based customer print
            submissions, a Windows Print Agent, job tracking, and printer
            management from one dashboard.
          </p>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Customers do not pay PrintMadeEasy — they use the shop&apos;s QR
            code to submit documents. Pricing is ₹199/month (INR) after a 7-day
            free trial. Uploaded documents are automatically deleted after 1
            hour.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ["For shopkeepers", "Software subscription paid by the print shop."],
              ["QR + Agent workflow", "Customers submit; the Windows Agent prints."],
              ["Clear policies", "Pricing, Terms, Refunds, and Contact are public."],
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
              href="/products"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Products &amp; Services
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>
      <FinalCtaSection />
    </>
  );
}
