/*
 * carryover.js — switching between the classic node and the Parlons Node without losing the wallet or
 * re-using a one-time signing key.
 *
 * The two kinds are two separate nodes: the classic jar keeps its node under <data>/1.0, the Parlons Node
 * under <data>/1.1 (different H2 file formats - the folders can never be shared). "Carry my wallet over"
 * means: read the seed phrase and the key-use counters from the RUNNING classic node, stop it, pin the
 * Parlons identity to that phrase before the Parlons Node's first boot (identity.txt is honoured when it
 * exists), start the Parlons Node, restore the phrase into its wallet with `megammrsync action:resync …
 * phrase:"…" keyuses:N` (the node resyncs its coins from a MegaMMR host and exits; node-manager restarts
 * it), then VERIFY: same phrase in the vault, the same 64 public keys, every key's use counter at least N.
 * The phrase lives in this module's memory for the duration of the switch and nowhere else; node-manager
 * redacts `phrase:"…"` from the log ring, rpc.js logs nothing.
 *
 * KEY USES, BOTH WAYS. A Minima key signs with a one-time-signature chain: `uses` is how many slots are
 * spent; signing with a counter below the true one re-uses a slot. Once both nodes hold the same wallet,
 * EVERY switch reads the node being LEFT (its highest per-key `uses` = m) and sets every key of the node
 * being STARTED to m + KEYUSES_MARGIN (100) - always, whether or not the app saw any signing: dapps, the
 * phone gateway or an in-flight signature can spend slots the app never observes, so each switch moves
 * the counters up by a full margin (501 on classic → 601 on Parlons → 701 back on classic). The first
 * carry-over uses the same m + 100. The ledger (config.keyUses) only records what was seen. Raising on the Parlons Node = `keys action:createallkeys keyuses:N`
 * (fork only); on the classic node = its own `megammrsync … phrase:"<its own vault phrase>" keyuses:N`
 * (the 1.0.49 jar has no cheaper counter-setting command; `vault resetkeys` wipes the chain DBs). Until a
 * needed raise has succeeded, config.keyUsesPending names the node that must not sign, and the Settings
 * sheet says so in red with a Retry.
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const node = require("./node-manager");
const { rpcCall } = require("./rpc");

const CLASSIC_FOLDER = "1.0";     // the classic jar's node folder under <data>
const PARLONS_FOLDER = "1.1";     // the Parlons Node's (fork base version)
const KEYUSES_MARGIN = 100;       // added to the highest observed use on EVERY switch (owner's rule, 2026-09-08)
const RPC_WAIT_MS = 4 * 60_000;   // a fresh Parlons Node needs its SSL keystore + 64 keys before vault answers
const RESYNC_WAIT_MS = 20 * 60_000;
// Fleet nodes that serve a MegaMMR (NODE-SETUP.md "The fleet"): megammr, eurobuddha, sally. The Pi (31.125.188.214)
// runs --no-megammr and answers a resync with "Error getting MegaMMR data from host". Tried in order.
const MEGAMMR_HOSTS = ["192.248.151.55:9101", "65.109.31.226:9101", "95.179.179.181:9001"];
// Everything the Parlons ACCOUNT keeps beside the node folder - moved aside together with a replaced 1.1.
const ACCOUNT_FILES = ["identity.txt", "account.txt", "devices.json", "pair-code.txt", "invite.txt", "panel-ticket.txt",
  "panel.txt", "local-device.key", "wallet-address.txt", "gateway-token.txt", "chat", "relay", "media", "nft", "node"];

let state = { stage: "idle", ok: null, error: "", mode: "", target: "", detail: "", verified: null, startedAt: 0, finishedAt: 0 };
let running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
function dataDir() { return node.dataDir(); }
function set(patch) { state = Object.assign({}, state, patch); node.emit("status", node.snapshot()); }
function current() { return state; }
function classicContactsPath() { return path.join(app.getPath("userData"), "classic-contacts.json"); }
function ledger() { const l = config.load().keyUses; return (l && typeof l === "object") ? l : {}; }
function recordUses(kind, max) { const l = ledger(); l[kind] = { max, at: Date.now() }; config.save({ keyUses: l }); }

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
  return { exists: true, folder: dir, devices, address, created, hasIdentity: fs.existsSync(path.join(d, "identity.txt")), carried: !!config.load().parlonsCarried };
}

/** Balance of the RUNNING node (any kind) - the dialog shows it for the node about to be replaced. */
async function runningBalance() {
  try {
    const r = await rpc("balance");
    const rows = (r && r.status && Array.isArray(r.response)) ? r.response : [];
    const m = rows.find((b) => b && (b.tokenid === "0x00" || b.token === "Minima")) || rows[0];
    return m ? { confirmed: String(m.confirmed || "0"), unconfirmed: String(m.unconfirmed || "0") } : null;
  } catch (e) { return null; }
}

