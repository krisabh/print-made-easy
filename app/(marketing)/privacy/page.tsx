import type { Metadata } from "next";
import Link from "next/link";

import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for PrintMadeEasy — how we handle shopkeeper account data and customer print documents.",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: September 5, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-slate-600">
          <p>
            PrintMadeEasy ({SITE.url}) provides print-shop management software
            for shopkeepers. This Privacy Policy explains what information we
            process to operate the service.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Information we process
          </h2>
          <p>
            Account information such as name, email, shop details, and
            subscription/billing status is used to operate shopkeeper accounts
            and Premium subscriptions. Print job metadata and uploaded document
            files are processed so a shop can receive and print customer
            submissions.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Document retention
          </h2>
          <p>
            Uploaded customer documents are automatically deleted from
            PrintMadeEasy servers after 1 hour. Job history may remain visible to
            the shopkeeper after the files are removed.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Who we share with
          </h2>
          <p>
            We do not sell personal information. Access to shop data is limited
            to authenticated shopkeepers for their own shop and to authorized
            platform operations needed to run PrintMadeEasy (including payment
            processing through our payment provider for shopkeeper
            subscriptions).
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            Contact
          </h2>
          <p>
            For privacy questions, use{" "}
            <Link href="/contact" className="font-medium text-blue-700 hover:underline">
              Contact Us
            </Link>{" "}
            or email{" "}
            <a href={SITE.emailHref} className="font-medium text-blue-700 hover:underline">
              {SITE.email}
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
