export function UploadFormSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
      <div className="h-44 animate-pulse rounded-2xl bg-slate-100" />
      <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      <div className="h-36 animate-pulse rounded-2xl bg-slate-100" />
      <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
