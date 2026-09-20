import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  ipcMain,
  shell,
  dialog,
} from "electron";
import path from "path";

import {
  ensureAgentAuthenticated,
  sendHeartbeat,
  setPrinterColorSupported,
} from "./api-client";
import {
  LOGIN_ITEM_NAME,
  clearShopSession,
  loadConfig,
  updateConfig,
  getConfigPaths,
  isAgentPaired,
} from "./config";
import { connectWithPairingUrl, PairingError } from "./pairing";
import { processPendingJobs, runTestPrint, isPrintOperationBusy } from "./job-service";
import { detectPrinters } from "./printer-service";
import {
  applyFirstRunPrinterIfNeeded,
  normalizeConfiguredPrinter,
  resolveConfiguredPrinterSelection,
} from "./selected-printer";
import {
  PERIODIC_CLEANUP_INTERVAL_MS,
  cleanPeriodicStaleTempFiles,
  cleanStartupOrphanTempFiles,
  ensureJobsDirectory,
} from "./storage-service";
import {
  UPDATE_CHECK_INTERVAL_MS,
  createUpdateChecker,
  type UpdatePublicState,
} from "./update-check";
import {
  removeLegacyElectronLoginItemIfOurs,
  removeLegacyPrintMadeEasyLoginItemIfPresent,
} from "./login-item-migration";
import { createWindowsHkcuRunStore } from "./windows-run-key-store";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** True when Force Exit / tray Exit / restart intentionally terminates the Agent. */
let isQuitting = false;
/** Prevents re-entrant close dialogs. */
let closeDialogOpen = false;
let pollTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let backgroundLoopsStarted = false;
let syncInFlight: Promise<{
  printers: Awaited<ReturnType<typeof detectPrinters>>;
  selected: string | null;
  printerStatus: string;
}> | null = null;
let lastCloudSyncAt = 0;
let lastConnection: {
  status: "Connected" | "Disconnected";
  message: string;
} = {
  status: "Disconnected",
  message: "Backend status unavailable",
};

/** Server-sourced color capability cache (not agent-config.json). */
let printerCapabilities: Array<{
  printerName: string;
  colorSupported: boolean;
  isDefault: boolean;
  status: string;
}> = [];

function rememberPrinterCapabilities(
  printers:
    | Array<{
        printerName: string;
        colorSupported: boolean;
        isDefault: boolean;
        status: string;
      }>
    | undefined,
) {
  if (!printers) return;
  printerCapabilities = printers;
}

/** Packaged + dev: icons are copied next to main.js under dist/. */
function getBrandedIconPath(filename: string): string {
  return path.join(__dirname, filename);
}

function loadBrandedIcon(filename: string) {
  const iconPath = getBrandedIconPath(filename);
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    console.warn(`Branded icon missing or unreadable: ${iconPath}`);
  }
  return image;
}

function createTrayIcon() {
  const tray = loadBrandedIcon("tray-icon.png");
  if (!tray.isEmpty()) {
    return tray;
  }
  // Fallback to window-sized PNG if tray asset is absent.
  return loadBrandedIcon("icon.png");
}

function getUiPath() {
  return path.join(__dirname, "index.html");
}

function getAgentVersion() {
  return app.getVersion();
}

const updateChecker = createUpdateChecker({
  getCurrentVersion: getAgentVersion,
  getApiUrl: () => loadConfig().apiUrl || "https://printyantra.com",
  isBusy: () => isPrintOperationBusy(),
  requestAgentExitForUpdate: () => {
    // Installer already spawned detached. Exit without relaunch — NSIS --force-run starts the new Agent.
    isQuitting = true;
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (updateCheckTimer) clearInterval(updateCheckTimer);
    app.quit();
  },
  onStateChange: () => {
    pushUpdateState();
  },
});

function pushUpdateState(state?: UpdatePublicState) {
  const snapshot = state ?? updateChecker.getPublicState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("agent:update-status", snapshot);
  }
}

async function runUpdateCheck(options?: { manual?: boolean }) {
  const result = await updateChecker.runCheck(options);
  pushUpdateState();
  return result;
}

