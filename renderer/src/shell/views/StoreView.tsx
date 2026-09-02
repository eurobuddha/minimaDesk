import { useEffect, useState } from 'react';
import { useShell } from '../ShellContext';
import { STORE_REPOS, normaliseStore } from './store';
import type { StoreHead, StoreItem, StoreRepo } from './store';

export default function StoreView({ active }: { active: boolean }) {
  const { dapps, nodeRunning, refreshDapps, checkPending } = useShell();
  const [repo, setRepo] = useState<StoreRepo>(STORE_REPOS[0]);
  const [head, setHead] = useState<StoreHead | null>(null);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msgs, setMsgs] = useState<Record<string, { text: string; cls: string }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = async (r: StoreRepo = repo) => {
    setLoading(true); setError('');
    try {
      const res = await window.minima.storeFetch(r.url);
      if (!res || !res.status) throw new Error((res && res.error) || 'fetch failed');
      const n = normaliseStore(r, res.response);
      setHead(n.head); setItems(n.list);
    } catch (e: any) {
      setHead(null); setItems([]); setError(e && e.message ? e.message : String(e));
    } finally { setLoading(false); setLoadedOnce(true); }
  };

  useEffect(() => { if (active && !loadedOnce) load(); }, [active]);

  const installedByName = (name: string) => dapps.find((d) => String(d.conf.name || '').toLowerCase() === String(name || '').toLowerCase());

  const install = async (it: StoreItem) => {
    if (!nodeRunning) { setMsgs((m) => ({ ...m, [it.file]: { text: 'node is not running yet', cls: 'err' } })); return; }
    const inst = installedByName(it.name);
    setBusy((b) => ({ ...b, [it.file]: true }));
    setMsgs((m) => ({ ...m, [it.file]: { text: 'downloading…', cls: '' } }));
    try {
      setMsgs((m) => ({ ...m, [it.file]: { text: inst ? 'updating…' : 'installing…', cls: '' } }));
      const r = await window.minima.storeInstall(it.file, inst ? inst.uid : null);
      if (r && r.status) setMsgs((m) => ({ ...m, [it.file]: { text: inst ? 'updated ✓' : 'installed ✓', cls: 'ok' } }));
      else setMsgs((m) => ({ ...m, [it.file]: { text: (r && (r.error || (r.response && r.response.message))) || 'failed', cls: 'err' } }));
    } catch (e: any) {
      setMsgs((m) => ({ ...m, [it.file]: { text: e && e.message ? e.message : String(e), cls: 'err' } }));
    } finally {
      setBusy((b) => ({ ...b, [it.file]: false }));
      await refreshDapps();
      await checkPending();
    }
  };

  return (
    <>
      <div className="view-head">
        <h2>MiniDapp Store</h2>
        <span className="hint">install from a repository, or update what you already have</span>
        <div className="grow" />
        <select value={repo.id} onChange={(e) => { const r = STORE_REPOS.find((x) => x.id === e.target.value) || STORE_REPOS[0]; setRepo(r); load(r); }}>
          {STORE_REPOS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className="btn" onClick={() => load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div className="view-body store-body">
        {head && (
          <div className="store-head">
            {head.icon && <img src={head.icon} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
            <div>
              <div className="nm">{head.name}</div>
              {head.description && <div>{head.description}</div>}
            </div>
          </div>
        )}
        {error && <div className="store-empty">Could not load {repo.name}: {error}</div>}
        {!error && !loading && items.length === 0 && loadedOnce && <div className="store-empty">This repository has no MiniDapps.</div>}
        <div className="store-grid">
          {items.map((it) => {
            const inst = installedByName(it.name);
            const m = msgs[it.file];
            return (
              <div className="scard" key={it.file}>
                <div className="top">
                  {it.icon ? <img src={it.icon} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="mono-i">{(it.name || '?').charAt(0).toUpperCase()}</div>}
                  <div>
                    <div className="nm">{it.name}</div>
                    <div className="ver">{it.version ? 'v' + it.version : ''}{inst ? (it.version ? ' · ' : '') + 'installed' + (inst.conf.version ? ' v' + inst.conf.version : '') : ''}</div>
                  </div>
                </div>
                {it.description && <div className="desc">{it.description}</div>}
                <div className="acts">
                  <button className={`btn ${inst ? 'ghost' : ''}`} disabled={!!busy[it.file]} onClick={() => install(it)}>
                    {busy[it.file] ? '…' : inst ? 'Update' : 'Install'}
                  </button>
                  {m && <span className={`smsg ${m.cls}`}>{m.text}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
