/*
 * versions.js — compare dapp version strings ("0.3.0", "v2.47.2", "1.0.5-beta"). Electron-free so
 * scripts/sync-bundled-dapps.sh can use it too.
 * A leading "v" is ignored. Numeric segments compare numerically, a missing segment counts as 0, a
 * release outranks its own pre-release, non-numeric segments compare as strings. Returns -1 / 0 / 1.
 */
function norm(v) {
  return String(v == null ? "" : v).trim().replace(/^v/i, "");
}

function compareVersions(a, b) {
  const pa = norm(a).split(/[.\-]/);
  const pb = norm(b).split(/[.\-]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const mx = pa[i] === undefined || pa[i] === "", my = pb[i] === undefined || pb[i] === "";
    const x = mx ? "0" : pa[i], y = my ? "0" : pb[i];
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    // a release outranks its own pre-release: "1.0.5" > "1.0.5-beta"
    if (mx && !ny) return 1;
    if (my && !nx) return -1;
    if (nx && ny) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

module.exports = { compareVersions };
