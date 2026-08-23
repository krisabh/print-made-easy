import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
} from "electron";
import path from "path";

import {
  checkBackendReachable,
  ensureAgentAuthenticated,
  sendHeartbeat,
} from "./api-client";
import {
  loadConfig,
  updateConfig,
  getConfigPaths,
  isAgentPaired,
} from "./config";
import { connectWithPairingUrl, PairingError } from "./pairing";
import { processPendingJobs, runTestPrint } from "./job-service";
import { detectPrinters } from "./printer-service";
import { cleanStaleTempFiles, ensureJobsDirectory } from "./storage-service";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let pollTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

const TRAY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPElEQVQ4T2NkYGD4z0ABYBzVMKoBBgQYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGFQDAKvSBQH0fG3eAAAAAElFTkSuQmCC";

function createTrayIcon() {
  return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_PNG_BASE64}`);
}

function getUiPath() {
  return path.join(__dirname, "index.html");
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 440,
    height: 720,
    resizable: true,
    maximizable: false,
    title: "PrintMadeEasy Agent",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(getUiPath());
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("PrintMadeEasy Agent");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open PrintMadeEasy", click: () => createWindow() },
      {
        label: "Printer Status",
        click: () => {
          createWindow();
          mainWindow?.webContents.send("refresh-requested");
        },
      },
      { type: "separator" },
      {
        label: "Exit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
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
  const printers = await detectPrinters().catch(() => []);
  const config = loadConfig();
  const selected =
    config.selectedPrinter &&
    printers.some((printer) => printer.name === config.selectedPrinter)
      ? config.selectedPrinter
      : printers.find((printer) => printer.isDefault)?.name ||
        printers[0]?.name ||
        null;

  if (selected && selected !== config.selectedPrinter) {
    updateConfig({ selectedPrinter: selected });
  }

  const selectedInfo = printers.find((printer) => printer.name === selected);
  const printerStatus = selectedInfo?.status || "Unknown";

  await ensureRegistered(selected, printerStatus);

  await sendHeartbeat({
    selectedPrinter: selected,
    printerStatus,
    printers: printers.map((printer) => ({
      name: printer.name,
      status: printer.status,
    })),
  }).catch((error) => {
    console.error("Heartbeat sync failed:", error);
  });

  return { printers, selected, printerStatus };
}

function startBackgroundLoops() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);

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
}

function registerIpc() {
  ipcMain.handle("agent:get-state", async () => {
    const config = loadConfig();
    let printers: Awaited<ReturnType<typeof detectPrinters>> = [];
    let connection: Awaited<ReturnType<typeof checkBackendReachable>> = {
      status: "Disconnected",
      message: "Backend status unavailable",
    };

    try {
      printers = await detectPrinters();
    } catch (error) {
      console.error("detectPrinters failed:", error);
    }

    const selected =
      config.selectedPrinter &&
      printers.some((printer) => printer.name === config.selectedPrinter)
        ? config.selectedPrinter
        : printers.find((printer) => printer.isDefault)?.name ||
          printers[0]?.name ||
          null;

    if (selected && selected !== config.selectedPrinter) {
      updateConfig({ selectedPrinter: selected });
    }

    const selectedPrinterInfo =
      printers.find((printer) => printer.name === selected) ?? null;

    try {
      if (isAgentPaired()) {
        await ensureRegistered(
          selected,
          selectedPrinterInfo?.status || "Unknown",
        );
        connection = await checkBackendReachable();
      } else {
        connection = {
          status: "Disconnected",
          message: "Not connected. Paste the dashboard connection link to connect this Agent.",
        };
      }
    } catch (error) {
      console.error("Agent registration/connection failed:", error);
      connection = {
        status: "Disconnected",
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to PrintMadeEasy server",
      };
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
      connection,
      selectedPrinterStatus: selectedPrinterInfo?.status ?? "Unknown",
      agentRunning: true,
      printerCount: printers.length,
      paired: Boolean(latest.authToken),
    };
  });

  ipcMain.handle("agent:set-printer", async (_event, printerName: string) => {
    if (!printerName || typeof printerName !== "string") {
      throw new Error("Invalid printer selection.");
    }

    const printers = await detectPrinters();
    if (!printers.some((printer) => printer.name === printerName)) {
      throw new Error("Selected printer is not available.");
    }

    const next = updateConfig({ selectedPrinter: printerName });
    const selected = printers.find((printer) => printer.name === printerName);
    try {
      await ensureRegistered(printerName, selected?.status || "Unknown");
      await sendHeartbeat({
        selectedPrinter: printerName,
        printerStatus: selected?.status || "Unknown",
        printers: printers.map((printer) => ({
          name: printer.name,
          status: printer.status,
        })),
      });
    } catch (error) {
      console.error("Failed syncing selected printer:", error);
    }
    return next;
  });

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
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
    });
    return updateConfig({ openAtLogin: Boolean(enabled) });
  });

  ipcMain.handle("agent:open-dashboard", async () => {
    const config = loadConfig();
    await shell.openExternal(`${config.apiUrl.replace(/\/$/, "")}/dashboard`);
  });

  ipcMain.handle(
    "agent:connect-pairing-url",
    async (_event, rawUrl: string) => {
      if (!rawUrl || typeof rawUrl !== "string") {
        throw new Error("Invalid PrintMadeEasy connection link.");
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
          "Unable to connect to PrintMadeEasy. Check your internet connection.",
        );
      }
    },
  );
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

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusExistingAgent();
  });

  app.whenReady().then(async () => {
    ensureJobsDirectory();
    cleanStaleTempFiles();

    registerIpc();
    createTray();
    createWindow();

    const config = loadConfig();
    app.setLoginItemSettings({
      openAtLogin: config.openAtLogin,
      path: process.execPath,
    });

    if (isAgentPaired()) {
      try {
        await syncWithCloud();
      } catch (error) {
        console.error("Initial cloud sync failed:", error);
      }
    }

    startBackgroundLoops();
  });

  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    isQuitting = true;
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
}
