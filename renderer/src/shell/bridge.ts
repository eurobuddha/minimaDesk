/** Helpers over the preload bridge: MDS URLs, icons, store-write policy. */
import type { Dapp } from './ShellContext';

export const minima = () => window.minima;

/** The bundled dapps the shell's Store / Terminal buttons open (provisioned at boot by main/provision.js). */
export const STORE_DAPP = 'minimaCore App Store';
export const TERMINAL_DAPP = 'Terminal IDE';

/** Dapps that get write automatically when opened: stores (their installs must not queue to Pending)
 *  and the terminal (a terminal that queues every command is not a terminal). */
export const AUTO_WRITE = ['minimacore app store', 'terminal ide', 'dapp store', 'pandadapps', 'pandaapps'];

export function filehost(mdsPort: number) {
  return `https://127.0.0.1:${mdsPort}/`;
}

export function dappUrl(mdsPort: number, uid: string, sessionid: string, hash = '') {
  return `${filehost(mdsPort)}${uid}/index.html?uid=${sessionid}${hash || ''}`;
}

/** Icon URL on the loopback MDS server; resolved to a data URL via minima.iconData (self-signed cert). */
export function iconUrl(mdsPort: number, d: Dapp | undefined | null) {
  if (!mdsPort || !d || !d.conf || !d.conf.icon) return '';
  const v = encodeURIComponent(String(d.conf.version || ''));
  return `${filehost(mdsPort)}${d.uid}/${encodeURI(String(d.conf.icon))}?uid=${d.sessionid || ''}&v=${v}`;
}

/** Parse https://127.0.0.1:<mds>/<uid>/index.html?uid=<sessionid>[#hash] (any loopback host/port). */
export function parseDappUrl(url: string): { uid: string; sessionid: string; hash: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    const uid = seg[0] || '';
    if (!/^0x[0-9a-fA-F]+$/.test(uid)) return null;
    return { uid, sessionid: u.searchParams.get('uid') || '', hash: u.hash || '' };
  } catch (e) {
    return null;
  }
}
