/*
 * carryover.js — switching from the classic node to the Parlons Node without losing the wallet.
 *
 * The two kinds are two separate nodes: the classic jar keeps its node under <data>/1.0, the Parlons
 * Node under <data>/1.1 (different H2 file formats - the folders can never be shared). "Carry my wallet
 * over" therefore means: read the seed phrase and the key-use counters from the RUNNING classic node,
 * stop it, pin the Parlons identity to that phrase before the Parlons Node's first boot (identity.txt is
 * honoured when it exists), start the Parlons Node, restore the phrase into its wallet with
 * `megammrsync action:resync … phrase:"…" keyuses:N` (the node resyncs its coins from a MegaMMR host and
 * shuts down; node-manager restarts it), then VERIFY: same phrase in the vault, the same 64 public keys,
 * every key's use counter at least N. The phrase lives in this module's memory for the duration of the
 * switch and nowhere else; node-manager redacts `phrase:"…"` from the log ring, rpc.js logs nothing.
 *
 * Key uses: a Minima key is a one-time-signature chain; signing with a use counter below the true one
 * re-uses a one-time key. N = the highest per-key `uses` the classic node reports + 2 (over-estimating is
 * safe, under-estimating is not).
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const node = require("./node-manager");
const { rpcCall } = require("./rpc");

const CLASSIC_FOLDER = "1.0";     // the classic jar's node folder under <data>
const PARLONS_FOLDER = "1.1";     // the Parlons Node's (fork base version)
const KEYUSES_MARGIN = 2;
const RPC_WAIT_MS = 4 * 60_000;   // a fresh Parlons Node needs its SSL keystore + 64 keys before vault answers
const RESYNC_WAIT_MS = 20 * 60_000;
// Fleet nodes that serve a MegaMMR (NODE-SETUP.md "The fleet"): megammr, eurobuddha, sally. The Pi (31.125.188.214)
// runs --no-megammr and answers a resync with "Error getting MegaMMR data from host". Tried in order.
const MEGAMMR_HOSTS = ["192.248.151.55:9101", "65.109.31.226:9101", "95.179.179.181:9001"];
// Everything the Parlons ACCOUNT keeps beside the node folder - moved aside together with a replaced 1.1.
const ACCOUNT_FILES = ["identity.txt", "account.txt", "devices.json", "pair-code.txt", "invite.txt", "panel-ticket.txt",
  "panel.txt", "local-device.key", "wallet-address.txt", "gateway-token.txt", "chat", "relay", "media", "nft", "node"];

let state = { stage: "idle", ok: null, error: "", mode: "", detail: "", verified: null, startedAt: 0, finishedAt: 0 };
let running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function dataDir() { return node.dataDir(); }
function set(patch) { state = Object.assign({}, state, patch); node.emit("status", node.snapshot()); }
function current() { return state; }
function classicContactsPath() { return path.join(app.getPath("userData"), "classic-contacts.json"); }

/** What an existing Parlons node folder holds - for the switch dialog ("Replace it" / "Keep it"). */
function existingParlons() {
  const d = dataDir();
  const dir = path.join(d, PARLONS_FOLDER);
  if (!fs.existsSync(dir)) return { exists: false };
  let devices = 0;
  try { const j = JSON.parse(fs.readFileSync(path.join(d, "devices.json"), "utf8")); devices = Array.isArray(j) ? j.length : Object.keys(j.devices || j).length; } catch (e) {}
  let address = "";
  try { address = fs.readFileSync(path.join(d, "wallet-address.txt"), "utf8").trim(); } catch (e) {}
  let created = 0;
  try { created = fs.statSync(dir).birthtimeMs || fs.statSync(dir).mtimeMs; } catch (e) {}
  return { exists: true, folder: dir, devices, address, created, hasIdentity: fs.existsSync(path.join(d, "identity.txt")) };
}

/** Balance of the RUNNING node (any kind) - the dialog shows it for the node about to be replaced. */
async function runningBalance() {
  try {
    const r = await rpcCall(config.rpcPort(), config.rpcSecret(), "balance");
    const rows = (r && r.status && Array.isArray(r.response)) ? r.response : [];
    const m = rows.find((b) => b && (b.tokenid === "0x00" || b.token === "Minima")) || rows[0];
    return m ? { confirmed: String(m.confirmed || "0"), unconfirmed: String(m.unconfirmed || "0") } : null;
  } catch (e) { return null; }
}

