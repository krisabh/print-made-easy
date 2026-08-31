import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { findValidPasswordResetToken } from "@/lib/password-reset";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token?.trim() || "";

  let tokenError: string | null = null;
  if (!token) {
    tokenError = "This reset link is missing or invalid. Request a new one.";
  } else {
    const found = await findValidPasswordResetToken({ rawToken: token });
    if (!found.ok) {
      tokenError =
        found.reason === "expired"
          ? "This reset link has expired. Request a new one."
          : found.reason === "used"
            ? "This reset link has already been used. Request a new one."
            : "This reset link is invalid. Request a new one.";
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Reset your password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Choose a new password for your PrintMadeEasy account.
        </p>

        <div className="mt-6">
          {tokenError ? (
            <div className="space-y-4">
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {tokenError}
              </p>
              <p className="text-center text-sm text-slate-500">
                <Link
                  href="/forgot-password"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Request a new reset link
                </Link>
                {" · "}
                <Link
                  href="/login"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Back to Login
                </Link>
              </p>
            </div>
          ) : (
            <ResetPasswordForm token={token} />
          )}
        </div>
      </div>
    </main>
  );
}
