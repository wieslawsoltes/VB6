import {httpURL, McpError} from './protocol.js';

/** No arbitrary remote endpoint or query-string credentials for IDE pairing/relay. */
export function companionURL(value, {endpoint = false} = {}) {
  const url = httpURL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.search || url.pathname !== (endpoint ? '/mcp' : '/'))
    throw new McpError(-32602, endpoint ? 'Use a loopback companion /mcp endpoint without a query.' : 'Use a loopback companion origin without a path or query.');
  return url;
}
