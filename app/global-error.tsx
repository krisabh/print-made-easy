"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-zinc-900">
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
      </body>
    </html>
  );
}
