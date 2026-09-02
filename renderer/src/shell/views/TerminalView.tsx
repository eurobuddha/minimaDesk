import { useEffect, useRef, useState } from 'react';

interface Entry { id: number; cmd: string; out: string; err: boolean; running: boolean }

export default function TerminalView({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const hist = useRef<string[]>([]);
  const hix = useRef(-1);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (active) setTimeout(() => inputRef.current && inputRef.current.focus(), 30); }, [active]);
  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [entries]);

  const run = async (cmd: string) => {
    const c = cmd.trim();
    if (!c) return;
    hist.current.push(c); hix.current = hist.current.length;
    if (c === 'clear') { setEntries([]); return; }
    const id = ++seq.current;
    setEntries((es) => [...es, { id, cmd: c, out: '…running…', err: false, running: true }]);
    try {
      const res: any = await window.minima.cmd(c);
      const body = res && res.response !== undefined ? res.response : res;
      const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
      setEntries((es) => es.map((e) => (e.id === id ? { ...e, out: text, err: !!(res && res.status === false), running: false } : e)));
    } catch (e: any) {
      setEntries((es) => es.map((x) => (x.id === id ? { ...x, out: (e && e.message) || String(e), err: true, running: false } : x)));
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { const v = input; setInput(''); run(v); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hix.current > 0) { hix.current--; setInput(hist.current[hix.current] || ''); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hix.current < hist.current.length) { hix.current++; setInput(hist.current[hix.current] || ''); } }
  };

  return (
    <>
      <div className="view-head">
        <h2>Terminal</h2>
        <span className="hint">any node command — try <span className="mono">status</span>, <span className="mono">balance</span>, <span className="mono">maxima action:info</span></span>
        <div className="grow" />
        <button className="btn" onClick={() => setEntries([])}>Clear</button>
      </div>
      <div className="view-body" ref={outRef}>
        <div className="term-out mono">
          {entries.length === 0 && <div className="out running">Commands run over RPC with full (write) permission. Type <b>clear</b> to clear.</div>}
          {entries.map((e) => (
            <div key={e.id}>
              <div className="cmd">{e.cmd}</div>
              <div className={`out ${e.err ? 'err' : ''} ${e.running ? 'running' : ''}`}>{e.out}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="term-in">
        <span className="prompt mono">›</span>
        <input ref={inputRef} className="mono" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
          placeholder="command" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
      </div>
    </>
  );
}
