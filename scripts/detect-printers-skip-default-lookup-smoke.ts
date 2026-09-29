/**
 * Recurring printer scan must not call pdf-to-printer getDefaultPrinter().
 * Name/status detection and configured-printer matching stay in place.
 * Run: npx tsx scripts/detect-printers-skip-default-lookup-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  detectPrinters,
  resetDetectPrintersCacheForTests,
} from "../print-agent/src/printer-service";
import { resolveConfiguredPrinterSelection } from "../print-agent/src/selected-printer";

const source = fs.readFileSync(
  path.join("print-agent", "src", "printer-service.ts"),
  "utf8",
);

assert.equal(
  source.includes("getDefaultPrinter"),
  false,
  "recurring printer-service must not reference getDefaultPrinter",
);

const firstRun = fs.readFileSync(
  path.join("print-agent", "src", "selected-printer.ts"),
  "utf8",
);
assert.match(firstRun, /printers\.length === 1/);
assert.equal(firstRun.includes("getDefaultPrinter"), false);

const logs: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  logs.push(args.map((part) => String(part)).join(" "));
  originalLog(...args);
};

async function main() {
  try {
    resetDetectPrintersCacheForTests();
    const printers = await detectPrinters({ caller: "heartbeat" });

    assert.ok(printers.length > 0, "CIM scan should return installed printers");
    for (const printer of printers) {
      assert.equal(typeof printer.name, "string");
      assert.ok(printer.name.length > 0);
      assert.ok(
        printer.status === "Online" ||
          printer.status === "Offline" ||
          printer.status === "Unknown",
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(printer, "isDefault"),
        false,
      );
    }

    const chosen = printers[0];
    const matched = resolveConfiguredPrinterSelection(chosen.name, printers);
    assert.equal(matched.isDetected, true);
    assert.equal(matched.configuredPrinter, chosen.name);
    assert.equal(matched.status, chosen.status);
    assert.equal(matched.firstRunCandidate, null);

    const missing = resolveConfiguredPrinterSelection(
      "Printer That Is Not Installed",
      printers,
    );
    assert.equal(missing.isDetected, false);
    assert.equal(missing.status, "Offline");

    const text = logs.join("\n");
    assert.equal(text.includes("default-printer-start"), false);
    assert.equal(text.includes("default-printer-done"), false);
    assert.equal(text.includes("defaultName="), false);
    assert.match(text, /defaultPrinterMs=0/);
    assert.match(text, /success=true/);
    assert.match(text, /cim=success/);

    console.log(
      "PASS recurring detectPrinters does not call getDefaultPrinter",
    );
    console.log(
      `PASS detected ${printers.length} printer(s); selected match uses name and status`,
    );
  } finally {
    console.log = originalLog;
  }
}

main().catch((error) => {
  console.log = originalLog;
  console.error(error);
  process.exit(1);
});
