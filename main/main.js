/*
 * main.js — Electron main process for minimaDesk.
 *
 * Owns the window, the node lifecycle (node-manager), and the IPC proxy the renderer uses to reach the node.
 * The renderer NEVER sees the RPC/MDS secrets — it calls `rpc:cmd` and main injects auth. MDS MiniDapps are
 * served by the node over HTTPS on the MDS port; we trust that one loopback self-signed cert.
 *
 * The renderer is the Vite-built React app in renderer/dist (the classic MiniHUB home screen inside a
 * tabbed shell). Dapps open in <webview> tabs; anything a dapp or the hub tries to `window.open` on the
 * MDS host is turned into a tab via `shell:open-url`.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const config = require("./config");
const node = require("./node-manager");
const prefs = require("./prefs");
const { rpcCall } = require("./rpc");
const iconcache = require("./iconcache");
const { KNOWN_RELAYS } = require("./relays");

// Dev only: run from an isolated userData (own secrets, own single-instance lock, own config/port) so a
// dev build can run next to the installed app. Set MDESK_USERDATA=<dir> (seed <dir>/config.json first).
if (!app.isPackaged && process.env.MDESK_USERDATA) app.setPath("userData", process.env.MDESK_USERDATA);

let win = null;
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

// ---- window.open policy ----
// MDS dapp URLs become tabs; http(s) goes to the OS browser; NOTHING else. In particular `file:` is never
// handed to the OS from web content: a MiniDapp can write any file through the MDS file API and would
// otherwise get it launched with its default app. The hub's own local links (Terms) go through
// `shell:open`, which only opens files inside the packaged renderer.
function isLoopbackMdsUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && String(u.port) === String(config.mdsPort());
  } catch (e) { return false; }
}
function windowOpenHandler({ url }) {
  if (isLoopbackMdsUrl(url)) { send("shell:open-url", { url }); return { action: "deny" }; }
  if (/^https?:\/\//i.test(url)) { shell.openExternal(url).catch(() => {}); }
  return { action: "deny" };
}
/** Local files the hub may open: only inside the built renderer (e.g. assets/terms.docx.html). */
function rendererDistDir() { return path.resolve(path.join(__dirname, "..", "renderer", "dist")); }
function isInsideRendererDist(fileUrl) {
  try {
    const p = path.resolve(decodeURIComponent(new URL(fileUrl).pathname));
    const root = rendererDistDir();
    return p === root || p.startsWith(root + path.sep);
  } catch (e) { return false; }
}

