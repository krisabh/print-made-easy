import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Forgot your password?
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Enter your registered email address and we&apos;ll send you a secure
          password reset link.
        </p>
        <div className="mt-6">
          <ForgotPasswordForm />
        </div>
      </div>
    </main>
  );
}
