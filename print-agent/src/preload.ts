import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("printAgent", {
  getState: () => ipcRenderer.invoke("agent:get-state"),
  setPrinter: (printerName: string) =>
    ipcRenderer.invoke("agent:set-printer", printerName),
  testPrint: () => ipcRenderer.invoke("agent:test-print"),
  setOpenAtLogin: (enabled: boolean) =>
    ipcRenderer.invoke("agent:set-open-at-login", enabled),
  openDashboard: () => ipcRenderer.invoke("agent:open-dashboard"),
  onRefresh: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("refresh-requested", listener);
    return () => ipcRenderer.removeListener("refresh-requested", listener);
  },
});
