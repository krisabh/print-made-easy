/**
 * Light window refresh reads the last printer scan and does not start CIM
 * while a result exists. Manual refresh and set-printer still use detectPrinters.
 * Run: npx tsx scripts/light-refresh-printer-cache-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  detectPrinters,
  getDetectPrintersStats,
  readPrintersForLightRefresh,
  resetDetectPrintersCacheForTests,
} from "../print-agent/src/printer-service";

function read(relativePath: string) {
  return fs.readFileSync(path.join(...relativePath.split("/")), "utf8");
}

const mainSource = read("print-agent/src/main.ts");
const jobSource = read("print-agent/src/job-service.ts");
const printerSource = read("print-agent/src/printer-service.ts");

assert.match(
  mainSource,
  /printers = light\s*\?\s*await readPrintersForLightRefresh\(\)\s*:\s*await detectPrinters\(\{ caller: "window-refresh" \}\)/,
);
assert.match(mainSource, /detectPrinters\(\{ force: true, caller: "other" \}\)/);
assert.match(mainSource, /const printers = await detectPrinters\(\{ caller \}\)/);
assert.match(mainSource, /}, 5000\);/);
assert.match(jobSource, /detectPrinters\(\{ caller: "job-poll" \}\)/);
assert.match(printerSource, /const DETECT_CACHE_MS = 5_000/);
assert.equal(printerSource.includes("getDefaultPrinter"), false);
assert.match(printerSource, /row\.WorkOffline === true\) return "Offline"/);
assert.match(printerSource, /return "Online"/);

function starts() {
  return getDetectPrintersStats().starts;
}

async function main() {
  resetDetectPrintersCacheForTests();
  const beforeEmpty = starts();
  const first = await readPrintersForLightRefresh();
  assert.equal(starts() - beforeEmpty, 1);
  assert.ok(first.length > 0, "empty cache should populate from one CIM scan");
  for (const printer of first) {
    assert.equal(typeof printer.name, "string");
    assert.ok(printer.name.length > 0);
    assert.ok(
      printer.status === "Online" ||
        printer.status === "Offline" ||
        printer.status === "Unknown",
    );
  }
  console.log("PASS empty cache light refresh performs one detection");

  const warm = starts();
  const second = await readPrintersForLightRefresh();
  const third = await readPrintersForLightRefresh();
  assert.equal(starts(), warm);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  console.log("PASS warm light refresh does not start CIM");

  await new Promise((resolve) => setTimeout(resolve, 5_200));
  const afterTtl = starts();
  const staleRead = await readPrintersForLightRefresh();
  assert.equal(starts(), afterTtl);
  assert.deepEqual(staleRead, first);
  console.log("PASS light refresh still skips CIM after the 5s cache TTL");

  const beforeManual = starts();
  const manual = await detectPrinters({ caller: "window-refresh" });
  assert.equal(starts() - beforeManual, 1);
  assert.ok(manual.length > 0);
  console.log("PASS manual refresh still scans when the 5s cache has expired");

  const beforeForce = starts();
  const forced = await detectPrinters({ force: true, caller: "other" });
  assert.equal(starts() - beforeForce, 1);
  assert.ok(forced.length > 0);
  console.log("PASS set-printer force still scans while the cache is warm");

  const beforeHeartbeat = starts();
  await detectPrinters({ caller: "heartbeat" });
  await detectPrinters({ caller: "job-poll" });
  assert.equal(starts(), beforeHeartbeat);
  console.log("PASS heartbeat and job poll still share the warm cache");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
