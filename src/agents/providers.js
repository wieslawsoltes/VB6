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
  if (!reader) throw new Error('The provider returned no response body.');
  let size = 0, buffer = '', json = '', pendingCR = false;
  const decoder = new TextDecoder(), sse = (response.headers.get('content-type') || '').includes('text/event-stream');
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, {once: true});
  const event = block => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (data && data !== '[DONE]') receive(parseProviderJSON(data));
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read(); signal?.throwIfAborted();
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
export function createTransport({provider, apiKey = '', relay = '', relayToken = '', fetchImpl = globalThis.fetch} = {}) {
  providerInfo(provider);
  const origin = relay ? relayURL(relay) : '';
  if (origin && (!relayToken || /[\r\n]/.test(relayToken))) throw new Error('Enter the relay access token.');
  // Snapshot secrets in a closure; never expose them through the returned interface.
  const headers = origin ? {'Content-Type': 'application/json', Authorization: 'Bearer ' + relayToken} : providerHeaders(provider, apiKey);
  return async (body, {signal, receive = () => {}, models = false, cursor = ''} = {}) => {
    const timer = AbortSignal.timeout(120000), combined = AbortSignal.any([signal, timer].filter(Boolean));
    const native = nativeRequest(provider, body, {models, cursor});
    let response;
    try {
      response = await fetchImpl(origin ? origin + '/agent' : native.url, {method: origin ? 'POST' : native.method, headers, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: combined,
        body: origin ? JSON.stringify({provider, operation: models ? 'models' : 'generate', cursor, body: models ? undefined : body}) : native.body});
    } catch {
      combined.throwIfAborted();
      throw new Error('Provider connection failed. Check the connection, browser CORS/local-network permission, or use the local relay.');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // Do not echo untrusted response bodies: they can contain credentials or prompt data.
      throw new Error('Provider HTTP ' + response.status + '. ' + (response.status === 429 ? 'Rate limit or quota reached; retry later.' : response.status === 401 || response.status === 403 ? 'Check credentials and model access.' : 'Check the model ID and provider limits.'));
    }
    await readEvents(response, receive, {signal: combined});
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
  if (provider === 'anthropic') return {model, system: instructions, messages: history, stream: true, tool_choice: {type: 'auto', disable_parallel_tool_use: true}, max_tokens: maxTokens, tools: definitions.map(({parameters, ...tool}) => ({...tool, input_schema: parameters}))};
  return {model, systemInstruction: {parts: [{text: instructions}]}, contents: history, generationConfig: {maxOutputTokens: maxTokens}, tools: [{functionDeclarations: definitions.map(({parameters, ...tool}) => ({...tool, parametersJsonSchema: parameters}))}]};
}
export function userMessage(provider, text) { return provider === 'google' ? {role: 'user', parts: [{text}]} : {role: 'user', content: text}; }
/** Preserve provider-native reasoning/signature blocks for tool continuations; display only public text. */
export function responseCollector(provider, onText = () => {}) {
  let raw, finished = false, stop = '', usage = {}, googleParts = [];
  const blocks = [], argumentsByIndex = new Map();
  function receive(data) {
    if (data.error || data.type === 'error' || data.type === 'response.failed' || data.type === 'response.incomplete') throw new Error('The provider could not complete this turn. No partial tools were executed.');
    if (provider === 'openai') {
      if (data.type === 'response.output_text.delta') onText(data.delta || '');
      if (data.type === 'response.completed' || Array.isArray(data.output)) { raw = data.response || data; finished = raw.status === 'completed'; usage = raw.usage || {}; }
    } else if (provider === 'anthropic') {
      if (data.type === 'message_start') usage = {...data.message?.usage};
      if (data.type === 'content_block_start') blocks[data.index] = structuredClone(data.content_block);
      if (data.type === 'content_block_delta') {
        const block = blocks[data.index], delta = data.delta;
        if (!block) throw new Error('Invalid provider stream order.');
        if (delta.type === 'text_delta') { block.text = (block.text || '') + delta.text; onText(delta.text); }
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
      for (const part of candidate?.content?.parts || []) { googleParts.push(structuredClone(part)); if (part.text && !part.thought) onText(part.text); }
      if (candidate?.finishReason) { finished = true; stop = candidate.finishReason; }
      usage = data.usageMetadata || usage;
    }
  }
  function result() {
    if (!finished) throw new Error('Provider stream ended before completion. No partial tools were executed.');
    let message, calls, text;
    if (provider === 'openai') {
      message = raw.output;
      calls = message.filter(item => item.type === 'function_call').map(item => ({id: item.call_id, name: item.name, arguments: parseProviderJSON(item.arguments)}));
      text = message.filter(item => item.type === 'message').flatMap(item => item.content || []).map(item => item.text || item.refusal || '').join('');
    } else if (provider === 'anthropic') {
      if (!['end_turn', 'tool_use', 'stop_sequence'].includes(stop)) throw new Error('Provider turn did not finish normally. Increase the output limit or start a new task.');
      if (!raw) { raw = blocks; for (const [index, json] of argumentsByIndex) raw[index].input = parseProviderJSON(json); }
      message = {role: 'assistant', content: raw};
      calls = raw.filter(item => item.type === 'tool_use').map(item => ({id: item.id, name: item.name, arguments: item.input}));
      text = raw.filter(item => item.type === 'text').map(item => item.text).join('');
    } else {
      if (stop !== 'STOP') throw new Error('Provider turn did not finish normally. No partial tools were executed.');
      message = {role: 'model', parts: googleParts};
      calls = googleParts.filter(item => item.functionCall).map((item, index) => ({id: item.functionCall.id || 'call_' + index, nativeId: item.functionCall.id, name: item.functionCall.name, arguments: item.functionCall.args || {}}));
      text = googleParts.filter(item => item.text && !item.thought).map(item => item.text).join('');
    }
    const seen = new Set();
    for (const call of calls) { if (!call.id || !call.name || seen.has(call.id) || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new Error('Invalid or duplicate provider tool call.'); seen.add(call.id); }
    return {message, calls, text, tokens: Number(usage.total_tokens ?? usage.totalTokenCount ?? (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0) + Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0))) || 0};
  }
  return {receive, result};
}
export function appendTurn(provider, history, result, outputs) {
  if (provider === 'openai') history.push(...result.message);
  else history.push(result.message);
  if (!outputs.length) return;
  if (provider === 'openai') history.push(...outputs.map(({call, result}) => ({type: 'function_call_output', call_id: call.id, output: JSON.stringify(result)})));
  else if (provider === 'anthropic') history.push({role: 'user', content: outputs.map(({call, result}) => ({type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result), is_error: !!result.error}))});
  else history.push({role: 'user', parts: outputs.map(({call, result}) => ({functionResponse: {name: call.name, ...(call.nativeId ? {id: call.nativeId} : {}), response: result}}))});
}
