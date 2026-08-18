import { redirect } from "next/navigation";

import { SignupForm } from "@/components/auth/signup-form";
import { getCurrentUser } from "@/lib/auth";

export default async function SignupPage() {
  const session = await getCurrentUser();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Create your shop
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Set up your PrintMadeEasy shopkeeper account.
        </p>
        <div className="mt-6">
          <SignupForm />
        </div>
      </div>
    </main>
  );
}
