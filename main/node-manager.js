/*
 * node-manager.js — owns the java child process running the FULL minima classic jar.
 *
 * Adapted from minimacore-desktop's proven node-manager: resolve the JRE (bundled first, system fallback in
 * dev), build the arg list, spawn/stop/restart, keep a log ring buffer, health-poll the RPC. The key
 * difference: we run the FULL classic jar with **MDS ENABLED** (and Maxima, which classic always runs on the
 * node's base port) — so real MiniDapps install and serve, and Maxima rides the node's own port.
 *
 * Network role (Settings → Network): with `contribute` on, the node runs `-server` (accepts inbound P2P,
 * and thereby acts as a Maxima host for others) and portmap.js asks the router to open the P2P port.
 * Only a real incoming peer proves reachability — see the `network` poll below.
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
const { provisionBundledDapps } = require("./provision");
const portmap = require("./portmap");
const { DEFAULT_RELAY, isHostPort } = require("./relays");

const LOG_MAX_LINES = 800;
const HEALTH_EVERY_MS = 8_000;
const NET_RESTART_COOLDOWN_MS = 10 * 60_000;
const MAXIMA_REFRESH_MS = 15 * 60 * 1000;           // periodic MLS refresh so cached contact addresses don't go stale

function tokenizeArgs(s) {
  if (!s || typeof s !== "string") return [];
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** The one Maxima relay this node attaches to (config, else the fleet default). */
function currentRelay() {
  const r = String(config.load().maximaRelay || "").trim();
  return isHostPort(r) ? r : DEFAULT_RELAY;
}