function startUpdateCheckLoops() {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  // Non-blocking startup check shortly after ready.
  setTimeout(() => {
    void runUpdateCheck({ manual: false }).catch((error) => {
      console.warn("Startup update check failed:", error);
    });
  }, 4_000);

  updateCheckTimer = setInterval(() => {
    void runUpdateCheck({ manual: false }).catch((error) => {
      console.warn("Periodic update check failed:", error);
    });
  }, UPDATE_CHECK_INTERVAL_MS);
}

/** Completely stop Agent (tray + background). Single shutdown path. */
function forceExitAgent() {
  isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  app.quit();
}

function restartAgent() {
  isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  app.relaunch();
  app.exit(0);
}

async function openDashboardInBrowser() {
  const config = loadConfig();
  const base = (config.apiUrl || "https://printyantra.com").replace(/\/$/, "");
  await shell.openExternal(`${base}/dashboard`);
}

function buildApplicationMenu() {
  const version = getAgentVersion();
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Force Exit",
          click: () => forceExitAgent(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: `Version ${version}`,
          enabled: false,
        },
        { type: "separator" },
        {
          label: "Open Dashboard",
          click: () => {
            void openDashboardInBrowser().catch((error) => {
              console.error("Open Dashboard failed:", error);
            });
          },
        },
        {
          label: "Check for Updates",
          click: () => {
            void runUpdateCheck({ manual: true }).then(() => {
              if (!mainWindow || mainWindow.isDestroyed()) {
                createWindow();
              } else {
                mainWindow.show();
                mainWindow.focus();
              }
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function handleWindowClose(event: Electron.Event) {
  if (isQuitting) return;
  event.preventDefault();

  if (closeDialogOpen || !mainWindow) return;
  closeDialogOpen = true;

  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "PrintYantra is still running",
      message: "PrintYantra is still running",
      detail:
        "Closing this window keeps PrintYantra running in the background so print jobs can continue.\n\nYou can reopen it from the Windows system tray.\n\nTo completely stop PrintYantra, choose Force Exit or use File → Force Exit.",
      buttons: ["Continue Running in Background", "Force Exit"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (result.response === 1) {
      forceExitAgent();
      return;
    }

    mainWindow.hide();
  } finally {
    closeDialogOpen = false;
  }
}

function applyOpenAtLoginSetting(enabled: boolean) {
  // Single Windows startup mechanism: Electron login items (HKCU Run).
  // No service, scheduled task, or elevated startup.
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath,
    args: [],
    name: LOGIN_ITEM_NAME,
  });

  // Legacy Run-key cleanup (ON or OFF):
  // - 1.3.0 wrote electron.app.Electron (no name)
  // - 1.4.0 wrote "PrintMadeEasy Agent"
  // Remove those orphans so upgrades do not leave duplicate auto-start and
  // PrintYantra 1.5.0 is the only Agent that launches at login.
  if (process.platform === "win32") {
    try {
      const store = createWindowsHkcuRunStore();
      removeLegacyElectronLoginItemIfOurs({
        store,
        agentExecutablePath: process.execPath,
      });
      removeLegacyPrintMadeEasyLoginItemIfPresent({ store });
    } catch (error) {
      console.warn("Legacy auto-start Run key cleanup failed:", error);
    }
  }
}

function wasOpenedAtLogin() {
  try {
    return Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  } catch {
    return false;
  }
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const windowIcon = loadBrandedIcon("icon.png");
  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 400,
    minHeight: 560,
    resizable: true,
    maximizable: false,
    title: "PrintYantra Agent",
    show: false,
    ...(windowIcon.isEmpty() ? {} : { icon: windowIcon }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(getUiPath());
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    // Push any update state discovered while the window was closed.
    pushUpdateState();
  });
  mainWindow.on("close", (event) => {
    void handleWindowClose(event);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("PrintYantra Agent");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => createWindow() },
      {
        label: "Restart Agent",
        click: () => restartAgent(),
      },
      { type: "separator" },
      {
        label: "Exit Agent",
        click: () => forceExitAgent(),
      },
    ]),
  );
  tray.on("double-click", () => createWindow());
}

async function ensureRegistered(selectedPrinter: string | null, printerStatus: string) {
  await ensureAgentAuthenticated({
    selectedPrinter,
    printerStatus,
  });
  return true;
}

