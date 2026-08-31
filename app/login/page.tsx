import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; reset?: string }>;
};

function safeNextPath(raw: string | undefined) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const resetSuccess = params.reset === "success";
  const session = await getCurrentUser();
  if (session) {
    redirect(nextPath || "/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Shopkeeper Login
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Sign in to manage your print shop.
        </p>
        {resetSuccess ? (
          <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Your password has been reset successfully. Sign in with your new
            password.
          </p>
        ) : null}
        <div className="mt-6">
          <LoginForm nextPath={nextPath} />
        </div>
      </div>
    </main>
  );
}
