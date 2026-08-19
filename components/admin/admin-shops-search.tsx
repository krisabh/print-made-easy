import Link from "next/link";

type AdminShopsSearchProps = {
  initialSearch: string;
};

export function AdminShopsSearch({ initialSearch }: AdminShopsSearchProps) {
  return (
    <form
      method="get"
      action="/admin/shops"
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <input
        type="search"
        name="search"
        defaultValue={initialSearch}
        placeholder="Search shop, code or owner..."
        className="h-11 w-full flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none ring-blue-600 placeholder:text-slate-400 focus:ring-2"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Search
        </button>
        {initialSearch ? (
          <Link
            href="/admin/shops"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