function createWindow() {
  const cfg = config.load();
  win = new BrowserWindow({
    width: (cfg.window && cfg.window.w) || 1180,
    height: (cfg.window && cfg.window.h) || 780,
    // The hub's desktop layout (6-column grid, right-click menu geometry) starts at its lg breakpoint (976px).
    minWidth: 1000,
    minHeight: 620,
    backgroundColor: "#08090B",          // Minima Core Black — no white flash on load
    title: "minimaDesk",
    // mac: native traffic lights over our own dark chrome (the tab strip fills the top).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true                   // MiniDapps render in <webview> tabs
    }
  });
  win.webContents.setWindowOpenHandler(windowOpenHandler);
  win.on("close", () => { try { const b = win.getBounds(); config.save({ window: { w: b.width, h: b.height } }); } catch (e) {} });
  if (!app.isPackaged && process.env.MDESK_DEV_URL) win.loadURL(process.env.MDESK_DEV_URL);
  else win.loadFile(path.join(__dirname, "..", "renderer", "dist", "index.html"));

  // Dev diagnostics: forward renderer console to the terminal.
  if (!app.isPackaged) {
    win.webContents.on("console-message", (e, _level, legacyMessage) => {
      const m = (e && e.message !== undefined) ? e.message : legacyMessage;
      if (m !== undefined) console.log("[renderer]", m);
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url) => console.log("[did-fail-load]", code, desc, url));
    win.webContents.on("did-finish-load", () => console.log("[did-finish-load] renderer loaded"));
    win.webContents.on("preload-error", (_e, p, err) => console.log("[preload-error]", p, err && err.message));
    win.webContents.on("render-process-gone", (_e, d) => console.log("[render-gone]", d && d.reason));
    if (process.env.MDESK_SEQ) {
      // MDESK_SEQ = JSON [{js, ms}] — run each snippet at its delay (dev verification only)
      let steps = []; try { steps = JSON.parse(process.env.MDESK_SEQ); } catch (e) {}
      steps.forEach((s) => setTimeout(() => {
        win.webContents.executeJavaScript(s.js).then(r => console.log("[seq]", r)).catch(e => console.log("[seq fail]", e.message));
      }, s.ms || 13000));
    }
    if (process.env.MDESK_EXIT_MS) {
      // MDESK_EXIT_MS = quit after N ms (dev verification runs; goes through the graceful node stop)
      setTimeout(() => app.quit(), Number(process.env.MDESK_EXIT_MS));
    }
    // MDESK_SHOT=<png> [+ MDESK_SHOT_MS], or MDESK_SHOTS="<png>@<ms>,<png>@<ms>,…" for a sequence
    const shots = [];
    if (process.env.MDESK_SHOT) shots.push({ file: process.env.MDESK_SHOT, ms: Number(process.env.MDESK_SHOT_MS) || 12000 });
    for (const spec of String(process.env.MDESK_SHOTS || "").split(",").filter(Boolean)) {
      const [file, ms] = spec.split("@"); shots.push({ file, ms: Number(ms) || 12000 });
    }
    shots.forEach(({ file, ms }) => setTimeout(() => {
      win.webContents.capturePage().then(img => {
        try { fs.writeFileSync(file, img.toPNG()); console.log("[shot] saved", file); }
        catch (e) { console.log("[shot] fail", e.message); }
      });
    }, ms));
  }

}

// Push ONLY status to the renderer (low frequency). Node logs are NOT streamed — Minima is extremely
// chatty and an IPC message per line froze the UI; the renderer pulls the ring buffer via `node:logs`.
// Registered ONCE (createWindow re-runs on macOS "activate").
node.on("status", s => send("node:status", s));

// Every <webview> guest: dapp-to-dapp window.open becomes a tab; capture console in dev. Also refuse any
// attempt (from a compromised renderer) to attach a webview with a preload or node integration.
app.on("web-contents-created", (_e, contents) => {
  try {
    contents.on("will-attach-webview", (_ev, prefs) => {
      delete prefs.preload; delete prefs.preloadURL;
      prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.webSecurity = true;
    });
    if (contents.getType && contents.getType() === "webview") {
      contents.setWindowOpenHandler(windowOpenHandler);
      if (!app.isPackaged) {
        contents.on("console-message", (ev, level, message) => console.log("[wv]", (ev && ev.message) || message || ""));
      }
    }
  } catch (e) {}
});

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

// Single instance only — a second launch focuses the existing window instead of spawning a
// duplicate node that fights for the same ports.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.whenReady().then(() => {
    trustLoopbackMds();
    createWindow();
    node.start().catch(() => {});
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

// ---- IPC proxy: renderer → node (auth injected here) ----
ipcMain.on("diag", (_e, m) => { if (!app.isPackaged) console.log("[R]", m); });
ipcMain.handle("node:snapshot", () => node.snapshot());
ipcMain.handle("node:logs", () => node.logTail(300));
ipcMain.handle("node:ports", () => ({ base: config.basePort(), rpc: config.rpcPort(), mds: config.mdsPort(), appVersion: app.getVersion() }));
ipcMain.handle("node:stop", async (_e, compact) => { try { await node.stop({ compact: !!compact }); return { status: true }; } catch (e) { return { status: false, error: e.message }; } });
ipcMain.handle("node:restart", async () => { try { await node.restart(); return { status: true }; } catch (e) { return { status: false, error: e.message }; } });

/** Run any node command over RPC (management: mds action:list / install / uninstall, maxima, status…). */
/** Remove every `password` key anywhere in a reply (the node's `mds` reply carries the MDS password, and
 *  a `;`-chained command such as `status;mds` comes back as an ARRAY of replies). */
