/*
 * prefs.js — tiny key/value store for the hub UI (folders on/off, wallpaper choice, …).
 *
 * Replaces the MiniHUB's `MDS.keypair` (which lives node-side when the hub is served by MDS). A JSON file
 * in userData, 0600, read-modify-write. Values are strings, exactly like keypair.
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function file() { return path.join(app.getPath("userData"), "hub-prefs.json"); }

function readAll() {
  try { const j = JSON.parse(fs.readFileSync(file(), "utf8")); return j && typeof j === "object" ? j : {}; }
  catch (e) { return {}; }
}
function writeAll(obj) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(obj, null, 2), { mode: 0o600 });
}

/** keypair.get semantics: {status:true, value} when present, {status:false} when not. */
function get(key) {
  const all = readAll();
  const k = String(key);
  return Object.prototype.hasOwnProperty.call(all, k) ? { status: true, key: k, value: all[k] } : { status: false, key: k };
}
function set(key, value) {
  const all = readAll();
  all[String(key)] = value == null ? "" : String(value);
  writeAll(all);
  return { status: true, key: String(key), value: all[String(key)] };
}

module.exports = { get, set, readAll };
