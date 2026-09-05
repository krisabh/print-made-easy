import Link from "next/link";
import {
  Cable,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  Link2,
  MonitorSmartphone,
  Printer,
  ShieldCheck,
  Sparkles,
  Users,
  WifiOff,
} from "lucide-react";

import { PREMIUM_PLAN } from "@/lib/cashfree";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-[#f5f7fb]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.08),_transparent_55%)]" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-20">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Built for modern print shops
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Run Your Print Shop.
            <span className="block text-blue-700">Without the Print Chaos.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            PrintMadeEasy is print-shop management software for shopkeepers.
            Customers scan your shop QR code to submit documents; your Windows
            Agent prints them. Shopkeepers subscribe for ₹{PREMIUM_PLAN.amountInr}
            /month after a 7-day free trial — customers do not pay PrintMadeEasy.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Start Free Trial
            </Link>
            <Link
              href="/products"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Products &amp; Services
            </Link>
          </div>
          <p className="mt-5 text-sm text-slate-500">
            QR print requests • Windows Agent • Job dashboard • Documents deleted
            after 1 hour
          </p>
        </div>

        <ProductPreview />
      </div>
    </section>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/60 sm:p-4">
        <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-blue-600 uppercase">
                PrintMadeEasy
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                Clauras Print Hub
              </p>
              <p className="text-xs text-slate-500">Shop Code: PME001</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusChip tone="ok" label="Agent Connected" />
              <StatusChip tone="ok" label="Printer Connected" detail="Canon LBP6030" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Today's Jobs", "18"],
              ["Pending", "4"],
              ["Printing", "1"],
              ["Ready", "3"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-slate-200 bg-white px-3 py-3"
              >
                <p className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                  {label}
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2.5">
              <p className="text-sm font-semibold text-slate-900">Print Jobs</p>
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {[
                ["PME-000124", "Pending", "amber"],
                ["PME-000123", "Printing", "blue"],
                ["PME-000122", "Ready", "green"],
              ].map(([job, status, tone]) => (
                <li
                  key={job}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <span className="font-medium text-slate-800">{job}</span>
                  <span
                    className={
                      tone === "green"
                        ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                        : tone === "blue"
                          ? "rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                          : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                    }
                  >
                    {status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({
  tone,
  label,
  detail,
}: {
  tone: "ok" | "warn";
  label: string;
  detail?: string;
}) {
  return (
    <div
      className={`max-w-[11rem] rounded-xl px-2.5 py-1.5 text-[11px] font-medium ring-1 ${
        tone === "ok"
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-amber-50 text-amber-700 ring-amber-200"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${
            tone === "ok" ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        {label}
      </span>
      {detail ? (
        <span className="mt-0.5 block truncate font-normal opacity-80">
          {detail}
        </span>
      ) : null}
    </div>
  );
}

export function ProblemSection() {
  const items = [
    {
      icon: Users,
      title: "Orders from many places",
      body: "Walk-ins, phone requests, and shared files make it hard to keep every print request organized.",
    },
    {
      icon: ClipboardList,
      title: "Manual job tracking",
      body: "Writing down jobs or relying on memory leads to missed prints and confused handovers.",
    },
    {
      icon: MonitorSmartphone,
      title: "Constant computer checks",
      body: "Shopkeepers keep checking the printer computer to see what is waiting and what is done.",
    },
    {
      icon: WifiOff,
      title: "Unclear job status",
      body: "Pending, printing, and ready jobs get mixed up when customers ask for updates.",
    },
  ];

  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            The problem
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Running a Print Shop Shouldn&apos;t Feel Like Managing Chaos.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Print shops move fast. Without a simple workflow, jobs pile up and
            customers wait while the counter stays busy.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 shadow-sm"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-white text-blue-600 ring-1 ring-slate-200">
                <item.icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FeaturesSection({ compact = false }: { compact?: boolean }) {
  const features = [
    {
      icon: ClipboardList,
      title: "Print Job Management",
      body: "Track incoming print jobs from one shopkeeper dashboard.",
    },
    {
      icon: Cable,
      title: "Windows Print Agent",
      body: "Connect the shop computer to PrintMadeEasy and communicate with the connected printer.",
    },
    {
      icon: Printer,
      title: "Printer Status",
      body: "See whether the printer environment is available or offline.",
    },
    {
      icon: CheckCircle2,
      title: "Job Status Tracking",
      body: "Follow jobs through Pending, Printing, Ready, Delivered, and Cancelled.",
    },
    {
      icon: LayoutDashboard,
      title: "Shopkeeper Dashboard",
      body: "Get a clear overview of the day's printing activity.",
    },
    {
      icon: Link2,
      title: "Secure Shop Connection",
      body: "Connect the Windows Agent to the correct shop using a one-time connection link.",
    },
    {
      icon: Sparkles,
      title: "Simple Setup",
      body: "Install the Windows Agent and connect the shop computer without complex configuration.",
    },
    {
      icon: ShieldCheck,
      title: "Centralized Workflow",
      body: "Keep print jobs and their status organized in one place.",
    },
  ];

  const list = compact ? features.slice(0, 6) : features;

  return (
    <section id="features" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Everything a busy print shop needs to stay organized
          </h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <feature.icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
        {compact ? (
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create Your Shop
            </Link>
            <Link
              href="/features"
              className="text-sm font-semibold text-blue-700 hover:text-blue-800"
            >
              View all features →
            </Link>
          </div>
        ) : (
          <div className="mt-8">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create Your Shop
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

export function AgentOverviewSection() {
  return (
    <section className="bg-white py-14 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Windows Agent
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            Built for the computer already connected to your printer
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            After you create your shop and sign in, download the PrintMadeEasy
            Agent from the Printers page in your dashboard. Install it on the
            Windows computer connected to your printer. The Agent detects the
            available printer and keeps your shop connected.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create Your Shop
            </Link>
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Shopkeeper Login
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-[#f5f7fb] p-6 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">
            What the Agent does
          </h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Connects your shop computer to PrintMadeEasy
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Automatically detects the available printer
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Reports printer availability to the dashboard
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Uses a secure one-time connection link for pairing
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" className="border-y border-slate-200 bg-[#f5f7fb] py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold tracking-[0.14em] text-blue-700 uppercase">
            Pricing
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Simple pricing for growing print shops
          </h2>
          <p className="mt-4 text-base text-slate-600">
            <span className="font-medium text-slate-800">PrintMadeEasy</span>{" "}
            Premium is{" "}
            <span className="font-medium text-slate-800">
              ₹{PREMIUM_PLAN.amountInr}/month (INR)
            </span>{" "}
            after a 7-day free trial. Only shopkeepers pay PrintMadeEasy —
            customers who submit documents via the shop QR code do not pay
            PrintMadeEasy.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-blue-700">Start Free</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">
              7-day free trial
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Included when you create your shop.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-slate-600">
              {[
                "Full access to shop features",
                "Connect your Windows Agent",
                "Manage print jobs",
                "Printer status in the dashboard",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Start Free Trial
            </Link>
          </article>

          <article className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm ring-1 ring-blue-100">
            <p className="text-sm font-semibold text-blue-700">
              PrintMadeEasy Premium
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">
              ₹{PREMIUM_PLAN.amountInr}
              <span className="text-base font-medium text-slate-500">
                {" "}
                / month (INR)
              </span>
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Paid by the shopkeeper after the free trial for full Premium
              access. Customers do not pay PrintMadeEasy.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-slate-600">
              {[
                "Add printers and manage jobs",
                "Windows Agent connectivity",
                "Dashboard job tracking",
                "Cancel anytime from My Plan / Billing",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Start Free Trial
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}

export function FinalCtaSection() {
  return (
    <section className="bg-blue-700 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Ready to Make Your Print Shop Simpler?
        </h2>
        <p className="mt-4 text-base text-blue-100">
          Set up your shop and start managing your print workflow with
          PrintMadeEasy.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Start Free Trial
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/30 px-6 text-sm font-semibold text-white hover:bg-white/10"
          >
            Shopkeeper Login
          </Link>
        </div>
      </div>
    </section>
  );
}
