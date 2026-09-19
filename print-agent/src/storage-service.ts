import fs from "fs";
import path from "path";

import { JOBS_DIR } from "./config";

/** Periodic cleanup interval while the Agent is running. */
export const PERIODIC_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Periodic cleanup only removes inactive Agent-owned temp files older than this.
 * Active print/conversion files are never deleted by age alone.
 */
export const PERIODIC_MIN_AGE_MS = 15 * 60 * 1000; // 15 minutes

/** In-memory protection for files currently used by print/conversion. */
const activeLocalFiles = new Set<string>();

function normalizeLocalPath(filePath: string) {
  return path.normalize(path.resolve(filePath));
}

export function markLocalFileActive(filePath: string) {
  activeLocalFiles.add(normalizeLocalPath(filePath));
}

export function unmarkLocalFileActive(filePath: string) {
  activeLocalFiles.delete(normalizeLocalPath(filePath));
}

export function isLocalFileActive(filePath: string) {
  return activeLocalFiles.has(normalizeLocalPath(filePath));
}

/** Test helper — do not use from production print paths. */
export function clearActiveLocalFilesForTests() {
  activeLocalFiles.clear();
}

export function getActiveLocalFileCountForTests() {
  return activeLocalFiles.size;
}

/**
 * True only for PrintYantra Agent-owned temporary print filenames.
 * Never matches agent-config.json or unrelated files.
 */
export function isAgentOwnedTempFileName(fileName: string) {
  const base = path.basename(fileName);
  return /^job-/i.test(base) || /^test-print-/i.test(base);
}

export function ensureJobsDirectory(jobsDir: string = JOBS_DIR) {
  fs.mkdirSync(jobsDir, { recursive: true });
  return jobsDir;
}

export function getTempFilePath(fileName: string) {
  ensureJobsDirectory();
  const safeName = path.basename(fileName);
  return path.join(JOBS_DIR, safeName);
}

export type DeleteFileSafeContext = {
  jobNumber?: string;
  fileId?: string;
  reason?: string;
};

export function deleteFileSafe(
  filePath: string,
  context?: DeleteFileSafeContext,
) {
  try {
    if (!fs.existsSync(filePath)) {
      unmarkLocalFileActive(filePath);
      return true;
    }
    fs.unlinkSync(filePath);
    unmarkLocalFileActive(filePath);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    const jobPart = context?.jobNumber
      ? ` for job ${context.jobNumber}`
      : "";
    const filePart = context?.fileId ? ` (file ${context.fileId})` : "";
    const reasonPart = context?.reason ? ` during ${context.reason}` : "";
    console.error(
      `Failed to delete temporary job file${jobPart}${filePart}${reasonPart}: ${detail}`,
    );
    return false;
  }
}

export type CleanAgentOwnedTempFilesOptions = {
  /** Override directory (tests only). Defaults to Agent JOBS_DIR. */
  jobsDir?: string;
  /**
   * Minimum age before an inactive Agent-owned temp file may be removed.
   * Use 0 for startup orphan sweep.
   */
  minAgeMs: number;
  now?: number;
};

export type CleanAgentOwnedTempFilesResult = {
  removed: number;
  skippedActive: number;
  skippedYoung: number;
  skippedOther: number;
};

/**
 * Remove Agent-owned temporary print files that are not actively in use.
 * Never deletes configuration or non-matching files in the jobs directory.
 */
export function cleanAgentOwnedTempFiles(
  options: CleanAgentOwnedTempFilesOptions,
): CleanAgentOwnedTempFilesResult {
  const jobsDir = options.jobsDir ?? JOBS_DIR;
  ensureJobsDirectory(jobsDir);

  const now = options.now ?? Date.now();
  const minAgeMs = Math.max(0, options.minAgeMs);

  let removed = 0;
  let skippedActive = 0;
  let skippedYoung = 0;
  let skippedOther = 0;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(jobsDir);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`Failed to list temporary job directory: ${detail}`);
    return { removed, skippedActive, skippedYoung, skippedOther };
  }

  for (const entry of entries) {
    if (!isAgentOwnedTempFileName(entry)) {
      skippedOther += 1;
      continue;
    }

    const fullPath = path.join(jobsDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        skippedOther += 1;
        continue;
      }

      if (isLocalFileActive(fullPath)) {
        skippedActive += 1;
        continue;
      }

      if (now - stat.mtimeMs < minAgeMs) {
        skippedYoung += 1;
        continue;
      }

      fs.unlinkSync(fullPath);
      removed += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      console.error(
        `Failed to clean temporary job file (${entry}): ${detail}`,
      );
    }
  }

  return { removed, skippedActive, skippedYoung, skippedOther };
}

/** Startup: remove orphaned Agent-owned job/test-print files from a prior process. */
export function cleanStartupOrphanTempFiles(jobsDir?: string) {
  const result = cleanAgentOwnedTempFiles({
    jobsDir,
    minAgeMs: 0,
  });
  if (result.removed > 0) {
    console.log(
      `Startup cleanup removed ${result.removed} orphaned temporary job file(s).`,
    );
  }
  return result;
}

/** Periodic: remove inactive Agent-owned temp files older than PERIODIC_MIN_AGE_MS. */
export function cleanPeriodicStaleTempFiles(jobsDir?: string) {
  const result = cleanAgentOwnedTempFiles({
    jobsDir,
    minAgeMs: PERIODIC_MIN_AGE_MS,
  });
  if (result.removed > 0) {
    console.log(
      `Periodic cleanup removed ${result.removed} stale temporary job file(s).`,
    );
  }
  return result;
}

/**
 * @deprecated Prefer cleanStartupOrphanTempFiles / cleanPeriodicStaleTempFiles.
 * Kept as an age-based sweep of Agent-owned files for compatibility.
 */
export function cleanStaleTempFiles() {
  return cleanPeriodicStaleTempFiles().removed;
}
