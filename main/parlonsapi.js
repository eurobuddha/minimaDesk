/*
 * parlonsapi.js — call the Parlons ACCOUNT's local web-panel API from main (Parlons Node kind only).
 *
 * The account serves http://127.0.0.1:<basePort+586>/ on loopback. A caller gets in by consuming the
 * one-time ticket the account keeps in <data>/panel-ticket.txt (reading that owner-only file IS the
 * authorisation; the account mints the next ticket the instant one is used, so the Parlons tab's own
 * sign-in is not disturbed): GET /open?ticket=… sets a parlons_session cookie, then POST /api/<name>
 * (JSON, Host must be 127.0.0.1:<port>). Only the panel's allow-list is reachable: contacts.*, chat.*,
 * identity.setname, node.figures … - never the seed, backups or sends.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const node = require("./node-manager");

let cookie = "";   // the session cookie for this app run (in memory only)

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const port = config.panelPort();
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: "127.0.0.1", port, method, path: urlPath, agent: false, timeout: 20_000,
      headers: Object.assign({ Host: "127.0.0.1:" + port, Cookie: cookie }, data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}, headers)
    }, (res) => {
      const chunks = [];
      res.on("error", reject);
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("panel timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Consume the file ticket for a session cookie. */
async function signIn() {
  if (node.kind() !== "parlons") throw new Error("the Parlons account runs on the Parlons Node kind only");
  let url = "";
  try { url = fs.readFileSync(path.join(node.dataDir(), "panel-ticket.txt"), "utf8").trim(); } catch (e) {}
  const m = url.match(/\/open\?ticket=([A-Za-z0-9_\-]+)/);
  if (!m) throw new Error("the account has not written a panel ticket yet - is it up?");
  const r = await request("GET", "/open?ticket=" + m[1], null);
  const set = r.headers["set-cookie"];
  const sc = Array.isArray(set) ? set.find((s) => /parlons_session=/.test(s)) : set;
  if (!sc) throw new Error("the panel did not accept the ticket (HTTP " + r.status + ")");
  cookie = sc.split(";")[0];
  return true;
}

/** POST /api/<name> with a JSON body; signs in (or re-signs in) as needed. Returns the parsed reply. */
async function api(name, body) {
  if (!cookie) await signIn();
  let r = await request("POST", "/api/" + name, body || {});
  if (r.status === 401 || r.status === 403) { cookie = ""; await signIn(); r = await request("POST", "/api/" + name, body || {}); }
  let j;
  try { j = JSON.parse(r.body); } catch (e) { throw new Error("panel " + name + ": HTTP " + r.status + " " + r.body.slice(0, 120)); }
  if (r.status >= 400) throw new Error("panel " + name + ": " + (j.error || ("HTTP " + r.status)));
  return j;
}

module.exports = { api, signIn };
