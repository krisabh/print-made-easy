import { Check, FileText, Printer } from "lucide-react";

const JOBS = [
  {
    name: "DBMS_Notes.pdf",
    meta: "24 pages · B&W · A4",
    price: "₹48",
    status: "Printing",
    tone: "blue",
  },
  {
    name: "Resume_Abhiram.pdf",
    meta: "3 pages · B&W · A4",
    price: "₹6",
    status: "Pending",
    tone: "amber",
  },
  {
    name: "Project_Report.pdf",
    meta: "12 pages · Color · A4",
    price: "₹72",
    status: "Ready",
    tone: "green",
  },
  {
    name: "Admit_Card.pdf",
    meta: "2 pages · Color · A4",
    price: "₹20",
    status: "Pending",
    tone: "amber",
  },
] as const;

const QR_CELLS = [
  "1111111000101111111",
  "1000001011101000001",
  "1011101000101011101",
  "1011101011011011101",
  "1011101000111011101",
  "1000001010101000001",
  "1111111010101111111",
  "0000000011010000000",
  "1101101010110110101",
  "0010111001001011010",
  "1110001011110100111",
  "0000000010101110100",
  "1111111011010001011",
  "1000001000110111001",
  "1011101011101000110",
  "1011101001011110101",
  "1011101010110011010",
  "1000001011101100101",
  "1111111001010010111",
];

function QrMark({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${QR_CELLS[0].length}, 1fr)`,
        gap: "1px",
      }}
    >
      {QR_CELLS.flatMap((row, y) =>
        row.split("").map((cell, x) => (
          <span
            key={`${y}-${x}`}
            className={cell === "1" ? "bg-slate-900" : "bg-white"}
          />
        )),
      )}
    </div>
  );
}

function StatusPill({
  status,
  tone,
}: {
  status: string;
  tone: "blue" | "amber" | "green";
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
  }[tone];
  const dot = {
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    green: "bg-emerald-500",
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles}`}
    >
      <span
        className={`size-1.5 rounded-full ${dot} ${tone === "blue" ? "motion-safe:animate-pulse" : ""}`}
      />
      {status}
    </span>
  );
}

function PhoneMock() {
  return (
    <div className="rounded-[1.35rem] border border-slate-300 bg-slate-900 p-1.5 shadow-xl shadow-slate-300/70">
      <div className="overflow-hidden rounded-[1.05rem] bg-white">
        <div className="mx-auto mt-1.5 h-1 w-8 rounded-full bg-slate-200" />
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="text-[10px] font-semibold tracking-wide text-blue-700">
            PrintYantra
          </p>
          <p className="mt-0.5 text-[11px] leading-snug font-medium text-slate-900">
            Send your document to print
          </p>
          <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-1.5 py-1.5">
            <QrMark className="size-7 shrink-0 rounded-[3px] bg-white p-0.5 ring-1 ring-slate-200" />
            <p className="text-[9px] leading-tight font-medium text-slate-600">
              Upload PDF or Image
            </p>
          </div>
          <div className="mt-2 rounded-lg border border-slate-200 px-2 py-1.5">
            <p className="truncate text-[10px] font-medium text-slate-900">
              DBMS_Notes.pdf
            </p>
            <p className="text-[9px] text-slate-500">24 pages</p>
          </div>
          <div className="mt-2 flex items-start gap-1 text-emerald-700">
            <Check className="mt-0.5 size-3 shrink-0" />
            <p className="text-[10px] leading-tight">
              <span className="font-semibold">Uploaded</span>
              <span className="mt-0.5 block font-medium text-emerald-600">
                Sent to Print Queue
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueCard() {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.35)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.16em] text-blue-700 uppercase">
            PrintYantra
          </p>
          <p className="mt-0.5 text-base font-semibold tracking-tight text-slate-900">
            Live Print Queue
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
          <span className="size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          Live
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {JOBS.map((job) => (
          <li
            key={job.name}
            className={`flex items-center gap-3 px-4 py-2.5 sm:px-5 ${
              job.status === "Printing" ? "bg-blue-50/50" : ""
            }`}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-blue-600 ring-1 ring-slate-200">
              <FileText className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-slate-900">
                {job.name}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                {job.meta}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[12px] font-semibold text-slate-800">
                {job.price}
              </span>
              <StatusPill status={job.status} tone={job.tone} />
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] text-slate-600 sm:hidden">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Windows Agent connected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Printer className="size-3.5 text-slate-500" />
          Printer ready
        </span>
      </div>
    </article>
  );
}

export function HeroPrintFlow() {
  return (
    <div
      className="relative mx-auto w-full max-w-[36rem] lg:mx-0 lg:max-w-none"
      aria-hidden="true"
    >
      <style>{`
        @keyframes py-hero-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-7px); }
        }
        .py-hero-float { animation: py-hero-float 7.5s ease-in-out infinite; }
        .py-hero-float-delayed { animation: py-hero-float 8.5s ease-in-out 0.6s infinite; }
        @media (prefers-reduced-motion: reduce) {
          .py-hero-float, .py-hero-float-delayed { animation: none; }
        }
      `}</style>

      <div className="pointer-events-none absolute top-24 right-4 -z-10 size-56 rounded-full bg-blue-500/10 blur-3xl" />

      <div className="sm:hidden">
        <div className="mx-auto w-[11.25rem]">
          <PhoneMock />
        </div>
        <div className="mt-4">
          <QueueCard />
        </div>
      </div>

      <div className="relative hidden sm:block sm:pb-4">
        <div className="py-hero-float absolute top-0 left-0 z-20 w-[9.4rem]">
          <PhoneMock />
        </div>

        <aside className="py-hero-float-delayed absolute top-0 left-[9rem] z-30 w-[4.75rem] rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg shadow-slate-200/80 backdrop-blur-sm">
          <QrMark className="aspect-square w-full rounded-md bg-white p-1 ring-1 ring-slate-100" />
          <p className="mt-1 text-center text-[10px] font-semibold text-slate-800">
            Scan to Print
          </p>
        </aside>

        <div className="relative z-10 pt-56">
          <QueueCard />
        </div>

        <div className="relative z-20 mt-3 flex justify-end pr-1">
          <div className="absolute -top-3 right-24 h-3 w-px bg-slate-300" />
          <aside className="w-44 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg shadow-slate-200/80 backdrop-blur-sm">
            <p className="text-[10px] font-medium text-slate-500">Windows Agent</p>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <span className="size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
              Connected
            </p>
            <div className="my-2 h-px bg-slate-100" />
            <p className="inline-flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
              <Printer className="size-3" />
              Canon Printer
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Ready
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
