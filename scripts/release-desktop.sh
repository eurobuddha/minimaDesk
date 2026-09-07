#!/usr/bin/env bash
# THE release command for minimaDesk (MinimaClassic Desktop) - all three platforms, every time (family rule):
#   1. the signed+notarized Mac DMG must exist (npm run dist:mac:signed)
#   2. tag v<ver> and push it: CI builds mac (unsigned), win (NSIS x64) and linux (AppImage x64)
#   3. wait for that CI run, refuse to go on if win or linux failed
#   4. upload the LOCAL signed DMG over CI's unsigned one and write the mac feed row
#   5. add the win-x64 and linux-x64 feed rows from the release assets
#   6. the feed must list all three platforms, or this script exits 1 and says so
#   7. the three MinimaClassic Desktop rows of the PandaApps catalog (../minima-core-apks) follow the release
# Usage: scripts/release-desktop.sh <ver> ["release notes"]
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${1:?version, e.g. 0.7.19}"; NOTES="${2:-minimaDesk $VER}"
REPO="eurobuddha/minimaDesk"
DMG="dist/minimaDesk-$VER-arm64.dmg"
[ -f "$DMG" ] || { echo "no $DMG - build it first: npm run dist:mac:signed"; exit 1; }
xcrun stapler validate "$DMG" > /dev/null || { echo "$DMG is not notarized+stapled - refusing"; exit 1; }
[ "$(node -p "require('./package.json').version")" = "$VER" ] || { echo "package.json is not $VER"; exit 1; }
[ -z "$(git status --porcelain -- package.json main renderer/src scripts README.md .github)" ] || { echo "uncommitted changes - commit first"; exit 1; }
echo "== tag v$VER"
if ! git rev-parse "v$VER" > /dev/null 2>&1; then git tag "v$VER"; fi
git push -q origin "v$VER" 2>&1 | grep -v "^WARNING" || true
echo "== waiting for CI (Build desktop: mac / win / linux)"
RUN=""
for i in $(seq 1 30); do
  RUN="$(gh run list -R "$REPO" --workflow desktop-build.yml --branch "v$VER" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  [ -n "$RUN" ] && break; sleep 10
done
[ -n "$RUN" ] || { echo "CI run for v$VER did not appear"; exit 1; }
gh run watch "$RUN" -R "$REPO" --exit-status > /dev/null 2>&1 || {
  echo "CI run $RUN did not succeed on every platform:"; gh run view "$RUN" -R "$REPO" --json jobs --jq '.jobs[] | "  \(.name): \(.conclusion)"'; exit 1; }
gh run view "$RUN" -R "$REPO" --json jobs --jq '.jobs[] | "  \(.name): \(.conclusion)"'
echo "== mac (signed DMG over CI's) + feed row"
scripts/publish-desktop.sh "$VER" "$NOTES"
echo "== win + linux feed rows"
scripts/publish-desktop-platforms.sh "$VER"
echo "== verdict"
curl -fsSL https://eurobuddha.com/pandaapps/minimadesk.json | python3 -c "
import sys, json
d = json.load(sys.stdin); p = d.get('platforms', {}); need = ['mac-arm64', 'win-x64', 'linux-x64']
missing = [k for k in need if k not in p or d['version'] not in p[k]['file']]
print('feed', d['version'], 'platforms', sorted(p.keys()))
if missing: print('INCOMPLETE RELEASE - missing', missing); sys.exit(1)
print('ALL THREE PLATFORMS PUBLISHED')"
STORE="$(cd .. && pwd)/minima-core-apks"
if [ -d "$STORE" ]; then
  echo "== PandaApps catalog rows (MinimaClassic Desktop mac / win / linux)"
  ( cd "$STORE" && for pkg in com.eurobuddha.minimaclassic.mac com.eurobuddha.minimaclassic.win com.eurobuddha.minimaclassic.linux; do
      python3 scripts/publish-app.py "$pkg" "$VER"; done
    git commit -qam "MinimaClassic Desktop $VER" && git push -q origin HEAD && echo "catalog rows pushed" )
else
  echo "!! $STORE not found - update the three MinimaClassic Desktop rows by hand (scripts/publish-app.py)"
fi
