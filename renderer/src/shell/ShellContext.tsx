/*
 * ShellContext — the shell's single store: node status, the dapp list (with MDS session ids), pending
 * permission requests, and the tab model. One 4 s poll owns list + pending; node status is pushed by main.
 *
 * The hub (renderer/src/hub) does not use this context directly — it talks to `window.MDS` (mds-shim.ts),
 * which is fed from here through the bus, and opens dapps through hub/shell-bridge.ts.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeSnapshot, Ports } from '../minima';
import { bus } from './bus';
import { STORE_WRITE_ALLOW, parseDappUrl } from './bridge';
import { setShellHandlers } from '../hub/shell-bridge';

export type TabKind = 'home' | 'dapp' | 'terminal' | 'logs' | 'store';
export interface Tab {
  id: string;
  kind: TabKind;
  name: string;
  uid?: string;
  sessionid?: string;
  hash?: string;
  nav: number; // bumped whenever the webview must (re)load its URL
}
export interface Dapp { uid: string; sessionid: string; conf: any }
export interface PendingItem { uid: string; command: string; minidapp?: any }
export interface OpenDappArgs { uid: string; sessionid?: string; name?: string; icon?: string; hash?: string }

const HOME_TAB: Tab = { id: 'home', kind: 'home', name: 'Home', nav: 0 };
const VIEW_NAMES: Record<string, string> = { terminal: 'Terminal', logs: 'Node logs', store: 'MiniDapp Store' };
const POLL_MS = 4000;

interface ShellValue {
  ports: Ports | null;
  status: NodeSnapshot | null;
  nodeRunning: boolean;
  dapps: Dapp[];
  pending: PendingItem[];
  maximaAddress: string;
  tabs: Tab[];
  activeId: string;
  activeTab: Tab;
  openDapp: (a: OpenDappArgs) => Promise<void>;
  openDappUrl: (url: string) => Promise<void>;
  openView: (kind: 'terminal' | 'logs' | 'store') => void;
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
export const useShell = () => useContext(ShellCtx);

export const ShellProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const minima = window.minima;
  const [ports, setPorts] = useState<Ports | null>(null);
  const [status, setStatus] = useState<NodeSnapshot | null>(null);
  const [dapps, setDapps] = useState<Dapp[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [maximaAddress, setMaximaAddress] = useState('');
  const [tabs, setTabs] = useState<Tab[]>([HOME_TAB]);
  const [activeId, setActiveId] = useState('home');

  const dappsRef = useRef<Dapp[]>([]);
  const sigRef = useRef('');
  const snoozed = useRef(new Set<string>());
  const lastBlock = useRef(0);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // ---- node status (pushed by main every health tick) ----
  const applyStatus = useCallback((s: NodeSnapshot) => {
    if (!s) return;
    setStatus(s);
    const blk = (s.health && s.health.block) || 0;
    if (blk && blk !== lastBlock.current) {
      lastBlock.current = blk;
      bus.emit('block', { block: blk });
    }
  }, []);

  // ---- dapp list: one poll for the whole shell; sessionid rotation reloads open tabs ----
  const refreshDapps = useCallback(async () => {
    let r: any;
    try { r = await minima.cmd('mds action:list'); } catch (e) { return; }
    if (!r || !r.status) return;
    const raw: any[] = Array.isArray(r.response) ? r.response : (r.response && r.response.minidapps) || [];
    const list: Dapp[] = raw.filter((d) => d && d.conf && !String(d.conf.name || '').startsWith('_'));
    dappsRef.current = list;
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
  }, []);

  // ---- pending permission requests (read-mode dapps issuing writes) ----
  const checkPending = useCallback(async () => {
    try {
      const r: any = await minima.cmd('mds action:pending');
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
      const r: any = await minima.cmd('maxima action:info');
      const addr = (r && r.status && r.response && (r.response.contact || r.response.maximaaddress)) || '';
      if (addr) setMaximaAddress(String(addr));
    } catch (e) {}
  }, []);

  const healMaxima = useCallback(() => minima.healMaxima(), []);

  // ---- tabs ----
  const switchTab = useCallback((id: string) => setActiveId(id), []);

  const closeTab = useCallback((id: string) => {
    if (id === 'home') return;
    const ts = tabsRef.current;
    const ix = ts.findIndex((t) => t.id === id);
    if (ix < 0) return;
    const next = ts.filter((t) => t.id !== id);
    setTabs(next);
    setActiveId((cur) => (cur === id ? (next[Math.max(0, ix - 1)] || HOME_TAB).id : cur));
  }, []);

  const openView = useCallback((kind: 'terminal' | 'logs' | 'store') => {
    setTabs((ts) => (ts.some((t) => t.id === kind) ? ts : [...ts, { id: kind, kind, name: VIEW_NAMES[kind], nav: 0 }]));
    setActiveId(kind);
  }, []);

  const openDapp = useCallback(async (a: OpenDappArgs) => {
    if (!a || !a.uid) return;
    let d = dappsRef.current.find((x) => x.uid === a.uid);
    // Store-like dapps install other dapps: give them write so those installs don't queue to Pending.
    // Granting rotates the sessionid, so re-read the list before building the URL.
    if (d && STORE_WRITE_ALLOW.includes(String(d.conf.name || '').toLowerCase()) && d.conf.permission !== 'write') {
      try { await minima.cmd(`mds action:permission uid:${d.uid} trust:write`); } catch (e) {}
      sigRef.current = '';
      await refreshDapps();
      d = dappsRef.current.find((x) => x.uid === a.uid) || d;
    }
    const sessionid = (d && d.sessionid) || a.sessionid || '';
    if (!sessionid) return;
    const name = a.name || (d && d.conf && d.conf.name) || a.uid;
    const id = 'dapp-' + a.uid;
    setTabs((ts) => {
      const ex = ts.find((t) => t.id === id);
      if (!ex) return [...ts, { id, kind: 'dapp', name, uid: a.uid, sessionid, hash: a.hash || '', nav: 0 }];
      const hash = a.hash !== undefined && a.hash !== '' ? a.hash : ex.hash;
      const mustLoad = sessionid !== ex.sessionid || (a.hash !== undefined && a.hash !== '' && a.hash !== ex.hash);
      return ts.map((t) => (t.id === id ? { ...t, sessionid, hash, nav: mustLoad ? t.nav + 1 : t.nav } : t));
    });
    setActiveId(id);
  }, [refreshDapps]);

  const openDappUrl = useCallback(async (url: string) => {
    const p = parseDappUrl(url);
    if (!p) return;
    await openDapp({ uid: p.uid, sessionid: p.sessionid, hash: p.hash });
  }, [openDapp]);

  const installFromFile = useCallback(async () => {
    const r = await minima.install();
    sigRef.current = '';
    await refreshDapps();
    await checkPending();
    return r;
  }, [refreshDapps, checkPending]);

  const dappLink = useCallback((name: string) => {
    const n = String(name || '').toLowerCase();
    return dappsRef.current.find((d) => String(d.conf.name || '').toLowerCase() === n);
  }, []);

  // ---- boot: ports, status push, open-url push, and the single poll loop ----
  useEffect(() => {
    let alive = true;
    minima.ports().then((p) => { if (alive) setPorts(p); }).catch(() => {});
    minima.snapshot().then((s) => { if (alive) applyStatus(s); }).catch(() => {});
    const offStatus = minima.onStatus(applyStatus);
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
    return () => { alive = false; offStatus(); offUrl(); clearInterval(iv); };
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
  const nodeRunning = !!(status && status.state === 'running');

  const value = useMemo<ShellValue>(() => ({
    ports, status, nodeRunning, dapps, pending, maximaAddress, tabs, activeId, activeTab,
    openDapp, openDappUrl, openView, switchTab, closeTab, installFromFile, refreshDapps, checkPending,
    acceptPending, denyPending, snoozePending, refreshMaxima, healMaxima, dappLink,
  }), [ports, status, nodeRunning, dapps, pending, maximaAddress, tabs, activeId, activeTab,
    openDapp, openDappUrl, openView, switchTab, closeTab, installFromFile, refreshDapps, checkPending,
    acceptPending, denyPending, snoozePending, refreshMaxima, healMaxima, dappLink]);

  return <ShellCtx.Provider value={value}>{children}</ShellCtx.Provider>;
};
