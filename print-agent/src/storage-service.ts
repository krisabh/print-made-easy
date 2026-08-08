import fs from "fs";
import path from "path";

import { JOBS_DIR } from "./config";

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export function ensureJobsDirectory() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  return JOBS_DIR;
}

export function getTempFilePath(fileName: string) {
  ensureJobsDirectory();
  const safeName = path.basename(fileName);
  return path.join(JOBS_DIR, safeName);
}

export function deleteFileSafe(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Failed to delete temp file:", filePath, error);
  }
}

/** Remove temporary job files older than 1 hour. */
export function cleanStaleTempFiles() {
  ensureJobsDirectory();

  const now = Date.now();
  let removed = 0;

  for (const entry of fs.readdirSync(JOBS_DIR)) {
    const fullPath = path.join(JOBS_DIR, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(fullPath);
        removed += 1;
      }
    } catch (error) {
      console.error("Failed to clean temp file:", fullPath, error);
    }
  }

  return removed;
}
