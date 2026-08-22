/* minimaDesk hub — tabbed MiniDapp launcher on the Minima 2024 brand.
   Live from MDS: real dapp icons, categories, featured hero, a living node.
   The renderer never sees secrets — it calls api.cmd() and main injects auth. */
const D = (m) => { try { (window.minima && window.minima.diag) ? window.minima.diag(m) : (document.title = "DIAG:" + m); } catch (e) {} };
window.addEventListener("error", (e) => D("err: " + e.message + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => D("reject: " + (e.reason && (e.reason.message || e.reason))));
const $ = (id) => document.getElementById(id);
const api = window.minima;
D("boot: api=" + (api ? "present" : "MISSING"));

// ---- theme: default DARK (the high-tech look) unless the user chose light; persisted ----
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
let THEME; try { THEME = localStorage.getItem("md-theme") || "dark"; } catch (e) { THEME = "dark"; }
applyTheme(THEME);
function toggleTheme() { THEME = THEME === "dark" ? "light" : "dark"; try { localStorage.setItem("md-theme", THEME); } catch (e) {} applyTheme(THEME); }

let PORTS = { base: 0, rpc: 0, mds: 0 };
let DAPPS = [];                                     // from mds action:list (+ synthetic native tools)
let TABS = [{ id: "home", kind: "home", name: "Home" }];
let ACTIVE = "home";
let FILTER = "";
let ACTIVE_CAT = "all";
let LAST_BLOCK = 0;
let NODE_RUNNING = false;
let HOME_MODE = "grid";        // "grid" | "carousel" — which face of Home is showing

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
  // If the icon's data URL is already cached (the grid resolves them first), embed it directly so
  // it paints immediately with no async round-trip; otherwise mark it for wireIcons to resolve.
  let img = "";
  if (ic) {
    const cached = ICON_CACHE.get(ic);
    if (cached) img = `<img class="ici" alt="" src="${esc(cached)}">`;
    else if (cached !== "") img = `<img class="ici" alt="" data-src="${esc(ic)}">`;
  }
  return `<div class="appicon" style="background:linear-gradient(150deg,${hue[0]},${hue[1]})">
    <span class="sheen"></span>${mono}${nativeSvg}${img}
  </div>`;
}
const ICON_CACHE = new Map();
// after any innerHTML that contains .ici imgs, resolve each icon through the main-process proxy
// (fetches the self-signed MDS icon and returns a data: URL — reliable, cached, no TLS races).
function wireIcons(root) {
  (root || document).querySelectorAll("img.ici[data-src]").forEach((img) => {
    const src = img.getAttribute("data-src"); img.removeAttribute("data-src");
    if (ICON_CACHE.has(src)) { const d = ICON_CACHE.get(src); if (d) img.src = d; else img.remove(); return; }
    api.iconData(src).then((durl) => {
      ICON_CACHE.set(src, durl || "");
      if (durl) img.src = durl; else img.remove();
    }).catch(() => img.remove());
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
  const homeOn = kind === "home";
  $("home").style.display = homeOn && HOME_MODE === "grid" ? "block" : "none";
  $("carousel-view").classList.toggle("on", homeOn && HOME_MODE === "carousel");
  if (homeOn && HOME_MODE === "carousel") startCarousel(); else stopCarousel();
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
async function openDapp(d) {
  if (d.native) { openNative(d.native); return; }
  recordRecent(d.uid);
  const existing = TABS.find(t => t.kind === "dapp" && t.uid === d.uid);
  if (existing) { switchTab(existing.id); return; }
  // Store dapps need WRITE to install; granting it rotates the sessionid, so do it BEFORE we build
  // the webview URL and use the fresh session — otherwise the dapp loads with a stale, invalid one.
  const sessionid = await ensureStoreWrite(d);
  const id = "dapp-" + d.uid;
  const name = dName(d);
  TABS.push({ id, kind: "dapp", uid: d.uid, sessionid, name, hue: hueFor(name), icon: iconUrl(d) });
  const wv = document.createElement("webview");
  wv.dataset.tab = id;
  wv.setAttribute("src", dappUrl(d.uid, sessionid));
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

// ---- pinned favourites (quick-launch dock in the rail) ----
const PINS_KEY = "md-pins";
function getPins() { try { return JSON.parse(localStorage.getItem(PINS_KEY) || "[]"); } catch (e) { return []; } }
function isPinned(uid) { return getPins().includes(uid); }
function togglePin(uid) {
  let p = getPins();
  p = p.includes(uid) ? p.filter(x => x !== uid) : p.concat(uid);
  try { localStorage.setItem(PINS_KEY, JSON.stringify(p)); } catch (e) {}
  renderPinned();
  renderSections();   // refresh pin-button state on tiles
  applyFilter();
}
function renderPinned() {
  const host = $("pinned"), head = $("pinned-h");
  const pins = getPins().map(uid => DAPPS.find(d => d.uid === uid)).filter(Boolean);
  head.hidden = pins.length === 0;
  host.innerHTML = "";
  for (const d of pins) {
    const el = document.createElement("div");
    el.className = "pin";
    el.innerHTML = `<span class="pin-ic">${appiconHTML(d)}</span><span class="pin-nm">${esc(dName(d))}</span>
      <span class="pin-x" title="Unpin"><svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M5 5l14 14M19 5L5 19"/></svg></span>`;
    el.addEventListener("click", (e) => { if (e.target.closest(".pin-x")) { e.stopPropagation(); togglePin(d.uid); return; } openDapp(d); });
    host.appendChild(el);
  }
  wireIcons(host);
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

// Store MiniDapps install other dapps, which needs WRITE (else each install queues to Pending).
// Granting write does a delete+insert of the MiniDAPP on the node, which ROTATES its sessionid —
// so we grant lazily right before opening the dapp (see openDapp), never to an already-open one,
// and then open the webview with the fresh post-grant session. Known store dapps only.
const STORE_WRITE_ALLOW = ["minimacore app store", "dapp store", "pandadapps", "pandaapps"];
function isStoreDapp(d) { return STORE_WRITE_ALLOW.includes(dName(d).toLowerCase()); }
// Grant write (if needed) and return the dapp's CURRENT sessionid (post-rotation).
async function ensureStoreWrite(d) {
  if (!isStoreDapp(d) || permsOf(d) === "write") return d.sessionid;
  try { await api.cmd("mds action:permission uid:" + d.uid + " trust:write"); D("granted write to store dapp: " + dName(d)); } catch (e) { return d.sessionid; }
  DAPP_SIG = "";
  const res = await api.cmd("mds action:list");                 // re-read to get the rotated session
  const list = (res && res.response && res.response.minidapps) || [];
  const fresh = list.find(x => x.uid === d.uid);
  return (fresh && fresh.sessionid) || d.sessionid;
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
  renderPinned();
  renderHero();
  renderContinue();
  renderSections();
  applyFilter();
  updateFoot();
  if (typeof CX !== "undefined" && CX.open && CX.dapps.length !== DAPPS.length) buildCarousel();
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
      if (ACTIVE !== "home") switchTab("home");     // jump straight to the filtered launcher, one click
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
      const pn = el.querySelector(".pn"); if (pn) pn.addEventListener("click", (e) => { e.stopPropagation(); togglePin(d.uid); });
      const tw = el.querySelector(".tw"); if (tw) tw.addEventListener("click", (e) => { e.stopPropagation(); toggleTrust(d); });
      const rm = el.querySelector(".rm"); if (rm) rm.addEventListener("click", (e) => { e.stopPropagation(); uninstall(d); });
    });
  }
  wireIcons(host);
  observeSections();
}
function tileHTML(d) {
  const name = dName(d);
  const open = !d.native && TABS.some(t => t.kind === "dapp" && t.uid === d.uid);
  const key = d.native ? `data-native="${esc(d.native)}"` : `data-uid="${esc(d.uid)}"`;
  const badge = open ? `<span class="badge run" title="Open in a tab"></span>` : "";
  const pinned = !d.native && isPinned(d.uid);
  const IC = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z" stroke-linejoin="round"/><path d="M12 15v5" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 016.9-2.8" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M7 7l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12"/></svg>'
  };
  const write = !d.native && permsOf(d) === "write";
  const acts = d.native ? "" : `
    <div class="acts">
      <button class="ib pn ${pinned ? "on" : ""}" title="${pinned ? "Unpin from sidebar" : "Pin to sidebar"}">${IC.pin}</button>
      <button class="ib tw ${write ? "on" : ""}" title="${write ? "Write access · click for read-only" : "Read-only · click to allow write"}">${write ? IC.unlock : IC.lock}</button>
      <button class="ib rm" title="Uninstall">${IC.trash}</button>
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
  const inst = installedByName(d.name);   // already installed → UPDATE in place (keeps uid + data), never duplicate
  btn.disabled = true; const old = btn.textContent; btn.textContent = inst ? "Updating…" : "Installing…";
  msg.className = "smsg"; msg.textContent = "downloading…";
  const res = await api.storeInstall(d.file, inst ? inst.uid : null);
  if (res && res.status !== false) {
    msg.className = "smsg ok"; msg.textContent = inst ? "updated ✓" : "installed ✓"; btn.textContent = "Reinstall"; btn.classList.add("ghost");
    DAPP_SIG = ""; await loadDapps(); await checkPending();
  } else {
    msg.className = "smsg err"; msg.textContent = (res && res.error) || (inst ? "update failed" : "install failed"); btn.textContent = old;
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
  // `mds action:pending` returns pending COMMANDS from read-permission dapps: the requesting
  // dapp is p.minidapp, the queued command is p.command, and p.uid is the pending-command id
  // to accept/deny. (A store dapp installing a MiniDapp lands here.)
  const dapp = p.minidapp || {};
  const conf = dapp.conf || p.conf || {};
  const name = conf.name || dapp.name || "A MiniDapp";
  const cmd = p.command || "";
  const isInstall = /action:install/.test(cmd);
  const hue = hueFor(name);
  $("pr-ic").textContent = monogram(name);
  $("pr-ic").style.background = `linear-gradient(150deg,${hue[0]},${hue[1]})`;
  $("pr-name").textContent = name;
  $("pr-meta").innerHTML = (conf.version ? "v" + esc(conf.version) + " · " : "") + "<em>needs your approval</em>";
  $("pr-ask").innerHTML = isInstall
    ? esc(name) + " wants to <b>install a MiniDapp</b> on your node."
    : esc(name) + " wants to run:<br><code>" + esc(cmd || "a write command") + "</code>";
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
  if (CX.open) cxSpark();
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
$("pv-heal").addEventListener("click", async () => {
  const b = $("pv-heal"), m = $("pv-heal-msg"); const old = b.innerHTML;
  b.disabled = true; m.className = "heal-msg"; m.textContent = "reconnecting relay + refreshing contacts…";
  try {
    const res = await api.healMaxima();
    if (res && res.status !== false) { m.className = "heal-msg ok"; m.textContent = "Maxima healed — relay reconnected, contacts refreshed."; }
    else { m.className = "heal-msg err"; m.textContent = (res && res.error) || "heal failed — is the node running?"; }
  } catch (e) { m.className = "heal-msg err"; m.textContent = "heal failed: " + e.message; }
  b.disabled = false; b.innerHTML = old;
  setTimeout(refreshMaximaAddr, 4000);
});
document.querySelectorAll(".tool[data-open]").forEach(el => el.addEventListener("click", () => openNative(el.dataset.open)));
$("optheme").addEventListener("click", toggleTheme);
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

// ============ carousel view (cinematic launcher) ============
const CX = { pos: 0, target: 0, vel: 0, cards: [], dapps: [], raf: 0, open: false, built: false,
  dragging: false, dragStartX: 0, dragStartPos: 0, lastX: 0, lastT: 0, dragMoved: false,
  tiltX: 0, tiltY: 0, tTiltX: 0, tTiltY: 0 };
function cxGrad(name) { const h = hueFor(name); return `linear-gradient(145deg,${h[0]},${h[1]})`; }
function cxGlow(name) { return hueFor(name)[0]; }

function buildCarousel() {
  const wrap = $("cx-carousel"); wrap.innerHTML = "";
  CX.dapps = DAPPS.slice(); CX.cards = []; CX.built = true;
  const dots = $("cx-dots"); dots.innerHTML = "";
  if (!CX.dapps.length) { wrap.innerHTML = `<div class="cx-empty">No MiniDapps installed yet — install one to see it here.</div>`; return; }
  CX.dapps.forEach((d) => {
    const name = dName(d), cat = catName(catFor(name, dDesc(d))), glow = cxGlow(name);
    const el = document.createElement("div"); el.className = "cx-card";
    el.style.setProperty("--_grad", cxGrad(name)); el.style.setProperty("--_glow", glow);
    el.innerHTML = `
      <div class="glow" style="--_glow:${glow}"></div>
      <div class="in">
        <div class="art"><div class="halo" style="--_grad:${cxGrad(name)}"></div><div class="cxi">${appiconHTML(d)}</div><div class="sheen"></div></div>
        <div class="meta">
          <div class="cat">${esc(cat)}</div>
          <h3>${esc(name)}</h3>
          <p>${esc(dDesc(d) || "A MiniDapp on your Minima node.")}</p>
          <div class="row">
            <button class="open-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>Open</button>
            <button class="pin-btn ${isPinned(d.uid) ? "pinned" : ""}" title="Pin / unpin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z" stroke-linejoin="round"/><path d="M12 15v5" stroke-linecap="round"/></svg></button>
          </div>
        </div>
      </div>`;
    wrap.appendChild(el);
    el.querySelector(".open-btn").addEventListener("click", (e) => { e.stopPropagation(); openDapp(d); });
    el.querySelector(".pin-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePin(d.uid); e.currentTarget.classList.toggle("pinned", isPinned(d.uid)); });
    el.addEventListener("click", () => { if (CX.dragMoved) return; const idx = CX.dapps.indexOf(d); if (idx === Math.round(CX.pos)) openDapp(d); else cxGoto(idx); });
    CX.cards.push(el);
    const b = document.createElement("i"); b.addEventListener("click", () => cxGoto(CX.cards.length - 1)); dots.appendChild(b);
  });
  CX.pos = -1.2; CX.target = 0; CX.vel = 0;
}
function cxLayout() {
  const N = CX.dapps.length; if (!N) return;
  const focusIdx = Math.max(0, Math.min(N - 1, Math.round(CX.pos)));
  for (let i = 0; i < N; i++) {
    const off = i - CX.pos, a = Math.abs(off), el = CX.cards[i];
    if (a > 3.2) { el.style.display = "none"; continue; }
    el.style.display = "block";
    const x = off * 195 * (a > 1 ? (1 + (a - 1) * 0.28) : 1);
    const z = -Math.min(a, 3) * 240 - (a > 0 ? 60 : 0);
    const rotY = Math.max(-52, Math.min(52, -off * 38));
    const scale = Math.max(.55, 1 - a * 0.14);
    const opacity = a > 2.6 ? 0 : Math.max(0, 1 - a * 0.30);
    // NB: no per-frame blur() filter — it forces a GPU re-render every frame and tanks the fps
    // ("awful physics"). Depth comes from scale + rotateY + opacity, which composite for free.
    el.style.transform = `translate3d(${x}px,0,${z}px) rotateY(${rotY}deg) scale(${scale})`;
    el.style.opacity = opacity; el.style.zIndex = 100 - Math.round(a * 10);
    el.classList.toggle("focused", i === focusIdx && a < 0.5);
    el.style.pointerEvents = a < 2 ? "auto" : "none";
  }
  [...$("cx-dots").children].forEach((c, i) => c.classList.toggle("on", i === focusIdx));
  const fd = CX.dapps[focusIdx]; if (fd) $("cx-sub").textContent = `${catName(catFor(dName(fd), dDesc(fd)))} · drag, scroll, or use arrow keys to browse`;
}
function cxTick() {
  if (!CX.open) return;
  if (!CX.dragging) {
    const k = 0.14, damp = 0.78, diff = CX.target - CX.pos;
    CX.vel = CX.vel * damp + diff * k; CX.pos += CX.vel;
    if (Math.abs(diff) < 0.0006 && Math.abs(CX.vel) < 0.0006) { CX.pos = CX.target; CX.vel = 0; }
  }
  cxApplyTilt(); cxLayout();
  CX.raf = requestAnimationFrame(cxTick);
}
function cxGoto(i) { CX.target = Math.max(0, Math.min(CX.dapps.length - 1, i)); }
function cxStep(dir) { cxGoto(Math.round(CX.target) + dir); }
function cxApplyTilt() {
  CX.tiltX += (CX.tTiltX - CX.tiltX) * 0.12; CX.tiltY += (CX.tTiltY - CX.tiltY) * 0.12;
  const f = CX.cards[Math.round(CX.pos)]; if (!f) return;
  const inner = f.querySelector(".in"); if (inner) inner.style.transform = `rotateY(${CX.tiltY}deg) rotateX(${CX.tiltX}deg)`;
}
function startCarousel() {
  if (CX.open) return;
  if (!CX.built || CX.dapps.length !== DAPPS.length) buildCarousel();
  CX.open = true;
  if (!CX.particlesDone) { cxParticles(); CX.particlesDone = true; }
  cancelAnimationFrame(CX.raf); CX.raf = requestAnimationFrame(cxTick);
}
function stopCarousel() { CX.open = false; cancelAnimationFrame(CX.raf); }
function setHomeMode(mode) {
  HOME_MODE = mode;
  document.querySelectorAll("#home-viewtoggle .vt-grid, #carousel-view .vt-grid").forEach(b => b.classList.toggle("on", mode === "grid"));
  document.querySelectorAll("#home-viewtoggle .vt-carousel, #carousel-view .vt-carousel").forEach(b => b.classList.toggle("on", mode === "carousel"));
  if (ACTIVE === "home") switchTab("home"); else switchTab("home");
}

// ---- carousel interactions ----
(function wireCarousel() {
  const car = $("cx-carousel"), cw = $("cx-wrap");
  car.addEventListener("pointermove", (e) => {
    const f = CX.cards[Math.round(CX.pos)]; if (!f) return;
    const r = f.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    if (Math.abs(dx) < 1.4 && Math.abs(dy) < 1.4) { CX.tTiltY = dx * 9; CX.tTiltX = -dy * 9; }
  });
  car.addEventListener("pointerleave", () => { CX.tTiltX = 0; CX.tTiltY = 0; });
  car.addEventListener("pointerdown", (e) => {
    CX.dragging = true; CX.dragMoved = false; CX.dragStartX = e.clientX; CX.lastX = e.clientX;
    CX.lastT = performance.now(); CX.dragStartPos = CX.pos; CX.vel = 0;
    try { car.setPointerCapture(e.pointerId); } catch (er) {}
  });
  car.addEventListener("pointermove", (e) => {
    if (!CX.dragging) return;
    const dx = e.clientX - CX.dragStartX; if (Math.abs(dx) > 4) CX.dragMoved = true;
    CX.pos = Math.max(-0.4, Math.min(CX.dapps.length - 0.6, CX.dragStartPos - dx / 220));
    const now = performance.now(); const inst = (e.clientX - CX.lastX) / Math.max(1, now - CX.lastT);
    CX.vel = -inst * 0.9; CX.lastX = e.clientX; CX.lastT = now;
  });
  const endDrag = () => { if (!CX.dragging) return; CX.dragging = false; CX.target = Math.max(0, Math.min(CX.dapps.length - 1, Math.round(CX.pos + CX.vel * 8))); };
  car.addEventListener("pointerup", endDrag); car.addEventListener("pointercancel", endDrag);
  let wheelLock = 0;
  cw.addEventListener("wheel", (e) => {
    if (!CX.open) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    e.preventDefault(); const now = performance.now();
    if (now - wheelLock < 120) return;
    if (Math.abs(d) > 8) { cxStep(d > 0 ? 1 : -1); wheelLock = now; }
  }, { passive: false });
  $("cx-prev").addEventListener("click", () => cxStep(-1));
  $("cx-next").addEventListener("click", () => cxStep(1));
})();
addEventListener("keydown", (e) => {
  if (!CX.open) return;
  const t = document.activeElement; if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
  if (e.key === "ArrowRight") { cxStep(1); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { cxStep(-1); e.preventDefault(); }
  else if (e.key === "Enter") { const d = CX.dapps[Math.round(CX.target)]; if (d) openDapp(d); }
  else if (e.key === "Home") cxGoto(0);
  else if (e.key === "End") cxGoto(CX.dapps.length - 1);
});
document.querySelectorAll(".vt-carousel").forEach(b => b.addEventListener("click", () => setHomeMode("carousel")));
document.querySelectorAll(".vt-grid").forEach(b => b.addEventListener("click", () => setHomeMode("grid")));

// cascade spark on each new block while the carousel is open
function cxSpark() {
  const cas = $("cx-cascade"); if (!cas) return;
  const h = cas.clientHeight, settleY = 40 + Math.random() * Math.max(60, h - 120);
  const spark = document.createElement("div"); spark.className = "spark"; cas.appendChild(spark);
  const start = performance.now(), dur = 680;
  (function fall(t) {
    const k = Math.min(1, (t - start) / dur), ease = 1 - Math.pow(1 - k, 2.2);
    spark.style.top = (ease * settleY) + "px";
    if (k < 1) requestAnimationFrame(fall);
    else { spark.remove(); const node = document.createElement("div"); node.className = "node"; node.style.top = settleY + "px"; cas.appendChild(node);
      CX._nodes = CX._nodes || []; CX._nodes.push(node);
      if (CX._nodes.length > 14) { const old = CX._nodes.shift(); old.style.transition = "opacity .8s"; old.style.opacity = "0"; setTimeout(() => old.remove(), 800); } }
  })(start);
}
function cxParticles() {
  const box = $("cx-particles"); if (!box) return;
  for (let i = 0; i < 24; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%"; p.style.bottom = "-10px";
    const s = 1 + Math.random() * 2.4; p.style.width = s + "px"; p.style.height = s + "px";
    p.style.background = `radial-gradient(circle,${Math.random() < .5 ? "#FF512F" : "#317AFF"},transparent 70%)`;
    p.style.animationDuration = (14 + Math.random() * 16) + "s"; p.style.animationDelay = (-Math.random() * 20) + "s";
    box.appendChild(p);
  }
}

api.onStatus((s) => applyStatus(s));

(async function init() {
  renderTabs();
  switchTab("home");
  PORTS = await api.ports();
  if (PORTS.appVersion) { $("foot-ver").textContent = PORTS.appVersion; $("brand-ver").textContent = "v" + PORTS.appVersion; }
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
