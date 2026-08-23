import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for PrintMadeEasy.",
};

export default function TermsPage() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: August 23, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-slate-600">
          <p>
            By using PrintMadeEasy, you agree to use the platform for lawful
            print-shop operations and to keep your account credentials secure.
          </p>
          <p>
            Shopkeepers are responsible for the documents they process, the
            printers connected through the Windows Agent, and the accuracy of
            shop information.
          </p>
          <p>
            Subscriptions, trials, and billing are managed through the product
            settings and payment providers configured for your account.
          </p>
          <p>
            This page is a placeholder terms summary. More detailed terms may be
            published later. For questions, use the Contact page.
          </p>
        </div>
      </div>
    </section>
  );
}
