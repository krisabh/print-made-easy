/**
 * Diagnostic-only runner. Calls the real detectPrinters() on the paired-agent
 * schedule. Does not change intervals, timeouts, or printing.
 *
 * Schedule mirrored from the Agent:
 * - one startup heartbeat scan
 * - one initial window refresh scan
 * - heartbeat + job poll every 5s (fired together, not awaited in series)
 * - light window refresh every 12s (cache read; scan only if cache is empty)
 */
import { execFile } from "node:child_process";
import {
  detectPrinters,
  readPrintersForLightRefresh,
} from "../src/printer-service";

const DURATION_MS = 10 * 60 * 1000;
const startedAt = Date.now();
const cpuStart = process.cpuUsage();
const rssStart = process.memoryUsage().rss;
const powershellSamples: number[] = [];

function samplePowerShell() {
  execFile(
    "tasklist",
    ["/FI", "IMAGENAME eq powershell.exe", "/FO", "CSV", "/NH"],
    { windowsHide: true },
    (_error, stdout) => {
      const text = String(stdout || "");
      const count = text
        .split(/\r?\n/)
        .filter((line) => line.toLowerCase().includes("powershell.exe")).length;
      powershellSamples.push(count);
      console.log(
        `[printer-perf] sample powershell=${count} rss=${process.memoryUsage().rss} at=${Date.now()}`,
      );
    },
  );
}

function elapsed() {
  return Date.now() - startedAt;
}

console.log(`[printer-perf] diag-start at=${startedAt} rss=${rssStart}`);
samplePowerShell();
void detectPrinters({ caller: "heartbeat" });
void detectPrinters({ caller: "window-refresh" });

const pairedTick = setInterval(() => {
  void detectPrinters({ caller: "heartbeat" });
  void detectPrinters({ caller: "job-poll" });
}, 5_000);

const windowTick = setInterval(() => {
  void readPrintersForLightRefresh();
}, 12_000);

const sampler = setInterval(samplePowerShell, 60_000);

setTimeout(() => {
  clearInterval(pairedTick);
  clearInterval(windowTick);
  clearInterval(sampler);
  samplePowerShell();
  setTimeout(() => {
    const cpu = process.cpuUsage(cpuStart);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const wallMs = elapsed();
    console.log(
      `[printer-perf] diag-end wallMs=${wallMs} cpuMs=${cpuMs.toFixed(1)} cpuPct=${((cpuMs / wallMs) * 100).toFixed(2)} rssStart=${rssStart} rssEnd=${process.memoryUsage().rss} powershellSamples=${powershellSamples.join(",")}`,
    );
    process.exit(0);
  }, 20_000);
}, DURATION_MS);
