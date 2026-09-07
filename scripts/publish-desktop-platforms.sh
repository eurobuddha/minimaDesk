#!/usr/bin/env bash
# After CI (tag v<ver>) attached the Windows and Linux installers to the GitHub release, add their rows to
# the one-app store feed. Downloads each asset, hashes it, keeps the mac row, uploads the feed.
# Usage: scripts/publish-desktop-platforms.sh <ver>        (run after: scripts/publish-desktop.sh <ver>)
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${1:?version, e.g. 0.7.19}"
REPO="eurobuddha/minimaDesk"
HOST="${STORE_HOST:-root@eurobuddha.com}"
REMOTE_DIR="/var/www/html/pandaapps"
FEED="pandaapps/minimadesk.json"
[ -f "$FEED" ] || { echo "no $FEED - publish the mac DMG first (scripts/publish-desktop.sh)"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
rows=0
# electron-builder's default names (the store rows' publish-app.py keeps a row's filename pattern, so these stay)
for spec in "win-x64:minimaDesk.Setup.$VER.exe" "linux-x64:minimaDesk-$VER.AppImage"; do
  key="${spec%%:*}"; name="${spec#*:}"
  url="https://github.com/$REPO/releases/download/v$VER/$name"
  if ! curl -fsSL -o "$TMP/$name" "$url"; then echo "!! $name is not on release v$VER yet (CI still running?) - skipped"; continue; fi
  sha=$(shasum -a 256 "$TMP/$name" | cut -d' ' -f1); size=$(stat -f%z "$TMP/$name")
  python3 - "$FEED" "$key" "$url" "$sha" "$size" <<'PY'
import json, sys
feed, key, url, sha, size = sys.argv[1:6]
d = json.load(open(feed)); d.setdefault("platforms", {})[key] = {"file": url, "sha256": sha, "size": int(size)}
json.dump(d, open(feed, "w"), indent=2)
PY
  echo "$key: $name sha256 $sha ($size bytes)"; rows=$((rows+1))
done
[ "$rows" -gt 0 ] || { echo "nothing added"; exit 1; }
scp "$FEED" "$HOST:$REMOTE_DIR/minimadesk.json"
curl -fsSL https://eurobuddha.com/pandaapps/minimadesk.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('live feed:', d['version'], sorted(d['platforms'].keys()))"
