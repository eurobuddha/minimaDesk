/*
 * Two cards for the Parlons Node kind: bring the CLASSIC node's Maxima contacts and its installed MiniDapps
 * across, ONE BY ONE - the user ticks what comes; nothing is ticked by default and nothing imports on its own.
 * Contacts go through the account (a live introduction; an offline contact can be retried later); dapps are
 * re-packed from the classic node's folder and installed with read permission (a dapp's own data stays behind).
 */
import { useEffect, useState } from 'react';
import Button from '../../../../components/UI/Button';
import type { ClassicContact, ClassicDapp } from '../../../../../minima';

type Result = { key: string; name: string; status: boolean; error: string };

export default function ClassicImports({ accountReady, nodeRunning }: { accountReady: boolean; nodeRunning: boolean }) {
  const minima = (window as any).minima;
  const [contacts, setContacts] = useState<ClassicContact[] | null>(null);
  const [contactsMeta, setContactsMeta] = useState<{ savedAt: number; name: string; error: string }>({ savedAt: 0, name: '', error: '' });
  const [pickC, setPickC] = useState<Set<string>>(new Set());
  const [busyC, setBusyC] = useState(false);
  const [resC, setResC] = useState<Record<string, Result>>({});
  const [dapps, setDapps] = useState<ClassicDapp[] | null>(null);
  const [dappsMeta, setDappsMeta] = useState<{ folder: string; error: string }>({ folder: '', error: '' });
  const [pickD, setPickD] = useState<Set<string>>(new Set());
  const [busyD, setBusyD] = useState(false);
  const [resD, setResD] = useState<Record<string, Result>>({});

  const loadContacts = async () => {
    try {
      const r = await minima.importContactsList();
      if (!r || !r.status) { setContactsMeta({ savedAt: 0, name: '', error: (r && r.error) || 'could not read' }); setContacts([]); return; }
      setContacts(r.contacts || []); setContactsMeta({ savedAt: r.savedAt || 0, name: r.name || '', error: '' });
    } catch (e: any) { setContactsMeta({ savedAt: 0, name: '', error: e && e.message ? e.message : String(e) }); setContacts([]); }
  };
  const loadDapps = async () => {
    try {
      const r = await minima.importDappsList();
      if (!r || !r.status) { setDappsMeta({ folder: '', error: (r && r.error) || 'could not read' }); setDapps([]); return; }
      setDapps(r.dapps || []); setDappsMeta({ folder: r.classicFolder || '', error: '' });
    } catch (e: any) { setDappsMeta({ folder: '', error: e && e.message ? e.message : String(e) }); setDapps([]); }
  };
  useEffect(() => { loadContacts(); loadDapps(); }, [accountReady, nodeRunning]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); setter(n); };
  const importContacts = async () => {
    setBusyC(true);
    try {
      const r = await minima.importContacts([...pickC]);
      const m: Record<string, Result> = {};
      for (const x of (r && r.results) || []) m[String(x.publickey || '').toUpperCase()] = { key: String(x.publickey || ''), name: x.name, status: x.status, error: x.error };
      if (r && !r.status) m['*'] = { key: '*', name: '', status: false, error: r.error || 'import failed' };
      setResC(m); setPickC(new Set([...pickC].filter((k) => m[k.toUpperCase()] && !m[k.toUpperCase()].status)));   // keep the failed ones ticked for a retry
      await loadContacts();
    } finally { setBusyC(false); }
  };
  const importDapps = async () => {
    setBusyD(true);
    try {
      const r = await minima.importDapps([...pickD]);
      const m: Record<string, Result> = {};
      for (const x of (r && r.results) || []) m[String(x.uid || '')] = { key: String(x.uid || ''), name: x.name, status: x.status, error: x.error };
      if (r && !r.status) m['*'] = { key: '*', name: '', status: false, error: r.error || 'import failed' };
      setResD(m); setPickD(new Set([...pickD].filter((k) => m[k] && !m[k].status)));
      await loadDapps();
    } finally { setBusyD(false); }
  };
  const fmtSize = (n: number) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  const importableC = (contacts || []).filter((c) => !c.already);
  const importableD = (dapps || []).filter((d) => !d.installed);

  return (
    <>
      <div className="bg-contrast1 p-4 rounded">
        <div className="text-lg -mt-0.5 mb-2">Contacts from classic Maxima</div>
        <div className="mb-3 text-core-grey-80 text-sm">
          The contacts your classic node had when you switched{contactsMeta.savedAt ? ` (read ${new Date(contactsMeta.savedAt).toLocaleString()})` : ''}. Tick the ones to bring into your Parlons account; each is introduced over the network, so one that is offline right now can be tried again later. Nothing is imported unless you tick it.
        </div>
        {contactsMeta.error && <div className="text-sm text-amber-300 mb-2">{contactsMeta.error}</div>}
        {contacts && contacts.length === 0 && !contactsMeta.error && <div className="text-sm text-core-grey-80">No classic contacts were recorded (switch with "Carry my wallet over" while classic Maxima is up to capture them).</div>}
        {contacts && contacts.length > 0 && (
          <>
            <div className="flex gap-3 text-xs mb-2">
              <button className="text-core-grey-80 hover:text-white" onClick={() => setPickC(new Set(importableC.map((c) => c.publickey)))}>Select all</button>
              <button className="text-core-grey-80 hover:text-white" onClick={() => setPickC(new Set())}>None</button>
            </div>
            <div className="flex flex-col gap-2 max-h-80 overflow-auto">
              {contacts.map((c) => {
                const r = resC[c.publickey.toUpperCase()];
                return (
                  <label key={c.publickey} className={`flex items-start gap-3 p-2 rounded ${c.already ? 'opacity-60' : 'cursor-pointer bg-black bg-opacity-30'}`}>
                    <input type="checkbox" className="mt-1" disabled={c.already || busyC} checked={pickC.has(c.publickey)} onChange={() => toggle(pickC, setPickC, c.publickey)} />
                    <span className="min-w-0">
                      <span className="text-white">{c.name || '(no name)'}</span>{c.already ? <span className="text-status-green text-xs"> · already in your Parlons contacts</span> : null}
                      <span className="block font-mono text-xs text-core-grey-80 break-all">{c.publickey}</span>
                      <span className="block text-xs text-core-grey-80 break-all">{c.mls ? 'via ' + c.mls : c.currentaddress ? 'last seen at ' + c.currentaddress : 'no address known'}</span>
                      {r && <span className={`block text-xs ${r.status ? 'text-status-green' : 'text-amber-300'}`}>{r.status ? 'added' : r.error}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {resC['*'] && <div className="text-sm text-amber-300 mt-2">{resC['*'].error}</div>}
            <div className="mt-3"><Button variant="secondary" disabled={busyC || !pickC.size || !accountReady} onClick={importContacts}>{busyC ? 'Importing…' : `Import ${pickC.size} contact${pickC.size === 1 ? '' : 's'}`}</Button></div>
            {!accountReady && <div className="text-xs text-core-grey-80 mt-2">Waiting for the Parlons account to come up…</div>}
          </>
        )}
      </div>

      <div className="bg-contrast1 p-4 rounded">
        <div className="text-lg -mt-0.5 mb-2">MiniDapps from the classic node</div>
        <div className="mb-3 text-core-grey-80 text-sm">
          The MiniDapps installed in the classic node's folder{dappsMeta.folder ? <> (<span className="font-mono text-xs break-all">{dappsMeta.folder}</span>)</> : null}. Tick the ones to install into the Parlons Node; they start with read permission (grant write from the Pending prompt as usual). A dapp's own data and settings do not come along. Nothing is imported unless you tick it.
        </div>
        {dappsMeta.error && <div className="text-sm text-amber-300 mb-2">{dappsMeta.error}</div>}
        {dapps && dapps.length === 0 && !dappsMeta.error && <div className="text-sm text-core-grey-80">No MiniDapps found in the classic node's folder.</div>}
        {dapps && dapps.length > 0 && (
          <>
            <div className="flex gap-3 text-xs mb-2">
              <button className="text-core-grey-80 hover:text-white" onClick={() => setPickD(new Set(importableD.map((d) => d.uid)))}>Select all</button>
              <button className="text-core-grey-80 hover:text-white" onClick={() => setPickD(new Set())}>None</button>
            </div>
            <div className="flex flex-col gap-2 max-h-80 overflow-auto">
              {dapps.map((d) => {
                const r = resD[d.uid];
                return (
                  <label key={d.uid} className={`flex items-center gap-3 p-2 rounded ${d.installed ? 'opacity-60' : 'cursor-pointer bg-black bg-opacity-30'}`}>
                    <input type="checkbox" disabled={!!d.installed || busyD} checked={pickD.has(d.uid)} onChange={() => toggle(pickD, setPickD, d.uid)} />
                    {d.icon ? <img src={d.icon} alt="" className="w-8 h-8 rounded flex-none object-cover" /> : <span className="w-8 h-8 rounded bg-contrast3 flex-none" />}
                    <span className="min-w-0">
                      <span className="text-white">{d.name}</span> <span className="text-xs text-core-grey-80">v{d.version} · {fmtSize(d.size)}</span>
                      {d.installed ? <span className="block text-xs text-status-green">already on the Parlons Node (v{d.installed})</span> : null}
                      {r && <span className={`block text-xs ${r.status ? 'text-status-green' : 'text-amber-300'}`}>{r.status ? 'installed' : r.error}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {resD['*'] && <div className="text-sm text-amber-300 mt-2">{resD['*'].error}</div>}
            <div className="mt-3"><Button variant="secondary" disabled={busyD || !pickD.size || !nodeRunning} onClick={importDapps}>{busyD ? 'Installing…' : `Install ${pickD.size} MiniDapp${pickD.size === 1 ? '' : 's'}`}</Button></div>
          </>
        )}
      </div>
    </>
  );
}
