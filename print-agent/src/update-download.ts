import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { URL } from "url";

import { sha256HexOfFile } from "./sha256-file";

/** Minimal manifest fields required for download (matches AgentUpdateManifest). */
export type DownloadManifestInput = {
  version: string;
  url: string;
  sha256: string | null;
  fileName: string;
};

export const UPDATE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALLER_NAME_RE = /^PrintMadeEasy-Agent-Setup-\d+\.\d+\.\d+\.exe$/i;
const DOWNLOAD_PATH = "/api/agent/download";
/** Soft upper bound to reject obviously absurd Content-Length (2 GiB). */
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;

export type DownloadProgress = {
  bytesDownloaded: number;
  totalBytes: number | null;
  progressPercent: number | null;
};

export type DownloadSuccess = {
  ok: true;
  filePath: string;
  sha256: string;
  bytesDownloaded: number;
};

export type DownloadFailure = {
  ok: false;
  code:
    | "INVALID_FILENAME"
    | "INVALID_URL"
    | "UNTRUSTED_ORIGIN"
    | "REDIRECT_REJECTED"
    | "HTTP_ERROR"
    | "EMPTY_BODY"
    | "TIMEOUT"
    | "CANCELLED"
    | "NETWORK"
    | "WRITE_FAILED"
    | "SHA256_MISSING"
    | "SHA256_INVALID"
    | "SHA256_MISMATCH"
    | "HTML_RESPONSE";
  message: string;
};

/**
 * Reject path traversal / absolute / unexpected installer names.
 */
export function isSafeInstallerFileName(fileName: string): boolean {
  if (typeof fileName !== "string" || !fileName) return false;
  if (fileName !== path.basename(fileName)) return false;
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(fileName)) return false;
  if (!INSTALLER_NAME_RE.test(fileName)) return false;
  if (!fileName.toLowerCase().endsWith(".exe")) return false;
  return true;
}

export function getDefaultUpdateTempDir(): string {
  return path.join(os.tmpdir(), "PrintMadeEasy-Agent-Updates");
}

export function partialDownloadPath(dir: string, fileName: string): string {
  return path.join(dir, `${fileName}.download`);
}

export function finalDownloadPath(dir: string, fileName: string): string {
  return path.join(dir, fileName);
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return parsed.origin;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Re-validate download URL against trusted API origin (no redirects).
 */
export function assertTrustedDownloadUrl(
  downloadUrl: string,
  trustedApiUrl: string,
): { ok: true; url: URL } | { ok: false; code: DownloadFailure["code"] } {
  const trusted = originOf(trustedApiUrl);
  if (!trusted) return { ok: false, code: "UNTRUSTED_ORIGIN" };
  let parsed: URL;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    return { ok: false, code: "INVALID_URL" };
  }
  if (parsed.protocol === "https:") {
    // ok
  } else if (
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  ) {
    // local only
  } else {
    return { ok: false, code: "INVALID_URL" };
  }
  if (parsed.origin !== trusted) return { ok: false, code: "UNTRUSTED_ORIGIN" };
  if (parsed.pathname !== DOWNLOAD_PATH) {
    return { ok: false, code: "UNTRUSTED_ORIGIN" };
  }
  return { ok: true, url: parsed };
}

export function normalizeExpectedSha256(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex)) return null;
  return hex;
}

async function unlinkQuiet(filePath: string) {
  try {
    await fsp.unlink(filePath);
  } catch {
    // ignore
  }
}

/**
 * Delete unfinished `*.download` files from the update temp directory.
 * Does not touch ProgramData config/jobs.
 */
export async function cleanupPartialUpdateDownloads(
  tempDir: string = getDefaultUpdateTempDir(),
): Promise<number> {
  let removed = 0;
  try {
    const entries = await fsp.readdir(tempDir);
    for (const name of entries) {
      if (!name.endsWith(".download")) continue;
      await unlinkQuiet(path.join(tempDir, name));
      removed += 1;
    }
  } catch {
    // directory may not exist yet
  }
  return removed;
}

function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 64)).toString("utf8").toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<head")
  );
}

export type DownloadInstallerOptions = {
  manifest: DownloadManifestInput;
  trustedApiUrl: string;
  tempDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: DownloadProgress) => void;
  onVerifying?: () => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  hashFile?: (filePath: string) => Promise<string>;
};

/**
 * Stream installer to temp `.download`, verify SHA-256, then rename to final name.
 * Never executes the file.
 */
