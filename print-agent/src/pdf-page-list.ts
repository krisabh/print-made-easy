/**
 * Expand Sumatra-style page lists and count PDF pages (Agent-local).
 */

import fs from "fs/promises";
import { PDFDocument } from "pdf-lib";

/**
 * Parse "all" / undefined / "1-5,8" into a sorted unique 1-based page list
 * clamped to totalPages.
 */
export function resolvePrintPageList(
  pageRange: string | undefined | null,
  totalPages: number,
): number[] {
  const total = Math.max(0, Math.floor(totalPages));
  if (total < 1) return [];

  const raw = (pageRange || "all").trim().toLowerCase();
  if (!raw || raw === "all") {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) {
        if (p >= 1 && p <= total) pages.add(p);
      }
      continue;
    }
    const n = Number(token);
    if (Number.isFinite(n) && n >= 1 && n <= total) {
      pages.add(Math.floor(n));
    }
  }

  return [...pages].sort((a, b) => a - b);
}

export async function countPdfPages(filePath: string): Promise<number> {
  const bytes = await fs.readFile(filePath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}
