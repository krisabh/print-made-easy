/**
 * Phase 1 — printer default persistence (no auto-reselection).
 * Run: npx tsx scripts/phase9a-printer-default-persistence-smoke.ts
 */
import assert from "node:assert/strict";

import {
  applyFirstRunPrinterIfNeeded,
  resolveConfiguredPrinterSelection,
} from "../print-agent/src/selected-printer";

function printers(
  rows: Array<{ name: string; status?: string }>,
) {
  return rows.map((row) => ({
    name: row.name,
    status: row.status || "Online",
  }));
}

function main() {
  // Test 1 — configured remains default when detected with others
  {
    const resolved = resolveConfiguredPrinterSelection(
      "Printer A",
      printers([{ name: "Printer A" }, { name: "Printer B" }]),
    );
    assert.equal(resolved.configuredPrinter, "Printer A");
    assert.equal(resolved.isDetected, true);
    assert.equal(resolved.firstRunCandidate, null);
    const persisted: string[] = [];
    const selected = applyFirstRunPrinterIfNeeded(
      "Printer A",
      printers([{ name: "Printer A" }, { name: "Printer B" }]),
      (name) => persisted.push(name),
    );
    assert.equal(selected, "Printer A");
    assert.equal(persisted.length, 0);
    console.log("PASS Test 1 configured A remains with A,B detected");
  }

  // Test 2 — configured missing: do NOT replace with B/C
  {
    const resolved = resolveConfiguredPrinterSelection(
      "Printer A",
      printers([{ name: "Printer B" }, { name: "Printer C" }]),
    );
    assert.equal(resolved.configuredPrinter, "Printer A");
    assert.equal(resolved.isDetected, false);
    assert.equal(resolved.status, "Offline");
    assert.equal(resolved.firstRunCandidate, null);

    const persisted: string[] = [];
    const selected = applyFirstRunPrinterIfNeeded(
      "Printer A",
      printers([{ name: "Printer B" }, { name: "Printer C" }]),
      (name) => persisted.push(name),
    );
    assert.equal(selected, "Printer A");
    assert.deepEqual(persisted, []);
    console.log("PASS Test 2 missing A is NOT replaced by B/C");
  }

  // Test 3 — configured returns
  {
    const missing = resolveConfiguredPrinterSelection(
      "Printer A",
      printers([{ name: "Printer B" }, { name: "Printer C" }]),
    );
    assert.equal(missing.isDetected, false);

    const back = resolveConfiguredPrinterSelection(
      "Printer A",
      printers([
        { name: "Printer A" },
        { name: "Printer B" },
        { name: "Printer C" },
      ]),
    );
    assert.equal(back.configuredPrinter, "Printer A");
    assert.equal(back.isDetected, true);
    assert.equal(back.status, "Online");
    console.log("PASS Test 3 A returns and remains default");
  }

  // Test 4 — new printer appears
  {
    const before = resolveConfiguredPrinterSelection(
      "Printer A",
      printers([{ name: "Printer A" }, { name: "Printer B" }]),
    );
    const after = resolveConfiguredPrinterSelection(
      "Printer A",
      printers([
        { name: "Printer A" },
        { name: "Printer B" },
        { name: "Printer C" },
      ]),
    );
    assert.equal(before.configuredPrinter, "Printer A");
    assert.equal(after.configuredPrinter, "Printer A");
    assert.equal(after.firstRunCandidate, null);
    console.log("PASS Test 4 new printer does not steal default");
  }

  // Test 5 — explicit manual selection is just a new configured value
  {
    const afterManual = resolveConfiguredPrinterSelection(
      "Printer B",
      printers([{ name: "Printer A" }, { name: "Printer B" }]),
    );
    assert.equal(afterManual.configuredPrinter, "Printer B");
    assert.equal(afterManual.isDetected, true);
    console.log("PASS Test 5 explicit selection B is respected");
  }

  // Test 6 — first-run: no config + exactly one printer
  {
    const persisted: string[] = [];
    const selected = applyFirstRunPrinterIfNeeded(
      null,
      printers([{ name: "Only Printer" }]),
      (name) => persisted.push(name),
    );
    assert.equal(selected, "Only Printer");
    assert.deepEqual(persisted, ["Only Printer"]);
    console.log("PASS Test 6 first-run single printer initializes");
  }

  // Test 6b — first-run: no config + multiple printers → no auto pick
  {
    const persisted: string[] = [];
    const selected = applyFirstRunPrinterIfNeeded(
      null,
      printers([{ name: "A" }, { name: "B" }]),
      (name) => persisted.push(name),
    );
    assert.equal(selected, null);
    assert.deepEqual(persisted, []);
    console.log("PASS Test 6b first-run multiple printers waits for shopkeeper");
  }

  // Unavailable prior config is NOT first-run
  {
    const persisted: string[] = [];
    const selected = applyFirstRunPrinterIfNeeded(
      "Gone Printer",
      printers([{ name: "Only Left" }]),
      (name) => persisted.push(name),
    );
    assert.equal(selected, "Gone Printer");
    assert.deepEqual(persisted, []);
    console.log("PASS unavailable configured printer is not treated as first-run");
  }

  // Offline configured still kept
  {
    const resolved = resolveConfiguredPrinterSelection(
      "Printer A",
      printers([
        { name: "Printer A", status: "Offline" },
        { name: "Printer B", status: "Online" },
      ]),
    );
    assert.equal(resolved.configuredPrinter, "Printer A");
    assert.equal(resolved.isDetected, true);
    assert.equal(resolved.status, "Offline");
    console.log("PASS offline configured printer stays selected");
  }

  console.log("\nphase9a-printer-default-persistence-smoke: ALL PASS");
  console.log(
    "Confirmed: An unavailable configured printer can no longer be silently replaced by another printer.",
  );
}

main();
