import { useEffect, useRef, useState } from 'react';
import { useShell, useShellStatus } from '../ShellContext';
import type { Dapp, Tab } from '../ShellContext';
import { STORE_DAPP, TERMINAL_DAPP, iconUrl } from '../bridge';
import { useIcon } from '../useIcon';
import NodePopover from './NodePopover';

const MinimaLogo = () => (
  <svg className="ico-home" viewBox="0 0 32 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M25.6554 7.46969L24.2413 13.5076L22.4307 6.21148L16.0935 3.73123L14.3802 11.0346L12.8614 2.47302L6.5242 0L0 27.8974H6.92074L8.92588 19.3286L10.4297 27.8974H17.3654L19.0713 20.5868L20.8744 27.8974H27.7952L32 9.94271L25.6554 7.46969Z" fill="currentColor" />
  </svg>
);

const IconStore = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l1.5-5h15L21 9" /><path d="M3 9h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" /><path d="M9 21v-6h6v6" />
  </svg>
);
const IconTerminal = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3" /><path d="M12 15h5" />
  </svg>
);
const IconLogs = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6" /><path d="M9 16h6" />
  </svg>
);

function TabItem({ tab }: { tab: Tab }) {
  const { activeId, switchTab, closeTab, dapps, ports } = useShell();
  const dapp = tab.kind === 'dapp' ? dapps.find((d) => d.uid === tab.uid) : undefined;
  const icon = useIcon(tab.kind === 'dapp' && ports ? iconUrl(ports.mds, dapp) : '');
  const active = tab.id === activeId;
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      className={`tab ${tab.kind === 'home' ? 'home' : ''} ${active ? 'active' : ''}`}
      title={tab.name}
      onClick={() => switchTab(tab.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.id); } }}
      onAuxClick={(e) => { if (e.button === 1 && tab.kind !== 'home') closeTab(tab.id); }}
    >
      {tab.kind === 'home' && <MinimaLogo />}
      {tab.kind === 'dapp' && (icon ? <img className="ico" src={icon} alt="" /> : <div className="mono" aria-hidden="true">{(tab.name || '?').trim().charAt(0).toUpperCase()}</div>)}
      {tab.kind === 'logs' && <IconLogs />}
      <span className="ttl">{tab.name}</span>
      {tab.kind !== 'home' && (
        <button className="x" type="button" title="Close tab" aria-label={`Close ${tab.name}`} onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" /></svg>
        </button>
      )}
    </div>
  );
}

function NodeChip({ onClick, open }: { onClick: () => void; open: boolean }) {
  const status = useShellStatus();
  const state = status ? status.state : 'starting';
  const h = status && status.health;
  const dot = state === 'running' ? 'on' : state === 'error' ? 'err' : state === 'stopped' ? '' : 'busy';
  const label = state === 'running' ? 'Node' : state === 'error' ? 'Node error' : state === 'stopped' ? 'Node stopped' : state === 'stopping' ? 'Stopping…' : 'Starting…';
  return (
    <button type="button" className={`nodechip nodrag ${open ? 'open' : ''}`} onClick={onClick} title="Node status" aria-haspopup="dialog" aria-expanded={open}>
      <span className={`dot ${dot}`} aria-hidden="true" />
      <span>{label}</span>
      {h && state === 'running' && (
        <>
          <span className="sep" aria-hidden="true">·</span>
          <span>{Number(h.block || 0).toLocaleString('en-US')}</span>
          <span className="sep" aria-hidden="true">·</span>
          <span className="dim">{h.connections || 0} peers</span>
          <span className="sep" aria-hidden="true">·</span>
          <span className={h.maxima ? '' : 'dim'}>Maxima {h.maxima ? 'on' : 'off'}</span>
        </>
      )}
    </button>
  );
}

export default function TitleBar() {
  const { tabs, activeId, dapps, openView, openNamedDapp, installFromFile } = useShell();
  const [pop, setPop] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const isMac = window.minima && window.minima.platform === 'darwin';

  // The Store and Terminal buttons open the bundled dapps (provisioned at boot by main/provision.js).
  const find = (name: string) => dapps.find((d) => String(d.conf.name || '').toLowerCase() === name.toLowerCase());
  const isActive = (d?: Dapp) => !!d && activeId === 'dapp-' + d.uid;
  const store = find(STORE_DAPP);
  const term = find(TERMINAL_DAPP);

  // Close the popover on an outside click, on Escape, and when focus leaves the shell (a click inside a
  // <webview> guest never reaches this document, but it does blur the embedder window).
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: MouseEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setPop(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(false); };
    const onBlur = () => setPop(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [pop]);

  return (
    <div className="titlebar" ref={barRef}>
      {isMac && <div className="macgap" />}
      <div className="tabs" role="tablist">
        {tabs.map((t) => <TabItem key={t.id} tab={t} />)}
        <button type="button" className="tool add" title="Install a MiniDapp from a file" aria-label="Install a MiniDapp from a file" onClick={() => installFromFile()}>+</button>
      </div>
      <div className="spacer" />
      <button type="button" className={`tool ${isActive(store) ? 'active' : ''}`} title={STORE_DAPP} aria-label={STORE_DAPP} onClick={() => openNamedDapp(STORE_DAPP)}><IconStore /></button>
      <button type="button" className={`tool ${isActive(term) ? 'active' : ''}`} title={TERMINAL_DAPP} aria-label={TERMINAL_DAPP} onClick={() => openNamedDapp(TERMINAL_DAPP)}><IconTerminal /></button>
      <button type="button" className={`tool ${activeId === 'logs' ? 'active' : ''}`} title="Node logs" aria-label="Node logs" onClick={() => openView('logs')}><IconLogs /></button>
      <NodeChip open={pop} onClick={() => setPop((v) => !v)} />
      {pop && <NodePopover onClose={() => setPop(false)} />}
    </div>
  );
}
