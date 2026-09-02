/*
 * preload.js — the ONLY bridge between the renderer and the node. Exposes a tiny, safe surface over IPC;
 * the renderer never sees the RPC/MDS secrets (main injects auth). contextIsolation is on.
 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
// Subscribe to a push channel; returns an unsubscribe (React effects re-run under StrictMode).
const subscribe = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("minima", {
  platform: process.platform,

  // node lifecycle / status
  snapshot: () => invoke("node:snapshot"),
  logs: () => invoke("node:logs"),
  ports: () => invoke("node:ports"),
  onStatus: (cb) => subscribe("node:status", cb),
  nodeStop: (compact) => invoke("node:stop", !!compact),
  nodeRestart: () => invoke("node:restart"),

  // node command proxy (any RPC command; auth injected in main)
  cmd: (command) => invoke("rpc:cmd", command),

  // MDS host for dapp URLs / icons
  mdsBase: () => invoke("mds:base"),

  // pick a .mds.zip and install it (native file dialog in main)
  install: () => invoke("mds:install"),

  // fetch an MDS icon as a data URL (reliable — bypasses self-signed cert img loads)
  iconData: (url) => invoke("mds:icon", url),

  // on-demand Maxima heal (reconnect relay + re-pin MLS + refresh contacts)
  healMaxima: () => invoke("maxima:heal"),

  // Settings → Network
  netConfig: () => invoke("net:config"),
  netSetContribute: (on) => invoke("net:setContribute", !!on),
  netSetMaximaRelay: (host) => invoke("net:setMaximaRelay", host),
  netSetMls: (mode, custom) => invoke("net:setMls", mode, custom || ""),

  // dapps opened from inside a webview / the hub land here as "open a tab"
  onOpenUrl: (cb) => subscribe("shell:open-url", cb),

  // hub preferences (replaces the MiniHUB's MDS.keypair store)
  prefsGet: (key) => invoke("prefs:get", key),
  prefsSet: (key, value) => invoke("prefs:set", key, value),

  // absolute path of a File picked with <input type=file> (Electron 33: File.path is gone)
  pathForFile: (file) => webUtils.getPathForFile(file),

  // custom wallpaper (copied into userData; returned as a data URL)
  wallpaperSet: (srcPath) => invoke("wallpaper:set", srcPath),
  wallpaperGet: () => invoke("wallpaper:get"),

  // open an https link / local file with the OS
  openExternal: (url) => invoke("shell:open", url),

  // dev diagnostic channel (reliable — bypasses console-message forwarding)
  diag: (m) => ipcRenderer.send("diag", String(m))
});