class NodeManager extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.state = "stopped";      // stopped | starting | running | stopping | error
    this.lastError = null;
    this.logs = [];
    this.health = null;          // { version, block, connections, locked, maxima, incoming, acceptingInLinks, p2pAddress }
    this.healthTimer = null;
    this.healthTick = 0;
    this.startedTs = 0;
    this.adopted = false;        // true when we attached to a node a previous instance left running
    this.maximaSetupDone = false;// true once we've wired the node to the relay this run
    this.provisionDone = false;  // bundled dapps (App Store, Terminal IDE) installed / updated this run
    this.provisionBusy = false;
    this.provisionTries = 0;
    this.wasMapped = false;
    this.lastNetRestart = 0;
    portmap.setLogger(line => this.log(line));
    portmap.on("status", st => {
      // Late mapping recovery: after ~1h with no in-links the jar flips isAcceptingInLinks=false and
      // leaves it off until its network layer restarts. If the mapping only comes good after that, restart
      // just the network layer so the node starts advertising itself again. Fire on the TRANSITION into
      // mapped (portmap emits on every setStatus), with a cooldown — acceptingInLinks refreshes slowly.
      const nowMapped = st.state === "mapped";
      const becameMapped = nowMapped && !this.wasMapped;
      this.wasMapped = nowMapped;
      if (becameMapped && (this.proc || this.adopted) && this.startedTs && Date.now() - this.startedTs > 70 * 60_000 &&
          this.health && this.health.acceptingInLinks === false &&
          Date.now() - this.lastNetRestart > NET_RESTART_COOLDOWN_MS) {
        this.lastNetRestart = Date.now();
        this.log("[app] port mapped late — restarting the node's network layer to re-enable inbound");
        rpcCall(config.rpcPort(), config.rpcSecret(), "network action:restart").catch(() => {});
      }
      this.emit("status", this.snapshot());
    });
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
    // Contribute to the network: accept inbound P2P (the jar's -server role). Never alongside -isclient /
    // -mobile — their ordering in the jar's ParamConfigurer is a HashMap accident.
    if (cfg.contribute) args.push("-server", "true");
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
      if (s && s.status) {
        this.log("[app] adopting already-running node on rpc " + config.rpcPort());
        this.adopted = true; this.startedTs = Date.now();
        this.startHealth();
        if (config.load().contribute) portmap.start(config.basePort());
        return;
      }
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
      // Only on an UNEXPECTED exit: a planned stop already released the mapping, and restart() would race it.
      if (this.state !== "stopping") {
        portmap.stop().catch(() => {});
        this.lastError = "node exited unexpectedly (" + (code ?? sig) + ")"; this.setState("error");
      } else this.setState("stopped");
    });
    this.startHealth();
    // Ask the router to open the P2P port when contributing (fire-and-forget; honest status via `network`).
    if (config.load().contribute) portmap.start(config.basePort());
  }

  async stop(opts = {}) {
    // Release the router mapping first — it must not outlive the node.
    try { await portmap.stop(); } catch (e) {}
    // `compact:true` asks the node to compact its databases on the way down (hub Settings → Shutdown node).
    const quitCmd = opts && opts.compact ? "quit compact:true" : "quit";
    // Adopted node (no child process of ours): stop it over RPC so we don't orphan it.
    if (!this.proc) {
      if (this.adopted) { try { await rpcCall(config.rpcPort(), config.rpcSecret(), quitCmd); } catch (e) {} this.adopted = false; this.stopHealth(); }
      this.setState("stopped"); return;
    }
    this.setState("stopping");
    this.stopHealth();
    const gone = new Promise(res => {
      const t = setTimeout(() => { try { this.proc && this.proc.kill("SIGTERM"); } catch (e) {} }, 12_000);
      const t2 = setTimeout(() => { try { this.proc && this.proc.kill("SIGKILL"); } catch (e) {} }, 25_000);
      const iv = setInterval(() => { if (!this.proc) { clearTimeout(t); clearTimeout(t2); clearInterval(iv); res(); } }, 300);
    });
    try { await rpcCall(config.rpcPort(), config.rpcSecret(), quitCmd); } catch (e) { /* signals will catch it */ }
    await gone;
  }
  async restart() { await this.stop(); this.start(); }

  // ---- network role (Settings → Network) ----

  /** Turn "Contribute to the network" on/off: persist, then restart the node so the -server role applies. */
  async setContribute(on) {
    config.save({ contribute: !!on });
    this.log("[app] contribute to the network: " + (on ? "ON — restarting node with -server" : "OFF — restarting node as a light node"));
    if (!on) { try { await portmap.stop(); } catch (e) {} }
    await this.restart();
    return { status: true, contribute: !!on };
  }

  /** Switch the ONE Maxima relay: persist, connect to it, drop the previous relay's connection, re-heal. */
  async setMaximaRelay(host) {
    const h = String(host || "").trim();
    if (!isHostPort(h)) return { status: false, error: "relay must be host:port" };
    const prev = currentRelay();
    config.save({ maximaRelay: h });
    const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
    try {
      if (prev !== h) {
        // Attaching to two relays double-delivers Maxima — disconnect the old one by its connection uid.
        const n = (await rpc("network").catch(() => ({}))).response || {};
        for (const c of (Array.isArray(n.connections) ? n.connections : [])) {
          const byPort = String(c.host || "") + ":" + String(c.port || "");
          const byMinimaPort = String(c.host || "") + ":" + String(c.minimaport || "");
          if (byPort === prev || byMinimaPort === prev) {
            if (c.uid) { await rpc("disconnect uid:" + c.uid).catch(() => {}); this.log("[app] disconnected previous relay " + prev); }
          }
        }
      }
    } catch (e) { /* best effort */ }
    // If the MLS was pinned to the old relay, re-pin to the new one on heal.
    const mls = config.load().mls || { mode: "relay", custom: "" };
    if (mls.mode === "relay" && prev !== h) { try { await rpc("maxextra action:staticmls host:clear"); } catch (e) {} }
    return this.healMaxima();
  }

  /** Static MLS policy: relay (pin the attached relay's MLS) | custom (a given Mx…@host:port) | host (rotating). */
  async setMls(mode, custom) {
    const m = ["relay", "custom", "host"].includes(mode) ? mode : "relay";
    const c = String(custom || "").trim();
    if (m === "custom" && !/^Mx[0-9A-Za-z]+@.+:\d+$/.test(c)) return { status: false, error: "needs the form Mx…@host:port" };
    config.save({ mls: { mode: m, custom: c } });
    const rpc = (cmd) => rpcCall(config.rpcPort(), config.rpcSecret(), cmd);
    try {
      if (m === "host") { await rpc("maxextra action:staticmls host:clear"); this.log("[app] static MLS cleared — using the host's directory"); }
      else if (m === "custom") { await rpc("maxextra action:staticmls host:" + c); this.log("[app] static MLS pinned to " + c); }
      else { await rpc("maxextra action:staticmls host:clear"); }   // healMaxima re-pins to the relay
    } catch (e) { return { status: false, error: e.message }; }
    return this.healMaxima();
  }

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
        const prev = this.health || {};
        this.health = {
          version: r.version || "",
          block: (r.chain && r.chain.block) || 0,
          connections: (r.network && r.network.connected) || 0,
          locked: !!r.locked,
          maxima,
          // direction-aware fields come from the `network` poll below — carry the last known values
          incoming: prev.incoming ?? 0,
          acceptingInLinks: prev.acceptingInLinks ?? null,
          p2pAddress: prev.p2pAddress || ""
        };
        // `status` reports no connection DIRECTIONS, so when contributing also poll `network` (every 3rd
        // tick) for the incoming count and the node's own reachability verdict — the only honest signal
        // that inbound actually works, since routers can accept a port mapping and still not open it.
        if (config.load().contribute && this.healthTick++ % 3 === 0) {
          try {
            const n = await rpcCall(config.rpcPort(), config.rpcSecret(), "network");
            const nr = (n && n.response) || {};
            const p2p = (nr.details && nr.details.p2p) || {};
            const conns = Array.isArray(nr.connections) ? nr.connections : [];
            // Count only INCOMING connections from OTHER hosts: once the node knows its own public address
            // it dials itself via the peers-checker, hairpins through the router, and that shows up as an
            // inbound peer. Verified live: nio_inbound 3 was really 2 external + 1 self.
            const selfIp = String(p2p.address || "").split(":")[0];
            const inbound = conns.filter(c => c && c.incoming);
            this.health.incoming = conns.length
              ? (selfIp ? inbound.filter(c => String(c.host || "") !== selfIp).length : inbound.length)
              : (typeof p2p.nio_inbound === "number" ? p2p.nio_inbound : 0);
            this.health.acceptingInLinks = typeof p2p.isAcceptingInLinks === "boolean" ? p2p.isAcceptingInLinks : null;
            this.health.p2pAddress = p2p.address || "";
          } catch (e) { /* keep the carried values */ }
        }
        if (this.state !== "running") this.setState("running"); else this.emit("status", this.snapshot());
        // Bundled dapps: install / update once MDS answers (retries on later ticks until it does).
        if (!this.provisionDone && !this.provisionBusy && this.provisionTries < 20) {
          this.provisionBusy = true; this.provisionTries++;
          provisionBundledDapps({
            rpc: (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c),
            log: (l) => this.log(l),
            skipCatalog: !app.isPackaged && !!process.env.MDESK_NO_CATALOG
          }).then((r) => {
            if (r && r.ready) { this.provisionDone = true; this.emit("status", this.snapshot()); }
            else this.log("[app] dapps: MDS not ready yet — retrying next tick");
          }).catch((e) => { this.provisionDone = true; this.log("[app] dapps: provisioning failed: " + e.message); })
            .finally(() => { this.provisionBusy = false; });
        }
        // Once Maxima is up, wire the node to the relay so inbound is forwarded (one-time).
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
    this.provisionDone = false;
    this.provisionTries = 0;
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

  // Reconnect the relay, apply the static-MLS policy, and force-refresh every contact's live
  // address. Safe to call anytime — this is the "Heal Maxima" action (great after a network change).
  async healMaxima() {
    const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
    const relay = currentRelay();
    const mls = config.load().mls || { mode: "relay", custom: "" };
    try {
      try { await rpc("connect host:" + relay); } catch (e) {}
      await new Promise(res => setTimeout(res, 3500));
      const info = (await rpc("maxima action:info").catch(() => ({}))).response || {};
      // staticmls comes back as the host, or as `true` with the host in `mls`
      const isHost = (v) => typeof v === "string" && /^Mx.+@.+:\d+$/.test(v);
      const pinnedNow = isHost(info.staticmls) ? info.staticmls : (info.staticmls === true && isHost(info.mls) ? info.mls : "");
      if (mls.mode === "relay") {
        const hosts = ((await rpc("maxima action:hosts").catch(() => ({}))).response || {}).hosts || [];
        const r = hosts.find(h => h.host === relay && h.connected);
        if (r && r.address && /^Mx.+@.+:\d+$/.test(r.address) && pinnedNow !== r.address) {
          await rpc("maxextra action:staticmls host:" + r.address);
          this.log("[app] pinned static MLS to relay " + relay);
        }
      } else if (mls.mode === "custom" && mls.custom && pinnedNow !== mls.custom) {
        await rpc("maxextra action:staticmls host:" + mls.custom);
        this.log("[app] pinned static MLS to " + mls.custom);
      }
      await rpc("maxima action:refresh");                 // re-pull every contact's current address
      this.log("[app] maxima healed: relay " + relay + " reconnected + contacts refreshed");
      return { status: true };
    } catch (e) { this.log("[app] maxima heal failed: " + e.message); return { status: false, error: e.message }; }
  }

  setState(s) { this.state = s; this.emit("status", this.snapshot()); }
  snapshot() {
    const cfg = config.load();
    return { state: this.state, health: this.health, lastError: this.lastError,
             provision: { done: this.provisionDone, busy: this.provisionBusy },
             contribute: !!cfg.contribute, portmap: portmap.status(),
             maximaRelay: currentRelay(), mls: cfg.mls || { mode: "relay", custom: "" },
             rpcPort: config.rpcPort(), mdsPort: config.mdsPort(), basePort: config.basePort(),
             uptimeMs: (this.proc || this.adopted) && this.startedTs ? Date.now() - this.startedTs : 0 };
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
