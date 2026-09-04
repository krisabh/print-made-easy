import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refunds & Cancellations",
  description:
    "Refund and cancellation policy for PrintMadeEasy Premium (₹199/month).",
};

export default function RefundsPage() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Refunds &amp; Cancellations
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: September 5, 2026</p>

        <div className="mt-8 space-y-5 text-sm leading-relaxed text-slate-600">
          <p>
            PrintMadeEasy is a software subscription for print shop owners
            (shopkeepers). Customers who upload documents to a shop do not pay
            PrintMadeEasy through this billing system.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            PrintMadeEasy Premium
          </h2>
          <p>
            Premium is priced at{" "}
            <span className="font-medium text-slate-800">₹199 (INR) per month</span>{" "}
            after a 7-day free trial. Payment is collected from the shopkeeper
            for access to PrintMadeEasy Premium features.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Cancellations
          </h2>
          <p>
            You may stop renewing Premium at any time from{" "}
            <span className="font-medium text-slate-800">My Plan / Billing</span>{" "}
            in your shopkeeper dashboard (or by contacting us if you need help).
          </p>
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

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Refunds
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
            The 7-day free trial is intended so you can evaluate PrintMadeEasy
            before purchasing Premium.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            How to request help
          </h2>
          <p>
            For billing questions, cancellation help, or a refund request related
            to a billing error, contact us through the{" "}
            <Link href="/contact" className="font-medium text-blue-700 hover:underline">
              Contact
            </Link>{" "}
            page. Please include your shop name or shop code and the payment date
            so we can review your request.
          </p>

          <p className="pt-2">
            Related pages:{" "}
            <Link href="/terms" className="font-medium text-blue-700 hover:underline">
              Terms of Service
            </Link>
            {" · "}
            <Link href="/pricing" className="font-medium text-blue-700 hover:underline">
              Pricing
            </Link>
            {" · "}
            <Link href="/privacy" className="font-medium text-blue-700 hover:underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
