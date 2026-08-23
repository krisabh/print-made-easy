import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for PrintMadeEasy.",
};

export default function PrivacyPage() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: August 23, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-slate-600">
          <p>
            PrintMadeEasy provides a shopkeeper platform for managing print
            shops, print jobs, and Windows Agent connections.
          </p>
          <p>
            Account information such as name, email, shop details, and
            subscription status is used to operate the service. Print job and
            document data is processed to deliver printing workflows for your
            shop.
          </p>
          <p>
            We do not sell personal information. Access to shop data is limited
            to authenticated shopkeepers and authorized platform operations.
          </p>
          <p>
            This page is a placeholder policy summary. A more detailed legal
            policy may be published as the product expands. For privacy
            questions, use the Contact page.
          </p>
        </div>
      </div>
    </section>
  );
}