function scrubPasswords(v, depth = 0) {
  if (depth > 12 || !v || typeof v !== "object") return v;
  if (Array.isArray(v)) { v.forEach((x) => scrubPasswords(x, depth + 1)); return v; }
  if (typeof v.password === "string") delete v.password;
  for (const k of Object.keys(v)) scrubPasswords(v[k], depth + 1);
  return v;
}
ipcMain.handle("rpc:cmd", async (_e, command) => {
  const cmd = String(command);
  try {
    const r = await rpcCall(config.rpcPort(), config.rpcSecret(), cmd);
    // A dapp updated in place keeps its uid — drop its cached icon so the new one shows.
    const upd = /^\s*mds\s+action:update\b[^;]*\buid:(0x[0-9A-Fa-f]+)/i.exec(cmd);
    if (upd) iconcache.evictUid(upd[1]);
    return /(^|;)\s*mds\b/i.test(cmd) ? scrubPasswords(r) : r;
  } catch (e) { return { status: false, error: e.message }; }
});

/** The MDS base a webview loads a dapp from: https://127.0.0.1:<mdsport>/<uid>/index.html?uid=<session>. */
ipcMain.handle("mds:base", () => ({ host: "127.0.0.1", port: config.mdsPort() }));

/** RPC credentials: the password goes straight to the clipboard from main — the renderer never sees it. */
ipcMain.handle("rpc:copyPassword", () => {
  try { clipboard.writeText(config.rpcSecret()); return { status: true, user: "minima", port: config.rpcPort() }; }
  catch (e) { return { status: false, error: e.message }; }
});

/** On-demand "Heal Maxima": reconnect the relay, re-pin static MLS, refresh contact addresses. */
ipcMain.handle("maxima:heal", () => node.healMaxima());

// ---- Settings → Network: contribute (server role + port mapping), Maxima relay, static MLS ----
ipcMain.handle("net:config", () => {
  const cfg = config.load();
  return { contribute: !!cfg.contribute, maximaRelay: node.snapshot().maximaRelay,
           mls: cfg.mls || { mode: "relay", custom: "" }, knownRelays: KNOWN_RELAYS, basePort: config.basePort() };
});
ipcMain.handle("net:setContribute", async (_e, on) => { try { return await node.setContribute(!!on); } catch (e) { return { status: false, error: e.message }; } });
ipcMain.handle("net:setMaximaRelay", async (_e, host) => { try { return await node.setMaximaRelay(host); } catch (e) { return { status: false, error: e.message }; } });
ipcMain.handle("net:setMls", async (_e, mode, custom) => { try { return await node.setMls(mode, custom); } catch (e) { return { status: false, error: e.message }; } });


