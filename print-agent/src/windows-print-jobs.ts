/**
 * Cancel Windows Print Spooler jobs that belong to a PrintYantra job.
 * Matches by document name containing the PrintYantra job number.
 * Does not purge unrelated printer queue entries.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function escapeForPowerShellSingleQuoted(value: string) {
  return value.replace(/'/g, "''");
}

/**
 * Cancel queued/printing Win32_PrintJob rows whose Document contains jobNumber
 * and (when provided) whose PrinterName matches.
 * Returns how many jobs were removed (best-effort; 0 on non-Windows).
 */
export async function cancelWindowsPrintJobsForYantraJob(input: {
  jobNumber: string;
  printerName?: string | null;
}): Promise<{ cancelled: number; error?: string }> {
  if (process.platform !== "win32") {
    return { cancelled: 0 };
  }

  const jobNumber = input.jobNumber.trim();
  if (!jobNumber) {
    return { cancelled: 0 };
  }

  const jobEsc = escapeForPowerShellSingleQuoted(jobNumber);
  const printerEsc = input.printerName
    ? escapeForPowerShellSingleQuoted(input.printerName.trim())
    : "";

  const script = `
$ErrorActionPreference = 'Stop'
$needle = '${jobEsc}'
$printer = '${printerEsc}'
$jobs = Get-CimInstance -ClassName Win32_PrintJob -ErrorAction SilentlyContinue
if (-not $jobs) { Write-Output '0'; exit 0 }
$count = 0
foreach ($j in @($jobs)) {
  $doc = [string]$j.Document
  $pname = [string]$j.PrinterName
  if ($doc -and $doc.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    if ($printer -and $pname -and $pname -ne $printer) { continue }
    try {
      Remove-CimInstance -InputObject $j -ErrorAction Stop
      $count++
    } catch {}
  }
}
Write-Output $count
`.trim();

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15000, windowsHide: true },
    );
    const cancelled = Number.parseInt(String(stdout).trim().split(/\r?\n/).pop() || "0", 10);
    return {
      cancelled: Number.isFinite(cancelled) && cancelled > 0 ? cancelled : 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "spool cancel failed";
    console.warn("Windows spool cancel failed:", message);
    return { cancelled: 0, error: message };
  }
}