/** Read what the classic node must hand over. Throws with a user-facing reason. */
async function preflight() {
  const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
  const v = await rpc("vault");
  if (!v || !v.status || !v.response) throw new Error("the classic node did not answer `vault` - is it running and synced?");
  if (v.response.locked) throw new Error("the classic wallet is password-locked: unlock it first (Terminal: vault action:passwordunlock), then switch");
  const phrase = String(v.response.phrase || "").trim();
  if (!/^[A-Za-z]+( [A-Za-z]+){23}$/.test(phrase)) throw new Error("the classic node's seed phrase is not 24 plain words - carry-over needs a standard phrase");
  const k = await rpc("keys action:list");
  const keys = (k && k.status && k.response && Array.isArray(k.response.keys)) ? k.response.keys : [];
  if (!keys.length) throw new Error("the classic node listed no keys");
  let maxUses = 0;
  const pubkeys = [];
  for (const kr of keys) {
    const u = parseInt(kr.uses, 10); if (Number.isFinite(u) && u > maxUses) maxUses = u;
    if (kr.publickey) pubkeys.push(String(kr.publickey).toUpperCase());
  }
  const keyuses = maxUses + KEYUSES_MARGIN;
  let address = "";
  try { const a = await rpc("getaddress"); address = (a && a.status && a.response && (a.response.miniaddress || a.response.address)) || ""; } catch (e) {}
  return { phrase, keyuses, pubkeys, address };
}

/** classic Maxima's contacts and name, for the selective import later (never the seed). Any mode. */
async function readClassicMaxima() {
  const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
  let contacts = [], name = "", address = "";
  try {
    const mc = await rpc("maxcontacts action:list");
    const list = (mc && mc.status && mc.response && Array.isArray(mc.response.contacts)) ? mc.response.contacts : [];
    contacts = list.map((c) => ({
      publickey: String(c.publickey || ""), currentaddress: String(c.currentaddress || ""),
      name: String((c.extradata && c.extradata.name) || ""), mls: String((c.extradata && c.extradata.mls) || ""),
      minimaaddress: String((c.extradata && c.extradata.minimaaddress) || ""), lastseen: Number(c.lastseen || 0)
    })).filter((c) => c.publickey);
    const mi = await rpc("maxima action:info");
    name = (mi && mi.status && mi.response && String(mi.response.name || "")) || "";
    const a = await rpc("getaddress"); address = (a && a.status && a.response && (a.response.miniaddress || a.response.address)) || "";
  } catch (e) { /* classic Maxima not up - no contacts to offer */ }
  return { contacts, name, address };
}

function saveClassicContacts(contacts, name, address) {
  try {
    config.writeAtomic(classicContactsPath(), JSON.stringify({ savedAt: Date.now(), name, classicAddress: address, contacts }, null, 2), 0o600);
  } catch (e) {}
}

/** Move an existing Parlons node (and the account files beside it) out of the way. Never deletes. */
function setAsideParlons() {
  const d = dataDir();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const dest = path.join(d, PARLONS_FOLDER + "-set-aside-" + stamp);
  fs.mkdirSync(dest, { recursive: true });
  const src = path.join(d, PARLONS_FOLDER);
  if (fs.existsSync(src)) fs.renameSync(src, path.join(dest, "node-" + PARLONS_FOLDER));
  for (const f of ACCOUNT_FILES) {
    const p = path.join(d, f);
    if (fs.existsSync(p)) { try { fs.renameSync(p, path.join(dest, f)); } catch (e) {} }
  }
  return dest;
}

