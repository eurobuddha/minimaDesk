/*
 * provision.js — keep the bundled MiniDapps installed and current.
 *
 * minimaDesk ships a few of its own MiniDapps (resources/dapps/manifest.json — the minimaCore App
 * Store and Terminal IDE) because the shell's Store and Terminal buttons open them. Once MDS answers
 * after boot:
 *   1. not installed            → `mds action:install file:"<zip>" trust:write`
 *   2. bundled version newer    → `mds action:update uid:<uid> file:"<zip>"` (uid + permission kept)
 *   3. permission not write     → `mds action:permission uid:<uid> trust:write`
 *   4. the PandaDapps catalog lists a newer version → download it and update in place
 * Nothing else is ever auto-updated. Offline or a broken zip is logged, never fatal.
 */
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fetchBuffer } = require("./net");
const { compareVersions } = require("./versions");

const CATALOG_URL = "https://eurobuddha.com/pandadapps.json";

function dappsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "dapps")
    : path.join(__dirname, "..", "resources", "dapps");
}

function readManifest(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    return Array.isArray(j.dapps) ? j.dapps.filter((d) => d && d.name && d.file) : [];
  } catch (e) { return null; }
}

const lc = (s) => String(s || "").toLowerCase();

async function listInstalled(rpc) {
  let r;
  try { r = await rpc("mds action:list"); } catch (e) { return null; }
  if (!r || !r.status || !r.response || !Array.isArray(r.response.minidapps)) return null;
  return r.response.minidapps.map((d) => ({
    uid: d.uid,
    name: (d.conf && d.conf.name) || "",
    version: String((d.conf && d.conf.version) || "0"),
    permission: (d.conf && d.conf.permission) || "read"
  }));
}

function findInstalled(list, name, log) {
  const m = list.filter((d) => lc(d.name) === lc(name));
  if (m.length > 1) {
    m.sort((a, b) => compareVersions(b.version, a.version));
    log(`[app] dapps: ${m.length} copies of "${name}" installed (${m.map((x) => "v" + x.version).join(", ")}) — using v${m[0].version}`);
  }
  return m[0] || null;
}

async function ensureWrite(rpc, log, entry, inst) {
  if (!entry.write || !inst || inst.permission === "write") return;
  const r = await rpc(`mds action:permission uid:${inst.uid} trust:write`);
  if (r && r.status) { inst.permission = "write"; log(`[app] dapps: "${entry.name}" permission set to write`); }
  else log(`[app] dapps: could not set write on "${entry.name}": ${(r && r.error) || "no reply"}`);
}

/** Install (inst == null) or update-in-place from a zip on disk. Returns the resulting {uid,name,version,permission} or null. */
async function installOrUpdate(rpc, log, entry, inst, filePath, source) {
  if (!inst) {
    const r = await rpc(`mds action:install file:"${filePath}" trust:${entry.write ? "write" : "read"}`);
    const md = r && r.status && r.response && r.response.installed;
    if (!md) { log(`[app] dapps: install of "${entry.name}" failed: ${(r && r.error) || "no reply"}`); return null; }
    const out = { uid: md.uid, name: md.conf.name, version: String(md.conf.version || "0"), permission: md.conf.permission || "read" };
    log(`[app] dapps: installed "${entry.name}" v${out.version} from ${source} (uid ${out.uid}, ${out.permission})`);
    return out;
  }
  const r = await rpc(`mds action:update uid:${inst.uid} file:"${filePath}"`);
  const md = r && r.status && r.response && r.response.updated;
  if (!md) { log(`[app] dapps: update of "${entry.name}" failed: ${(r && r.error) || "no reply"}`); return inst; }
  const out = { uid: md.uid, name: md.conf.name, version: String(md.conf.version || "0"), permission: md.conf.permission || inst.permission };
  log(`[app] dapps: updated "${entry.name}" v${inst.version} → v${out.version} from ${source} (uid kept ${out.uid})`);
  return out;
}

/**
 * Run once MDS answers. Resolves { ready:false } when MDS is not ready yet (caller retries on its
 * next tick) and { ready:true } when everything that could be done has been done.
 */
async function provisionBundledDapps({ rpc, log, skipCatalog }) {
  const dir = dappsDir();
  const entries = readManifest(dir);
  if (!entries) { log(`[app] dapps: no bundled manifest at ${dir}`); return { ready: true }; }

  const list = await listInstalled(rpc);
  if (!list) return { ready: false };

  const state = new Map();
  for (const e of entries) {
    let inst = findInstalled(list, e.name, log);
    const zip = path.join(dir, e.file);
    if (!fs.existsSync(zip)) {
      log(`[app] dapps: bundled file missing: ${zip}`);
      if (inst) state.set(e.name, inst);
      continue;
    }
    try {
      if (!inst) inst = await installOrUpdate(rpc, log, e, null, zip, "bundle");
      else if (compareVersions(e.version, inst.version) > 0) inst = await installOrUpdate(rpc, log, e, inst, zip, "bundle");
      else log(`[app] dapps: "${e.name}" v${inst.version} installed, bundled v${e.version} — nothing to do`);
      if (inst) { await ensureWrite(rpc, log, e, inst); state.set(e.name, inst); }
    } catch (err) {
      log(`[app] dapps: "${e.name}": ${err.message}`);
    }
  }

  if (skipCatalog) { log("[app] dapps: catalog check skipped"); return { ready: true }; }

  let catalog;
  try {
    const buf = await fetchBuffer(CATALOG_URL, { timeoutMs: 8000 });
    const j = JSON.parse(buf.toString("utf8"));
    catalog = Array.isArray(j.dapps) ? j.dapps : [];
  } catch (err) {
    log(`[app] dapps: catalog unreachable (${err.message}) — skipped`);
    return { ready: true };
  }

  for (const e of entries) {
    const inst = state.get(e.name);
    if (!inst) continue;
    const row = catalog.find((d) => d && lc(d.name) === lc(e.name));
    if (!row || !row.file) { log(`[app] dapps: "${e.name}" is not in the catalog`); continue; }
    const cv = String(row.version || "0");
    if (compareVersions(cv, inst.version) <= 0) { log(`[app] dapps: "${e.name}" v${inst.version} up to date with catalog (v${cv})`); continue; }
    let tmp = "";
    try {
      log(`[app] dapps: catalog has "${e.name}" v${cv} > v${inst.version} — downloading ${row.file}`);
      const buf = await fetchBuffer(String(row.file), { timeoutMs: 60000 });
      if (!buf || buf.length < 100) throw new Error("empty download");
      const safe = (String(row.file).split("/").pop() || "dapp.mds.zip").replace(/[^A-Za-z0-9._-]/g, "_");
      tmp = path.join(os.tmpdir(), "mdesk-" + Date.now() + "-" + safe);
      fs.writeFileSync(tmp, buf);
      const n = await installOrUpdate(rpc, log, e, inst, tmp, `catalog (v${cv})`);
      if (n) { await ensureWrite(rpc, log, e, n); state.set(e.name, n); }
    } catch (err) {
      log(`[app] dapps: catalog update of "${e.name}" failed: ${err.message}`);
    } finally {
      if (tmp) { try { fs.unlinkSync(tmp); } catch (e2) {} }
    }
  }
  return { ready: true };
}

module.exports = { provisionBundledDapps, dappsDir, CATALOG_URL };
