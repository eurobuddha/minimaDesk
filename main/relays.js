/*
 * relays.js — the user's always-on Maxima relay fleet (see the maxima-relay ops skill). A classic node
 * ADOPTS whichever relay it is connected to as its Maxima host, so inbound Maxima is forwarded even
 * behind NAT. Attach to ONE relay only: stock Maxima has no inbound msgid de-dup, so several relays
 * deliver the same message several times.
 */
const KNOWN_RELAYS = [
  { host: "65.109.31.226:9501",  label: "Helsinki (Hetzner) — default" },
  { host: "95.179.179.181:9501", label: "sally" },
  { host: "45.77.246.226:9501",  label: "Maxima-Lite" },
  { host: "78.141.237.9:9501",   label: "openproject" },
  { host: "192.248.151.55:9501", label: "megammr" },
  { host: "45.77.57.24:9501",    label: "vigilance" },
  { host: "31.125.188.214:8001", label: "Pi (home)" },
];
const DEFAULT_RELAY = KNOWN_RELAYS[0].host;

/** host:port with a numeric port and a hostname/IPv4 (no scheme, no path). */
function isHostPort(s) {
  return /^[A-Za-z0-9.\-]+:\d{1,5}$/.test(String(s || "").trim());
}

module.exports = { KNOWN_RELAYS, DEFAULT_RELAY, isHostPort };