export async function downloadAndVerifyInstaller(
  options: DownloadInstallerOptions,
): Promise<DownloadSuccess | DownloadFailure> {
  const {
    manifest,
    trustedApiUrl,
    tempDir = getDefaultUpdateTempDir(),
    signal,
    timeoutMs = UPDATE_DOWNLOAD_TIMEOUT_MS,
    onProgress,
    onVerifying,
    fetchImpl = fetch,
    hashFile = sha256HexOfFile,
  } = options;

  const expectedSha = normalizeExpectedSha256(manifest.sha256);
  if (manifest.sha256 == null || manifest.sha256 === "") {
    return {
      ok: false,
      code: "SHA256_MISSING",
      message: "Update verification is not available yet.",
    };
  }
  if (!expectedSha) {
    return {
      ok: false,
      code: "SHA256_INVALID",
      message: "Update verification failed. The current Agent will remain installed.",
    };
  }

  if (!isSafeInstallerFileName(manifest.fileName)) {
    return {
      ok: false,
      code: "INVALID_FILENAME",
      message: "Unable to download the update right now.",
    };
  }

  const urlCheck = assertTrustedDownloadUrl(manifest.url, trustedApiUrl);
  if (!urlCheck.ok) {
    return {
      ok: false,
      code: urlCheck.code,
      message: "Unable to download the update right now.",
    };
  }

  await fsp.mkdir(tempDir, { recursive: true });
  const partialPath = partialDownloadPath(tempDir, manifest.fileName);
  const finalPath = finalDownloadPath(tempDir, manifest.fileName);

  await unlinkQuiet(partialPath);
  await unlinkQuiet(finalPath);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      return {
        ok: false,
        code: "CANCELLED",
        message: "Update download was cancelled.",
      };
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let bytesDownloaded = 0;
  let totalBytes: number | null = null;
  let writeStream: fs.WriteStream | null = null;

  try {
    // redirect: 'error' — never follow cross-origin or any redirects.
    const response = await fetchImpl(urlCheck.url.toString(), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/octet-stream,application/exe,*/*",
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        code: "HTTP_ERROR",
        message: "Unable to download the update right now.",
      };
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      return {
        ok: false,
        code: "HTML_RESPONSE",
        message: "Unable to download the update right now.",
      };
    }

    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader) {
      const parsed = Number(lengthHeader);
      if (Number.isFinite(parsed) && parsed > 0) {
        if (parsed > MAX_INSTALLER_BYTES) {
          return {
            ok: false,
            code: "HTTP_ERROR",
            message: "Unable to download the update right now.",
          };
        }
        totalBytes = parsed;
      }
    }

    if (!response.body) {
      return {
        ok: false,
        code: "EMPTY_BODY",
        message: "Unable to download the update right now.",
      };
    }

    writeStream = fs.createWriteStream(partialPath);
    const reader = response.body.getReader();
    let firstChunkChecked = false;

    while (true) {
      if (controller.signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      const chunk = Buffer.from(value);
      if (!firstChunkChecked) {
        firstChunkChecked = true;
        if (looksLikeHtml(chunk)) {
          await new Promise<void>((resolve) => {
            writeStream?.end(() => resolve());
          });
          writeStream = null;
          await unlinkQuiet(partialPath);
          return {
            ok: false,
            code: "HTML_RESPONSE",
            message: "Unable to download the update right now.",
          };
        }
      }

      bytesDownloaded += chunk.byteLength;
      if (bytesDownloaded > MAX_INSTALLER_BYTES) {
        throw new Error("download_too_large");
      }

      await new Promise<void>((resolve, reject) => {
        writeStream!.write(chunk, (err) => (err ? reject(err) : resolve()));
      });

      const progressPercent =
        totalBytes && totalBytes > 0
          ? Math.min(99, Math.floor((bytesDownloaded / totalBytes) * 100))
          : null;
      onProgress?.({
        bytesDownloaded,
        totalBytes,
        progressPercent,
      });
    }

    await new Promise<void>((resolve, reject) => {
      writeStream!.end((err: Error | null | undefined) =>
        err ? reject(err) : resolve(),
      );
    });
    writeStream = null;

    if (bytesDownloaded <= 0) {
      await unlinkQuiet(partialPath);
      return {
        ok: false,
        code: "EMPTY_BODY",
        message: "Unable to download the update right now.",
      };
    }

    onProgress?.({
      bytesDownloaded,
      totalBytes: totalBytes ?? bytesDownloaded,
      progressPercent: 100,
    });

    onVerifying?.();
    const actualSha = (await hashFile(partialPath)).toLowerCase();
    if (actualSha !== expectedSha) {
      await unlinkQuiet(partialPath);
      return {
        ok: false,
        code: "SHA256_MISMATCH",
        message:
          "Update verification failed. The current Agent will remain installed.",
      };
    }

    await fsp.rename(partialPath, finalPath);

    return {
      ok: true,
      filePath: finalPath,
      sha256: actualSha,
      bytesDownloaded,
    };
  } catch (error) {
    if (writeStream) {
      try {
        writeStream.destroy();
      } catch {
        // ignore
      }
    }
    await unlinkQuiet(partialPath);
    await unlinkQuiet(finalPath);

    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    if (
      name === "AbortError" ||
      message.includes("aborted") ||
      controller.signal.aborted
    ) {
      const cancelledByUser = Boolean(signal?.aborted);
      return {
        ok: false,
        code: cancelledByUser ? "CANCELLED" : "TIMEOUT",
        message: cancelledByUser
          ? "Update download was cancelled."
          : "Unable to download the update right now.",
      };
    }
    return {
      ok: false,
      code: "NETWORK",
      message: "Unable to download the update right now.",
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Optional helper used only in tests to serve a fixture over loopback HTTP.
 * Production Agent download uses fetch against the trusted API origin.
 */
export function createLocalFixtureServer(fixture: Buffer): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  // Lazy require keeps http out of unused production paths while remaining available for smokes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const http = require("http") as typeof import("http");
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url !== DOWNLOAD_PATH) {
        res.statusCode = 404;
        res.end("missing");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(fixture.length));
      res.end(fixture);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no_port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}${DOWNLOAD_PATH}`,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}
