# Graph Report - minimaDesk  (2026-09-03)

## Corpus Check
- 112 files · ~100,235 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 606 nodes · 1094 edges · 27 communities (22 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fe94fb9b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- node-manager.js
- Network/index.tsx
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
3. `NodeManager` - 22 edges
4. `compilerOptions` - 17 edges
5. `AppProvider()` - 14 edges
6. `useShell()` - 14 edges
7. `PortMapper` - 14 edges
8. `modalAnimation` - 13 edges
9. `provisionBundledDapps()` - 12 edges
10. `Button()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `AppProvider()` --calls--> `peers()`  [EXTRACTED]
  renderer/src/hub/AppContext.tsx → renderer/src/hub/lib/index.ts
- `AppProvider()` --calls--> `uninstallApp()`  [EXTRACTED]
  renderer/src/hub/AppContext.tsx → renderer/src/hub/lib/index.ts
- `Dashboard()` --calls--> `useAppList()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/index.tsx → renderer/src/hub/hooks/useAppList.ts
- `Wallpaper()` --calls--> `filePathOf()`  [EXTRACTED]
  renderer/src/hub/pages/Dashboard/Settings/Wallpaper/index.tsx → renderer/src/hub/lib/index.ts
- `TitleBar()` --calls--> `dAppLink()`  [EXTRACTED]
  renderer/src/hub/components/StatusBar/index.tsx → renderer/src/hub/lib/index.ts

## Import Cycles
- None detected.

## Communities (27 total, 5 thin omitted)

### Community 0 - "node-manager.js"
Cohesion: 0.10
Nodes (20): { app }, config, currentRelay(), { DEFAULT_RELAY, isHostPort, isMlsIdentity }, EventEmitter, fs, NodeManager, path (+12 more)

### Community 1 - "Network/index.tsx"
Cohesion: 0.31
Nodes (6): RFC-1918, contribHelp(), isPrivateAddr(), Network(), Props, toneClass()

### Community 2 - "package.json"
Cohesion: 0.04
Nodes (45): author, build, appId, extraResources, files, linux, mac, nsis (+37 more)

### Community 3 - "AppContext.tsx"
Cohesion: 0.06
Nodes (44): drawerAnimation, folderAnimation, modalAnimation, slideAnimation, appContext, BadgeNotification(), Blur(), Confirm() (+36 more)

### Community 4 - "config.js"
Cohesion: 0.16
Nodes (19): { app, safeStorage }, basePort(), configPath(), crypto, DEFAULTS, encAvailable(), ensureSecret(), fs (+11 more)

### Community 5 - "devDependencies"
Cohesion: 0.04
Nodes (49): autoprefixer, concurrently, date-fns, electron, electron-builder, embla-carousel-react, embla-carousel-wheel-gestures, jszip (+41 more)

### Community 6 - "main.js"
Cohesion: 0.07
Nodes (29): { app, BrowserWindow, ipcMain, dialog, shell, clipboard }, config, createWindow(), currentWallpaper(), fs, gotLock, https, iconcache (+21 more)

### Community 7 - "ShellContext.tsx"
Cohesion: 0.06
Nodes (41): installMdsShim(), setShellHandlers(), AUTO_WRITE, dappUrl(), filehost(), iconUrl(), parseDappUrl(), STORE_DAPP (+33 more)

### Community 8 - "lib/index.ts"
Cohesion: 0.08
Nodes (37): AppProvider(), checkIfDappMatchesZip(), IProps, Toggle(), useFoldersTheme(), useWallpaper(), addPeers(), block() (+29 more)

### Community 9 - "MinimaBridge"
Cohesion: 0.06
Nodes (9): KnownRelay, MinimaBridge, MlsPolicy, NodeHealth, NodeSnapshot, PortmapStatus, Ports, RpcReply (+1 more)

### Community 10 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, src, vite/client, compilerOptions, allowJs, allowSyntheticDefaultImports (+15 more)

### Community 11 - "MaximaProfile/index.tsx"
Cohesion: 0.09
Nodes (12): DashboardActionBar(), MobileSearchItem(), MaximaProfile(), CopyIcon(), CopySuccessIcon(), dAppLink(), Handlers, NativeView (+4 more)

### Community 12 - "provision.js"
Cohesion: 0.10
Nodes (24): cache, clear(), set(), fetchBuffer(), { net }, { app }, { compareVersions }, crypto (+16 more)

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
Cohesion: 0.22
Nodes (8): AppFolder(), AppList(), AppList(), excludedFromFolders, systemApps, sortByType(), useAppList(), AppData

### Community 26 - "App.tsx"
Cohesion: 0.16
Nodes (9): Introduction(), Dashboard(), findPageIndexContainingApp(), Delete(), Install(), Root(), Settings(), SettingsAddConnections() (+1 more)

## Knowledge Gaps
- **189 isolated node(s):** `{ app, safeStorage }`, `crypto`, `fs`, `path`, `DEFAULTS` (+184 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `appContext` connect `AppContext.tsx` to `Network/index.tsx`, `lib/index.ts`, `MaximaProfile/index.tsx`, `AppList/index.tsx`, `App.tsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `{ app, safeStorage }`, `crypto`, `fs` to the rest of the system?**
  _189 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `node-manager.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10409745293466224 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._
- **Should `AppContext.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05854341736694678 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._