/** The RUNNING node's keys: highest per-key `uses`, the lowest, and the public keys. Throws when unreadable. */
async function readKeys() {
  const k = await rpc("keys action:list");
  const keys = (k && k.status && k.response && Array.isArray(k.response.keys)) ? k.response.keys : [];
  if (!keys.length) throw new Error("the node listed no keys");
  let max = 0, min = Infinity;
  const pubkeys = [];
  for (const kr of keys) {
    const u = parseInt(kr.uses, 10);
    if (Number.isFinite(u)) { if (u > max) max = u; if (u < min) min = u; }
    if (kr.publickey) pubkeys.push(String(kr.publickey).toUpperCase());
  }
  return { max, min: min === Infinity ? 0 : min, pubkeys, count: keys.length };
}

/** The RUNNING node's vault phrase (24 plain words) - throws with a user-facing reason. */
async function readPhrase(kindLabel) {
  const v = await rpc("vault");
  if (!v || !v.status || !v.response) throw new Error("the " + kindLabel + " node did not answer `vault` - is it running?");
  if (v.response.locked) throw new Error("the " + kindLabel + " wallet is password-locked: unlock it first (Terminal: vault action:passwordunlock), then switch");
  const phrase = String(v.response.phrase || "").trim();
  if (!/^[A-Za-z]+( [A-Za-z]+){23}$/.test(phrase)) throw new Error("the " + kindLabel + " node's seed phrase is not 24 plain words - carry-over needs a standard phrase");
  return phrase;
}

/** classic Maxima's contacts and name, for the selective import later (never the seed). Any mode. */
async function readClassicMaxima() {
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
      const v = await rpc("vault");
      if (v && v.status && v.response && v.response.phrase && !v.response.locked) return v.response;
    } catch (e) {}
    await sleep(3000);
  }
  throw new Error("the node did not bring its wallet up in time - see Node logs");
}

/** Wait for the running node's child to exit (it shuts itself down after a resync), then to be back. */
async function waitForSelfRestart(stageDetail) {
  set({ stage: "restarting", detail: stageDetail });
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
    if (s.state === "running" && node.proc && node.proc !== child) return;
    if (s.state === "error") throw new Error("the node did not come back after the resync: " + (s.lastError || "see Node logs"));
    if (s.state === "stopped") { await node.start(); }
    await sleep(2000);
  }
  throw new Error("the node did not come back after the resync in time");
}

