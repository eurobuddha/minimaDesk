#!/usr/bin/env bash
# Fetch the full official Minima classic jar (has MDS + Maxima) into resources/.
# minimaDesk runs THIS jar — never the stripped minima-core build.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p resources
URL="https://github.com/minima-global/Minima/raw/master/jar/minima.jar"
echo "fetching $URL"
curl -fSL -o resources/minima.jar "$URL"
echo "verifying it has MDS + Maxima…"
MX=$(unzip -l resources/minima.jar | grep -c 'system/network/maxima/' || true)
MDS=$(unzip -l resources/minima.jar | grep -c 'system/mds/' || true)
echo "maxima classes=$MX  mds classes=$MDS"
[ "$MX" -gt 0 ] && [ "$MDS" -gt 0 ] && echo "OK — full classic jar" || { echo "WRONG JAR (missing MDS/Maxima)"; exit 1; }
