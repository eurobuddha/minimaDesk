/*
 * main.js — Electron main process for minimaDesk.
 *
 * Owns the window, the node lifecycle (node-manager), and the IPC proxy the renderer uses to reach the node.
 * The renderer NEVER sees the RPC/MDS secrets — it calls `mds:cmd` / `rpc:cmd` and main injects auth. MDS
 * MiniDapps are served by the node over HTTPS on the MDS port; we trust that one loopback self-signed cert.
 */
const { app, BrowserWindow, ipcMain, session } = require("electron");
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
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#08090B",          // Minima Core Black — no white flash on load
    title: "minimaDesk",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true                   // MiniDapps render in <webview> tabs
    }
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Push node status/logs to the renderer.
  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
  node.on("status", s => send("node:status", s));
  node.on("log", () => send("node:log", node.logs[node.logs.length - 1] || ""));
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
ipcMain.handle("node:snapshot", () => node.snapshot());
ipcMain.handle("node:logs", () => node.logs.slice(-300));
ipcMain.handle("node:ports", () => ({ base: config.basePort(), rpc: config.rpcPort(), mds: config.mdsPort() }));

/** Run any node command over RPC (management: mds action:list / install / uninstall, maxima, status…). */
ipcMain.handle("rpc:cmd", async (_e, command) => {
  try { return await rpcCall(config.rpcPort(), config.rpcSecret(), String(command)); }
  catch (e) { return { status: false, error: e.message }; }
});

/** The MDS base URL a webview loads a dapp from: https://127.0.0.1:<mdsport>/<uid>/index.html?uid=<session>.
 *  The session UID is obtained in the renderer flow (Phase 1); here we just hand over host + port. */
ipcMain.handle("mds:base", () => ({ host: "127.0.0.1", port: config.mdsPort() }));

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
