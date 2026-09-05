/*
 * node-manager.js — owns the java child process running the FULL minima classic jar.
 *
 * Adapted from minimacore-desktop's proven node-manager: resolve the JRE (bundled first, system fallback in
 * dev), build the arg list, spawn/stop/restart, keep a log ring buffer, health-poll the RPC. The key
 * difference: we run the FULL classic jar with **MDS ENABLED** (and Maxima, which classic always runs on the
 * node's base port) — so real MiniDapps install and serve, and Maxima rides the node's own port.
 *
 * Secrets never go on the command line (visible to every local process via `ps`): the RPC and MDS
 * passwords are written to a 0600 conf file each start and the jar reads them with `-conf`.
 *
 * Network role (Settings → Network): with `contribute` on, the node runs `-server` (accepts inbound P2P,
 * and thereby acts as a Maxima host for others) and portmap.js asks the router to open the P2P port.
 * Only a real incoming peer proves reachability — see the `network` poll below.
 *
 * Every async loop here is generation-guarded: a stop()/restart() bumps the generation and any reply
 * still in flight from the previous life is ignored, so a planned stop can never be reported as a crash.
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
const { DEFAULT_RELAY, isHostPort, isMlsIdentity } = require("./relays");

const LOG_MAX_LINES = 800;
const HEALTH_EVERY_MS = 8_000;
const NET_RESTART_COOLDOWN_MS = 10 * 60_000;
const MAXIMA_REFRESH_MS = 15 * 60 * 1000;           // periodic MLS refresh so cached contact addresses don't go stale
const ADOPTED_DEAD_AFTER = 3;                       // consecutive failed polls before an adopted node is declared gone
const PROVISION_MAX_TRIES = 60;                     // ~8 min of MDS not answering before we stop trying this run
const SELF_RESTART_DELAY_MS = 2500;                 // a clean self-shutdown (megammrsync / restore / reset) → start again
const SELF_RESTART_MAX = 3;                         // …but not in a loop: at most 3 in SELF_RESTART_WINDOW_MS
const SELF_RESTART_WINDOW_MS = 10 * 60_000;

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

/** `maxima action:info` reports staticmls either as the host string or as `true` with the host in `mls`. */
function pinnedMls(info) {
  if (!info) return "";
  if (isMlsIdentity(info.staticmls)) return String(info.staticmls);
  if (info.staticmls === true && isMlsIdentity(info.mls)) return String(info.mls);
  return "";
}