/** `megammrsync action:resync` with the phrase and key uses, trying the MegaMMR hosts in order. Returns the host. */
async function resync(phrase, keyuses, label) {
  const hosts = [config.megammrHost(), ...MEGAMMR_HOSTS].filter((h, i, a) => h && a.indexOf(h) === i);
  let lastErr = "";
  for (const host of hosts) {
    if (!running) throw new Error("cancelled");
    set({ stage: "resync", detail: label + " from " + host + " (key uses set to " + keyuses + ")…" });
    const child = node.proc;
    let r;
    try {
      r = await rpc('megammrsync action:resync host:' + host + ' phrase:"' + phrase + '" anyphrase:true keyuses:' + keyuses);
    } catch (e) {
      // the classic jar shuts down inside the command and may close the RPC before its reply leaves: the
      // node going away within a few seconds IS the acceptance
      const by = Date.now() + 30_000;
      while (node.proc === child && Date.now() < by) await sleep(1000);
      if (node.proc !== child) { node.log("[app] carry-over: the node shut itself down during the resync reply (" + e.message + ") - taking that as accepted"); return host; }
      throw e;
    }
    if (r && r.status) return host;
    lastErr = (r && r.error) || "unknown error";
    node.log("[app] carry-over: MegaMMR host " + host + " refused the resync (" + lastErr + ") - trying the next");
  }
  throw new Error("no MegaMMR node accepted the resync (" + hosts.join(", ") + "): " + lastErr);
}

/**
 * Raise the RUNNING node's counters to N (every key), the way its kind allows, and verify. Records the
 * ledger and clears config.keyUsesPending on success; leaves keyUsesPending set on failure.
 */
async function raiseRunning(kind, N) {
  config.save({ keyUsesPending: { kind, to: N, at: Date.now() } });
  if (kind === "parlons") {
    set({ stage: "raising", detail: "Raising the Parlons Node's key-use counters to " + N + "…" });
    const r = await rpc("keys action:createallkeys keyuses:" + N);
    if (!r || !r.status) throw new Error("keys action:createallkeys refused: " + ((r && r.error) || "unknown error"));
    const until = Date.now() + 5 * 60_000;
    while (Date.now() < until) {
      await sleep(2000);
      const k = await readKeys().catch(() => null);
      if (k && k.min >= N) { recordUses("parlons", k.max); config.save({ keyUsesPending: null }); return k; }
    }
    throw new Error("the Parlons Node did not raise every key to " + N + " in time");
  }
  // classic: only megammrsync sets the counters; the phrase is the classic node's OWN, read from itself
  set({ stage: "raising", detail: "Reading the classic node's own phrase to raise its key-use counters…" });
  const phrase = await readPhrase("classic");
  await resync(phrase, N, "Raising the classic node's key-use counters to " + N + " by resyncing its wallet");
  await waitForSelfRestart("The classic node restarts itself after the resync…");
  await waitForVault(RPC_WAIT_MS);
  const k = await readKeys();
  if (k.min < N) throw new Error("the classic node's key uses are " + k.min + " after the resync, wanted " + N);
  recordUses("minima", k.max);   // the ledger is keyed by node kind ("minima" = the classic jar)
  config.save({ keyUsesPending: null });
  return k;
}

/**
 * The whole switch. `target`: "parlons" | "minima". For classic → Parlons, `mode`: "carry" | "fresh" and
 * `existing`: "replace" | "keep" | "" when a 1.1 exists. Runs in the background; progress is in
 * node:snapshot.carryover. Returns as soon as the work is started.
 */
