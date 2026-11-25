import { AsyncLocalStorage } from 'node:async_hooks';
/** Per-HTTP-request abort signal, available to MCP tool handlers without a global. */
const storage = new AsyncLocalStorage<AbortSignal>();
export function runWithRequestSignal<T>(signal: AbortSignal, fn: () => T): T {
  return storage.run(signal, fn);
}
export function currentRequestSignal(): AbortSignal | undefined {
  return storage.getStore();
}
/** Combine the SDK cancellation signal with the enclosing HTTP request signal. */
export function combineRequestSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length <= 1) return active[0];
  return AbortSignal.any(active);
}
