# minimaDesk — working rules

**What this is.** A polished Electron desktop platform: it runs a **full Minima
node** and opens installed MDS MiniDapps as **tabs**, in the Minima 2024 brand.
"MiniHub in a party dress." True backwards compatibility (real node, real MDS,
real dapps). Since 0.7.15 the node is the **Parlons Node** by default
(`resources/parlons-node.jar`, gitignored; `npm run fetch:parlons`, version pinned in
`package.json` `parlonsNode`): MDS served by the node itself (fork re-import, loopback
only) + the Parlons account in the Parlons tab + a Maxima relay when contributing. The
**classic** official jar (`resources/minima.jar`, MDS + classic Maxima) stays as the
second kind (Settings → minimaDesk). Template for every Parlons-side decision:
`desktop/minimacore-desktop` (do not redesign what it settled; port it).

**Not the old app's dapp layer.** `desktop/minimacore-desktop` has no MDS layer and
bespoke per-dapp code; minimaDesk runs real MDS (served by the Parlons Node since the
fork re-imported it, or by the classic jar). Reuse minimaCore's node/Parlons patterns
(node-manager, parlons.js, updater, release script) — never its per-dapp code.

## Node facts
- Base port default **20001** (coexists with 9001/11001/12001/16001 nodes). MDS =
  base+2, RPC = base+4; Parlons kind: gateway = base+584, panel = base+586, relay = base (shared).
- TWO NODE FOLDERS: classic `<data>/1.0`, Parlons `<data>/1.1` - never shared (H2 formats differ; the fork
  wipes archive/txpow on a format clash). classic → Parlons is an EXPLICIT choice in Settings (carry the
  wallet = phrase + key uses via megammrsync from a fleet MegaMMR node, identity.txt pinned first; or fresh);
  never switch a user's node silently. The Pi 31.125.188.214 has NO MegaMMR (resync fails there).
- KEY USES BOTH WAYS (0.7.23, fund-critical): a switch reads the node being left; if its highest per-key
  use m rose since the ledger (`config.keyUses`), the node being started gets every key set to m + 1
  (fork: `keys action:createallkeys`; classic: its own `megammrsync … keyuses:`). Never lower a counter.
  `keyUsesPending` = that node must not sign until the raise succeeds (red warning + Retry in Settings).
- Parlons kind: the conf file carries `mdspassword` only (the node REFUSES rpcpassword/dbpassword:
  its admin RPC is loopback-only, unauthenticated); the bundled JRE MUST jlink `jdk.httpserver`.
- NEVER run a gate/dev node on a copy of the owner's live data - fresh identity in a scratch dir
  (`MDESK_USERDATA=<dir>` with its own config.json + dataFolder); kill scratch nodes; check for orphans.
- Secrets (RPC password, MDS password) are generated once and stored encrypted
  0600 in userData — the renderer never sees them; it talks through the IPC proxy.
- Management (list/install/uninstall/permission) is RPC (`mds action:…`); dapp UIs
  render from the node's HTTPS MDS port (self-signed cert trusted for that one
  loopback host:port only).
- The jar is NOT committed (69M) — run `scripts/fetch-jar.sh` (verifies it has
  MDS + Maxima before accepting it).
- Bundled MiniDapps (minimaCore App Store, Terminal IDE) live in `resources/dapps/` (committed) and
  are provisioned at boot by `main/provision.js`; refresh them with `scripts/sync-bundled-dapps.sh`
  before a release.

## Design language — Minima Website 2024 (Figma)
Source of truth: `support/minima-mediakit/Minima_Website_2024_design_tokens.md` +
`Minima_Brand_Guidelines_2023.md`. Ground **Core Black #08090B**; surfaces
**#17191C / #282B2E**; body **Grey-60 #BDBDC4** + white; accents RATIONED —
**Core Orange #FF512F** (identity) and **Core Blue #317AFF** (links/selection)
only, never fields of colour. **Manrope** on the 2024 type scale; mono for machine
values. Full identifiers always (RULE 1) — never truncate an Mx address / txid.

## Releasing - ALL THREE platforms, every release (hard rule, as minimaCore Desktop)
`npm run dist:mac:signed` then `scripts/release-desktop.sh X.Y.Z "notes"`: tags, waits for the CI matrix
(mac/win/linux; each runner jlinks its own JRE with jdk.httpserver, fetches both jars, builds the renderer),
uploads the signed DMG over CI's, writes the three rows of the update feed
(`https://eurobuddha.com/pandaapps/minimadesk.json`) and the three **MinimaClassic Desktop** catalog rows,
and exits 1 unless mac-arm64 + win-x64 + linux-x64 are live. Never `publish-desktop.sh` alone as "the release".
Product spec: `SPEC.md`.

## Versioning guardrail
Every code change ships with a **version bump** (`version` in package.json). One
logical change = one version = one commit = one push, in order. Docs/config-only
commits need no bump.

## Signed mac releases (since 0.7.12, 2026-09-04)
The Developer ID certificate + notary profile `minimadesk` exist on this Mac. The mac DMG for any release is
`npm run dist:mac:signed` (signs, notarizes, staples, then `scripts/verify-mac.sh` must print ALL OK) — never
`dist:mac` for something that ships. CI's mac DMG is unsigned until the `MAC_CERT_P12`/`APPLE_*` secrets
exist: upload the local signed DMG over it (`gh release upload vX.Y.Z dist/minimaDesk-X.Y.Z-arm64.dmg --clobber`)
before updating the store rows. Family rule: `../../CLAUDE.md` "Desktop builds are SIGNED".
