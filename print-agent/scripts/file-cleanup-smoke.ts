/**
 * Focused smoke tests for Agent-owned temporary file cleanup.
 * Does not touch the real %PROGRAMDATA%\PrintMadeEasy\jobs directory.
 *
 * Run from repo root:
 *   npx tsx print-agent/scripts/file-cleanup-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PERIODIC_MIN_AGE_MS,
  cleanAgentOwnedTempFiles,
  cleanStartupOrphanTempFiles,
  clearActiveLocalFilesForTests,
  deleteFileSafe,
  isAgentOwnedTempFileName,
  markLocalFileActive,
  unmarkLocalFileActive,
} from "../src/storage-service";

function writeFile(dir: string, name: string, mtimeMs?: number) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, "smoke");
  if (typeof mtimeMs === "number") {
    const when = new Date(mtimeMs);
    fs.utimesSync(full, when, when);
  }
  return full;
}

function exists(dir: string, name: string) {
  return fs.existsSync(path.join(dir, name));
}

async function main() {
  clearActiveLocalFilesForTests();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pme-cleanup-smoke-"));
  const jobsDir = path.join(root, "jobs");
  fs.mkdirSync(jobsDir);

  try {
    assert.equal(isAgentOwnedTempFileName("job-ABC-file1.pdf"), true);
    assert.equal(
      isAgentOwnedTempFileName("job-ABC-file1-converted.pdf"),
      true,
    );
    assert.equal(isAgentOwnedTempFileName("test-print-123.pdf"), true);
    assert.equal(isAgentOwnedTempFileName("agent-config.json"), false);
    assert.equal(isAgentOwnedTempFileName("readme.txt"), false);
    console.log("A PASS filename ownership detection");

    writeFile(jobsDir, "job-PME1-fileA.pdf");
    writeFile(jobsDir, "job-PME1-fileA-converted.pdf");
    writeFile(jobsDir, "test-print-999.pdf");
    writeFile(jobsDir, "agent-config.json"); // should never be deleted from jobs dir tests
    writeFile(jobsDir, "unrelated.txt");

    const startup = cleanStartupOrphanTempFiles(jobsDir);
    assert.equal(startup.removed, 3);
    assert.equal(exists(jobsDir, "job-PME1-fileA.pdf"), false);
    assert.equal(exists(jobsDir, "job-PME1-fileA-converted.pdf"), false);
    assert.equal(exists(jobsDir, "test-print-999.pdf"), false);
    assert.equal(exists(jobsDir, "agent-config.json"), true);
    assert.equal(exists(jobsDir, "unrelated.txt"), true);
    console.log("B PASS startup orphan cleanup (recent + converted + test-print)");

    const activePath = writeFile(jobsDir, "job-ACTIVE-file1.pdf");
    writeFile(jobsDir, "job-ORPHAN-file2.pdf");
    markLocalFileActive(activePath);

    const protectedRun = cleanAgentOwnedTempFiles({
      jobsDir,
      minAgeMs: 0,
    });
    assert.equal(protectedRun.skippedActive, 1);
    assert.equal(exists(jobsDir, "job-ACTIVE-file1.pdf"), true);
    assert.equal(exists(jobsDir, "job-ORPHAN-file2.pdf"), false);
    unmarkLocalFileActive(activePath);
    deleteFileSafe(activePath);
    console.log("C PASS active-job protection");

    const now = Date.now();
    writeFile(jobsDir, "job-OLD-file.pdf", now - PERIODIC_MIN_AGE_MS - 1000);
    writeFile(jobsDir, "job-YOUNG-file.pdf", now - 60_000);

    const periodic = cleanAgentOwnedTempFiles({
      jobsDir,
      minAgeMs: PERIODIC_MIN_AGE_MS,
      now,
    });
    assert.equal(exists(jobsDir, "job-OLD-file.pdf"), false);
    assert.equal(exists(jobsDir, "job-YOUNG-file.pdf"), true);
    assert.ok(periodic.removed >= 1);
    assert.ok(periodic.skippedYoung >= 1);
    console.log("D PASS periodic age-based stale cleanup");

    const missingOk = deleteFileSafe(path.join(jobsDir, "missing-job-file.pdf"), {
      jobNumber: "PME-SMOKE",
      reason: "smoke",
    });
    assert.equal(missingOk, true);
    console.log("E PASS deleteFileSafe missing file is non-fatal");

    // Unrelated files still present
    assert.equal(exists(jobsDir, "agent-config.json"), true);
    assert.equal(exists(jobsDir, "unrelated.txt"), true);
    console.log("F PASS unrelated files preserved");

    console.log("ALL FILE CLEANUP SMOKE TESTS PASSED");
  } finally {
    clearActiveLocalFilesForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
