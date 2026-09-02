/*
 * shell-bridge.ts — the hub's only door into the shell.
 *
 * In the stock MiniHUB every tile does `window.open(MDS.filehost + uid + '/index.html?uid=' + sessionid)`.
 * In minimaDesk those calls become `shell.openDapp(...)` and land in the tab strip; the synthetic
 * Node logs tile calls `shell.openNative('logs')`.
 * The shell registers its handlers once at boot (ShellContext).
 */
export type OpenDappArgs = { uid: string; sessionid?: string; name?: string; icon?: string; hash?: string };
export type NativeView = 'logs';

type Handlers = {
  openDapp: (a: OpenDappArgs) => void | Promise<void>;
  openNative: (v: NativeView) => void;
};

let handlers: Handlers = {
  openDapp: (a) => console.warn('[shell-bridge] openDapp before shell ready', a),
  openNative: (v) => console.warn('[shell-bridge] openNative before shell ready', v),
};

export const setShellHandlers = (h: Handlers) => { handlers = h; };

export const shell = {
  openDapp: (a: OpenDappArgs) => handlers.openDapp(a),
  openNative: (v: NativeView) => handlers.openNative(v),
};
