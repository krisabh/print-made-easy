import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 p-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          Print Made Easy
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Shopkeeper dashboard for automated print shops.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Shopkeeper Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Create your shop
          </Link>
        </div>
      </div>
    </main>
  );
}
