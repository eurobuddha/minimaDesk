/*
 * startup.js — Settings → Startup parameters: read, validate and apply the node's startup configuration
 * (data folder, Minima port, every manifest flag from params.js, raw extra arguments).
 *
 * Validation is strict on purpose: the jar throws UnknownArgumentException on any flag it doesn't know and
 * the node then never boots, so nothing unknown is ever saved. Secrets (type "secret") never land in
 * config.json — they are stored encrypted (config.paramSecretSet) with a `true` marker in `params`.
 */
const path = require("path");
const config = require("./config");
const PARAMS = require("./params");

const PORT_MIN = 1025, PORT_MAX = 65530;   // +4 for RPC must still fit

function tokenizeArgs(s) {
  if (!s || typeof s !== "string") return [];
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** What the editor shows: manifest + current values (secrets as true/false markers only). */
function current() {
  const cfg = config.load();
  const values = {};
  for (const it of PARAMS.ITEMS) {
    const v = cfg.params[it.flag];
    values[it.flag] = it.type === "secret" ? v === true : (it.type === "bool" ? v === true : String(v == null ? "" : v));
  }
  return {
    groups: PARAMS.GROUPS, managedInfo: PARAMS.MANAGED_INFO,
    values, dataFolder: cfg.dataFolder || "", defaultDataFolder: config.defaultDataFolder(),
    basePort: config.basePort(), extraArgs: cfg.extraArgs || "", contribute: !!cfg.contribute,
  };
}

/**
 * Validate a patch { basePort, dataFolder, params, extraArgs } against the current config.
 * Returns { errors: string[], next: cfg, secrets: { flag: newValue | null(clear) } }.
 */
function validate(patch) {
  const cur = config.load();
  const errors = [];
  const p = patch && typeof patch === "object" ? patch : {};
  const next = Object.assign({}, cur);
  const secrets = {};

  // ---- Minima port ----
  const port = parseInt(p.basePort, 10);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) errors.push(`Minima port must be a number between ${PORT_MIN} and ${PORT_MAX}.`);
  else next.basePort = port;

  // ---- data folder: absolute, no whitespace (the node's command parser splits on it — see config.js) ----
  const folder = String(p.dataFolder == null ? "" : p.dataFolder).trim();
  if (folder) {
    if (!path.isAbsolute(folder)) errors.push("Data folder must be an absolute path.");
    else if (/\s/.test(folder)) errors.push("Data folder must not contain spaces — MiniDapp-initiated installs break on paths with whitespace.");
    else if (/["\r\n]/.test(folder)) errors.push("Data folder must not contain quotes or line breaks.");
    else next.dataFolder = folder;
  } else next.dataFolder = "";

  // ---- manifest params ----
  const inParams = p.params && typeof p.params === "object" ? p.params : {};
  const params = Object.assign({}, cur.params);
  for (const k of Object.keys(inParams)) {
    if (!PARAMS.BY_FLAG.has(k)) { errors.push(`Unknown startup flag "-${k}".`); continue; }
    const it = PARAMS.BY_FLAG.get(k);
    const v = inParams[k];
    if (it.type === "bool") { params[k] = v === true; continue; }
    if (it.type === "secret") {
      if (v === true) continue;                                  // keep what is stored
      if (v === false || v == null || String(v).trim() === "") { params[k] = false; secrets[k] = null; continue; }
      const s = String(v);
      if (/[\r\n]/.test(s)) errors.push(`${it.label}: no line breaks.`);
      else if (s.includes("=")) errors.push(`${it.label}: the value cannot contain "=" (the node's conf file is key=value).`);
      else { params[k] = true; secrets[k] = s; }
      continue;
    }
    const s = String(v == null ? "" : v).trim();
    if (!s) { params[k] = ""; continue; }
    if (/[\r\n]/.test(s)) { errors.push(`${it.label}: no line breaks.`); continue; }
    if (s.startsWith("-")) { errors.push(`${it.label}: a value cannot start with "-" (the node would read it as a flag).`); continue; }
    if (it.type === "int" && !/^\d+$/.test(s)) { errors.push(`${it.label}: whole number only.`); continue; }
    params[k] = s;
  }
  // -server (Contribute to the network) with -isclient / -desktop is a HashMap-ordering race in the jar.
  if (next.contribute && (params.isclient === true || params.desktop === true))
    errors.push("Client node / Desktop settings cannot be on while Contribute to the network is on (Settings → Network). Turn one of them off.");
  next.params = params;

  // ---- raw extra arguments: every flag must be one the bundled jar knows, and not one minimaDesk manages ----
  const extra = String(p.extraArgs == null ? "" : p.extraArgs).trim();
  const toks = tokenizeArgs(extra);
  let expectValue = false;
  for (const t of toks) {
    if (t.startsWith("-")) {
      const f = t.replace(/^-/, "");
      if (!PARAMS.ALL_FLAGS.has(f)) errors.push(`Additional arguments: "-${f}" is not a flag this node version knows — it would refuse to start.`);
      else if (PARAMS.MANAGED.includes(f)) errors.push(`Additional arguments: "-${f}" is set by minimaDesk (see "Managed by minimaDesk").`);
      expectValue = true;
    } else {
      if (!expectValue) errors.push(`Additional arguments: "${t}" is not a flag — every value must follow a -flag.`);
      expectValue = false;
    }
  }
  next.extraArgs = extra;

  return { errors, next, secrets };
}

/** Persist a validated patch (secrets to their encrypted files first, then config.json). */
function apply(patch) {
  const { errors, next, secrets } = validate(patch);
  if (errors.length) return { status: false, errors };
  for (const [flag, v] of Object.entries(secrets)) { if (v == null) config.paramSecretDelete(flag); else config.paramSecretSet(flag, v); }
  config.save({ basePort: next.basePort, dataFolder: next.dataFolder, params: next.params, extraArgs: next.extraArgs });
  return { status: true, errors: [] };
}

module.exports = { current, validate, apply, tokenizeArgs };
