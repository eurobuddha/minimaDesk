/* minimaDesk hub — tabbed MiniDapp launcher on the Minima 2024 brand.
   Live from MDS: real dapp icons, categories, featured hero, a living node.
   The renderer never sees secrets — it calls api.cmd() and main injects auth. */
const D = (m) => { try { (window.minima && window.minima.diag) ? window.minima.diag(m) : (document.title = "DIAG:" + m); } catch (e) {} };
window.addEventListener("error", (e) => D("err: " + e.message + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => D("reject: " + (e.reason && (e.reason.message || e.reason))));
const $ = (id) => document.getElementById(id);
const api = window.minima;
D("boot: api=" + (api ? "present" : "MISSING"));

let PORTS = { base: 0, rpc: 0, mds: 0 };
let DAPPS = [];                                     // from mds action:list (+ synthetic native tools)
let TABS = [{ id: "home", kind: "home", name: "Home" }];
let ACTIVE = "home";
let FILTER = "";
let ACTIVE_CAT = "all";
let LAST_BLOCK = 0;
let NODE_RUNNING = false;

// ---- helpers ----
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function monogram(name) { const n = (name || "?").trim(); return (n[0] || "?").toUpperCase(); }
function hueFor(name) {                             // deterministic, colourful tile gradient
  let h = 0; for (const c of (name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const HUES = [["#FF7358", "#FE3918"], ["#3E8BFF", "#1748B0"], ["#22B37A", "#0B6B48"],
                ["#7A5BF0", "#3A1E9E"], ["#F2A93B", "#C9640E"], ["#39C0C6", "#146E86"],
                ["#E24A6B", "#8E1240"], ["#4B57C9", "#232C6E"], ["#465059", "#20262C"]];
  return HUES[h % HUES.length];
}
function fmtNum(n) { const v = Number(n); return isFinite(v) ? v.toLocaleString("en-US") : "—"; }
function relTime(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60); if (h < 24) return h + " hr ago";
  const d = Math.floor(h / 24); return d === 1 ? "yesterday" : d + " days ago";
}

// ---- categories (MDS dapps carry no category → classify by name/description) ----
const CATS = [
  { id: "pay",    name: "Payments & DeFi", icon: '<rect x="4" y="7" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.4" stroke="currentColor" stroke-width="1.8" fill="none"/>' },
  { id: "social", name: "Social & Comms",  icon: '<path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' },
  { id: "media",  name: "Media & Games",   icon: '<rect x="4" y="6" width="16" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 10l4 2-4 2z" fill="currentColor"/>' },
  { id: "files",  name: "Files & Storage", icon: '<path d="M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' },
  { id: "node",   name: "Node & Tools",    icon: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v3M12 18v3M21 12h-3M6 12H3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  { id: "other",  name: "More",            icon: '<circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/>' }
];
const CAT_RULES = [
  ["pay",    /wallet|pay|send|receiv|stake|dex|swap|cash|coin|token|eth|atomic|money|fund|invoice|merch|shop|store\b|market/],
  ["social", /chat|mail|messag|social|comms|contact|maxima|friend|inbox|talk|forum|post/],
  ["media",  /game|2048|arcade|dice|wager|play|media|video|music|tube|photo|image|gif|paint|draw|meme|radio|stream/],
  ["files",  /file|docs|storage|vault|backup|drive|filez|note|pdf|cloud|disk/],
  ["node",   /explor|block|terminal|logs|security|health|node|consensus|setting|miner|status|network|debug|dev\b|api\b/]
];
function catFor(name, desc) {
  const s = ((name || "") + " " + (desc || "")).toLowerCase();
  for (const [id, re] of CAT_RULES) if (re.test(s)) return id;
  return "other";
}
const catName = (id) => (CATS.find(c => c.id === id) || {}).name || "MiniDapp";

// ---- a dapp's fields ----
function dName(d) { return (d.conf && d.conf.name) || d.name || d.uid; }
function dDesc(d) { return (d.conf && d.conf.description) || ""; }
function dVer(d)  { return (d.conf && d.conf.version) || ""; }
function iconUrl(d) {
  if (d.native) return "";
  const ic = (d.conf && d.conf.icon) || "";
  if (!ic || !d.sessionid || !PORTS.mds) return "";
  return "https://127.0.0.1:" + PORTS.mds + "/" + d.uid + "/" + encodeURI(ic) + "?uid=" + d.sessionid;
}
// The node reports permission at conf.permission (MiniDAPP.toJSON nests it in `conf`).
// Older shapes exposed it top-level as trust/permission — check all three.
function permsOf(d) {
  const tr = ((d.conf && d.conf.permission) || d.trust || d.permission || "").toLowerCase();
  if (tr === "write") return "write";
  if (tr === "read") return "read";
  return "read";
}

// ---- app-icon markup (real PNG over a gradient+monogram fallback) ----
function appiconHTML(d) {
  const name = dName(d);
  const hue = hueFor(name);
  const ic = iconUrl(d);
  const nativeSvg = d.nativeSvg ? `<span class="mark" style="z-index:2;position:relative;width:50%;height:50%">${d.nativeSvg}</span>` : "";
  const mono = d.nativeSvg ? "" : `<span class="mono-t">${esc(monogram(name))}</span>`;
  return `<div class="appicon" style="background:linear-gradient(150deg,${hue[0]},${hue[1]})">
    <span class="sheen"></span>${mono}${nativeSvg}
    ${ic ? `<img class="ici" alt="" data-src="${esc(ic)}">` : ""}
  </div>`;
}
// after any innerHTML that contains .ici imgs, wire src + graceful fallback
function wireIcons(root) {
  (root || document).querySelectorAll("img.ici[data-src]").forEach(img => {
    const src = img.getAttribute("data-src"); img.removeAttribute("data-src");
    img.addEventListener("error", () => img.remove());
    img.src = src;
  });
}

// ============ tab strip ============
function homeTabInner() {
  return `<span class="fav" style="background:linear-gradient(150deg,#2c2f34,#1a1c20)">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/></svg></span>
    <span class="ttl">Home</span>`;
}
function renderTabs() {
  const wrap = $("tabs"); wrap.innerHTML = "";
  for (const t of TABS) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === ACTIVE ? " active" : "");
    if (t.kind === "home") {
      el.innerHTML = homeTabInner();
    } else {
      const hue = t.hue || hueFor(t.name);
      const fav = t.icon
        ? `<span class="fav"><img src="${esc(t.icon)}" alt=""></span>`
        : `<span class="fav" style="background:linear-gradient(150deg,${hue[0]},${hue[1]})">${esc(monogram(t.name))}</span>`;
      el.innerHTML = `${fav}<span class="ttl">${esc(t.name)}</span>
        <span class="x" title="Close"><svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></span>`;
      el.querySelector(".x").addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.id); });
    }
    el.addEventListener("click", () => switchTab(t.id));
    wrap.appendChild(el);
  }
  // the inline onerror above is blocked by CSP; wire fallbacks in JS instead
  wrap.querySelectorAll(".fav img").forEach(img => img.addEventListener("error", () => img.remove()));
}

