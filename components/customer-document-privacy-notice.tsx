export function CustomerDocumentPrivacyNotice() {
  return (
    <aside className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-4 sm:px-5">
      <p className="text-sm font-semibold text-slate-900">
        Your documents stay private
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        Your uploaded document is used only to process your print job. It is
        automatically deleted from our server within 1 hour.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        We do not keep your documents permanently.
      </p>
    </aside>
  );
}
