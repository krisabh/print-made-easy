"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  CreditCard,
  Eye,
  FileText,
  Loader2,
  Minus,
  Plus,
  Upload,
  X,
} from "lucide-react";

import {
  previewIdCardPdfAction,
  submitPrintJobAction,
} from "@/app/upload/[shopCode]/actions";
import { CustomerDocumentPrivacyNotice } from "@/components/customer-document-privacy-notice";
import {
  buildNormalPreviewPages,
  PrintPreviewDialog,
  revokePreviewPages,
  type NormalPreviewFile,
} from "@/components/print-preview-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  buildIdCardPreviewFormData,
  buildIdCardSubmitFormData,
  idCardBillablePages,
  isIdCardImageFile,
  JOB_MODE_ID_CARD_FRONT_BACK,
  JOB_MODE_NORMAL,
  validateIdCardClientSides,
  type SubmitJobMode,
} from "@/lib/id-card-client";
import {
  extensionFromFileName,
  jobHasUnsupportedAutoPrint,
  resolveJobPrintCategory,
  type AggregatePrintFileCategory,
} from "@/lib/print-file-category";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  BRIGHTNESS_STEP,
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  CONTENT_SCALE_STEP,
  isValidPageRange,
} from "@/lib/print-settings";
import { calculatePrintCost } from "@/lib/pricing-service";
import {
  getMaxUploadSizeBytes,
  maxUploadSizeErrorMessage,
} from "@/lib/upload-limits";
import type { ShopUploadContext, UploadSuccessData } from "@/types";

type PrintMode = "BW" | "COLOR";
type PrintOrientation = "portrait" | "landscape";
type PrintScale = "fit" | "noscale";
type PrintMargins = "normal" | "none";
type PagesMode = "all" | "custom";
type JobLiveStatus =
  | "PENDING"
  | "PRINTING"
  | "READY_FOR_PICKUP"
  | "DELIVERED"
  | "CANCELLED";

type SelectedFile = {
  id: string;
  file: File;
  pages: number;
  status: "ready" | "counting" | "error";
};

type IdCardSideSelection = {
  file: File;
  previewUrl: string;
};

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "png", "jpg", "jpeg"]);
const ID_CARD_ACCEPT =
  "image/jpeg,image/png,.jpg,.jpeg,.png";
const MAX_FILES = 10;
const MAX_COPIES = 100;
const STATUS_POLL_MS = 3000;

function snapPercent(value: number, min: number, max: number, step: number) {
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

function getExtension(fileName: string) {
  return extensionFromFileName(fileName);
}

async function suggestOrientationFromImage(
  file: File,
): Promise<PrintOrientation | null> {
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g)$/i.test(file.name)) {
    return null;
  }
  try {
    const url = URL.createObjectURL(file);
    const orientation = await new Promise<PrintOrientation | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (!img.naturalWidth || !img.naturalHeight) {
          resolve(null);
          return;
        }
        resolve(
          img.naturalWidth >= img.naturalHeight ? "landscape" : "portrait",
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
    return orientation;
  } catch {
    return null;
  }
}