function switchTab(id) {
  ACTIVE = id;
  const t = TABS.find(x => x.id === id);
  const kind = t ? t.kind : "home";
  // exactly one full-stage layer is shown; others display:none so none can eat clicks/scroll
  $("home").style.display = kind === "home" ? "block" : "none";
  $("webviews").style.display = kind === "dapp" ? "block" : "none";
  $("logsview").style.display = kind === "logs" ? "flex" : "none";
  $("termview").style.display = kind === "terminal" ? "flex" : "none";
  $("storeview").style.display = kind === "store" ? "flex" : "none";
  document.querySelectorAll(".webviews webview").forEach(wv => {
    wv.classList.toggle("hidden", !(kind === "dapp" && wv.dataset.tab === id));
  });
  if (kind === "logs") refreshLogs();
  if (kind === "terminal") setTimeout(() => $("term-input").focus(), 30);
  if (kind === "store" && !STORE_LOADED) loadStore();
  renderTabs();
}

// open a first-party native tab (logs / terminal / store), reusing it if already open
function openNative(kind) {
  const id = kind;
  const NAMES = { logs: "Node logs", terminal: "Terminal", store: "Store" };
  if (!TABS.find(t => t.id === id)) TABS.push({ id, kind, name: NAMES[kind] || kind });
  switchTab(id);
}

