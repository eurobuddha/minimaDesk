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
npm start                       # builds the renderer (Vite) then boots the node + opens the shell
npm run dev                     # rebuild-on-change + electron (reload with Cmd+R)
```

## Build installers
```bash
npm run dist:mac    # / dist:win / dist:linux  (electron-builder; runs the renderer build first)
```

## How it is put together
- `main/` — Electron main process: spawns the node (`node-manager.js`), proxies RPC with the secrets
  injected (`main.js`, `rpc.js`), stores hub prefs + custom wallpaper in userData (`prefs.js`).
- `renderer/src/hub/` — a **verbatim fork of the classic MiniHUB 0.24.4** (the "MinimaOS" home screen:
  wallpaper, paged icon grid, folders, right-click menu, status bar, settings, install/update/delete).
  It talks to the node through `mds-shim.ts` (a `window.MDS` over the preload bridge) and opens dapps
  through `shell-bridge.ts`. Only the seams are edited; everything else is the stock source.
- `renderer/src/shell/` — the container around the hub: tab strip with `<webview>` dapp tabs, node chip
  + popover (full Maxima address, Heal Maxima), Terminal, Node logs, the native MiniDapp Store, and the
  pending-permission prompt. Terminal / Node logs / MiniDapp Store also appear as tiles in the hub's
  System folder.
- `renderer/dist/` — Vite output loaded by Electron (gitignored; `npm run build`).

Design language: the hub's own (Core Black `#08090B`, contrasts `#17191C` / `#282B2E`, Manrope).
