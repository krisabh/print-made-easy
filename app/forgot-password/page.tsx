import Link from "next/link";

import { SITE } from "@/lib/marketing";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Forgot Password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Automated password reset email is not available yet. Contact support
          and we will help you regain access to your shop account securely.
        </p>

        <div className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Email
            </p>
            <a
              href={SITE.emailHref}
              className="mt-1 inline-block break-all text-sm font-medium text-blue-700 hover:underline"
            >
              {SITE.email}
            </a>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              WhatsApp
            </p>
            <a
              href={SITE.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-sm font-medium text-blue-700 hover:underline"
            >
              {SITE.whatsappDisplay}
            </a>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          For your security, include the email address registered on your
          PrintMadeEasy account when you contact us. Never share your password
          in chat or email.
        </p>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-blue-600 hover:underline">
            Back to Login
          </Link>
        </p>
      </div>
    </main>
  );
}
