/** App resource reads use permission-checked tools and a pinned workspace/revision.
 * They never delegate to unrestricted URI fetch or bypass coding-agent policies.
 */
export async function readUIResource(adapter,uri,context,allowed=[]){
  const epoch=adapter.workspaceEpoch,live=()=>{context.signal?.throwIfAborted();adapter.assertEnabled();if(adapter.workspaceEpoch!==epoch)throw new Error('Workspace changed during resource read.');};live();
  if(!allowed.includes(uri))throw new Error('Resource is outside this app connection.');
  const call=async(name,args={})=>{live();const tool=adapter.tools.find(t=>t.name===name);if(!tool)throw new Error('Resource reader unavailable.');const result=await tool.execute(args,context);live();return result;};
  const module=/^vb6:\/\/module\/([^/]+)\/(source|form)$/.exec(uri);
  let text,mimeType='application/json';
  if(module?.[2]==='source'){
    const name=decodeURIComponent(module[1]);let offset=0,revision,parts=[];
    for(;;){
      const result=await call('vb6.code.read',{module:name,offset,count:32768,...(revision===undefined?{}:{expectedRevision:revision})});
      if(!Number.isSafeInteger(result.revision)||revision!==undefined&&revision!==result.revision||result.offset!==offset||typeof result.code!=='string'||result.nextOffset!==offset+result.code.length)throw new Error('Inconsistent source resource page.');
      revision=result.revision;offset=result.nextOffset;if(offset>180000)throw new Error('Source resource exceeds its bounded download limit.');parts.push(result.code);
      if(!result.hasMore)break;if(!result.code.length)throw new Error('Source resource did not advance.');
    }
    text=parts.join('');mimeType='text/plain';
  }else if(module)text=JSON.stringify(await call('vb6.form.get',{module:decodeURIComponent(module[1])}),null,2);
  else if(uri==='vb6://project')text=(await call('vb6.project.export',{format:'project'})).content;
  else if(uri==='vb6://diagnostics')text=JSON.stringify(await call('vb6.project.compile'),null,2);
  else if(uri==='vb6://debug')text=JSON.stringify(await call('vb6.debug.snapshot'),null,2);
  else if(uri==='ui://vb6/intelligent-ui'){const contents=await adapter.readResource(uri,context);live();return {contents};}
  else throw new Error('No permission-checked reader is registered for this resource.');
  if(typeof text!=='string'||new TextEncoder().encode(text).length>192000)throw new Error('Resource exceeds its bounded download limit.');
  return {contents:[{uri,mimeType,text}]};
}

export function readableUIResource(uri){return ['vb6://project','vb6://diagnostics','vb6://debug','ui://vb6/intelligent-ui'].includes(uri)||/^vb6:\/\/module\/[^/]+\/(?:source|form)$/.test(uri);}
