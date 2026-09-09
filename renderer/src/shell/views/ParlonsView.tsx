import { useEffect, useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { useShell, useShellStatus } from '../ShellContext';
import type { ParlonsStatus } from '../../minima';

/**
 * The Parlons tab: the account this Parlons Node hosts (nodeKind "parlons"). The account serves its own web
 * panel on loopback; this view embeds it in ONE hardened <webview> (partition persist:parlons; main only
 * allows the panel origin) and signs in with the one-time link the account keeps beside its data. The panel
 * IS the Parlons app, so nothing native sits above it once the account is up - the strip only speaks while
 * it is starting, has failed, or this install still runs the classic node.
 * Ported from minimacore-desktop's renderParlons (0.7.16).
 */
export default function ParlonsView({ active }: { active: boolean }) {
  const { ports } = useShell();
  const status = useShellStatus();
  const [st, setSt] = useState<ParlonsStatus | null>(null);
  const [url, setUrl] = useState('');
  const [loadedFor, setLoadedFor] = useState('');     // the node start the panel was loaded for (one key per start)
  const [reloadToken, setReloadToken] = useState(0);
  const [linkError, setLinkError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [switching, setSwitching] = useState('');
  const [msg, setMsg] = useState('');
  const ref = useRef<WebviewTag | null>(null);
  const kind = (status && status.kind) || (ports && ports.kind) || 'parlons';

  // Poll the account's status while the tab is shown (its readiness comes from the jar's own log lines).
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pull = async () => { try { const s = await window.minima.parlonsStatus(); if (alive) { setSt(s); setStatusError(''); } } catch (e) { if (alive) setStatusError('Could not check the account. Retrying…'); } };
    pull();
    const iv = setInterval(pull, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [active, reloadToken, status && status.state, status && status.parlons && status.parlons.ready]);

  // One panel session per node start: key = panel port + the node's start time (from main, exact).
  const key = st && st.ready && status && status.startedTs ? `${st.panelPort}:${status.startedTs}` : '';
  useEffect(() => {
    if (!active) return;
    if (!st || !st.ready || st.error || statusError || !key) { setUrl(''); setLoadedFor(''); return; }
    if (key === loadedFor) return;
    let alive = true;
    let tries = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setLinkError('');
    const get = async () => {
      try {
        const u = await window.minima.parlonsPanelUrl();
        if (!alive) return;
        if (u) { setUrl(u); setLoadedFor(key); setLinkError(''); return; }
      } catch (e) {}
      if (alive && tries++ < 20) retry = setTimeout(get, 1500);   // the account writes the next ticket as soon as one is used
      else if (alive) setLinkError('Could not get a sign-in link. Reload to try again.');
    };
    get();
    return () => { alive = false; clearTimeout(retry); };
  }, [active, key, st && st.ready, st && st.error, statusError, reloadToken]);

  const reload = () => { setLoadedFor(''); setUrl(''); setLinkError(''); setReloadToken(n => n + 1); };
  const openExternal = async () => {
    try {
      const ok = await window.minima.parlonsOpenExternal();
      setMsg(ok ? 'Opened in your browser with a fresh one-time link.' : 'No sign-in link yet - the account is still starting.');
    } catch (e) { setMsg('Could not open the panel. Try again.'); }
    setTimeout(() => setMsg(''), 4000);
  };
  const { switchTab } = useShell();
  const goSettings = () => { switchTab('home'); location.hash = '#/settings'; setSwitching('Open Settings → minimaDesk → Which node.'); };

  if (kind !== 'parlons') {
    return (
      <div className="parlons-card">
        <h2>Parlons</h2>
        <p>Your node can host your Parlons account: private chat, calls and payments, with your phones and computers paired to it. This install runs the classic Minima node; the Parlons Node is a separate node (its own folder), and Settings lets you carry your wallet's seed phrase and key-use counters over, or start a brand-new node.</p>
        {st && st.blocker ? <div className="parlons-warn">{st.blocker}</div>
          : <button className="btn" onClick={goSettings}>Switch in Settings → minimaDesk (explains what carries over)</button>}
        {switching && <div className="parlons-msg">{switching}</div>}
      </div>
    );
  }
  const ready = !!(st && st.ready && !st.error && !statusError);
  const panelUrl = loadedFor === key ? url : '';
  return (
    <>
      {!ready && (
        <div className="parlons-strip">
          <span>{statusError || (st && st.error ? 'Account error' : 'Starting the account…')}{st && st.version ? ` · Parlons Node ${st.version}` : ''}</span>
          <div className="grow" />
          <button className="btn" onClick={reload}>Reload</button>
        </div>
      )}
      {st && st.error && <div className="parlons-warn">{st.error}</div>}
      {ready && (
        <div className="parlons-tools">
          <button className="btn" title="Open the panel in your browser with a fresh one-time link" onClick={openExternal}>Open in browser</button>
          <button className="btn" onClick={reload}>Reload</button>
          {msg && <span className="parlons-msg">{msg}</span>}
        </div>
      )}
      <div className="parlons-body">
        {!ready && <div className="parlons-wait">{statusError || (st && st.error ? 'The account did not start - see Node logs.' : 'Waiting for the account to attach to the network…')}</div>}
        {ready && !panelUrl && <div className="parlons-wait" role="status">{linkError || "Getting a sign-in link from the account…"}</div>}
        {ready && panelUrl && (
          <webview
            key={loadedFor}
            ref={ref as any}
            src={panelUrl}
            partition="persist:parlons"
            className={active ? '' : 'inactive'}
            aria-hidden={!active}
          />
        )}
      </div>
    </>
  );
}