function statusLabel(status: JobLiveStatus) {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "PRINTING":
      return "Printing";
    case "READY_FOR_PICKUP":
      return "Ready for pickup";
    case "DELIVERED":
      return "Delivered";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

function statusHint(status: JobLiveStatus) {
  switch (status) {
    case "PENDING":
      return "Waiting for the shop printer.";
    case "PRINTING":
      return "Your documents are printing now.";
    case "READY_FOR_PICKUP":
      return "Ready at the counter — show your job number.";
    case "DELIVERED":
      return "Marked as collected.";
    case "CANCELLED":
      return "This job was cancelled. Ask the shop if you need help.";
    default:
      return "";
  }
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
  columns,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
}) {
  const cols = columns ?? (options.length === 1 ? 1 : options.length === 3 ? 3 : 2);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-800">{label}</legend>
      <div
        className={[
          "grid gap-2 rounded-xl bg-slate-100 p-1",
          cols === 3 ? "grid-cols-3" : cols === 1 ? "grid-cols-1" : "grid-cols-2",
        ].join(" ")}
      >
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

function IdCardSideSlot({
  label,
  description,
  selection,
  inputId,
  errorId,
  onPick,
  onClear,
}: {
  label: string;
  description: string;
  selection: IdCardSideSelection | null;
  inputId: string;
  errorId?: string;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Label htmlFor={inputId} className="text-sm font-semibold text-slate-900">
            {label}
          </Label>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
        {selection ? (
          <button
            type="button"
            onClick={onClear}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"
            aria-label={`Remove ${label.toLowerCase()} image`}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {selection ? (
        <div className="mt-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selection.previewUrl}
            alt=""
            className="size-14 shrink-0 rounded-lg border border-slate-200 object-cover bg-white"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">
              {selection.file.name}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatBytes(selection.file.size)}
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Replace photo
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex min-h-20 w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-center hover:border-blue-400 hover:bg-blue-50/40"
          aria-describedby={errorId}
        >
          <Upload className="size-4 text-blue-600" aria-hidden="true" />
          <span className="mt-2 text-sm font-medium text-slate-800">
            Tap to add photo
          </span>
          <span className="mt-0.5 text-xs text-slate-500">JPEG or PNG</span>
        </button>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ID_CARD_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
    </div>
  );
}

type UploadFormProps = {
  shop: ShopUploadContext;
};

export function UploadForm({ shop }: UploadFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const orientationTouchedRef = useRef(false);
  const maxUploadSizeMb = shop.maxUploadSizeMb;
  const maxFileSizeBytes = getMaxUploadSizeBytes(maxUploadSizeMb);
  const sizeTooLargeMessage = maxUploadSizeErrorMessage(maxUploadSizeMb);
  const [jobMode, setJobMode] = useState<SubmitJobMode>(JOB_MODE_NORMAL);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [idCardFront, setIdCardFront] = useState<IdCardSideSelection | null>(
    null,
  );
  const [idCardBack, setIdCardBack] = useState<IdCardSideSelection | null>(
    null,
  );
  const [copies, setCopies] = useState(1);
  const [orientation, setOrientation] = useState<PrintOrientation>("portrait");
  const [printMode, setPrintMode] = useState<PrintMode>("BW");
  const [scale, setScale] = useState<PrintScale>("fit");
  const [margins, setMargins] = useState<PrintMargins>("normal");
  const [pagesMode, setPagesMode] = useState<PagesMode>("all");
  const [pageRange, setPageRange] = useState("");
  const [brightness, setBrightness] = useState(100);
  const [contentScale, setContentScale] = useState(100);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [success, setSuccess] = useState<UploadSuccessData | null>(null);
  const [liveStatus, setLiveStatus] = useState<JobLiveStatus>("PENDING");
  const [isPending, startTransition] = useTransition();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewPages, setPreviewPages] = useState<
    ReturnType<typeof buildNormalPreviewPages>
  >([]);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [previewSettingsNote, setPreviewSettingsNote] = useState<string | null>(
    null,
  );
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const idCardPreviewRequestRef = useRef(0);

  const isIdCardMode = jobMode === JOB_MODE_ID_CARD_FRONT_BACK;
  const idCardReady = Boolean(idCardFront && idCardBack);

  // If Color is not available for the current default printer, keep BW.
  useEffect(() => {
    if (!shop.colorSupported && printMode === "COLOR") {
      setPrintMode("BW");
    }
  }, [shop.colorSupported, printMode]);

  useEffect(() => {
    if (!success?.jobId) return;

    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(
          `/api/customer/jobs/${success!.jobId}?shopCode=${encodeURIComponent(shop.shopCode)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { status?: JobLiveStatus };
        };
        if (!cancelled && payload.success && payload.data?.status) {
          setLiveStatus(payload.data.status);
        }
      } catch {
        // Keep last known status on transient network errors
      }
    }

    void poll();
    const timer = window.setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [success, shop.shopCode]);

  useEffect(() => {
    return () => {
      if (idCardFront?.previewUrl) URL.revokeObjectURL(idCardFront.previewUrl);
      if (idCardBack?.previewUrl) URL.revokeObjectURL(idCardBack.previewUrl);
    };
    // Intentionally only on unmount — side updates revoke previous URLs in setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = useMemo(() => {
    if (isIdCardMode) {
      return idCardReady ? idCardBillablePages() : 0;
    }
    return files.reduce(
      (sum, item) => sum + (item.status === "ready" ? item.pages : 0),
      0,
    );
  }, [isIdCardMode, idCardReady, files]);

  const billablePages = totalPages * copies;

  // Derived from current files — never an independent source of truth.
  const aggregateFileCategory: AggregatePrintFileCategory = useMemo(
    () =>
      isIdCardMode
        ? "NONE"
        : resolveJobPrintCategory(files.map((f) => f.file)),
    [isIdCardMode, files],
  );

  const hasDocxNotice = useMemo(
    () =>
      isIdCardMode
        ? false
        : jobHasUnsupportedAutoPrint(files.map((f) => f.file)),
    [isIdCardMode, files],
  );

  const showOptions = isIdCardMode ? idCardReady : files.length > 0;

  // Mixed jobs: drop auto-orientation; Portrait unless customer chose explicitly.
  useEffect(() => {
    if (
      aggregateFileCategory === "MIXED" &&
      !orientationTouchedRef.current &&
      orientation !== "portrait"
    ) {
      setOrientation("portrait");
    }
  }, [aggregateFileCategory, orientation]);

  // Pricing always uses SINGLE (Phase C product rule).
  // ID-card mode estimates 1 composed A4 page (server remains authoritative).
  const estimatedPrice = useMemo(() => {
    if (isIdCardMode) {
      if (!idCardReady) {
        return shop.pricing.minimumCharge;
      }
      return calculatePrintCost(
        shop.pricing,
        idCardBillablePages(),
        copies,
        printMode,
        "SINGLE",
      );
    }

    if (files.length === 0 || totalPages === 0) {
      return shop.pricing.minimumCharge;
    }

    return calculatePrintCost(
      shop.pricing,
      totalPages,
      copies,
      printMode,
      "SINGLE",
    );
  }, [
    isIdCardMode,
    idCardReady,
    shop.pricing,
    files.length,
    totalPages,
    copies,
    printMode,
  ]);

  const currentStep: 1 | 2 | 3 = !showOptions ? 1 : copies >= 1 ? 3 : 2;

  function clearIdCardSides() {
    setIdCardFront((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setIdCardBack((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }

  function selectJobMode(next: SubmitJobMode) {
    if (next === jobMode) return;
    closePreview();
    setFileError(null);
    setFormError(null);
    setMoreOpen(false);
    if (next === JOB_MODE_ID_CARD_FRONT_BACK) {
      setFiles([]);
      orientationTouchedRef.current = false;
      setOrientation("portrait");
      setScale("fit");
      setMargins("normal");
      setPagesMode("all");
      setPageRange("");
    } else {
      clearIdCardSides();
    }
    setJobMode(next);
  }

  function assignIdCardSide(
    side: "front" | "back",
    file: File,
  ) {
    if (!isIdCardImageFile(file)) {
      setFileError("ID card uploads must be JPEG or PNG images.");
      return;
    }
    if (file.size > maxFileSizeBytes) {
      setFileError(sizeTooLargeMessage);
      return;
    }
    setFileError(null);
    const previewUrl = URL.createObjectURL(file);
    const next: IdCardSideSelection = { file, previewUrl };
    if (side === "front") {
      setIdCardFront((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return next;
      });
    } else {
      setIdCardBack((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return next;
      });
    }
  }

  function clearIdCardSide(side: "front" | "back") {
    if (side === "front") {
      setIdCardFront((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return null;
      });
    } else {
      setIdCardBack((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return null;
      });
    }
    setFileError(null);
  }

  async function addFiles(incoming: File[]) {
    if (jobMode === JOB_MODE_ID_CARD_FRONT_BACK) return;
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
      if (file.size > maxFileSizeBytes) {
        setFileError(sizeTooLargeMessage);
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

    const nextFiles = [...files, ...prepared];
    setFiles(nextFiles);

    // Auto-orientation only for a single-image job (not mixed / multi-file).
    const nextCategory = resolveJobPrintCategory(nextFiles.map((f) => f.file));
    if (
      !orientationTouchedRef.current &&
      nextCategory === "IMAGE" &&
      nextFiles.length === 1
    ) {
      const hint = await suggestOrientationFromImage(prepared[0].file);
      if (hint && !orientationTouchedRef.current) {
        setOrientation(hint);
      }
    }

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
    setCopies(Math.min(MAX_COPIES, Math.max(1, Math.floor(next))));
  }

  function resetForm() {
    closePreview();
    setSuccess(null);
    setLiveStatus("PENDING");
    setJobMode(JOB_MODE_NORMAL);
    setFiles([]);
    clearIdCardSides();
    setCopies(1);
    setOrientation("portrait");
    orientationTouchedRef.current = false;
    setPrintMode("BW");
    setScale("fit");
    setMargins("normal");
    setPagesMode("all");
    setPageRange("");
    setBrightness(100);
    setContentScale(100);
    setMoreOpen(false);
    setFileError(null);
    setFormError(null);
  }

  function releasePreviewResources() {
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
    }
    revokePreviewPages(previewPages);
    setPreviewPdfUrl(null);
    setPreviewPages([]);
    setPreviewPageIndex(0);
    setPreviewError(null);
    setPreviewLoading(false);
    setPreviewSettingsNote(null);
  }

  function closePreview() {
    setPreviewOpen(false);
    releasePreviewResources();
  }

  function openNormalPreview() {
    if (files.length === 0) {
      setFileError("Please upload at least one document.");
      return;
    }

    releasePreviewResources();

    const normalFiles: NormalPreviewFile[] = files.map((f) => ({
      id: f.id,
      file: f.file,
    }));
    const pageCounts: Record<string, number> = {};
    for (const f of files) {
      pageCounts[f.id] = f.status === "ready" ? f.pages : 1;
    }
    const pages = buildNormalPreviewPages(normalFiles, pageCounts);
    const previewable = pages.filter((p) => p.kind !== "unavailable");
    const onlyUnsupported =
      pages.length > 0 && previewable.length === 0;

    const notes: string[] = [];
    if (aggregateFileCategory === "DOCUMENT" && pagesMode === "custom") {
      const trimmed = pageRange.trim();
      if (trimmed) {
        notes.push(`Print will use page range: ${trimmed}.`);
      }
    }
    if (copies > 1) {
      notes.push("Copies do not duplicate preview pages.");
    }
    if (pages.some((p) => p.kind === "unavailable") && previewable.length > 0) {
      notes.push("Some files can't be previewed; Submit still works.");
    }

    setPreviewPages(pages);
    setPreviewPageIndex(0);
    setPreviewSettingsNote(notes.length ? notes.join(" ") : null);
    setPreviewOpen(true);

    if (onlyUnsupported) {
      setPreviewError("Preview isn't available for this file type.");
    }
  }

  function openIdCardPreview(options?: {
    brightness?: number;
    contentScale?: number;
    silent?: boolean;
  }) {
    const sideError = validateIdCardClientSides(
      idCardFront?.file,
      idCardBack?.file,
    );
    if (sideError) {
      setFileError(sideError);
      return;
    }
    if (!idCardFront || !idCardBack) return;

    const nextBrightness = options?.brightness ?? brightness;
    const nextScale = options?.contentScale ?? contentScale;
    const requestId = ++idCardPreviewRequestRef.current;

    if (!options?.silent) {
      if (previewPdfUrl) {
        URL.revokeObjectURL(previewPdfUrl);
        setPreviewPdfUrl(null);
      }
      revokePreviewPages(previewPages);
      setPreviewPages([]);
      setPreviewPageIndex(0);
      setPreviewError(null);
      setPreviewOpen(true);
      setPreviewSettingsNote(
        copies > 1 ? "Copies do not duplicate the preview sheet." : null,
      );
    }

    setPreviewLoading(true);

    const formData = buildIdCardPreviewFormData({
      shopCode: shop.shopCode,
      front: idCardFront.file,
      back: idCardBack.file,
      brightness: nextBrightness,
      contentScale: nextScale,
    });

    startPreviewTransition(async () => {
      try {
        const result = await previewIdCardPdfAction(formData);
        if (requestId !== idCardPreviewRequestRef.current) return;
        if (!result.success || !result.data) {
          setPreviewError(
            result.error ??
              "Preview couldn't be generated. You can still submit the print job.",
          );
          setPreviewLoading(false);
          return;
        }
        const binary = atob(result.data.pdfBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setPreviewPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setPreviewError(null);
        setPreviewLoading(false);
      } catch {
        if (requestId !== idCardPreviewRequestRef.current) return;
        setPreviewError(
          "Preview couldn't be generated. You can still submit the print job.",
        );
        setPreviewLoading(false);
      }
    });
  }

  function handleBrightnessChange(value: number) {
    const next = snapPercent(
      value,
      BRIGHTNESS_MIN,
      BRIGHTNESS_MAX,
      BRIGHTNESS_STEP,
    );
    setBrightness(next);
    if (previewOpen && isIdCardMode) {
      openIdCardPreview({ brightness: next, contentScale, silent: true });
    }
  }

  function handleContentScaleChange(value: number) {
    const next = snapPercent(
      value,
      CONTENT_SCALE_MIN,
      CONTENT_SCALE_MAX,
      CONTENT_SCALE_STEP,
    );
    setContentScale(next);
    if (previewOpen && isIdCardMode) {
      openIdCardPreview({ brightness, contentScale: next, silent: true });
    }
  }

  function handleResetAdjustments() {
    setBrightness(100);
    setContentScale(100);
    if (previewOpen && isIdCardMode) {
      openIdCardPreview({ brightness: 100, contentScale: 100, silent: true });
    }
  }

  function handlePreviewClick() {
    setFormError(null);
    if (isIdCardMode) {
      openIdCardPreview();
    } else {
      openNormalPreview();
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (isIdCardMode) {
      const sideError = validateIdCardClientSides(
        idCardFront?.file,
        idCardBack?.file,
      );
      if (sideError) {
        setFileError(sideError);
        return;
      }
      if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
        setFormError("Copies must be between 1 and 100.");
        return;
      }
      if (isPending || !idCardFront || !idCardBack) return;

      const formData = buildIdCardSubmitFormData({
        shopCode: shop.shopCode,
        copies,
        printMode: shop.colorSupported ? printMode : "BW",
        front: idCardFront.file,
        back: idCardBack.file,
        brightness,
        contentScale,
      });

      startTransition(async () => {
        const result = await submitPrintJobAction(formData);
        if (!result.success || !result.data) {
          setFormError(
            result.error ??
              "Something went wrong while uploading. Please try again.",
          );
          return;
        }
        setSuccess(result.data);
        setLiveStatus("PENDING");
      });
      return;
    }

    if (files.length === 0) {
      setFileError("Please upload at least one document.");
      return;
    }
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
      setFormError("Copies must be between 1 and 100.");
      return;
    }
    if (orientation !== "portrait" && orientation !== "landscape") {
      setFormError("Please choose Portrait or Landscape.");
      return;
    }
    if (aggregateFileCategory === "DOCUMENT" && pagesMode === "custom") {
      const trimmed = pageRange.trim();
      if (!trimmed || !isValidPageRange(trimmed) || trimmed.toLowerCase() === "all") {
        setFormError("Please enter a valid page range (e.g. 1-5 or 1,3,7).");
        setMoreOpen(true);
        return;
      }
    }
    if (isPending) return;

    const formData = new FormData();
    formData.set("shopCode", shop.shopCode);
    formData.set("copies", String(copies));
    formData.set("orientation", orientation);
    formData.set("printMode", shop.colorSupported ? printMode : "BW");
    formData.set("brightness", String(brightness));
    formData.set("contentScale", String(contentScale));
    // Category-specific fields; server re-derives category from actual files.
    if (aggregateFileCategory === "DOCUMENT") {
      formData.set("scale", scale);
      formData.set("margins", "normal");
      formData.set("pagesMode", pagesMode);
      formData.set(
        "pageRange",
        pagesMode === "custom" ? pageRange.trim() : "",
      );
    } else if (aggregateFileCategory === "IMAGE") {
      formData.set("scale", "fit");
      formData.set("margins", margins);
      formData.set("pagesMode", "all");
      formData.set("pageRange", "");
    } else {
      // MIXED / NONE: only job-safe defaults
      formData.set("scale", "fit");
      formData.set("margins", "normal");
      formData.set("pagesMode", "all");
      formData.set("pageRange", "");
    }
    files.forEach((item) => formData.append("files", item.file));

    startTransition(async () => {
      const result = await submitPrintJobAction(formData);
      if (!result.success || !result.data) {
        setFormError(result.error ?? "Something went wrong while uploading. Please try again.");
        return;
      }
      setSuccess(result.data);
      setLiveStatus("PENDING");
    });
  }

  if (success) {
    const isReady =
      liveStatus === "READY_FOR_PICKUP" || liveStatus === "DELIVERED";
    const isActive =
      liveStatus === "PENDING" || liveStatus === "PRINTING";

    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div
            className={`flex size-14 items-center justify-center rounded-full ${
              isReady
                ? "bg-emerald-50 text-emerald-600"
                : liveStatus === "CANCELLED"
                  ? "bg-red-50 text-red-500"
                  : "bg-blue-50 text-blue-600"
            }`}
            aria-hidden="true"
          >
            {isActive ? (
              <Loader2 className="size-7 animate-spin" strokeWidth={2.5} />
            ) : (
              <Check className="size-7" strokeWidth={2.5} />
            )}
          </div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">
            {isReady ? "Ready for pickup" : "Print Job Submitted"}
          </h2>

          <div className="mt-6 w-full rounded-2xl bg-slate-50 px-4 py-5">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Job Number
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-wide text-slate-900">
              {success.jobNumber}
            </p>
          </div>

          <div className="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Live status</p>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  liveStatus === "PENDING"
                    ? "bg-amber-50 text-amber-800"
                    : liveStatus === "PRINTING"
                      ? "bg-blue-50 text-blue-700"
                      : liveStatus === "READY_FOR_PICKUP"
                        ? "bg-emerald-50 text-emerald-700"
                        : liveStatus === "CANCELLED"
                          ? "bg-red-50 text-red-600"
                          : "bg-slate-100 text-slate-700"
                }`}
              >
                {statusLabel(liveStatus)}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{statusHint(liveStatus)}</p>
            {isActive ? (
              <p className="mt-2 text-xs text-slate-400">
                Updates automatically — keep this page open.
              </p>
            ) : null}
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
          <p className="mt-0.5 text-sm text-slate-500">
            {isIdCardMode
              ? "Front and back on one A4 sheet"
              : "PDF, JPG, PNG or DOCX"}
          </p>
        </div>

        <div className="mb-4 space-y-2">
          <p className="text-sm font-medium text-slate-800">Print type</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => selectJobMode(JOB_MODE_NORMAL)}
              aria-pressed={jobMode === JOB_MODE_NORMAL}
              className={[
                "flex min-h-14 items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                jobMode === JOB_MODE_NORMAL
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300",
              ].join(" ")}
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm">
                <FileText className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">
                  Normal Print
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Upload a document or image
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => selectJobMode(JOB_MODE_ID_CARD_FRONT_BACK)}
              aria-pressed={isIdCardMode}
              className={[
                "flex min-h-14 items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                isIdCardMode
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300",
              ].join(" ")}
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm">
                <CreditCard className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">
                  ID Card — Front &amp; Back
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Print both sides on one A4 sheet
                </span>
              </span>
            </button>
          </div>
        </div>

        {isIdCardMode ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              Front + back will be automatically resized and placed on one A4
              sheet.
            </p>
            <IdCardSideSlot
              label="Front side"
              description="Photo of the front of the card"
              selection={idCardFront}
              inputId="id-card-front"
              onPick={(file) => assignIdCardSide("front", file)}
              onClear={() => clearIdCardSide("front")}
            />
            <IdCardSideSlot
              label="Back side"
              description="Photo of the back of the card"
              selection={idCardBack}
              inputId="id-card-back"
              onPick={(file) => assignIdCardSide("back", file)}
              onClear={() => clearIdCardSide("back")}
            />
          </div>
        ) : (
          <>
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
              <p className="mt-1 text-xs text-slate-500">
                Maximum {maxUploadSizeMb} MB per file · up to 10 files
              </p>
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
          </>
        )}

        {fileError && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {fileError}
          </p>
        )}
      </section>

      {showOptions && (
        <>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">Print options</h2>

            {!isIdCardMode ? (
              <SegmentedControl
                label="Orientation"
                value={orientation}
                onChange={(value) => {
                  orientationTouchedRef.current = true;
                  setOrientation(value);
                }}
                options={[
                  { value: "portrait", label: "Portrait" },
                  { value: "landscape", label: "Landscape" },
                ]}
              />
            ) : (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-800">Layout</p>
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  Portrait A4
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Front on top, back below — fixed for ID cards.
                  </span>
                </p>
              </div>
            )}

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
                  max={MAX_COPIES}
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
                  disabled={copies >= MAX_COPIES}
                  className="flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  aria-label="Increase copies"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>

            {!isIdCardMode && aggregateFileCategory === "IMAGE" ? (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-800">Image fitting</p>
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  Fit to page
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Keeps the full image visible — no crop, no stretch.
                  </span>
                </p>
              </div>
            ) : null}

            <SegmentedControl
              label="Print mode"
              value={printMode}
              onChange={setPrintMode}
              options={
                shop.colorSupported
                  ? [
                      { value: "BW", label: "Black & White" },
                      { value: "COLOR", label: "Color" },
                    ]
                  : [{ value: "BW", label: "Black & White" }]
              }
            />

            {!isIdCardMode ? (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setMoreOpen((open) => !open)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-left text-sm font-medium text-slate-700 hover:text-slate-900"
                  aria-expanded={moreOpen}
                >
                  <span>More print options</span>
                  <ChevronDown
                    className={[
                      "size-4 shrink-0 transition-transform",
                      moreOpen ? "rotate-180" : "",
                    ].join(" ")}
                    aria-hidden="true"
                  />
                </button>

                {moreOpen ? (
                  <div className="mt-3 space-y-4">
                    {aggregateFileCategory === "DOCUMENT" ? (
                      <>
                        <SegmentedControl
                          label="Pages"
                          value={pagesMode}
                          onChange={setPagesMode}
                          options={[
                            { value: "all", label: "All pages" },
                            { value: "custom", label: "Custom range" },
                          ]}
                        />
                        {pagesMode === "custom" ? (
                          <div className="space-y-2">
                            <Label htmlFor="pageRange">Page range</Label>
                            <input
                              id="pageRange"
                              name="pageRange"
                              type="text"
                              inputMode="numeric"
                              placeholder="e.g. 1-5 or 1,3,7"
                              value={pageRange}
                              onChange={(event) => setPageRange(event.target.value)}
                              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/20"
                              aria-describedby="pageRangeHelp"
                            />
                            <p id="pageRangeHelp" className="text-xs text-slate-500">
                              Examples: 1-5 · 1,3,7 · 2-4,8. Pricing still uses all pages.
                            </p>
                          </div>
                        ) : null}

                        <div>
                          <p className="mb-1 text-sm font-medium text-slate-800">Paper size</p>
                          <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">
                            A4
                          </p>
                        </div>

                        <SegmentedControl
                          label="Page fit"
                          value={scale}
                          onChange={setScale}
                          options={[
                            { value: "fit", label: "Fit to page" },
                            { value: "noscale", label: "Actual size" },
                          ]}
                        />
                      </>
                    ) : aggregateFileCategory === "IMAGE" ? (
                      <>
                        <div>
                          <p className="mb-1 text-sm font-medium text-slate-800">Paper size</p>
                          <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">
                            A4
                          </p>
                        </div>
                        <SegmentedControl
                          label="Margins"
                          value={margins}
                          onChange={setMargins}
                          options={[
                            { value: "normal", label: "Normal" },
                            { value: "none", label: "None" },
                          ]}
                        />
                      </>
                    ) : (
                      <div>
                        <p className="mb-1 text-sm font-medium text-slate-800">Paper size</p>
                        <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">
                          A4
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-800">Paper size</p>
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">
                  A4
                </p>
              </div>
            )}

            {hasDocxNotice ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
                Word files (.docx) are accepted, but automatic printing may not be available.
                The shop can help print them at the counter.
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">Price summary</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              {isIdCardMode ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">ID card sides</dt>
                  <dd className="font-medium text-slate-900">Front + Back</dd>
                </div>
              ) : (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Documents</dt>
                  <dd className="font-medium text-slate-900">{files.length}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">
                  {isIdCardMode ? "Print sheets" : "Total pages"}
                </dt>
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
                <dt className="text-slate-500">Orientation</dt>
                <dd className="font-medium text-slate-900">
                  {isIdCardMode
                    ? "Portrait"
                    : orientation === "portrait"
                      ? "Portrait"
                      : "Landscape"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Print mode</dt>
                <dd className="font-medium text-slate-900">
                  {printMode === "BW" ? "Black & White" : "Color"}
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

          <CustomerDocumentPrivacyNotice />

          {formError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={
                isPending ||
                isPreviewPending ||
                (isIdCardMode ? !idCardReady : files.length === 0)
              }
              onClick={handlePreviewClick}
              className="h-12 w-full border-slate-300 text-base text-slate-800 hover:bg-slate-50 disabled:opacity-70"
            >
              {isPreviewPending || previewLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Preview…
                </>
              ) : (
                <>
                  <Eye className="size-4" aria-hidden="true" />
                  Preview & Adjust
                </>
              )}
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={isPending}
              className="h-12 w-full bg-blue-600 text-base text-white hover:bg-blue-700 disabled:opacity-70"
            >
              {isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Printing…
                </>
              ) : (
                "Submit Print Job"
              )}
            </Button>
          </div>
        </>
      )}

      <PrintPreviewDialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) closePreview();
          else setPreviewOpen(true);
        }}
        title="Preview & Adjust"
        description={
          isIdCardMode
            ? "One A4 portrait sheet · Front left, Back right · Adjustments apply to both sides."
            : undefined
        }
        loading={previewLoading || isPreviewPending}
        error={previewError}
        pdfUrl={previewPdfUrl}
        pages={previewPages}
        pageIndex={previewPageIndex}
        onPageIndexChange={setPreviewPageIndex}
        printMode={shop.colorSupported ? printMode : "BW"}
        orientation={isIdCardMode ? "portrait" : orientation}
        margins={
          isIdCardMode
            ? "normal"
            : aggregateFileCategory === "IMAGE"
              ? margins
              : "normal"
        }
        pageFit={
          isIdCardMode
            ? "fit"
            : aggregateFileCategory === "DOCUMENT"
              ? scale
              : "fit"
        }
        printTypeLabel={isIdCardMode ? "ID Card — Front & Back" : "Normal Print"}
        fileInfoLabel={
          isIdCardMode
            ? "ID card · 1 A4 page · Front left / Back right"
            : null
        }
        settingsNote={previewSettingsNote}
        brightness={brightness}
        contentScale={contentScale}
        onBrightnessChange={handleBrightnessChange}
        onContentScaleChange={handleContentScaleChange}
        onResetAdjustments={handleResetAdjustments}
        applyLabel="Save & Continue"
      />
    </form>
  );
}
