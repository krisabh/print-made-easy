/**
 * Upload size limit smoke — validation only (no huge file I/O).
 * Run: npx tsx scripts/upload-size-limit-smoke.ts
 */
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  getMaxUploadSizeBytes,
  maxUploadSizeErrorMessage,
  resolveMaxUploadSizeMb,
} from "../lib/upload-limits";
import { validateUploadFiles } from "../lib/upload-service";

function fakeFile(name: string, size: number, type = "application/pdf"): File {
  const buffer = Buffer.alloc(Math.min(size, 64), 0);
  const blob = new Blob([buffer], { type });
  const file = new File([blob], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

async function main() {
  assert.equal(DEFAULT_MAX_UPLOAD_SIZE_MB, 500);
  assert.equal(resolveMaxUploadSizeMb(undefined), 500);
  assert.equal(resolveMaxUploadSizeMb("500"), 500);
  assert.equal(resolveMaxUploadSizeMb("20"), 20);
  assert.equal(resolveMaxUploadSizeMb("abc"), 500);
  assert.equal(getMaxUploadSizeBytes(500), 500 * 1024 * 1024);

  const limitMb = resolveMaxUploadSizeMb(process.env.MAX_UPLOAD_SIZE_MB);
  const limitBytes = getMaxUploadSizeBytes(limitMb);
  const expectedMsg = maxUploadSizeErrorMessage(limitMb);
  assert.match(expectedMsg, /File is too large/);
  assert.match(expectedMsg, new RegExp(`${limitMb} MB`));

  // Just below limit → accepted by size validation
  const under = fakeFile("under.pdf", limitBytes - 1);
  assert.equal(validateUploadFiles([under]), null);
  console.log(`PASS size < ${limitMb} MB accepted`);

  // Exactly at limit → inclusive (size > limit rejects; size === limit ok)
  const exact = fakeFile("exact.pdf", limitBytes);
  assert.equal(validateUploadFiles([exact]), null);
  console.log(`PASS size = ${limitMb} MB accepted`);

  // Above limit → rejected with configured message
  const over = fakeFile("over.pdf", limitBytes + 1);
  assert.equal(validateUploadFiles([over]), expectedMsg);
  console.log(`PASS size > ${limitMb} MB rejected`);

  // Invalid type still rejected
  const badType = fakeFile("x.exe", 1024, "application/octet-stream");
  assert.equal(validateUploadFiles([badType]), "This file type is not supported.");
  console.log("PASS invalid type still rejected");

  // Normal small upload
  const small = fakeFile("ok.png", 12_000, "image/png");
  assert.equal(validateUploadFiles([small]), null);
  console.log("PASS small normal upload accepted");

  console.log("\nupload-size-limit-smoke: ALL PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
