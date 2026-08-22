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

// The user's always-on Maxima relay fleet. A stock classic node ADOPTS a relay as its Maxima
// host once it connects, so inbound Maxima is forwarded — the fix for "can send, can't receive"
// behind NAT. IMPORTANT: connect to ONE relay only. Stock Maxima has no inbound msgid de-dup,
// so attaching to several relays makes the same message arrive on multiple paths and get
// delivered TWICE (double-printed in MaxSolo). One reliable relay = receive works, no duplicates.
const PRIMARY_RELAY = "65.109.31.226:9501";         // eurobuddha - Helsinki, FI (also the static MLS)
const MAXIMA_RELAYS = [PRIMARY_RELAY];
const PREFERRED_MLS_RELAY = PRIMARY_RELAY;          // pin this one as static MLS when connected
const MAXIMA_REFRESH_MS = 15 * 60 * 1000;           // periodic MLS refresh so cached contact addresses don't go stale

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
  stopHealth() {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    if (this.maximaRefreshTimer) { clearInterval(this.maximaRefreshTimer); this.maximaRefreshTimer = null; }
    this.maximaSetupDone = false;
    this.health = null;
  }

  // Connect the node to the user's Maxima relay so inbound Maxima is forwarded even behind NAT,
  // pin a stable static MLS, then keep contact addresses fresh. Runtime-only (connect / maxextra /
  // maxima refresh) — never touches startup args or chain P2P.
  async setupMaximaRelays() {
    await this.healMaxima();
    // Periodic heal: a contact we hear from often is marked "seen", so the node's 30-min staleness
    // gate never re-resolves its address — and if that contact (e.g. a phone that changed networks)
    // rotates its host, our cached address goes stale and sends silently fail. A periodic heal
    // reconnects the relay and re-pulls every contact's live address so 2-way delivery self-repairs.
    if (this.maximaRefreshTimer) clearInterval(this.maximaRefreshTimer);
    this.maximaRefreshTimer = setInterval(() => { this.healMaxima().catch(() => {}); }, MAXIMA_REFRESH_MS);
  }

  // Reconnect the relay, ensure a static MLS is pinned, and force-refresh every contact's live
  // address. Safe to call anytime — this is the "Heal Maxima" action (great after a network change).
  async healMaxima() {
    const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
    try {
      for (const r of MAXIMA_RELAYS) { try { await rpc("connect host:" + r); } catch (e) {} }
      await new Promise(res => setTimeout(res, 3500));
      const info = (await rpc("maxima action:info").catch(() => ({}))).response || {};
      if (!info.staticmls) {
        const hosts = ((await rpc("maxima action:hosts").catch(() => ({}))).response || {}).hosts || [];
        const relay = hosts.find(h => h.host === PREFERRED_MLS_RELAY && h.connected)
                   || hosts.find(h => MAXIMA_RELAYS.includes(h.host) && h.connected);
        if (relay && relay.address && /^Mx.+@.+:\d+$/.test(relay.address)) {
          await rpc('maxextra action:staticmls host:' + relay.address);
          this.log("[app] pinned static MLS to fleet relay " + relay.host);
        }
      }
      await rpc("maxima action:refresh");                 // re-pull every contact's current address
      this.log("[app] maxima healed: relay reconnected + contacts refreshed");
      return { status: true };
    } catch (e) { this.log("[app] maxima heal failed: " + e.message); return { status: false, error: e.message }; }
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
