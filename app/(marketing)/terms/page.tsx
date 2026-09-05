import type { Metadata } from "next";
import Link from "next/link";

import { PREMIUM_PLAN } from "@/lib/cashfree";
import { SITE } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "Terms & Conditions for PrintMadeEasy print-shop management software, including shopkeeper subscription, trial, and acceptable use.",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Terms &amp; Conditions
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: September 5, 2026</p>

        <div className="mt-8 space-y-5 text-sm leading-relaxed text-slate-600">
          <p>
            These Terms &amp; Conditions (&quot;Terms&quot;) govern access to and
            use of PrintMadeEasy ({SITE.url}), a print-shop management software
            platform operated for shopkeepers and print-shop owners.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            1. The service
          </h2>
          <p>
            PrintMadeEasy provides software that helps print shops accept
            customer print requests through QR codes, receive uploaded
            documents, manage print jobs, connect a Windows Print Agent, work
            with printers on the shop computer, configure supported print
            settings, and monitor Agent/printer availability.
          </p>
          <p>
            PrintMadeEasy is not a consumer print marketplace and does not sell
            physical printouts to end customers. End customers interact with a
            shop&apos;s QR upload flow to submit documents to that shop.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            2. Who pays PrintMadeEasy
          </h2>
          <p>
            The PrintMadeEasy subscription is paid by the shopkeeper (print-shop
            owner/operator). Customers who submit documents through a shop QR
            code do not pay PrintMadeEasy for submitting print jobs.
          </p>
          <p>
            Premium access is priced at{" "}
            <span className="font-medium text-slate-800">
              ₹{PREMIUM_PLAN.amountInr} (INR) per month
            </span>{" "}
            after a{" "}
            <span className="font-medium text-slate-800">7-day free trial</span>,
            unless we communicate a different offer in writing for your account.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            3. Accounts and responsibilities
          </h2>
          <p>
            You must provide accurate shop and account information and keep your
            login credentials secure. You are responsible for activity under your
            account, for the documents processed through your shop, for printers
            connected via the Windows Agent, and for compliance with applicable
            law when operating your print business.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            4. Acceptable use
          </h2>
          <p>
            You agree to use PrintMadeEasy only for lawful print-shop operations.
            You must not upload or process unlawful content, attempt to disrupt
            the service, misuse Agent/pairing links, or access another shop&apos;s
            data without authorization.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            5. Documents and data handling
          </h2>
          <p>
            Uploaded customer documents are processed to deliver printing
            workflows for your shop. Uploaded document files are automatically
            deleted from PrintMadeEasy servers after 1 hour. Job history may
            remain available in the shopkeeper dashboard after files are removed.
            Account and billing information is used to operate the subscription
            service. See our{" "}
            <Link href="/privacy" className="font-medium text-blue-700 hover:underline">
              Privacy Policy
            </Link>{" "}
            for more detail.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            6. Service limitations
          </h2>
          <p>
            PrintMadeEasy depends on your internet connectivity, Windows
            computer, Agent installation, printer drivers, and local printer
            hardware. We do not guarantee uninterrupted availability, successful
            physical print output in every environment, or compatibility with
            every printer model. Features are limited to what the product
            currently supports.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            7. Trial, subscription, cancellation, and termination
          </h2>
          <p>
            New shops may receive a 7-day free trial as offered in the product.
            After the trial, continued Premium access requires payment of the
            applicable subscription fee. You may cancel or stop renewing from My
            Plan / Billing in the shopkeeper dashboard, subject to the{" "}
            <Link href="/refunds" className="font-medium text-blue-700 hover:underline">
              Refund &amp; Cancellation Policy
            </Link>
            . We may suspend or terminate access for non-payment, abuse, or
            material breach of these Terms.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            8. Intellectual property
          </h2>
          <p>
            PrintMadeEasy software, branding, and related materials remain the
            property of PrintMadeEasy and its licensors. Your subscription grants
            a limited right to use the service for your shop during an active
            trial or paid period. You retain rights to content you upload,
            subject to the processing needed to provide the service.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            9. Limitation of liability
          </h2>
          <p>
            To the fullest extent permitted by applicable law, PrintMadeEasy is
            not liable for indirect, incidental, or consequential damages arising
            from use of the service, including print failures, downtime, or
            business interruption. Our aggregate liability related to the
            service is limited to the amounts you paid to PrintMadeEasy for the
            subscription period giving rise to the claim, except where liability
            cannot be limited by law.
          </p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">
            10. Changes and contact
          </h2>
          <p>
            We may update these Terms from time to time by posting a revised
            version on this page with an updated date. Continued use after
            changes take effect constitutes acceptance of the updated Terms.
          </p>
          <p>
            Questions about these Terms:{" "}
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
