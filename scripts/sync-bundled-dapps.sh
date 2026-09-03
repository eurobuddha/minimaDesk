#!/usr/bin/env bash
# sync-bundled-dapps.sh — refresh resources/dapps with the newest builds of the MiniDapps minimaDesk
# bundles (minimaCore App Store, Terminal IDE) and rewrite manifest.json. Run before a release.
#
#   scripts/sync-bundled-dapps.sh [appstore-dist-dir] [terminalide-dist-dir]
set -euo pipefail
cd "$(dirname "$0")/.."

APPSTORE_DIR="${1:-$HOME/Projects/minima/desktop/minimacore-appstore/dist}"
TERMINAL_DIR="${2:-$HOME/Projects/minima/mds/terminalIDE/dist}"
OUT="resources/dapps"
mkdir -p "$OUT"

# Newest zip in a dir, judged by the version inside its dapp.conf (not by mtime or filename).
newest_zip() {
  local dir="$1"
  node -e '
    const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
    const { compareVersions } = require("./main/versions");
    const dir = process.argv[1];
    let best = null;
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".mds.zip"))) {
      let conf; try { conf = JSON.parse(execFileSync("unzip", ["-p", path.join(dir, f), "dapp.conf"]).toString()); } catch (e) { continue; }
      if (!best || compareVersions(conf.version, best.version) > 0) best = { file: f, name: conf.name, version: String(conf.version) };
    }
    if (!best) { console.error("no .mds.zip with a dapp.conf in " + dir); process.exit(1); }
    process.stdout.write(JSON.stringify(best));
  ' "$dir"
}

STORE=$(newest_zip "$APPSTORE_DIR")
TERMINAL=$(newest_zip "$TERMINAL_DIR")

rm -f "$OUT"/*.mds.zip
cp "$APPSTORE_DIR/$(node -pe 'JSON.parse(process.argv[1]).file' "$STORE")" "$OUT/"
cp "$TERMINAL_DIR/$(node -pe 'JSON.parse(process.argv[1]).file' "$TERMINAL")" "$OUT/"

node -e '
  const s = JSON.parse(process.argv[1]), t = JSON.parse(process.argv[2]);
  const m = { dapps: [
    { name: s.name, file: s.file, version: s.version, write: true },
    { name: t.name, file: t.file, version: t.version, write: true } ] };
  require("fs").writeFileSync(process.argv[3], JSON.stringify(m, null, 2) + "\n");
  console.log(JSON.stringify(m, null, 2));
' "$STORE" "$TERMINAL" "$OUT/manifest.json"

echo "bundled dapps refreshed in $OUT"
