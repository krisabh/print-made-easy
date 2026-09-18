/**
 * Phase 8E — idle gate + final verify + detached installer handoff smoke.
 * Run: npx tsx scripts/phase8e-agent-update-install-smoke.ts
 *
 * Does NOT launch a real NSIS installer or touch production EXEs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn as realSpawn } from "node:child_process";

import { createUpdateChecker } from "../print-agent/src/update-check";
import {
  assertInstallerPathInsideUpdateDir,
  NSIS_UPDATE_HANDOFF_ARGS,
  spawnDetachedInstaller,
  validateInstallerForHandoff,
} from "../print-agent/src/update-install";
import { isSafeInstallerFileName } from "../print-agent/src/update-download";
import { CONFIG_PATH, resolveOpenAtLogin } from "../print-agent/src/config";
import { isPrintOperationBusy } from "../print-agent/src/job-service";

const FILE_NAME = "PrintMadeEasy-Agent-Setup-1.4.1.exe";
const FIXTURE = Buffer.from("PrintMadeEasy-Agent-Phase8E-fixture\n");
const FIXTURE_SHA = createHash("sha256").update(FIXTURE).digest("hex");

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pme-phase8e-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function fakeChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    unref: () => void;
  };
  child.pid = pid;
  child.unref = () => undefined;
  return child;
}

async function main() {
  // --- Path / filename validation ---
  for (const bad of [
    "../x.exe",
    "..\\x.exe",
    "C:\\Windows\\installer.exe",
    "/tmp/x.exe",
    "setup.exe",
  ]) {
    assert.equal(isSafeInstallerFileName(bad), false, bad);
  }
  assert.equal(isSafeInstallerFileName(FILE_NAME), true);
  console.log("Filename validation PASS");

  await withTempDir(async (tempDir) => {
    const goodPath = path.join(tempDir, FILE_NAME);
    await fsp.writeFile(goodPath, FIXTURE);

    const okPath = assertInstallerPathInsideUpdateDir(
      goodPath,
      tempDir,
      FILE_NAME,
    );
    assert.equal(okPath.ok, true);

    const evil = assertInstallerPathInsideUpdateDir(
      path.join(os.tmpdir(), FILE_NAME),
      tempDir,
      FILE_NAME,
    );
    assert.equal(evil.ok, false);
    console.log("Path validation PASS");

    // Final SHA-256 match
    const match = await validateInstallerForHandoff({
      status: "readyToInstall",
      currentVersion: "1.4.0",
      manifest: {
        version: "1.4.1",
        sha256: FIXTURE_SHA,
        fileName: FILE_NAME,
      },
      claimedInstallerPath: goodPath,
      updateTempDir: tempDir,
    });
    assert.equal(match.ok, true);
    console.log("Final SHA-256 match PASS");

    // Final SHA-256 mismatch deletes file
    await fsp.writeFile(goodPath, FIXTURE);
    const mismatch = await validateInstallerForHandoff({
      status: "readyToInstall",
      currentVersion: "1.4.0",
      manifest: {
        version: "1.4.1",
        sha256: createHash("sha256").update("wrong").digest("hex"),
        fileName: FILE_NAME,
      },
      claimedInstallerPath: goodPath,
      updateTempDir: tempDir,
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "SHA256_MISMATCH");
    await assert.rejects(fsp.access(goodPath));
    console.log("Final SHA-256 mismatch PASS (file deleted)");

    // Missing installer
    const missing = await validateInstallerForHandoff({
      status: "readyToInstall",
      currentVersion: "1.4.0",
      manifest: {
        version: "1.4.1",
        sha256: FIXTURE_SHA,
        fileName: FILE_NAME,
      },
      claimedInstallerPath: path.join(tempDir, FILE_NAME),
      updateTempDir: tempDir,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "FILE_MISSING");
    console.log("Missing installer PASS");
  });

  // Idle / busy gate + spawn + exit
  await withTempDir(async (tempDir) => {
    const installerPath = path.join(tempDir, FILE_NAME);
    await fsp.writeFile(installerPath, FIXTURE);

    let busy = true;
    let exitCalls = 0;
    let lastSpawnArgs: {
      file: string;
      args: string[];
      opts: Record<string, unknown>;
    } | null = null;

    const checker = createUpdateChecker({
      getCurrentVersion: () => "1.4.0",
      getApiUrl: () => "https://clauras.com",
      getUpdateTempDir: () => tempDir,
      isBusy: () => busy,
      requestAgentExitForUpdate: () => {
        exitCalls += 1;
      },
      spawnInstaller: ({ installerPath: p }) => {
        lastSpawnArgs = {
          file: p,
          args: [...NSIS_UPDATE_HANDOFF_ARGS],
          opts: { detached: true, shell: false },
        };
        return spawnDetachedInstaller({
          installerPath: p,
          spawnImpl: ((file, args, opts) => {
            lastSpawnArgs = {
              file: String(file),
              args: args as string[],
              opts: opts as Record<string, unknown>,
            };
            assert.equal(opts?.shell, false);
            assert.equal(opts?.detached, true);
            assert.equal(opts?.stdio, "ignore");
            return fakeChild(999) as ReturnType<typeof realSpawn>;
          }) as typeof realSpawn,
        });
      },
    });

    checker.setReadyForInstallForTests({
      manifest: {
        version: "1.4.1",
        url: "https://clauras.com/api/agent/download",
        sha256: FIXTURE_SHA,
        notes: "test",
        fileName: FILE_NAME,
      },
      installerPath,
    });

    // Busy gate
    const busyResult = await checker.startUpdate();
    assert.equal(busyResult.accepted, false);
    assert.equal(busyResult.code, "WAITING_FOR_IDLE");
    assert.equal(checker.getPublicState().status, "waitingForIdle");
    assert.equal(exitCalls, 0);
    assert.equal(lastSpawnArgs, null);
    console.log("Busy gate PASS");

    // Idle → handoff
    busy = false;
    const idleResult = await checker.startUpdate();
    assert.equal(idleResult.accepted, true);
    assert.equal(idleResult.status, "installing");
    assert.equal(checker.getPublicState().status, "installing");
    assert.equal(exitCalls, 1);
    assert.ok(lastSpawnArgs);
    assert.equal(lastSpawnArgs!.file, path.resolve(installerPath));
    assert.deepEqual(lastSpawnArgs!.args, [...NSIS_UPDATE_HANDOFF_ARGS]);
    assert.equal(lastSpawnArgs!.opts.shell, false);
    assert.equal(lastSpawnArgs!.opts.detached, true);
    console.log("Idle gate + detached spawn PASS");
    console.log("No shell execution PASS");
  });

  // Spawn failure keeps Agent running
  await withTempDir(async (tempDir) => {
    const installerPath = path.join(tempDir, FILE_NAME);
    await fsp.writeFile(installerPath, FIXTURE);
    let exitCalls = 0;

    const checker = createUpdateChecker({
      getCurrentVersion: () => "1.4.0",
      getApiUrl: () => "https://clauras.com",
      getUpdateTempDir: () => tempDir,
      isBusy: () => false,
      requestAgentExitForUpdate: () => {
        exitCalls += 1;
      },
      spawnInstaller: () => ({
        ok: false,
        code: "SPAWN_FAILED",
        message:
          "Unable to install the update right now. The current Agent will remain installed.",
      }),
    });

    checker.setReadyForInstallForTests({
      manifest: {
        version: "1.4.1",
        url: "https://clauras.com/api/agent/download",
        sha256: FIXTURE_SHA,
        notes: "test",
        fileName: FILE_NAME,
      },
      installerPath,
    });

    const result = await checker.startUpdate();
    assert.equal(result.accepted, false);
    assert.equal(result.code, "SPAWN_FAILED");
    assert.equal(exitCalls, 0);
    assert.equal(checker.getPublicState().status, "readyToInstall");
    console.log("Spawn failure PASS (Agent remains)");
  });

  // Renderer cannot supply path/args — IPC startUpdate takes no installer args
  {
    const src = await fsp.readFile(
      path.join(process.cwd(), "print-agent", "src", "main.ts"),
      "utf8",
    );
    assert.match(src, /agent:start-update/);
    assert.equal(
      /ipcMain\.handle\("agent:start-update",\s*async\s*\([^)]*\)/.test(src) &&
        !/ipcMain\.handle\("agent:start-update",\s*async\s*\([^)]*installer/.test(
          src,
        ),
      true,
    );
    const preload = await fsp.readFile(
      path.join(process.cwd(), "print-agent", "src", "preload.ts"),
      "utf8",
    );
    assert.match(preload, /startUpdate:\s*\(\)\s*=>/);
    assert.equal(preload.includes("startUpdate: (path"), false);
    console.log("Renderer path/args protection PASS");
  }

  // No shell:true / exec in update-install
  {
    const installSrc = await fsp.readFile(
      path.join(process.cwd(), "print-agent", "src", "update-install.ts"),
      "utf8",
    );
    assert.equal(installSrc.includes("shell: true"), false);
    assert.equal(installSrc.includes("shell:true"), false);
    assert.equal(installSrc.includes("exec("), false);
    assert.equal(installSrc.includes("execFile("), false);
    assert.equal(installSrc.includes("shell: false"), true);
    assert.equal(installSrc.includes("detached: true"), true);
    console.log("Detached spawn + no shell PASS");
  }

  // Config / auto-start preservation logic (code-level)
  {
    assert.ok(CONFIG_PATH.includes("PrintMadeEasy"));
    assert.ok(CONFIG_PATH.includes("agent-config.json"));
    assert.equal(resolveOpenAtLogin(true), true);
    assert.equal(resolveOpenAtLogin(false), false);
    assert.equal(resolveOpenAtLogin(undefined), true);

    const nsh = await fsp.readFile(
      path.join(process.cwd(), "print-agent", "build", "installer.nsh"),
      "utf8",
    );
    assert.match(nsh, /\$\{ifNot\} \$\{isUpdated\}/);
    assert.match(nsh, /DeleteRegValue HKCU/);
    console.log("Config + auto-start preservation logic PASS");
  }

  // Multi-device: handoff modules must not touch auth/agentId
  {
    for (const name of ["update-install.ts", "update-check.ts"]) {
      const src = await fsp.readFile(
        path.join(process.cwd(), "print-agent", "src", name),
        "utf8",
      );
      assert.equal(src.includes("authToken"), false, name);
      assert.equal(src.includes("createDeviceAgentId"), false, name);
      assert.equal(src.includes("agent-config"), false, name);
    }
    console.log("Multi-device preservation (no auth mutation) PASS");
  }

  // Busy helper exists and is idle by default outside print
  assert.equal(typeof isPrintOperationBusy, "function");
  assert.equal(isPrintOperationBusy(), false);
  console.log("Idle helper PASS");

  // Public state never exposes installer path after ready seed
  await withTempDir(async (tempDir) => {
    const installerPath = path.join(tempDir, FILE_NAME);
    await fsp.writeFile(installerPath, FIXTURE);
    const checker = createUpdateChecker({
      getCurrentVersion: () => "1.4.0",
      getApiUrl: () => "https://clauras.com",
      getUpdateTempDir: () => tempDir,
      isBusy: () => false,
      requestAgentExitForUpdate: () => undefined,
      spawnInstaller: () => ({ ok: true, pid: 1 }),
    });
    checker.setReadyForInstallForTests({
      manifest: {
        version: "1.4.1",
        url: "https://clauras.com/api/agent/download",
        sha256: FIXTURE_SHA,
        notes: "t",
        fileName: FILE_NAME,
      },
      installerPath,
    });
    const json = JSON.stringify(checker.getPublicState());
    assert.equal(json.includes(tempDir), false);
    assert.equal(json.includes(installerPath), false);
    console.log("Path leakage check PASS");
  });

  console.log("\nPhase 8E agent update-install smoke: ALL PASS");
  console.log(
    "NOTE: Local NSIS integration (real EXE upgrade / ProgramData live) is NOT VERIFIED in this smoke.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
