/*
 * Settings → Network — mirrors minimaCore Desktop's "Contribute to the network" (server role + UPnP/NAT-PMP
 * port mapping, honest reachability, manual-forward how-to) and Parlons' Location service / Hosts cards for
 * Maxima (pin a static MLS, choose the relay to attach to).
 *
 * The rule inherited from minimaCore Desktop: only ONE thing proves inbound works — a real incoming peer.
 * A router accepting the mapping proves nothing (a Plusnet Hub Two stores it Enabled=1 and leaves the port
 * shut), so the mapped copy says "asked your router", never "the port is open".
 */
import { useContext, useEffect, useRef, useState } from 'react';
import SlideScreen from '../../../../components/UI/SlideScreen';
import Button from '../../../../components/UI/Button';
import Toggle from '../../../../components/UI/Toggle';
import BackButton from '../_BackButton';
import { appContext } from '../../../../AppContext';
import type { KnownRelay, MlsPolicy, NodeSnapshot, PortmapStatus } from '../../../../../minima';

type Props = { display: boolean; dismiss: () => void };

const CONTRIB_HINT_MS = 15 * 60_000;

/** RFC1918 + CGNAT + link-local + loopback — i.e. not an address the outside world can reach. */
function isPrivateAddr(a: string) {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|127\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(String(a || ''));
}

/** The "Network help" verdict for a contributing node (ported from minimaCore Desktop). */
function contribHelp(s: NodeSnapshot, port: number): { tone: 'ok' | 'warn' | ''; text: string; howto?: boolean } {
  const h: any = s.health || {};
  const pm: PortmapStatus | undefined = s.portmap;
  const state = pm ? pm.state : 'off';
  if ((h.incoming || 0) > 0) return { tone: 'ok', text: `● Reachable — ${h.incoming} incoming peer${h.incoming === 1 ? '' : 's'}` };
  if (state === 'double_nat') return { tone: 'warn', text: "Your router is behind another one (carrier-grade NAT), so other nodes can't dial in. You still help by relaying blocks and transactions." };
  if (state === 'mapped') {
    const up = s.uptimeMs || 0;
    if (h.acceptingInLinks === false && up > 70 * 60_000)
      return { tone: 'warn', text: "Your router accepted the request but nothing is getting through — some routers report success without actually opening the port. You'll need to forward it yourself. You're still helping by relaying meanwhile.", howto: true };
    if (up > CONTRIB_HINT_MS)
      return { tone: 'warn', text: 'No incoming peers yet. Other nodes normally dial back within minutes, so your router may have accepted the request without really opening the port — if this sticks, forward it yourself.', howto: true };
    return { tone: '', text: `Asked your router to open port ${port} — not confirmed yet. Waiting for the first incoming peer.` };
  }
  if (state === 'searching') return { tone: '', text: `Asking your router to open port ${port}…` };
  if (state === 'no_gateway') return { tone: 'warn', text: "Your router didn't answer — automatic port opening (UPnP/NAT-PMP) is off or blocked. You can forward the port yourself, or keep helping as an outbound node.", howto: true };
  if (state === 'mapping_refused') return { tone: 'warn', text: `Your router refused to open port ${port} — UPnP may be disabled, or that port is already forwarded to another device.`, howto: true };
  if (state === 'error') return { tone: 'warn', text: 'Port mapping error — retrying automatically.' };
  return { tone: '', text: 'starting…' };
}

const toneClass = (t: 'ok' | 'warn' | '') => (t === 'ok' ? 'text-status-green' : t === 'warn' ? 'text-amber-300' : 'text-core-grey-20');

