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
  connectPairingUrl: (url: string) =>
    ipcRenderer.invoke("agent:connect-pairing-url", url),
  onRefresh: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("refresh-requested", listener);
    return () => ipcRenderer.removeListener("refresh-requested", listener);
  },
});
