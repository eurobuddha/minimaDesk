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
  mdsBase: () => ipcRenderer.invoke("mds:base")
});
