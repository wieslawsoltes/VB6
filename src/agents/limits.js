/** Application safety limits, not provider model capabilities or a billing guarantee. */
export const AGENT_LIMIT_FIELDS = Object.freeze({
  maxTurns: {label: 'Maximum requests per run', default: 128, min: 1, max: 2048},
  maxCalls: {label: 'Maximum tool calls per run', default: 1024, min: 1, max: 16384},
  maxTokens: {label: 'Output tokens per request', default: 32768, min: 256, max: 262144},
  tokenBudget: {label: 'Session token budget', default: 4000000, min: 1024, max: 100000000},
  maxContextBytes: {label: 'Request context bytes', default: 6000000, min: 65536, max: 16000000},
  requestTimeoutMs: {label: 'Request timeout milliseconds', default: 600000, min: 10000, max: 1800000}
});
export const DEFAULT_AGENT_LIMITS = Object.freeze(Object.fromEntries(Object.entries(AGENT_LIMIT_FIELDS).map(([key, field]) => [key, field.default])));
export const AGENT_LIMIT_PRESETS = Object.freeze({
  conservative: {label: 'Conservative', limits: Object.freeze({...DEFAULT_AGENT_LIMITS, maxTurns: 16, maxCalls: 128, maxTokens: 8192, tokenBudget: 200000, maxContextBytes: 1500000, requestTimeoutMs: 120000})},
  standard: {label: 'Extended session (default)', limits: DEFAULT_AGENT_LIMITS},
  large: {label: 'Large session', limits: Object.freeze({...DEFAULT_AGENT_LIMITS, maxTurns: 512, maxCalls: 4096, maxTokens: 65536, tokenBudget: 20000000, maxContextBytes: 12000000, requestTimeoutMs: 900000})}
});
export function normalizeAgentLimits(values = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid agent limits.');
  return Object.fromEntries(Object.entries(AGENT_LIMIT_FIELDS).map(([key, field]) => {
    const value = values[key] ?? field.default;
    if (!Number.isSafeInteger(value) || value < field.min || value > field.max)
      throw new Error(`Invalid agent limit: ${field.label} must be an integer from ${field.min.toLocaleString('en-US')} to ${field.max.toLocaleString('en-US')}.`);
    return [key, value];
  }));
}
const STORAGE_KEY = 'vb6.codingAgents.limits.v1';
/** Store only allowlisted numeric preferences. Never tasks, model context, keys or grants. */
export function loadAgentLimits() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
    return saved?.version === 1 ? normalizeAgentLimits(saved.limits) : {...DEFAULT_AGENT_LIMITS};
  } catch { return {...DEFAULT_AGENT_LIMITS}; }
}
export function saveAgentLimits(values) {
  const limits = normalizeAgentLimits(values);
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({version: 1, limits})); } catch { /* Storage can be disabled. */ }
  return limits;
}
