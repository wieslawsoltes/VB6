/** ChatGPT-plan Responses preview profile. API-key requests are intentionally untouched.
 * https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
 */
export function chatGPTRequest(body) {
  if (!body || !Array.isArray(body.input) || body.input.some(item => item?.role === 'system')) throw new Error('ChatGPT mode requires array input and developer instructions.');
  if (typeof body.model !== 'string' || !/^[\w.-]{1,150}$/.test(body.model)) throw new Error('Invalid ChatGPT model.');
  const tools = body.tools || [];
  if (!Array.isArray(tools) || tools.some(tool => tool?.type !== 'function' || !/^[\w-]{1,64}$/.test(tool.name))) throw new Error('ChatGPT mode supports registered local function tools only.');
  const input = structuredClone(body.input);
  for (const item of input) if (item.type === 'function_call') {
    if (item.namespace && item.namespace !== 'vb6') throw new Error('Unrecognized ChatGPT tool namespace.');
    item.namespace = 'vb6';
  }
  // Explicit allowlist: never forward unsupported output caps, server state, hosted tools or billing overrides.
  return {model: body.model, instructions: typeof body.instructions === 'string' ? body.instructions : '', input,
    store: false, stream: true, parallel_tool_calls: false, include: ['reasoning.encrypted_content'],
    tools: tools.length ? [{type: 'namespace', name: 'vb6', description: 'Permission-gated tools in the user’s VB6 Studio project. No host shell or credential access.',
      tools: tools.map(({name, description, parameters}) => ({type: 'function', name, description, parameters, strict: false}))}] : []};
}
export function chatGPTModels(value) {
  if (!value || !Array.isArray(value.models)) throw new Error('Invalid ChatGPT model catalog.');
  const seen = new Set();
  return value.models.filter(model => model?.visibility === 'list' && typeof model.slug === 'string' && /^[\w.-]{1,150}$/.test(model.slug) && !seen.has(model.slug) && seen.add(model.slug))
    .map(model => ({id: model.slug, label: typeof model.display_name === 'string' ? model.display_name.slice(0, 256) : model.slug}));
}
/** Reject namespace spoofing before the shared collector can dispatch a registered local tool. */
export function validateChatGPTEvent(event) {
  const items = [...(event?.response?.output || []), ...(event?.output || []), ...(event?.item ? [event.item] : [])];
  for (const item of items) if (item?.type === 'function_call' && item.namespace !== 'vb6') throw new Error('ChatGPT returned an unrecognized tool namespace. No tools were executed.');
  return event;
}
