import {BREAKPOINTS} from './viewport.js';
import {UIError, boundedData, record, safeKey} from './safety.js';
import {UIRuntime} from './runtime.js';
import {catalogDescription} from './catalog.js';

export const MCP_UI_URI='ui://vb6/intelligent-ui';
export const MCP_UI_MIME='text/html;profile=mcp-app';
export const MCP_UI_META=Object.freeze({ui:{resourceUri:MCP_UI_URI,visibility:['model','app']}});
const text=maxLength=>({type:'string',maxLength}),idSchema={type:'string',minLength:1,maxLength:80};
export const UI_TOOL_SCHEMAS=Object.freeze({
  catalog:{},
  present:{source:text(32000),title:text(200),data:{type:'object'},dataRefs:{type:'object'}},
  update:{id:idSchema,expectedUIRevision:{type:'integer',minimum:1},source:text(32000),data:{type:'object'},dataRefs:{type:'object'}},
  read:{id:idSchema},list:{},close:{id:idSchema,expectedUIRevision:{type:'integer',minimum:1}}
});
export const UI_TOOL_REQUIRED=Object.freeze({catalog:[],present:['source'],update:['id','expectedUIRevision'],read:['id'],list:[],close:['id','expectedUIRevision']});
export const UI_TOOL_DESCRIPTIONS=Object.freeze({
  catalog:'Read the Intelligent UI component/property catalog and this caller\'s available exact tool-data bindings. No project effects.',
  present:'Present an interactive UI in the IDE and as an MCP App. Source is bounded DIL-inspired markup, not arbitrary JavaScript. dataRefs maps an alias to an exact previously inspected tool name from ui.catalog. This displays content only; it does not authorize project edits or invoke actions.',
  update:'Update this caller\'s existing UI with expectedUIRevision, preserving keyed input state. Replace source and/or data; no project effects.',
  read:'Read this caller\'s UI source, bound data, diagnostics and revision.',
  list:'List this caller\'s live Intelligent UI documents. Other callers\' data is not visible.',
  close:'Close this caller\'s UI with expectedUIRevision. Does not change the project.'
});
let serial=0;
/** Connection-owned UI documents and exact tool-result bindings; no project/host authority. */
export class McpUIService {
  constructor({onChange=()=>{},maxDocuments=32,maxOwners=16,resourceHtml=''}={}){if(!Number.isInteger(maxDocuments)||maxDocuments<1||maxDocuments>64||!Number.isInteger(maxOwners)||maxOwners<1||maxOwners>64)throw new UIError('limits','UI service limits must be integers from 1 to 64.');this.owners=new Map();this.onChange=onChange;this.maxDocuments=maxDocuments;this.maxOwners=maxOwners;this.resourceHtml=resourceHtml;this.disposed=false;}
  identity(context){const owner=context?.principal||context?.sessionKey;if(typeof owner!=='string'||!owner||owner.length>512)throw new UIError('owner','A transport-authenticated UI owner is required.');return owner;}
  bucket(context,create=false){if(this.disposed)throw new UIError('disposed','UI service is disposed.');const owner=this.identity(context);let bucket=this.owners.get(owner);if(!bucket&&create){if(this.owners.size>=this.maxOwners)throw new UIError('owner_limit','Too many UI owners.');bucket={documents:new Map(),bindings:new Map()};this.owners.set(owner,bucket);}return bucket;}
  capture(tool,result,context){if(typeof tool!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(tool))throw new UIError('binding','Invalid inspected tool name.');const bucket=this.bucket(context,true);bucket.bindings.delete(tool);const value=boundedData(result,60000);bucket.bindings.set(tool,{value,tool,revision:Number.isFinite(result?.revision)?result.revision:null,capturedAt:new Date().toISOString()});while(bucket.bindings.size>8)bucket.bindings.delete(bucket.bindings.keys().next().value);}
  resolve(args,context,existing){const data=boundedData(args.data??existing?.data??{},100000),provenance=boundedData(args.data===undefined?existing?.provenance||{}:{});if(!record(data))throw new UIError('data','UI data must be an object.');
    if(args.dataRefs!==undefined){if(!record(args.dataRefs)||Object.keys(args.dataRefs).length>8)throw new UIError('binding','Use at most 8 data bindings.');for(const [alias,tool] of Object.entries(args.dataRefs)){safeKey(alias);if(!/^[A-Za-z_$][\w$]{0,63}$/.test(alias)||typeof tool!=='string')throw new UIError('binding','Invalid binding alias or tool name.');const binding=this.bucket(context)?.bindings.get(tool);if(!binding)throw new UIError('binding','Inspect the tool first in this same connection: '+tool);data[alias]=binding.value;provenance[alias]={tool:binding.tool,revision:binding.revision,capturedAt:binding.capturedAt};}}
    return {data:boundedData(data,100000),provenance};
  }
  run(method,args={},context={}){
    context.signal?.throwIfAborted();if(!Object.hasOwn(UI_TOOL_SCHEMAS,method))throw new UIError('method','Unknown UI operation.');args=boundedData(args,200000);if(!record(args))throw new UIError('arguments','UI arguments must be an object.');const bucket=this.bucket(context,method==='present');
    if(method==='catalog')return {version:1,viewportHooks:['DIL.useViewport()','DIL.useBreakpoint(name)'],breakpoints:BREAKPOINTS,components:catalogDescription(),references:[...(bucket?.bindings.keys()||[])],bindings:[...(bucket?.bindings.values()||[])].map(({value,...info})=>info),syntax:'Markdown, component tags, {@body const [x,setX] = DIL.useState(initial)}, const derived expressions, {expression}, {#if test}, {#each rows as row,i (row.id)}; callbacks and GenUI actions are bounded. No host JavaScript.'};
    if(method==='list')return {documents:[...(bucket?.documents.values()||[])].map(d=>({id:d.ui.id,title:d.ui.title,uiRevision:d.ui.revision}))};
    if(method==='present'){
      if([...this.owners.values()].reduce((n,b)=>n+b.documents.size,0)>=this.maxDocuments||bucket.documents.size>=8)throw new UIError('document_limit','UI document limit reached. Close an old UI first.');
      const id='surface-'+(++serial),result=this.document(id,1,args,this.resolve(args,context),this.referenceSnapshot(context));bucket.documents.set(id,result);this.notify('present',result,context);return boundedData(result);
    }
    const old=bucket?.documents.get(args.id);if(!old)throw new UIError('not_found','UI document is unavailable to this caller.');
    if(method==='read')return boundedData(old);
    if(!Number.isInteger(args.expectedUIRevision)||old.ui.revision!==args.expectedUIRevision)throw new UIError('stale_revision','UI changed; read its current ui.revision before updating.');
    if(method==='close'){bucket.documents.delete(args.id);this.notify('close',old,context);return {id:args.id,closed:true};}
    if(method!=='update')throw new UIError('method','Unknown UI operation.');
    const result=this.document(args.id,old.ui.revision+1,{source:args.source??old.ui.source,title:old.ui.title},this.resolve(args,context,old.ui),this.referenceSnapshot(context));bucket.documents.set(args.id,result);this.notify('update',result,context);return boundedData(result);
  }
  referenceSnapshot(context){return boundedData(Object.fromEntries([...(this.bucket(context)?.bindings.keys()||[])].map(id=>[id,{...this.reference(id,context),details:this.reference(id,context).details.slice(0,2000)}])),64000);}
  document(id,revision,args,resolved,references={}){if(typeof args.source!=='string'||!args.source.trim()||args.source.length>32000)throw new UIError('source','UI source must contain 1–32,000 characters.');if(args.title!==undefined&&(typeof args.title!=='string'||args.title.length>200))throw new UIError('title','Invalid UI title.');const runtime=new UIRuntime();try{const rendered=runtime.update(args.source,{data:resolved.data});return {ui:{version:1,id,revision,title:args.title||'Intelligent UI',source:args.source,...resolved,references},fallbackMarkdown:rendered.fallbackMarkdown,diagnostics:rendered.diagnostics};}finally{runtime.dispose();}}
  reference(id,context){const binding=this.bucket(context)?.bindings.get(id);if(!binding)return null;return boundedData({kind:'citation',title:binding.value.module||binding.value.name||binding.tool,details:JSON.stringify(binding.value,null,2).slice(0,16000),provenance:{source:binding.tool,revision:binding.revision,capturedAt:binding.capturedAt}});}
  notify(type,result,context){try{this.onChange({type,result:boundedData(result),owner:this.identity(context)});}catch{/* UI observers cannot alter successful tool results. */}}
  resources(){return [{uri:MCP_UI_URI,name:'Intelligent UI',mimeType:MCP_UI_MIME,description:'Reusable VB6-themed interactive tool result view.'}];}
  readResource(uri){if(uri!==MCP_UI_URI)throw new UIError('not_found','Unknown UI resource.');if(!this.resourceHtml)throw new UIError('resource','Build the MCP UI HTML resource before serving it.');return [{uri,mimeType:MCP_UI_MIME,text:this.resourceHtml,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},prefersBorder:true}}}];}
  revoke(owner){const b=this.owners.get(owner);if(b)for(const result of b.documents.values())this.notify('close',result,{principal:owner});this.owners.delete(owner);}
  clear(){for(const owner of this.owners.keys())this.revoke(owner);}
  dispose(){this.clear();this.disposed=true;}
}
