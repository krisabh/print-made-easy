export function CustomerDocumentPrivacyNotice() {
  return (
    <aside
      className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 sm:px-5"
      aria-label="Document privacy notice"
    >
      <span className="mt-0.5 shrink-0 rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
        Privacy
      </span>
      <p className="text-sm leading-snug text-slate-800">
        <span className="font-semibold text-slate-900">
          Auto-deleted after 1 hour.
        </span>{" "}
        Your file is kept only to print your job — then removed from our server.
      </p>
    </aside>
  );
}
