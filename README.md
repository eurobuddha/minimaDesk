# minimaDesk — MinimaClassic Desktop

Listed in the stores as **MinimaClassic Desktop** (`desktop/minima-core-apks/apks.json`, DESKTOP group).
Releases: push a `vX.Y.Z` tag and CI builds the mac DMG, Windows installer and Linux AppImage onto a
GitHub Release (see `SPEC.md` §3).

A polished desktop **MiniDapp platform** for Minima — runs a full Minima node
and opens installed MDS MiniDapps as **tabs**, in the Minima 2024 brand.
MiniHub, in a party dress.

Since 0.7.15 the node is the **Parlons Node** by default (`parlons-node.jar` from
[eurobuddha/maxima](https://github.com/eurobuddha/maxima), pinned in `package.json` `parlonsNode`): a
full Minima node with the MiniDapp System served by the node itself (loopback only, the MiniHUB and any
`.mds.zip` exactly as before), plus **your Parlons account** — private chat, calls and payments under this
node's seed, phones and computers paired to it — in its own **Parlons tab**, and a Maxima relay for others
when you contribute (one public port). The **classic** official `minima.jar` (MDS + classic Maxima) stays
as the second kind. An install from before 0.7.15 keeps the classic jar until it switches.

**Two kinds = two nodes.** The classic node lives in `<data>/1.0`, the Parlons Node in `<data>/1.1`; they
cannot share a folder (their H2 database formats are mutually unreadable). Switching in Settings → minimaDesk
is therefore an explicit choice (0.7.22): **Carry my wallet over** (the default) reads your seed phrase and
key-use counters from the running classic node, pins the Parlons identity to that phrase, restores the
phrase into the Parlons Node with `megammrsync … keyuses:N` from a fleet MegaMMR node, and verifies the
64 keys and counters before saying so — same balance, same addresses, a new seed-derived Maxima identity;
or **Start a brand-new node** (own seed, empty wallet, back it up). An existing Parlons node is set aside
(renamed, never deleted) or kept. Afterwards you tick which classic **Maxima contacts** and which classic
**MiniDapps** to import — nothing is imported on its own, and a dapp's own data does not come along.

**Key uses, both ways (0.7.23).** A Minima key is a one-time-signature chain: its `uses` counter says how
many slots are spent, and signing below the true counter re-uses a slot. Once both nodes hold the same
wallet, every switch reads the node being left (highest per-key use = m) and, when m is higher than the
value recorded for that node at the previous switch (signing happened there), sets every key of the node
being started to **m + 1** (one spare slot for a signature that may have been in flight). No signing since
the last switch means no change, so counters never creep. The Parlons Node is raised with `keys
action:createallkeys keyuses:N`; the classic node with its own `megammrsync … keyuses:N` (the only
counter-setting command the classic jar has). Until a needed raise has succeeded, Settings → minimaDesk
names the node that must not sign, in red, with a Retry.

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
npm run fetch:parlons           # download parlons-node.jar (the version pinned in package.json, sha256-verified)
npm install
npm start                       # builds the renderer (Vite) then boots the node + opens the shell
npm run dev                     # rebuild-on-change + electron (reload with Cmd+R)
```

## Build installers
```bash
npm run dist:mac    # / dist:win / dist:linux  (electron-builder; runs the renderer build first)
```
The bundled JRE must include `jdk.httpserver` (the Parlons Node's admin RPC, panel and gateway are
`com.sun.net.httpserver`): `jlink --add-modules java.se,jdk.unsupported,jdk.httpserver …` — CI does this;
locally, re-jlink `resources/jre` the same way.

## Release — all three platforms, every time
```bash
npm run dist:mac:signed                                   # signed + notarized + verified DMG
scripts/release-desktop.sh 0.7.19 "what changed"          # tag → CI (mac/win/linux) → signed DMG over CI's →
                                                          # feed rows for all three → catalog rows; exits 1 otherwise
```
The app checks `https://eurobuddha.com/pandaapps/minimadesk.json` for its own updates (Settings → minimaDesk →
Updates; a title-bar pill when one exists). A download is verified against the feed's sha256 and saved to
Downloads — nothing installs by itself.

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
- `main/` — Electron main process: spawns the node (`node-manager.js`: the Parlons Node with every knob as a
  `-D` property and Minima's own flags inside one quoted `-Dparlons.node.args`, or the classic jar), proxies
  RPC with the secrets injected (`main.js`, `rpc.js`), the Parlons account's status + one-time panel link
  (`parlons.js`), the update feed (`updater.js`), hub prefs + custom wallpaper in userData (`prefs.js`).
- **The Parlons tab** (Parlons Node only) — the account's own web panel, served on `127.0.0.1:<port+586>`,
  in one hardened `<webview partition=persist:parlons>` signed in with the one-time ticket the account keeps
  beside its data. Its Devices page pairs your phones (the code), its Node page shows what to port-forward.
  `will-attach-webview` allows exactly two origins: the node's MDS port and that panel.
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