// ============ open / close a dapp tab ============
function dappUrl(uid, sessionid) { return `https://127.0.0.1:${PORTS.mds}/${uid}/index.html?uid=${sessionid}`; }
function openDapp(d) {
  if (d.native) { openNative(d.native); return; }
  recordRecent(d.uid);
  const existing = TABS.find(t => t.kind === "dapp" && t.uid === d.uid);
  if (existing) { switchTab(existing.id); return; }
  const id = "dapp-" + d.uid;
  const name = dName(d);
  TABS.push({ id, kind: "dapp", uid: d.uid, sessionid: d.sessionid, name, hue: hueFor(name), icon: iconUrl(d) });
  const wv = document.createElement("webview");
  wv.dataset.tab = id;
  wv.setAttribute("src", dappUrl(d.uid, d.sessionid));
  wv.setAttribute("partition", "persist:mds");
  wv.setAttribute("allowpopups", "");
  $("webviews").appendChild(wv);
  switchTab(id);
  renderContinue();
}
function closeTab(id) {
  const wv = document.querySelector(`.webviews webview[data-tab="${id}"]`);
  if (wv) wv.remove();
  const i = TABS.findIndex(t => t.id === id);
  TABS = TABS.filter(t => t.id !== id);
  if (ACTIVE === id) switchTab(TABS[Math.max(0, i - 1)] ? TABS[Math.max(0, i - 1)].id : "home");
  else renderTabs();
}

// ============ recently opened (Continue strip) ============
const RECENT_KEY = "md-recent";
function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) { return []; } }
function recordRecent(uid) {
  let r = getRecent().filter(x => x.uid !== uid);
  r.unshift({ uid, ts: Date.now() });
  r = r.slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {}
}

// ============ live launcher (from MDS) ============
let DAPP_SIG = "";
async function loadDapps() {
  const res = await api.cmd("mds action:list");
  if (!res || res.status === false) return;
  const r = res.response || {};
  const list = Array.isArray(r.minidapps) ? r.minidapps : (Array.isArray(r) ? r : []);
  const real = list.filter(d => !((d.conf && d.conf.name) || "").toLowerCase().startsWith("_"));
  DAPPS = real;
  const sig = DAPPS.map(d => d.uid + ":" + permsOf(d)).join(",");
  if (sig === DAPP_SIG) return;
  DAPP_SIG = sig;
  renderHome();
}

