import { useEffect, useRef, useState } from 'react';

/**
 * Node log ring buffer, pulled every 4 s while visible (never streamed — Minima is too chatty for IPC-per-line).
 * "Clear" remembers the buffer's sequence number at that moment; later pulls show only lines logged after it,
 * so identical lines and buffer roll-over cannot un-clear the view.
 */
export default function LogsView({ active }: { active: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const clearedAt = useRef(0);        // logSeq at the time of the last Clear
  const preRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pull = async () => {
      try {
        const r = await window.minima.logs();
        if (!alive || !r || !Array.isArray(r.lines)) return;
        const seq = Number(r.seq) || 0;
        const firstSeq = seq - r.lines.length;               // sequence number of lines[0]
        const skip = Math.max(0, Math.min(r.lines.length, clearedAt.current - firstSeq));
        setLines(r.lines.slice(skip));
      } catch (e) {}
    };
    pull();
    const iv = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(iv); };
  }, [active]);

  useEffect(() => {
    if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines, follow]);

  const clear = async () => {
    try { const r = await window.minima.logs(); clearedAt.current = Number(r && r.seq) || 0; } catch (e) {}
    setLines([]);
  };

  return (
    <>
      <div className="view-head">
        <h2>Node logs</h2>
        <span className="hint">last 300 lines of the node's output, refreshed every 4 s</span>
        <div className="grow" />
        <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>
        <button className="btn" onClick={clear}>Clear</button>
      </div>
      <div className="view-body" ref={preRef}>
        <pre className="logs-pre mono">{lines.join('\n')}</pre>
      </div>
    </>
  );
}
