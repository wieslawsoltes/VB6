/** Browser-local recovery policy. Only generation requests are retried, never IDE tools. */
export function retryDelay(attempt, retryAfterMs = 0, random = Math.random) {
  const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.max(Math.max(0, Math.min(300000, retryAfterMs)), Math.ceil(Math.min(30000, 1000 * 2 ** Math.min(10, attempt)) * (0.75 + jitter * 0.5)));
}
export function abortableDelay(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, Math.max(0, ms));
    signal?.addEventListener('abort', abort, {once: true});
  });
}
/** A recoverable application pause; does not discard a validated, unexecuted batch. */
export class AgentRunPause extends Error {
  constructor(kind, message, details = {}) { super(message); this.name = 'AgentRunPause'; this.kind = kind; this.details = details; }
}
