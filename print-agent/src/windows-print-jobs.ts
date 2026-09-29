/**
 * Cancel Windows Print Spooler jobs that belong to one PrintYantra job.
 * Matches the job number inside the spooler Document (Sumatra uses the PDF
 * file name) and any JobIds recorded when those pages were submitted.
 * Does not purge unrelated printer queue entries.
 */

import { execFile } from "child_process";
import { promisify } from "util";

import { notePrintTraceSpoolFailure } from "./print-perf-trace";

const execFileAsync = promisify(execFile);

export type WindowsSpoolJob = {
  jobId: number;
  document: string;
  /** Win32_PrintJob.Name, usually "Printer Name, JobId". */
  name: string;
};

function escapeForPowerShellSingleQuoted(value: string) {
  return value.replace(/'/g, "''");
}

/** True when this spool row belongs to the PrintYantra job number. */
export function spoolJobMatchesYantraJob(
  job: Pick<WindowsSpoolJob, "document" | "name">,
  jobNumber: string,
): boolean {
  const needle = jobNumber.trim().toLowerCase();
  if (needle.length < 3) return false;
  const document = (job.document || "").toLowerCase();
  const name = (job.name || "").toLowerCase();
  return document.includes(needle) || name.includes(needle);
}

async function runPowerShell(script: string, timeoutMs = 15000): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: timeoutMs, windowsHide: true },
  );
  return String(stdout || "");
}

export async function listWindowsPrintJobs(): Promise<WindowsSpoolJob[]> {
  if (process.platform !== "win32") return [];

  const script = `
$ErrorActionPreference = 'Stop'
$jobs = @(Get-CimInstance -ClassName Win32_PrintJob -ErrorAction SilentlyContinue)
$list = foreach ($j in $jobs) {
  [PSCustomObject]@{
    jobId = [int]$j.JobId
    document = [string]$j.Document
    name = [string]$j.Name
  }
}
if ($list.Count -eq 0) { '[]' } else { $list | ConvertTo-Json -Compress }
`.trim();

  try {
    const stdout = await runPowerShell(script);
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WindowsSpoolJob | WindowsSpoolJob[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => ({
        jobId: Number(row.jobId),
        document: String(row.document || ""),
        name: String(row.name || ""),
      }))
      .filter((row) => Number.isFinite(row.jobId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "list failed";
    console.warn("Windows spool list failed:", message);
    notePrintTraceSpoolFailure(message);
    return [];
  }
}

async function removeWindowsPrintJobIds(jobIds: number[]): Promise<number> {
  const ids = [...new Set(jobIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0 || process.platform !== "win32") return 0;

  const idList = ids.join(",");
  const script = `
$ErrorActionPreference = 'Stop'
$ids = @(${idList})
$count = 0
$jobs = @(Get-CimInstance -ClassName Win32_PrintJob -ErrorAction SilentlyContinue)
foreach ($j in $jobs) {
  if ($ids -contains [int]$j.JobId) {
    try {
      Remove-CimInstance -InputObject $j -ErrorAction Stop
      $count++
    } catch {
      Write-Warning $_.Exception.Message
    }
  }
}
Write-Output $count
`.trim();

  const stdout = await runPowerShell(script);
  const cancelled = Number.parseInt(String(stdout).trim().split(/\r?\n/).pop() || "0", 10);
  return Number.isFinite(cancelled) && cancelled > 0 ? cancelled : 0;
}

/**
 * Cancel queued/printing Win32_PrintJob rows for this PrintYantra job.
 * Returns how many jobs were removed (best-effort; 0 on non-Windows).
 */
export async function cancelWindowsPrintJobsForYantraJob(input: {
  jobNumber: string;
  printerName?: string | null;
  /** JobIds captured when this Agent submitted pages. */
  extraJobIds?: number[];
}): Promise<{ cancelled: number; matched: number; error?: string }> {
  if (process.platform !== "win32") {
    return { cancelled: 0, matched: 0 };
  }

  const jobNumber = input.jobNumber.trim();
  if (!jobNumber) {
    return { cancelled: 0, matched: 0 };
  }

  try {
    const jobs = await listWindowsPrintJobs();
    const matched = jobs.filter(
      (job) =>
        spoolJobMatchesYantraJob(job, jobNumber) ||
        (input.extraJobIds || []).includes(job.jobId),
    );

    console.log(
      `[spool] cancel ${jobNumber} printer=${input.printerName || "?"} spoolJobs=${jobs.length} matched=${matched.length}`,
    );
    for (const job of matched) {
      console.log(
        `[spool] match jobId=${job.jobId} document="${job.document}" name="${job.name}"`,
      );
    }
    if (jobs.length > 0 && matched.length === 0) {
      for (const job of jobs.slice(0, 8)) {
        console.log(
          `[spool] unmatched jobId=${job.jobId} document="${job.document}" name="${job.name}"`,
        );
      }
    }

    const cancelled = await removeWindowsPrintJobIds(matched.map((job) => job.jobId));
    console.log(`[spool] removed ${cancelled} job(s) for ${jobNumber}`);
    return { cancelled, matched: matched.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "spool cancel failed";
    console.warn("Windows spool cancel failed:", message);
    return { cancelled: 0, matched: 0, error: message };
  }
}
