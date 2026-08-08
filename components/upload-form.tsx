"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Check, FileText, Loader2, Minus, Plus, Upload, X } from "lucide-react";

import { submitPrintJobAction } from "@/app/upload/[shopCode]/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { calculatePrintCost } from "@/lib/pricing-service";
import type { ShopUploadContext, UploadSuccessData } from "@/types";

type PrintMode = "BW" | "COLOR";
type PrintType = "SINGLE" | "DOUBLE";

type SelectedFile = {
  id: string;
  file: File;
  pages: number;
  status: "ready" | "counting" | "error";
};

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "png", "jpg", "jpeg"]);
const MAX_FILES = 10;
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function getExtension(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Lightweight PDF page estimate — avoids loading pdf-lib on the client. */
function countPdfPagesLightweight(buffer: ArrayBuffer) {
  const text = new TextDecoder("latin1").decode(buffer);
  const matches = text.match(/\/Type\s*\/Page(?![s\w])/g);
  return matches && matches.length > 0 ? matches.length : 1;
}

async function countFilePages(file: File) {
  const extension = getExtension(file.name);
  if (extension !== "pdf") return 1;
  const buffer = await file.arrayBuffer();
  return countPdfPagesLightweight(buffer);
}

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { id: 1, label: "Upload" },
    { id: 2, label: "Options" },
    { id: 3, label: "Submit" },
  ] as const;

  return (
    <nav aria-label="Progress" className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <ol className="grid grid-cols-3 gap-2">
        {steps.map((step) => {
          const active = current === step.id;
          const done = current > step.id;

          return (
            <li key={step.id} className="flex flex-col items-center gap-1.5 text-center">
              <span
                className={[
                  "flex size-8 items-center justify-center rounded-full text-xs font-semibold",
                  active
                    ? "bg-blue-600 text-white"
                    : done
                      ? "bg-blue-100 text-blue-700"
                      : "bg-slate-100 text-slate-500",
                ].join(" ")}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : step.id}
              </span>
              <span
                className={[
                  "text-xs font-medium",
                  active ? "text-slate-900" : "text-slate-500",
                ].join(" ")}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-800">{label}</legend>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              className={[
                "min-h-11 rounded-lg px-3 text-sm font-medium transition-colors",
                selected
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

type UploadFormProps = {
  shop: ShopUploadContext;
};

export function UploadForm({ shop }: UploadFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [copies, setCopies] = useState(1);
  const [printMode, setPrintMode] = useState<PrintMode>("BW");
  const [printType, setPrintType] = useState<PrintType>("SINGLE");
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [success, setSuccess] = useState<UploadSuccessData | null>(null);
  const [isPending, startTransition] = useTransition();

  const totalPages = useMemo(
    () => files.reduce((sum, item) => sum + (item.status === "ready" ? item.pages : 0), 0),
    [files],
  );

  const billablePages = totalPages * copies;

  // Rates come from PrintPrice (fetched once on page load). Formula from pricing-service.
  const estimatedPrice = useMemo(() => {
    if (files.length === 0 || totalPages === 0) {
      return shop.pricing.minimumCharge;
    }

    return calculatePrintCost(
      shop.pricing,
      totalPages,
      copies,
      printMode,
      printType,
    );
  }, [shop.pricing, files.length, totalPages, copies, printMode, printType]);

  const currentStep: 1 | 2 | 3 =
    files.length === 0 ? 1 : copies >= 1 ? 3 : 2;

  async function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;

    if (files.length + incoming.length > MAX_FILES) {
      setFileError("You can upload a maximum of 10 files.");
      return;
    }

    for (const file of incoming) {
      const extension = getExtension(file.name);
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        setFileError("This file type is not supported.");
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setFileError("File size must be less than 20 MB.");
        return;
      }
    }

    setFileError(null);

    const prepared: SelectedFile[] = incoming.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      pages: getExtension(file.name) === "pdf" ? 0 : 1,
      status: getExtension(file.name) === "pdf" ? "counting" : "ready",
    }));

    setFiles((current) => [...current, ...prepared]);

    for (const item of prepared) {
      if (item.status !== "counting") continue;
      try {
        const pages = await countFilePages(item.file);
        setFiles((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, pages, status: "ready" } : entry,
          ),
        );
      } catch {
        setFiles((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, pages: 1, status: "ready" } : entry,
          ),
        );
      }
    }
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
    setFileError(null);
  }

  function updateCopies(next: number) {
    setCopies(Math.max(1, Math.floor(next)));
  }

  function resetForm() {
    setSuccess(null);
    setFiles([]);
    setCopies(1);
    setPrintMode("BW");
    setPrintType("SINGLE");
    setFileError(null);
    setFormError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (files.length === 0) {
      setFileError("Please upload at least one document.");
      return;
    }
    if (!Number.isInteger(copies) || copies < 1) {
      setFormError("Copies must be at least 1.");
      return;
    }
    if (isPending) return;

    const formData = new FormData();
    formData.set("shopCode", shop.shopCode);
    formData.set("copies", String(copies));
    formData.set("printMode", printMode);
    formData.set("printType", printType);
    files.forEach((item) => formData.append("files", item.file));

    startTransition(async () => {
      const result = await submitPrintJobAction(formData);
      if (!result.success || !result.data) {
        setFormError(result.error ?? "Something went wrong while uploading. Please try again.");
        return;
      }
      setSuccess(result.data);
    });
  }

  if (success) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div
            className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
            aria-hidden="true"
          >
            <Check className="size-7" strokeWidth={2.5} />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Print Job Submitted</h2>

          <div className="mt-6 w-full rounded-2xl bg-slate-50 px-4 py-5">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Job Number
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-wide text-slate-900">
              {success.jobNumber}
            </p>
          </div>

          <div className="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-4">
            <p className="text-sm text-slate-500">Total Amount</p>
            <p className="mt-1 text-2xl font-semibold text-blue-600">
              {formatCurrency(success.totalPrice)}
            </p>
          </div>

          <p className="mt-5 text-sm text-slate-600">
            Please show your Job Number at the counter.
          </p>

          <Button
            type="button"
            size="lg"
            onClick={resetForm}
            className="mt-6 h-12 w-full bg-blue-600 text-base text-white hover:bg-blue-700"
          >
            Done
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <StepIndicator current={currentStep} />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-slate-900">Upload your documents</h2>
          <p className="mt-0.5 text-sm text-slate-500">PDF, JPG, PNG or DOCX</p>
        </div>

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
          className={[
            "flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center transition-colors",
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/40",
          ].join(" ")}
          aria-label="Upload documents"
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-white shadow-sm">
            <Upload className="size-5 text-blue-600" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-800">
            Tap to upload or drag files here
          </p>
          <p className="mt-1 text-xs text-slate-500">Maximum 20 MB per file · up to 10 files</p>
          <span className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white">
            Upload Files
          </span>
        </div>

        <input
          ref={inputRef}
          id="files"
          type="file"
          multiple
          className="sr-only"
          accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <FileText className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {item.file.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {getExtension(item.file.name).toUpperCase()} · {formatBytes(item.file.size)}
                    {" · "}
                    {item.status === "counting"
                      ? "Counting pages…"
                      : `${item.pages} page${item.pages === 1 ? "" : "s"}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(item.id)}
                  className="flex size-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={`Remove ${item.file.name}`}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {fileError && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {fileError}
          </p>
        )}
      </section>

      {files.length > 0 && (
        <>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">Print options</h2>

            <div className="space-y-2">
              <Label htmlFor="copies">Copies</Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateCopies(copies - 1)}
                  disabled={copies <= 1}
                  className="flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  aria-label="Decrease copies"
                >
                  <Minus className="size-4" />
                </button>
                <input
                  id="copies"
                  name="copies"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={copies}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === "") return;
                    const next = Number(raw);
                    if (Number.isFinite(next)) updateCopies(next);
                  }}
                  onBlur={() => {
                    if (!Number.isFinite(copies) || copies < 1) updateCopies(1);
                  }}
                  className="h-11 w-20 rounded-xl border border-slate-200 bg-white text-center text-base font-semibold text-slate-900 outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/20"
                  required
                />
                <button
                  type="button"
                  onClick={() => updateCopies(copies + 1)}
                  className="flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  aria-label="Increase copies"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>

            <SegmentedControl
              label="Print mode"
              value={printMode}
              onChange={setPrintMode}
              options={[
                { value: "BW", label: "Black & White" },
                { value: "COLOR", label: "Color" },
              ]}
            />

            <SegmentedControl
              label="Print type"
              value={printType}
              onChange={setPrintType}
              options={[
                { value: "SINGLE", label: "Single Side" },
                { value: "DOUBLE", label: "Double Side" },
              ]}
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">Price summary</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Documents</dt>
                <dd className="font-medium text-slate-900">{files.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Total pages</dt>
                <dd className="font-medium text-slate-900">{totalPages}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Copies</dt>
                <dd className="font-medium text-slate-900">{copies}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Billable pages</dt>
                <dd className="font-medium text-slate-900">
                  {totalPages} × {copies} = {billablePages}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Print mode</dt>
                <dd className="font-medium text-slate-900">
                  {printMode === "BW" ? "Black & White" : "Color"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Print type</dt>
                <dd className="font-medium text-slate-900">
                  {printType === "SINGLE" ? "Single Side" : "Double Side"}
                </dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-end justify-between gap-3">
                <p className="text-sm font-medium text-slate-600">Estimated Total</p>
                <p className="text-3xl font-semibold tracking-tight text-slate-900">
                  {formatCurrency(estimatedPrice)}
                </p>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Min charge {formatCurrency(shop.pricing.minimumCharge)} · Final price confirmed on submit
              </p>
            </div>
          </section>

          {formError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={isPending}
            className="h-12 w-full bg-blue-600 text-base text-white hover:bg-blue-700 disabled:opacity-70"
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              "Submit Print Job"
            )}
          </Button>
        </>
      )}
    </form>
  );
}
