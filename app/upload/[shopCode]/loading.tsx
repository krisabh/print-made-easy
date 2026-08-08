import { UploadFormSkeleton } from "@/components/upload-form-skeleton";

export default function UploadLoading() {
  return (
    <main className="min-h-screen bg-white px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="space-y-2">
          <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
          <div className="h-8 w-52 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-64 animate-pulse rounded bg-slate-100" />
        </div>
        <UploadFormSkeleton />
      </div>
    </main>
  );
}
