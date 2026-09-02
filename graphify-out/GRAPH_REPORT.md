# Graph Report - minimaDesk  (2026-09-02)

## Corpus Check
- 108 files · ~91,253 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 530 nodes · 964 edges · 24 communities (19 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `53e231dc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- node-manager.js
- Settings/index.tsx
- package.json
- Dashboard/index.tsx
- config.js
- devDependencies
- main.js
- ShellContext.tsx
- AppContext.tsx
- MinimaBridge
- compilerOptions
- MaximaProfile/index.tsx
- provision.js
- minimaDesk
- preload.js
- fetch-jar.sh
- postcss.config.js
- minimaDesk — working rules
- sync-bundled-dapps.sh
- manifest.json

## God Nodes (most connected - your core abstractions)
1. `appContext` - 35 edges
2. `MinimaBridge` - 20 edges
3. `compilerOptions` - 17 edges
4. `NodeManager` - 15 edges
5. `useShell()` - 15 edges
6. `AppProvider()` - 14 edges
7. `Button()` - 14 edges
8. `modalAnimation` - 13 edges
9. `provisionBundledDapps()` - 12 edges
10. `build` - 9 edges

## Surprising Connections (you probably didn't know these)
- `PendingPrompt()` --calls--> `useShell()`  [EXTRACTED]
  renderer/src/shell/PendingPrompt.tsx → renderer/src/shell/ShellContext.tsx
- `NodeChip()` --calls--> `useShell()`  [EXTRACTED]
  renderer/src/shell/TitleBar/TitleBar.tsx → renderer/src/shell/ShellContext.tsx
- `TitleBar()` --calls--> `dAppLink()`  [EXTRACTED]
  renderer/src/hub/components/StatusBar/index.tsx → renderer/src/hub/lib/index.ts
- `Wallpaper()` --calls--> `filePathOf()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/Settings/Wallpaper/index.tsx → renderer/src/hub/lib/index.ts
- `Settings()` --calls--> `peers()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/Settings/index.tsx → renderer/src/hub/lib/index.ts

## Import Cycles
- None detected.

## Communities (24 total, 5 thin omitted)

### Community 0 - "node-manager.js"
Cohesion: 0.12
Nodes (15): { app }, config, EventEmitter, fs, MAXIMA_RELAYS, NodeManager, path, { provisionBundledDapps } (+7 more)

### Community 1 - "Settings/index.tsx"
Cohesion: 0.06
Nodes (44): drawerAnimation, folderAnimation, modalAnimation, slideAnimation, Block(), BlockProps, Button(), ButtonProps (+36 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (43): author, build, appId, extraResources, files, linux, mac, nsis (+35 more)

### Community 3 - "Dashboard/index.tsx"
Cohesion: 0.07
Nodes (31): appContext, AppFolder(), AppList(), AppList(), BadgeNotification(), Blur(), Confirm(), Introduction() (+23 more)

### Community 4 - "config.js"
Cohesion: 0.17
Nodes (18): { app, safeStorage }, basePort(), configPath(), crypto, DEFAULTS, encAvailable(), ensureSecret(), fs (+10 more)

### Community 5 - "devDependencies"
Cohesion: 0.04
Nodes (49): autoprefixer, concurrently, date-fns, electron, electron-builder, embla-carousel-react, embla-carousel-wheel-gestures, jszip (+41 more)

### Community 6 - "main.js"
Cohesion: 0.08
Nodes (27): { app, BrowserWindow, ipcMain, dialog, shell }, config, createWindow(), currentWallpaper(), { fetchBuffer }, fs, gotLock, https (+19 more)

### Community 7 - "ShellContext.tsx"
Cohesion: 0.07
Nodes (38): installMdsShim(), setShellHandlers(), AUTO_WRITE, dappUrl(), filehost(), iconUrl(), parseDappUrl(), STORE_DAPP (+30 more)

### Community 8 - "AppContext.tsx"
Cohesion: 0.12
Nodes (28): AppProvider(), checkIfDappMatchesZip(), useFoldersTheme(), useWallpaper(), addPeers(), block(), filePathOf(), get() (+20 more)

### Community 9 - "MinimaBridge"
Cohesion: 0.08
Nodes (6): MinimaBridge, NodeHealth, NodeSnapshot, Ports, RpcReply, Window

### Community 10 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, src, vite/client, compilerOptions, allowJs, allowSyntheticDefaultImports (+15 more)

### Community 11 - "MaximaProfile/index.tsx"
Cohesion: 0.09
Nodes (12): DashboardActionBar(), MobileSearchItem(), MaximaProfile(), CopyIcon(), CopySuccessIcon(), dAppLink(), Handlers, NativeView (+4 more)

### Community 12 - "provision.js"
Cohesion: 0.17
Nodes (17): fetchBuffer(), { net }, { app }, { compareVersions }, dappsDir(), ensureWrite(), { fetchBuffer }, findInstalled() (+9 more)

### Community 13 - "minimaDesk"
Cohesion: 0.40
Nodes (4): Build installers, Develop, How it is put together, minimaDesk

### Community 21 - "minimaDesk — working rules"
Cohesion: 0.40
Nodes (4): Design language — Minima Website 2024 (Figma), minimaDesk — working rules, Node facts, Versioning guardrail

## Knowledge Gaps
- **173 isolated node(s):** `Node facts`, `Design language — Minima Website 2024 (Figma)`, `Versioning guardrail`, `Develop`, `Build installers` (+168 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `appContext` connect `Dashboard/index.tsx` to `AppContext.tsx`, `Settings/index.tsx`, `MaximaProfile/index.tsx`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `Node facts`, `Design language — Minima Website 2024 (Figma)`, `Versioning guardrail` to the rest of the system?**
  _173 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `node-manager.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11827956989247312 - nodes in this community are weakly interconnected._
- **Should `Settings/index.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.062111801242236024 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._
- **Should `Dashboard/index.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._