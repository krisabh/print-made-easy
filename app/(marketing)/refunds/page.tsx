import type { Metadata } from "next";
import Link from "next/link";

import { PREMIUM_PLAN } from "@/lib/cashfree";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "Refund and cancellation policy for PrintMadeEasy Premium (₹199/month) for print-shop owners.",
  alternates: {
    canonical: "/refunds",
  },
};

export default function RefundsPage() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Refund &amp; Cancellation Policy
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: September 5, 2026</p>

        <div className="mt-8 space-y-5 text-sm leading-relaxed text-slate-600">
          <p>
            This policy explains how shopkeepers can cancel PrintMadeEasy
            Premium, what happens after cancellation, how the free trial works,
            and how refunds and billing questions are handled.
          </p>
          <p>
            PrintMadeEasy is a software subscription for print-shop owners
            (shopkeepers). Customers who upload documents to a shop do not pay
            PrintMadeEasy through this billing system.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Subscription and trial
          </h2>
          <p>
            Premium is priced at{" "}
            <span className="font-medium text-slate-800">
              ₹{PREMIUM_PLAN.amountInr} (INR) per month
            </span>{" "}
            after a{" "}
            <span className="font-medium text-slate-800">7-day free trial</span>.
            The trial lets you evaluate PrintMadeEasy before purchasing Premium.
            If you do not pay for Premium after the trial ends, Premium access
            ends according to the product&apos;s entitlement rules.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            How to cancel
          </h2>
          <p>
            You may cancel or stop renewing Premium at any time from{" "}
            <span className="font-medium text-slate-800">My Plan / Billing</span>{" "}
            in your shopkeeper dashboard. If you need help, contact us using the
            details below.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            What happens after cancellation
          </h2>
          <p>
            For one-time monthly payments, Premium access continues until the end
            of the paid period you already purchased. After that period ends,
            Premium access expires unless you pay again for another month.
          </p>
          <p>
            If recurring subscription billing is enabled for your account,
            cancellation typically takes effect at the end of the current paid
            period, and you keep access until that date.
          </p>
          <p>
            Cancellation stops future Premium renewals for that billing path. It
            does not by itself create an automatic refund for time already paid.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Refund policy
          </h2>
          <p>
            Because Premium provides immediate digital access for a defined
            billing period, payments are generally{" "}
            <span className="font-medium text-slate-800">non-refundable</span>{" "}
            once the paid period has started, except where required by applicable
            law or where we determine a refund is appropriate (for example, a
            verified duplicate charge or a clear billing error).
          </p>
          <p>
            We do not promise automatic refunds for unused days within a paid
            month, change of mind after purchase, or shop downtime caused by
            local printers, Windows, internet, or Agent setup issues.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Failed or incomplete payments
          </h2>
          <p>
            If a payment attempt fails or is not completed, Premium access is not
            granted (or not renewed) for that unpaid period. You may retry
            payment from My Plan / Billing when you are ready. Pending or failed
            payment attempts do not create a completed charge that requires a
            refund.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Billing disputes and questions
          </h2>
          <p>
            For billing questions, cancellation help, or a refund request related
            to a suspected billing error, contact us through the{" "}
            <Link href="/contact" className="font-medium text-blue-700 hover:underline">
              Contact Us
            </Link>{" "}
            page, email{" "}
            <a href={SITE.emailHref} className="font-medium text-blue-700 hover:underline">
              {SITE.email}
            </a>
            , or WhatsApp via the contact details on that page. Please include
            your shop name or shop code and the payment date so we can review
            your request.
          </p>

          <p className="pt-2">
            Related pages:{" "}
            <Link href="/terms" className="font-medium text-blue-700 hover:underline">
              Terms &amp; Conditions
            </Link>
            {" · "}
            <Link href="/pricing" className="font-medium text-blue-700 hover:underline">
              Pricing
            </Link>
            {" · "}
            <Link href="/privacy" className="font-medium text-blue-700 hover:underline">
              Privacy Policy
            </Link>
            {" · "}
            <Link href="/products" className="font-medium text-blue-700 hover:underline">
              Products &amp; Services
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
