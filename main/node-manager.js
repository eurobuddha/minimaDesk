/*
 * node-manager.js — owns the java child process running the FULL minima classic jar.
 *
 * Adapted from minimacore-desktop's proven node-manager: resolve the JRE (bundled first, system fallback in
 * dev), build the arg list, spawn/stop/restart, keep a log ring buffer, health-poll the RPC. The key
 * difference: we run the FULL classic jar with **MDS ENABLED** (and Maxima, which classic always runs on the
 * node's base port) — so real MiniDapps install and serve, and Maxima rides the node's own port.
 *
 * Stop is graceful: RPC `quit` (clean H2/db shutdown) → SIGTERM → SIGKILL fallback.
 */
const { app } = require("electron");
const { spawn } = require("child_process");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { rpcCall } = require("./rpc");

const LOG_MAX_LINES = 800;
const HEALTH_EVERY_MS = 8_000;

// The user's always-on Maxima relay fleet (mirrors the phone app's RelayStore.DEFAULTS).
// A stock classic node ADOPTS these as Maxima hosts once it connects to them, so inbound
// Maxima is forwarded down the node's outbound connection — the fix for "can send, can't
// receive" behind NAT. We connect on boot and pin one as a static MLS for a stable directory.
const MAXIMA_RELAYS = [
  "65.109.31.226:9501",   // eurobuddha - Helsinki, FI
  "95.179.179.181:9501",  // sally      - Amsterdam, NL
  "45.77.246.226:9501",   // maxima     - Singapore, SG
  "78.141.237.9:9501",    // openproject- London, GB
  "192.248.151.55:9501"   // megammr    - London, GB
];
const PREFERRED_MLS_RELAY = "65.109.31.226:9501";   // pin this one as static MLS when connected