// synthetic native tools shown inside "Node & Tools"
function nativeTiles() {
  return [
    { native: "terminal", name: "Terminal", conf: { name: "Terminal", description: "Run node commands over RPC" },
      nativeSvg: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2.2" stroke="#fff" stroke-width="1.7"/><path d="M7 9l3 2.5L7 14M12.5 14.5h5" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    { native: "logs", name: "Node logs", conf: { name: "Node logs", description: "Live output from your node" },
      nativeSvg: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 5.5h14M5 9.5h14M5 13.5h9M5 17.5h11" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>' }
  ];
}

function allTiles() {
  const withCat = DAPPS.map(d => ({ ...d, cat: catFor(dName(d), dDesc(d)) }));
  const natives = nativeTiles().map(d => ({ ...d, cat: "node" }));
  return withCat.concat(natives);
}

function renderHome() {
  renderCats();
  renderHero();
  renderContinue();
  renderSections();
  applyFilter();
  updateFoot();
}

// ---- rail categories ----
function renderCats() {
  const tiles = allTiles();
  const host = $("cats"); host.innerHTML = "";
  const mk = (id, name, iconSvg, count) => {
    const el = document.createElement("div");
    el.className = "cat" + (ACTIVE_CAT === id ? " active" : "");
    el.dataset.cat = id;
    el.innerHTML = `<span class="ci"><svg width="17" height="17" viewBox="0 0 24 24">${iconSvg}</svg></span><span class="cn">${esc(name)}</span><span class="cc">${count}</span>`;
    el.addEventListener("click", () => {
      ACTIVE_CAT = id; renderCats(); applyFilter();
      $("home").scrollTo({ top: 0, behavior: "smooth" });
    });
    host.appendChild(el);
  };
  const allIcon = '<rect x="4" y="4" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/>';
  mk("all", "All MiniDapps", allIcon, tiles.length);
  for (const c of CATS) {
    const n = tiles.filter(t => t.cat === c.id).length;
    if (!n) continue;
    mk(c.id, c.name, c.icon, n);
  }
}

// ---- featured hero ----
function featuredDapp() {
  if (!DAPPS.length) return null;
  return DAPPS.find(d => dName(d).toLowerCase() === "wallet")
      || DAPPS.find(d => /wallet/i.test(dName(d)))
      || DAPPS[0];
}
function renderHero() {
  const hero = $("hero");
  const f = featuredDapp();
  if (!f) {
    $("hero-eyebrow").textContent = "Welcome";
    $("hero-icon").innerHTML = "";
    $("hero-name").textContent = "Your node is live";
    $("hero-sub").textContent = "";
    $("hero-desc").textContent = "Install your first MiniDapp to get started — it opens right here as a tab once you approve its permissions.";
    $("hero-cta").innerHTML = "";
    const b = document.createElement("button"); b.className = "btn primary";
    b.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Install a MiniDapp`;
    b.addEventListener("click", install); $("hero-cta").appendChild(b);
    return;
  }
  $("hero-eyebrow").textContent = "Featured today";
  $("hero-icon").innerHTML = appiconHTML(f); wireIcons($("hero-icon"));
  $("hero-name").textContent = dName(f);
  $("hero-sub").textContent = catName(catFor(dName(f), dDesc(f))) + " · installed";
  $("hero-desc").textContent = dDesc(f) || "A MiniDapp running on your own Minima node.";
  $("hero-cta").innerHTML = "";
  const open = document.createElement("button"); open.className = "btn primary";
  open.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Open ${esc(dName(f))}`;
  open.addEventListener("click", () => openDapp(f));
  const inst = document.createElement("button"); inst.className = "btn ghost"; inst.textContent = "Install a MiniDapp";
  inst.addEventListener("click", install);
  $("hero-cta").append(open, inst);
}

// ---- Continue strip ----
function renderContinue() {
  const sec = $("continue-sec"), strip = $("strip");
  const recent = getRecent().map(r => {
    const d = DAPPS.find(x => x.uid === r.uid);
    return d ? { d, ts: r.ts } : null;
  }).filter(Boolean).slice(0, 6);
  if (!recent.length) { sec.hidden = true; strip.innerHTML = ""; return; }
  sec.hidden = false;
  strip.innerHTML = recent.map(({ d, ts }) => `
    <div class="rcard" data-uid="${esc(d.uid)}">
      <div class="rc-top"><div class="ico">${appiconHTML(d)}</div>
        <div><div class="rc-name">${esc(dName(d))}</div><div class="rc-cat">${esc(catName(catFor(dName(d), dDesc(d))))}</div></div></div>
      <div class="rc-meta"><span class="dot"></span>Opened ${esc(relTime(ts))}</div>
    </div>`).join("");
  wireIcons(strip);
  strip.querySelectorAll(".rcard").forEach(el => {
    const d = DAPPS.find(x => x.uid === el.dataset.uid);
    if (d) el.addEventListener("click", () => openDapp(d));
  });
}

// ---- category sections of app-icon tiles ----
function renderSections() {
  const tiles = allTiles();
  const host = $("sections"); host.innerHTML = "";
  for (const c of CATS) {
    const items = tiles.filter(t => t.cat === c.id);
    if (!items.length) continue;
    const sec = document.createElement("section");
    sec.className = "sec"; sec.dataset.cat = c.id;
    sec.innerHTML = `<div class="sec-head"><h2>${esc(c.name)}</h2><span class="count">${items.length}</span></div>
      <div class="grid">${items.map(tileHTML).join("")}</div>`;
    host.appendChild(sec);
    sec.querySelectorAll(".tile").forEach((el) => {
      const uid = el.dataset.uid, nat = el.dataset.native;
      const d = nat ? nativeTiles().find(x => x.native === nat) : tiles.find(x => x.uid === uid);
      if (!d) return;
      el.addEventListener("click", () => openDapp(d));
      const op = el.querySelector(".op"); if (op) op.addEventListener("click", (e) => { e.stopPropagation(); openDapp(d); });
      const rm = el.querySelector(".rm"); if (rm) rm.addEventListener("click", (e) => { e.stopPropagation(); uninstall(d); });
      const tw = el.querySelector(".tw"); if (tw) tw.addEventListener("click", (e) => { e.stopPropagation(); toggleTrust(d); });
    });
  }
  wireIcons(host);
  observeSections();
}
function tileHTML(d) {
  const name = dName(d);
  const open = !d.native && TABS.some(t => t.kind === "dapp" && t.uid === d.uid);
  const write = permsOf(d) === "write";
  const key = d.native ? `data-native="${esc(d.native)}"` : `data-uid="${esc(d.uid)}"`;
  const badge = open ? `<span class="badge run" title="Open in a tab"></span>` : "";
  const acts = d.native ? `<div class="acts"><button class="op">Open</button></div>` : `
    <div class="acts">
      <button class="op">Open</button>
      <button class="tw w ${write ? "on" : ""}">${write ? "Write" : "Read"}</button>
      <button class="rm">Remove</button>
    </div>`;
  return `<div class="tile" ${key}>
    ${badge}
    <div class="icon">${appiconHTML(d)}</div>
    <div class="label">${esc(name)}</div>
    ${acts}
  </div>`;
}
let IO = null;
function observeSections() {
  if (IO) IO.disconnect();
  IO = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); IO.unobserve(e.target); } });
  }, { threshold: .06, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll("#sections .sec, #continue-sec").forEach((s, i) => {
    s.style.transitionDelay = (i % 3) * 60 + "ms";
    const r = s.getBoundingClientRect();
    if (r.top < window.innerHeight) s.classList.add("in"); else IO.observe(s);
  });
}

