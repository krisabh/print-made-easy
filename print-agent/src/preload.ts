import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("printAgent", {
  getState: (options?: { light?: boolean }) =>
    ipcRenderer.invoke("agent:get-state", options),
  setPrinter: (printerName: string) =>
    ipcRenderer.invoke("agent:set-printer", printerName),
  setPrinterColor: (printerName: string, colorSupported: boolean) =>
    ipcRenderer.invoke("agent:set-printer-color", {
      printerName,
      colorSupported,
    }),
  testPrint: () => ipcRenderer.invoke("agent:test-print"),
  setOpenAtLogin: (enabled: boolean) =>
    ipcRenderer.invoke("agent:set-open-at-login", enabled),
  openDashboard: () => ipcRenderer.invoke("agent:open-dashboard"),
  checkForUpdates: () => ipcRenderer.invoke("agent:check-for-updates"),
  dismissUpdate: () => ipcRenderer.invoke("agent:dismiss-update"),
  startUpdate: () => ipcRenderer.invoke("agent:start-update"),
  cancelUpdate: () => ipcRenderer.invoke("agent:cancel-update"),
  getUpdateState: () => ipcRenderer.invoke("agent:get-update-state"),
  connectPairingUrl: (url: string) =>
    ipcRenderer.invoke("agent:connect-pairing-url", url),
  loginAccount: (input: { email: string; password: string }) =>
    ipcRenderer.invoke("agent:login-account", input),
  switchShop: () => ipcRenderer.invoke("agent:switch-shop"),
  onRefresh: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("refresh-requested", listener);
    return () => ipcRenderer.removeListener("refresh-requested", listener);
  },
  onUpdateStatus: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("agent:update-status", listener);
    return () => ipcRenderer.removeListener("agent:update-status", listener);
  },
});
