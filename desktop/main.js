/**
 * Chalk desktop: the Electron shell.
 *
 * First launch sets up a private Python (with uv, bundled) and the backend's libraries, showing
 * progress on a branded setup screen. Every launch then starts the backend on a free local port
 * and opens the interface it serves. Nothing is exposed beyond 127.0.0.1.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, session, Menu } = require("electron");
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const http = require("http");

const IS_WIN = process.platform === "win32";
const DEV_URL = process.env.CHALK_DEV_URL; // e.g. http://127.0.0.1:5173 with the backend already running
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
const BACKEND_DIR = app.isPackaged ? path.join(RES, "backend") : path.join(RES, "backend");
const UI_DIR = app.isPackaged ? path.join(RES, "ui") : path.join(RES, "frontend", "dist");
const UV = app.isPackaged ? path.join(RES, "uv", IS_WIN ? "uv.exe" : "uv") : path.join(__dirname, "vendor", "uv", IS_WIN ? "uv.exe" : "uv");
const LOCAL = IS_WIN && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Chalk") : path.join(app.getPath("userData"), "local");
const RUNTIME = path.join(LOCAL, "runtime");
const VENV = path.join(RUNTIME, "venv");
const PY = IS_WIN ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python");
const DATA = path.join(app.getPath("userData"), "data");
const LOGS = path.join(app.getPath("userData"), "logs");
const PYTHON_VERSION = "3.12";

let win = null;
let backend = null;       // the running backend process
let port = 0;
let quitting = false;
let voiceInstalling = false;
fs.mkdirSync(LOGS, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const logFile = fs.createWriteStream(path.join(LOGS, "chalk.log"), { flags: "a" });
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(" ")}\n`; logFile.write(line); if (!app.isPackaged) process.stdout.write(line); };

// ------------------------------------------------------------------ single instance
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ------------------------------------------------------------------ window
const COLORS = {
  light: { bg: "#FAF8F4", bar: "#F2EFE9", symbol: "#1D1D1F" },
  dark: { bg: "#141415", bar: "#18181A", symbol: "#F2F1EE" },
};
const STATE_FILE = path.join(app.getPath("userData"), "window.json");
function loadBounds() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { width: 1440, height: 900 }; } }
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized: win.isMaximized() }));
}

function createWindow() {
  const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const c = COLORS[theme];
  const b = loadBounds();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width ?? 1440, height: b.height ?? 900, minWidth: 900, minHeight: 600,
    title: "Chalk",
    show: false,
    backgroundColor: c.bg,
    icon: path.join(__dirname, "build", IS_WIN ? "icon.ico" : "icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: c.bar, symbolColor: c.symbol, height: 44 },
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, additionalArguments: [`--chalk-version=${app.getVersion()}`] },
  });
  if (b.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", saveBounds);
  // links open in your browser, never inside Chalk
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    const ok = url.startsWith(`http://127.0.0.1:${port}`) || (DEV_URL && url.startsWith(DEV_URL)) || url.startsWith("file:");
    if (!ok) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  // F12 / Ctrl+Shift+I: developer tools, for troubleshooting
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i"))) win.webContents.toggleDevTools();
  });
}

function setTitleBarTheme(theme) {
  const c = COLORS[theme === "dark" ? "dark" : "light"];
  if (!win || win.isDestroyed()) return;
  try { win.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbol, height: 44 }); } catch { /* not on this platform */ }
  win.setBackgroundColor(c.bg);
}

// ------------------------------------------------------------------ setup screen
function setupEvent(ev) { if (win && !win.isDestroyed()) win.webContents.send("setup:event", ev); }
function showSetup() { return win.loadFile(path.join(__dirname, "setup.html")); }