// ---- search + category filtering ----
function applyFilter() {
  const term = FILTER.trim().toLowerCase();
  let any = false;
  document.querySelectorAll("#sections .sec[data-cat]").forEach(sec => {
    const catOK = ACTIVE_CAT === "all" || sec.dataset.cat === ACTIVE_CAT;
    let shown = 0;
    sec.querySelectorAll(".tile").forEach(t => {
      const label = (t.querySelector(".label").textContent || "").toLowerCase();
      const match = catOK && (!term || label.includes(term));
      t.style.display = match ? "" : "none";
      if (match) shown++;
    });
    sec.hidden = shown === 0;
    if (shown) any = true;
  });
  const narrowing = ACTIVE_CAT !== "all" || term.length > 0;
  $("hero").hidden = narrowing;
  $("continue-sec").style.display = narrowing ? "none" : "";
  const empty = $("empty");
  empty.hidden = any;
  if (!any) empty.textContent = DAPPS.length ? "No MiniDapps match that search." : "No MiniDapps installed yet — install one to begin.";
}

function updateFoot() {
  $("foot-left").textContent = DAPPS.length + " MiniDapp" + (DAPPS.length === 1 ? "" : "s") + " installed";
}

// ============ install / uninstall / trust ============
async function install() {
  const res = await api.install();
  if (res && res.cancelled) return;
  await loadDapps();
  await checkPending();
}
async function uninstall(d) {
  if (d.native) return;
  const name = dName(d);
  if (!confirm("Uninstall " + name + "? This removes the MiniDapp and its data on this machine.")) return;
  await api.cmd("mds action:uninstall uid:" + d.uid);
  closeTab("dapp-" + d.uid);
  DAPP_SIG = "";
  await loadDapps();
}
async function toggleTrust(d) {
  if (d.native) return;
  const cur = permsOf(d) === "write" ? "write" : "read";
  const next = cur === "write" ? "read" : "write";
  await api.cmd("mds action:permission uid:" + d.uid + " trust:" + next);
  DAPP_SIG = "";
  await loadDapps();
}

// ============ native MiniDapp Store ============
// The stock third-party Dapp Store dapp points at the official /data/*.json paths, which have
// moved and now 404. minimaDesk hosts its own store instead: fetch a repository descriptor,
// then download + install the chosen .mds.zip through the node's proven `mds action:install`.
const STORE_REPOS = [
  { id: "panda",    name: "PandaDapps",       url: "https://eurobuddha.com/pandadapps.json" },
  { id: "official", name: "Minima Official",  url: "https://minidapps.minima.global/dapps.json", base: "https://minidapps.minima.global" }
];
let STORE_REPO = STORE_REPOS[0];
let STORE_LOADED = false;
let STORE_ITEMS = [];

function absUrl(u, base) {
  if (!u) return "";
  try { return new URL(u, base).toString(); } catch (e) { return u; }
}
// Normalise either repo shape into { name, version, description, icon, file }.
function normaliseStore(repo, json) {
  const head = { name: repo.name, description: "", icon: "" };
  let list = [];
  if (Array.isArray(json)) {
    // official shape: [{ name, filename, icon(relative), description, version }]
    const base = repo.base || repo.url;
    list = json.map(d => ({
      name: d.name, version: d.version, description: d.description,
      icon: absUrl(d.icon, base + "/"),
      file: d.file ? absUrl(d.file, base + "/") : (d.filename ? base + "/downloads/" + d.filename : "")
    }));
  } else if (json && Array.isArray(json.dapps)) {
    // repository shape: { name, description, icon, dapps:[{ name, file, icon, description, version }] }
    head.name = json.name || repo.name;
    head.description = json.description || "";
    head.icon = absUrl(json.icon, repo.url);
    list = json.dapps.map(d => ({
      name: d.name, version: d.version, description: d.description,
      icon: absUrl(d.icon, repo.url),
      file: absUrl(d.file || d.filename, repo.url)
    }));
  }
  return { head, list: list.filter(d => d.name && d.file) };
}

