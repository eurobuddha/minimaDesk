/*
 * ShellContext — the shell's single store: node status, the dapp list (with MDS session ids), pending
 * permission requests, and the tab model. One 4 s poll owns list + pending; node status is pushed by main.
 *
 * Status changes every health tick, so it lives in its own context (useShellStatus) — the rest of the
 * store only re-renders consumers when something they use actually changed.
 *
 * The hub (renderer/src/hub) does not use this context directly — it talks to `window.MDS` (mds-shim.ts),
 * which is fed from here through the bus, and opens dapps through hub/shell-bridge.ts.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeSnapshot, Ports, RpcReply } from '../minima';
import { bus } from './bus';
import { AUTO_WRITE, parseDappUrl } from './bridge';
import { setShellHandlers } from '../hub/shell-bridge';

export type TabKind = 'home' | 'dapp' | 'logs';
export interface Tab {
  id: string;
  kind: TabKind;
  name: string;
  uid?: string;
  sessionid?: string;
  hash?: string;
  nav: number;     // bumped when the webview must (re)load its URL (session rotated)
  hashNav: number; // bumped when only the #fragment must change (no reload)
}
export interface Dapp { uid: string; sessionid: string; conf: any }
export interface PendingItem { uid: string; command: string; minidapp?: any }
export interface OpenDappArgs { uid: string; sessionid?: string; name?: string; icon?: string; hash?: string }

const HOME_TAB: Tab = { id: 'home', kind: 'home', name: 'Home', nav: 0, hashNav: 0 };
const VIEW_NAMES: Record<string, string> = { logs: 'Node logs' };
const POLL_MS = 4000;

interface ShellValue {
  ports: Ports | null;
  dapps: Dapp[];
  pending: PendingItem[];
  maximaAddress: string;
  notice: string;
  tabs: Tab[];
  activeId: string;
  activeTab: Tab;
  openDapp: (a: OpenDappArgs) => Promise<void>;
  openDappUrl: (url: string) => Promise<void>;
  openNamedDapp: (name: string) => Promise<void>;
  openView: (kind: 'logs') => void;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  installFromFile: () => Promise<any>;
  refreshDapps: () => Promise<void>;
  checkPending: () => Promise<void>;
  acceptPending: (uid: string) => Promise<void>;
  denyPending: (uid: string) => Promise<void>;
  snoozePending: (uid: string) => void;
  refreshMaxima: () => Promise<void>;
  healMaxima: () => Promise<{ status: boolean; error?: string }>;
  dappLink: (name: string) => Dapp | undefined;
}

const ShellCtx = createContext<ShellValue>({} as ShellValue);
const StatusCtx = createContext<NodeSnapshot | null>(null);
export const useShell = () => useContext(ShellCtx);
/** The latest node snapshot (changes every health tick — subscribe only where it is shown). */
export const useShellStatus = () => useContext(StatusCtx);

const byName = (list: Dapp[], name: string) => {
  const n = String(name || '').toLowerCase();
  return list.find((d) => String(d.conf.name || '').toLowerCase() === n);
};