function start({ target, mode, existing, heapMb }) {
  if (running) return { status: false, error: "a switch is already running" };
  running = true;
  const from = config.nodeKind();
  const fromLabel = from === "parlons" ? "Parlons" : "classic";
  const targetLabel = target === "parlons" ? "Parlons" : "classic";
  state = { stage: "preflight", ok: null, error: "", mode: mode || "", target, detail: "", verified: null, startedAt: Date.now(), finishedAt: 0 };
  node.emit("status", node.snapshot());
  (async () => {
    let pre = null;
    try {
      const heap = Math.max(0, parseInt(heapMb, 10) || 0);
      const sameWallet = !!config.load().parlonsCarried;   // both nodes hold the classic wallet (a verified carry)
      // ---- the node being LEFT: its highest key use (for the raise on the other side) ----
      let leftMax = null, leftSigned = false;
      if (from === "minima" || sameWallet) {
        set({ stage: "preflight", detail: "Reading the key-use counters of the " + fromLabel + " node…" });
        try {
          const k = await readKeys();
          leftMax = k.max;
          const rec = ledger()[from];
          leftSigned = !rec || k.max > rec.max;   // signing happened here since the last switch (or never recorded)
          recordUses(from, k.max);
        } catch (e) {
          const rec = ledger()[from];
          if (rec) { leftMax = rec.max; leftSigned = false; node.log("[app] carry-over: could not read the " + fromLabel + " node's keys (" + e.message + ") - using the ledger's " + rec.max); }
          else if (from === "minima" && mode === "carry") throw e;
        }
      }
      if (from === "minima") {
        // the classic Maxima contacts are snapshotted whatever the mode (the only chance: the classic node is not
        // running once the Parlons Node is); an older snapshot is only replaced when there is something new
        set({ stage: "preflight", detail: "Reading the classic node's Maxima contacts…" });
        const mx = await readClassicMaxima();
        if (mx.contacts.length || !fs.existsSync(classicContactsPath())) saveClassicContacts(mx.contacts, mx.name, mx.address);
      }
      if (target === "parlons" && existing === "keep") mode = "keep";
      if (target === "parlons" && mode === "carry") {
        set({ stage: "preflight", detail: "Reading the seed phrase from the classic node…" });
        pre = { phrase: await readPhrase("classic"), keys: await readKeys() };
        try { const a = await rpc("getaddress"); pre.address = (a && a.status && a.response && (a.response.miniaddress || a.response.address)) || ""; } catch (e) { pre.address = ""; }
      }
      // ---- stop, set aside, start the other kind ----
      set({ stage: "stopping", detail: "Stopping the " + fromLabel + " node cleanly…" });
      await node.stop();
      if (target === "parlons" && existing === "replace") {
        set({ stage: "setaside", detail: "Setting the earlier Parlons node aside (nothing is deleted)…" });
        const dest = setAsideParlons();
        set({ detail: "Set aside at " + dest });
      }
      if (target === "parlons" && mode !== "keep") config.save({ parlonsCarried: null, keyUsesPending: null, keyUses: from === "minima" && ledger().minima ? { minima: ledger().minima } : {} });
      if (target === "parlons" && mode === "carry") writeIdentity(pre.phrase);   // the account derives its MAX# from the classic seed at first boot
      config.save({ nodeKind: target, heapMb: heap });
      set({ stage: "starting", detail: "Starting the " + targetLabel + " node…" });
      await node.start();

      if (target === "parlons" && mode === "carry") {
        set({ stage: "waiting", detail: "Waiting for the Parlons Node's wallet (SSL keystore + 64 keys)…" });
        await waitForVault(RPC_WAIT_MS);
        const N = pre.keys.max + KEYUSES_MARGIN;
        config.save({ keyUsesPending: { kind: "parlons", to: N, at: Date.now() } });
        const host = await resync(pre.phrase, N, "Restoring your seed phrase into the Parlons Node and resyncing its coins");
        await waitForSelfRestart("The node restarts itself after the resync (resynced from " + host + ")…");
        set({ stage: "verifying", detail: "Verifying the restored wallet…" });
        const v = await waitForVault(RPC_WAIT_MS);
        const same = String(v.phrase || "").trim().toUpperCase() === pre.phrase.toUpperCase();
        const k = await readKeys();
        const got = new Set(k.pubkeys);
        const matched = pre.keys.pubkeys.filter((p) => got.has(p)).length;
        const verified = { phrase: same, addresses: matched, addressesOf: pre.keys.pubkeys.length, keyuses: k.min, wanted: N, classicAddress: pre.address };
        const ok = same && matched === pre.keys.pubkeys.length && matched > 0 && k.min >= N;
        if (ok) { config.save({ parlonsCarried: { at: Date.now(), classicAddress: pre.address, keys: matched, keyuses: k.min }, keyUsesPending: null }); recordUses("parlons", k.max); }
        set({ stage: "done", ok, verified, finishedAt: Date.now(),
          error: ok ? "" : "verification failed: " + (!same ? "the vault phrase differs" : matched !== pre.keys.pubkeys.length ? "only " + matched + " of " + pre.keys.pubkeys.length + " keys match" : "key uses " + k.min + " < " + N),
          detail: ok ? "Your wallet is on the Parlons Node: same seed, " + matched + " of " + pre.keys.pubkeys.length + " keys, key uses " + k.min + " (classic had " + pre.keys.max + ")." : "" });
        return;
      }
      // ---- the same wallet on both sides: mirror the counters onto the node just started ----
      if (sameWallet && (target === "minima" || mode === "keep") && leftMax !== null) {
        set({ stage: "waiting", detail: "Waiting for the " + targetLabel + " node's wallet…" });
        await waitForVault(RPC_WAIT_MS);
        const here = await readKeys();
        // a raise still pending for THIS node (an earlier attempt failed) is owed whatever the ledger says
        const pending = config.load().keyUsesPending;
        const N = Math.max(leftMax + KEYUSES_MARGIN, pending && pending.kind === target ? pending.to : 0);
        if (here.min < N) {
          const k = await raiseRunning(target, N);
          set({ stage: "done", ok: true, finishedAt: Date.now(), verified: { keyuses: k.min, wanted: N },
            detail: "Key-use counters moved up: the " + fromLabel + " node's highest use was " + leftMax + (leftSigned ? " (signing happened there)" : "") + ", so every key here is now at " + k.min + " (+" + KEYUSES_MARGIN + " margin)." });
        } else {
          recordUses(target, here.max);
          if (pending && pending.kind === target) config.save({ keyUsesPending: null });   // already at or above what was owed
          set({ stage: "done", ok: true, finishedAt: Date.now(), verified: { keyuses: here.min, wanted: N },
            detail: "Key-use counters already at " + here.min + ", above the " + fromLabel + " node's highest use " + leftMax + " + " + KEYUSES_MARGIN + " - unchanged." });
        }
        return;
      }
      set({ stage: "done", ok: true, finishedAt: Date.now(), detail: target === "minima" ? "Classic node started." : mode === "keep" ? "Using the existing Parlons node as it is." : "A brand-new Parlons node with its own seed. Back it up: Terminal → vault." });
    } catch (e) {
      set({ stage: "done", ok: false, error: (e && e.message) || String(e), finishedAt: Date.now() });
    } finally {
      pre = null;   // the phrase leaves memory here
      running = false;
    }
  })();
  return { status: true };
}

