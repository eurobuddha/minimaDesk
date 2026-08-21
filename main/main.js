/*
 * main.js — Electron main process for minimaDesk.
 *
 * Owns the window, the node lifecycle (node-manager), and the IPC proxy the renderer uses to reach the node.
 * The renderer NEVER sees the RPC/MDS secrets — it calls `mds:cmd` / `rpc:cmd` and main injects auth. MDS
 * MiniDapps are served by the node over HTTPS on the MDS port; we trust that one loopback self-signed cert.
 */
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const config = require("./config");
const node = require("./node-manager");
const { rpcCall } = require("./rpc");

let win = null;

function createWindow() {
  const cfg = config.load();
  win = new BrowserWindow({
    width: (cfg.window && cfg.window.w) || 1180,
    height: (cfg.window && cfg.window.h) || 780,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: "#08090B",          // Minima Core Black — no white flash on load
    title: "minimaDesk",
    // mac: native traffic lights over our own dark chrome (the tab strip fills the top).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true                   // MiniDapps render in <webview> tabs
    }
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Dev diagnostics: forward renderer console to the terminal (Electron 33 passes an event object).
  if (!app.isPackaged) {
    win.webContents.on("console-message", (e) => {
      const m = (e && (e.message !== undefined ? e.message : arguments[2]));
      if (m !== undefined) console.log("[renderer]", m);
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url) => console.log("[did-fail-load]", code, desc, url));
    win.webContents.on("did-finish-load", () => console.log("[did-finish-load] renderer loaded"));
    win.webContents.on("preload-error", (_e, p, err) => console.log("[preload-error]", p, err && err.message));
    win.webContents.on("render-process-gone", (_e, d) => console.log("[render-gone]", d && d.reason));
    if (process.env.MDESK_SHOT) {
      setTimeout(() => {
        win.webContents.capturePage().then(img => {
          try { require("fs").writeFileSync(process.env.MDESK_SHOT, img.toPNG()); console.log("[shot] saved"); }
          catch (e) { console.log("[shot] fail", e.message); }
        });
      }, Number(process.env.MDESK_SHOT_MS) || 12000);
    }
  }

  // Push ONLY status to the renderer (low frequency). Node logs are NOT streamed —
  // Minima is extremely chatty and an IPC message per line froze the UI. The
  // renderer pulls the ring buffer via `node:logs` on demand instead.
  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
  node.on("status", s => send("node:status", s));
}

// Trust ONLY the node's own loopback MDS cert (self-signed). Everything else stays strict.
function trustLoopbackMds() {
  const mdsPort = config.mdsPort();
  app.on("certificate-error", (event, webContents, url, error, cert, callback) => {
    try {
      const u = new URL(url);
      if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && String(u.port) === String(mdsPort)) {
        event.preventDefault(); callback(true); return;
      }
    } catch (e) {}
    callback(false);
  });
}

app.whenReady().then(() => {
  trustLoopbackMds();
  createWindow();
  node.start();

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// ---- IPC proxy: renderer → node (auth injected here) ----
ipcMain.on("diag", (_e, m) => { if (!app.isPackaged) console.log("[R]", m); });
ipcMain.handle("node:snapshot", () => node.snapshot());
ipcMain.handle("node:logs", () => node.logs.slice(-300));
ipcMain.handle("node:ports", () => ({ base: config.basePort(), rpc: config.rpcPort(), mds: config.mdsPort(), appVersion: app.getVersion() }));

/** Run any node command over RPC (management: mds action:list / install / uninstall, maxima, status…). */
ipcMain.handle("rpc:cmd", async (_e, command) => {
  try { return await rpcCall(config.rpcPort(), config.rpcSecret(), String(command)); }
  catch (e) { return { status: false, error: e.message }; }
});

/** The MDS base URL a webview loads a dapp from: https://127.0.0.1:<mdsport>/<uid>/index.html?uid=<session>.
 *  The per-dapp uid+sessionid come from `mds action:list`; here we hand over host + port. */
ipcMain.handle("mds:base", () => ({ host: "127.0.0.1", port: config.mdsPort() }));

/** Pick a .mds.zip and install it (trust:read by default; user grants write via the permission prompt). */
ipcMain.handle("mds:install", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Install a MiniDapp",
    properties: ["openFile"],
    filters: [{ name: "MiniDapp", extensions: ["mds.zip", "zip"] }]
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { status: false, cancelled: true };
  const file = r.filePaths[0];
  try { return await rpcCall(config.rpcPort(), config.rpcSecret(), 'mds action:install file:"' + file + '"'); }
  catch (e) { return { status: false, error: e.message }; }
});

// ---- graceful shutdown: stop the node cleanly (H2 close) before quitting ----
let quitting = false;
app.on("before-quit", async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  try { await node.stop(); } catch (err) {}
  app.quit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
