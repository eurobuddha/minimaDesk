/*
 * contactsimport.js — bring the CLASSIC node's Maxima contacts into the Parlons account, one by one.
 *
 * carryover.js snapshots the classic node's `maxcontacts` into <userData>/classic-contacts.json (0600)
 * at switch time (the classic node is not running afterwards). A classic contact is identified by its
 * Maxima public key (the same RSA key format Parlons uses) and reached through the MLS it is pinned to,
 * so its permanent form is MAX#<publickey>#<mls>; without a known MLS the last current address is
 * used. Adding is a LIVE introduction over the network (parlons.contacts.add): a contact that is
 * offline right now fails and can be retried later; one already in the account is skipped.
 */
const fs = require("fs");
const carryover = require("./carryover");
const parlonsapi = require("./parlonsapi");

function readSnapshot() {
  try { return JSON.parse(fs.readFileSync(carryover.classicContactsPath(), "utf8")); } catch (e) { return null; }
}
const norm = (k) => String(k || "").toUpperCase();

/** The classic contacts with whether the account already has each key. */
async function listClassic() {
  const snap = readSnapshot();
  if (!snap || !Array.isArray(snap.contacts)) return { savedAt: 0, name: "", contacts: [] };
  const have = new Set();
  try {
    const r = await parlonsapi.api("contacts.list", { offset: 0, limit: 500 });
    for (const c of (r && Array.isArray(r.contacts) ? r.contacts : [])) have.add(norm(c.key));
  } catch (e) { /* account not up yet: every row shows as importable */ }
  return {
    savedAt: snap.savedAt || 0, name: snap.name || "", classicAddress: snap.classicAddress || "",
    contacts: snap.contacts.map((c) => ({
      publickey: c.publickey, name: c.name || "", mls: c.mls || "", currentaddress: c.currentaddress || "", lastseen: c.lastseen || 0,
      address: c.mls ? "MAX#" + c.publickey + "#" + c.mls : c.currentaddress,
      already: have.has(norm(c.publickey))
    }))
  };
}

/** Introduce the selected classic contacts to the account and name them. One result per key. */
async function importClassic(publickeys) {
  const snap = readSnapshot();
  const byKey = new Map(((snap && snap.contacts) || []).map((c) => [norm(c.publickey), c]));
  const out = [];
  for (const k of Array.isArray(publickeys) ? publickeys : []) {
    const c = byKey.get(norm(k));
    const row = { publickey: k, name: c ? c.name : "", status: false, error: "" };
    out.push(row);
    if (!c) { row.error = "not in the classic snapshot"; continue; }
    const address = c.mls ? "MAX#" + c.publickey + "#" + c.mls : c.currentaddress;
    if (!address) { row.error = "no address known"; continue; }
    try {
      await parlonsapi.api("contacts.add", { address });
      if (c.name) { try { await parlonsapi.api("contacts.rename", { key: c.publickey, name: c.name }); } catch (e) { /* the name is cosmetic */ } }
      row.status = true;
    } catch (e) {
      const msg = e.message || String(e);
      row.error = /reach|resolve|no reachable|timeout/i.test(msg) ? "not reachable right now - try again later (" + msg + ")" : msg;
    }
  }
  return { status: true, results: out };
}

module.exports = { listClassic, importClassic };
