/**
 * Phase C — ID Card customer UI helpers smoke.
 * Run: npx tsx scripts/phase-c-id-card-ui-smoke.ts
 *
 * Tests client-safe helpers used by upload-form (no React DOM harness).
 */
import assert from "node:assert/strict";

import {
  buildIdCardSubmitFormData,
  idCardBillablePages,
  isIdCardImageFile,
  JOB_MODE_ID_CARD_FRONT_BACK,
  JOB_MODE_NORMAL,
  resolveUploadJobMode,
  validateIdCardClientSides,
} from "../lib/id-card-client";
import { parseSubmitJobMode } from "../shared/job-mode";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function png(name: string) {
  return new File([PNG], name, { type: "image/png" });
}

function jpeg(name: string) {
  return new File([PNG], name, { type: "image/jpeg" });
}

function pdf(name: string) {
  return new File([Buffer.from("%PDF-1.4")], name, {
    type: "application/pdf",
  });
}

function docx(name: string) {
  return new File([Buffer.from("PK")], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function main() {
  // A — NORMAL is default token
  assert.equal(resolveUploadJobMode(JOB_MODE_NORMAL), JOB_MODE_NORMAL);
  assert.equal(parseSubmitJobMode(null), JOB_MODE_NORMAL);
  assert.equal(parseSubmitJobMode(""), JOB_MODE_NORMAL);
  console.log("A PASS NORMAL remains default");

  // B — ID mode token recognized
  assert.equal(
    resolveUploadJobMode(JOB_MODE_ID_CARD_FRONT_BACK),
    JOB_MODE_ID_CARD_FRONT_BACK,
  );
  assert.equal(
    parseSubmitJobMode(JOB_MODE_ID_CARD_FRONT_BACK),
    JOB_MODE_ID_CARD_FRONT_BACK,
  );
  console.log("B PASS ID_CARD_FRONT_BACK mode selectable");

  // C — switching tokens are distinct (UI clears incompatible state separately)
  assert.notEqual(JOB_MODE_NORMAL, JOB_MODE_ID_CARD_FRONT_BACK);
  console.log("C PASS mode tokens distinct for UI switch");

  // D — FormData fields match Phase B
  {
    const front = jpeg("front.jpg");
    const back = png("back.png");
    const formData = buildIdCardSubmitFormData({
      shopCode: "PME001",
      copies: 2,
      printMode: "BW",
      front,
      back,
    });
    assert.equal(formData.get("jobMode"), JOB_MODE_ID_CARD_FRONT_BACK);
    assert.equal(formData.get("shopCode"), "PME001");
    assert.equal(formData.get("copies"), "2");
    assert.equal(formData.get("orientation"), "portrait");
    assert.ok(formData.get("front") instanceof File);
    assert.ok(formData.get("back") instanceof File);
    assert.equal(formData.getAll("files").length, 0);
    console.log("D PASS FormData includes jobMode + front/back (no files[])");
  }

  // E — front-only blocked (needs back)
  assert.match(
    String(validateIdCardClientSides(png("front.png"), null)),
    /back/i,
  );
  console.log("E PASS front-only cannot submit");

  // F — back-only blocked (needs front)
  assert.match(
    String(validateIdCardClientSides(null, png("back.png"))),
    /front/i,
  );
  console.log("F PASS back-only cannot submit");

  // G — PDF/DOCX rejected for ID-card
  assert.equal(isIdCardImageFile(pdf("x.pdf")), false);
  assert.equal(isIdCardImageFile(docx("x.docx")), false);
  assert.equal(isIdCardImageFile(png("ok.png")), true);
  assert.equal(isIdCardImageFile(jpeg("ok.jpg")), true);
  assert.match(
    String(validateIdCardClientSides(pdf("a.pdf"), png("b.png"))),
    /JPEG or PNG/i,
  );
  console.log("G PASS PDF/DOCX cannot be used for ID-card mode");

  // H — normal multi-file is outside these helpers (smoke documents contract)
  assert.equal(parseSubmitJobMode(undefined as unknown as null), JOB_MODE_NORMAL);
  console.log("H PASS omitted jobMode → NORMAL (normal multi-file path)");

  // I — copies / billable pages = 1 sheet
  assert.equal(idCardBillablePages(), 1);
  console.log("I PASS ID-card billable pages = 1 (copies applied separately)");

  // J — no duplex/printer fields in FormData builder
  {
    const formData = buildIdCardSubmitFormData({
      shopCode: "PME001",
      copies: 1,
      printMode: "COLOR",
      front: png("f.png"),
      back: png("b.png"),
    });
    assert.equal(formData.get("printType"), null);
    assert.equal(formData.get("printer"), null);
    assert.equal(formData.get("printerName"), null);
    assert.equal(formData.get("duplex"), null);
    console.log("J PASS no duplex/printer selection fields");
  }

  console.log("\nPhase C ID card UI helper smoke tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
