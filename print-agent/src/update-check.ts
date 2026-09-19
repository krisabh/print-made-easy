import { isRemoteNewer, parseSemver } from "./semver";
import {
  cleanupPartialUpdateDownloads,
  downloadAndVerifyInstaller,
  getDefaultUpdateTempDir,
  isSafeInstallerFileName,
  type DownloadFailure,
} from "./update-download";
import {
  spawnDetachedInstaller,
  validateInstallerForHandoff,
  type HandoffValidationFailure,
} from "./update-install";

/** Mirrors server AgentUpdateManifest (Phase 8B). */
export type AgentUpdateManifest = {
  version: string;
  url: string;
  sha256: string | null;
  notes: string;
  fileName: string;
};

export type UpdateUiStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "error"
  | "downloading"
  | "verifying"
  | "readyToInstall"
  | "waitingForIdle"
  | "installing"
  | "verificationUnavailable";

/** Safe subset for renderer / IPC (never includes local filesystem paths). */
export type UpdatePublicState = {
  status: UpdateUiStatus;
  currentVersion: string;
  latestVersion: string | null;
  notes: string | null;
  fileName: string | null;
  updateAvailable: boolean;
  /** User dismissed the banner via Later (until next successful newer check). */
  dismissed: boolean;
  /** Manual-check friendly message; null for silent background failures. */
  userMessage: string | null;
  /** True only when SHA-256 verified installer is ready (Phase 8E will install). */
  updateNowReady: boolean;
  progressPercent: number | null;
  bytesDownloaded: number;
  totalBytes: number | null;
};

export type UpdateCheckResult = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  manifest?: AgentUpdateManifest;
  error?: string;
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const INSTALLER_NAME_RE = /^PrintYantra-Agent-Setup-\d+\.\d+\.\d+\.exe$/i;
const UPDATE_PATH = "/api/agent/update";
const DOWNLOAD_PATH = "/api/agent/download";
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const NOTES_DISPLAY_MAX = 280;

export function truncateNotes(notes: string, max = NOTES_DISPLAY_MAX): string {
  const trimmed = notes.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function isSha256HexOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    // Packaged production uses https; allow http only for local API (localhost).
    if (parsed.protocol === "http:") {
      const host = parsed.hostname.toLowerCase();
      if (host !== "localhost" && host !== "127.0.0.1") return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Validate untrusted manifest JSON against the Agent's configured API origin.
 */
export function validateAgentUpdateManifest(
  raw: unknown,
  trustedApiUrl: string,
): { ok: true; manifest: AgentUpdateManifest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "manifest_not_object" };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.version !== "string" || !parseSemver(obj.version)) {
    return { ok: false, reason: "invalid_version" };
  }
  if (typeof obj.url !== "string") {
    return { ok: false, reason: "invalid_url" };
  }
  if (typeof obj.notes !== "string") {
    return { ok: false, reason: "invalid_notes" };
  }
  if (typeof obj.fileName !== "string" || !INSTALLER_NAME_RE.test(obj.fileName)) {
    return { ok: false, reason: "invalid_fileName" };
  }
  if (!isSha256HexOrNull(obj.sha256)) {
    return { ok: false, reason: "invalid_sha256" };
  }

  const trustedOrigin = originOf(trustedApiUrl);
  if (!trustedOrigin) {
    return { ok: false, reason: "invalid_trusted_origin" };
  }

  let downloadUrl: URL;
  try {
    downloadUrl = new URL(obj.url);
  } catch {
    return { ok: false, reason: "url_parse_failed" };
  }

  if (downloadUrl.protocol === "https:") {
    // ok
  } else if (
    downloadUrl.protocol === "http:" &&
    (downloadUrl.hostname === "localhost" ||
      downloadUrl.hostname === "127.0.0.1")
  ) {
    // local development only
  } else {
    return { ok: false, reason: "url_not_https" };
  }

  if (downloadUrl.origin !== trustedOrigin) {
    return { ok: false, reason: "url_untrusted_origin" };
  }
  if (downloadUrl.pathname !== DOWNLOAD_PATH) {
    return { ok: false, reason: "url_unexpected_path" };
  }

  // Filename should match declared version when both are semver-shaped.
  const expectedName = `PrintYantra-Agent-Setup-${obj.version}.exe`;
  if (obj.fileName.toLowerCase() !== expectedName.toLowerCase()) {
    return { ok: false, reason: "fileName_version_mismatch" };
  }

  return {
    ok: true,
    manifest: {
      version: obj.version.trim(),
      url: downloadUrl.toString(),
      sha256: obj.sha256,
      notes: obj.notes,
      fileName: obj.fileName,
    },
  };
}

