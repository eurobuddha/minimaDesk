# MinimaClassic Desktop (minimaDesk) — Specification

**An Electron desktop platform that runs the full official Minima classic node (MDS + Maxima) and puts
the classic MiniHUB home screen in front of it, with MiniDapps opening as tabs — "MiniHub in a party
dress", with true backwards compatibility: real node, real MDS, real dapps, unmodified.**

- Store name: **MinimaClassic Desktop** · App/product name: `minimaDesk` · appId `com.eurobuddha.minimadesk`
- Repo: `desktop/minimaDesk` · remote `github.com/eurobuddha/minimaDesk` · catalog rows in
  `desktop/minima-core-apks/apks.json` (`com.eurobuddha.minimaclassic.mac|win|linux`, category Desktop)
- Runtime: Electron 33 (Chromium 130) + a jlinked Temurin 21 JRE per platform; node = the official
  `minima-global/Minima` classic jar (gitignored; `scripts/fetch-jar.sh` verifies MDS + Maxima)
- Renderer: React 18 + Vite 5 + Tailwind 3, built to `renderer/dist`, loaded over `file://`
- Ports: base **20001** (P2P + Maxima), MDS base+2, RPC base+4 — coexists with 9001 / 11001 / 12001 / 16001 nodes
- Versioning: **patch bump on every code change** (0.7.0 → 0.7.1 → …); one change = one version = one
  commit = one push; a `vX.Y.Z` tag triggers the mac/win/linux build and the GitHub Release

**Status (2026-09-03):** 0.7.6 shipped. Home screen, bundled dapps, Settings → Network, permanent
MAX# address, boot-time verified updates, and the code-review hardening are all live and verified in
an isolated instance. Windows/Linux builds come from CI (`.github/workflows/desktop-build.yml`).

---

## 1. Architecture (fixed — verified in the build)

```
Electron main (main/*.js)  ──IPC (preload: window.minima)──▶  renderer/dist (one React app)
  node-manager.js  spawn the classic jar, health poll, provisioning, Maxima wiring, portmap
  provision.js     bundled dapps: install / update in place / catalog check (sha256-verified)
  portmap.js       UPnP / NAT-PMP (lifted verbatim from minimaCore Desktop)
  main.js          IPC surface, window.open policy, icon proxy, prefs, wallpaper, RPC credentials
                                                  │
  <Shell>  renderer/src/shell/**                  ▼
    TitleBar: tabs · [+] · Store · Terminal · Logs · NodeChip ▾ (popover)
    Stage: .stage-home = <HubApp/> (verbatim MiniHUB 0.24.4 fork, renderer/src/hub/**)
           .stage-webviews = one <webview partition=persist:mds> per open dapp
           Node logs view
    PendingPrompt · ShellNotice
```

- **The hub is the classic MiniHUB 0.24.4 source**, taken from the zip inside the jar. Only the seams
  are edited: `window.MDS` is a shim over the preload bridge (`hub/mds-shim.ts`), dapps open through
  `hub/shell-bridge.ts` into tabs, files install from their native path, keypair → `prefs:*` IPC,
  wallpaper → userData. Everything else is stock, so the hub looks and behaves as users know it.
- **Secrets never reach the renderer.** RPC/MDS passwords are generated once, stored encrypted
  (safeStorage, 0600), written to a 0600 `-conf` file per start (never on argv), injected in main.
  `rpc:cmd` scrubs `password` from every `mds` reply (arrays included). `rpc:copyPassword` puts the
  RPC password on the clipboard from main without displaying it.
- **Web content policy.** `window.open` from the hub or any dapp: MDS URLs become tabs, `http(s)`
  goes to the OS browser, nothing else. `file:` is never opened from web content. `will-attach-webview`
  strips preload/node integration. The self-signed MDS cert is trusted for one loopback host:port only.
- **Dapps run untouched.** Any standard `.mds.zip` installs and runs; Maxima rides the node's own port.

## 2. Features (shipped — verified)

1. **Classic home screen**: wallpaper, paged icon grid, folders, right-click tile menu, status bar,
   action bar, settings sheet, install/update/delete, intro tour. Tiles open dapps as tabs.
2. **Bundled dapps, provisioned at boot** (`resources/dapps/manifest.json`): minimaCore App Store
   (PandaDapps) and Terminal IDE, both with write. Missing → install; bundled newer → update in place
   (uid kept); PandaDapps catalog newer → download, **sha256 verified** against the catalog, update in
   place. The Store and Terminal buttons/tiles open these real dapps.
3. **Node chip + popover**: state, block, peers, Maxima, role, inbound, ports, uptime, versions, the
   full Maxima contact address with Copy, Heal Maxima.
4. **Settings → Network** (mirrors minimaCore Desktop + Parlons):
   - *Contribute to the network*: `-server` role + router port mapping; reachability is claimed only
     from a real incoming peer; manual-forward how-to with the user's own LAN IP, gateway, router model.
   - *Permanent address · MAX#*: `MAX#<publickey>#<relay identity>`, anchored to the attached relay
     (the relays run a federated MLS mesh) — the Parlons method, no registration.
   - *Location service*: pin the attached relay / custom `Mx…@host:port` / host's directory.
   - *Hosts*: the relay fleet; exactly ONE relay attached (several double-deliver Maxima).
   - Fix-ups: Heal Maxima, "My IP changed" (`network action:recalculateip`).
5. **Settings → minimaDesk**: versions, ports, Heal, Copy RPC password, Restart node.
6. **Pending prompt** over any tab for read-mode dapps issuing writes; Node logs view.

## 3. Release (the standing rhythm)

1. `scripts/sync-bundled-dapps.sh` (refresh the bundled dapps), bump `version`, commit, push.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` → CI builds `minimaDesk-X.Y.Z-arm64.dmg`,
   `minimaDesk.Setup.X.Y.Z.exe`, `minimaDesk-X.Y.Z.AppImage` and attaches them to the Release.
3. Update the three catalog rows in `desktop/minima-core-apks/apks.json` (`version`, `versionCode` =
   major·10000 + minor·100 + patch, `file` → the release assets), commit, push (pre-push runs `check.py`).
4. Local `npm run dist:mac` remains the quick path for installing over the top on this Mac.

## 4. Verification (per change)

- `npm run build` + `npm run typecheck` clean; `node --check` on touched `main/*.js`.
- Isolated dev instance (never the installed app): `MDESK_USERDATA=<dir>` with `config.json`
  `{ "basePort": 21001 }`, `MDESK_NODELOG`, `MDESK_SEQ` (JS steps), `MDESK_SHOTS`, `MDESK_EXIT_MS`,
  `MDESK_NO_CATALOG=1`. Standard checks: boot → grid; open a dapp tab; provisioning log lines;
  `status;mds` has no password; restart leaves state `running`; Network sheet renders.
- No permanent registration is left anywhere by tests; relay/MLS tests use the open-pool relays.

## 5. Not yet done / candidates

- Code signing / notarisation (mac) and a signed Windows installer — currently unsigned like the
  sibling app; store copy tells users how to get past the warnings.
- A distinct Linux build with `.deb` in addition to AppImage.
- The hub's Joyride tour copy still references some Android-only flows.
- `resources/jre` is produced by CI per platform; a local `dist:win` / `dist:linux` would embed the
  macOS JRE and fall back to system Java — use the CI artifacts for those platforms.

## 6. Explicitly out of scope

- Modifying the node jar (always the official classic build), or the MiniDapps themselves.
- A light/stripped node (the old `minimacore-desktop` approach) — this app runs the full node.
- Running a Maxima relay server inside the app (the relays are the ops fleet).
