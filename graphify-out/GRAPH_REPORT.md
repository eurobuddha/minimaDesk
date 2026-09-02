# Graph Report - minimaDesk  (2026-09-02)

## Corpus Check
- 105 files · ~90,856 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 117 nodes · 154 edges · 9 communities (7 shown, 2 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `abb199d4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- NodeManager
- node-manager.js
- build
- linux
- config.js
- package.json
- main.js
- preload.js
- fetch-jar.sh

## God Nodes (most connected - your core abstractions)
1. `NodeManager` - 15 edges
2. `build` - 9 edges
3. `rpcCall()` - 8 edges
4. `mac` - 8 edges
5. `ensureSecret()` - 6 edges
6. `scripts` - 5 edges
7. `linux` - 5 edges
8. `load()` - 4 edges
9. `basePort()` - 4 edges
10. `files` - 4 edges

## Surprising Connections (you probably didn't know these)
- `rpcCall()` --calls--> `timeoutFor()`  [EXTRACTED]
  main/rpc.js → main/rpc.js  _Bridges community 1 → community 0_

## Import Cycles
- None detected.

## Communities (9 total, 2 thin omitted)

### Community 0 - "NodeManager"
Cohesion: 0.27
Nodes (3): NodeManager, tokenizeArgs(), rpcCall()

### Community 1 - "node-manager.js"
Cohesion: 0.15
Nodes (11): { app }, config, EventEmitter, fs, MAXIMA_RELAYS, path, { rpcCall }, { spawn } (+3 more)

### Community 2 - "build"
Cohesion: 0.09
Nodes (23): build, appId, extraResources, files, mac, nsis, productName, win (+15 more)

### Community 3 - "linux"
Cohesion: 0.40
Nodes (5): linux, category, icon, maintainer, target

### Community 4 - "config.js"
Cohesion: 0.17
Nodes (18): { app, safeStorage }, basePort(), configPath(), crypto, DEFAULTS, encAvailable(), ensureSecret(), fs (+10 more)

### Community 5 - "package.json"
Cohesion: 0.11
Nodes (17): electron, electron-builder, author, description, devDependencies, electron, electron-builder, license (+9 more)

### Community 6 - "main.js"
Cohesion: 0.12
Nodes (11): { app, BrowserWindow, ipcMain, dialog }, config, fs, gotLock, https, iconCache, { net }, node (+3 more)

## Knowledge Gaps
- **63 isolated node(s):** `{ app, safeStorage }`, `crypto`, `fs`, `path`, `DEFAULTS` (+58 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build` connect `build` to `linux`, `package.json`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `NodeManager` connect `NodeManager` to `node-manager.js`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `rpcCall()` connect `NodeManager` to `node-manager.js`, `main.js`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `{ app, safeStorage }`, `crypto`, `fs` to the rest of the system?**
  _63 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `build` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._