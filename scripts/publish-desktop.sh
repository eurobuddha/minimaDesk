#!/usr/bin/env bash
# Publish a minimaDesk mac release: the signed+verified DMG to the GitHub release v<ver>, then the
# one-app store feed (manifest only, sha256 per file) to the eurobuddha.com store host, which the app's
# in-app updater reads (main/updater.js): https://eurobuddha.com/pandaapps/minimadesk.json
# NOT the release command - scripts/release-desktop.sh is (all three platforms). Usage:
#   scripts/publish-desktop.sh <ver> ["release notes"]     (run after: npm run dist:mac:signed)
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${1:?version, e.g. 0.7.19}"; NOTES="${2:-minimaDesk $VER}"
DMG="dist/minimaDesk-$VER-arm64.dmg"
[ -f "$DMG" ] || { echo "no $DMG - build it first (npm run dist:mac:signed)"; exit 1; }
xcrun stapler validate "$DMG" > /dev/null || { echo "$DMG is not notarized+stapled - refusing"; exit 1; }
REPO="eurobuddha/minimaDesk"
HOST="${STORE_HOST:-root@eurobuddha.com}"
REMOTE_DIR="/var/www/html/pandaapps"
FEED="pandaapps/minimadesk.json"
SHA=$(shasum -a 256 "$DMG" | cut -d' ' -f1)
SIZE=$(stat -f%z "$DMG")
# Keep the CI artifact and publish the notarized installer under its own immutable name.
SIGNED_DMG="${DMG%.dmg}-notarized.dmg"
if [ -e "$SIGNED_DMG" ]; then
  cmp -s "$DMG" "$SIGNED_DMG" || { echo "conflicting local signed artifact: $SIGNED_DMG"; exit 1; }
else
  cp -p "$DMG" "$SIGNED_DMG"
fi
DMG="$SIGNED_DMG"
echo "== GitHub release v$VER"
if gh release view "v$VER" -R "$REPO" > /dev/null 2>&1; then
  REMOTE_SHA=$(gh api "repos/$REPO/releases/tags/v$VER" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((a.get("digest") or "unknown" for a in d["assets"] if a["name"]==sys.argv[1]), ""))' "$(basename "$DMG")")
  case "$REMOTE_SHA" in
    "") gh release upload "v$VER" "$DMG" -R "$REPO" ;;
    "sha256:$SHA") echo "identical notarized installer already published" ;;
    *) echo "conflicting published artifact; refusing to replace it"; exit 1 ;;
  esac
else
  gh release create "v$VER" "$DMG" --title "MinimaClassic Desktop v$VER" --notes "$NOTES
sha256 $SHA" -R "$REPO"
fi
FILE_URL="https://github.com/$REPO/releases/download/v$VER/minimaDesk-$VER-arm64-notarized.dmg"
echo "== feed"
mkdir -p pandaapps
python3 - "$VER" "$NOTES" "$FILE_URL" "$SHA" "$SIZE" "$FEED" <<'PY'
import json, sys, datetime, os
ver, notes, url, sha, size, feed = sys.argv[1:7]
doc = {"app": "minimaDesk", "version": ver, "date": datetime.date.today().isoformat(), "notes": notes, "platforms": {}}
if os.path.exists(feed):
    try: doc["platforms"] = json.load(open(feed)).get("platforms", {})   # keep other platforms' rows until they are rebuilt
    except Exception: pass
doc["platforms"]["mac-arm64"] = {"file": url, "sha256": sha, "size": int(size)}
json.dump(doc, open(feed, "w"), indent=2); print(open(feed).read())
PY
echo "== upload the feed to $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p $REMOTE_DIR"
scp "$FEED" "$HOST:$REMOTE_DIR/minimadesk.json"
curl -fsSL https://eurobuddha.com/pandaapps/minimadesk.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('live feed:', d['version'], d['platforms']['mac-arm64']['file'])"