async function loadStore() {
  STORE_LOADED = true;
  buildRepoSelect();
  const grid = $("store-grid"); grid.innerHTML = `<div class="store-empty">Loading ${esc(STORE_REPO.name)}…</div>`;
  $("store-head").innerHTML = "";
  const res = await api.storeFetch(STORE_REPO.url);
  if (!res || res.status === false) {
    grid.innerHTML = `<div class="store-empty">Couldn't reach ${esc(STORE_REPO.name)}.<br><span style="font-size:12px">${esc((res && res.error) || "")}</span></div>`;
    return;
  }
  const { head, list } = normaliseStore(STORE_REPO, res.response);
  STORE_ITEMS = list;
  $("store-head").innerHTML = `<div class="st-top">
      ${head.icon ? `<img class="st-ic" src="${esc(head.icon)}" alt="">` : ""}
      <div><h2>${esc(head.name)}</h2>${head.description ? `<p>${esc(head.description)}</p>` : ""}</div>
    </div>`;
  $("store-head").querySelectorAll("img").forEach(im => im.addEventListener("error", () => im.remove()));
  renderStore();
}

function installedByName(name) {
  return DAPPS.find(d => dName(d).toLowerCase() === String(name || "").toLowerCase());
}
function renderStore() {
  const grid = $("store-grid");
  if (!STORE_ITEMS.length) { grid.innerHTML = `<div class="store-empty">No MiniDapps in this store.</div>`; return; }
  grid.innerHTML = "";
  for (const d of STORE_ITEMS) {
    const inst = installedByName(d.name);
    const el = document.createElement("div");
    el.className = "scard" + (inst ? " installed" : "");
    el.innerHTML = `
      <img class="sic" alt="">
      <div class="sbody">
        <div class="sname">${esc(d.name)} <span class="sver">${d.version ? "v" + esc(d.version) : ""}</span></div>
        <div class="sdesc">${esc(d.description || "")}</div>
        <div class="sfoot">
          <button class="sbtn ${inst ? "ghost" : ""}">${inst ? "Reinstall" : "Install"}</button>
          <span class="smsg">${inst ? "installed" : ""}</span>
        </div>
      </div>`;
    const img = el.querySelector(".sic");
    if (d.icon) { img.addEventListener("error", () => { img.style.visibility = "hidden"; }); img.src = d.icon; }
    const btn = el.querySelector(".sbtn"), msg = el.querySelector(".smsg");
    btn.addEventListener("click", () => installFromStore(d, btn, msg));
    grid.appendChild(el);
  }
}
async function installFromStore(d, btn, msg) {
  if (!NODE_RUNNING) { msg.className = "smsg err"; msg.textContent = "node still starting — try again in a moment"; return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = "Installing…";
  msg.className = "smsg"; msg.textContent = "downloading…";
  const res = await api.storeInstall(d.file);
  if (res && res.status !== false) {
    msg.className = "smsg ok"; msg.textContent = "installed ✓"; btn.textContent = "Reinstall"; btn.classList.add("ghost");
    DAPP_SIG = ""; await loadDapps(); await checkPending();
  } else {
    msg.className = "smsg err"; msg.textContent = (res && res.error) || "install failed"; btn.textContent = old;
  }
  btn.disabled = false;
}
function buildRepoSelect() {
  const sel = $("store-repo");
  if (sel.options.length) return;
  STORE_REPOS.forEach(r => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; sel.appendChild(o); });
  sel.value = STORE_REPO.id;
  sel.addEventListener("change", () => { STORE_REPO = STORE_REPOS.find(r => r.id === sel.value) || STORE_REPOS[0]; loadStore(); });
}