function writeIdentity(phrase) {
  const p = path.join(dataDir(), "identity.txt");
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(p, phrase + "\n", { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch (e) {}
}

async function waitForVault(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (!running) throw new Error("cancelled");
    try {
      const v = await rpcCall(config.rpcPort(), config.rpcSecret(), "vault");
      if (v && v.status && v.response && v.response.phrase && !v.response.locked) return v.response;
    } catch (e) {}
    await sleep(3000);
  }
  throw new Error("the Parlons Node did not bring its wallet up in time - see Node logs");
}

/**
 * The whole switch. `existing`: "replace" (set aside an existing 1.1 + account files) | "keep" (use it as
 * it is, no carry-over) | "" (none). `mode`: "carry" | "fresh". Runs in the background; progress is in
 * node:snapshot.carryover. Returns as soon as the work is started.
 */
function start({ mode, existing, heapMb }) {
  if (running) return { status: false, error: "a switch is already running" };
  running = true;
  state = { stage: "preflight", ok: null, error: "", mode, detail: "", verified: null, startedAt: Date.now(), finishedAt: 0 };
  node.emit("status", node.snapshot());
  (async () => {
    let pre = null;
    try {
      if (config.nodeKind() !== "minima") throw new Error("carry-over starts from the classic node - switch to it first");
      if (existing === "keep") mode = "keep";
      // the classic Maxima contacts are snapshotted whatever the mode (they are the only chance: the classic node
      // is not running once the Parlons Node is), but only replace an older snapshot when there is something in it
      set({ stage: "preflight", detail: "Reading the classic node's Maxima contacts…" });
      const mx = await readClassicMaxima();
      if (mx.contacts.length || !fs.existsSync(classicContactsPath())) saveClassicContacts(mx.contacts, mx.name, mx.address);
      if (mode === "carry") {
        set({ stage: "preflight", detail: "Reading the seed phrase and key-use counters from the classic node…" });
        pre = await preflight();
      }
      set({ stage: "stopping", detail: "Stopping the classic node cleanly…" });
      await node.stop();
      if (existing === "replace") {
        set({ stage: "setaside", detail: "Setting the earlier Parlons node aside (nothing is deleted)…" });
        const dest = setAsideParlons();
        set({ detail: "Set aside at " + dest });
      }
      if (mode !== "keep") config.save({ parlonsCarried: null });
      if (mode === "carry") {
        writeIdentity(pre.phrase);   // the account derives its MAX# from the classic seed at first boot
      }
      config.save({ nodeKind: "parlons", heapMb: Math.max(0, parseInt(heapMb, 10) || 0) });
      set({ stage: "starting", detail: "Starting the Parlons Node…" });
      await node.start();
      if (mode !== "carry") {
        set({ stage: "done", ok: true, finishedAt: Date.now(), detail: mode === "keep" ? "Using the existing Parlons node as it is." : "A brand-new Parlons node with its own seed. Back it up: Terminal → vault." });
        return;
      }
      set({ stage: "waiting", detail: "Waiting for the Parlons Node's wallet (SSL keystore + 64 keys)…" });
      await waitForVault(RPC_WAIT_MS);
      const hosts = [config.megammrHost(), ...MEGAMMR_HOSTS].filter((h, i, a) => h && a.indexOf(h) === i);
      let r = null, usedHost = "", lastErr = "";
      for (const host of hosts) {
        if (!running) throw new Error("cancelled");
        set({ stage: "resync", detail: "Restoring your seed phrase into the Parlons Node and resyncing its coins from " + host + " (key uses set to " + pre.keyuses + ")…" });
        r = await rpcCall(config.rpcPort(), config.rpcSecret(), 'megammrsync action:resync host:' + host + ' phrase:"' + pre.phrase + '" anyphrase:true keyuses:' + pre.keyuses);
        if (r && r.status) { usedHost = host; break; }
        lastErr = (r && r.error) || "unknown error";
        node.log("[app] carry-over: MegaMMR host " + host + " refused the resync (" + lastErr + ") - trying the next");
      }
      if (!usedHost) throw new Error("no MegaMMR node accepted the resync (" + hosts.join(", ") + "): " + lastErr);
      // The node shuts itself down after the resync and (node 0.2.62+) exits; node-manager restarts it
      // (clean exit 0 → self-restart). An older node lingers with a dead chain: stop it ourselves and start again.
      set({ stage: "restarting", detail: "The node restarts itself after the resync (resynced from " + usedHost + ")…" });
      const child = node.proc;
      const exitBy = Date.now() + 90_000;
      while (node.proc === child && Date.now() < exitBy) { if (!running) throw new Error("cancelled"); await sleep(1000); }
      if (node.proc === child && child) {
        node.log("[app] carry-over: the node did not exit after the resync - stopping it and starting again");
        await node.stop();
        await node.start();
      }
      const until = Date.now() + RESYNC_WAIT_MS;
      while (Date.now() < until) {
        if (!running) throw new Error("cancelled");
        const s = node.snapshot();
        if (s.state === "running" && node.proc && node.proc !== child) break;
        if (s.state === "error") throw new Error("the node did not come back after the resync: " + (s.lastError || "see Node logs"));
        if (s.state === "stopped") { await node.start(); }
        await sleep(2000);
      }
      set({ stage: "verifying", detail: "Verifying the restored wallet…" });
      const v = await waitForVault(RPC_WAIT_MS);
      const same = String(v.phrase || "").trim().toUpperCase() === pre.phrase.toUpperCase();
      const k = await rpcCall(config.rpcPort(), config.rpcSecret(), "keys action:list");
      const keys = (k && k.status && k.response && Array.isArray(k.response.keys)) ? k.response.keys : [];
      const got = new Set(keys.map((x) => String(x.publickey || "").toUpperCase()));
      const matched = pre.pubkeys.filter((p) => got.has(p)).length;
      const minUses = keys.reduce((m, x) => Math.min(m, parseInt(x.uses, 10) || 0), Infinity);
      const verified = { phrase: same, addresses: matched, addressesOf: pre.pubkeys.length, keyuses: minUses === Infinity ? 0 : minUses, wanted: pre.keyuses, classicAddress: pre.address };
      const ok = same && matched === pre.pubkeys.length && matched > 0 && verified.keyuses >= pre.keyuses;
      if (ok) config.save({ parlonsCarried: { at: Date.now(), classicAddress: pre.address, keys: matched, keyuses: verified.keyuses } });
      set({ stage: "done", ok, verified, finishedAt: Date.now(),
        error: ok ? "" : "verification failed: " + (!same ? "the vault phrase differs" : matched !== pre.pubkeys.length ? "only " + matched + " of " + pre.pubkeys.length + " keys match" : "key uses " + verified.keyuses + " < " + pre.keyuses),
        detail: ok ? "Your wallet is on the Parlons Node: same seed, " + matched + " of " + pre.pubkeys.length + " keys, key uses " + verified.keyuses + "." : "" });
    } catch (e) {
      set({ stage: "done", ok: false, error: (e && e.message) || String(e), finishedAt: Date.now() });
    } finally {
      pre = null;   // the phrase leaves memory here
      running = false;
    }
  })();
  return { status: true };
}

function cancel() { running = false; }

module.exports = { start, cancel, current, existingParlons, runningBalance, classicContactsPath, CLASSIC_FOLDER, PARLONS_FOLDER };
