import { useEffect, useState } from 'react';

// Keyed by the icon's identity (uid + file + version), NOT the sessioned URL — sessions rotate on every
// permission change and would otherwise leave an un-evicted base64 entry per rotation.
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_ENTRIES = 300;

function keyOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname + '?v=' + (u.searchParams.get('v') || '');
  } catch (e) { return url; }
}

/** Resolve an MDS icon URL to a data URL through main (cached for the session). */
export function resolveIcon(url: string): Promise<string> {
  if (!url) return Promise.resolve('');
  const key = keyOf(url);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (inflight.has(key)) return inflight.get(key)!;
  const p = window.minima.iconData(url)
    .then((d) => { if (cache.size >= MAX_ENTRIES) cache.clear(); cache.set(key, d || ''); inflight.delete(key); return d || ''; })
    .catch(() => { inflight.delete(key); return ''; });
  inflight.set(key, p);
  return p;
}

export function useIcon(url: string): string {
  const [data, setData] = useState(() => (url && cache.get(keyOf(url))) || '');
  useEffect(() => {
    let alive = true;
    if (!url) { setData(''); return; }
    resolveIcon(url).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [url]);
  return data;
}
