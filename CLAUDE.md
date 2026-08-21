# minimaDesk — working rules

**What this is.** A polished Electron desktop platform: it runs a **full Minima
classic node** (`resources/minima.jar` — the official `minima-global` jar, WITH
MDS + Maxima) and opens installed MDS MiniDapps as **tabs**, in the Minima 2024
brand. "MiniHub in a party dress." True backwards compatibility (real node, real
MDS, real dapps). Maxima rides the node's own base port; the node forwards it.

**NOT the old app.** `desktop/minimacore-desktop` is frozen. Its bundled jar was a
*stripped* `minima-core` fork (no MDS, no Maxima) — the wrong base — which is why
it hardcoded JS dapp ports. minimaDesk deliberately runs the FULL classic jar with
`-mdsenable`. Reuse the old app's *patterns* (node spawn, RPC client) — never its
stripped jar or its bespoke per-dapp code.

## Node facts
- Base port default **20001** (coexists with 9001/11001/12001/16001 nodes). MDS =
  base+2, RPC = base+4.
- Secrets (RPC password, MDS password) are generated once and stored encrypted
  0600 in userData — the renderer never sees them; it talks through the IPC proxy.
- Management (list/install/uninstall/permission) is RPC (`mds action:…`); dapp UIs
  render from the node's HTTPS MDS port (self-signed cert trusted for that one
  loopback host:port only).
- The jar is NOT committed (69M) — run `scripts/fetch-jar.sh` (verifies it has
  MDS + Maxima before accepting it).

## Design language — Minima Website 2024 (Figma)
Source of truth: `support/minima-mediakit/Minima_Website_2024_design_tokens.md` +
`Minima_Brand_Guidelines_2023.md`. Ground **Core Black #08090B**; surfaces
**#17191C / #282B2E**; body **Grey-60 #BDBDC4** + white; accents RATIONED —
**Core Orange #FF512F** (identity) and **Core Blue #317AFF** (links/selection)
only, never fields of colour. **Manrope** on the 2024 type scale; mono for machine
values. Full identifiers always (RULE 1) — never truncate an Mx address / txid.

## Versioning guardrail
Every code change ships with a **version bump** (`version` in package.json). One
logical change = one version = one commit = one push, in order. Docs/config-only
commits need no bump.