async function syncWithCloud() {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const printers = await detectPrinters().catch(() => []);
    const config = loadConfig();

    // Preserve configured default. Never auto-pick Windows default / first printer
    // when the configured name is missing. First-run only when unset + exactly one.
    applyFirstRunPrinterIfNeeded(
      config.selectedPrinter,
      printers,
      (printerName) => {
        updateConfig({ selectedPrinter: printerName });
      },
    );

    // Re-read after detection so an intervening agent:set-printer wins.
    const selected =
      normalizeConfiguredPrinter(loadConfig().selectedPrinter) ?? null;

    const resolution = resolveConfiguredPrinterSelection(selected, printers);
    const printerStatus = resolution.status;

    await ensureRegistered(selected, printerStatus);

    // Always report configured selectedPrinter (even if currently undetected)
    // so the DB default is not promoted to another detected printer.
    try {
      const heartbeat = await sendHeartbeat({
        selectedPrinter: selected || undefined,
        printerStatus,
        printers: printers.map((printer) => ({
          name: printer.name,
          status: printer.status,
        })),
      });
      rememberPrinterCapabilities(heartbeat.printers);
      lastCloudSyncAt = Date.now();
      lastConnection = {
        status: "Connected",
        message: `Connected to ${loadConfig().shopCode}`,
      };
    } catch (error) {
      console.error("Heartbeat sync failed:", error);
      lastConnection = {
        status: "Disconnected",
        message:
          error instanceof Error ? error.message : "Heartbeat sync failed",
      };
    }

    return { printers, selected, printerStatus };
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

function startBackgroundLoops() {
  if (backgroundLoopsStarted) return;
  backgroundLoopsStarted = true;

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);

  heartbeatTimer = setInterval(() => {
    if (!isAgentPaired()) return;
    void syncWithCloud().catch((error) => {
      console.error("Cloud sync failed:", error);
    });
  }, 5000);

  pollTimer = setInterval(() => {
    if (!isAgentPaired()) return;
    void processPendingJobs().catch((error) => {
      console.error("Job processing failed:", error);
    });
  }, 5000);

  // Independent of the 5s job poll — only Agent-owned stale temp files.
  cleanupTimer = setInterval(() => {
    try {
      cleanPeriodicStaleTempFiles();
    } catch (error) {
      console.error("Periodic temp cleanup failed:", error);
    }
  }, PERIODIC_CLEANUP_INTERVAL_MS);
}

