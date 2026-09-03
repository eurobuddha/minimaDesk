/*
 * minimaDesk settings section — desktop-only facts and actions that the stock hub has no home for:
 * app version + ports, node state, Heal Maxima, restart the node.
 */
import { useEffect, useState } from 'react';
import SlideScreen from '../../../../components/UI/SlideScreen';
import Button from '../../../../components/UI/Button';
import BackButton from '../_BackButton';

type Props = { display: boolean; dismiss: () => void };

export function MinimaDesk({ display, dismiss }: Props) {
  const minima = (window as any).minima;
  const [ports, setPorts] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [healing, setHealing] = useState(false);
  const [healMsg, setHealMsg] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [rpcMsg, setRpcMsg] = useState('');

  useEffect(() => {
    if (!display || !minima) return;
    minima.ports().then(setPorts).catch(() => {});
    minima.snapshot().then(setStatus).catch(() => {});
    const off = minima.onStatus(setStatus);
    return () => { off && off(); };
  }, [display]);

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

  const restart = async () => {
    setRestarting(true);
    try { await minima.nodeRestart(); } finally { setRestarting(false); }
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
                  <Row k="Maxima" v={h ? (h.maxima ? 'online' : 'offline') : '—'} />
                  <Row k="Node version" v={h && h.version ? h.version : '—'} />
                  <Row k="Ports" v={ports ? `p2p ${ports.base} · mds ${ports.mds} · rpc ${ports.rpc}` : '—'} />
                  <Row k="minimaDesk version" v={ports ? ports.appVersion : '—'} />
                </div>
              </div>

              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-2">Heal Maxima</div>
                <div className="mb-4 text-core-grey-80">
                  Reconnects the relay, re-pins the static MLS and refreshes every contact's address. Use it when a
                  contact changed networks and messages stopped arriving.
                </div>
                <Button onClick={heal} disabled={healing || state !== 'running'} variant="secondary">
                  {healing ? 'Healing…' : 'Heal Maxima'}
                </Button>
                {healMsg && <div className="mt-3 text-sm text-core-grey-80">{healMsg}</div>}
              </div>

              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-2">RPC access</div>
                <div className="mb-3 text-core-grey-80">
                  The node's RPC uses HTTP Basic auth. User <span className="text-white font-mono">minima</span>, port{' '}
                  <span className="text-white font-mono">{ports ? ports.rpc : '…'}</span> on 127.0.0.1. The password was generated
                  for this install and is stored encrypted; it is copied to your clipboard here without ever being shown.
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