export type UpdateCheckDeps = {
  getCurrentVersion: () => string;
  getApiUrl: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  getUpdateTempDir?: () => string;
  onStateChange?: () => void;
  /** Return true while printing / converting / test-print is active. */
  isBusy?: () => boolean;
  /**
   * Called after installer spawn succeeds. Must exit the Agent process.
   * Injected so unit tests never trigger Electron process exit.
   */
  requestAgentExitForUpdate?: () => void;
  /** Injectable spawn for tests. */
  spawnInstaller?: typeof spawnDetachedInstaller;
  /** Injectable hash for tests. */
  hashFile?: (filePath: string) => Promise<string>;
};

export type StartUpdateResult =
  | {
      accepted: true;
      status: UpdateUiStatus;
      message: string;
    }
  | {
      accepted: false;
      code:
        | "NO_UPDATE_AVAILABLE"
        | "DOWNLOAD_ALREADY_IN_PROGRESS"
        | "INSTALL_ALREADY_IN_PROGRESS"
        | "WAITING_FOR_IDLE"
        | "SHA256_MISSING"
        | "SHA256_INVALID"
        | DownloadFailure["code"]
        | HandoffValidationFailure["code"]
        | "SPAWN_FAILED"
        | "DOWNLOAD_FAILED";
      message: string;
    };

/**
 * Isolated update checker with single-flight network requests + Phase 8D download.
 */
