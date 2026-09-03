# Graph Report - minimaDesk  (2026-09-03)

## Corpus Check
- 111 files · ~97,448 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 585 nodes · 1060 edges · 26 communities (21 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e03a9f93`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- node-manager.js
- package.json
- Dashboard/index.tsx
- config.js
- devDependencies
- main.js
- ShellContext.tsx
- AppContext.tsx
- MinimaBridge
- compilerOptions
- StatusBar/index.tsx
- provision.js
- minimaDesk
- preload.js
- fetch-jar.sh
- postcss.config.js
- minimaDesk — working rules
- sync-bundled-dapps.sh
- manifest.json
- PortMapper
- AppList/index.tsx
- App.tsx

## God Nodes (most connected - your core abstractions)
1. `appContext` - 36 edges
2. `MinimaBridge` - 25 edges
3. `NodeManager` - 18 edges
4. `compilerOptions` - 17 edges
5. `useShell()` - 15 edges
6. `PortMapper` - 14 edges
7. `AppProvider()` - 14 edges
8. `modalAnimation` - 13 edges
9. `Button()` - 13 edges
10. `provisionBundledDapps()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `PendingPrompt()` --calls--> `useShell()`  [EXTRACTED]
  renderer/src/shell/PendingPrompt.tsx → renderer/src/shell/ShellContext.tsx
- `NodeChip()` --calls--> `useShell()`  [EXTRACTED]
  renderer/src/shell/TitleBar/TitleBar.tsx → renderer/src/shell/ShellContext.tsx
- `Dashboard()` --calls--> `useAppList()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/index.tsx → renderer/src/hub/hooks/useAppList.ts
- `Wallpaper()` --calls--> `filePathOf()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/Settings/Wallpaper/index.tsx → renderer/src/hub/lib/index.ts
- `ConfirmDelete()` --calls--> `uninstallApp()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/DeleteMiniDapp/index.tsx → renderer/src/hub/lib/index.ts

## Import Cycles
- None detected.

## Communities (26 total, 5 thin omitted)

### Community 0 - "node-manager.js"
Cohesion: 0.11
Nodes (19): { app }, config, currentRelay(), { DEFAULT_RELAY, isHostPort }, EventEmitter, fs, NodeManager, path (+11 more)

### Community 2 - "package.json"
Cohesion: 0.04
Nodes (46): author, build, appId, extraResources, files, linux, mac, nsis (+38 more)

### Community 3 - "Dashboard/index.tsx"
Cohesion: 0.07
Nodes (42): drawerAnimation, folderAnimation, modalAnimation, slideAnimation, appContext, checkIfDappMatchesZip(), BadgeNotification(), Blur() (+34 more)

### Community 4 - "config.js"
Cohesion: 0.17
Nodes (18): { app, safeStorage }, basePort(), configPath(), crypto, DEFAULTS, encAvailable(), ensureSecret(), fs (+10 more)

### Community 5 - "devDependencies"
Cohesion: 0.04
Nodes (49): autoprefixer, concurrently, date-fns, electron, electron-builder, embla-carousel-react, embla-carousel-wheel-gestures, jszip (+41 more)

### Community 6 - "main.js"
Cohesion: 0.08
Nodes (28): { app, BrowserWindow, ipcMain, dialog, shell, clipboard }, config, createWindow(), currentWallpaper(), { fetchBuffer }, fs, gotLock, https (+20 more)

### Community 7 - "ShellContext.tsx"
Cohesion: 0.07
Nodes (38): installMdsShim(), setShellHandlers(), AUTO_WRITE, dappUrl(), filehost(), iconUrl(), parseDappUrl(), STORE_DAPP (+30 more)

### Community 8 - "AppContext.tsx"
Cohesion: 0.06
Nodes (42): RFC-1918, AppProvider(), Block(), BlockProps, IProps, Toggle(), IS_MINIMA_BROWSER, useFoldersTheme() (+34 more)

### Community 9 - "MinimaBridge"
Cohesion: 0.06
Nodes (9): KnownRelay, MinimaBridge, MlsPolicy, NodeHealth, NodeSnapshot, PortmapStatus, Ports, RpcReply (+1 more)

### Community 10 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, src, vite/client, compilerOptions, allowJs, allowSyntheticDefaultImports (+15 more)

### Community 11 - "StatusBar/index.tsx"
Cohesion: 0.07
Nodes (18): DashboardActionBar(), MobileSearchItem(), MaximaProfile(), MDSFail(), BlockInfo(), TitleBar(), Status(), BroadcastIcon() (+10 more)

### Community 12 - "provision.js"
Cohesion: 0.17
Nodes (17): fetchBuffer(), { net }, { app }, { compareVersions }, dappsDir(), ensureWrite(), { fetchBuffer }, findInstalled() (+9 more)

### Community 13 - "minimaDesk"
Cohesion: 0.40
Nodes (4): Build installers, Develop, How it is put together, minimaDesk

### Community 21 - "minimaDesk — working rules"
Cohesion: 0.40
Nodes (4): Design language — Minima Website 2024 (Figma), minimaDesk — working rules, Node facts, Versioning guardrail

### Community 24 - "PortMapper"
Cohesion: 0.15
Nodes (12): defaultRoute(), dgram, EventEmitter, { execFile }, isPrivateIp(), RFC-1918, lanIp(), os (+4 more)

### Community 25 - "AppList/index.tsx"
Cohesion: 0.29
Nodes (8): AppFolder(), AppList(), AppList(), excludedFromFolders, systemApps, sortByType(), useAppList(), AppData

### Community 26 - "App.tsx"
Cohesion: 0.19
Nodes (7): Introduction(), Delete(), Install(), Root(), Settings(), SettingsAddConnections(), Update()

## Knowledge Gaps
- **188 isolated node(s):** `Develop`, `Build installers`, `How it is put together`, `{ app, BrowserWindow, ipcMain, dialog, shell, clipboard }`, `path` (+183 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `appContext` connect `Dashboard/index.tsx` to `AppContext.tsx`, `AppList/index.tsx`, `App.tsx`, `StatusBar/index.tsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `Develop`, `Build installers`, `How it is put together` to the rest of the system?**
  _188 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `node-manager.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10931174089068826 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `Dashboard/index.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06680080482897384 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._