// ============ permission prompt (MDS pending accept/deny) ============
async function checkPending() {
  const res = await api.cmd("mds action:pending");
  const r = (res && res.response) || {};
  const pend = Array.isArray(r.pending) ? r.pending : [];
  if (!pend.length) { hidePrompt(); return; }
  showPrompt(pend[0]);
}
function showPrompt(p) {
  const conf = p.conf || {};
  const name = conf.name || p.uid;
  const hue = hueFor(name);
  $("pr-ic").textContent = monogram(name);
  $("pr-ic").style.background = `linear-gradient(150deg,${hue[0]},${hue[1]})`;
  $("pr-name").textContent = name;
  $("pr-meta").innerHTML = (conf.version ? "v" + esc(conf.version) + " · " : "") + "<em>new MiniDapp</em>";
  $("pr-ask").innerHTML = esc(name) + " wants permission to <b>read and write</b> on your node.";
  $("pr-allow").onclick = async () => { await api.cmd("mds action:accept uid:" + p.uid); hidePrompt(); DAPP_SIG = ""; await loadDapps(); await checkPending(); };
  $("pr-deny").onclick = async () => { await api.cmd("mds action:deny uid:" + p.uid); hidePrompt(); await checkPending(); };
  $("scrim").hidden = false; $("prompt").hidden = false;
}
function hidePrompt() { $("scrim").hidden = true; $("prompt").hidden = true; }

// ============ the living node: chip + hero aura + rail card + popover ============
let MX_ADDR = "";
function setBlockDisplay(el, blk) {
  const s = fmtNum(blk);
  if (blk && s.length > 3) { const cut = s.length - 3; el.innerHTML = esc(s.slice(0, cut)) + '<span class="tick">' + esc(s.slice(cut)) + "</span>"; }
  else el.textContent = s;
}
function applyStatus(s) {
  if (!s) return;
  const st = s.state, h = s.health || {};
  const running = st === "running";
  NODE_RUNNING = running;
  const blk = h.block || 0;
  const blkStr = blk ? fmtNum(blk) : "—";
  const pulseCls = running ? "" : (st === "error" ? "err" : "off");

  // titlebar chip
  $("chippulse").className = "pulse " + pulseCls;
  $("chipblock").textContent = blkStr;
  $("chippeers").textContent = h.connections != null ? h.connections : "—";
  $("chipmax").textContent = h.maxima ? "on" : (running ? "…" : "off");

  // hero aura
  setBlockDisplay($("hero-block"), blk);
  $("hero-u").textContent = running ? "current chain height — live from your node" : (st === "error" ? "node error — see logs" : "bringing your node online…");
  $("am-peers").textContent = h.connections != null ? h.connections : "—";
  $("am-maxima").textContent = h.maxima ? "on" : (running ? "…" : "off");
  $("am-dapps").textContent = DAPPS.length || "—";

  // rail node card
  const stEl = $("nc-status");
  stEl.textContent = running ? "synced" : (st === "error" ? "error" : "starting");
  stEl.className = "status" + (running ? "" : st === "error" ? " err" : " off");
  $("nc-block").textContent = blkStr;
  $("nc-maxima").textContent = h.maxima ? "connected" : (running ? "starting…" : "—");
  $("nc-maxima").style.color = h.maxima ? "var(--blue)" : "var(--ink-3)";
  $("nc-sync").style.width = running ? "100%" : (blk ? "60%" : "12%");

  // popover
  $("popstatus").lastChild && ($("popstatus").childNodes[1].nodeValue = running ? "online" : (st === "error" ? "error" : "starting"));
  $("pv-block").textContent = blkStr;
  $("pv-conns").textContent = h.connections != null ? h.connections : "—";
  $("pv-maxima").textContent = h.maxima ? "online" : (running ? "starting" : "—");
  $("pv-ports").textContent = PORTS.base ? (`:${PORTS.base} · mds :${PORTS.mds}`) : "—";
  $("pv-ver").textContent = h.version || "—";
  $("foot-node").textContent = h.version || "—";

  // heartbeat: on a new block, flash the hero tick + drop a cascade node
  if (running && blk > LAST_BLOCK) { if (LAST_BLOCK) heartbeat(); LAST_BLOCK = blk; }
}
function heartbeat() {
  const tick = $("hero-block").querySelector(".tick");
  if (tick && tick.animate) tick.animate([{ filter: "brightness(2)" }, { filter: "brightness(1)" }], { duration: 900, easing: "ease-out" });
  const cascade = $("cascade");
  const dot = document.createElement("span");
  dot.className = "node"; dot.style.top = (10 + Math.random() * 80) + "%";
  cascade.appendChild(dot);
  const dots = cascade.querySelectorAll(".node");
  if (dots.length > 6) dots[0].remove();
  if (dot.animate) dot.animate([{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1.4)", opacity: 1 }, { transform: "scale(1)", opacity: 1 }], { duration: 600, easing: "cubic-bezier(.2,.8,.2,1)" });
}
async function refreshMaximaAddr() {
  try {
    const res = await api.cmd("maxima action:info");
    const r = (res && res.response) || {};
    MX_ADDR = r.contact || r.maximaaddress || "";
    if (MX_ADDR) $("pv-addr").textContent = MX_ADDR;   // FULL address, never truncated (RULE 1)
  } catch (e) {}
}
async function fetchBalance() {
  try {
    const res = await api.cmd("balance");
    const arr = (res && res.response) || [];
    const mini = Array.isArray(arr) ? (arr.find(t => (t.tokenid || t.token) === "0x00") || arr[0]) : null;
    if (mini && mini.confirmed != null) $("nc-balance").textContent = mini.confirmed + " MINIMA";
  } catch (e) {}
}

// ============ wiring ============
$("newtab").addEventListener("click", install);
$("foot-install").addEventListener("click", install);
$("search").addEventListener("input", (e) => { FILTER = e.target.value; applyFilter(); });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("search").focus(); }
});
$("nodechip").addEventListener("click", () => { $("nodepop").hidden = !$("nodepop").hidden; });
$("nodecard").addEventListener("click", () => { $("nodepop").hidden = !$("nodepop").hidden; });
document.addEventListener("click", (e) => {
  if (!e.target.closest("#nodepop") && !e.target.closest("#nodechip") && !e.target.closest("#nodecard")) $("nodepop").hidden = true;
});
$("pv-copy").addEventListener("click", async () => { if (MX_ADDR) { try { await navigator.clipboard.writeText(MX_ADDR); } catch (e) {} } });
document.querySelectorAll(".tool").forEach(el => el.addEventListener("click", () => openNative(el.dataset.open)));
$("store-refresh").addEventListener("click", () => loadStore());