export const ShellProvider: React.FC<React.PropsWithChildren<{ initialPorts: Ports | null }>> = ({ initialPorts, children }) => {
  const minima = window.minima;
  const [ports, setPorts] = useState<Ports | null>(initialPorts);
  const [status, setStatus] = useState<NodeSnapshot | null>(null);
  const [dapps, setDapps] = useState<Dapp[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [maximaAddress, setMaximaAddress] = useState('');
  const [notice, setNotice] = useState('');
  const [tabs, setTabs] = useState<Tab[]>([HOME_TAB]);
  const [activeId, setActiveId] = useState('home');

  const statusRef = useRef<NodeSnapshot | null>(null);
  const dappsRef = useRef<Dapp[]>([]);
  const listLoaded = useRef(false);
  const listSeq = useRef(0);                     // discard out-of-order `mds action:list` replies
  const sigRef = useRef('');
  const snoozed = useRef(new Set<string>());
  const lastBlock = useRef(0);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const waiting = useRef<string>('');            // a named dapp the user asked for before it was installed
  const noticeTimer = useRef<any>(null);
  const opening = useRef(new Map<string, Promise<void>>());   // one open per uid at a time
  const openDappRef = useRef<(a: OpenDappArgs) => Promise<void>>(async () => {});

  const flashNotice = useCallback((text: string, ms = 6000) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = ms > 0 ? setTimeout(() => setNotice(''), ms) : null;
  }, []);

  // ---- dapp list: one poll for the whole shell; sessionid rotation reloads open tabs ----
  const refreshDapps = useCallback(async () => {
    const seq = ++listSeq.current;
    let r: RpcReply;
    try { r = await minima.cmd('mds action:list'); } catch (e) { return; }
    if (seq !== listSeq.current) return;         // a newer list request has been issued — this reply is stale
    if (!r || !r.status) return;
    const raw: any[] = Array.isArray(r.response) ? r.response : (r.response && r.response.minidapps) || [];
    const list: Dapp[] = raw.filter((d) => d && d.conf && !String(d.conf.name || '').startsWith('_'));
    dappsRef.current = list;
    listLoaded.current = true;
    const sig = list.map((d) => `${d.uid}:${d.conf.permission}:${d.sessionid}:${d.conf.version}`).join('|');
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    setDapps(list);
    bus.emit('dapps', list);
    setTabs((ts) => {
      let changed = false;
      const next = ts.map((t) => {
        if (t.kind !== 'dapp') return t;
        const fresh = list.find((d) => d.uid === t.uid);
        if (fresh && fresh.sessionid && fresh.sessionid !== t.sessionid) {
          changed = true;
          return { ...t, sessionid: fresh.sessionid, nav: t.nav + 1 };
        }
        return t;
      });
      return changed ? next : ts;
    });
    // Someone pressed Store / Terminal before the bundled dapp was installed — open it now.
    if (waiting.current) {
      const d = byName(list, waiting.current);
      if (d && d.sessionid) {
        waiting.current = '';
        setNotice('');
        openDappRef.current({ uid: d.uid, name: d.conf.name });
      }
    }
  }, []);

  // ---- node status (pushed by main every health tick) ----
  const applyStatus = useCallback((s: NodeSnapshot) => {
    if (!s) return;
    statusRef.current = s;
    setStatus(s);
    const blk = (s.health && s.health.block) || 0;
    if (blk && blk !== lastBlock.current) {
      lastBlock.current = blk;
      bus.emit('block', { block: blk });
    }
    // Provisioning finished but the dapp the user is waiting for still isn't there.
    if (s.provision && s.provision.done && waiting.current) {
      const name = waiting.current;
      refreshDapps().then(() => {
        if (waiting.current === name && !byName(dappsRef.current, name)) {
          waiting.current = '';
          flashNotice(`${name} isn't installed — install it from the Store`);
        }
      });
    }
  }, [refreshDapps, flashNotice]);

  // ---- pending permission requests (read-mode dapps issuing writes) ----
  const checkPending = useCallback(async () => {
    try {
      const r: RpcReply = await minima.cmd('mds action:pending');
      const list: PendingItem[] = (r && r.status && r.response && r.response.pending) || [];
      setPending(list.filter((p) => p && p.uid && !snoozed.current.has(p.uid)));
    } catch (e) { /* node booting */ }
  }, []);

  const acceptPending = useCallback(async (uid: string) => {
    try { await minima.cmd('mds action:accept uid:' + uid); } catch (e) {}
    setPending((p) => p.filter((x) => x.uid !== uid));
    sigRef.current = '';
    await refreshDapps();
    await checkPending();
  }, [refreshDapps, checkPending]);

  const denyPending = useCallback(async (uid: string) => {
    try { await minima.cmd('mds action:deny uid:' + uid); } catch (e) {}
    setPending((p) => p.filter((x) => x.uid !== uid));
    await checkPending();
  }, [checkPending]);

  const snoozePending = useCallback((uid: string) => {
    snoozed.current.add(uid);
    setPending((p) => p.filter((x) => x.uid !== uid));
  }, []);

  // ---- maxima ----
  const refreshMaxima = useCallback(async () => {
    try {
      const r: RpcReply = await minima.cmd('maxima action:info');
      const addr = (r && r.status && r.response && (r.response.contact || r.response.maximaaddress)) || '';
      if (addr) setMaximaAddress(String(addr));
    } catch (e) {}
  }, []);

  const healMaxima = useCallback(() => minima.healMaxima(), []);

  // ---- tabs ----
  const switchTab = useCallback((id: string) => setActiveId(id), []);

  const closeTab = useCallback((id: string) => {
    if (id === 'home') return;
    setTabs((ts) => {
      const ix = ts.findIndex((t) => t.id === id);
      if (ix < 0) return ts;
      const next = ts.filter((t) => t.id !== id);
      setActiveId((cur) => (cur === id ? (next[Math.max(0, ix - 1)] || HOME_TAB).id : cur));
      return next;
    });
  }, []);

  const openView = useCallback((kind: 'logs') => {
    setTabs((ts) => (ts.some((t) => t.id === kind) ? ts : [...ts, { id: kind, kind, name: VIEW_NAMES[kind], nav: 0, hashNav: 0 }]));
    setActiveId(kind);
  }, []);

  const openDapp = useCallback((a: OpenDappArgs): Promise<void> => {
    if (!a || !a.uid) return Promise.resolve();
    const inFlight = opening.current.get(a.uid);
    if (inFlight) return inFlight;                  // a double-click must not grant write / rotate twice
    const task = (async () => {
      let d = dappsRef.current.find((x) => x.uid === a.uid);
      // Unknown uid once the list has loaded (e.g. a dapp opening an uninstalled uid): nothing to show.
      if (!d && listLoaded.current) return;
      // Stores install other dapps and the terminal runs commands: give them write so nothing queues to
      // Pending. Granting rotates the sessionid, so re-read the list before building the URL.
      if (d && AUTO_WRITE.includes(String(d.conf.name || '').toLowerCase()) && d.conf.permission !== 'write') {
        try { await minima.cmd(`mds action:permission uid:${d.uid} trust:write`); } catch (e) {}
        sigRef.current = '';
        await refreshDapps();
        d = dappsRef.current.find((x) => x.uid === a.uid) || d;
      }
      const sessionid = (d && d.sessionid) || a.sessionid || '';
      if (!sessionid) return;
      const name = a.name || (d && d.conf && d.conf.name) || a.uid;
      const id = 'dapp-' + a.uid;
      const wantHash = a.hash !== undefined && a.hash !== '' ? a.hash : undefined;
      setTabs((ts) => {
        const ex = ts.find((t) => t.id === id);
        if (!ex) return [...ts, { id, kind: 'dapp', name, uid: a.uid, sessionid, hash: wantHash || '', nav: 0, hashNav: 0 }];
        const sessionChanged = sessionid !== ex.sessionid;
        // An explicit hash always navigates (the dapp may have moved on since); a fragment-only change
        // must not reload the dapp — DappWebview applies it via location.hash.
        return ts.map((t) => (t.id === id ? {
          ...t, sessionid, hash: wantHash !== undefined ? wantHash : t.hash,
          nav: sessionChanged ? t.nav + 1 : t.nav,
          hashNav: !sessionChanged && wantHash !== undefined ? t.hashNav + 1 : t.hashNav,
        } : t));
      });
      setActiveId(id);
    })().finally(() => { opening.current.delete(a.uid); });
    opening.current.set(a.uid, task);
    return task;
  }, [refreshDapps]);
  openDappRef.current = openDapp;

  const openDappUrl = useCallback(async (url: string) => {
    const p = parseDappUrl(url);
    if (!p) return;
    await openDapp({ uid: p.uid, sessionid: p.sessionid, hash: p.hash });
  }, [openDapp]);

  /** Open a dapp by its conf.name (the Store / Terminal buttons). Waits for provisioning if needed. */
  const openNamedDapp = useCallback(async (name: string) => {
    const d = byName(dappsRef.current, name);
    if (d) { await openDapp({ uid: d.uid, name: d.conf.name }); return; }
    waiting.current = name;
    const s = statusRef.current;
    if (s && s.provision && s.provision.done) {
      // give the list one refresh before giving up — provisioning may have just finished
      await refreshDapps();
      if (waiting.current === name && !byName(dappsRef.current, name)) {
        waiting.current = '';
        flashNotice(`${name} isn't installed — install it from the Store`);
      }
    } else {
      flashNotice(`Installing ${name}… it will open automatically`, 0);
    }
  }, [openDapp, refreshDapps, flashNotice]);

  const installFromFile = useCallback(async () => {
    const r = await minima.install();
    if (r && r.status === false && !r.cancelled) flashNotice('Install failed: ' + (r.error || 'unknown error'));
    sigRef.current = '';
    await refreshDapps();
    await checkPending();
    return r;
  }, [refreshDapps, checkPending, flashNotice]);

  const dappLink = useCallback((name: string) => byName(dappsRef.current, name), []);

  // ---- boot: ports, status push, open-url push, and the single poll loop ----
  const applyStatusRef = useRef(applyStatus);
  applyStatusRef.current = applyStatus;
  useEffect(() => {
    let alive = true;
    if (!initialPorts) minima.ports().then((p) => { if (alive) setPorts(p); }).catch(() => {});
    minima.snapshot().then((s) => { if (alive) applyStatusRef.current(s); }).catch(() => {});
    const offStatus = minima.onStatus((s) => applyStatusRef.current(s));
    const offUrl = minima.onOpenUrl(({ url }) => { openDappUrl(url); });
    let tick = 0;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        await refreshDapps();
        await checkPending();
        if (tick++ % 3 === 0) await refreshMaxima();
      } finally { busy = false; }
    };
    run();
    const iv = setInterval(run, POLL_MS);
    return () => { alive = false; offStatus(); offUrl(); clearInterval(iv); if (noticeTimer.current) clearTimeout(noticeTimer.current); };
  }, []);

  // The hub reaches the shell through hub/shell-bridge.ts (typed, no React context needed there).
  const latest = useRef({ openDapp, openView });
  latest.current = { openDapp, openView };
  useEffect(() => {
    setShellHandlers({
      openDapp: (a) => latest.current.openDapp(a),
      openNative: (v) => latest.current.openView(v),
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) || HOME_TAB;

  const value = useMemo<ShellValue>(() => ({
    ports, dapps, pending, maximaAddress, notice, tabs, activeId, activeTab,
    openDapp, openDappUrl, openNamedDapp, openView, switchTab, closeTab, installFromFile, refreshDapps, checkPending,
    acceptPending, denyPending, snoozePending, refreshMaxima, healMaxima, dappLink,
  }), [ports, dapps, pending, maximaAddress, notice, tabs, activeId, activeTab,
    openDapp, openDappUrl, openNamedDapp, openView, switchTab, closeTab, installFromFile, refreshDapps, checkPending,
    acceptPending, denyPending, snoozePending, refreshMaxima, healMaxima, dappLink]);

  return (
    <ShellCtx.Provider value={value}>
      <StatusCtx.Provider value={status}>{children}</StatusCtx.Provider>
    </ShellCtx.Provider>
  );
};
