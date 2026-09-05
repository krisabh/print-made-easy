/**
 * Phase 2D — physical Color/B&W option mapping (printMode → monochrome).
 * Verifies pdf-to-printer option construction only — no physical printing.
 * Run: npx tsx scripts/phase9d-physical-color-mode-smoke.ts
 */
import assert from "node:assert/strict";

import {
  buildPdfToPrinterOptions,
  resolveMonochrome,
} from "../print-agent/src/printer-service";

function main() {
  // Test 1 — BW → monochrome true
  {
    assert.equal(resolveMonochrome("BW"), true);
    const opts = buildPdfToPrinterOptions("HP LaserJet", { printMode: "BW" });
    assert.equal(opts.monochrome, true);
    console.log("PASS Test 1 BW → monochrome=true");
  }

  // Test 2 — COLOR → monochrome false
  {
    assert.equal(resolveMonochrome("COLOR"), false);
    const opts = buildPdfToPrinterOptions("HP LaserJet", {
      printMode: "COLOR",
    });
    assert.equal(opts.monochrome, false);
    console.log("PASS Test 2 COLOR → monochrome=false");
  }

  // Test 3 — BW does not become COLOR
  {
    const opts = buildPdfToPrinterOptions("Printer A", { printMode: "BW" });
    assert.notEqual(opts.monochrome, false);
    assert.equal(opts.monochrome, true);
    console.log("PASS Test 3 BW never produces monochrome=false");
  }

  // Test 4 — COLOR does not become BW
  {
    const opts = buildPdfToPrinterOptions("Printer A", { printMode: "COLOR" });
    assert.notEqual(opts.monochrome, true);
    assert.equal(opts.monochrome, false);
    console.log("PASS Test 4 COLOR never produces monochrome=true");
  }

  // Test 5 — existing print settings preserved
  {
    const opts = buildPdfToPrinterOptions("Canon PIXMA", {
      printMode: "BW",
      copies: 3,
      scale: "noscale",
      orientation: "landscape",
      pages: "1-3,5",
      paperSize: "A4",
    });
    assert.equal(opts.printer, "Canon PIXMA");
    assert.equal(opts.silent, true);
    assert.equal(opts.copies, 3);
    assert.equal(opts.scale, "noscale");
    assert.equal(opts.orientation, "landscape");
    assert.equal(opts.pages, "1-3,5");
    assert.equal(opts.paperSize, "A4");
    assert.equal(opts.monochrome, true);
    console.log("PASS Test 5 monochrome does not drop existing print options");
  }

  // Test 6 — image path uses same printPdfFile mapping
  // (job-service converts images to PDF then calls printPdfFile with printMode)
  {
    const imageJobOpts = buildPdfToPrinterOptions("Shop Printer", {
      printMode: "COLOR",
      copies: 1,
      scale: "fit",
      paperSize: "A4",
      // image jobs omit pages (same as printCloudJob for non-PDF)
    });
    assert.equal(imageJobOpts.monochrome, false);
    assert.equal(imageJobOpts.pages, undefined);

    const imageBwOpts = buildPdfToPrinterOptions("Shop Printer", {
      printMode: "BW",
      copies: 2,
      scale: "fit",
      paperSize: "A4",
    });
    assert.equal(imageBwOpts.monochrome, true);
    console.log("PASS Test 6 image jobs use same printMode → monochrome mapping");
  }

  // Legacy / missing printMode: omit monochrome (do not assume COLOR)
  {
    assert.equal(resolveMonochrome(undefined), undefined);
    assert.equal(resolveMonochrome(null), undefined);
    const legacy = buildPdfToPrinterOptions("Legacy Printer", {
      copies: 1,
    });
    assert.equal("monochrome" in legacy, false);
    assert.equal(legacy.monochrome, undefined);
    console.log("PASS legacy/missing printMode omits monochrome (safe)");
  }

  console.log("\nphase9d-physical-color-mode-smoke: ALL PASS");
  console.log(
    "Confirmed: PrintMode maps to pdf-to-printer monochrome; physical output not verified.",
  );
}

main();
