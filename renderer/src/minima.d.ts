// The preload bridge (main/preload.js) — the renderer's only way to reach the node and the OS.
export type NodeHealth = {
  version: string; block: number; connections: number; locked: boolean; maxima: boolean;
  incoming?: number; acceptingInLinks?: boolean | null; p2pAddress?: string;
};
export type PortmapStatus = {
  state: 'off' | 'searching' | 'mapped' | 'no_gateway' | 'mapping_refused' | 'double_nat' | 'error';
  externalIp: string | null; externalPort: number | null; detail: string; since: number; port: number;
  lanIp: string | null; gatewayIp: string | null; routerName: string | null;
};
export type MlsPolicy = { mode: 'relay' | 'custom' | 'host'; custom: string };
export type KnownRelay = { host: string; label: string };
export type NodeSnapshot = {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  health: NodeHealth | null;
  lastError: string | null;
  rpcPort: number;
  mdsPort: number;
  basePort: number;
  uptimeMs: number;
  provision?: { done: boolean; busy: boolean };
  contribute?: boolean;
  portmap?: PortmapStatus;
  maximaRelay?: string;
  mls?: MlsPolicy;
};
export type Ports = { base: number; rpc: number; mds: number; appVersion: string };
export type RpcReply = { command?: string; status: boolean; pending?: boolean; response?: any; error?: string; cancelled?: boolean };

export interface MinimaBridge {
  platform: string;
  snapshot(): Promise<NodeSnapshot>;
  logs(): Promise<string[]>;
  ports(): Promise<Ports>;
  onStatus(cb: (s: NodeSnapshot) => void): () => void;
  nodeStop(compact?: boolean): Promise<RpcReply>;
  nodeRestart(): Promise<RpcReply>;
  cmd(command: string): Promise<RpcReply>;
  mdsBase(): Promise<{ host: string; port: number }>;
  install(): Promise<RpcReply>;
  iconData(url: string): Promise<string>;
  healMaxima(): Promise<{ status: boolean; error?: string }>;
  rpcCopyPassword(): Promise<{ status: boolean; user?: string; port?: number; error?: string }>;
  netConfig(): Promise<{ contribute: boolean; maximaRelay: string; mls: MlsPolicy; knownRelays: KnownRelay[]; basePort: number }>;
  netSetContribute(on: boolean): Promise<{ status: boolean; error?: string }>;
  netSetMaximaRelay(host: string): Promise<{ status: boolean; error?: string }>;
  netSetMls(mode: MlsPolicy['mode'], custom?: string): Promise<{ status: boolean; error?: string }>;
  onOpenUrl(cb: (p: { url: string }) => void): () => void;
  prefsGet(key: string): Promise<{ status: boolean; key?: string; value?: string }>;
  prefsSet(key: string, value: string): Promise<{ status: boolean }>;
  pathForFile(file: File): string;
  wallpaperSet(srcPath: string): Promise<{ status: boolean; fileName?: string; dataUrl?: string; error?: string }>;
  wallpaperGet(): Promise<{ status: boolean; fileName?: string; dataUrl?: string }>;
  openExternal(url: string): Promise<RpcReply>;
  diag(m: string): void;
}

declare global {
  interface Window {
    minima: MinimaBridge;
    MDS: any;
  }
}
