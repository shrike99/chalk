/** The small, explicit bridge between the interface and the desktop app (no Node access in the page). */
const { contextBridge, ipcRenderer } = require("electron");
// sandboxed preloads can't read files: the version arrives as a command-line argument
const version = (process.argv.find((a) => a.startsWith("--chalk-version=")) || "").split("=")[1] || "1.0.0";

const on = (channel, cb) => {
  const h = (_e, ev) => cb(ev);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld("chalk", {
  isDesktop: true,
  version,
  platform: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
  setTheme: (theme) => ipcRenderer.send("theme", theme),
  saveFile: (name, content) => ipcRenderer.invoke("save-file", name, content),
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  voice: {
    status: () => ipcRenderer.invoke("voice-status"),
    install: () => ipcRenderer.invoke("voice-install"),
    onEvent: (cb) => on("voice:event", cb),
  },
  restartBackend: () => ipcRenderer.invoke("restart-backend"),
  docPdf: (req) => ipcRenderer.invoke("doc-pdf", req),
  // used by the setup screen
  setup: {
    onEvent: (cb) => on("setup:event", cb),
    retry: () => ipcRenderer.invoke("setup-retry"),
    reset: () => ipcRenderer.invoke("setup-reset"),
    openLogs: () => ipcRenderer.invoke("open-logs"),
  },
});
