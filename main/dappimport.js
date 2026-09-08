/*
 * dappimport.js — bring MiniDapps installed on the CLASSIC node into the Parlons Node, one by one.
 *
 * The two kinds are separate nodes with mutually unreadable databases, but a MiniDapp on disk is just its
 * extracted .mds.zip: <data>/1.0/mds/web/<uid>/ holds every file plus dapp.conf. Importing = zipping that
 * folder again (dapp.conf at the zip root) and `mds action:install file:"<zip>" trust:read` on the running
 * Parlons Node. The classic folder is only ever READ. A dapp's own data (its sql / files under mds/data)
 * does not come along - it lives in the classic node's H2 format.
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const config = require("./config");
const node = require("./node-manager");
const { rpcCall } = require("./rpc");

const CLASSIC_WEB = ["1.0", "mds", "web"];
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", gif: "image/gif", webp: "image/webp", ico: "image/x-icon" };
const MAX_ICON = 512 * 1024;

function classicWebDir() { return path.join(node.dataDir(), ...CLASSIC_WEB); }

function readConf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "dapp.conf"), "utf8")); } catch (e) { return null; }
}
function iconDataUrl(dir, conf) {
  try {
    const icon = String(conf.icon || "").replace(/^\/+/, "");
    if (!icon || icon.includes("..")) return "";
    const p = path.join(dir, icon);
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > MAX_ICON) return "";
    const ext = icon.split(".").pop().toLowerCase();
    return "data:" + (MIME[ext] || "image/png") + ";base64," + fs.readFileSync(p).toString("base64");
  } catch (e) { return ""; }
}
function dirSize(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += dirSize(p); else if (e.isFile()) n += fs.statSync(p).size;
  }
  return n;
}

/** Every dapp installed on the classic node, with whether the Parlons Node already has one by that name. */
async function listClassic() {
  const web = classicWebDir();
  if (!fs.existsSync(web)) return { classicFolder: web, dapps: [] };
  let installed = [];
  try {
    const r = await rpcCall(config.rpcPort(), config.rpcSecret(), "mds action:list");
    const raw = (r && r.status && r.response && (Array.isArray(r.response) ? r.response : r.response.minidapps)) || [];
    installed = raw.map((d) => ({ name: String((d.conf && d.conf.name) || ""), version: String((d.conf && d.conf.version) || "") }));
  } catch (e) {}
  const dapps = [];
  for (const e of fs.readdirSync(web, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^0x[0-9A-Fa-f]+$/.test(e.name)) continue;
    const dir = path.join(web, e.name);
    const conf = readConf(dir);
    if (!conf || !conf.name) continue;
    const have = installed.find((i) => i.name.toLowerCase() === String(conf.name).toLowerCase());
    dapps.push({ uid: e.name, name: String(conf.name), version: String(conf.version || ""), description: String(conf.description || ""),
      icon: iconDataUrl(dir, conf), size: dirSize(dir), installed: have ? (have.version || "yes") : "" });
  }
  // the classic web folder can hold the same dapp twice (an update left the old copy): offer each name+version once
  const seen = new Set();
  const unique = dapps.filter((d) => { const k = d.name.toLowerCase() + "@" + d.version; if (seen.has(k)) return false; seen.add(k); return true; });
  unique.sort((a, b) => a.name.localeCompare(b.name));
  return { classicFolder: web, dapps: unique };
}

async function zipDir(dir, zip, base = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) await zipDir(p, zip, rel);
    else if (e.isFile()) zip.file(rel, fs.readFileSync(p));
  }
}

/** Import the given classic uids into the Parlons Node. Returns one result per uid. */
async function importClassic(uids) {
  if (node.kind() !== "parlons") return { status: false, error: "imports go into the Parlons Node - switch to it first" };
  const web = classicWebDir();
  const out = [];
  const tmpDir = path.join(app.getPath("userData"), "import");
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const uid of Array.isArray(uids) ? uids : []) {
    const row = { uid, name: "", status: false, error: "" };
    out.push(row);
    if (!/^0x[0-9A-Fa-f]+$/.test(String(uid))) { row.error = "bad uid"; continue; }
    const dir = path.join(web, uid);
    const conf = readConf(dir);
    if (!conf || !conf.name) { row.error = "no dapp.conf"; continue; }
    row.name = String(conf.name);
    const safe = (String(conf.name) + "-" + String(conf.version || "0")).replace(/[^A-Za-z0-9._-]+/g, "_");
    const zipPath = path.join(tmpDir, safe + ".mds.zip");
    try {
      const zip = new JSZip();
      await zipDir(dir, zip);
      fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      if (/["\r\n]/.test(zipPath)) throw new Error("import path contains a quote or newline");
      const r = await rpcCall(config.rpcPort(), config.rpcSecret(), 'mds action:install file:"' + zipPath + '" trust:read');
      if (r && r.status) { row.status = true; row.installedUid = r.response && r.response.installed && r.response.installed.uid; }
      else row.error = (r && r.error) || "install failed";
    } catch (e) { row.error = e.message; }
    finally { try { fs.unlinkSync(zipPath); } catch (e) {} }
  }
  return { status: true, results: out };
}

module.exports = { listClassic, importClassic };