export function Network({ display, dismiss }: Props) {
  const minima = (window as any).minima;
  const { setModal, notify } = useContext(appContext);
  const [status, setStatus] = useState<NodeSnapshot | null>(null);
  const [cfg, setCfg] = useState<{ contribute: boolean; maximaRelay: string; mls: MlsPolicy; knownRelays: KnownRelay[]; basePort: number } | null>(null);
  const [info, setInfo] = useState<any>(null);          // maxima action:info
  const [hosts, setHosts] = useState<any[]>([]);        // maxima action:hosts
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [customRelay, setCustomRelay] = useState('');
  const [customMls, setCustomMls] = useState('');
  const [copied, setCopied] = useState(false);

  const refreshMaxima = async () => {
    try {
      const i = await minima.cmd('maxima action:info');
      if (i && i.status) setInfo(i.response);
      const h = await minima.cmd('maxima action:hosts');
      if (h && h.status) setHosts((h.response && h.response.hosts) || []);
    } catch (e) { /* node booting */ }
  };
  const refreshCfg = async () => { try { setCfg(await minima.netConfig()); } catch (e) {} };
  useEffect(() => {
    if (!display || !minima) return;
    refreshCfg();
    minima.snapshot().then(setStatus).catch(() => {});
    refreshMaxima();
    const off = minima.onStatus(setStatus);
    const iv = setInterval(refreshMaxima, 6000);
    return () => { off && off(); clearInterval(iv); };
  }, [display]);

  const seededMls = useRef(false);
  useEffect(() => {
    if (!seededMls.current && cfg && cfg.mls.mode === 'custom' && cfg.mls.custom) { seededMls.current = true; setCustomMls(cfg.mls.custom); }
  }, [cfg]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // the node returns staticmls either as the host itself or as `true` with the host in `mls`
  const looksLikeHost = (v: any) => typeof v === 'string' && /^Mx.+@.+:\d+$/.test(v);
  const pinned = info ? (looksLikeHost(info.staticmls) ? String(info.staticmls) : (info.staticmls === true && looksLikeHost(info.mls) ? String(info.mls) : '')) : '';
  // Parlons method: the permanent address is anchored to the relay this node is attached to. The relays
  // run a federated MLS mesh, so any of them resolves MAX#<publickey>#<relay identity> — no registration.
  const attachedHost = cfg ? cfg.maximaRelay : '';
  const attached = hosts.find((x) => x && x.host === attachedHost);
  const relayIdentity = attached && looksLikeHost(attached.address) ? String(attached.address) : '';
  const relayLabel = (cfg && (cfg.knownRelays.find((r) => r.host === attachedHost) || {}).label) || attachedHost;
  const permanentAddress = pinned && info && info.publickey ? `MAX#${info.publickey}#${pinned}` : '';
  const anchoredToRelay = !!pinned && !!relayIdentity && pinned === relayIdentity;
  const copyPermanent = async () => {
    if (!permanentAddress) return;
    try { await navigator.clipboard.writeText(permanentAddress); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) {}
  };

  const port = (cfg && cfg.basePort) || (status && status.basePort) || 0;
  const contributing = !!(cfg ? cfg.contribute : status && status.contribute);
  const pm = status && status.portmap;
  const h: any = (status && status.health) || {};
  const help = status ? contribHelp(status, port) : { tone: '' as const, text: '—' };
  const p2pIp = String(h.p2pAddress || '').split(':')[0];
  const showAddr = !!p2pIp && !isPrivateAddr(p2pIp);
  const addrOk = showAddr && !!(pm && pm.externalIp) && p2pIp === (pm && pm.externalIp);

  const run = async (key: string, fn: () => Promise<any>, okText: string) => {
    if (busy) return;
    setBusy(key); setMsg('');
    try {
      const r = await fn();
      if (!mounted.current) return;
      if (r && r.status === false) { setMsg((r.error || 'failed') as string); notify('Network: ' + (r.error || 'failed')); }
      else { setMsg(okText); notify(okText); }
    } catch (e: any) { if (mounted.current) setMsg(e && e.message ? e.message : String(e)); }
    finally { if (mounted.current) { setBusy(''); await refreshCfg(); await refreshMaxima(); } }
  };

  const toggleContribute = () => {
    if (busy) return;                      // a restart is already in flight
    const turnOn = !contributing;
    setModal({
      display: true,
      title: turnOn ? 'Contribute to the network?' : 'Stop contributing?',
      textContent: turnOn
        ? `Your node will accept incoming connections and help other nodes sync — and act as a Maxima host for others. This asks your router to open TCP ${port} (UPnP/NAT-PMP) and restarts the node now. Not all routers allow this — if yours doesn't, you can forward the port yourself; you'll still help by relaying meanwhile.`
        : 'Your node goes back to outbound-only connections, the router port is closed, and the node restarts now.',
      onConfirm: () => run('contribute', () => minima.netSetContribute(turnOn), turnOn ? 'Contributing — restarting node…' : 'Back to a light node — restarting node…'),
      onClose: null,
    });
  };

  const relayRow = (host: string, label: string) => {
    const hx = hosts.find((x) => x && x.host === host);
    const selected = cfg && cfg.maximaRelay === host;
    return (
      <div key={host} className={`flex items-center gap-3 py-2 border-b border-contrast4 border-opacity-40 ${selected ? 'text-white' : 'text-core-grey-20'}`}>
        <div className="w-2 h-2 rounded-full" style={{ background: hx && hx.connected ? 'var(--status-green)' : 'var(--core-black-contrast-3)' }} title={hx && hx.connected ? 'connected' : 'not connected'} />
        <div className="grow min-w-0">
          <div className="text-sm">{label}{selected ? <span className="text-core-grey-80"> · attached</span> : null}</div>
          <div className="text-xs text-core-grey-80 break-all">{host}</div>
        </div>
        {!selected && (
          <button className="text-sm px-3 py-1.5 rounded core-black-contrast-3 hover:opacity-80 disabled:opacity-40" disabled={!!busy}
            onClick={() => run('relay', () => minima.netSetMaximaRelay(host), `Attached to ${host}`)}>Use</button>
        )}
      </div>
    );
  };

  return (
    <SlideScreen display={display}>
      <div className="flex flex-col h-fit bg-black">
        <div className="pt-16 px-4 lg:px-0 w-full pb-4 flex flex-col">
          <div className="max-w-xl mx-auto w-full">
            <BackButton dismiss={dismiss} />
            <div className="mt-6 text-2xl mb-8">Network</div>
            <div className="flex flex-col gap-5">
              <p className="text-core-grey-20">Become a reachable full node, and choose how Maxima finds you.</p>

              {/* ---- Contribute to the network ---- */}
              <div className="bg-contrast1 p-4 rounded">
                <div className="flex items-start gap-4">
                  <div className="grow">
                    <div className="text-lg -mt-0.5 mb-1">Contribute to the network</div>
                    <div className="text-core-grey-80 text-sm">
                      Your node also accepts connections and helps other nodes sync, and acts as a Maxima host for others.
                      Asks your router to open your Minima port (UPnP/NAT-PMP). Many home routers refuse or silently
                      ignore the request, so this isn't guaranteed; you can always forward the port yourself.
                    </div>
                  </div>
                  <div className="pt-1"><Toggle checkedStatus={contributing} onChange={toggleContribute} /></div>
                </div>
                <div className="mt-4 flex flex-col gap-2 text-sm">
                  <Row k="Role" v={contributing ? 'contributing (server — accepts inbound)' : 'light node (outbound only)'} />
                  <Row k="Minima port" v={port ? `TCP ${port}` : '—'} />
                  <Row k="Peers" v={h.connections !== undefined ? `${h.connections}${contributing ? ` · ${h.incoming || 0} incoming` : ''}` : '—'} />
                  {contributing && <Row k="Network help" v={help.text} cls={toneClass(help.tone)} />}
                  {contributing && showAddr && <Row k="Public address" v={`${h.p2pAddress}${addrOk ? ' ✓' : ''}`} mono />}
                  {contributing && pm && pm.externalIp && <Row k="Router's external IP" v={pm.externalIp} mono />}
                  {contributing && pm && pm.routerName && <Row k="Router" v={pm.routerName} />}
                </div>
                {contributing && help.howto && pm && (
                  <div className="mt-4 p-3 rounded bg-contrast2 text-sm">
                    <div className="font-bold mb-2">How to open port {port} yourself</div>
                    <div className="text-core-grey-80 mb-2">
                      In {pm.routerName || "your router"}'s settings ({pm.gatewayIp ? (
                        <span className="text-white underline cursor-pointer" onClick={() => minima.openExternal('http://' + pm.gatewayIp)}>http://{pm.gatewayIp}</span>
                      ) : "your router's admin page"}), find <b className="text-white">Port forwarding</b> and add:
                    </div>
                    <Row k="Protocol" v="TCP" />
                    <Row k="External port" v={String(port)} />
                    <Row k="Internal port" v={String(port)} />
                    <Row k="Send to" v={`${pm.lanIp || "this computer's IP address"} (this computer)`} mono />
                    <div className="text-core-grey-80 mt-2">
                      Also reserve <b className="text-white">{pm.lanIp || 'this computer'}</b> for this computer in your router's DHCP settings —
                      otherwise the address can change and the forward will quietly stop working.
                      {pm.routerName ? ` Searching for “${pm.routerName} port forwarding” will show the exact screens.` : ''}
                    </div>
                  </div>
                )}
              </div>

              {/* ---- Permanent address (Parlons method: anchored to the attached relay) ---- */}
              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-1">Permanent address · MAX#</div>
                <div className="text-core-grey-80 text-sm mb-4">
                  Your permanent address is anchored to the always-on relay you are attached to (see Hosts below). The relays
                  run a federated Location Service mesh, so any of them can resolve it — nothing to register, and it stays
                  valid as you move between networks.
                </div>
                {permanentAddress ? (
                  <div className="core-black-contrast rounded overflow-hidden mb-4">
                    <div className="p-3 text-sm flex items-center justify-between">
                      <span>Your permanent address</span>
                      <button className="text-sm text-core-grey-80 hover:text-white" onClick={copyPermanent}>{copied ? <span className="text-status-green">Copied</span> : 'Copy'}</button>
                    </div>
                    <div className="core-black-contrast-2 p-3 font-mono text-xs leading-5 break-all">{permanentAddress}</div>
                    <div className="p-3 text-xs">
                      {anchoredToRelay
                        ? <span className="text-status-green">● Anchored to {relayLabel} — your pinned Location Service matches the attached relay{attached && attached.connected ? ', which is connected' : ''}</span>
                        : <span className="text-amber-300">Pinned to a Location Service other than your attached relay{cfg && cfg.mls.mode === 'custom' ? ' (custom MLS)' : ''}. Press the button below to anchor it to the relay instead.</span>}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-core-grey-20 mb-4">
                    {attached && !attached.connected ? `Waiting for the relay ${relayLabel} to connect…` : relayIdentity ? 'No permanent address yet.' : 'Waiting for the relay to announce its identity…'}
                  </div>
                )}
                {!anchoredToRelay && (
                  <Button disabled={!!busy || !relayIdentity} onClick={() => run('perm', () => minima.netSetMls('relay'), 'Permanent address set — anchored to the attached relay')}>
                    {busy === 'perm' ? 'Setting…' : 'Make this my permanent address'}
                  </Button>
                )}
              </div>

              {/* ---- Location service (static MLS) ---- */}
              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-1">Location service · finds you when you move</div>
                <div className="text-core-grey-80 text-sm mb-4">
                  Which Location Service tells your contacts where you are when you change networks. "Pin the attached relay" is the Parlons method and what your permanent address above is built on.
                </div>
                <div className="flex flex-col gap-2 text-sm">
                  <Row k="Mode" v={info ? (info.staticmls ? 'static (pinned)' : 'rotating (host-assigned)') : '—'} />
                  <Row k="Your Maxima address" v={info && info.contact ? info.contact : '—'} mono />
                  <Row k="Pinned MLS" v={pinned ? pinned : (info && info.mls ? `${info.mls} (host-assigned)` : '—')} mono />
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <Choice on={!!cfg && cfg.mls.mode === 'relay'} title="Pin the attached relay (recommended)" sub={'What “Make this my permanent address” does: your MAX# is anchored to the relay you are attached to.'} onClick={() => run('mls', () => minima.netSetMls('relay'), 'Pinning the attached relay…')} />
                  <Choice on={!!cfg && cfg.mls.mode === 'custom'} title="Custom MLS" sub="Pin a Location Service of your own (Mx…@host:port)." onClick={() => { if (customMls.trim()) run('mls', () => minima.netSetMls('custom', customMls.trim()), 'Pinned your MLS'); }}>
                    <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                      <input className="grow border-2 border-core-black-contrast-3 bg-black outline-none rounded py-2 px-3 text-sm" placeholder="Mx…@host:port" value={customMls} onChange={(e) => setCustomMls(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && customMls.trim()) run('mls', () => minima.netSetMls('custom', customMls.trim()), 'Pinned your MLS'); }} />
                      <button className="text-sm px-3 rounded core-black-contrast-3 hover:opacity-80 disabled:opacity-40" disabled={!!busy || !customMls} onClick={() => run('mls', () => minima.netSetMls('custom', customMls), 'Pinned your MLS')}>Pin</button>
                    </div>
                  </Choice>
                  <Choice on={!!cfg && cfg.mls.mode === 'host'} title="Use the host's directory" sub="Rotating: your address changes whenever your Maxima host changes." onClick={() => run('mls', () => minima.netSetMls('host'), "Using the host's directory")} />
                </div>
              </div>

              {/* ---- Hosts / relay ---- */}
              <div className="bg-contrast1 p-4 rounded">
                <div className="text-lg -mt-0.5 mb-1">Hosts · they relay your traffic</div>
                <div className="text-core-grey-80 text-sm mb-3">
                  minimaDesk attaches your node to ONE always-on relay so Maxima reaches you behind NAT. Attaching to several
                  delivers every message several times, so pick one.
                </div>
                {cfg && cfg.knownRelays.map((r) => relayRow(r.host, r.label))}
                {cfg && !cfg.knownRelays.some((r) => r.host === cfg.maximaRelay) && relayRow(cfg.maximaRelay, 'Custom relay')}
                <div className="flex gap-2 mt-3">
                  <input className="grow border-2 border-core-black-contrast-3 bg-black outline-none rounded py-2 px-3 text-sm" placeholder="add relay  host:port" value={customRelay} onChange={(e) => setCustomRelay(e.target.value)} />
                  <button className="text-sm px-3 rounded core-black-contrast-3 hover:opacity-80 disabled:opacity-40" disabled={!!busy || !/^[A-Za-z0-9.\-]+:\d{1,5}$/.test(customRelay.trim())}
                    onClick={() => run('relay', () => minima.netSetMaximaRelay(customRelay.trim()), `Attached to ${customRelay.trim()}`)}>Use</button>
                </div>
              </div>

              {/* ---- Actions ---- */}
              <div className="bg-contrast1 p-4 rounded mb-5">
                <div className="text-lg -mt-0.5 mb-3">Fix-ups</div>
                <div className="flex flex-col gap-3">
                  <Button variant="secondary" disabled={!!busy} onClick={() => run('heal', () => minima.healMaxima(), 'Maxima healed — relay reconnected and contacts refreshed')}>
                    {busy === 'heal' ? 'Healing…' : 'Heal Maxima'}
                  </Button>
                  <div className="text-core-grey-80 text-sm -mt-1">Reconnects the relay, re-applies the Location service and refreshes every contact — use after a network change.</div>
                  <Button variant="secondary" disabled={!!busy} onClick={() => run('ip', async () => { const r = await minima.cmd('network action:recalculateip'); if (!r || !r.status) return r; return minima.healMaxima(); }, 'Recalculated your IP and healed Maxima')}>
                    {busy === 'ip' ? 'Working…' : 'My IP changed'}
                  </Button>
                  <div className="text-core-grey-80 text-sm -mt-1">Tell the node to work out its address again (new Wi-Fi, VPN on/off), then heal.</div>
                  {msg && <div className="text-sm text-core-grey-20">{msg}</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SlideScreen>
  );
}

const Row = ({ k, v, cls, mono }: { k: string; v: string; cls?: string; mono?: boolean }) => (
  <div className="flex justify-between gap-4 border-b border-contrast4 border-opacity-40 pb-2">
    <span className="text-core-grey-80 flex-none">{k}</span>
    <span className={`text-right break-all ${cls || ''} ${mono ? 'font-mono text-xs leading-5' : ''}`}>{v}</span>
  </div>
);

const Choice = ({ on, title, sub, onClick, children }: { on: boolean; title: string; sub: string; onClick: () => void; children?: any }) => (
  <div className={`p-3 rounded cursor-pointer ${on ? 'bg-contrast2 border border-contrast4' : 'bg-black bg-opacity-40'}`} onClick={onClick}>
    <div className="flex items-center gap-3">
      <div className={`w-4 h-4 rounded-full border ${on ? 'border-white bg-white' : 'border-core-grey-80'}`} />
      <div className="grow">
        <div className="text-sm">{title}</div>
        <div className="text-xs text-core-grey-80">{sub}</div>
      </div>
    </div>
    {children}
  </div>
);

export default Network;