/** Pick a .mds.zip and install it (trust:read by default; user grants write via the hub / pending prompt). */
ipcMain.handle("mds:install", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Install a MiniDapp",
    properties: ["openFile"],
    filters: [{ name: "MiniDapp", extensions: ["mds.zip", "zip"] }]
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { status: false, cancelled: true };
  const file = r.filePaths[0];
  // The node's parser toggles quoting on a `"` inside the value and accepts extra tokens as params, so a
  // filename containing a quote could smuggle `trust:write`. Refuse it, and always state trust:read.
  if (/["\r\n]/.test(file)) return { status: false, error: "file path contains a quote or newline — rename the file" };
  if (!/\.zip$/i.test(file)) return { status: false, error: "not a .mds.zip file" };
  try { return await rpcCall(config.rpcPort(), config.rpcSecret(), 'mds action:install file:"' + file + '" trust:read'); }
  catch (e) { return { status: false, error: e.message }; }
});

// ---- hub prefs (keypair replacement) ----
ipcMain.handle("prefs:get", (_e, key) => { try { return prefs.get(key); } catch (e) { return { status: false, error: e.message }; } });
ipcMain.handle("prefs:set", (_e, key, value) => { try { return prefs.set(key, value); } catch (e) { return { status: false, error: e.message }; } });

// ---- custom wallpaper: copy the picked image into userData and hand back a data URL ----
const WALLPAPER_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp" };
const WALLPAPER_MAX = 8 * 1024 * 1024;
function wallpaperDir() { return path.join(app.getPath("userData"), "hub"); }
function currentWallpaper() {
  try {
    const dir = wallpaperDir();
    const f = fs.readdirSync(dir).find(n => /^custom_wallpaper\.[a-z0-9]+$/i.test(n));
    if (!f) return { status: false };
    const ext = f.split(".").pop().toLowerCase();
    const buf = fs.readFileSync(path.join(dir, f));
    return { status: true, fileName: f, dataUrl: "data:" + (WALLPAPER_EXT[ext] || "image/png") + ";base64," + buf.toString("base64") };
  } catch (e) { return { status: false }; }
}
ipcMain.handle("wallpaper:get", () => currentWallpaper());
ipcMain.handle("wallpaper:set", (_e, srcPath) => {
  try {
    const src = String(srcPath || "");
    const ext = src.split(".").pop().toLowerCase();
    if (!WALLPAPER_EXT[ext]) return { status: false, error: "unsupported image type" };
    const st = fs.statSync(src);
    if (st.size > WALLPAPER_MAX) return { status: false, error: "image larger than 8 MB" };
    const dir = wallpaperDir();
    fs.mkdirSync(dir, { recursive: true });
    for (const n of fs.readdirSync(dir)) { if (/^custom_wallpaper\./i.test(n)) { try { fs.unlinkSync(path.join(dir, n)); } catch (e) {} } }
    const fileName = "custom_wallpaper." + ext;
    fs.copyFileSync(src, path.join(dir, fileName));
    return currentWallpaper();
  } catch (e) { return { status: false, error: e.message }; }
});

/** Open an https link in the OS browser, or a local file with its default app. */
ipcMain.handle("shell:open", async (_e, url) => {
  const u = String(url || "");
  try {
    if (/^https?:\/\//i.test(u)) { await shell.openExternal(u); return { status: true }; }
    if (/^file:\/\//i.test(u) && isInsideRendererDist(u)) { await shell.openPath(decodeURIComponent(new URL(u).pathname)); return { status: true }; }
    return { status: false, error: "unsupported url" };
  } catch (e) { return { status: false, error: e.message }; }
});

// ---- MDS icon proxy: fetch a dapp icon from the loopback MDS server (self-signed TLS) and return it as
// a data: URL. <img src="https://127.0.0.1:mds/…"> in the renderer fails the self-signed cert
// intermittently; fetching in main with rejectUnauthorized:false and handing back a data URL makes every
// icon resolve, cached (main/iconcache.js). Pinned to OUR MDS port, timed out, and size-capped. ----
const ICON_TIMEOUT_MS = 8000;
const ICON_MAX_BYTES = 2 * 1024 * 1024;
function fetchLoopback(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, agent: false, timeout: ICON_TIMEOUT_MS }, (r) => {
      if (r.statusCode < 200 || r.statusCode >= 300) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
      const ct = r.headers["content-type"] || "";
      const chunks = []; let total = 0;
      r.on("data", (c) => { total += c.length; if (total > ICON_MAX_BYTES) { req.destroy(new Error("icon too large")); return; } chunks.push(c); });
      r.on("end", () => resolve({ buf: Buffer.concat(chunks), ct }));
      r.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("icon fetch timeout")));
    req.on("error", reject);
  });
}
function guessMime(u) {
  const s = String(u).toLowerCase().split("?")[0];
  if (s.endsWith(".svg")) return "image/svg+xml";
  if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
  if (s.endsWith(".gif")) return "image/gif";
  if (s.endsWith(".ico")) return "image/x-icon";
  if (s.endsWith(".webp")) return "image/webp";
  return "image/png";
}
ipcMain.handle("mds:icon", async (_e, url) => {
  const u = String(url || "");
  if (!isLoopbackMdsUrl(u) || !/^https:/i.test(u)) return "";
  if (iconcache.has(u)) return iconcache.get(u);
  try {
    const { buf, ct } = await fetchLoopback(u);
    if (!buf || !buf.length) return "";
    const mime = ct && /^image\//.test(ct) ? ct : guessMime(u);
    const durl = "data:" + mime + ";base64," + buf.toString("base64");
    iconcache.set(u, durl);
    return durl;
  } catch (e) { return ""; }
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
