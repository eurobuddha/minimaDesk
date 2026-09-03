import { useEffect, useRef } from 'react';
import type { WebviewTag } from 'electron';
import type { Tab } from '../ShellContext';
import { useShell } from '../ShellContext';
import { dappUrl } from '../bridge';

/**
 * One <webview> per dapp tab. The `src` attribute is set once (a changing attribute would reload on
 * every render). A rotated sessionid (`tab.nav`) reloads through loadURL; a fragment-only navigation
 * (`tab.hashNav`, e.g. the hub's Pending button → #/profile) just sets location.hash in the guest, so
 * the dapp is not remounted. Nothing renders until the MDS port is known — a guessed port would be
 * frozen into `src` forever.
 */
export default function DappWebview({ tab, active }: { tab: Tab; active: boolean }) {
  const { ports } = useShell();
  const ref = useRef<WebviewTag | null>(null);
  const mds = ports ? ports.mds : 0;
  const url = mds ? dappUrl(mds, tab.uid || '', tab.sessionid || '', tab.hash || '') : '';
  const initial = useRef('');
  if (!initial.current && url) initial.current = url;
  const lastNav = useRef(tab.nav);
  const lastHashNav = useRef(tab.hashNav);

  useEffect(() => {
    if (tab.nav === lastNav.current) return;
    lastNav.current = tab.nav;
    lastHashNav.current = tab.hashNav;             // a full load already carries the hash
    try { ref.current && url && ref.current.loadURL(url); } catch (e) { /* not attached yet */ }
  }, [tab.nav, url]);

  useEffect(() => {
    if (tab.hashNav === lastHashNav.current) return;
    lastHashNav.current = tab.hashNav;
    const hash = tab.hash || '';
    try { ref.current && ref.current.executeJavaScript(`location.hash=${JSON.stringify(hash)};`).catch(() => {}); } catch (e) {}
  }, [tab.hashNav, tab.hash]);

  if (!initial.current) return null;
  return (
    <webview
      ref={ref as any}
      src={initial.current}
      partition="persist:mds"
      {...({ allowpopups: 'true' } as any) /* Electron only checks for the attribute's presence */}
      className={active ? '' : 'inactive'}
      aria-hidden={!active}
    />
  );
}
