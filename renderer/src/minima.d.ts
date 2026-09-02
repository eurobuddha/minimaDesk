// The preload bridge (main/preload.js) — the renderer's only way to reach the node and the OS.
export type NodeHealth = { version: string; block: number; connections: number; locked: boolean; maxima: boolean };
export type NodeSnapshot = {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  health: NodeHealth | null;
  lastError: string | null;
  rpcPort: number;
  mdsPort: number;
  basePort: number;
  uptimeMs: number;
  provision?: { done: boolean; busy: boolean };
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