function registerIpc() {
  ipcMain.handle(
    "agent:get-state",
    async (_event, options?: { light?: boolean }) => {
      const light = Boolean(options?.light);
      const config = loadConfig();
      let printers: Awaited<ReturnType<typeof detectPrinters>> = [];
      let connection = lastConnection;

      try {
        // Cached/single-flight — avoids stacking PowerShell with heartbeat/job loops.
        printers = await detectPrinters();
      } catch (error) {
        console.error("detectPrinters failed:", error);
      }

      const selectedAfterFirstRun = applyFirstRunPrinterIfNeeded(
        config.selectedPrinter,
        printers,
        (printerName) => {
          updateConfig({ selectedPrinter: printerName });
        },
      );

      const selected =
        normalizeConfiguredPrinter(loadConfig().selectedPrinter) ??
        selectedAfterFirstRun;

      const resolution = resolveConfiguredPrinterSelection(selected, printers);
      const selectedPrinterStatus = resolution.status;

      const shouldSyncCloud =
        isAgentPaired() &&
        !light &&
        Date.now() - lastCloudSyncAt > 4_000;

      if (shouldSyncCloud) {
        try {
          await syncWithCloud();
          connection = lastConnection;
        } catch (error) {
          console.error("Agent registration/connection failed:", error);
          connection = {
            status: "Disconnected",
            message:
              error instanceof Error
                ? error.message
                : "Unable to connect to PrintYantra server",
          };
          lastConnection = connection;
        }
      } else if (!isAgentPaired()) {
        connection = {
          status: "Disconnected",
          message:
            "Not connected. Sign in with your PrintYantra email and password.",
        };
      } else if (light) {
        connection = lastConnection;
      }

      const latest = loadConfig();
      return {
        config: {
          apiUrl: latest.apiUrl,
          shopCode: latest.shopCode,
          shopName: latest.shopName,
          agentId: latest.agentId,
          selectedPrinter: selected,
          openAtLogin: latest.openAtLogin,
          paired: Boolean(latest.authToken),
        },
        paths: getConfigPaths(),
        printers,
        printerCapabilities,
        connection,
        selectedPrinterStatus,
        selectedPrinterAvailable: resolution.isDetected,
        agentRunning: true,
        printerCount: printers.length,
        paired: Boolean(latest.authToken),
        agentVersion: getAgentVersion(),
        update: updateChecker.getPublicState(),
      };
    },
  );

  ipcMain.handle("agent:set-printer", async (_event, printerName: string) => {
    if (!printerName || typeof printerName !== "string") {
      throw new Error("Invalid printer selection.");
    }

    const printers = await detectPrinters({ force: true });
    if (!printers.some((printer) => printer.name === printerName)) {
      throw new Error("Selected printer is not available.");
    }

    const next = updateConfig({ selectedPrinter: printerName });
    const selected = printers.find((printer) => printer.name === printerName);
    try {
      await ensureRegistered(printerName, selected?.status || "Unknown");
      const heartbeat = await sendHeartbeat({
        selectedPrinter: printerName,
        printerStatus: selected?.status || "Unknown",
        printers: printers.map((printer) => ({
          name: printer.name,
          status: printer.status,
        })),
      });
      rememberPrinterCapabilities(heartbeat.printers);
      lastCloudSyncAt = Date.now();
    } catch (error) {
      console.error("Failed syncing selected printer:", error);
    }
    return next;
  });

  ipcMain.handle(
    "agent:set-printer-color",
    async (
      _event,
      payload: { printerName: string; colorSupported: boolean },
    ) => {
      const printerName =
        typeof payload?.printerName === "string"
          ? payload.printerName.trim()
          : "";
      if (!printerName) {
        throw new Error("Invalid printer name.");
      }
      if (typeof payload?.colorSupported !== "boolean") {
        throw new Error("Invalid colorSupported value.");
      }
      if (!isAgentPaired()) {
        throw new Error("Connect the Agent to your shop before configuring color.");
      }

      const printers = await detectPrinters().catch(() => []);
      const config = loadConfig();
      const selected =
        normalizeConfiguredPrinter(config.selectedPrinter) ?? null;
      const resolution = resolveConfiguredPrinterSelection(selected, printers);
      const printerPayload = printers.map((printer) => ({
        name: printer.name,
        status: printer.status,
      }));

      // Ensure the target appears in the heartbeat upsert list even if briefly
      // missing from Windows detection (keeps capability row creatable).
      if (!printerPayload.some((row) => row.name === printerName)) {
        printerPayload.push({ name: printerName, status: "Unknown" });
      }

      const updated = await setPrinterColorSupported({
        printerName,
        colorSupported: payload.colorSupported,
        selectedPrinter: selected,
        printerStatus: resolution.status,
        printers: printerPayload,
      });

      printerCapabilities = printerCapabilities.map((row) =>
        row.printerName === updated.printerName
          ? {
              ...row,
              colorSupported: updated.colorSupported,
              isDefault: updated.isDefault,
              status: updated.status,
            }
          : row,
      );
      if (
        !printerCapabilities.some(
          (row) => row.printerName === updated.printerName,
        )
      ) {
        printerCapabilities = [...printerCapabilities, updated];
      }

      lastCloudSyncAt = Date.now();
      return updated;
    },
  );

  ipcMain.handle("agent:test-print", async () => {
    const config = loadConfig();
    if (!config.selectedPrinter) {
      return { success: false, error: "Please select a printer first." };
    }

    try {
      await runTestPrint(config.selectedPrinter);
      return { success: true, message: "Test print successful" };
    } catch (error) {
      console.error("Test print failed:", error);
      return {
        success: false,
        error: "Test print failed. Check that the printer is online and ready.",
      };
    }
  });

  ipcMain.handle("agent:set-open-at-login", async (_event, enabled: boolean) => {
    applyOpenAtLoginSetting(Boolean(enabled));
    return updateConfig({ openAtLogin: Boolean(enabled) });
  });

  ipcMain.handle("agent:check-for-updates", async () => {
    await runUpdateCheck({ manual: true });
    return updateChecker.getPublicState();
  });

  ipcMain.handle("agent:dismiss-update", async () => {
    updateChecker.dismissAvailable();
    const state = updateChecker.getPublicState();
    pushUpdateState(state);
    return state;
  });

  ipcMain.handle("agent:start-update", async () => {
    const result = await updateChecker.startUpdate();
    pushUpdateState();
    return result;
  });

  ipcMain.handle("agent:cancel-update", async () => {
    const state = await updateChecker.cancelUpdateDownload();
    pushUpdateState(state);
    return state;
  });

  ipcMain.handle("agent:get-update-state", async () => {
    return updateChecker.getPublicState();
  });

  ipcMain.handle("agent:open-dashboard", async () => {
    await openDashboardInBrowser();
  });

  ipcMain.handle(
    "agent:connect-pairing-url",
    async (_event, rawUrl: string) => {
      if (!rawUrl || typeof rawUrl !== "string") {
        throw new Error("Invalid PrintYantra connection link.");
      }

      const config = loadConfig();
      try {
        const result = await connectWithPairingUrl(rawUrl, {
          selectedPrinter: config.selectedPrinter,
          printerStatus: "Unknown",
        });

        try {
          await syncWithCloud();
        } catch (error) {
          console.error("Post-pairing sync failed:", error);
        }

        return {
          success: true,
          shopName: result.shopName,
          shopCode: result.shopCode,
          agentId: result.agentId,
        };
      } catch (error) {
        if (error instanceof PairingError) {
          throw new Error(error.message);
        }
        throw new Error(
          "Unable to connect to PrintYantra. Check your internet connection.",
        );
      }
    },
  );

  ipcMain.handle(
    "agent:login-account",
    async (
      _event,
      input: { email?: string; password?: string },
    ) => {
      const email = typeof input?.email === "string" ? input.email.trim() : "";
      const password =
        typeof input?.password === "string" ? input.password : "";
      if (!email || !password) {
        throw new Error("Enter your email and password.");
      }

      const { loginWithAccount } = await import("./api-client.js");
      const config = loadConfig();
      try {
        const result = await loginWithAccount({
          email,
          password,
          selectedPrinter: config.selectedPrinter,
        });

        try {
          await syncWithCloud();
        } catch (error) {
          console.error("Post-login sync failed:", error);
        }

        return {
          success: true,
          shopName: result.shop.shopName,
          shopCode: result.shop.shopCode,
          agentId: result.agentId,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to sign in. Check your internet connection.";
        throw new Error(message);
      }
    },
  );

  ipcMain.handle("agent:switch-shop", async () => {
    const before = loadConfig();
    const next = clearShopSession();
    printerCapabilities = [];
    lastConnection = {
      status: "Disconnected",
      message: "Sign in to connect a shop.",
    };
    return {
      success: true as const,
      paired: false,
      agentId: next.agentId,
      openAtLogin: next.openAtLogin,
      apiUrl: next.apiUrl,
      previousShopCode: before.shopCode || null,
    };
  });
}

function focusExistingAgent() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (app.isReady()) {
    createWindow();
  }
}