class NodeManager extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.state = "stopped";      // stopped | starting | running | stopping | error
    this.lastError = null;
    this.logs = [];
    this.logSeq = 0;             // total lines ever logged — lets the renderer "clear" without losing new lines
    this.health = null;          // { version, block, connections, locked, maxima, incoming, acceptingInLinks, p2pAddress }
    this.healthTimer = null;
    this.healthGen = 0;          // bumped by stopHealth(); in-flight polls from an older generation are ignored
    this.healthTick = 0;
    this.healthFailures = 0;
    this.startedTs = 0;
    this.adopted = false;        // true when we attached to a node a previous instance left running
    this.startPromise = null;    // start() in progress (adopt probe / spawn) — restart() must wait for it
    this.maximaSetupDone = false;// true once we've wired the node to the relay this run
    this.maximaRefreshTimer = null;
    this.healChain = Promise.resolve();   // heals are serialised — two at once race on the static-MLS pin
    this.provisionDone = false;  // bundled dapps (App Store, Terminal IDE) installed / updated this run
    this.provisionBusy = false;
    this.provisionTries = 0;
    this.wasMapped = false;
    this.lastNetRestart = 0;
    this.selfRestarts = [];      // timestamps of automatic restarts after a clean self-shutdown
    portmap.setLogger(line => this.log(line));
    portmap.on("status", st => {
      // Late mapping recovery: after ~1h with no in-links the jar flips isAcceptingInLinks=false and
      // leaves it off until its network layer restarts. If the mapping only comes good after that, restart
      // just the network layer so the node starts advertising itself again. Fire on the TRANSITION into
      // mapped (portmap emits on every setStatus), with a cooldown — acceptingInLinks refreshes slowly.
      const nowMapped = st.state === "mapped";
      const becameMapped = nowMapped && !this.wasMapped;
      this.wasMapped = nowMapped;
      if (becameMapped && this.alive() && this.startedTs && Date.now() - this.startedTs > 70 * 60_000 &&
          this.health && this.health.acceptingInLinks === false &&
          Date.now() - this.lastNetRestart > NET_RESTART_COOLDOWN_MS) {
        this.lastNetRestart = Date.now();
        this.log("[app] port mapped late — restarting the node's network layer to re-enable inbound");
        rpcCall(config.rpcPort(), config.rpcSecret(), "network action:restart").catch(() => {});
      }
      this.emit("status", this.snapshot());
    });
  }

  /** A node we own or adopted, and not on its way down. */
  alive() { return (!!this.proc || this.adopted) && this.state !== "stopping" && this.state !== "stopped"; }

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

  confPath() { return path.join(app.getPath("userData"), "node.conf"); }

  /** The secrets go in a 0600 conf file (key=value lines, same names as the -flags), never on argv:
   *  the RPC + MDS passwords, plus any secret-type startup param (dbpassword, mysqldb). */
  writeConfFile(confParams) {
    const file = this.confPath();
    let text = "rpcpassword=" + config.rpcSecret() + "\n" + "mdspassword=" + config.mdsPassword() + "\n";
    for (const [k, v] of Object.entries(confParams || {})) text += k + "=" + v + "\n";
    config.writeAtomic(file, text, 0o600);
    return file;
  }

  /**
   * The java argument list for a config. `dryRun` (Settings → Startup parameters preview) touches nothing on
   * disk — no data folder, no conf file — and reports which secret flags the conf file would carry.
   */
  buildArgs(cfg = config.load(), { dryRun = false } = {}) {
    const dataDir = cfg.dataFolder || config.defaultDataFolder();
    const basePort = parseInt(cfg.basePort, 10) || 20001;
    const { argv: paramArgs, conf: confParams } = config.effectiveParams(cfg);
    if (!dryRun) fs.mkdirSync(dataDir, { recursive: true });
    // Cap the JVM heap — a fresh node running the default MDS services can otherwise
    // balloon RAM and jank the whole machine (JVM flags must precede -jar).
    const args = ["-Xmx1500m", "-Xms256m", "-jar", this.jarPath(),
      "-conf", dryRun ? this.confPath() : this.writeConfFile(confParams),
      "-data", dataDir,
      "-basefolder", dataDir,
      "-port", String(basePort),
      "-rpc", String(basePort + 4),
      "-rpcenable", "true",
      // MDS: the MiniDapp System — install + serve real MiniDapps. Off in stock; we turn it on.
      "-mdsenable",
      "-daemon", "true"];
    // Contribute to the network: accept inbound P2P (the jar's -server role). Never alongside -isclient /
    // -mobile — their ordering in the jar's ParamConfigurer is a HashMap accident.
    if (cfg.contribute) args.push("-server", "true");
    // Every other startup flag the user set in Settings → Startup parameters (main/params.js manifest).
    for (const [flag, v] of paramArgs) { if (v === true) args.push("-" + flag); else args.push("-" + flag, String(v)); }
    for (const tok of tokenizeArgs(cfg.extraArgs)) args.push(tok);
    return dryRun ? { args, confFlags: Object.keys(confParams) } : args;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.proc || this.adopted) return Promise.resolve();
    this.startPromise = this._start()
      .catch((e) => { this.lastError = "could not start node: " + (e && e.message ? e.message : String(e)); this.setState("error"); })
      .finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async _start() {
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
    if (this.state === "stopping" || this.state === "stopped") return;   // stop() raced the adopt probe
    const args = this.buildArgs();
    this.log("[app] starting node: java " + args.join(" "));   // no secrets on argv any more (see -conf)
    let p;
    try { p = spawn(this.javaPath(), args, { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { this.lastError = "could not launch java: " + e.message; this.setState("error"); return; }
    this.proc = p;
    this.startedTs = Date.now();
    p.stdout.on("data", d => this.log(String(d)));
    p.stderr.on("data", d => this.log(String(d)));
    p.on("error", e => {
      // e.g. ENOENT for java — no `exit` follows, so clean up here exactly as the exit handler does.
      if (this.proc !== p) return;
      this.proc = null;
      this.stopHealth();
      portmap.stop().catch(() => {});
      this.lastError = e.message; this.setState("error");
    });
    p.on("exit", (code, sig) => {
      if (this.proc !== p) return;                 // an older child (after a racing restart) — ignore
      this.log("[app] node exited code=" + code + " sig=" + sig);
      this.proc = null;
      this.stopHealth();
      // Only on an UNEXPECTED exit: a planned stop already released the mapping, and restart() would race it.
      if (this.state !== "stopping") {
        portmap.stop().catch(() => {});
        // Exit code 0 while we never asked it to stop = the node shut ITSELF down cleanly — that is what
        // `megammrsync`, `restore` and `reset` do when they finish ("please restart"). Start it again, so a
        // resync never leaves the user with a dead app. Bounded, so a node that dies clean on every boot
        // (bad data folder, bad startup flag) still surfaces as an error instead of flapping forever.
        const now = Date.now();
        this.selfRestarts = this.selfRestarts.filter(t => now - t < SELF_RESTART_WINDOW_MS);
        if (code === 0 && this.selfRestarts.length < SELF_RESTART_MAX) {
          this.selfRestarts.push(now);
          this.lastError = null;
          this.log("[app] node shut itself down cleanly (resync / restore / reset finished) — restarting it in " + Math.round(SELF_RESTART_DELAY_MS / 1000) + "s");
          this.setState("starting");
          setTimeout(() => { if (!this.proc && !this.adopted && this.state === "starting") this.start().catch(() => {}); }, SELF_RESTART_DELAY_MS);
        } else {
          this.lastError = code === 0
            ? "node keeps shutting itself down — check Settings → Startup parameters and Node logs, then Start node"
            : "node exited unexpectedly (" + (code ?? sig) + ")";
          this.setState("error");
        }
      } else this.setState("stopped");
    });
    this.startHealth();
    // Ask the router to open the P2P port when contributing (fire-and-forget; honest status via `network`).
    if (config.load().contribute) portmap.start(config.basePort());
  }

  async stop(opts = {}) {
    if (this.startPromise) { try { await this.startPromise; } catch (e) {} }
    // Release the router mapping first — it must not outlive the node.
    try { await portmap.stop(); } catch (e) {}
    // `compact:true` asks the node to compact its databases on the way down (hub Settings → Shutdown node).
    const quitCmd = opts && opts.compact ? "quit compact:true" : "quit";
    if (!this.proc) {
      if (this.adopted) {
        // Adopted node (no child process of ours): stop it over RPC, then WAIT until it is really gone —
        // otherwise a restart() would re-adopt a node that is mid-shutdown.
        this.setState("stopping");
        this.stopHealth();
        try { await rpcCall(config.rpcPort(), config.rpcSecret(), quitCmd); } catch (e) {}
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          await new Promise(res => setTimeout(res, 500));
          try { await rpcCall(config.rpcPort(), config.rpcSecret(), "status"); } catch (e) { break; }   // refused = gone
        }
        this.adopted = false;
      }
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
  async restart() { await this.stop(); await this.start(); }

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
          if ((byPort === prev || byMinimaPort === prev) && /^[0-9A-Za-z]+$/.test(String(c.uid || ""))) {
            await rpc("disconnect uid:" + c.uid).catch(() => {});
            this.log("[app] disconnected previous relay " + prev);
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
    if (m === "custom" && !isMlsIdentity(c)) return { status: false, error: "needs the form Mx…@host:port" };
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
    const gen = ++this.healthGen;
    const live = () => gen === this.healthGen && this.alive();
    const poll = async () => {
      if (!live()) return;
      try {
        const j = await rpcCall(config.rpcPort(), config.rpcSecret(), "status");
        if (!live()) return;
        const r = (j && j.response) || {};
        let maxima = false;
        try { const mx = await rpcCall(config.rpcPort(), config.rpcSecret(), "maxima action:info"); maxima = !!(mx && mx.status); } catch (e) {}
        if (!live()) return;
        this.healthFailures = 0;
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
            if (!live()) return;
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
        if (!this.provisionDone && !this.provisionBusy) {
          if (this.provisionTries >= PROVISION_MAX_TRIES) {
            this.provisionDone = true;
            this.log("[app] dapps: MDS never answered — giving up on provisioning this run (Store / Terminal buttons need a restart)");
          } else {
            this.provisionBusy = true; this.provisionTries++;
            provisionBundledDapps({
              rpc: (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c),
              log: (l) => this.log(l),
              skipCatalog: !app.isPackaged && !!process.env.MDESK_NO_CATALOG
            }).then((res) => {
              if (!live()) return;
              if (res && res.ready) { this.provisionDone = true; this.emit("status", this.snapshot()); }
              else if (this.provisionTries % 5 === 0) this.log("[app] dapps: MDS not ready yet — still retrying");
            }).catch((e) => { this.provisionDone = true; this.log("[app] dapps: provisioning failed: " + e.message); })
              .finally(() => { this.provisionBusy = false; });
          }
        }
        // Once Maxima is up, wire the node to the relay so inbound is forwarded (one-time).
        if (maxima && !this.maximaSetupDone) { this.maximaSetupDone = true; this.setupMaximaRelays(gen); }
      } catch (e) {
        if (!live()) return;
        // An adopted node has no child `exit` event — repeated refusals are the only sign it died.
        if (this.adopted && ++this.healthFailures >= ADOPTED_DEAD_AFTER) {
          this.log("[app] adopted node stopped answering — marking it gone");
          this.adopted = false;
          this.stopHealth();
          portmap.stop().catch(() => {});
          this.lastError = "the adopted node stopped answering";
          this.setState("error");
        }
        /* otherwise: still booting or busy — keep the current state */
      }
    };
    poll();
    this.healthTimer = setInterval(poll, HEALTH_EVERY_MS);
  }
  stopHealth() {
    this.healthGen++;
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    if (this.maximaRefreshTimer) { clearInterval(this.maximaRefreshTimer); this.maximaRefreshTimer = null; }
    this.maximaSetupDone = false;
    this.provisionDone = false;
    this.provisionTries = 0;
    this.healthFailures = 0;
    this.health = null;
  }

  // Connect the node to the user's Maxima relay so inbound Maxima is forwarded even behind NAT,
  // pin a stable static MLS, then keep contact addresses fresh. Runtime-only (connect / maxextra /
  // maxima refresh) — never touches startup args or chain P2P.
  async setupMaximaRelays(gen) {
    await this.healMaxima();
    if (gen !== this.healthGen) return;              // stopped while the first heal was running
    // Periodic heal: a contact we hear from often is marked "seen", so the node's 30-min staleness
    // gate never re-resolves its address — and if that contact (e.g. a phone that changed networks)
    // rotates its host, our cached address goes stale and sends silently fail. A periodic heal
    // reconnects the relay and re-pulls every contact's live address so 2-way delivery self-repairs.
    if (this.maximaRefreshTimer) clearInterval(this.maximaRefreshTimer);
    this.maximaRefreshTimer = setInterval(() => { this.healMaxima().catch(() => {}); }, MAXIMA_REFRESH_MS);
  }

  /** Reconnect the relay, apply the static-MLS policy, force-refresh every contact's live address.
   *  Serialised: the periodic timer, the UI button, setMaximaRelay and setMls may all ask at once. */
  healMaxima() {
    const run = this.healChain.then(() => this._heal(), () => this._heal());
    this.healChain = run.catch(() => {});
    return run;
  }
  async _heal() {
    const rpc = (c) => rpcCall(config.rpcPort(), config.rpcSecret(), c);
    const relay = currentRelay();
    const mls = config.load().mls || { mode: "relay", custom: "" };
    try {
      // Connect ONLY if we are not already attached. `connect` opens a fresh P2P socket every
      // time and classic never drops the old one; a heal every 15 min leaked one socket per
      // heal until the relay's per-source cap (16) refused every other device behind this NAT
      // (seen live: 16 sockets from this app to openproject, 510 refusals in 3 h).
      let linked = 0;
      try {
        const n = (await rpc("network").catch(() => ({}))).response || {};
        const mine = [];
        for (const c of (Array.isArray(n.connections) ? n.connections : [])) {
          const byPort = String(c.host || "") + ":" + String(c.port || "");
          const byMinimaPort = String(c.host || "") + ":" + String(c.minimaport || "");
          if (byPort === relay || byMinimaPort === relay) mine.push(c);
        }
        // Keep the newest link, drop every duplicate (by uid), as setMaximaRelay does.
        mine.sort((a, b) => Number(b.uid || 0) - Number(a.uid || 0));
        for (const c of mine.slice(1)) {
          if (/^[0-9A-Za-z]+$/.test(String(c.uid || ""))) {
            await rpc("disconnect uid:" + c.uid).catch(() => {});
            this.log("[app] dropped duplicate relay connection uid " + c.uid);
          }
        }
        linked = mine.length ? 1 : 0;
      } catch (e) { /* best effort - fall through to connect */ }
      if (!linked) {
        try { await rpc("connect host:" + relay); } catch (e) {}
        await new Promise(res => setTimeout(res, 3500));
      } else {
        this.log("[app] relay " + relay + " already connected - not reconnecting");
      }
      const info = (await rpc("maxima action:info").catch(() => ({}))).response || {};
      const pinnedNow = pinnedMls(info);
      if (mls.mode === "relay") {
        const hosts = ((await rpc("maxima action:hosts").catch(() => ({}))).response || {}).hosts || [];
        const r = hosts.find(h => h.host === relay && h.connected);
        if (r && isMlsIdentity(r.address) && pinnedNow !== r.address) {
          await rpc("maxextra action:staticmls host:" + r.address);
          this.log("[app] pinned static MLS to relay " + relay);
        }
      } else if (mls.mode === "custom" && isMlsIdentity(mls.custom) && pinnedNow !== mls.custom) {
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
  /** Ring-buffer tail with a monotonic sequence so the renderer can "clear" by position, not by text. */
  logTail(n = 300) {
    const lines = this.logs.slice(-n);
    return { seq: this.logSeq, lines };
  }
  log(line) {
    for (let l of String(line).split("\n")) {
      if (!l.trim()) continue;
      l = l.replace(/phrase:"[^"]*"/g, 'phrase:"•••"').replace(/privatekey:0x[0-9A-Fa-f]+/g, "privatekey:•••");
      this.logs.push(l.length > 400 ? l.slice(0, 400) + "…" : l);
      this.logSeq++;
      if (process.env.MDESK_NODELOG) { try { fs.appendFileSync(process.env.MDESK_NODELOG, l + "\n"); } catch (e) {} }
    }
    if (this.logs.length > LOG_MAX_LINES) this.logs.splice(0, this.logs.length - LOG_MAX_LINES);
    this.emit("log");
  }
}

module.exports = new NodeManager();
