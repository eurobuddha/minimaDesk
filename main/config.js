/*
 * config.js — persisted app config + the two node secrets (RPC password, MDS password).
 *
 * Config (base port, data folder, window prefs) is JSON in Electron's userData dir. The secrets are NOT in
 * that JSON — they are generated once and stored encrypted (safeStorage, OS-key backed) with a 0600 plaintext
 * fallback, and are only ever read by the MAIN process. The renderer never sees them; it talks to the node
 * through the IPC proxy in main.js.
 *
 * Two node kinds (since 0.7.15): "parlons" runs parlons-node.jar - the Parlons Node: the same full node with
 * MDS served by the node itself (fork re-import), plus your Parlons account and a Maxima relay when you
 * contribute; "minima" runs the classic minima.jar (MDS + classic Maxima). A fresh install starts on the
 * Parlons Node; an install from before 0.7.15 keeps the classic jar until Settings → minimaDesk switches it.
 */
const { app, safeStorage } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PARAMS = require("./params");

const DEFAULTS = {
  // A dedicated base port so minimaDesk coexists with any other Minima node the user runs (9001 classic,
  // 11001 android, 12001 old desktop, 16001 classic-desktop). MDS = base+2, RPC = base+4.
  basePort: 20001,
  nodeKind: "parlons",  // "parlons" = parlons-node.jar (node + MDS + your Parlons account); "minima" = classic minima.jar
  heapMb: 0,             // -Xmx for the Parlons Node (0 = automatic: 3072 with MegaMMR, else 1536)
  updateFeed: "",        // the one-app store feed minimaDesk checks for its own updates ("" = the eurobuddha.com feed)
  megammrHost: "",       // a MegaMMR node to restore a seed phrase from (host:port); "" = the fleet list in carryover.js
  parlonsCarried: null,  // {at, classicAddress, keys, keyuses} once the Parlons node carries the classic wallet (verified)
  keyUses: {},           // ledger: { minima: {max, at}, parlons: {max, at} } = the highest key use last read on each node
  keyUsesPending: null,  // {kind, to, at} while a needed counter raise has not succeeded: that node must not sign
  dataFolder: "",        // -data (empty → default under userData/minima-data)
  extraArgs: "",         // additional raw jar args, appended verbatim (validated against params.ALL_FLAGS)
  params: {},            // every other minima.jar startup flag (Settings → Startup parameters); secrets hold a `true` marker
  contribute: false,     // "Contribute to the network": -server role + UPnP/NAT-PMP port mapping (Settings → Network)
  maximaRelay: "",       // the ONE Maxima relay to attach to (host:port); "" → the default fleet relay
  mls: { mode: "relay", custom: "" },   // static MLS policy: relay (pin the attached relay) | custom (Mx…@host:port) | host (rotating)
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
  const merged = Object.assign({}, DEFAULTS, j);
  // An install from before the Parlons Node existed (a config.json with no nodeKind) keeps its classic jar
  // until the user switches in Settings; a fresh install starts on the Parlons Node.
  if (!("nodeKind" in j) && Object.keys(j).length) merged.nodeKind = "minima";
  if (merged.nodeKind !== "minima") merged.nodeKind = "parlons";
  // 0.7.22 dev builds saved the Pi as the MegaMMR host; it serves no MegaMMR - fall back to the fleet list
  if (merged.megammrHost === "31.125.188.214:9001") merged.megammrHost = "";
  // params: ONLY flags in the current manifest — a saved value wins, otherwise the default. A stale config
  // can never resurrect a flag the bundled jar no longer knows (the jar refuses to boot on an unknown flag).
  const defs = PARAMS.defaultParams(), sp = (j && j.params && typeof j.params === "object") ? j.params : {}, params = {};
  for (const k of Object.keys(defs)) params[k] = (k in sp) ? sp[k] : defs[k];
  merged.params = params;
  return merged;
}
/** Crash-safe: write a sibling temp file, then rename over config.json (rename is atomic on one volume). */
function writeAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}
function save(patch) {
  const merged = Object.assign(load(), patch || {});
  writeAtomic(configPath(), JSON.stringify(merged, null, 2), 0o600);
  return merged;
}

// ---- derived ports ----
function basePort() { return parseInt(load().basePort, 10) || DEFAULTS.basePort; }
/** "parlons" or "minima" (see DEFAULTS.nodeKind). */
function nodeKind() { return load().nodeKind === "minima" ? "minima" : "parlons"; }
/** The Parlons account's loopback web panel (Parlons kind only). */
function panelPort() { return basePort() + 586; }
/** The Parlons Node's loopback wallet gateway (Parlons kind only). */
function gatewayPort() { return basePort() + 584; }
/** The MegaMMR host a seed phrase is restored from (host:port). */
function megammrHost() { const h = String(load().megammrHost || "").trim(); return /^[\w.\-]+:\d+$/.test(h) ? h : ""; }
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

// ---- secret startup params (dbpassword, mysqldb): encrypted 0600 files, a `true` marker in config.json ----
function paramSecretPath(flag) { return secretPath("param-" + String(flag).replace(/[^a-z0-9-]/gi, "_") + ".secret"); }
function paramSecretGet(flag) { return readSecret(paramSecretPath(flag)); }
function paramSecretSet(flag, value) { writeSecret(paramSecretPath(flag), value); }
function paramSecretDelete(flag) { try { fs.unlinkSync(paramSecretPath(flag)); } catch (e) {} }

/**
 * The startup params to hand to the jar: { argv: [flag, value|true], conf: { flag: secret } }.
 * argv params are appended after the managed ones (bool → `-flag`, value → `-flag <v>`); conf params are
 * secrets and go into the 0600 node.conf next to rpcpassword/mdspassword. Managed flags are never here.
 */
function effectiveParams(cfg) {
  const p = (cfg || load()).params || {};
  const argv = [], conf = {};
  for (const it of PARAMS.ITEMS) {
    const v = p[it.flag];
    if (it.type === "bool") { if (v === true) argv.push([it.flag, true]); continue; }
    if (it.type === "secret") {
      if (v === true) { const s = paramSecretGet(it.flag); if (s) conf[it.flag] = s; }
      continue;
    }
    const str = String(v == null ? "" : v).trim();
    if (str) argv.push([it.flag, str]);
  }
  return { argv, conf };
}

module.exports = {
  load, save, writeAtomic, defaultDataFolder,
  basePort, rpcPort, mdsPort, nodeKind, panelPort, gatewayPort, megammrHost,
  rpcSecret, mdsPassword,
  effectiveParams, paramSecretGet, paramSecretSet, paramSecretDelete
};
