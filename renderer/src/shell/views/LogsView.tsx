import { useEffect, useRef, useState } from 'react';

/** Node log ring buffer, pulled every 4 s while visible (never streamed — Minima is too chatty for IPC-per-line). */
export default function LogsView({ active }: { active: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const marker = useRef<string | null>(null); // "Clear" hides everything up to this line until the buffer rolls past it
  const preRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pull = async () => {
      try {
        const ls = await window.minima.logs();
        if (!alive || !Array.isArray(ls)) return;
        let view = ls;
        if (marker.current) {
          const ix = ls.lastIndexOf(marker.current);
          view = ix >= 0 ? ls.slice(ix + 1) : ls;
        }
        setLines(view);
      } catch (e) {}
    };
    pull();
    const iv = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(iv); };
  }, [active]);

  useEffect(() => {
    if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines, follow]);

  const clear = () => { marker.current = lines.length ? lines[lines.length - 1] : null; setLines([]); };

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
