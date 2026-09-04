/*
 * Settings → Startup parameters — the node's data folder, Minima port, EVERY minima.jar startup flag and raw
 * extra arguments, with the exact command line it produces. This is the successor of the old desktop app's
 * "Reconfigure node (startup params)" editor, given a permanent, visible home in Settings.
 *
 * Nothing is applied until "Apply & restart node". Every change is validated in main (params:preview) as
 * you type — the jar refuses to boot on a flag it doesn't know, so unknown flags never get saved. Secret
 * flags (dbpassword, mysqldb) are stored encrypted and only ever travel in the node's 0600 conf file.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import SlideScreen from '../../../../components/UI/SlideScreen';
import Button from '../../../../components/UI/Button';
import Toggle from '../../../../components/UI/Toggle';
import BackButton from '../_BackButton';
import { appContext } from '../../../../AppContext';
import type { ParamItem, ParamValues, StartupConfig, StartupPatch, StartupPreview } from '../../../../../minima';

type Props = { display: boolean; dismiss: () => void };

type Working = { basePort: string; dataFolder: string; params: ParamValues; extraArgs: string };

const INPUT = 'grow min-w-0 border-2 border-core-black-contrast-3 bg-black outline-none rounded py-2 px-3 text-sm font-mono';
const SMALL_BTN = 'text-sm px-3 py-1.5 rounded core-black-contrast-3 hover:opacity-80 disabled:opacity-40 flex-none';

const fromConfig = (c: StartupConfig): Working => ({
  basePort: String(c.basePort), dataFolder: c.dataFolder || '', params: { ...c.values }, extraArgs: c.extraArgs || '',
});

export function StartupParams({ display, dismiss }: Props) {
  const minima = (window as any).minima;
  const { setModal, notify } = useContext(appContext);
  const [cfg, setCfg] = useState<StartupConfig | null>(null);
  const [work, setWork] = useState<Working | null>(null);
  const [secretEdits, setSecretEdits] = useState<Record<string, string>>({});   // typed-but-unsaved secret values
  const [preview, setPreview] = useState<StartupPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = async () => {
    try {
      const c: StartupConfig = await minima.paramsGet();
      if (!mounted.current) return;
      if (!c || !c.status) { setMsg('Could not read the startup configuration: ' + ((c && c.error) || 'unknown error')); return; }
      setCfg(c); setWork(fromConfig(c)); setSecretEdits({}); setPreview(c.preview); setErrors([]); setMsg('');
    } catch (e: any) { if (mounted.current) setMsg(e && e.message ? e.message : String(e)); }
  };
  useEffect(() => { if (display && minima) load(); }, [display]);

  // The patch main validates / applies. Secrets: a typed value wins; else the stored marker (true keeps, false clears).
  const patch = useMemo<StartupPatch | null>(() => {
    if (!work) return null;
    const params: ParamValues = { ...work.params };
    for (const [flag, v] of Object.entries(secretEdits)) params[flag] = v;
    return { basePort: work.basePort, dataFolder: work.dataFolder, params, extraArgs: work.extraArgs };
  }, [work, secretEdits]);

  const dirty = useMemo(() => {
    if (!cfg || !work) return false;
    if (Object.keys(secretEdits).length) return true;
    return JSON.stringify(work) !== JSON.stringify(fromConfig(cfg));
  }, [cfg, work, secretEdits]);

  // Live validation + command-line preview, debounced.
  useEffect(() => {
    if (!display || !patch || !cfg) return;
    const t = setTimeout(async () => {
      try {
        const r = await minima.paramsPreview(patch);
        if (!mounted.current) return;
        setErrors(Array.isArray(r.errors) ? r.errors : []);
        if (r.preview) setPreview(r.preview);
      } catch (e) { /* keep the last preview */ }
    }, 350);
    return () => clearTimeout(t);
  }, [patch, display]);

  const setParam = (flag: string, v: boolean | string) => setWork((w) => (w ? { ...w, params: { ...w.params, [flag]: v } } : w));

  const toggleBool = (it: ParamItem) => {
    if (!work) return;
    const on = work.params[it.flag] === true;
    if (!on && it.danger) {
      setModal({
        display: true, title: `Turn on -${it.flag}?`,
        textContent: it.help + ' This only takes effect when you press Apply & restart node.',
        onConfirm: () => setParam(it.flag, true), onClose: null,
      });
      return;
    }
    setParam(it.flag, !on);
  };

  const pickFolder = async () => {
    try { const f = await minima.paramsPickFolder(); if (f && mounted.current) setWork((w) => (w ? { ...w, dataFolder: f } : w)); } catch (e) {}
  };

  const resetDefaults = () => {
    if (!cfg || !work) return;
    setModal({
      display: true, title: 'Reset startup parameters?',
      textContent: 'Every flag goes back to off / blank, extra arguments are cleared and the data folder goes back to the default. The Minima port is kept. Nothing changes until you press Apply & restart node.',
      onConfirm: () => {
        const params: ParamValues = {};
        for (const g of cfg.groups) for (const it of g.items) params[it.flag] = it.type === 'bool' || it.type === 'secret' ? false : '';
        setWork({ basePort: work.basePort, dataFolder: '', params, extraArgs: '' });
        setSecretEdits({});
      },
      onClose: null,
    });
  };

  const portChanged = !!(cfg && work && String(cfg.basePort) !== String(work.basePort).trim());

  const applyNow = async () => {
    if (!patch) return;
    setBusy(true); setMsg('');
    try {
      const r = await minima.paramsApply(patch);
      if (!mounted.current) return;
      if (!r || !r.status) { setErrors((r && r.errors) || ['failed']); setMsg('Not applied — fix the problems above.'); return; }
      if (r.relaunch) { setMsg('Saved — the Minima port changed, so minimaDesk is relaunching…'); notify('Relaunching minimaDesk on the new port…'); return; }
      setMsg('Saved — the node is restarting with the new parameters.'); notify('Startup parameters applied — restarting node…');
      await load();
    } catch (e: any) { if (mounted.current) setMsg(e && e.message ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const confirmApply = () => {
    if (!patch || errors.length || busy) return;
    setModal({
      display: true,
      title: portChanged ? 'Apply and relaunch minimaDesk?' : 'Apply and restart the node?',
      textContent: portChanged
        ? `The Minima port changes to ${work!.basePort} (MDS ${Number(work!.basePort) + 2}, RPC ${Number(work!.basePort) + 4}). The node stops cleanly and minimaDesk relaunches on the new ports. Open MiniDapps will reload.`
        : 'The node stops cleanly and starts again with these parameters. Open MiniDapps will reload.',
      onConfirm: applyNow, onClose: null,
    });
  };

  const copyCmd = async () => {
    if (!preview) return;
    try { await navigator.clipboard.writeText([preview.java, ...preview.args].join(' ')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) {}
  };

  const secretField = (it: ParamItem) => {
    const stored = work && work.params[it.flag] === true;
    const edit = secretEdits[it.flag];
    const editing = edit !== undefined;
    return (
      <div className="flex gap-2 mt-2">
        <input type="password" className={INPUT} autoComplete="off" spellCheck={false}
          placeholder={stored && !editing ? '•••••••• stored — leave blank to keep' : it.type === 'secret' && it.flag === 'mysqldb' ? 'username:password@host:port' : ''}
          value={editing ? edit : ''}
          onChange={(e) => setSecretEdits((s) => ({ ...s, [it.flag]: e.target.value }))} />
        {(stored || editing) && (
          <button className={SMALL_BTN} onClick={() => {
            // clear: a stored value → marker false (main deletes it); a typed value → forget the edit
            if (editing) setSecretEdits((s) => { const n = { ...s }; delete n[it.flag]; return n; });
            if (stored) setParam(it.flag, false);
          }}>{editing ? 'Undo' : 'Clear'}</button>
        )}
      </div>
    );
  };

  const paramRow = (it: ParamItem) => {
    if (!work) return null;
    const v = work.params[it.flag];
    if (it.type === 'bool') {
      return (
        <div key={it.flag} className="flex items-start gap-4 py-2 border-b border-contrast4 border-opacity-40">
          <div className="grow min-w-0">
            <div className={`text-sm ${it.danger ? 'text-amber-300' : ''}`}>{it.label}</div>
            <div className="text-xs text-core-grey-80">{it.help}</div>
          </div>
          <div className="pt-0.5 flex-none"><Toggle checkedStatus={v === true} onChange={() => toggleBool(it)} /></div>
        </div>
      );
    }
    return (
      <div key={it.flag} className="py-2 border-b border-contrast4 border-opacity-40">
        <div className={`text-sm ${it.danger ? 'text-amber-300' : ''}`}>{it.label}</div>
        <div className="text-xs text-core-grey-80">{it.help}</div>
        {it.type === 'secret' ? secretField(it) : (
          <div className="flex gap-2 mt-2">
            <input className={INPUT} spellCheck={false} inputMode={it.type === 'int' ? 'numeric' : undefined}
              value={typeof v === 'string' ? v : ''} onChange={(e) => setParam(it.flag, e.target.value)} />
          </div>
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
            <div className="mt-6 text-2xl mb-8">Startup parameters</div>
            {!work || !cfg ? (
              <div className="text-core-grey-20">{msg || 'Loading…'}</div>
            ) : (
              <div className="flex flex-col gap-5">
                <p className="text-core-grey-20">
                  How minimaDesk starts the node. Nothing changes until you press <b className="text-white">Apply &amp; restart node</b>.
                  Every parameter the bundled node version accepts is here; anything it wouldn't understand is refused before it is saved.
                </p>

                {/* ---- the command line this produces ---- */}
                <div className="core-black-contrast rounded overflow-hidden">
                  <div className="p-3 text-sm flex items-center justify-between">
                    <span>Command line {dirty ? <span className="text-core-grey-80">· with your unsaved changes</span> : null}</span>
                    <button className="text-sm text-core-grey-80 hover:text-white" onClick={copyCmd} disabled={!preview}>{copied ? <span className="text-status-green">Copied</span> : 'Copy'}</button>
                  </div>
                  <div className="core-black-contrast-2 p-3 font-mono text-xs leading-5 break-all">
                    {preview ? [preview.java, ...preview.args].join(' ') : '—'}
                  </div>
                  <div className="p-3 text-xs text-core-grey-80">
                    The conf file carries rpcpassword, mdspassword{preview && preview.confFlags.length ? ', ' + preview.confFlags.join(', ') : ''} — secrets never go on the command line.
                  </div>
                </div>

                {errors.length > 0 && (
                  <div className="bg-contrast1 border border-amber-300 border-opacity-60 p-4 rounded text-sm">
                    <div className="text-amber-300 mb-1">Can't apply yet</div>
                    <ul className="list-disc pl-5 text-core-grey-20 flex flex-col gap-1">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  </div>
                )}

                {/* ---- core ---- */}
                <div className="bg-contrast1 p-4 rounded">
                  <div className="text-lg -mt-0.5 mb-3">Core</div>
                  <div className="text-sm">Data folder <span className="text-core-grey-80">(-data / -basefolder)</span></div>
                  <div className="text-xs text-core-grey-80">Chain, wallet and installed MiniDapps live here. No spaces in the path. Blank = default.</div>
                  <div className="flex gap-2 mt-2">
                    <input className={INPUT} spellCheck={false} placeholder={cfg.defaultDataFolder} value={work.dataFolder}
                      onChange={(e) => setWork({ ...work, dataFolder: e.target.value })} />
                    <button className={SMALL_BTN} onClick={pickFolder}>Choose…</button>
                    {work.dataFolder && <button className={SMALL_BTN} onClick={() => setWork({ ...work, dataFolder: '' })}>Default</button>}
                  </div>
                  <div className="text-xs text-core-grey-80 mt-2 break-all">Default: <span className="font-mono">{cfg.defaultDataFolder}</span></div>
                  <div className="text-xs text-amber-300 mt-1">Changing the folder starts the node on whatever is (or isn't) in the new folder — it does not move your data.</div>

                  <div className="text-sm mt-5">Minima port <span className="text-core-grey-80">(-port)</span></div>
                  <div className="text-xs text-core-grey-80">P2P and Maxima. MDS is port + 2, RPC is port + 4. Changing it relaunches minimaDesk.</div>
                  <div className="flex gap-2 mt-2 items-center">
                    <input className={INPUT + ' max-w-[10rem]'} inputMode="numeric" value={work.basePort} onChange={(e) => setWork({ ...work, basePort: e.target.value })} />
                    <span className="text-xs text-core-grey-80">mds {Number(work.basePort) ? Number(work.basePort) + 2 : '—'} · rpc {Number(work.basePort) ? Number(work.basePort) + 4 : '—'}</span>
                  </div>
                </div>

                {/* ---- every manifest flag ---- */}
                {cfg.groups.map((g) => (
                  <div key={g.group} className="bg-contrast1 p-4 rounded">
                    <div className="text-lg -mt-0.5 mb-2">{g.group}</div>
                    {g.group.startsWith('Node role') && (
                      <div className="text-xs text-core-grey-80 mb-2">
                        Accepting inbound (-server) is <b className="text-white">Settings → Network → Contribute to the network</b>{cfg.contribute ? ' — currently ON, so Client node / Desktop settings must stay off.' : '.'}
                      </div>
                    )}
                    {g.items.map(paramRow)}
                  </div>
                ))}

                {/* ---- raw extra args ---- */}
                <div className="bg-contrast1 p-4 rounded">
                  <div className="text-lg -mt-0.5 mb-1">Additional arguments</div>
                  <div className="text-xs text-core-grey-80 mb-2">Appended verbatim after everything above. Quotes are respected. Only flags this node version knows are accepted.</div>
                  <textarea className={INPUT + ' w-full'} rows={2} spellCheck={false} placeholder="e.g. -p2p-log-level-info" value={work.extraArgs}
                    onChange={(e) => setWork({ ...work, extraArgs: e.target.value })} />
                </div>

                {/* ---- managed ---- */}
                <div className="bg-contrast1 p-4 rounded">
                  <div className="text-lg -mt-0.5 mb-1">Managed by minimaDesk</div>
                  <div className="text-xs text-core-grey-80 mb-2">Set by the app itself — shown so nothing is hidden, but not editable here.</div>
                  <div className="flex flex-col gap-2 text-sm">
                    {cfg.managedInfo.map((m) => (
                      <div key={m.flag} className="flex justify-between gap-4 border-b border-contrast4 border-opacity-40 pb-2">
                        <span className="font-mono text-xs leading-5 flex-none">-{m.flag}</span>
                        <span className="text-right text-core-grey-80 text-xs leading-5">{m.note}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ---- actions ---- */}
                <div className="bg-contrast1 p-4 rounded mb-5">
                  <div className="flex flex-col gap-3">
                    <Button disabled={!dirty || busy || errors.length > 0} onClick={confirmApply}>
                      {busy ? 'Applying…' : portChanged ? 'Apply & relaunch minimaDesk' : 'Apply & restart node'}
                    </Button>
                    <div className="flex gap-3">
                      <Button variant="secondary" disabled={!dirty || busy} onClick={() => { if (cfg) { setWork(fromConfig(cfg)); setSecretEdits({}); } }}>Discard changes</Button>
                      <Button variant="secondary" disabled={busy} onClick={resetDefaults}>Reset to defaults</Button>
                    </div>
                    {msg && <div className="text-sm text-core-grey-20">{msg}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SlideScreen>
  );
}

export default StartupParams;
