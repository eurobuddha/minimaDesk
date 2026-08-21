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
    const args = ["-jar", this.jarPath(),
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

  start() {
    if (this.proc) return;
    this.lastError = null;
    this.setState("starting");
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
    if (!this.proc) { this.setState("stopped"); return; }
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
      if (!this.proc) return;
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
      } catch (e) { /* still booting — keep state */ }
    };
    poll();
    this.healthTimer = setInterval(poll, HEALTH_EVERY_MS);
  }
  stopHealth() { if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; } this.health = null; }

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
    }
    if (this.logs.length > LOG_MAX_LINES) this.logs.splice(0, this.logs.length - LOG_MAX_LINES);
    this.emit("log");
  }
}

module.exports = new NodeManager();
