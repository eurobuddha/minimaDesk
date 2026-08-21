/* Phase-0 boot shell logic: reflect node status + list installed MiniDapps via MDS. Replaced by the hub in Phase 1. */
const $ = (id) => document.getElementById(id);

function applyStatus(s) {
  if (!s) return;
  const dot = $("dot"), txt = $("statustext");
  const st = s.state, h = s.health || {};
  dot.className = "dot" + (st === "running" ? " ok" : st === "error" ? " err" : " warn");
  txt.textContent = st === "running" ? "node running" : st === "error" ? (s.lastError || "node error") : "starting node…";
  $("block").textContent = h.block ? h.block.toLocaleString() : "—";
  $("conns").textContent = (h.connections ?? "—");
  $("maxima").textContent = h.maxima ? "up" : (st === "running" ? "…" : "—");
  $("ver").textContent = h.version || "—";
}

async function loadDapps() {
  const list = $("dapplist");
  const res = await window.minima.cmd("mds action:list");
  if (!res || res.status === false) { list.innerHTML = '<div class="muted">MDS not ready yet…</div>'; return; }
  // MDS list shape: response.minidapps[] with { uid, conf:{name,version,description} }
  const dapps = (res.response && (res.response.minidapps || res.response)) || [];
  if (!Array.isArray(dapps) || dapps.length === 0) { list.innerHTML = '<div class="muted">No MiniDapps installed yet.</div>'; return; }
  list.innerHTML = "";
  for (const d of dapps) {
    const conf = d.conf || d;
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `<div class="name"></div><div class="meta"></div>`;
    el.querySelector(".name").textContent = conf.name || d.uid || "MiniDapp";
    el.querySelector(".meta").textContent = (conf.version ? "v" + conf.version + " · " : "") + (conf.description || "");
    list.appendChild(el);
  }
}

window.minima.onStatus((s) => applyStatus(s));
$("refresh").addEventListener("click", loadDapps);

(async function init() {
  applyStatus(await window.minima.snapshot());
  // Poll for MDS coming up (the node needs a few seconds after boot).
  let tries = 0;
  const iv = setInterval(async () => {
    applyStatus(await window.minima.snapshot());
    await loadDapps();
    if (++tries > 40) clearInterval(iv);
  }, 3000);
})();
