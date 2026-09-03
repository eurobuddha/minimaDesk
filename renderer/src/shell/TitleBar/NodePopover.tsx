import { useEffect, useRef, useState } from 'react';
import { useShell, useShellStatus } from '../ShellContext';

function fmtUptime(ms: number) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export default function NodePopover({ onClose }: { onClose: () => void }) {
  const { ports, maximaAddress, refreshMaxima, healMaxima } = useShell();
  const status = useShellStatus();
  const [healing, setHealing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; cls: string }>({ text: '', cls: '' });
  const [copied, setCopied] = useState(false);
  const timers = useRef<any[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  useEffect(() => {
    refreshMaxima();
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, []);

  const h = status && status.health;
  const state = status ? status.state : 'starting';

  const copy = async () => {
    if (!maximaAddress) return;
    try { await navigator.clipboard.writeText(maximaAddress); setCopied(true); later(() => setCopied(false), 2000); } catch (e) {}
  };

  const heal = async () => {
    setHealing(true);
    setMsg({ text: 'Reconnecting relay, pinning MLS, refreshing contacts…', cls: '' });
    try {
      const r = await healMaxima();
      if (r && r.status) {
        setMsg({ text: 'Maxima healed — relay reconnected and contacts refreshed.', cls: 'ok' });
        later(() => refreshMaxima(), 4000);
      } else {
        setMsg({ text: 'Heal failed: ' + ((r && r.error) || 'unknown error'), cls: 'err' });
      }
    } catch (e: any) {
      setMsg({ text: 'Heal failed: ' + (e && e.message ? e.message : String(e)), cls: 'err' });
    } finally {
      setHealing(false);
    }
  };

  return (
    <div className="popover" role="dialog" aria-label="Node status" onMouseDown={(e) => e.stopPropagation()}>
      <div className="rows">
        <div className="row"><span className="k">Status</span><span className={`v ${state === 'running' ? 'ok' : state === 'error' ? 'bad' : ''}`}>{state}{status && status.lastError ? ` — ${status.lastError}` : ''}</span></div>
        <div className="row"><span className="k">Block</span><span className="v">{h ? Number(h.block || 0).toLocaleString('en-US') : '—'}</span></div>
        <div className="row"><span className="k">Connections</span><span className="v">{h ? h.connections : '—'}</span></div>
        <div className="row"><span className="k">Maxima</span><span className={`v ${h && h.maxima ? 'ok' : ''}`}>{h ? (h.maxima ? 'online' : 'offline') : '—'}</span></div>
        <div className="row"><span className="k">Role</span><span className="v">{status ? (status.contribute ? 'contributing (accepts inbound)' : 'light node (outbound only)') : '—'}</span></div>
        {status && status.contribute && <div className="row"><span className="k">Inbound</span><span className={`v ${h && (h.incoming || 0) > 0 ? 'ok' : ''}`}>{h && (h.incoming || 0) > 0 ? `reachable — ${h.incoming} incoming` : (status.portmap ? status.portmap.state.replace('_', ' ') : '—')}</span></div>}
        <div className="row"><span className="k">Wallet</span><span className={`v ${h && h.locked ? 'ok' : ''}`}>{h ? (h.locked ? 'locked' : 'unlocked') : '—'}</span></div>
        <div className="row"><span className="k">Ports</span><span className="v">{ports ? `p2p ${ports.base} · mds ${ports.mds} · rpc ${ports.rpc}` : '—'}</span></div>
        <div className="row"><span className="k">Uptime</span><span className="v">{status ? fmtUptime(status.uptimeMs) : '—'}</span></div>
        <div className="row"><span className="k">Node version</span><span className="v">{h && h.version ? h.version : '—'}</span></div>
        <div className="row"><span className="k">minimaDesk</span><span className="v">{ports ? ports.appVersion : '—'}</span></div>
      </div>

      <div className="addr core-black-contrast rounded relative overflow-hidden">
        <div className="relative text-white p-3 text-sm flex items-center justify-between">
          <span>Your Maxima contact address</span>
          <button type="button" className="text-sm text-core-grey-80 hover:text-white nodrag" onClick={copy} disabled={!maximaAddress}>
            {copied ? <span className="text-status-green">Copied</span> : 'Copy'}
          </button>
        </div>
        <div className="core-black-contrast-2 p-3">
          {/* the full address, always — it only exists to be copied and pasted */}
          <div className="val">{maximaAddress || 'Waiting for Maxima…'}</div>
        </div>
      </div>

      <div className="heal">
        <button
          type="button"
          className="w-full px-4 py-3 rounded font-bold text-white core-black-contrast-3 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed nodrag"
          disabled={healing || state !== 'running'}
          onClick={heal}
        >
          {healing ? 'Healing…' : 'Heal Maxima'}
        </button>
        <div className={`msg ${msg.cls}`}>{msg.text || 'Reconnects the relay, re-pins the static MLS and refreshes every contact — use after a network change.'}</div>
      </div>
      <div className="foot"><span /><button type="button" className="text-core-grey-80 hover:text-white bg-transparent nodrag" onClick={onClose}>Close</button></div>
    </div>
  );
}
