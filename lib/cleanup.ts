import { cleanupExpiredDocuments } from "@/lib/print-agent-service";

let lastCleanupAt = 0;
const CLEANUP_MIN_INTERVAL_MS = 60_000; // at most once per minute per process

/**
 * Hostinger-compatible document cleanup.
 * Does not rely on a long-lived background timer.
 * Safe to call from request handlers (upload, dashboard, agent, health).
 */
export async function runDocumentCleanupIfDue(force = false) {
  const now = Date.now();
  if (!force && now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) {
    return { skipped: true, deleted: 0 };
  }

  lastCleanupAt = now;

  try {
    const deleted = await cleanupExpiredDocuments();
    if (deleted > 0) {
      console.info(`[cleanup] Deleted ${deleted} expired document file(s).`);
    }
    return { skipped: false, deleted };
  } catch (error) {
    console.error("[cleanup] Failed:", error);
    return { skipped: false, deleted: 0, error: true };
  }
}
