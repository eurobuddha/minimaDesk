/* minimaDesk hub — tabs + live MDS launcher + webview dapp tabs + node status. */
const D = (m) => { try { (window.minima && window.minima.diag) ? window.minima.diag(m) : (document.title = "DIAG:" + m); } catch (e) {} };
window.addEventListener("error", (e) => D("err: " + e.message + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => D("reject: " + (e.reason && (e.reason.message || e.reason))));
const $ = (id) => document.getElementById(id);
const api = window.minima;
D("boot: api=" + (api ? "present" : "MISSING"));

let PORTS = { base: 0, rpc: 0, mds: 0 };
let DAPPS = [];                 // from mds action:list
let TABS = [{ id: "home", kind: "home", name: "Home" }];
let ACTIVE = "home";
let FILTER = "";

// ---- deterministic monogram + hue from a dapp name (Parlons avatar DNA) ----
function hueFor(name) {
  let h = 0; for (const c of (name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const HUES = [["#ff6a4a", "#e2401f"], ["#4d86ff", "#255fd6"], ["#6b6f78", "#3f4249"],
                ["#5a6470", "#3a4350"], ["#ff8a52", "#e2541f"], ["#707480", "#454952"], ["#5a94ff", "#2f6ae0"]];
  return HUES[h % HUES.length];
}
function monogram(name) {
  const n = (name || "?").trim();
  return (n[0] || "?").toUpperCase();
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---- tab strip ----
function renderTabs() {
  const wrap = $("tabs");
  wrap.innerHTML = "";
  for (const t of TABS) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === ACTIVE ? " active" : "");
    if (t.kind === "home") {
      el.innerHTML = `<span class="fav" style="background:linear-gradient(150deg,#2c2f34,#1a1c20)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/></svg></span>
        <span class="ttl">Home</span>`;
    } else {
      const hue = t.hue || hueFor(t.name);
      el.innerHTML = `<span class="fav" style="background:linear-gradient(150deg,${hue[0]},${hue[1]})">${esc(monogram(t.name))}</span>
        <span class="ttl">${esc(t.name)}</span>
        <span class="x" title="Close"><svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></span>`;
      el.querySelector(".x").addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.id); });
    }
    el.addEventListener("click", () => switchTab(t.id));
    wrap.appendChild(el);
  }
}

function switchTab(id) {
  ACTIVE = id;
  const t = TABS.find(x => x.id === id);
  const isHome = !!(t && t.kind === "home");
  $("home").classList.toggle("hidden", !isHome);
  // The webview layer covers the whole stage — hide it entirely on Home, or it
  // eats every click/scroll meant for the launcher underneath.
  $("webviews").style.display = isHome ? "none" : "block";
  document.querySelectorAll(".webviews webview").forEach(wv => {
    wv.classList.toggle("hidden", !(t && t.kind === "dapp" && wv.dataset.tab === id));
  });
  renderTabs();
}

// ---- open / close a dapp tab ----
function dappUrl(uid, sessionid) {
  return `https://${"127.0.0.1"}:${PORTS.mds}/${uid}/index.html?uid=${sessionid}`;
}
function openDapp(d) {
  const existing = TABS.find(t => t.kind === "dapp" && t.uid === d.uid);
  if (existing) { switchTab(existing.id); return; }
  const id = "dapp-" + d.uid;
  const name = (d.conf && d.conf.name) || d.name || "MiniDapp";
  TABS.push({ id, kind: "dapp", uid: d.uid, sessionid: d.sessionid, name, hue: hueFor(name) });
  const wv = document.createElement("webview");
  wv.dataset.tab = id;
  wv.setAttribute("src", dappUrl(d.uid, d.sessionid));
  wv.setAttribute("partition", "persist:mds");
  wv.setAttribute("allowpopups", "");
  $("webviews").appendChild(wv);
  switchTab(id);
}
function closeTab(id) {
  const wv = document.querySelector(`.webviews webview[data-tab="${id}"]`);
  if (wv) wv.remove();
  const i = TABS.findIndex(t => t.id === id);
  TABS = TABS.filter(t => t.id !== id);
  if (ACTIVE === id) switchTab(TABS[Math.max(0, i - 1)] ? TABS[Math.max(0, i - 1)].id : "home");
  else renderTabs();
}

