"use client";

import { useId, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Monitor,
  ShieldAlert,
} from "lucide-react";

import { WINDOWS_AGENT_DOWNLOAD } from "@/lib/print-agent-download";
import { cn } from "@/lib/utils";

const INSTALL_STEPS = [
  {
    title: "Chrome may show a download warning",
    caption:
      'Chrome may show "Suspicious download blocked" while the Agent builds reputation.',
    src: "/agent-install/step-01-chrome-suspicious.jpg",
    alt: "Chrome download list showing Suspicious download blocked for PrintMadeEasy-Agent-Setup",
    width: 455,
    height: 259,
  },
  {
    title: "Choose the download / continue option",
    caption:
      'Only if you downloaded from clauras.com, choose "Download suspicious file".',
    src: "/agent-install/step-02-chrome-download.jpg",
    alt: "Chrome dialog with Download suspicious file for PrintMadeEasy-Agent-Setup",
    width: 720,
    height: 317,
  },
  {
    title: 'Windows may show "Windows protected your PC"',
    caption:
      "Microsoft Defender SmartScreen can appear for new Windows applications.",
    src: "/agent-install/step-03-windows-protected.jpg",
    alt: "Windows SmartScreen dialog: Windows protected your PC with More info link",
    width: 720,
    height: 567,
  },
  {
    title: 'Click "More info"',
    caption: 'On the SmartScreen screen, click the "More info" link.',
    src: "/agent-install/step-04-windows-more-info.jpg",
    alt: "Windows SmartScreen dialog highlighting the More info link",
    width: 720,
    height: 567,
  },
  {
    title: 'Click "Run anyway"',
    caption:
      'After More info, click "Run anyway" to continue installing the Agent from clauras.com.',
    src: "/agent-install/step-05-windows-run-anyway.jpg",
    alt: "Windows SmartScreen dialog with Run anyway and Don't run buttons",
    width: 720,
    height: 691,
  },
];

export function DownloadWindowsAgentCard() {
  const { productName, platform, version, href, fileName } =
    WINDOWS_AGENT_DOWNLOAD;
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();

  return (
    <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Monitor className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            {productName}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Install the PrintMadeEasy Agent on the Windows computer connected to
            your printer.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
          {platform}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
          Version {version}
        </span>
      </div>

      <a
        href={href}
        download={fileName}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        <Download className="size-4" aria-hidden="true" />
        Download Windows Agent
      </a>

      <div className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-950">
              Windows Security Notice
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-amber-900/90">
              PrintMadeEasy Agent is a new Windows application. Because it is
              currently building its Microsoft reputation, Windows or Chrome may
              occasionally display a security warning when downloading or
              installing the Agent.
            </p>
            <p className="mt-3 text-sm font-medium text-amber-950">
              If Windows shows &ldquo;Windows protected your PC&rdquo;:
            </p>
            <ol className="mt-2 space-y-1.5 text-sm text-amber-900/90">
              <li className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-200/80 text-[11px] font-semibold text-amber-950">
                  1
                </span>
                <span>
                  Click <span className="font-medium">More info</span>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-200/80 text-[11px] font-semibold text-amber-950">
                  2
                </span>
                <span>
                  Click <span className="font-medium">Run anyway</span>
                </span>
              </li>
            </ol>
            <p className="mt-3 text-sm leading-relaxed text-amber-900/90">
              If Chrome shows a download warning such as &ldquo;This file
              isn&apos;t commonly downloaded and it may be dangerous,&rdquo;
              continue only if you downloaded it directly from{" "}
              <span className="font-semibold text-amber-950">clauras.com</span>.
            </p>
            <p className="mt-3 text-sm font-medium text-amber-950">
              Only download the PrintMadeEasy Agent from clauras.com.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100"
          aria-expanded={helpOpen}
          aria-controls={helpId}
          onClick={() => setHelpOpen((open) => !open)}
        >
          <span className="inline-flex items-center gap-2">
            <ShieldAlert className="size-4 text-slate-500" aria-hidden="true" />
            Installation help
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-slate-500 transition-transform",
              helpOpen && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>

        {helpOpen ? (
          <div id={helpId} className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-slate-500">
              These screenshots show what Chrome or Windows may display while
              the Agent builds reputation. They do not mean the file is unsafe
              when downloaded from clauras.com.
            </p>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3 [&::-webkit-scrollbar]:hidden">
              {INSTALL_STEPS.map((step, index) => (
                <article
                  key={step.title}
                  className="w-[min(100%,16.5rem)] shrink-0 snap-start rounded-xl border border-slate-200 bg-white p-3 sm:w-auto"
                >
                  <p className="text-[11px] font-semibold tracking-wide text-blue-600 uppercase">
                    Step {index + 1}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {step.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {step.caption}
                  </p>
                  <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    <Image
                      src={step.src}
                      alt={step.alt}
                      width={step.width}
                      height={step.height}
                      className="h-auto w-full object-cover object-top"
                      sizes="(max-width: 640px) 264px, (max-width: 1024px) 40vw, 220px"
                    />
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
