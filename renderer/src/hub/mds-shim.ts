/*
 * mds-shim.ts — a `window.MDS` compatible with the subset the MiniHUB uses, backed by the preload bridge.
 *
 * Stock mds.js talks HTTPS to the node's MDS server with a per-dapp session and long-polls for events.
 * In minimaDesk the hub is the app itself (file://, no MDS session), so:
 *   cmd()      → window.minima.cmd (RPC, auth injected in main; RPC is always write mode)
 *   keypair    → prefs:get/set (JSON in userData)
 *   dapplink   → look the dapp up in `mds` by name (uid + sessionid come from the node)
 *   init()     → 'inited' now; NEWBLOCK / MDS_MINIDAPPS_CHANGE from the shell's status push + list poll
 * Everything the hub reads off MDS.filehost still points at the real MDS server.
 */
import { bus } from '../shell/bus';

export function installMdsShim(mdsPort: number) {
  const w = window as any;
  if (w.MDS && w.MDS.__minimadesk) return w.MDS;
  const minima = w.minima;
  let offBlock: (() => void) | null = null;
  let offDapps: (() => void) | null = null;

  const reply = (cb: any, r: any) => { if (typeof cb === 'function') cb(r); };

  const MDS: any = {
    __minimadesk: true,
    filehost: `https://127.0.0.1:${mdsPort}/`,
    mainhost: '',
    minidappuid: 'minimadesk',
    logging: false,
    DEBUG_HOST: null,
    DEBUG_PORT: -1,
    DEBUG_MINIDAPPID: '0x00',

    log(output: any) { console.log('Minima @ ' + new Date().toLocaleString() + ' : ' + output); },
    notify() {},
    notifycancel() {},

    cmd(command: string, callback?: any) {
      minima.cmd(String(command))
        .then((r: any) => reply(callback, r))
        .catch((e: any) => reply(callback, { status: false, error: String(e && e.message ? e.message : e) }));
    },
    sql(_command: string, callback?: any) {
      reply(callback, { status: false, error: 'sql is not available to the minimaDesk hub' });
    },

    keypair: {
      get(key: string, callback?: any) {
        minima.prefsGet(String(key)).then((r: any) => reply(callback, r)).catch(() => reply(callback, { status: false }));
      },
      set(key: string, value: any, callback?: any) {
        minima.prefsSet(String(key), value == null ? '' : String(value))
          .then((r: any) => reply(callback, r)).catch(() => reply(callback, { status: false }));
      },
    },

    dapplink(dappname: string, callback?: any) {
      const want = String(dappname || '').toLowerCase();
      minima.cmd('mds').then((r: any) => {
        const list: any[] = (r && r.status && r.response && r.response.minidapps) || [];
        const app = list.find((a) => a && a.conf && String(a.conf.name || '').toLowerCase() === want);
        if (!app) return reply(callback, { status: false, error: 'MiniDapp not found: ' + dappname });
        reply(callback, {
          status: true,
          uid: app.uid,
          sessionid: app.sessionid,
          base: MDS.filehost + app.uid + '/index.html?uid=' + app.sessionid,
        });
      }).catch((e: any) => reply(callback, { status: false, error: String(e) }));
    },

    init(callback: any) {
      if (offBlock) offBlock();
      if (offDapps) offDapps();
      offBlock = bus.on('block', () => {
        minima.cmd('block').then((r: any) => {
          if (!r || !r.status || !r.response) return;
          const b = r.response;
          callback({ event: 'NEWBLOCK', data: { txpow: { header: { block: b.block, date: b.date, timemilli: b.timemilli } } } });
        }).catch(() => {});
      });
      offDapps = bus.on('dapps', () => callback({ event: 'MDS_MINIDAPPS_CHANGE' }));
      setTimeout(() => callback({ event: 'inited' }), 0);
    },
  };

  w.MDS = MDS;
  return MDS;
}
