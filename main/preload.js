/*
 * preload.js — the ONLY bridge between the renderer and the node. Exposes a tiny, safe surface over IPC;
 * the renderer never sees the RPC/MDS secrets (main injects auth). contextIsolation is on.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minima", {
  // node lifecycle / status
  snapshot: () => ipcRenderer.invoke("node:snapshot"),
  logs: () => ipcRenderer.invoke("node:logs"),
  ports: () => ipcRenderer.invoke("node:ports"),
  onStatus: (cb) => ipcRenderer.on("node:status", (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on("node:log", (_e, l) => cb(l)),

  // node command proxy (management: `mds action:list`, `mds action:install file:…`, `maxima …`, `status`)
  cmd: (command) => ipcRenderer.invoke("rpc:cmd", command),

  // where MDS serves dapps (host + port); the renderer builds the per-dapp URL
  mdsBase: () => ipcRenderer.invoke("mds:base"),

  // pick a .mds.zip and install it (opens the native file dialog in main)
  install: () => ipcRenderer.invoke("mds:install"),

  // native store: fetch a repo JSON, and download+install a dapp by its file URL
  storeFetch: (url) => ipcRenderer.invoke("store:fetch", url),
  storeInstall: (fileUrl) => ipcRenderer.invoke("store:install", fileUrl),

  // fetch an MDS icon as a data URL (reliable — bypasses self-signed cert img loads)
  iconData: (url) => ipcRenderer.invoke("mds:icon", url),

  // dev diagnostic channel (reliable — bypasses console-message forwarding)
  diag: (m) => ipcRenderer.send("diag", String(m))
});
