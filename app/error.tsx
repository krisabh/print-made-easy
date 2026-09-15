"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-zinc-900">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-center text-sm text-zinc-600">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white"
      >
        Try again
      </button>
    </div>
  );
}
