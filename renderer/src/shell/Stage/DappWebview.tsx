import { useEffect, useRef } from 'react';
import type { Tab } from '../ShellContext';
import { useShell } from '../ShellContext';
import { dappUrl } from '../bridge';

/**
 * One <webview> per dapp tab. The `src` attribute is set once (a changing attribute would reload on
 * every render); later navigations (sessionid rotated after a permission change, a new #hash from
 * a dapp link) go through loadURL when `tab.nav` bumps.
 */
export default function DappWebview({ tab, active }: { tab: Tab; active: boolean }) {
  const { ports } = useShell();
  const ref = useRef<any>(null);
  const mds = ports ? ports.mds : 20003;
  const url = dappUrl(mds, tab.uid || '', tab.sessionid || '', tab.hash || '');
  const initial = useRef(url);
  const lastNav = useRef(tab.nav);

  useEffect(() => {
    if (tab.nav === lastNav.current) return;
    lastNav.current = tab.nav;
    try { ref.current && ref.current.loadURL(url); } catch (e) { /* not attached yet */ }
  }, [tab.nav, url]);

  return (
    <webview
      ref={ref}
      src={initial.current}
      partition="persist:mds"
      {...({ allowpopups: 'true' } as any) /* Electron only checks for the attribute's presence */}
      className={active ? '' : 'hidden'}
    />
  );
}
