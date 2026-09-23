import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  Printer,
  QrCode,
  ShieldCheck,
  SlidersHorizontal,
  SunMedium,
} from "lucide-react";

import { FinalCtaSection } from "@/components/marketing/sections";
import { getCurrentPremiumPriceInr, getCurrentTrialOffer } from "@/lib/admin-settings";
import { MARKETING_CORE_FEATURES } from "@/lib/marketing-features";
import { SITE } from "@/lib/marketing";

export async function generateMetadata(): Promise<Metadata> {
  const [premiumPriceInr, trial] = await Promise.all([
    getCurrentPremiumPriceInr(),
    getCurrentTrialOffer(),
  ]);
  const trialBit =
    trial.enabled && trial.days > 0
      ? ` after a ${trial.days}-day free trial`
      : "";
  return {
    title: "Products & Services",
    description: `PrintYantra provides print-shop management software with QR upload, preview & adjust, brightness & scale, auto print, and temporary document storage for ₹${premiumPriceInr}/month.`,
    alternates: {
      canonical: "/products",
    },
    openGraph: {
      title: "PrintYantra — Products & Services",
      description: `Online printing management software for local print shops. Shopkeepers subscribe for ₹${premiumPriceInr}/month${trialBit}.`,
      url: `${SITE.url}/products`,
    },
  };
}

const CAPABILITY_ICONS = {
  "scan-qr-upload": QrCode,
  "preview-adjust": SlidersHorizontal,
  "brightness-scale": SunMedium,
  "auto-print": Printer,
  "privacy-auto-delete": ShieldCheck,
  "simple-print-management": LayoutDashboard,
} as const;

export default async function ProductsPage() {
  const [premiumPriceInr, trial] = await Promise.all([
    getCurrentPremiumPriceInr(),
    getCurrentTrialOffer(),
  ]);
  return (
    <>
      <section className="border-b border-slate-200 bg-[#f5f7fb] py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Products &amp; Services
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            Products &amp; Services
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">
            {SITE.relationship} PrintYantra is software for print-shop owners,
            not a marketplace selling prints to end customers.
          </p>
        </div>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold text-blue-700">
                  Primary service
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                  PrintYantra
                </h2>
                <p className="mt-2 text-lg text-slate-700">
                  Online Printing Management for Local Print Shops
                </p>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">
                  PrintYantra helps print shops accept customer print requests
                  through QR codes, let customers preview and adjust documents,
                  print automatically, and keep jobs organized — with temporary
                  document storage and automatic deletion after the configured
                  storage period.
                </p>
              </div>

              <div className="w-full shrink-0 rounded-2xl border border-blue-200 bg-blue-50/60 p-5 lg:w-72">
                <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">
                  Subscription pricing (INR)
                </p>
                <p className="mt-3 text-3xl font-semibold text-slate-900">
                  ₹{premiumPriceInr}
                  <span className="text-base font-medium text-slate-600">
                    {" "}
                    / month
                  </span>
                </p>
                <p className="mt-2 text-sm font-medium text-slate-800">
                  {trial.enabled ? `${trial.days}-day free trial` : "No free trial"}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                  Paid by the shopkeeper. Customers do not pay PrintYantra for
                  submitting print jobs.
                </p>
                <Link
                  href="/signup"
                  className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {trial.enabled ? "Start Free Trial" : "Sign up"}
                </Link>
                <Link
                  href="/pricing"
                  className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium text-blue-700 hover:underline"
                >
                  View full pricing
                </Link>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MARKETING_CORE_FEATURES.map((item) => {
                const Icon = CAPABILITY_ICONS[item.id];
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <div className="flex size-9 items-center justify-center rounded-lg bg-white text-blue-700 ring-1 ring-slate-200">
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    <h3 className="mt-3 text-sm font-semibold text-slate-900">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                      {item.body}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 grid gap-4 rounded-xl border border-slate-200 bg-[#f8fafc] p-5 sm:grid-cols-2">
              <div className="flex gap-3">
                <CheckCircle2
                  className="mt-0.5 size-5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <p className="text-sm leading-relaxed text-slate-700">
                  <span className="font-semibold text-slate-900">
                    Who pays PrintYantra:
                  </span>{" "}
                  PrintYantra&apos;s subscription is paid by the shopkeeper.
                  Customers do not pay PrintYantra for submitting print jobs.
                </p>
              </div>
              <div className="flex gap-3">
                <Clock3
                  className="mt-0.5 size-5 shrink-0 text-blue-600"
                  aria-hidden="true"
                />
                <p className="text-sm leading-relaxed text-slate-700">
                  <span className="font-semibold text-slate-900">
                    Document retention:
                  </span>{" "}
                  Customer documents are stored temporarily for printing and
                  automatically deleted after the configured storage period.
                </p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <FinalCtaSection trialEnabled={trial.enabled} />
    </>
  );
}