function tokenizeArgs(s) {
  if (!s || typeof s !== "string") return [];
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

class NodeManager extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.state = "stopped";      // stopped | starting | running | stopping | error
    this.lastError = null;
    this.logs = [];
    this.health = null;          // { version, block, connections, maxima, mdsUp }
    this.healthTimer = null;
    this.startedTs = 0;
    this.adopted = false;        // true when we attached to a node a previous instance left running
    this.maximaSetupDone = false;// true once we've wired the node to the relay fleet this run
  }

  jarPath() {
    return app.isPackaged
      ? path.join(process.resourcesPath, "minima.jar")
      : path.join(__dirname, "..", "resources", "minima.jar");
  }
  javaPath() {
    const exe = process.platform === "win32" ? "java.exe" : "java";
    const bundled = app.isPackaged
      ? path.join(process.resourcesPath, "jre", "bin", exe)
      : path.join(__dirname, "..", "resources", "jre", "bin", exe);
    return fs.existsSync(bundled) ? bundled : "java";
  }

  buildArgs() {
    const cfg = config.load();
    const dataDir = cfg.dataFolder || config.defaultDataFolder();
    fs.mkdirSync(dataDir, { recursive: true });
    // Cap the JVM heap — a fresh node running the default MDS services can otherwise
    // balloon RAM and jank the whole machine (JVM flags must precede -jar).
    const args = ["-Xmx1500m", "-Xms256m", "-jar", this.jarPath(),
      "-data", dataDir,
      "-basefolder", dataDir,
      "-port", String(config.basePort()),
      "-rpc", String(config.rpcPort()),
      "-rpcenable", "true",
      "-rpcpassword", config.rpcSecret(),
      // MDS: the MiniDapp System — install + serve real MiniDapps. Off in stock; we turn it on.
      "-mdsenable",
      "-mdspassword", config.mdsPassword(),
      "-daemon", "true"];
    for (const tok of tokenizeArgs(cfg.extraArgs)) args.push(tok);
    return args;
  }

  async start() {
    if (this.proc || this.adopted) return;
    this.lastError = null;
    this.setState("starting");
    // Adopt an already-running node before spawning. A previous minimaDesk instance
    // that didn't fully exit still holds 20001/03/05 with OUR secret; spawning a second
    // node just fails to bind and exits → ERROR while the UI talks to the ghost. Instead,
    // if a node answers our RPC, adopt it: no duplicate, no port race, RPC works immediately.
    try {
      const s = await rpcCall(config.rpcPort(), config.rpcSecret(), "status");
      if (s && s.status) { this.log("[app] adopting already-running node on rpc " + config.rpcPort()); this.adopted = true; this.startHealth(); return; }
    } catch (e) { /* nothing there — spawn our own */ }
    const args = this.buildArgs();
    this.log("[app] starting node: java " + args.join(" ")
      .replace(config.rpcSecret(), "•••").replace(config.mdsPassword(), "•••"));
    let p;
    try { p = spawn(this.javaPath(), args, { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { this.lastError = "could not launch java: " + e.message; this.setState("error"); return; }
    this.proc = p;
    this.startedTs = Date.now();
    p.stdout.on("data", d => this.log(String(d)));
    p.stderr.on("data", d => this.log(String(d)));
    p.on("error", e => { this.lastError = e.message; this.setState("error"); this.proc = null; });
    p.on("exit", (code, sig) => {
      this.log("[app] node exited code=" + code + " sig=" + sig);
      this.proc = null;
      this.stopHealth();
      if (this.state !== "stopping") { this.lastError = "node exited unexpectedly (" + (code ?? sig) + ")"; this.setState("error"); }
      else this.setState("stopped");
    });
    this.startHealth();
  }

  async stop() {
    // Adopted node (no child process of ours): stop it over RPC so we don't orphan it.
    if (!this.proc) {
      if (this.adopted) { try { await rpcCall(config.rpcPort(), config.rpcSecret(), "quit"); } catch (e) {} this.adopted = false; this.stopHealth(); }
      this.setState("stopped"); return;
    }
    this.setState("stopping");
    this.stopHealth();
    const gone = new Promise(res => {
      const t = setTimeout(() => { try { this.proc && this.proc.kill("SIGTERM"); } catch (e) {} }, 12_000);
      const t2 = setTimeout(() => { try { this.proc && this.proc.kill("SIGKILL"); } catch (e) {} }, 25_000);
      const iv = setInterval(() => { if (!this.proc) { clearTimeout(t); clearTimeout(t2); clearInterval(iv); res(); } }, 300);
    });
    try { await rpcCall(config.rpcPort(), config.rpcSecret(), "quit"); } catch (e) { /* signals will catch it */ }
    await gone;
  }
  async restart() { await this.stop(); this.start(); }

  // ---- health ----
  startHealth() {
    this.stopHealth();
    const poll = async () => {
      if (!this.proc && !this.adopted) return;
      try {
        const j = await rpcCall(config.rpcPort(), config.rpcSecret(), "status");
        const r = (j && j.response) || {};
        let maxima = false;
        try { const mx = await rpcCall(config.rpcPort(), config.rpcSecret(), "maxima action:info"); maxima = !!(mx && mx.status); } catch (e) {}
        this.health = {
          version: r.version || "",
          block: (r.chain && r.chain.block) || 0,
          connections: (r.network && r.network.connected) || 0,
          locked: !!r.locked,
          maxima
        };
        if (this.state !== "running") this.setState("running"); else this.emit("status", this.snapshot());
        // Once Maxima is up, wire the node to the relay fleet so inbound is forwarded (one-time).
        if (maxima && !this.maximaSetupDone) { this.maximaSetupDone = true; this.setupMaximaRelays(); }
      } catch (e) { /* still booting — keep state */ }
    };
    poll();
    this.healthTimer = setInterval(poll, HEALTH_EVERY_MS);
  }
  stopHealth() { if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; } this.health = null; }

  // Connect the node to the user's Maxima relay fleet and pin a stable static MLS, so inbound
  // Maxima is reliably forwarded even behind NAT (fixes "can send, can't receive"). Runtime-only:
  // uses the `connect` and `maxextra` commands — it never touches startup args or chain P2P.
  async setupMaximaRelays() {
    const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
    try {
      for (const r of MAXIMA_RELAYS) { try { await rpc("connect host:" + r); } catch (e) {} }
      this.log("[app] connected to " + MAXIMA_RELAYS.length + " Maxima relays");
      // give the relays a moment to attach as hosts, then pin a connected fleet relay as static MLS
      await new Promise(res => setTimeout(res, 12_000));
      const info = (await rpc("maxima action:info").catch(() => ({}))).response || {};
      if (info.staticmls) return;                       // already pinned — leave it
      const hosts = ((await rpc("maxima action:hosts").catch(() => ({}))).response || {}).hosts || [];
      const isFleet = (h) => MAXIMA_RELAYS.includes(h.host);
      const pref = hosts.find(h => h.host === PREFERRED_MLS_RELAY && h.connected);
      const relay = pref || hosts.find(h => isFleet(h) && h.connected);
      if (relay && relay.address && /^Mx.+@.+:\d+$/.test(relay.address)) {
        await rpc('maxextra action:staticmls host:' + relay.address);
        this.log("[app] pinned static MLS to fleet relay " + relay.host);
      }
    } catch (e) { this.log("[app] maxima relay setup: " + e.message); }
  }

  setState(s) { this.state = s; this.emit("status", this.snapshot()); }
  snapshot() {
    return { state: this.state, health: this.health, lastError: this.lastError,
             rpcPort: config.rpcPort(), mdsPort: config.mdsPort(), basePort: config.basePort(),
             uptimeMs: this.proc && this.startedTs ? Date.now() - this.startedTs : 0 };
  }
  log(line) {
    for (let l of String(line).split("\n")) {
      if (!l.trim()) continue;
      l = l.replace(/phrase:"[^"]*"/g, 'phrase:"•••"').replace(/privatekey:0x[0-9A-Fa-f]+/g, "privatekey:•••");
      this.logs.push(l.length > 400 ? l.slice(0, 400) + "…" : l);
      if (process.env.MDESK_NODELOG) { try { fs.appendFileSync(process.env.MDESK_NODELOG, l + "\n"); } catch (e) {} }
    }
    if (this.logs.length > LOG_MAX_LINES) this.logs.splice(0, this.logs.length - LOG_MAX_LINES);
    this.emit("log");
  }
}

module.exports = new NodeManager();
