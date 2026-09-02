/** Tiny in-renderer event bus. The shell publishes node/dapp changes; the MDS shim turns them into hub events. */
type Handler = (payload?: any) => void;
const handlers = new Map<string, Set<Handler>>();

export const bus = {
  on(event: string, handler: Handler): () => void {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
    return () => { handlers.get(event)?.delete(handler); };
  },
  emit(event: string, payload?: any) {
    handlers.get(event)?.forEach((h) => {
      try { h(payload); } catch (e) { console.error('[bus]', event, e); }
    });
  },
};
