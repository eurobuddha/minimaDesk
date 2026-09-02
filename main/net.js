/*
 * net.js — GET a URL through Electron's net stack, following redirects (GitHub release zips 302 to a
 * CDN), with a hard timeout. Returns a Buffer. Shared by the bundled-dapp provisioning and anything
 * else in main that fetches from the web.
 */
const { net } = require("electron");

function fetchBuffer(url, opts = {}, redirects = 0) {
  const timeoutMs = Number(opts.timeoutMs) || 30000;
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("too many redirects"));
    let done = false;
    const req = net.request(url);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { req.abort(); } catch (e) {}
      reject(new Error("timeout after " + timeoutMs + "ms for " + url));
    }, timeoutMs);
    const settle = (fn) => (v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    req.on("response", (res) => {
      const code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
        const next = new URL(loc, url).toString();
        res.on("data", () => {}); res.on("end", () => {});
        return settle(resolve)(fetchBuffer(next, opts, redirects + 1));
      }
      if (code < 200 || code >= 300) { res.on("data", () => {}); return settle(reject)(new Error("HTTP " + code + " for " + url)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => settle(resolve)(Buffer.concat(chunks)));
      res.on("error", settle(reject));
    });
    req.on("error", settle(reject));
    req.end();
  });
}

module.exports = { fetchBuffer };
