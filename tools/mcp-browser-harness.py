"""External-agent test harness. No MCP client is installed in the shipped IDE."""
import json, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

POOL = ThreadPoolExecutor(max_workers=8)

def install_peer(page):
    page.evaluate("""() => {
      let sequence=0;
      globalThis.agentClient={request:async(method,params={},capabilities={})=>{
        const result=await vb6Studio.mcp.server.dispatch({jsonrpc:'2.0',id:++sequence,method,
          params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28',
            'io.modelcontextprotocol/clientInfo':{name:'UI-only test peer',version:'1'},'io.modelcontextprotocol/clientCapabilities':capabilities}}},
          {sessionKey:'test-peer',peer:'UI-only test peer'});
        if(result.error)throw new Error(result.error.message);
        if(result.result.isError)throw new Error(JSON.stringify(result.result));return result.result;
      },callTool:(name,args)=>agentClient.request('tools/call',{name,arguments:args}),
      listTools:async()=>{const tools=[];let cursor;do{const r=await agentClient.request('tools/list',cursor?{cursor}:{});tools.push(...r.tools);cursor=r.nextCursor;}while(cursor);return tools;}};
    }""")

def rpc_response(request, request_id, timeout=30):
    """Read an MCP envelope even when a protocol error uses HTTP 400/404.

    Never retry a mutation or conceal transport failures. Keep diagnostics to the
    method/status rather than serializing request arguments or authorization.
    """
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status = response.status
        raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise AssertionError('MCP response exceeds 8 MiB')
        text = raw.decode('utf-8', errors='strict')
        try:
            if response.headers.get_content_type() == 'text/event-stream':
                messages = [json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: ')]
                result = next(message for message in messages if message.get('id') == request_id)
            else:
                result = json.loads(text)
        except (ValueError, StopIteration) as error:
            raise AssertionError('Invalid MCP response (HTTP %s)' % status) from error
    if not isinstance(result, dict) or result.get('jsonrpc') != '2.0' or result.get('id') != request_id:
        raise AssertionError('Unmatched MCP response (HTTP %s)' % status)
    if ('result' in result) == ('error' in result):
        raise AssertionError('Invalid MCP envelope (HTTP %s)' % status)
    if not 200 <= status < 300 and 'error' not in result:
        raise AssertionError('HTTP %s without an MCP error' % status)
    return result

def wire(info, method, params=None):
    params={**(params or {}),'_meta':{'io.modelcontextprotocol/protocolVersion':'2026-07-28',
      'io.modelcontextprotocol/clientInfo':{'name':'external-agent-test','version':'1'},'io.modelcontextprotocol/clientCapabilities':{}}}
    headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':'Bearer '+info['clientToken'],
      'MCP-Protocol-Version':'2026-07-28','MCP-Method':method}
    if method=='tools/call':headers['MCP-Name']=params['name']
    request=urllib.request.Request(info['url']+'/mcp',data=json.dumps({'jsonrpc':'2.0','id':801,'method':method,'params':params}).encode(),headers=headers)
    return rpc_response(request, 801)

def begin(page, info, name, arguments):
    if info:return POOL.submit(wire,info,'tools/call',{'name':name,'arguments':arguments})
    page.evaluate("""([name,args])=>{
      globalThis.peerReply=undefined;agentClient.callTool(name,args).then(result=>{globalThis.peerReply={result};},error=>{globalThis.peerReply={error:{message:error.message}};});
    }""",[name,arguments])
    return None

def result(page, pending):
    if pending is not None:return pending.result(timeout=30)
    page.wait_for_function('globalThis.peerReply!==undefined');return page.evaluate('peerReply')
