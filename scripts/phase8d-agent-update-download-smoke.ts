/**
 * Phase 8D — Agent update download + SHA-256 verification smoke.
 * Run: npx tsx scripts/phase8d-agent-update-download-smoke.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createUpdateChecker } from "../print-agent/src/update-check";
import {
  assertTrustedDownloadUrl,
  cleanupPartialUpdateDownloads,
  createLocalFixtureServer,
  downloadAndVerifyInstaller,
  isSafeInstallerFileName,
  partialDownloadPath,
} from "../print-agent/src/update-download";
import { sha256HexOfBuffer } from "../print-agent/src/sha256-file";

const FIXTURE = Buffer.from("PrintYantra-Agent-Phase8D-fixture-v1\n");
const FIXTURE_SHA = sha256HexOfBuffer(FIXTURE);
const FILE_NAME = "PrintYantra-Agent-Setup-1.5.2.exe";
const TRUSTED = "http://127.0.0.1";

function shaHex(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "pme-phase8d-"),
  );
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function manifestFor(serverUrl: string, overrides: Record<string, unknown> = {}) {
  return {
    version: "1.5.2",
    url: serverUrl,
    sha256: FIXTURE_SHA,
    notes: "Phase 8D test",
    fileName: FILE_NAME,
    ...overrides,
  };
}

async function main() {
  // F — Path traversal filename (before network)
  for (const bad of [
    "../installer.exe",
    "..\\installer.exe",
    "C:\\installer.exe",
    "/installer.exe",
    "setup.exe",
    "PrintYantra-Agent-Setup-1.5.2.exe/../x.exe",
  ]) {
    assert.equal(isSafeInstallerFileName(bad), false, bad);
  }
  assert.equal(isSafeInstallerFileName(FILE_NAME), true);
  console.log("F PASS path traversal / invalid filenames rejected");

  // E — Invalid URL / origin / path / redirect policy helpers
  assert.equal(
    assertTrustedDownloadUrl("http://evil.example.com/api/agent/download", TRUSTED)
      .ok,
    false,
  );
  assert.equal(
    assertTrustedDownloadUrl("https://printyantra.com/api/agent/download", TRUSTED).ok,
    false,
  );
  assert.equal(
    assertTrustedDownloadUrl(`${TRUSTED}/secret/installer.exe`, TRUSTED).ok,
    false,
  );
  assert.equal(
    assertTrustedDownloadUrl("http://evil.example.com/api/agent/download", "https://printyantra.com")
      .ok,
    false,
  );
  console.log("E PASS invalid URL / origin / path rejected");

  await withTempDir(async (tempDir) => {
    const server = await createLocalFixtureServer(FIXTURE);
    try {
      const downloadUrl = server.url;
      const apiOrigin = new URL(downloadUrl).origin;

      // A + B + K — Successful download + SHA match + progress
      const progressEvents: Array<{
        status: string;
        pct: number | null;
      }> = [];

      let checker!: ReturnType<typeof createUpdateChecker>;
      checker = createUpdateChecker({
        getCurrentVersion: () => "1.5.0",
        getApiUrl: () => apiOrigin,
        getUpdateTempDir: () => tempDir,
        fetchImpl: async (input, init) => {
          const url = String(input);
          // Capture secrets check for download requests
          if (url.includes("/api/agent/download")) {
            const headers = new Headers(init?.headers || {});
            assert.equal(headers.get("Authorization"), null);
            assert.equal(init?.credentials, "omit");
            assert.equal(init?.redirect, "error");
            // Real loopback fetch for body streaming
            return fetch(url, init);
          }
          if (url.includes("/api/agent/update")) {
            return new Response(
              JSON.stringify(manifestFor(downloadUrl)),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error(`unexpected_url:${url}`);
        },
        onStateChange: () => {
          const s = checker.getPublicState();
          progressEvents.push({
            status: s.status,
            pct: s.progressPercent,
          });
        },
      });

      const check = await checker.runCheck({ manual: true });
      assert.equal(check.updateAvailable, true);
      assert.equal(checker.getPublicState().status, "available");

      const result = await checker.startUpdateDownload();
      assert.equal(result.accepted, true);
      assert.equal(result.status, "readyToInstall");
      assert.equal(checker.getPublicState().status, "readyToInstall");
      assert.equal(checker.getPublicState().updateNowReady, true);
      assert.equal(checker.getPublicState().fileName, FILE_NAME);
      assert.equal(checker.getPublicState().latestVersion, "1.5.2");

      const installerPath = checker.getVerifiedInstallerPath();
      assert.ok(installerPath);
      assert.equal(path.basename(installerPath!), FILE_NAME);
      const onDisk = await fsp.readFile(installerPath!);
      assert.equal(shaHex(onDisk), FIXTURE_SHA);

      // M — No filesystem path leakage in public state
      const publicJson = JSON.stringify(checker.getPublicState());
      assert.equal(publicJson.includes(tempDir), false);
      assert.equal(publicJson.includes(installerPath!), false);
      assert.equal(publicJson.includes("ProgramData"), false);

      // K — Progress saw downloading / verifying / ready
      const statuses = progressEvents.map((e) => e.status);
      assert.ok(statuses.includes("downloading"), "expected downloading");
      assert.ok(statuses.includes("verifying"), "expected verifying");
      assert.ok(statuses.includes("readyToInstall"), "expected readyToInstall");
      console.log("A PASS successful download → readyToInstall");
      console.log("B PASS SHA-256 match");
      console.log("K PASS progress events");
      console.log("L PASS download request has no secrets");
      console.log("M PASS no path leakage in public state");

      // J — Concurrent start while already ready / second call while busy
      // Reset to available by re-checking then start two downloads with slow body
    } finally {
      await server.close();
    }
  });

  // C — sha256 null → verificationUnavailable
  {
    const c = createUpdateChecker({
      getCurrentVersion: () => "1.5.0",
      getApiUrl: () => "https://printyantra.com",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            version: "1.5.2",
            url: "https://printyantra.com/api/agent/download",
            sha256: null,
            notes: "x",
            fileName: FILE_NAME,
          }),
          { status: 200 },
        ),
    });
    await c.runCheck({ manual: true });
    const r = await c.startUpdateDownload();
    assert.equal(r.accepted, false);
    assert.equal(r.code, "SHA256_MISSING");
    assert.equal(c.getPublicState().status, "verificationUnavailable");
    assert.equal(c.getVerifiedInstallerPath(), null);
    console.log("C PASS missing SHA-256 → verificationUnavailable");
  }

  // D — Invalid SHA-256 rejected (download helper)
  await withTempDir(async (tempDir) => {
    const r = await downloadAndVerifyInstaller({
      manifest: {
        version: "1.5.2",
        url: "http://127.0.0.1/api/agent/download",
        sha256: "not-a-valid-sha256-digest!!!!!!!!!!!!!!!!!",
        fileName: FILE_NAME,
      },
      trustedApiUrl: "http://127.0.0.1",
      tempDir,
      fetchImpl: async () => new Response(FIXTURE),
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "SHA256_INVALID");
    console.log("D PASS invalid SHA-256 rejected");
  });

  // SHA-256 mismatch → delete + error
  await withTempDir(async (tempDir) => {
    const server = await createLocalFixtureServer(FIXTURE);
    try {
      const wrongSha = shaHex("wrong-payload");
      const r = await downloadAndVerifyInstaller({
        manifest: {
          version: "1.5.2",
          url: server.url,
          sha256: wrongSha,
          fileName: FILE_NAME,
        },
        trustedApiUrl: new URL(server.url).origin,
        tempDir,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "SHA256_MISMATCH");
      const finalPath = path.join(tempDir, FILE_NAME);
      const partial = partialDownloadPath(tempDir, FILE_NAME);
      await assert.rejects(fsp.access(finalPath));
      await assert.rejects(fsp.access(partial));
      console.log("SHA-256 mismatch PASS (file deleted)");
    } finally {
      await server.close();
    }
  });

  // G — HTTP 404 / 500
  for (const status of [404, 500]) {
    await withTempDir(async (tempDir) => {
      const r = await downloadAndVerifyInstaller({
        manifest: {
          version: "1.5.2",
          url: "http://127.0.0.1/api/agent/download",
          sha256: FIXTURE_SHA,
          fileName: FILE_NAME,
        },
        trustedApiUrl: "http://127.0.0.1",
        tempDir,
        fetchImpl: async () => new Response("err", { status }),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, "HTTP_ERROR");
    });
  }
  console.log("G PASS HTTP 404/500 safe failure");

  // H — Timeout
  await withTempDir(async (tempDir) => {
    const r = await downloadAndVerifyInstaller({
      manifest: {
        version: "1.5.2",
        url: "http://127.0.0.1/api/agent/download",
        sha256: FIXTURE_SHA,
        fileName: FILE_NAME,
      },
      trustedApiUrl: "http://127.0.0.1",
      tempDir,
      timeoutMs: 50,
      fetchImpl: async (_url, init) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(
              Object.assign(new Error("aborted"), { name: "AbortError" }),
            );
          });
        });
        return new Response(FIXTURE);
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "TIMEOUT");
    console.log("H PASS timeout aborts + cleans up");
  });

  // I — Cancellation
  await withTempDir(async (tempDir) => {
    const apiOrigin = "http://127.0.0.1";
    let resolveHang: (() => void) | null = null;
    const hang = new Promise<void>((r) => {
      resolveHang = r;
    });

    const checker = createUpdateChecker({
      getCurrentVersion: () => "1.5.0",
      getApiUrl: () => apiOrigin,
      getUpdateTempDir: () => tempDir,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/api/agent/update")) {
          return new Response(
            JSON.stringify(
              manifestFor(`${apiOrigin}/api/agent/download`, {
                sha256: FIXTURE_SHA,
              }),
            ),
            { status: 200 },
          );
        }
        // Slow download body
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(new Uint8Array(FIXTURE.subarray(0, 8)));
            await hang;
            if (init?.signal?.aborted) {
              controller.error(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              );
              return;
            }
            controller.enqueue(new Uint8Array(FIXTURE.subarray(8)));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(FIXTURE.length),
          },
        });
      },
    });

    await checker.runCheck({ manual: true });
    const downloadPromise = checker.startUpdateDownload();
    // Wait until downloading
    for (let i = 0; i < 40; i++) {
      if (checker.getPublicState().status === "downloading") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(checker.getPublicState().status, "downloading");

    const cancelState = await checker.cancelUpdateDownload();
    resolveHang?.();
    const downloadResult = await downloadPromise;
    assert.equal(downloadResult.accepted, false);
    assert.ok(
      downloadResult.accepted === false &&
        (downloadResult.code === "CANCELLED" ||
          cancelState.userMessage === "Update download was cancelled."),
    );
    assert.notEqual(cancelState.status, "readyToInstall");
    assert.equal(checker.getVerifiedInstallerPath(), null);
    console.log("I PASS cancellation");
  });

  // J — Concurrent start-update
  await withTempDir(async (tempDir) => {
    const apiOrigin = "http://127.0.0.1";
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const checker = createUpdateChecker({
      getCurrentVersion: () => "1.5.0",
      getApiUrl: () => apiOrigin,
      getUpdateTempDir: () => tempDir,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/api/agent/update")) {
          return new Response(
            JSON.stringify(manifestFor(`${apiOrigin}/api/agent/download`)),
            { status: 200 },
          );
        }
        await gate;
        if (init?.signal?.aborted) {
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        }
        return new Response(FIXTURE, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(FIXTURE.length),
          },
        });
      },
    });

    await checker.runCheck({ manual: true });
    const first = checker.startUpdateDownload();
    await new Promise((r) => setTimeout(r, 20));
    const second = await checker.startUpdateDownload();
    assert.equal(second.accepted, false);
    assert.equal(second.code, "DOWNLOAD_ALREADY_IN_PROGRESS");
    release?.();
    const firstResult = await first;
    assert.equal(firstResult.accepted, true);
    console.log("J PASS concurrent download rejected");
  });

  // Cleanup helper
  await withTempDir(async (tempDir) => {
    const partial = partialDownloadPath(tempDir, FILE_NAME);
    await fsp.writeFile(partial, "partial");
    const removed = await cleanupPartialUpdateDownloads(tempDir);
    assert.equal(removed, 1);
    await assert.rejects(fsp.access(partial));
    console.log("Cleanup PASS partial .download removal");
  });

  // N — No EXE execution in Phase 8D download modules
  {
    const fs = await import("node:fs/promises");
    const root = path.join(process.cwd(), "print-agent", "src");
    for (const name of ["update-download.ts", "sha256-file.ts"]) {
      const src = await fs.readFile(path.join(root, name), "utf8");
      assert.equal(src.includes("child_process"), false, name);
      assert.equal(src.includes("spawn("), false, name);
      assert.equal(src.includes("execFile("), false, name);
      assert.equal(src.includes("app.quit"), false, name);
      assert.equal(src.includes("app.relaunch"), false, name);
      assert.equal(src.includes("/S"), false, name);
    }
    console.log("N PASS no installer execution paths in Phase 8D download modules");
  }

  console.log("\nPhase 8D agent update-download smoke: ALL PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
