/*
 * config.js — persisted app config + the two node secrets (RPC password, MDS password).
 *
 * Config (base port, data folder, window prefs) is JSON in Electron's userData dir. The secrets are NOT in
 * that JSON — they are generated once and stored encrypted (safeStorage, OS-key backed) with a 0600 plaintext
 * fallback, and are only ever read by the MAIN process. The renderer never sees them; it talks to the node
 * through the IPC proxy in main.js.
 *
 * We run the FULL minima classic jar with MDS ENABLED (unlike the old minimaCore desktop, which stripped it).
 */
const { app, safeStorage } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  // A dedicated base port so minimaDesk coexists with any other Minima node the user runs (9001 classic,
  // 11001 android, 12001 old desktop, 16001 classic-desktop). MDS = base+2, RPC = base+4.
  basePort: 20001,
  dataFolder: "",        // -data (empty → default under userData/minima-data)
  extraArgs: "",         // additional raw jar args, appended verbatim
  contribute: true,      // run as a full reachable node (UPnP/accept-inbound) — the node forwards its own port
  window: { w: 1180, h: 780 }
};

function configPath() { return path.join(app.getPath("userData"), "config.json"); }

// The node's data folder MUST contain no spaces. MiniDapps install other dapps with
// `mds action:install file:<path>` (unquoted), and the node's command parser splits on
// whitespace — so a space in the path (macOS "~/Library/Application Support/…") makes every
// dapp-initiated install fail with "Invalid parameters for mds". We keep data under a space-free
// home directory and migrate any existing (space-containing) data folder there once, instantly
// (same volume rename preserves the synced chain + wallet + installed dapps).
function defaultDataFolder() {
  const legacy = path.join(app.getPath("userData"), "minima-data");
  let base = app.getPath("home");
  // Guard the rare case of a space in the home path too; fall back to a temp-based space-free dir.
  if (/\s/.test(base)) { try { base = require("os").tmpdir(); } catch (e) {} }
  const target = path.join(base, ".minimadesk-data");
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(target)) { fs.renameSync(legacy, target); }
  } catch (e) { /* migration failed — node will fresh-sync under target */ }
  return target;
}

function load() {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch (e) { /* first run */ }
  return Object.assign({}, DEFAULTS, j);
}
function save(patch) {
  const merged = Object.assign(load(), patch || {});
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

// ---- derived ports ----
function basePort() { return parseInt(load().basePort, 10) || DEFAULTS.basePort; }
function rpcPort() { return basePort() + 4; }
function mdsPort() { return basePort() + 2; }

// ---- secrets (generated once, stored encrypted 0600) ----
function encAvailable() {
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()); }
  catch (e) { return false; }
}
function secretPath(name) { return path.join(app.getPath("userData"), name); }
function readSecret(p) {
  let buf; try { buf = fs.readFileSync(p); } catch (e) { return null; }
  if (encAvailable()) { try { const s = safeStorage.decryptString(buf); if (s) return s.trim(); } catch (e) { /* legacy plaintext */ } }
  const s = buf.toString("utf8").trim(); return s || null;
}
function writeSecret(p, value) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const data = encAvailable() ? safeStorage.encryptString(String(value)) : Buffer.from(String(value), "utf8");
  fs.writeFileSync(p, data, { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch (e) {}
}
/** Get (or generate + persist once) a named secret. */
function ensureSecret(name) {
  const p = secretPath(name);
  let s = readSecret(p);
  if (!s) { s = crypto.randomBytes(24).toString("hex"); writeSecret(p, s); }
  return s;
}
function rpcSecret() { return ensureSecret("rpc.secret"); }
function mdsPassword() { return ensureSecret("mds.secret"); }

module.exports = {
  load, save, defaultDataFolder,
  basePort, rpcPort, mdsPort,
  rpcSecret, mdsPassword
};