/** Retry a pending raise on the RUNNING node (Settings → Retry). */
function retryRaise() {
  if (running) return { status: false, error: "a switch is already running" };
  const p = config.load().keyUsesPending;
  if (!p || !p.kind) return { status: false, error: "nothing pending" };
  if (config.nodeKind() !== (p.kind === "minima" ? "minima" : "parlons")) return { status: false, error: "switch to the " + (p.kind === "parlons" ? "Parlons" : "classic") + " node first" };
  running = true;
  state = { stage: "raising", ok: null, error: "", mode: "raise", target: p.kind, detail: "", verified: null, startedAt: Date.now(), finishedAt: 0 };
  node.emit("status", node.snapshot());
  (async () => {
    try {
      await waitForVault(RPC_WAIT_MS);
      const k = await raiseRunning(p.kind, p.to);
      set({ stage: "done", ok: true, finishedAt: Date.now(), verified: { keyuses: k.min, wanted: p.to }, detail: "Key-use counters raised to " + k.min + "." });
    } catch (e) { set({ stage: "done", ok: false, error: (e && e.message) || String(e), finishedAt: Date.now() }); }
    finally { running = false; }
  })();
  return { status: true };
}

function cancel() { running = false; }

module.exports = { start, retryRaise, cancel, current, existingParlons, runningBalance, classicContactsPath, CLASSIC_FOLDER, PARLONS_FOLDER };
