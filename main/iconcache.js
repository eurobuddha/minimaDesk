/*
 * iconcache.js — data-URL cache for MDS icons, shared by the `mds:icon` IPC (main.js) and the
 * provisioning/update paths that must evict a dapp's entries after `mds action:update` (the uid and
 * often the version survive an update, so the URL key alone would keep serving the old icon).
 */
const MAX_ENTRIES = 500;
const cache = new Map();

function get(url) { return cache.get(url); }
function has(url) { return cache.has(url); }
function set(url, dataUrl) {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(url, dataUrl);
}
/** Drop every entry whose URL mentions this dapp uid. */
function evictUid(uid) {
  const u = String(uid || "");
  if (!u) return;
  for (const k of Array.from(cache.keys())) { if (k.includes(u)) cache.delete(k); }
}
function clear() { cache.clear(); }

module.exports = { get, has, set, evictUid, clear };
