import { Download } from "lucide-react";

import { WINDOWS_AGENT_DOWNLOAD } from "@/lib/print-agent-download";

export function DownloadWindowsAgentCard() {
  const { productName, platform, version, href, fileName } =
    WINDOWS_AGENT_DOWNLOAD;

  return (
    <section className="max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">{productName}</h3>
      <p className="mt-1 text-sm text-slate-500">
        Install the PrintMadeEasy Agent on the Windows computer connected to
        your printer.
      </p>
      <p className="mt-4 text-sm text-slate-600">{platform}</p>
      <p className="mt-1 text-sm text-slate-600">Version {version}</p>
      <a
        href={href}
        download={fileName}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Download className="size-4" aria-hidden="true" />
        Download Windows Agent
      </a>
    </section>
  );
}