// ------------------------------------------------------------------ helpers
function run(cmd, args, opts = {}, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    log("run:", cmd, args.join(" "));
    const p = spawn(cmd, args, { windowsHide: true, ...opts, env: { ...process.env, ...opts.env } });
    let tail = "";
    const feed = (buf) => {
      const text = buf.toString();
      tail = (tail + text).slice(-6000);
      text.split(/\r?\n/).forEach((l) => { if (l.trim()) { onLine(l.trim()); logFile.write(l + "\n"); } });
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("error", (e) => reject(new Error(`${path.basename(cmd)}: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve(tail) : reject(Object.assign(new Error(`${path.basename(cmd)} exited with code ${code}`), { tail }))));
  });
}
const hashFile = (f) => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex").slice(0, 12);
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
function getJSON(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}
const uvEnv = () => ({
  UV_PYTHON_INSTALL_DIR: path.join(RUNTIME, "python"),
  UV_CACHE_DIR: path.join(LOCAL, "uv-cache"),
  UV_PYTHON_PREFERENCE: "only-managed", // a private Python: never touch or depend on one you installed
  UV_LINK_MODE: "copy",
});

// ------------------------------------------------------------------ first-run setup: Python + libraries
async function ensureRuntime() {
  const req = path.join(BACKEND_DIR, "requirements.txt");
  const marker = path.join(RUNTIME, "installed.json");
  const want = { python: PYTHON_VERSION, requirements: hashFile(req) };
  try {
    const have = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (fs.existsSync(PY) && have.requirements === want.requirements && have.python === want.python) return;
  } catch { /* first run */ }
  if (!fs.existsSync(UV)) throw new Error(`The bundled installer (uv) is missing: ${UV}`);
  fs.mkdirSync(RUNTIME, { recursive: true });
  const fresh = !fs.existsSync(PY);
  setupEvent({ phase: "start", fresh });
  const line = (l) => setupEvent({ phase: "log", line: l });
  if (fresh) {
    setupEvent({ phase: "step", step: "python", pct: 8, text: "Setting up a private copy of Python" });
    await run(UV, ["venv", "--python", PYTHON_VERSION, "--seed", VENV], { env: uvEnv() }, line);
  }
  setupEvent({ phase: "step", step: "libraries", pct: 40, text: "Installing Chalk's libraries (and Claude Code)" });
  await run(UV, ["pip", "install", "--python", PY, "-r", req], { env: uvEnv() }, line);
  fs.writeFileSync(marker, JSON.stringify(want));
  setupEvent({ phase: "step", step: "starting", pct: 90, text: "Starting Chalk" });
}

// ------------------------------------------------------------------ the backend
function startBackend() {
  return new Promise(async (resolve, reject) => {
    if (!port) port = await freePort();
    const out = fs.createWriteStream(path.join(LOGS, "backend.log"), { flags: "a" });
    out.write(`\n===== ${new Date().toISOString()} starting on port ${port}\n`);
    backend = spawn(PY, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"], {
      cwd: BACKEND_DIR, windowsHide: true,
      env: { ...process.env, CHALK_DATA: DATA, CHALK_UI: UI_DIR, CHALK_TOOLCHAINS: path.join(LOCAL, "toolchains"), PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    });
    let tail = "";
    const feed = (b) => { out.write(b); tail = (tail + b.toString()).slice(-4000); };
    backend.stdout.on("data", feed);
    backend.stderr.on("data", feed);
    const proc = backend;
    proc.on("exit", (code) => {
      log("backend exited", code);
      if (backend === proc) backend = null;
      if (!quitting && !proc.expected) {
        setupEvent({ phase: "error", message: "Chalk's backend stopped unexpectedly.", detail: tail });
        if (win && !win.isDestroyed() && !win.webContents.getURL().startsWith("file:")) showSetup().then(() => setupEvent({ phase: "error", message: "Chalk's backend stopped unexpectedly.", detail: tail }));
      }
    });
    for (let i = 0; i < 240; i++) { // up to 2 minutes (first start compiles and loads a lot)
      if (!backend || backend !== proc) return reject(Object.assign(new Error("The backend didn't start."), { tail }));
      try { await getJSON(`http://127.0.0.1:${port}/api/status`, 1500); return resolve(); } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    reject(Object.assign(new Error("The backend didn't answer in time."), { tail }));
  });
}

function stopBackend() {
  return new Promise((resolve) => {
    const p = backend;
    if (!p) return resolve();
    p.expected = true;
    backend = null;
    p.once("exit", () => resolve());
    if (IS_WIN) execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], () => {});
    else p.kill("SIGTERM");
    setTimeout(resolve, 5000);
  });
}

async function boot() {
  if (DEV_URL) { await win.loadURL(DEV_URL); return; }
  await showSetup();
  try {
    await ensureRuntime();
    setupEvent({ phase: "step", step: "starting", pct: 92, text: "Starting Chalk" });
    await startBackend();
    setupEvent({ phase: "done" });
    await win.loadURL(`http://127.0.0.1:${port}/`);
  } catch (e) {
    log("boot failed:", e.message, e.tail ?? "");
    setupEvent({ phase: "error", message: friendly(e), detail: e.tail ?? String(e.stack ?? e) });
  }
}
function friendly(e) {
  const t = `${e.message}\n${e.tail ?? ""}`;
  if (/getaddrinfo|ENOTFOUND|Network|connect|timed out|dns/i.test(t)) return "Chalk couldn't download what it needs. Check your internet connection, then try again.";
  if (/space|ENOSPC/i.test(t)) return "There isn't enough disk space to finish setting up Chalk.";
  return e.message;
}

// ------------------------------------------------------------------ voice pack: PyTorch, Whisper, Kokoro
function voiceStatus() {
  return new Promise((resolve) => {
    const check = `import importlib.util as u;print(int(bool(u.find_spec('faster_whisper'))), int(bool(u.find_spec('kokoro'))))`;
    execFile(PY, ["-c", check], { windowsHide: true }, (err, stdout) => {
      const [w, k] = String(stdout || "0 0").trim().split(" ");
      execFile("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { windowsHide: true }, (e2, gpu) => {
        resolve({ installed: w === "1" && k === "1", installing: voiceInstalling, gpu: e2 ? null : String(gpu).trim().split("\n")[0] || null });
      });
    });
  });
}

