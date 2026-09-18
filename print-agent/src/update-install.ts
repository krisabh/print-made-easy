/**
 * Phase 8E — final installer validation + detached NSIS handoff.
 * Never accepts renderer-supplied paths or arguments.
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

import { isRemoteNewer } from "./semver";
import { sha256HexOfFile } from "./sha256-file";
import {
  getDefaultUpdateTempDir,
  isSafeInstallerFileName,
  normalizeExpectedSha256,
} from "./update-download";

export type InstallManifestInput = {
  version: string;
  sha256: string | null;
  fileName: string;
};

/**
 * Arguments for electron-builder NSIS assisted installer (oneClick:false).
 * Verified from app-builder-lib templates + NsisUpdater for this project's builder:
 * - `--updated` — update mode (graceful close waits; keep-shortcuts path)
 * - `/S` — NSIS silent install
 * - `--force-run` — start app after silent assisted install (required; silent alone does not)
 */
export const NSIS_UPDATE_HANDOFF_ARGS = [
  "--updated",
  "/S",
  "--force-run",
] as const;

export type HandoffValidationFailure = {
  ok: false;
  code:
    | "NOT_READY"
    | "NO_MANIFEST"
    | "VERSION_NOT_NEWER"
    | "SHA256_MISSING"
    | "SHA256_INVALID"
    | "PATH_MISSING"
    | "PATH_INVALID"
    | "FILENAME_MISMATCH"
    | "NOT_IN_UPDATE_DIR"
    | "FILE_MISSING"
    | "SHA256_MISMATCH";
  message: string;
};

export type HandoffValidationSuccess = {
  ok: true;
  installerPath: string;
  sha256: string;
  version: string;
  fileName: string;
};

export type HandoffValidationResult =
  | HandoffValidationSuccess
  | HandoffValidationFailure;

const SAFE_ERROR =
  "Unable to install the update right now. The current Agent will remain installed.";
const VERIFY_ERROR =
  "Update verification failed. The current Agent will remain installed.";

function resolveRealOrNormalize(p: string): string {
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(p)
      : fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Ensure claimed installer path is exactly updaterDir + validated fileName.
 */
export function assertInstallerPathInsideUpdateDir(
  claimedPath: string,
  updateTempDir: string,
  fileName: string,
): { ok: true; resolvedPath: string } | { ok: false; code: HandoffValidationFailure["code"] } {
  if (!isSafeInstallerFileName(fileName)) {
    return { ok: false, code: "FILENAME_MISMATCH" };
  }
  if (typeof claimedPath !== "string" || !claimedPath) {
    return { ok: false, code: "PATH_MISSING" };
  }
  if (path.basename(claimedPath) !== fileName) {
    return { ok: false, code: "FILENAME_MISMATCH" };
  }
  if (!claimedPath.toLowerCase().endsWith(".exe")) {
    return { ok: false, code: "PATH_INVALID" };
  }

  const expected = path.resolve(updateTempDir, fileName);
  const claimed = path.resolve(claimedPath);
  if (claimed !== expected) {
    try {
      const realClaimed = resolveRealOrNormalize(claimed);
      const realExpected = resolveRealOrNormalize(expected);
      if (realClaimed !== realExpected) {
        return { ok: false, code: "NOT_IN_UPDATE_DIR" };
      }
      return { ok: true, resolvedPath: realClaimed };
    } catch {
      return { ok: false, code: "NOT_IN_UPDATE_DIR" };
    }
  }

  return { ok: true, resolvedPath: claimed };
}

export type ValidateHandoffOptions = {
  status: string;
  currentVersion: string;
  manifest: InstallManifestInput | null;
  claimedInstallerPath: string | null;
  updateTempDir?: string;
  hashFile?: (filePath: string) => Promise<string>;
};

/**
 * Full pre-handoff validation including fresh SHA-256 of the on-disk file.
 */
export async function validateInstallerForHandoff(
  options: ValidateHandoffOptions,
): Promise<HandoffValidationResult> {
  const {
    status,
    currentVersion,
    manifest,
    claimedInstallerPath,
    updateTempDir = getDefaultUpdateTempDir(),
    hashFile = sha256HexOfFile,
  } = options;

  if (status !== "readyToInstall" && status !== "waitingForIdle") {
    return { ok: false, code: "NOT_READY", message: SAFE_ERROR };
  }
  if (!manifest) {
    return { ok: false, code: "NO_MANIFEST", message: SAFE_ERROR };
  }
  if (!isRemoteNewer(currentVersion, manifest.version)) {
    return { ok: false, code: "VERSION_NOT_NEWER", message: SAFE_ERROR };
  }
  if (manifest.sha256 == null || manifest.sha256 === "") {
    return {
      ok: false,
      code: "SHA256_MISSING",
      message: "Update verification is not available yet.",
    };
  }
  const expectedSha = normalizeExpectedSha256(manifest.sha256);
  if (!expectedSha) {
    return { ok: false, code: "SHA256_INVALID", message: VERIFY_ERROR };
  }
  if (!isSafeInstallerFileName(manifest.fileName)) {
    return { ok: false, code: "FILENAME_MISMATCH", message: SAFE_ERROR };
  }
  if (!claimedInstallerPath) {
    return { ok: false, code: "PATH_MISSING", message: SAFE_ERROR };
  }

  const pathCheck = assertInstallerPathInsideUpdateDir(
    claimedInstallerPath,
    updateTempDir,
    manifest.fileName,
  );
  if (!pathCheck.ok) {
    return { ok: false, code: pathCheck.code, message: SAFE_ERROR };
  }

  try {
    await fsp.access(pathCheck.resolvedPath, fs.constants.R_OK);
  } catch {
    return { ok: false, code: "FILE_MISSING", message: SAFE_ERROR };
  }

  const actualSha = (await hashFile(pathCheck.resolvedPath)).toLowerCase();
  if (actualSha !== expectedSha) {
    try {
      await fsp.unlink(pathCheck.resolvedPath);
    } catch {
      // ignore
    }
    return { ok: false, code: "SHA256_MISMATCH", message: VERIFY_ERROR };
  }

  return {
    ok: true,
    installerPath: pathCheck.resolvedPath,
    sha256: actualSha,
    version: manifest.version,
    fileName: manifest.fileName,
  };
}

export type SpawnInstallerOptions = {
  installerPath: string;
  /** Injectable for tests — must not use shell. */
  spawnImpl?: typeof spawn;
  args?: readonly string[];
};

export type SpawnInstallerResult =
  | { ok: true; pid: number | undefined }
  | {
      ok: false;
      code: "SPAWN_FAILED";
      message: string;
    };

/**
 * Detached installer launch. shell:false, no user-controlled args.
 */
export function spawnDetachedInstaller(
  options: SpawnInstallerOptions,
): SpawnInstallerResult {
  const {
    installerPath,
    spawnImpl = spawn,
    args = NSIS_UPDATE_HANDOFF_ARGS,
  } = options;

  try {
    const child: ChildProcess = spawnImpl(installerPath, [...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });

    child.on("error", (err) => {
      console.warn("Installer process error after spawn:", err.message);
    });

    // Detach from Agent lifecycle so installer continues after exit.
    child.unref();

    return { ok: true, pid: child.pid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Installer spawn failed:", message);
    return {
      ok: false,
      code: "SPAWN_FAILED",
      message: SAFE_ERROR,
    };
  }
}