export function createUpdateChecker(deps: UpdateCheckDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let inFlight: Promise<UpdateCheckResult> | null = null;
  let downloadInFlight: Promise<StartUpdateResult> | null = null;
  let lastManifest: AgentUpdateManifest | null = null;
  /** Main-process only — never sent to renderer. */
  let verifiedInstallerPath: string | null = null;
  let downloadAbort: AbortController | null = null;
  let publicState: UpdatePublicState = {
    status: "idle",
    currentVersion: deps.getCurrentVersion(),
    latestVersion: null,
    notes: null,
    fileName: null,
    updateAvailable: false,
    dismissed: false,
    userMessage: null,
    updateNowReady: false,
    progressPercent: null,
    bytesDownloaded: 0,
    totalBytes: null,
  };

  function emitChange() {
    deps.onStateChange?.();
  }

  function getPublicState(): UpdatePublicState {
    return { ...publicState, currentVersion: deps.getCurrentVersion() };
  }

  function setState(patch: Partial<UpdatePublicState>) {
    publicState = {
      ...publicState,
      ...patch,
      currentVersion: deps.getCurrentVersion(),
    };
    emitChange();
  }

  function dismissAvailable() {
    if (publicState.status === "available") {
      setState({ dismissed: true, userMessage: null });
    }
  }

  function isDownloadBusy() {
    return (
      downloadInFlight != null ||
      publicState.status === "downloading" ||
      publicState.status === "verifying"
    );
  }

  async function runCheck(options?: {
    manual?: boolean;
  }): Promise<UpdateCheckResult> {
    const manual = Boolean(options?.manual);
    const currentVersion = deps.getCurrentVersion();

    if (
      isDownloadBusy() ||
      publicState.status === "readyToInstall" ||
      publicState.status === "waitingForIdle" ||
      publicState.status === "installing"
    ) {
      return {
        updateAvailable: publicState.updateAvailable,
        currentVersion,
        latestVersion: publicState.latestVersion ?? undefined,
        manifest: lastManifest ?? undefined,
      };
    }

    if (inFlight) {
      return inFlight;
    }

    setState({
      status: "checking",
      userMessage: manual ? "Checking for updates..." : null,
      progressPercent: null,
      bytesDownloaded: 0,
      totalBytes: null,
      updateNowReady: false,
    });

    inFlight = (async (): Promise<UpdateCheckResult> => {
      try {
        const apiUrl = deps.getApiUrl().replace(/\/$/, "");
        const endpoint = `${apiUrl}${UPDATE_PATH}`;
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          UPDATE_CHECK_TIMEOUT_MS,
        );

        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
            credentials: "omit",
            cache: "no-store",
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          throw new Error(`http_${response.status}`);
        }

        const raw = (await response.json()) as unknown;
        const validated = validateAgentUpdateManifest(raw, apiUrl);
        if (!validated.ok) {
          throw new Error(validated.reason);
        }

        const manifest = validated.manifest;
        const newer = isRemoteNewer(currentVersion, manifest.version);

        if (!newer) {
          lastManifest = manifest;
          verifiedInstallerPath = null;
          setState({
            status: "upToDate",
            updateAvailable: false,
            latestVersion: manifest.version,
            notes: null,
            fileName: null,
            dismissed: false,
            userMessage: manual ? "You're up to date." : null,
            updateNowReady: false,
            progressPercent: null,
            bytesDownloaded: 0,
            totalBytes: null,
          });
          console.log("Agent is up to date");
          return {
            updateAvailable: false,
            currentVersion,
            latestVersion: manifest.version,
            manifest,
          };
        }

        const previousLatest = publicState.latestVersion;
        lastManifest = manifest;
        verifiedInstallerPath = null;
        setState({
          status: "available",
          updateAvailable: true,
          latestVersion: manifest.version,
          notes: truncateNotes(manifest.notes),
          fileName: manifest.fileName,
          dismissed:
            previousLatest === manifest.version ? publicState.dismissed : false,
          userMessage: manual ? "New version available." : null,
          updateNowReady: false,
          progressPercent: null,
          bytesDownloaded: 0,
          totalBytes: null,
        });
        console.log(`Update available: ${manifest.version}`);
        return {
          updateAvailable: true,
          currentVersion,
          latestVersion: manifest.version,
          manifest,
        };
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "update_check_failed";
        console.warn("Update check failed:", code);
        setState({
          status: "error",
          updateAvailable: false,
          userMessage: manual
            ? "Unable to check for updates right now."
            : null,
          updateNowReady: false,
          progressPercent: null,
          bytesDownloaded: 0,
          totalBytes: null,
        });
        return {
          updateAvailable: false,
          currentVersion,
          error: code,
        };
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  async function startUpdateDownload(): Promise<StartUpdateResult> {
    if (isDownloadBusy()) {
      return {
        accepted: false,
        code: "DOWNLOAD_ALREADY_IN_PROGRESS",
        message: "An update download is already in progress.",
      };
    }

    if (publicState.status === "installing") {
      return {
        accepted: false,
        code: "INSTALL_ALREADY_IN_PROGRESS",
        message: "An update installation is already in progress.",
      };
    }

    const currentVersion = deps.getCurrentVersion();
    const apiUrl = deps.getApiUrl().replace(/\/$/, "");
    const manifest = lastManifest;

    if (
      !manifest ||
      publicState.status !== "available" ||
      !publicState.updateAvailable ||
      !isRemoteNewer(currentVersion, manifest.version) ||
      !isSafeInstallerFileName(manifest.fileName)
    ) {
      return {
        accepted: false,
        code: "NO_UPDATE_AVAILABLE",
        message: "Unable to download the update right now.",
      };
    }

    if (manifest.sha256 == null || manifest.sha256 === "") {
      setState({
        status: "verificationUnavailable",
        userMessage: "Update verification is not available yet.",
        updateNowReady: false,
        dismissed: false,
      });
      return {
        accepted: false,
        code: "SHA256_MISSING",
        message: "Update verification is not available yet.",
      };
    }

    downloadAbort = new AbortController();
    const abort = downloadAbort;

    downloadInFlight = (async (): Promise<StartUpdateResult> => {
      try {
        setState({
          status: "downloading",
          dismissed: false,
          userMessage: "Downloading update...",
          updateNowReady: false,
          progressPercent: 0,
          bytesDownloaded: 0,
          totalBytes: null,
          fileName: manifest.fileName,
          latestVersion: manifest.version,
        });

        const result = await downloadAndVerifyInstaller({
          manifest,
          trustedApiUrl: apiUrl,
          tempDir: deps.getUpdateTempDir?.() ?? getDefaultUpdateTempDir(),
          signal: abort.signal,
          fetchImpl,
          onProgress: (progress) => {
            if (publicState.status !== "downloading") return;
            setState({
              status: "downloading",
              progressPercent: progress.progressPercent,
              bytesDownloaded: progress.bytesDownloaded,
              totalBytes: progress.totalBytes,
              userMessage: "Downloading update...",
            });
          },
          onVerifying: () => {
            setState({
              status: "verifying",
              userMessage: "Verifying update...",
              progressPercent: 100,
            });
          },
        });

        if (result.ok) {
          verifiedInstallerPath = result.filePath;
          setState({
            status: "readyToInstall",
            updateAvailable: true,
            updateNowReady: true,
            dismissed: false,
            userMessage:
              "Update downloaded and verified. Click Update Now to install.",
            progressPercent: 100,
            fileName: manifest.fileName,
            latestVersion: manifest.version,
            bytesDownloaded: result.bytesDownloaded,
            totalBytes: result.bytesDownloaded,
          });
          console.log(`Update ready for install: ${manifest.version}`);
          return {
            accepted: true,
            status: "readyToInstall",
            message:
              "Update downloaded and verified. Click Update Now to install.",
          };
        }

        verifiedInstallerPath = null;
        if (result.code === "SHA256_MISSING") {
          setState({
            status: "verificationUnavailable",
            updateNowReady: false,
            userMessage: result.message,
            progressPercent: null,
            bytesDownloaded: 0,
            totalBytes: null,
          });
        } else if (result.code === "CANCELLED") {
          setState({
            status: "available",
            updateNowReady: false,
            userMessage: result.message,
            progressPercent: null,
            bytesDownloaded: 0,
            totalBytes: null,
          });
        } else {
          setState({
            status: "error",
            updateNowReady: false,
            userMessage: result.message,
            progressPercent: null,
            bytesDownloaded: 0,
            totalBytes: null,
          });
        }
        return {
          accepted: false,
          code: result.code,
          message: result.message,
        };
      } finally {
        downloadInFlight = null;
        downloadAbort = null;
      }
    })();

    return downloadInFlight;
  }

  /**
   * Phase 8E — idle gate + final verify + detached NSIS spawn + Agent exit.
   */
  async function beginInstallHandoff(): Promise<StartUpdateResult> {
    if (publicState.status === "installing") {
      return {
        accepted: false,
        code: "INSTALL_ALREADY_IN_PROGRESS",
        message: "An update installation is already in progress.",
      };
    }

    if (
      publicState.status !== "readyToInstall" &&
      publicState.status !== "waitingForIdle"
    ) {
      return {
        accepted: false,
        code: "NOT_READY",
        message: "Unable to install the update right now.",
      };
    }

    if (deps.isBusy?.()) {
      setState({
        status: "waitingForIdle",
        updateNowReady: true,
        dismissed: false,
        userMessage: "Finish the current print job before updating.",
      });
      return {
        accepted: false,
        code: "WAITING_FOR_IDLE",
        message: "Finish the current print job before updating.",
      };
    }

    const tempDir = deps.getUpdateTempDir?.() ?? getDefaultUpdateTempDir();
    const validated = await validateInstallerForHandoff({
      status: publicState.status,
      currentVersion: deps.getCurrentVersion(),
      manifest: lastManifest,
      claimedInstallerPath: verifiedInstallerPath,
      updateTempDir: tempDir,
      hashFile: deps.hashFile,
    });

    if (!validated.ok) {
      verifiedInstallerPath = null;
      if (validated.code === "SHA256_MISSING") {
        setState({
          status: "verificationUnavailable",
          updateNowReady: false,
          userMessage: validated.message,
        });
      } else {
        setState({
          status: "error",
          updateNowReady: false,
          userMessage: validated.message,
        });
      }
      return {
        accepted: false,
        code: validated.code,
        message: validated.message,
      };
    }

    // Re-check idle immediately before spawn (race with new job).
    if (deps.isBusy?.()) {
      setState({
        status: "waitingForIdle",
        updateNowReady: true,
        dismissed: false,
        userMessage: "Finish the current print job before updating.",
      });
      return {
        accepted: false,
        code: "WAITING_FOR_IDLE",
        message: "Finish the current print job before updating.",
      };
    }

    setState({
      status: "installing",
      updateNowReady: false,
      dismissed: false,
      userMessage:
        "Installing update... PrintYantra Agent will restart automatically.",
    });

    const spawnImpl = deps.spawnInstaller ?? spawnDetachedInstaller;
    const spawned = spawnImpl({ installerPath: validated.installerPath });

    if (!spawned.ok) {
      setState({
        status: "readyToInstall",
        updateNowReady: true,
        userMessage: spawned.message,
      });
      return {
        accepted: false,
        code: "SPAWN_FAILED",
        message: spawned.message,
      };
    }

    console.log(
      `Installer spawned (pid=${spawned.pid ?? "unknown"}) for ${validated.version}`,
    );

    // Exit only after successful detached spawn. Installer continues independently.
    try {
      deps.requestAgentExitForUpdate?.();
    } catch (error) {
      console.warn("Agent exit after installer spawn failed:", error);
      // Installer already running — keep installing state; do not roll back.
    }

    return {
      accepted: true,
      status: "installing",
      message:
        "Installing update... PrintYantra Agent will restart automatically.",
    };
  }

  /**
   * Single IPC entry: download when available; install when ready/waiting.
   */
  async function startUpdate(): Promise<StartUpdateResult> {
    if (
      publicState.status === "readyToInstall" ||
      publicState.status === "waitingForIdle"
    ) {
      return beginInstallHandoff();
    }
    return startUpdateDownload();
  }

  async function cancelUpdateDownload(): Promise<UpdatePublicState> {
    if (downloadAbort && !downloadAbort.signal.aborted) {
      downloadAbort.abort();
    }
    if (downloadInFlight) {
      try {
        await downloadInFlight;
      } catch {
        // ignore
      }
    }
    if (
      publicState.status === "downloading" ||
      publicState.status === "verifying"
    ) {
      verifiedInstallerPath = null;
      setState({
        status: lastManifest ? "available" : "error",
        updateAvailable: Boolean(lastManifest),
        updateNowReady: false,
        userMessage: "Update download was cancelled.",
        progressPercent: null,
        bytesDownloaded: 0,
        totalBytes: null,
      });
    }
    return getPublicState();
  }

  function getVerifiedInstallerPath(): string | null {
    if (
      publicState.status !== "readyToInstall" &&
      publicState.status !== "waitingForIdle" &&
      publicState.status !== "installing"
    ) {
      return null;
    }
    return verifiedInstallerPath;
  }

  async function startupUpdateCleanup() {
    await cleanupPartialUpdateDownloads(
      deps.getUpdateTempDir?.() ?? getDefaultUpdateTempDir(),
    );
  }

  function getCachedManifest(): AgentUpdateManifest | null {
    return lastManifest;
  }

  /** Test helper: seed ready-to-install state without network. */
  function setReadyForInstallForTests(options: {
    manifest: AgentUpdateManifest;
    installerPath: string;
  }) {
    lastManifest = options.manifest;
    verifiedInstallerPath = options.installerPath;
    setState({
      status: "readyToInstall",
      updateAvailable: true,
      updateNowReady: true,
      latestVersion: options.manifest.version,
      fileName: options.manifest.fileName,
      notes: options.manifest.notes,
      dismissed: false,
      userMessage: "Update ready",
      progressPercent: 100,
    });
  }

  return {
    runCheck,
    getPublicState,
    dismissAvailable,
    startUpdate,
    startUpdateDownload,
    beginInstallHandoff,
    cancelUpdateDownload,
    getVerifiedInstallerPath,
    getCachedManifest,
    startupUpdateCleanup,
    setReadyForInstallForTests,
    isInFlight: () => inFlight != null,
    isDownloadInFlight: () => downloadInFlight != null,
  };
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