// ---- the launcher grid (live from MDS) ----
async function loadDapps() {
  const res = await api.cmd("mds action:list");
  if (!res || res.status === false) return;
  const r = res.response || {};
  const list = Array.isArray(r.minidapps) ? r.minidapps : (Array.isArray(r) ? r : []);
  // Each item: { uid, sessionid, conf:{name,version,description}, trust }
  DAPPS = list.filter(d => {
    const nm = ((d.conf && d.conf.name) || "").toLowerCase();
    return !nm.startsWith("_"); // hide MiniHub-internal if present
  });
  renderGrid();
}
function permsOf(d) {
  const tr = (d.trust || d.permission || "").toLowerCase();
  if (tr === "write") return ["R", "W"];
  if (tr === "read") return ["R"];
  return [];
}
function renderGrid() {
  const grid = $("grid");
  const q = FILTER.trim().toLowerCase();
  const shown = DAPPS.filter(d => !q || ((d.conf && d.conf.name) || "").toLowerCase().includes(q));
  $("count").textContent = DAPPS.length;
  if (!shown.length) { grid.innerHTML = `<div class="empty">${DAPPS.length ? "No matches." : "No MiniDapps installed yet — install one above."}</div>`; return; }
  grid.innerHTML = "";
  for (const d of shown) {
    const conf = d.conf || {};
    const name = conf.name || d.uid;
    const hue = hueFor(name);
    const open = TABS.some(t => t.kind === "dapp" && t.uid === d.uid);
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `
      <div class="top">
        <div class="ic" style="background:linear-gradient(150deg,${hue[0]},${hue[1]})">${esc(monogram(name))}</div>
        ${open ? '<span class="run" title="Open in a tab"></span>' : ""}
      </div>
      <div class="nm">${esc(name)}</div>
      <div class="cat">${esc(conf.description || "MiniDapp")}</div>
      <div class="foot">
        <span class="ver">${conf.version ? "v" + esc(conf.version) : ""}</span>
        <span class="perm">${permsOf(d).map(p => `<span>${p}</span>`).join("")}</span>
      </div>
      <div class="acts">
        <button class="rm">Uninstall</button>
        <button class="op">Open</button>
      </div>`;
    el.querySelector(".op").addEventListener("click", (e) => { e.stopPropagation(); openDapp(d); });
    el.querySelector(".rm").addEventListener("click", (e) => { e.stopPropagation(); uninstall(d); });
    el.addEventListener("click", () => openDapp(d));
    grid.appendChild(el);
  }
}

async function install() {
  const btn = $("installbtn"); btn.disabled = true;
  try {
    const res = await api.install();
    if (res && res.cancelled) return;
    await loadDapps();
    await checkPending();
  } finally { btn.disabled = false; }
}
async function uninstall(d) {
  const name = (d.conf && d.conf.name) || d.uid;
  if (!confirm("Uninstall " + name + "? This removes the MiniDapp and its data on this machine.")) return;
  await api.cmd('mds action:uninstall uid:' + d.uid);
  closeTab("dapp-" + d.uid);
  await loadDapps();
}

// ---- permission prompt (MDS pending accept/deny) ----
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
  $("pr-allow").onclick = async () => { await api.cmd("mds action:accept uid:" + p.uid); hidePrompt(); await loadDapps(); await checkPending(); };
  $("pr-deny").onclick = async () => { await api.cmd("mds action:deny uid:" + p.uid); hidePrompt(); await checkPending(); };
  $("scrim").hidden = false; $("prompt").hidden = false;
}
function hidePrompt() { $("scrim").hidden = true; $("prompt").hidden = true; }

// ---- node status: chip + hero + popover ----
let MX_ADDR = "";
function applyStatus(s) {
  if (!s) return;
  const st = s.state, h = s.health || {};
  const running = st === "running";
  const blk = h.block ? h.block.toLocaleString() : "—";
  // chip
  $("chipblock").textContent = blk;
  $("chiplbl").textContent = running ? "online" : (st === "error" ? "error" : "starting");
  $("chippulse").className = "pulse " + (running ? "live" : "off");
  // hero
  $("statblock").textContent = blk;
  $("statpulse").className = "pulse " + (running ? "live" : "off");
  if (running) {
    $("eyebrow").textContent = `Node online · Maxima ${h.maxima ? "ready" : "starting"}`;
    $("greeting").innerHTML = `Welcome. <span class="dim">Your node is ${h.block ? "syncing" : "online"}.</span>`;
    $("herosub").innerHTML = `<b>${h.connections ?? 0}</b> peers connected · <b>${DAPPS.length}</b> MiniDapps installed · Maxima ${h.maxima ? "ready" : "starting"}`;
  }
  // popover
  $("popstatus").querySelector ? null : null;
  $("pv-block").textContent = blk;
  $("pv-conns").textContent = (h.connections ?? "—");
  $("pv-maxima").textContent = h.maxima ? "online" : (running ? "starting" : "—");
  $("pv-ports").textContent = PORTS.base ? (`:${PORTS.base} · mds :${PORTS.mds}`) : "—";
  $("pv-ver").textContent = h.version || "—";
}
async function refreshMaximaAddr() {
  try {
    const res = await api.cmd("maxima action:info");
    const r = (res && res.response) || {};
    MX_ADDR = r.contact || r.maximaaddress || "";
    if (MX_ADDR) $("pv-addr").textContent = MX_ADDR;
  } catch (e) {}
}

// ---- wire up ----
$("newtab").addEventListener("click", () => switchTab("home"));
$("installbtn").addEventListener("click", install);
$("installcard").addEventListener("click", (e) => { if (e.target.closest("#installbtn")) return; });
$("search").addEventListener("input", (e) => { FILTER = e.target.value; renderGrid(); });
$("nodechip").addEventListener("click", () => { $("nodepop").hidden = !$("nodepop").hidden; });
document.addEventListener("click", (e) => { if (!e.target.closest("#nodepop") && !e.target.closest("#nodechip")) $("nodepop").hidden = true; });
$("pv-copy").addEventListener("click", async () => { if (MX_ADDR) { try { await navigator.clipboard.writeText(MX_ADDR); } catch (e) {} } });

api.onStatus((s) => applyStatus(s));

(async function init() {
  renderTabs();
  switchTab("home");                    // set correct initial layer visibility
  PORTS = await api.ports();
  applyStatus(await api.snapshot());
  let tries = 0;
  const iv = setInterval(async () => {
    applyStatus(await api.snapshot());
    await loadDapps();
    await refreshMaximaAddr();
    await checkPending();
    if (++tries > 200) clearInterval(iv);
  }, 4000);
})();
