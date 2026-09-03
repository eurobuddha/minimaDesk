/*
 * net.js — GET a URL through Electron's net stack. Redirects are followed manually (max 6) and only
 * https → https; the body is capped; a hard timeout aborts. Returns a Buffer.
 * Shared by bundled-dapp provisioning and anything else in main that fetches from the web.
 */
const { net } = require("electron");

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

function fetchBuffer(url, opts = {}, redirects = 0) {
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const maxBytes = Number(opts.maxBytes) || DEFAULT_MAX_BYTES;
  const httpsOnly = opts.httpsOnly !== false;           // default: refuse plain http (and http downgrades)
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error("bad url: " + url)); }
    if (httpsOnly && u.protocol !== "https:") return reject(new Error("refusing non-https url: " + url));
    if (redirects > 6) return reject(new Error("too many redirects"));
    let done = false;
    const req = net.request({ url, redirect: "manual" });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { req.abort(); } catch (e) {}
      reject(new Error("timeout after " + timeoutMs + "ms for " + url));
    }, timeoutMs);
    const settle = (fn) => (v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    req.on("redirect", (statusCode, method, redirectUrl) => {
      try { req.abort(); } catch (e) {}
      let next;
      try { next = new URL(redirectUrl, url).toString(); } catch (e) { return settle(reject)(new Error("bad redirect from " + url)); }
      settle(resolve)(fetchBuffer(next, opts, redirects + 1));   // re-checks https on the new url
    });
    req.on("response", (res) => {
      const code = res.statusCode;
      if (code < 200 || code >= 300) { res.on("data", () => {}); return settle(reject)(new Error("HTTP " + code + " for " + url)); }
      const chunks = [];
      let total = 0;
      res.on("data", (c) => {
        total += c.length;
        if (total > maxBytes) { try { req.abort(); } catch (e) {} return settle(reject)(new Error("body larger than " + maxBytes + " bytes: " + url)); }
        chunks.push(c);
      });
      res.on("end", () => settle(resolve)(Buffer.concat(chunks)));
      res.on("error", settle(reject));
    });
    req.on("error", settle(reject));
    req.end();
  });
}

module.exports = { fetchBuffer };
