# Graph Report - minimaDesk  (2026-09-02)

## Corpus Check
- 105 files · ~90,856 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 508 nodes · 940 edges · 21 communities (18 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `68b4d3e7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- NodeManager
- Settings/index.tsx
- package.json
- AppContext.tsx
- config.js
- devDependencies
- main.js
- ShellContext.tsx
- lib/index.ts
- MinimaBridge
- compilerOptions
- MaximaProfile/index.tsx
- minimaDesk
- preload.js
- fetch-jar.sh
- postcss.config.js

## God Nodes (most connected - your core abstractions)
1. `appContext` - 35 edges
2. `MinimaBridge` - 22 edges
3. `compilerOptions` - 17 edges
4. `NodeManager` - 15 edges
5. `useShell()` - 15 edges
6. `AppProvider()` - 14 edges
7. `Button()` - 14 edges
8. `modalAnimation` - 13 edges
9. `build` - 9 edges
10. `SlideScreen()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `AppProvider()` --calls--> `peers()`  [EXTRACTED]
  renderer/src/hub/AppContext.tsx → renderer/src/hub/lib/index.ts
- `Wallpaper()` --calls--> `filePathOf()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/Settings/Wallpaper/index.tsx → renderer/src/hub/lib/index.ts
- `AddConnections()` --calls--> `addPeers()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/Settings/AddConnections/index.tsx → renderer/src/hub/lib/index.ts
- `Folders()` --calls--> `get()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/Settings/Folders/index.tsx → renderer/src/hub/lib/index.ts
- `NodeChip()` --calls--> `useShell()`  [EXTRACTED]
  renderer/src/shell/TitleBar/TitleBar.tsx → renderer/src/shell/ShellContext.tsx

## Import Cycles
- None detected.

## Communities (21 total, 3 thin omitted)

### Community 0 - "NodeManager"
Cohesion: 0.12
Nodes (14): { app }, config, EventEmitter, fs, MAXIMA_RELAYS, NodeManager, path, { rpcCall } (+6 more)

### Community 1 - "Settings/index.tsx"
Cohesion: 0.06
Nodes (47): drawerAnimation, folderAnimation, modalAnimation, slideAnimation, Confirm(), Block(), BlockProps, Button() (+39 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (43): author, build, appId, extraResources, files, linux, mac, nsis (+35 more)

### Community 3 - "AppContext.tsx"
Cohesion: 0.07
Nodes (38): appContext, AppFolder(), AppList(), AppList(), BadgeNotification(), Blur(), DashboardActionBar(), MobileSearchItem() (+30 more)

### Community 4 - "config.js"
Cohesion: 0.17
Nodes (18): { app, safeStorage }, basePort(), configPath(), crypto, DEFAULTS, encAvailable(), ensureSecret(), fs (+10 more)

### Community 5 - "devDependencies"
Cohesion: 0.04
Nodes (49): autoprefixer, concurrently, date-fns, electron, electron-builder, embla-carousel-react, embla-carousel-wheel-gestures, jszip (+41 more)

### Community 6 - "main.js"
Cohesion: 0.08
Nodes (26): { app, BrowserWindow, ipcMain, dialog, shell, net }, config, createWindow(), currentWallpaper(), fs, gotLock, https, iconCache (+18 more)

### Community 7 - "ShellContext.tsx"
Cohesion: 0.06
Nodes (45): App(), installMdsShim(), setShellHandlers(), dappUrl(), filehost(), iconUrl(), parseDappUrl(), STORE_WRITE_ALLOW (+37 more)

### Community 8 - "lib/index.ts"
Cohesion: 0.13
Nodes (26): AppProvider(), checkIfDappMatchesZip(), useFoldersTheme(), useWallpaper(), addPeers(), block(), filePathOf(), get() (+18 more)

### Community 9 - "MinimaBridge"
Cohesion: 0.07
Nodes (6): MinimaBridge, NodeHealth, NodeSnapshot, Ports, RpcReply, Window

### Community 10 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, src, vite/client, compilerOptions, allowJs, allowSyntheticDefaultImports (+15 more)

### Community 12 - "MaximaProfile/index.tsx"
Cohesion: 0.39
Nodes (4): MaximaProfile(), CopyIcon(), CopySuccessIcon(), copyToClipboard()

### Community 13 - "minimaDesk"
Cohesion: 0.40
Nodes (4): Build installers, Develop, How it is put together, minimaDesk

## Knowledge Gaps
- **160 isolated node(s):** `Develop`, `Build installers`, `How it is put together`, `{ app, BrowserWindow, ipcMain, dialog, shell, net }`, `path` (+155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `appContext` connect `AppContext.tsx` to `lib/index.ts`, `Settings/index.tsx`, `MaximaProfile/index.tsx`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `Develop`, `Build installers`, `How it is put together` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `NodeManager` be split into smaller, more focused modules?**
  _Cohesion score 0.12183908045977011 - nodes in this community are weakly interconnected._
- **Should `Settings/index.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0593607305936073 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._
- **Should `AppContext.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06921529175050302 - nodes in this community are weakly interconnected._