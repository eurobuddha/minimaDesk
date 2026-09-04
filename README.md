# minimaDesk — MinimaClassic Desktop

Listed in the stores as **MinimaClassic Desktop** (`desktop/minima-core-apks/apks.json`, DESKTOP group).
Releases: push a `vX.Y.Z` tag and CI builds the mac DMG, Windows installer and Linux AppImage onto a
GitHub Release (see `SPEC.md` §3).

A polished desktop **MiniDapp platform** for Minima — runs a full Minima classic
node and opens installed MDS MiniDapps as **tabs**, in the Minima 2024 brand.
MiniHub, in a party dress.

- **Real node, real MDS, real dapps** — true backwards compatibility. Any standard
  `.mds.zip` installs and runs unmodified.
- **Maxima** rides the node's own base port (the node forwards it) — messaging
  MiniDapps work out of the box.
- **Electron** shell (consistent Chromium everywhere → MiniDapps render the same on
  mac/win/linux).

## Develop
```bash
cd desktop/minimaDesk
./scripts/fetch-jar.sh          # download the full classic minima.jar (has MDS + Maxima)
npm install
npm start                       # builds the renderer (Vite) then boots the node + opens the shell
npm run dev                     # rebuild-on-change + electron (reload with Cmd+R)
```

## Build installers
```bash
npm run dist:mac    # / dist:win / dist:linux  (electron-builder; runs the renderer build first)
```

## Signing + notarization (mac) — a clean, Gatekeeper-approved install
`npm run dist:mac` and the CI build sign and notarize automatically **once the credentials exist**; with
none, they produce the unsigned DMG (right-click → Open). One-time setup, all on the Apple side:

1. **Apple Developer Program** (paid, developer.apple.com) for the Apple ID — Team ID `Z4JD286WF4`. Only
   paid membership can issue the *Developer ID Application* certificate Gatekeeper trusts; the existing
   "Apple Development" certificate on this Mac is for running on your own devices only.
2. **Certificate**: Xcode → Settings → Accounts → (team) → Manage Certificates → + → *Developer ID
   Application*. It lands in the login keychain; `security find-identity -v -p codesigning` lists it.
   electron-builder discovers it by itself — nothing to configure.
3. **Notarization credentials**: at appleid.apple.com create an *app-specific password*, then store it once:
   ```bash
   xcrun notarytool store-credentials minimadesk --apple-id <apple id> --team-id Z4JD286WF4 --password <app-specific password>
   ```
4. **Local release build**: `npm run dist:mac:signed` — signs (hardened runtime + `build/entitlements.mac.plist`),
   notarizes through the `minimadesk` keychain profile, staples the ticket, then runs `scripts/verify-mac.sh`
   (codesign strict verify, `spctl` Gatekeeper assessment, `stapler validate`). A DMG that passes opens on
   any Mac with no warning.
5. **CI** (`.github/workflows/desktop-build.yml`): export the certificate from Keychain Access as a `.p12`
   and set the repo secrets `MAC_CERT_P12` (`base64 -i cert.p12 | pbcopy`), `MAC_CERT_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; tag builds then sign, notarize and verify on the runner.

Windows SmartScreen is a separate story (an OV/EV code-signing certificate, or Azure Trusted Signing); the
Linux AppImage needs nothing.

## How it is put together
- `main/` — Electron main process: spawns the node (`node-manager.js`), proxies RPC with the secrets
  injected (`main.js`, `rpc.js`), stores hub prefs + custom wallpaper in userData (`prefs.js`).
- `renderer/src/hub/` — a **verbatim fork of the classic MiniHUB 0.24.4** (the "MinimaOS" home screen:
  wallpaper, paged icon grid, folders, right-click menu, status bar, settings, install/update/delete).
  It talks to the node through `mds-shim.ts` (a `window.MDS` over the preload bridge) and opens dapps
  through `shell-bridge.ts`. Only the seams are edited; everything else is the stock source.
- `renderer/src/shell/` — the container around the hub: tab strip with `<webview>` dapp tabs, node chip
  + popover (full Maxima address, Heal Maxima), Node logs, and the pending-permission prompt. The Store
  and Terminal buttons open the bundled **minimaCore App Store** (PandaDapps) and **Terminal IDE**
  MiniDapps as tabs; both also appear as tiles in the hub's System folder.
- **Settings → Network** — "Contribute to the network" (the node's `-server` role + UPnP/NAT-PMP port
  mapping via `main/portmap.js`, lifted from minimaCore Desktop; reachability is only ever claimed from
  a real incoming peer, with a manual-forward how-to when the router won't play), the Maxima relay to
  attach to (`main/relays.js`), the static-MLS policy (pin the relay / custom / host's directory), and your **permanent `MAX#` address**
  the Parlons way: anchored to the attached relay, resolved through the federated relay MLS mesh.
- **Settings → Startup parameters** — the node's data folder, Minima port and EVERY `minima.jar` startup flag
  (manifest in `main/params.js`, from the bundled jar's `-help`), plus raw extra arguments and the exact command
  line they produce. Validated in main before anything is saved (the jar refuses to boot on an unknown flag);
  secret flags (`-dbpassword`, `-mysqldb`) are stored encrypted and only ever travel in the 0600 conf file.
  Applying restarts the node; a port change relaunches the app. This replaces the old app's hidden
  "Reconfigure node" menu with a permanent, visible Settings entry.
- `resources/dapps/` — the bundled MiniDapps + `manifest.json`. `main/provision.js` installs them on
  first boot, updates them in place when the bundled or PandaDapps-catalog version is newer, and gives
  them write permission. Refresh the bundle with `scripts/sync-bundled-dapps.sh` before a release.
- `renderer/dist/` — Vite output loaded by Electron (gitignored; `npm run build`).

Design language: the hub's own (Core Black `#08090B`, contrasts `#17191C` / `#282B2E`, Manrope).
