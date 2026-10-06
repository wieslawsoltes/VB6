import {normalizeAgentLimits} from './limits.js';
/** Native provider protocols. No SDK, remote script, credential persistence or arbitrary endpoints. */
export const PROVIDERS = Object.freeze({
  openai: {label: 'OpenAI', origin: 'https://api.openai.com', path: '/v1/responses'},
  anthropic: {label: 'Anthropic', origin: 'https://api.anthropic.com', path: '/v1/messages'},
  google: {label: 'Google Gemini', origin: 'https://generativelanguage.googleapis.com', path: '/v1beta/models/'}
});
export function providerInfo(provider) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Select a supported provider.');
  return PROVIDERS[provider];
}
export function modelId(value) {
  const model = String(value || '').replace(/^models\//, '');
  if (!/^[\w.-]{1,150}$/.test(model)) throw new Error('Enter a valid model ID from your provider account.');
  return model;
}
export function relayURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use a loopback relay origin such as http://127.0.0.1:4892.');
  return url.origin;
}
export function nativeRequest(provider, body, {models = false, cursor = ''} = {}) {
  const info = providerInfo(provider);
  const query = models ? new URLSearchParams(provider === 'google' ? {pageSize: '1000', ...(cursor ? {pageToken: cursor} : {})} : provider === 'anthropic' ? {limit: '1000', ...(cursor ? {after_id: cursor} : {})} : {}).toString() : '';
  const path = models ? (provider === 'google' ? '/v1beta/models' : '/v1/models') + (query ? '?' + query : '') : provider === 'google' ? info.path + encodeURIComponent(modelId(body.model)) + ':streamGenerateContent?alt=sse' : info.path;
  const payload = provider === 'google' && !models ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'model')) : body;
  return {url: info.origin + path, method: models ? 'GET' : 'POST', body: models ? undefined : JSON.stringify(payload)};
}
export function providerHeaders(provider, key, browser = true) {
  providerInfo(provider);
  if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw new Error('An API key is required.');
  return {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    ...(provider === 'openai' ? {Authorization: 'Bearer ' + key.trim()} : provider === 'anthropic' ? {'x-api-key': key.trim(), 'anthropic-version': '2023-06-01', ...(browser ? {'anthropic-dangerous-direct-browser-access': 'true'} : {})} : {'x-goog-api-key': key.trim()})};
}
function parseProviderJSON(text) {
  try { return JSON.parse(text); } catch { throw new Error('Malformed provider JSON. No partial tools were executed.'); }
}
/** Reading is bounded for JSON and SSE, including malformed/unending streams. */
export async function readEvents(response, receive, {signal, maxBytes = 8 * 1024 * 1024} = {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderTransportError('The provider returned no response body.', {retryable: true, kind: 'stream'});
  let size = 0, buffer = '', json = '', pendingCR = false;
  const decoder = new TextDecoder('utf-8', {fatal: true}), sse = (response.headers.get('content-type') || '').includes('text/event-stream');
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, {once: true});
  const event = block => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (data && data !== '[DONE]') receive(parseProviderJSON(data));
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      let chunk;
      try { chunk = await reader.read(); } catch { signal?.throwIfAborted(); throw new ProviderTransportError('Provider stream disconnected. No partial tools were executed.', {retryable: true, kind: 'stream'}); }
      signal?.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error('Provider response exceeded the size limit.');
      let text = decoder.decode(chunk.value, {stream: true});
      if (!sse) { json += text; continue; }
      if (pendingCR) { text = '\r' + text; pendingCR = false; }
      if (text.endsWith('\r')) { text = text.slice(0, -1); pendingCR = true; }
      buffer += text.replace(/\r\n?/g, '\n');
      let end; while ((end = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
    }
    if (!sse) receive(parseProviderJSON(json + decoder.decode()));
    else { buffer += decoder.decode() + (pendingCR ? '\n' : ''); if (buffer.trim()) event(buffer); }
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Safe metadata for bounded automatic or explicit user recovery; never includes upstream bodies or credentials. */
export class ProviderTransportError extends Error {
  constructor(message, {status = 0, retryable = false, retryAfterMs = 0, kind = 'transport'} = {}) {
    super(message); this.name = 'ProviderTransportError';
    this.status = status; this.retryable = retryable; this.retryAfterMs = retryAfterMs; this.kind = kind;
  }
}
/** Classify only exact protocol codes. Never echo provider messages, request IDs, or arbitrary bodies. */
export function providerFailure(data = {}, status = 0, retryAfterMs = 0) {
  const value = data.response?.error || data.error || {};
  const codes = [value.code, value.type, value.status, data.response?.incomplete_details?.reason];
  const has = allowed => codes.some(code => typeof code === 'string' && allowed.includes(code));
  let kind = status >= 400 && status < 500 && ![408, 429].includes(status) ? 'request' : 'provider', retryable = [408, 429, 500, 502, 503, 504, 529].includes(status), hint = 'The provider could not complete this turn.';
  const contextMessage = typeof value.message === 'string' && /^(?:prompt is too long:|this model.s maximum context length is|the input token count .*exceeds the maximum)/i.test(value.message.slice(0, 500));
  if (has(['context_length_exceeded', 'context_window_exceeded', 'prompt_too_long', 'request_too_large']) || contextMessage) { kind = 'context'; retryable = false; hint = 'Provider context window exceeded; compact the conversation or lower context/output settings.'; }
  else if (has(['insufficient_quota', 'quota_exceeded', 'billing_hard_limit_reached', 'credit_balance_too_low'])) { kind = 'quota'; retryable = false; hint = 'Provider quota or billing allowance exhausted. Check the provider account before continuing.'; }
  else if ([401, 403].includes(status) || has(['authentication_error', 'invalid_api_key', 'permission_error', 'permission_denied', 'PERMISSION_DENIED', 'UNAUTHENTICATED'])) { kind = 'access'; retryable = false; hint = 'Check provider credentials and model access.'; }
  else if (has(['content_policy_violation', 'safety_violation', 'refusal'])) { kind = 'safety'; retryable = false; hint = 'Provider safety policy rejected this request. No automatic alternative will be attempted.'; }
  else if (has(['invalid_request_error', 'invalid_argument', 'INVALID_ARGUMENT', 'not_found_error'])) { kind = 'request'; retryable = false; hint = 'Provider rejected the request. Check the model and supported settings.'; }
  else if (has(['rate_limit_exceeded', 'rate_limit_error', 'RESOURCE_EXHAUSTED'])) { kind = 'rate'; retryable = true; hint = 'Provider rate limit reached.'; }
  else if (has(['server_error', 'internal_error', 'api_error', 'overloaded_error', 'service_unavailable', 'INTERNAL', 'UNAVAILABLE'])) { kind = 'server'; retryable = true; hint = 'Provider temporarily unavailable.'; }
  // A failed generation without a useful code can be explicitly resumed, but is not blindly auto-retried.
  return new ProviderTransportError((status ? 'Provider HTTP ' + status + '. ' : '') + hint + ' No partial tools were executed.', {status, retryAfterMs, retryable, kind});
}
export async function responseFailure(response, signal) {
  let data = {};
  try { await readEvents(response, value => { data = value; }, {signal, maxBytes: 16384}); } catch { signal?.throwIfAborted(); }
  const header = response.headers.get('retry-after'), failure = providerFailure(data, response.status, retryAfter(header));
  const seconds = typeof header === 'string' && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
  const deadline = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(header);
  if (failure.retryable && Number.isFinite(deadline) && deadline > Date.now() + 300000) {
    failure.retryable = false; failure.kind = 'cooldown'; failure.retryAt = Math.min(Number.MAX_SAFE_INTEGER, deadline);
    failure.message = 'Provider requested a long retry delay. Retry later; the IDE will not shorten the cooldown or extend permissions.';
  }
  return failure;
}
/** A confirmed output-token stop is retried only after a new user decision and larger output allowance.
 * Incomplete native tool/reasoning blocks are never added to the conversation or executed.
 * Sources: OpenAI response.incomplete / incomplete_details.reason; Anthropic stop_reason;
 * Google GenerateContent FinishReason. See docs/CODING-AGENT-THREADS.md#limit-recovery.
 */
export class ProviderOutputLimitError extends Error {
  constructor() { super('Provider turn did not finish: output token limit reached. No partial tools were executed.'); this.name = 'ProviderOutputLimitError'; }
}
export function retryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 100) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(300000, Math.ceil(ms))) : 0;
}
export function createTransport({provider, apiKey = '', relay = '', relayToken = '', fetchImpl = globalThis.fetch, requestTimeoutMs} = {}) {
  providerInfo(provider);
  const timeoutMs = normalizeAgentLimits({requestTimeoutMs}).requestTimeoutMs;
  const origin = relay ? relayURL(relay) : '';
  if (origin && (!relayToken || /[\r\n]/.test(relayToken))) throw new Error('Enter the relay access token.');
  // Snapshot secrets in a closure; never expose them through the returned interface.
  const headers = origin ? {'Content-Type': 'application/json', Authorization: 'Bearer ' + relayToken} : providerHeaders(provider, apiKey);
  return async (body, {signal, receive = () => {}, models = false, cursor = ''} = {}) => {
    const timer = AbortSignal.timeout(models ? Math.min(timeoutMs, 120000) : timeoutMs), combined = AbortSignal.any([signal, timer].filter(Boolean));
    const native = nativeRequest(provider, body, {models, cursor});
    let response;
    try {
      response = await fetchImpl(origin ? origin + '/agent' : native.url, {method: origin ? 'POST' : native.method, headers, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: combined,
        body: origin ? JSON.stringify({provider, operation: models ? 'models' : 'generate', cursor, requestTimeoutMs: models ? Math.min(timeoutMs, 120000) : timeoutMs, body: models ? undefined : body}) : native.body});
    } catch {
      signal?.throwIfAborted();
      throw new ProviderTransportError(timer.aborted ? 'Provider request timed out. Retrying may incur additional charges.' : 'Provider connection failed. Check the connection, browser CORS/local-network permission, or use the local relay.', {retryable: true});
    }
    try {
      if (!response.ok) throw await responseFailure(response, combined);
      await readEvents(response, receive, {signal: combined});
    }
    catch (error) {
      signal?.throwIfAborted();
      if (timer.aborted) throw new ProviderTransportError('Provider response timed out. Partial public text is preserved; no partial tool call was executed. Retrying may incur additional charges.', {retryable: true});
      throw error;
    }
  };
}
export async function listModels(transport, provider, signal) {
  const ids = new Set(); let cursor = '';
  for (let page = 0; page < 20; page++) {
    let result; await transport(null, {models: true, cursor, signal, receive: data => { result = data; }});
    for (const item of result?.data || result?.models || []) {
      if (provider === 'google' && !item.supportedGenerationMethods?.includes('generateContent')) continue;
      const id = item.id || item.name?.replace(/^models\//, ''); if (id) ids.add(id);
    }
    const next = provider === 'google' ? result?.nextPageToken : result?.has_more ? result.last_id : '';
    if (!next || next === cursor) break; cursor = next;
  }
  return [...ids].sort();
}
export function toolCatalog(tools) {
  const names = new Map();
  const definitions = tools.map(tool => {
    const name = tool.name.replace(/\./g, '_');
    if (!/^[\w-]{1,64}$/.test(name) || names.has(name)) throw new Error('Invalid or duplicate provider tool name.');
    names.set(name, tool);
    return {name, description: tool.description, parameters: structuredClone(tool.inputSchema)};
  });
  return {names, definitions};
}
export function requestBody(provider, model, history, definitions, instructions, maxTokens) {
  providerInfo(provider); model = modelId(model);
  if (provider === 'openai') return {model, instructions, input: history, store: false, parallel_tool_calls: false, include: ['reasoning.encrypted_content'], stream: true, max_output_tokens: maxTokens, tools: definitions.map(tool => ({type: 'function', ...tool, strict: false}))};
  if (provider === 'anthropic') return {model, system: instructions, messages: history, stream: true, ...(definitions.length ? {tool_choice: {type: 'auto', disable_parallel_tool_use: true}} : {}), max_tokens: maxTokens, tools: definitions.map(({parameters, ...tool}) => ({...tool, input_schema: parameters}))};
  return {model, systemInstruction: {parts: [{text: instructions}]}, contents: history, generationConfig: {maxOutputTokens: maxTokens}, ...(definitions.length ? {tools: [{functionDeclarations: definitions.map(({parameters, ...tool}) => ({...tool, parametersJsonSchema: parameters}))}]} : {})};
}
export function userMessage(provider, text) { return provider === 'google' ? {role: 'user', parts: [{text}]} : {role: 'user', content: text}; }
/** Preserve provider-native reasoning/signature blocks for tool continuations; display only public text. */
export function responseCollector(provider, onText = () => {}) {
  let raw, finished = false, stop = '', usage = {}, googleParts = [], publicCharacters = 0;
  const publicText = text => { if (typeof text === 'string' && text) { publicCharacters += text.length; onText(text); } };
  const blocks = [], argumentsByIndex = new Map();
  function receive(data) {
    // Capture billable usage even when the provider ends with an incomplete/failed turn.
    if (data.response?.usage) usage = data.response.usage;
    if (data.usage) usage = {...usage, ...data.usage};
    if (data.usageMetadata) usage = data.usageMetadata;
    const response = data.response || data;
    if (provider === 'openai' && (data.type === 'response.incomplete' || Array.isArray(data.output)) && response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens' && !response.error && !data.error) {
      if (!publicCharacters) for (const item of response.output || []) if (item.type === 'message')
        for (const part of item.content || []) if (part.type === 'output_text') publicText(part.text);
      throw new ProviderOutputLimitError();
    }
    if (['response.failed', 'response.incomplete'].includes(data.type) && (!data.response || typeof data.response !== 'object')) throw new Error('Malformed provider failure event. No partial tools were executed.');
    if (data.error || response.error || data.type === 'error' || data.type === 'response.failed' || data.type === 'response.incomplete' || response.status === 'failed') throw providerFailure(data);
    if (provider === 'openai') {
      if (data.type === 'response.output_text.delta') publicText(data.delta || '');
      if (data.type === 'response.completed' || Array.isArray(data.output)) { raw = data.response || data; finished = raw.status === 'completed'; usage = raw.usage || {}; }
    } else if (provider === 'anthropic') {
      if (data.type === 'message_start') usage = {...data.message?.usage};
      if (data.type === 'content_block_start') {
        if (!Number.isSafeInteger(data.index) || data.index !== blocks.length || blocks.length >= 65536 || !data.content_block || typeof data.content_block.type !== 'string')
          throw new Error('Invalid provider stream block index or shape.');
        blocks.push(structuredClone(data.content_block));
        if (data.content_block.type === 'text') publicText(data.content_block.text);
      }
      if (data.type === 'content_block_delta') {
        if (!Number.isSafeInteger(data.index) || data.index < 0 || data.index >= blocks.length) throw new Error('Invalid provider stream block index.');
        const block = blocks[data.index], delta = data.delta;
        if (!block || !delta) throw new Error('Invalid provider stream order.');
        const expected = {text_delta: 'text', input_json_delta: 'tool_use', thinking_delta: 'thinking', signature_delta: 'thinking'}[delta.type];
        if (expected && block.type !== expected) throw new Error('Invalid provider stream block type.');
        if (delta.type === 'text_delta') { block.text = (block.text || '') + delta.text; publicText(delta.text); }
        if (delta.type === 'input_json_delta') argumentsByIndex.set(data.index, (argumentsByIndex.get(data.index) || '') + delta.partial_json);
        if (delta.type === 'thinking_delta') block.thinking = (block.thinking || '') + delta.thinking;
        if (delta.type === 'signature_delta') block.signature = (block.signature || '') + delta.signature;
      }
      if (data.type === 'message_delta') { stop = data.delta?.stop_reason || stop; usage = {...usage, ...data.usage}; }
      if (data.type === 'message_stop') finished = true;
      if (Array.isArray(data.content)) { raw = data.content; usage = data.usage || {}; stop = data.stop_reason; finished = true; }
    } else {
      const candidate = data.candidates?.[0];
      if (data.promptFeedback?.blockReason) throw new Error('The provider blocked this prompt.');
      for (const part of candidate?.content?.parts || []) { googleParts.push(structuredClone(part)); if (part.text && !part.thought) publicText(part.text); }
      if (candidate?.finishReason) { finished = true; stop = candidate.finishReason; }
      usage = data.usageMetadata || usage;
    }
  }
  function result() {
    if (!finished) throw new ProviderTransportError('Provider stream ended before completion. No partial tools were executed.', {retryable: true, kind: 'stream'});
    let message, calls, text;
    if (provider === 'openai') {
      message = raw.output;
      calls = message.filter(item => item.type === 'function_call').map(item => ({id: item.call_id, name: item.name, arguments: parseProviderJSON(item.arguments)}));
      text = message.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => ['output_text', 'refusal'].includes(item.type)).map(item => item.text || item.refusal || '').join('');
    } else if (provider === 'anthropic') {
      if (stop === 'max_tokens') {
        if (!publicCharacters) for (const block of raw || blocks) if (block?.type === 'text') publicText(block.text);
        throw new ProviderOutputLimitError();
      }
      if (!['end_turn', 'tool_use', 'stop_sequence'].includes(stop)) throw new Error('Provider turn did not finish normally. Start a new task.');
      if (!raw) { raw = blocks; for (const [index, json] of argumentsByIndex) raw[index].input = parseProviderJSON(json); }
      message = {role: 'assistant', content: raw};
      calls = raw.filter(item => item.type === 'tool_use').map(item => ({id: item.id, name: item.name, arguments: item.input}));
      text = raw.filter(item => item.type === 'text').map(item => item.text).join('');
    } else {
      if (stop === 'MAX_TOKENS') throw new ProviderOutputLimitError();
      if (stop !== 'STOP') throw new Error('Provider turn did not finish normally. No partial tools were executed.');
      message = {role: 'model', parts: googleParts};
      calls = googleParts.filter(item => item.functionCall).map((item, index) => ({id: item.functionCall.id || 'call_' + index, nativeId: item.functionCall.id, name: item.functionCall.name, arguments: item.functionCall.args || {}}));
      text = googleParts.filter(item => item.text && !item.thought).map(item => item.text).join('');
    }
    const seen = new Set();
    for (const call of calls) { if (!call.id || !call.name || seen.has(call.id) || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new Error('Invalid or duplicate provider tool call.'); seen.add(call.id); }
    return {message, calls, text, ...usageSummary()};
  }
  function usageSummary() {
    // Sources: OpenAI Responses streaming-events; Anthropic Streaming messages;
    // Google GenerateContent UsageMetadata. Usage packets are cumulative per request.
    // https://developers.openai.com/api/reference/resources/responses/streaming-events
    // https://platform.claude.com/docs/en/build-with-claude/streaming
    // https://ai.google.dev/api/generate-content#UsageMetadata
    const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const total = usage.total_tokens ?? usage.totalTokenCount;
    const parts = provider === 'google' ? ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount'] : ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
    const reported = valid(total) || parts.some(key => valid(usage[key]));
    const tokens = valid(total) ? total : parts.reduce((sum, key) => sum + (valid(usage[key]) ? usage[key] : 0), 0);
    return {tokens: Math.min(Number.MAX_SAFE_INTEGER, Math.floor(tokens)), usageReported: reported, inputTokens: provider === 'google' ? (valid(usage.promptTokenCount) ? usage.promptTokenCount : null) : valid(usage.input_tokens) ? usage.input_tokens + (provider === 'anthropic' ? (valid(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0) + (valid(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0) : 0) : null};
  }
  return {receive, result, usage: usageSummary, get publicCharacters() { return publicCharacters; }};
}
export function appendTurn(provider, history, result, outputs) {
  if (provider === 'openai') history.push(...result.message);
  else history.push(result.message);
  if (!outputs.length) return;
  if (provider === 'openai') history.push(...outputs.map(({call, result}) => ({type: 'function_call_output', call_id: call.id, output: JSON.stringify(result)})));
  else if (provider === 'anthropic') history.push({role: 'user', content: outputs.map(({call, result}) => ({type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result), is_error: !!result.error}))});
  else history.push({role: 'user', parts: outputs.map(({call, result}) => ({functionResponse: {name: call.name, ...(call.nativeId ? {id: call.nativeId} : {}), response: result}}))});
}
