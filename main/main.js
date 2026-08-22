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
    // capture console from dapp <webview>s too (their MDS.log / errors)
    app.on("web-contents-created", (_e, contents) => {
      try {
        if (contents.getType && contents.getType() === "webview") {
          contents.on("console-message", (ev, level, message) => console.log("[wv]", (ev && ev.message) || message || ""));
        }
      } catch (e) {}
    });
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
    if (process.env.MDESK_ASTEST) {
      const { webContents } = require("electron");
      setTimeout(() => win.webContents.executeJavaScript(
        `(function(){var t=[...document.querySelectorAll('#sections .tile')].find(x=>/app store/i.test(x.textContent));if(t){t.click();return 'opened';}return 'no-tile';})()`
      ).then(r => console.log("[astest] open:", r)), 13000);
      setTimeout(async () => {
        const wc = webContents.getAllWebContents().find(c => { try { return /127\.0\.0\.1:200/.test(c.getURL()); } catch (e) { return false; } });
        if (!wc) { console.log("[astest] no webview"); return; }
        // Run the App Store's OWN MDS calls in its page context (valid session, real space-free path)
        const script = `(async()=>{
          if(typeof MDS==='undefined') return 'NO_MDS';
          const url='https://eurobuddha.com/panda_dapps/keyuses-0.1.51.mds.zip';
          const dl=await new Promise(r=>MDS.file.download(url,res=>r(res)));
          const path=(dl&&dl.response&&dl.response.download&&dl.response.download.path)||'';
          if(!path) return 'DL_FAIL '+JSON.stringify(dl).slice(0,160);
          const ins=await new Promise(r=>MDS.cmd('mds action:install file:'+path+' trust:read',res=>r(res)));
          return 'path='+path+' || install='+JSON.stringify(ins).slice(0,240);
        })()`;
        wc.executeJavaScript(script).then(r => console.log("[astest] RESULT:", r)).catch(e => console.log("[astest] err:", e.message));
      }, 22000);
    }
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

// ---- native MiniDapp Store: fetch a repo JSON, download + install through the node ----
// The stock third-party "Dapp Store" MiniDapp points at the official /data/*.json paths,
// which have moved and now 404. Instead of depending on that broken dapp, minimaDesk hosts
// its own store: it fetches a repository descriptor ({name, dapps:[{name,file,icon,...}]}),
// downloads the chosen .mds.zip, and installs it via the node's proven `mds action:install`.
const { net } = require("electron");
const os = require("os");
const fs = require("fs");

// GET a URL following redirects (GitHub release zips 302 to a CDN). Returns a Buffer.
function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("too many redirects"));
    const req = net.request(url);
    req.on("response", (res) => {
      const code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
        const next = new URL(loc, url).toString();
        res.on("data", () => {}); res.on("end", () => {});
        return resolve(fetchBuffer(next, redirects + 1));
      }
      if (code < 200 || code >= 300) { res.on("data", () => {}); return reject(new Error("HTTP " + code + " for " + url)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Fetch + parse a store repository JSON. */
ipcMain.handle("store:fetch", async (_e, url) => {
  try {
    const buf = await fetchBuffer(String(url));
    return { status: true, response: JSON.parse(buf.toString("utf8")) };
  } catch (e) { return { status: false, error: e.message }; }
});

/** Download a .mds.zip by URL to a temp file, then install it through the node (trust:read). */
ipcMain.handle("store:install", async (_e, fileUrl) => {
  let tmp = "";
  try {
    const buf = await fetchBuffer(String(fileUrl));
    if (!buf || buf.length < 100) throw new Error("empty download");
    const safe = (String(fileUrl).split("/").pop() || "dapp.mds.zip").replace(/[^A-Za-z0-9._-]/g, "_");
    tmp = path.join(os.tmpdir(), "mdesk-" + Date.now() + "-" + safe);
    fs.writeFileSync(tmp, buf);
    const r = await rpcCall(config.rpcPort(), config.rpcSecret(), 'mds action:install file:"' + tmp + '"');
    return r;
  } catch (e) {
    return { status: false, error: e.message };
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
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