async function installVoice() {
  if (voiceInstalling) return { ok: false, error: "Already installing." };
  voiceInstalling = true;
  const send = (ev) => { if (win && !win.isDestroyed()) win.webContents.send("voice:event", ev); };
  const line = (l) => send({ phase: "log", line: l });
  try {
    const { gpu } = await voiceStatus();
    send({ phase: "start" });
    send({ phase: "step", step: gpu ? `Installing PyTorch for your ${gpu}` : "Installing PyTorch (no NVIDIA card found: CPU version)", pct: 5 });
    const index = gpu ? "https://download.pytorch.org/whl/cu128" : "https://download.pytorch.org/whl/cpu";
    await run(UV, ["pip", "install", "--python", PY, "torch", "--index-url", index], { env: uvEnv() }, line);
    send({ phase: "step", step: "Installing Whisper and Kokoro", pct: 55 });
    await run(UV, ["pip", "install", "--python", PY, "-r", path.join(BACKEND_DIR, "requirements-voice.txt")], { env: uvEnv() }, line);
    send({ phase: "step", step: "Downloading the speech models", pct: 75 });
    await run(PY, [path.join(BACKEND_DIR, "prefetch_voice.py")], { cwd: BACKEND_DIR, env: { PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", CHALK_DATA: DATA } }, line);
    send({ phase: "step", step: "Restarting Chalk's backend", pct: 95 });
    await stopBackend();
    await startBackend();
    send({ phase: "done" });
    return { ok: true };
  } catch (e) {
    log("voice install failed:", e.message, e.tail ?? "");
    send({ phase: "error", message: friendly(e) });
    if (!backend) startBackend().catch(() => {});
    return { ok: false, error: friendly(e) };
  } finally {
    voiceInstalling = false;
  }
}

// ------------------------------------------------------------------ IPC
ipcMain.on("theme", (_e, theme) => setTitleBarTheme(theme));
ipcMain.handle("save-file", async (_e, name, content) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), name), filters: [{ name: "Markdown", extensions: ["md"] }, { name: "All files", extensions: ["*"] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, content, "utf8");
  return true;
});
ipcMain.handle("open-path", (_e, p) => shell.openPath(p));

// Practice papers & notes -> PDF. The page that lays them out (/paper.html) is loaded in a hidden
// window and printed, so the PDF matches the in-app preview page for page.
ipcMain.handle("doc-pdf", async (_e, req) => {
  const rel = String(req?.path ?? "");
  if (!/^\/paper\.html\?[\w=&%.-]+$/.test(rel)) return { ok: false, error: "Not a Chalk document." };
  const base = DEV_URL ? DEV_URL.replace(/\/$/, "") : `http://127.0.0.1:${port}`;
  const name = String(req?.name || "Chalk.pdf").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Chalk.pdf";
  let file;
  if (req?.action === "open") {
    const dir = path.join(app.getPath("temp"), "Chalk");
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, name);
  } else {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), name), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    file = r.filePath;
  }
  const pw = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await pw.loadURL(`${base}${rel}&print=1`);
    const t0 = Date.now();
    while (!(await pw.webContents.executeJavaScript("window.__paperReady === true"))) {
      if (Date.now() - t0 > 20000) throw new Error("the page took too long to lay out");
      await new Promise((r) => setTimeout(r, 150));
    }
    const pdf = await pw.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    fs.writeFileSync(file, pdf);
    if (req?.action === "open") await shell.openPath(file);
    return { ok: true, path: file };
  } catch (e) {
    log("doc-pdf failed:", e.message);
    return { ok: false, error: e.code === "EBUSY" || e.code === "EPERM" ? "that file is open in another app. Close it and try again." : e.message };
  } finally {
    pw.destroy();
  }
});
ipcMain.handle("open-external", (_e, url) => { if (/^https?:\/\//.test(url)) return shell.openExternal(url); });
ipcMain.handle("voice-status", () => voiceStatus());
ipcMain.handle("voice-install", () => installVoice());
ipcMain.handle("restart-backend", async () => { await stopBackend(); await startBackend(); });
ipcMain.handle("setup-retry", () => boot());
ipcMain.handle("setup-reset", async () => { await stopBackend(); fs.rmSync(RUNTIME, { recursive: true, force: true }); return boot(); });
ipcMain.handle("open-logs", () => shell.openPath(LOGS));

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId("app.chalk.desktop");
  // microphone (hold-to-talk) and clipboard for the interface; nothing else
  const allowed = new Set(["media", "clipboard-read", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  createWindow();
  boot();
});
app.on("before-quit", () => { quitting = true; stopBackend(); });
app.on("window-all-closed", () => app.quit());
