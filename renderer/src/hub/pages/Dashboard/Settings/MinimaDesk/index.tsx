/*
 * minimaDesk settings section — desktop-only facts and actions that the stock hub has no home for:
 * app version + ports, node state, the node KIND (Parlons Node / classic jar, 0.7.17), Heal Maxima (classic
 * kind only), restart the node.
 */
import { useEffect, useState } from 'react';
import SlideScreen from '../../../../components/UI/SlideScreen';
import Button from '../../../../components/UI/Button';
import BackButton from '../_BackButton';
import type { NodeSnapshot, Ports, UpdateStatus } from '../../../../../minima';

type Props = { display: boolean; dismiss: () => void };

export function MinimaDesk({ display, dismiss }: Props) {
  const minima = (window as any).minima;
  const [ports, setPorts] = useState<Ports | null>(null);
  const [status, setStatus] = useState<NodeSnapshot | null>(null);
  const [healing, setHealing] = useState(false);
  const [healMsg, setHealMsg] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [rpcMsg, setRpcMsg] = useState('');
  const [kindPick, setKindPick] = useState<'parlons' | 'minima' | ''>('');
  const [heap, setHeap] = useState('');
  const [kindMsg, setKindMsg] = useState('');
  const [kindBusy, setKindBusy] = useState(false);
  const [blocker, setBlocker] = useState('');
  const [upd, setUpd] = useState<UpdateStatus | null>(null);
  const [updBusy, setUpdBusy] = useState('');
  const [updMsg, setUpdMsg] = useState('');

  useEffect(() => {
    if (!display || !minima) return;
    minima.ports().then(setPorts).catch(() => {});
    minima.snapshot().then((s: NodeSnapshot) => { setStatus(s); setKindPick((k) => k || s.kind); setHeap((h) => h || String(s.heapMb || 0)); }).catch(() => {});
    minima.parlonsStatus().then((p: any) => setBlocker((p && p.blocker) || '')).catch(() => {});
    minima.updateStatus().then(setUpd).catch(() => {});
    const off = minima.onStatus(setStatus);
    return () => { off && off(); };
  }, [display]);

  const kind = status ? status.kind : 'parlons';
  const checkUpdate = async () => {
    setUpdBusy('check'); setUpdMsg('');
    try { setUpd(await minima.updateCheck()); } catch (e: any) { setUpdMsg(e && e.message ? e.message : String(e)); }
    finally { setUpdBusy(''); }
  };
  const downloadUpdate = async () => {
    setUpdBusy('download'); setUpdMsg('Downloading — the file is verified against the feed before it is saved…');
    try {
      const r = await minima.updateDownload();
      if (r && r.status) { setUpdMsg('Saved and verified: ' + r.path + ' — install it over this app, then relaunch.'); if (r.update) setUpd(r.update); }
      else setUpdMsg('Download failed: ' + ((r && r.error) || 'unknown error'));
    } catch (e: any) { setUpdMsg(e && e.message ? e.message : String(e)); }
    finally { setUpdBusy(''); }
  };
  const updLine = !upd ? 'Checking…'
    : upd.error ? `Could not check for updates (${upd.error}). Running ${upd.running}.`
    : upd.available ? `minimaDesk ${upd.version} is available${upd.date ? ' (' + upd.date + ')' : ''} — you run ${upd.running}.${upd.notes ? ' ' + upd.notes : ''}`
    : `You run ${upd.running}${upd.version ? ' — the newest published build is ' + upd.version : ''}.`;
  const applyKind = async () => {
    const want = kindPick || kind;
    const heapMb = Math.max(0, parseInt(heap, 10) || 0);
    setKindBusy(true); setKindMsg('');
    try {
      const r = await minima.setNodeKind(want, heapMb);
      setKindMsg(r && r.status
        ? (want === 'parlons' ? 'Parlons Node starting — see the Parlons tab.' : 'Classic Minima node starting.')
        : 'Could not switch: ' + ((r && r.error) || 'unknown error'));
    } catch (e: any) { setKindMsg(e && e.message ? e.message : String(e)); }
    finally { setKindBusy(false); }
  };

  const heal = async () => {
    setHealing(true);
    setHealMsg('Reconnecting relay, pinning MLS, refreshing contacts…');
    try {
      const r = await minima.healMaxima();
      setHealMsg(r && r.status ? 'Maxima healed — relay reconnected and contacts refreshed.' : 'Heal failed: ' + ((r && r.error) || 'unknown error'));
    } catch (e: any) {
      setHealMsg('Heal failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setHealing(false);
    }
  };

  const [restartMsg, setRestartMsg] = useState('');
  const restart = async () => {
    setRestarting(true);
    setRestartMsg('');
    try {
      const r = await minima.nodeRestart();
      setRestartMsg(r && r.status ? 'Node restarted.' : 'Restart failed: ' + ((r && r.error) || 'unknown error'));
    } catch (e: any) { setRestartMsg('Restart failed: ' + (e && e.message ? e.message : String(e))); }
    finally { setRestarting(false); }
  };

  const h = status && status.health;
  const state = status ? status.state : '…';

  return (
    <SlideScreen display={display}>
      <div className="flex flex-col h-full bg-black">
        <div className="pt-16 px-4 lg:px-0 w-full pb-4 flex flex-col">
          <div className="max-w-xl mx-auto w-full">
            <BackButton dismiss={dismiss} />
            <div className="mt-6 text-2xl mb-8">minimaDesk</div>
            <div className="flex flex-col gap-5">
              <p className="text-core-grey-20">This node runs inside minimaDesk. Everything below is about the desktop app itself.</p>

              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-4">Node</div>
                <div className="flex flex-col gap-2 text-sm">
                  <Row k="State" v={state} />
                  <Row k="Block" v={h ? Number(h.block || 0).toLocaleString('en-US') : '—'} />
                  <Row k="Connections" v={h ? String(h.connections) : '—'} />
                  <Row k="Node kind" v={kind === 'parlons' ? `Parlons Node${status && status.parlons.version ? ' ' + status.parlons.version : ''}` : 'classic Minima node'} />
                  {kind === 'parlons'
                    ? <Row k="Parlons account" v={status ? (status.parlons.error ? 'error — ' + status.parlons.error : status.parlons.ready ? 'up' : 'starting…') : '—'} />
                    : <Row k="Maxima" v={h ? (h.maxima ? 'online' : 'offline') : '—'} />}
                  <Row k="Node version" v={h && h.version ? h.version : '—'} />
                  <Row k="Ports" v={ports ? `p2p ${ports.base} · mds ${ports.mds} · rpc ${ports.rpc}${kind === 'parlons' ? ` · panel ${ports.panel}` : ''}` : '—'} />
                  <Row k="minimaDesk version" v={ports ? ports.appVersion : '—'} />
                </div>
              </div>

              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-2">Updates</div>
                <div className="mb-3 text-core-grey-80">minimaDesk checks its own store feed for a newer build (at start and every 6 hours). A download is verified against the feed's sha256 and saved to your Downloads folder for you to install; nothing installs by itself.</div>
                <div className="mb-3 text-sm break-words">{updLine}</div>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={checkUpdate} disabled={!!updBusy}>{updBusy === 'check' ? 'Checking…' : 'Check now'}</Button>
                  {upd && upd.available && <Button onClick={downloadUpdate} disabled={!!updBusy}>{updBusy === 'download' ? 'Downloading…' : `Download ${upd.version}`}</Button>}
                </div>
                {updMsg && <div className="mt-3 text-sm text-core-grey-80 break-all">{updMsg}</div>}
              </div>

              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-2">Which node</div>
                <div className="mb-3 text-core-grey-80">
                  {kind === 'parlons'
                    ? <>This is the <span className="text-white">Parlons Node</span>: the full Minima node with MiniDapps served by the node itself, plus your Parlons account (chat, calls, payments) under this node's seed, and a Maxima relay for others when you contribute. The Parlons tab is your account.</>
                    : <>This is the <span className="text-white">classic Minima node</span> (the official jar with MDS and classic Maxima). The Parlons Node is the same chain, wallet and data folder, plus your Parlons account under this seed.</>}
                </div>
                <label className="flex items-start gap-3 py-2 cursor-pointer">
                  <input type="radio" name="nodeKind" className="mt-1" checked={(kindPick || kind) === 'parlons'} onChange={() => setKindPick('parlons')} disabled={!!blocker} />
                  <span><span className="text-white">Parlons Node</span> — node + MiniDapps + your Parlons account (recommended){blocker ? <span className="block text-sm text-amber-300">{blocker}</span> : null}</span>
                </label>
                <label className="flex items-start gap-3 py-2 cursor-pointer">
                  <input type="radio" name="nodeKind" className="mt-1" checked={(kindPick || kind) === 'minima'} onChange={() => setKindPick('minima')} />
                  <span><span className="text-white">Classic Minima node</span> — the official jar, classic Maxima, no Parlons account</span>
                </label>
                <div className="mt-2 mb-3">
                  <div className="text-sm text-core-grey-80 mb-1">Parlons Node memory (MB; 0 = automatic: 3072 with MegaMMR, else 1536)</div>
                  <input className="w-full border-2 border-core-black-contrast-3 bg-black outline-none rounded py-2 px-3 text-sm font-mono" inputMode="numeric" value={heap} onChange={(e) => setHeap(e.target.value)} />
                </div>
                <Button variant="secondary" onClick={applyKind} disabled={kindBusy || ((kindPick || kind) === 'parlons' && !!blocker)}>
                  {kindBusy ? 'Restarting…' : 'Apply and restart the node'}
                </Button>
                {kindMsg && <div className="mt-3 text-sm text-core-grey-80">{kindMsg}</div>}
              </div>

              {kind !== 'parlons' && <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-2">Heal Maxima</div>
                <div className="mb-4 text-core-grey-80">
                  Reconnects the relay, re-pins the static MLS and refreshes every contact's address. Use it when a
                  contact changed networks and messages stopped arriving.
                </div>
                <Button onClick={heal} disabled={healing || state !== 'running'} variant="secondary">
                  {healing ? 'Healing…' : 'Heal Maxima'}
                </Button>
                {healMsg && <div className="mt-3 text-sm text-core-grey-80">{healMsg}</div>}
              </div>}

              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-2">RPC access</div>
                <div className="mb-3 text-core-grey-80">
                  {kind === 'parlons'
                    ? <>The Parlons Node's admin RPC listens on <span className="text-white font-mono">127.0.0.1:{ports ? ports.rpc : '…'}</span> only (loopback by construction, no password: anything on this computer that can reach it already runs as you). Every node command works: <span className="text-white font-mono">curl http://127.0.0.1:{ports ? ports.rpc : '…'}/status</span>. The RPC password below is for the classic node.</>
                    : <>The node's RPC uses HTTP Basic auth. User <span className="text-white font-mono">minima</span>, port{' '}
                  <span className="text-white font-mono">{ports ? ports.rpc : '…'}</span> on 127.0.0.1. The password was generated
                  for this install and is stored encrypted; it is copied to your clipboard here without ever being shown.</>}
                </div>
                <Button variant="secondary" onClick={async () => {
                  const r = await minima.rpcCopyPassword();
                  setRpcMsg(r && r.status ? `Password copied — e.g. curl -u minima:<paste> http://127.0.0.1:${r.port}/status` : 'Could not read the RPC secret: ' + ((r && r.error) || 'unknown'));
                }}>
                  Copy RPC password
                </Button>
                {rpcMsg && <div className="mt-3 text-sm text-core-grey-80 break-all">{rpcMsg}</div>}
              </div>

              <div className="bg-contrast1 p-4 rounded mb-5">
                <div className="text-lg -mt-0.5 mb-2">Restart node</div>
                <div className="mb-4 text-core-grey-80">Stops the node cleanly and starts it again. Open MiniDapps will reload.</div>
                <Button onClick={restart} disabled={restarting} variant="secondary">
                  {restarting ? 'Restarting…' : 'Restart node'}
                </Button>
                {restartMsg && <div className="mt-3 text-sm text-core-grey-80">{restartMsg}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SlideScreen>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-4 border-b border-contrast4 border-opacity-40 pb-2">
    <span className="text-core-grey-80">{k}</span>
    <span className="text-right break-all">{v}</span>
  </div>
);

export default MinimaDesk;
