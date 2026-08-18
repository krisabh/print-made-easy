/**
 * Public landing for pairing QR links.
 * Agent scanning / auto-register is Phase 2B-3 — this page only explains the link.
 */
export default async function AgentConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const params = await searchParams;
  const hasToken = Boolean(params.t?.trim());

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
          PrintMadeEasy
        </p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">
          Print Agent pairing
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          {hasToken
            ? "This link is for the PrintMadeEasy Windows Agent. Open it with the Agent on your printer computer to finish connecting."
            : "Missing pairing code. Generate a new Connection QR from your shop dashboard."}
        </p>
        <p className="mt-4 text-xs text-slate-400">
          Do not share this page publicly. Pairing codes expire in 10 minutes.
        </p>
      </div>
    </main>
  );
}
