import {RpcError,RPC_CANCELLED,RPC_CONTENT_MODIFIED} from './rpc.js';

const lower=value=>String(value||'').replace(/^\[|\]$/g,'').replace(/[$%&!#@]$/,'').toLowerCase();
const check=signal=>{if(signal?.aborted)throw new RpcError(RPC_CANCELLED,'Request cancelled.');};
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const procedureKey=symbol=>symbol?.moduleId+'|'+symbol?.id;
const callable=symbol=>['sub','function','property','property get','property let','property set'].includes(symbol?.kind);

/** Source-backed hierarchy over the same conditional-compilation and binding
 * index as completion/rename. This describes statically resolved source calls
 * and VB6 Implements relationships, not dynamic dispatch or class inheritance. */
export class SourceHierarchy {
  constructor(server,symbolRange) {this.server=server;this.symbolRange=symbolRange;}
  handlers() {
    return {
      'textDocument/prepareCallHierarchy':p=>this.prepareCall(p),
      'callHierarchy/incomingCalls':(p,c)=>this.calls(p,'incoming',c),
      'callHierarchy/outgoingCalls':(p,c)=>this.calls(p,'outgoing',c),
      'textDocument/prepareTypeHierarchy':p=>this.prepareType(p),
      'typeHierarchy/supertypes':p=>this.types(p,'super'),
      'typeHierarchy/subtypes':p=>this.types(p,'sub'),
      'textDocument/typeDefinition':p=>this.typeDefinition(p),
      'textDocument/implementation':p=>this.implementation(p),
      'textDocument/declaration':p=>this.server.definition(p),
    };
  }
  workspace() {
    const server=this.server;if(this.index?.revision===server.revision)return this.index;
    const index={revision:server.revision,procedures:new Map(),modules:new Map(),types:new Map()};
    for(const module of server.project.modules) {
      const uri=server.moduleUris.get(module.id),document=server.documents.get(uri);if(!document)continue;
      const symbols=server.intelligence.index(module,server.project),entry={module,uri,document,symbols};index.modules.set(module.id,entry);
      for(const symbol of symbols.procedures) {
        if(!callable(symbol)||symbol.external)continue;
        index.procedures.set(procedureKey(symbol),{...entry,symbol});
        if(index.procedures.size>20000)throw new RpcError(-32602,'More than 20,000 procedures; narrow the hierarchy workspace.');
      }
      if(module.kind==='class'||module.form)index.types.set(module.id,entry);
    }
    this.index=index;return index;
  }
  procedure(symbol,index=this.workspace()) {
    if(!callable(symbol))return null;
    // Accessor binding coalesces properties; recover only an unambiguous name
    // when the shared binder intentionally returned a coalesced property.
    const exact=index.procedures.get(procedureKey(symbol));if(exact)return exact;
    const matches=[...index.procedures.values()].filter(e=>e.module.id===symbol.moduleId&&lower(e.symbol.name)===lower(symbol.name));
    return matches.length===1?matches[0]:null;
  }
  callItem(entry) {
    const {module,document,symbol,uri}=entry,start=Math.max(0,symbol.offset||0),end=Math.max(start,Math.min(document.text.length,symbol.endOffset??document.text.length));
    return {name:symbol.name,kind:symbol.kind.startsWith('property')?7:12,detail:module.name+' · '+symbol.signature,uri,
      range:document.range(start,end),selectionRange:this.symbolRange(document,symbol),
      data:{kind:'call',key:procedureKey(symbol),revision:this.server.revision,version:document.version}};
  }
  typeItem(entry) {
    const {module,document,uri,symbols}=entry;
    return {name:module.name,kind:5,detail:'VB6 class'+(symbols.interfaces.length?' · Implements '+symbols.interfaces.join(', '):''),uri,
      range:document.range(0,document.text.length),selectionRange:document.range(0,0),
      data:{kind:'type',key:module.id,revision:this.server.revision,version:document.version}};
  }
  resolveItem(item,kind) {
    const data=item?.data,index=this.workspace(),entry=kind==='call'?index.procedures.get(data?.key):index.types.get(data?.key);
    if(data?.kind!==kind||data.revision!==index.revision||!entry||entry.document.version!==data.version||item.uri!==entry.uri)
      throw new RpcError(RPC_CONTENT_MODIFIED,'Hierarchy item is stale. Refresh the hierarchy.');
    return entry;
  }
  prepareCall(p) {
    const target=this.server.target(p);if(target.document.languageId!=='vb6')return [];
    let entry=this.procedure(target.symbol);
    if(!entry)entry=[...this.workspace().procedures.values()].find(e=>e.module.id===target.module?.id&&e.symbol.offset<=target.offset&&target.offset<=e.symbol.endOffset);
    return entry?[this.callItem(entry)]:[];
  }
  async graph(signal) {
    const index=this.workspace();if(index.graph)return index.graph;
    const server=this.server,project=server.project,graph={incoming:new Map(),outgoing:new Map()};let count=0,scanned=0;
    const names=new Set([...index.procedures.values()].map(e=>lower(e.symbol.name)));
    for(const entry of index.modules.values()) {
      const {module,document,symbols}=entry,procedures=[...index.procedures.values()].filter(e=>e.module.id===module.id).sort((a,b)=>a.symbol.offset-b.symbol.offset);
      const occurrences=await server.occurrences(document,signal);
      for(const name of names)for(const token of occurrences.get(name)||[]) {
        if(++scanned%128===0){check(signal);await yieldTask();}
        check(signal);
        // The compiler's source-sized mask excludes inactive #If branches.
        if(!symbols.masked.slice(token.start,token.end).trim())continue;
        let lo=0,hi=procedures.length;
        while(lo<hi){const mid=(lo+hi)>>>1;if(procedures[mid].symbol.offset<=token.start)lo=mid+1;else hi=mid;}
        const from=procedures[lo-1];if(!from||token.start>=from.symbol.endOffset)continue;
        if(token.line+1===from.symbol.line)continue;
        const symbol=server.intelligence.definition(project,module,token.line+1,document.text,token.start+Math.min(1,token.end-token.start)),to=this.procedure(symbol,index);
        if(!to)continue;
        const prefix=document.text.slice(document.lineStarts[token.line],token.start),suffix=document.text.slice(token.end,document.lineEnds[token.line]);
        if(/\bAddressOf\s*$/i.test(prefix))continue;
        // Function-name assignment/reads denote its return variable, not a
        // recursive invocation. Parenthesized or explicit Call uses are calls.
        if(to===from&&symbol.kind==='function'&&!/^\s*\(/.test(suffix)&&!/(?:^|:)\s*Call\s*$/i.test(prefix))continue;
        const fromKey=procedureKey(from.symbol),toKey=procedureKey(to.symbol);
        let outgoing=graph.outgoing.get(fromKey);if(!outgoing)graph.outgoing.set(fromKey,outgoing=new Map());
        let edge=outgoing.get(toKey);if(!edge){edge={from,to,ranges:[]};outgoing.set(toKey,edge);let incoming=graph.incoming.get(toKey);if(!incoming)graph.incoming.set(toKey,incoming=new Map());incoming.set(fromKey,edge);}
        edge.ranges.push(document.range(token.start,token.end));
        if(++count>100000)throw new RpcError(-32602,'More than 100,000 source calls; narrow the hierarchy workspace.');
      }
    }
    check(signal);if(server.revision!==index.revision)throw new RpcError(RPC_CONTENT_MODIFIED,'Workspace changed while building call hierarchy.');
    index.graph=graph;return graph;
  }
  async calls({item},direction,{signal}={}) {
    const entry=this.resolveItem(item,'call'),graph=await this.graph(signal),edges=graph[direction].get(procedureKey(entry.symbol));
    return [...edges?.values()||[]].map(edge=>direction==='incoming'?{from:this.callItem(edge.from),fromRanges:edge.ranges}:{to:this.callItem(edge.to),fromRanges:edge.ranges});
  }
  typeEntry(symbol,module,index=this.workspace()) {
    if(!symbol)return null;
    const name=symbol.kind==='class'||symbol.kind==='module'?symbol.name:symbol.type;
    if(!name)return null;
    const type=this.server.intelligence.type(this.server.project,module,name);
    return type?.moduleId?index.types.get(type.moduleId)||null:null;
  }
  prepareType(p) {
    const {document,module,symbol}=this.server.target(p);if(document.languageId!=='vb6')return [];
    const entry=this.typeEntry(symbol,module)||(!symbol?this.workspace().types.get(module?.id):null);
    return entry?[this.typeItem(entry)]:[];
  }
  bases(entry,index=this.workspace()) {
    return [...new Set(entry.symbols.interfaces.map(name=>this.server.intelligence.type(this.server.project,entry.module,name)?.moduleId))].map(id=>index.types.get(id)).filter(Boolean);
  }
  types({item},direction) {
    const index=this.workspace(),entry=this.resolveItem(item,'type');
    return (direction==='super'?this.bases(entry,index):[...index.types.values()].filter(other=>this.bases(other,index).includes(entry))).map(e=>this.typeItem(e));
  }
  typeDefinition(p) {
    const {document,module,symbol}=this.server.target(p);if(document.languageId!=='vb6'||!symbol)return [];
    const name=['class','type','enum'].includes(symbol.kind)?symbol.name:symbol.type,type=this.server.intelligence.type(this.server.project,module,name);
    if(!type)return [];const target=this.workspace().modules.get(type.moduleId);if(!target)return [];
    return [{uri:target.uri,range:type.kind==='class'||type.kind==='module'?target.document.range(0,0):this.symbolRange(target.document,type)}];
  }
  implementation(p) {
    const {document,module,symbol}=this.server.target(p);if(document.languageId!=='vb6'||!symbol)return [];
    const index=this.workspace(),interfaceEntry=callable(symbol)?index.types.get(symbol.moduleId):this.typeEntry(symbol,module,index);
    if(!interfaceEntry)return [];
    const implementations=[...index.types.values()].filter(e=>this.bases(e,index).includes(interfaceEntry)),result=[];
    for(const entry of implementations) {
      if(!callable(symbol))result.push({uri:entry.uri,range:entry.document.range(0,0)});
      else for(const proc of entry.symbols.procedures)if(lower(proc.name)===lower(interfaceEntry.module.name+'_'+symbol.name))result.push({uri:entry.uri,range:this.symbolRange(entry.document,proc)});
    }
    return result;
  }
}
