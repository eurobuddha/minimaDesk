/*
 * Native MiniDapp Store data layer (ported verbatim from the previous shell).
 * The stock third-party "Dapp Store" dapp points at official /data/*.json paths that now 404; this store
 * fetches a repository descriptor through main and installs/updates through the node's `mds action:…`.
 */
export interface StoreRepo { id: string; name: string; url: string; base?: string }
export interface StoreItem { name: string; version?: string; description?: string; icon: string; file: string }
export interface StoreHead { name: string; description: string; icon: string }

export const STORE_REPOS: StoreRepo[] = [
  { id: 'panda', name: 'PandaDapps', url: 'https://eurobuddha.com/pandadapps.json' },
  { id: 'official', name: 'Minima Official', url: 'https://minidapps.minima.global/dapps.json', base: 'https://minidapps.minima.global' },
];

export function absUrl(u: string | undefined, base: string) {
  if (!u) return '';
  try { return new URL(u, base).toString(); } catch (e) { return u; }
}

/** Normalise either repo shape into { head, list:[{ name, version, description, icon, file }] }. */
export function normaliseStore(repo: StoreRepo, json: any): { head: StoreHead; list: StoreItem[] } {
  const head: StoreHead = { name: repo.name, description: '', icon: '' };
  let list: StoreItem[] = [];
  if (Array.isArray(json)) {
    // official shape: [{ name, filename, icon(relative), description, version }]
    const base = repo.base || repo.url;
    list = json.map((d: any) => ({
      name: d.name, version: d.version, description: d.description,
      icon: absUrl(d.icon, base + '/'),
      file: d.file ? absUrl(d.file, base + '/') : (d.filename ? base + '/downloads/' + d.filename : ''),
    }));
  } else if (json && Array.isArray(json.dapps)) {
    // repository shape: { name, description, icon, dapps:[{ name, file, icon, description, version }] }
    head.name = json.name || repo.name;
    head.description = json.description || '';
    head.icon = absUrl(json.icon, repo.url);
    list = json.dapps.map((d: any) => ({
      name: d.name, version: d.version, description: d.description,
      icon: absUrl(d.icon, repo.url),
      file: absUrl(d.file || d.filename, repo.url),
    }));
  }
  return { head, list: list.filter((d) => d.name && d.file) };
}
