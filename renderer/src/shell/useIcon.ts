import { useEffect, useState } from 'react';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** Resolve an MDS icon URL to a data URL through main (cached for the session). */
export function resolveIcon(url: string): Promise<string> {
  if (!url) return Promise.resolve('');
  if (cache.has(url)) return Promise.resolve(cache.get(url)!);
  if (inflight.has(url)) return inflight.get(url)!;
  const p = window.minima.iconData(url)
    .then((d) => { cache.set(url, d || ''); inflight.delete(url); return d || ''; })
    .catch(() => { inflight.delete(url); return ''; });
  inflight.set(url, p);
  return p;
}

export function useIcon(url: string): string {
  const [data, setData] = useState(() => (url && cache.get(url)) || '');
  useEffect(() => {
    let alive = true;
    if (!url) { setData(''); return; }
    resolveIcon(url).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [url]);
  return data;
}