// ---- Logs ----
let LOGS_FOLLOW = true;
$("logs-follow").addEventListener("change", (e) => { LOGS_FOLLOW = e.target.checked; });
$("logs-clear").addEventListener("click", () => { $("logs-pre").textContent = ""; });
async function refreshLogs() {
  if (ACTIVE !== "logs") return;
  const lines = await api.logs();
  const pre = $("logs-pre");
  pre.textContent = (lines || []).join("\n");
  if (LOGS_FOLLOW) pre.scrollTop = pre.scrollHeight;
}

// ---- Terminal (write mode: full RPC command surface) ----
function termAppend(cmd, out, isErr) {
  const box = $("term-out");
  const c = document.createElement("div"); c.className = "cmd"; c.textContent = cmd; box.appendChild(c);
  const o = document.createElement("div"); o.className = "out" + (isErr ? " err" : ""); o.textContent = out; box.appendChild(o);
  box.scrollTop = box.scrollHeight;
}
const TERM_HIST = []; let TERM_IX = 0;
$("term-input").addEventListener("keydown", async (e) => {
  const inp = e.target;
  if (e.key === "Enter") {
    const cmd = inp.value.trim(); if (!cmd) return;
    inp.value = ""; TERM_HIST.push(cmd); TERM_IX = TERM_HIST.length;
    if (cmd === "clear") { $("term-out").innerHTML = ""; return; }
    termAppend(cmd, "…running…");
    const res = await api.cmd(cmd);
    $("term-out").lastChild.remove();
    const ok = res && res.status !== false;
    termAppend(cmd, JSON.stringify(res && res.response !== undefined ? res.response : res, null, 2), !ok);
  } else if (e.key === "ArrowUp") { if (TERM_IX > 0) { TERM_IX--; inp.value = TERM_HIST[TERM_IX] || ""; e.preventDefault(); } }
  else if (e.key === "ArrowDown") { if (TERM_IX < TERM_HIST.length) { TERM_IX++; inp.value = TERM_HIST[TERM_IX] || ""; } }
});

api.onStatus((s) => applyStatus(s));

(async function init() {
  renderTabs();
  switchTab("home");
  PORTS = await api.ports();
  if (PORTS.appVersion) $("foot-ver").textContent = PORTS.appVersion;
  applyStatus(await api.snapshot());
  renderCats(); renderHero(); renderSections(); applyFilter();
  let tries = 0;
  const iv = setInterval(async () => {
    applyStatus(await api.snapshot());
    await loadDapps();
    await refreshMaximaAddr();
    await fetchBalance();
    await checkPending();
    refreshLogs();
    if (++tries > 100000) clearInterval(iv);
  }, 4000);
})();
