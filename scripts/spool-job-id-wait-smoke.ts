/**
 * Post-Sumatra spool observation lists immediately and retries once,
 * with sleep bounded by the existing 3000ms window.
 * Run: npx tsx scripts/spool-job-id-wait-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SPOOL_JOB_OBSERVATION_MAX_WAIT_MS,
  observeNewSpoolJobIds,
} from "../print-agent/src/job-service";

assert.equal(SPOOL_JOB_OBSERVATION_MAX_WAIT_MS, 3000);

const jobSource = fs.readFileSync(
  path.join("print-agent", "src", "job-service.ts"),
  "utf8",
);
const printerSource = fs.readFileSync(
  path.join("print-agent", "src", "printer-service.ts"),
  "utf8",
);
const spoolSource = fs.readFileSync(
  path.join("print-agent", "src", "windows-print-jobs.ts"),
  "utf8",
);

assert.match(jobSource, /holdForSpoolerRead:\s*false/);
assert.match(jobSource, /snapshotSpoolJobIds\(\)/);
assert.match(jobSource, /assertJobStillPrintable/);
assert.match(jobSource, /printPdfFilePageByPage/);
assert.match(jobSource, /rememberSpoolIds\(input\.jobNumber, created\)/);
assert.match(jobSource, /cancelWindowsPrintJobsForYantraJob/);
assert.match(printerSource, /await delay\(3000\)/);
assert.match(printerSource, /holdForSpoolerRead !== false/);
assert.match(spoolSource, /function spoolJobMatchesYantraJob/);

async function run(input: {
  lists: Array<Array<{ jobId: number }>>;
  beforeIds?: number[];
  advanceOnListMs?: number;
}) {
  let clock = 0;
  let listIndex = 0;
  const sleeps: number[] = [];
  const result = await observeNewSpoolJobIds({
    beforeIds: new Set(input.beforeIds ?? []),
    now: () => clock,
    maxWaitMs: SPOOL_JOB_OBSERVATION_MAX_WAIT_MS,
    listJobs: async () => {
      clock += input.advanceOnListMs ?? 0;
      const jobs = input.lists[Math.min(listIndex, input.lists.length - 1)] ?? [];
      listIndex += 1;
      return jobs;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { result, sleeps, listIndex };
}

async function main() {
const hit = await run({
  lists: [[{ jobId: 41 }, { jobId: 7 }]],
  beforeIds: [7],
});
assert.deepEqual(hit.result.created, [41]);
assert.equal(hit.result.waitedMs, 0);
assert.equal(hit.result.listings, 1);
assert.deepEqual(hit.sleeps, []);
assert.equal(hit.listIndex, 1);
console.log("PASS first after-list sees the new JobId and does not sleep");

const missThenHit = await run({
  lists: [[], [{ jobId: 9 }]],
});
assert.deepEqual(missThenHit.result.created, [9]);
assert.equal(missThenHit.result.listings, 2);
assert.deepEqual(missThenHit.sleeps, [3000]);
assert.equal(missThenHit.result.waitedMs, 3000);
assert.ok(missThenHit.result.waitedMs <= SPOOL_JOB_OBSERVATION_MAX_WAIT_MS);
console.log("PASS empty first list retries once inside the 3000ms cap");

const partialBudget = await run({
  lists: [[], [{ jobId: 12 }]],
  advanceOnListMs: 400,
});
assert.deepEqual(partialBudget.result.created, [12]);
assert.equal(partialBudget.result.listings, 2);
assert.deepEqual(partialBudget.sleeps, [2600]);
assert.equal(partialBudget.result.waitedMs, 2600);
assert.ok(partialBudget.result.waitedMs <= SPOOL_JOB_OBSERVATION_MAX_WAIT_MS);
assert.ok(partialBudget.sleeps.every((ms) => ms <= 3000));
assert.equal(partialBudget.sleeps.length, 1);
console.log("PASS retry sleep shrinks by time already spent and stays <= 3000ms");

const tracked = await run({
  lists: [[{ jobId: 1 }, { jobId: 2 }, { jobId: 8 }]],
  beforeIds: [1, 2],
});
assert.deepEqual(tracked.result.created, [8]);
assert.equal(tracked.result.waitedMs, 0);
assert.deepEqual(tracked.sleeps, []);
console.log("PASS already recorded spool JobIds are not treated as new");

const stillMissing = await run({
  lists: [[], []],
});
assert.deepEqual(stillMissing.result.created, []);
assert.equal(stillMissing.result.listings, 2);
assert.equal(stillMissing.result.waitedMs, 3000);
assert.ok(stillMissing.result.waitedMs <= 3000);
console.log("PASS still-missing JobId continues after one bounded retry");

console.log("spool-job-id-wait-smoke: ALL PASS");
}

main();