// Match electron-builder appId so Windows taskbar/pinned shortcuts use our branding.
if (process.platform === "win32") {
  app.setAppUserModelId("com.printyantra.agent");
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusExistingAgent();
  });

  app.whenReady().then(async () => {
    ensureJobsDirectory();
    cleanStartupOrphanTempFiles();
    try {
      await updateChecker.startupUpdateCleanup();
    } catch (error) {
      console.warn("Update temp cleanup failed:", error);
    }

    buildApplicationMenu();
    registerIpc();
    createTray();

    const config = loadConfig();
    applyOpenAtLoginSetting(config.openAtLogin);

    // Windows login auto-start: stay in tray when already signed in.
    // Unauthenticated first-run still shows the login UI.
    // Manual launch always opens the UI.
    const autoStarted = wasOpenedAtLogin();
    if (!autoStarted || !isAgentPaired()) {
      createWindow();
    }

    if (isAgentPaired()) {
      try {
        await syncWithCloud();
      } catch (error) {
        console.error("Initial cloud sync failed:", error);
      }
    }

    startBackgroundLoops();
    startUpdateCheckLoops();
  });

  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    isQuitting = true;
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (updateCheckTimer) clearInterval(updateCheckTimer);
    // Best-effort: remove inactive orphans. Active print files stay protected.
    try {
      cleanStartupOrphanTempFiles();
    } catch (error) {
      console.error("Shutdown temp cleanup failed:", error);
    }
  });
}
