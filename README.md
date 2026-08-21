# minimaDesk

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
npm start                       # boots the node + opens the shell
```

## Build installers
```bash
npm run dist:mac    # / dist:win / dist:linux  (electron-builder)
```

## Status
- **Phase 0 (done):** scaffold + boot the classic node with MDS + Maxima; verified
  `mds action:list` (32 default dapps) and `maxima action:info` (live Mx address).
- **Phase 1 (next):** the tabbed hub — launcher grid, install `.mds.zip`, open dapps
  as tabs, node-status chrome, in the Minima 2024 design (`design/hub-mockup.html`).
- **Phase 2 (optional):** reliable Maxima (store-and-forward for offline peers) as a
  drop-in enhanced-jar swap.

Design language: `../../support/minima-mediakit/Minima_Website_2024_design_tokens.md`.
