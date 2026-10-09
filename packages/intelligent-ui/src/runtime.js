import {normalizeViewport, matchesBreakpoint, DEFAULT_VIEWPORT} from './viewport.js';
import {UIError, LIMITS, boundedData, budget, display, safeKey, record} from './safety.js';
import {Callable, evaluate, baseScope} from './expression.js';
import {compile, classifyUpdate} from './compiler.js';
import {CATALOG, validProp} from './catalog.js';

function flatten(tree) {
  const entries=new Map();
  const walk=(nodes,parent)=>nodes.forEach((node,index)=>{entries.set(node.id,{node,parent,index});walk(node.children||[],node.id);});walk(tree,'root');return entries;
}
/** Renderer-neutral operation stream. Event callbacks remain inside the runtime. */
export function diffTrees(before,after) {
  const old=flatten(before),next=flatten(after),ops=[],replaced=new Set([...next].filter(([id,v])=>old.has(id)&&old.get(id).node.type!==v.node.type).map(([id])=>id));
  for(const [id,{node}] of old)if(!next.has(id)||next.get(id).node.type!==node.type)ops.push({op:'remove',id});
  for(const [id,{node,parent,index}] of next){const previous=old.get(id),fresh=!previous||previous.node.type!==node.type;
    if(fresh)ops.push({op:'create',id,type:node.type});
    if(fresh||JSON.stringify(previous.node.props)!==JSON.stringify(node.props)||previous.node.text!==node.text)ops.push({op:'set',id,props:node.props,text:node.text??null});
    if(fresh||replaced.has(parent)||previous.parent!==parent||previous.index!==index)ops.push({op:'place',id,parent,index});
  }
  return ops;
}
function renderedFallback(tree) {
  let text='';const add=value=>{const part=typeof value==='string'?value.slice(0,LIMITS.text):display(value);if(part&&text.length<LIMITS.text)text+=(part+'\n').slice(0,LIMITS.text-text.length);};
  const visit=nodes=>{for(const node of nodes){if(text.length>=LIMITS.text)return;const p=node.props;if(p.hidden)continue;if(node.text!==undefined)add(node.text);else {add(p.label||p.caption||'');if(p.value!==undefined)add(p.value);if(p.checked!==undefined)add(p.checked?'Checked':'Unchecked');if(p.unit)add(p.unit);if(p.change!==undefined)add(p.change);if(node.type==='AppBlock')add('[App source requires an isolated host renderer.]');if(node.type==='table'){const cols=(p.columns||Object.keys(p.rows?.[0]||{})).slice(0,30).map(c=>typeof c==='string'?c:record(c)?display(c.key):'');add(cols.join(' | '));for(const row of (p.rows||[]).slice(0,30))add(cols.map(c=>display(row?.[c])).join(' | '));if(p.rows?.length>30)add('Table preview: 30 of '+p.rows.length+' rows.');}if(node.type==='chart')for(const row of (p.data||[]).slice(0,30))add(display(row?.[p.x||'label'])+': '+display(row?.[p.y||'value']??row));visit(node.children||[]);}}};visit(tree);return text.trim();
}
export class UIRuntime {
  constructor({catalog=CATALOG}={}){this.catalog=catalog;this.state=new Map();this.tree=[];this.handlers=new Map();this.data=Object.create(null);this.version=0;this.document=null;this.viewport=DEFAULT_VIEWPORT;this.active=false;this.disposed=false;}
  update(source,{partial=false,data=this.data,viewport=this.viewport}={}) {
    if(this.disposed)throw new UIError('disposed','UI runtime is disposed.');
    const document=compile(source,{partial,catalog:this.catalog});return this.apply(document,{data,viewport});
  }
  apply(document,{data=this.data,viewport=this.viewport}={}) {
    if(this.disposed)throw new UIError('disposed','UI runtime is disposed.');
    // The wire representation is inert JSON. Never accept functions, prototypes or host objects.
    document=boundedData(document);data=boundedData(data);viewport=normalizeViewport(viewport);if(!record(data))throw new UIError('data','UI data must be an object.');
    if(!record(document)||document.version!==1||!record(document.program)||!Array.isArray(document.program.children)||!record(document.constants)||Object.values(document.constants).some(v=>typeof v!=='string')||typeof document.partial!=='boolean'||!Array.isArray(document.diagnostics)||!Array.isArray(document.recoveryDiagnostics)||[...document.diagnostics,...document.recoveryDiagnostics].some(d=>!record(d)||typeof d.code!=='string'||typeof d.message!=='string'))throw new UIError('program','Invalid compiled UI document.');
    const previous={state:new Map(this.state),data:this.data,document:this.document,handlers:this.handlers,viewport:this.viewport,diagnostics:this.diagnostics,tree:this.tree,version:this.version};
    try {const change=classifyUpdate(this.document,document),kind=change!=='none'?change:JSON.stringify(data)!==JSON.stringify(this.data)?'data':JSON.stringify(viewport)!==JSON.stringify(this.viewport)?'viewport':'none';this.data=data;this.viewport=viewport;const next=this.render(document),operations=diffTrees(this.tree,next);this.tree=next;this.document=document;this.version++;return this.result(operations,kind);}
    catch(error){this.state=previous.state;this.data=previous.data;this.document=previous.document;this.handlers=previous.handlers;this.viewport=previous.viewport;this.diagnostics=previous.diagnostics;this.tree=previous.tree;this.version=previous.version;throw error;}
  }
  /** Apply data/text changes without recompiling source. Keys are exact, not JSON paths. */
  patch(patch,expectedVersion=this.version) {
    if(this.disposed)throw new UIError('disposed','UI runtime is disposed.');
    if(!this.document)throw new UIError('program','Load a compiled document before patching it.');
    if(expectedVersion!==this.version)throw new UIError('stale_event','The UI changed before this patch.');
    patch=boundedData(patch);
    if(!record(patch)||Object.keys(patch).some(key=>!['constants','data','partial','viewport'].includes(key)))throw new UIError('patch','Unknown UI patch field.');
    const constants={...this.document.constants};
    if(patch.constants!==undefined) {
      if(!record(patch.constants))throw new UIError('patch','Constants must be an object.');
      for(const [key,value] of Object.entries(patch.constants)) {
        if(!Object.hasOwn(constants,key)||typeof value!=='string')throw new UIError('patch','Patch an existing string constant only.');
        constants[key]=value;
      }
    }
    if(Object.hasOwn(patch,'data')&&!record(patch.data))throw new UIError('patch','Patch data must be an object.');
    if(patch.partial!==undefined&&typeof patch.partial!=='boolean')throw new UIError('patch','partial must be a boolean.');
    return this.apply({...this.document,constants,partial:patch.partial??this.document.partial},{data:patch.data??this.data,viewport:patch.viewport??this.viewport});
  }
  resize(viewport,expectedVersion=this.version) {return this.patch({viewport},expectedVersion);}
  render(document) {
    const work=budget(),scope=baseScope(),handlers=new Map(),ids=new Set(),seenState=new Set();let nodes=0,renderBytes=0;
    const diagnostics=[];scope.data=this.data;
    for(const [name,value] of Object.entries(this.data)){safeKey(name);if(!Object.hasOwn(scope,name)&&/^[A-Za-z_$][\w$]*$/.test(name))scope[name]=value;}
    const intent=(type,args)=>{if(!this.active)throw new UIError('action_during_render','Host actions require an explicit user interaction.');if(this.actions.length>=16)throw new UIError('action_limit','Too many actions from one interaction.');this.actions.push(boundedData({type,args},32000));return null;};
    scope.GenUI={issueNewTurn:new Callable(args=>intent('message',args)),copy:new Callable(args=>intent('copy',args)),openUrl:new Callable(args=>intent('link',args)),callTool:new Callable(args=>intent('tool',args)),updateContext:new Callable(args=>intent('context',args)),openEntityDetail:new Callable(args=>intent('entity',args))};
    scope.DIL={useAppData:new Callable((args,work)=>args[0] instanceof Callable?args[0].run([this.data],work):this.data),useConstants:new Callable(()=>document.constants),useViewport:new Callable(()=>this.viewport),useBreakpoint:new Callable(args=>matchesBreakpoint(this.viewport,args[0]))};
    const evaluateSafe=(ast,local)=>{try{return evaluate(ast,local,work);}catch(error){if(error.code==='budget')throw error;if(diagnostics.length<100)diagnostics.push({code:error.code||'expression',message:error.message});return null;}};
    function emit(id,type,props={},children=[],text){renderBytes+=(id.length+(text?.length||0)+JSON.stringify(props).length)*2;if(id.length>2048||renderBytes>LIMITS.dataBytes)throw new UIError('render_limit','Rendered UI data exceeds its aggregate byte limit.');if(++nodes>LIMITS.nodes)throw new UIError('node_limit','Rendered UI exceeds 2,000 nodes.');if(ids.has(id))throw new UIError('duplicate_key','Duplicate UI key: '+id);ids.add(id);return {id,type,props,children,...(text!==undefined?{text}: {})};}
    const walk=(program,local,prefix='root',depth=0)=>{
      if(depth>LIMITS.depth||!Array.isArray(program))throw new UIError('program','Invalid or deeply nested UI program.');const output=[];
      for(const n of program){work.tick();if(!record(n)||typeof n.key!=='string'||n.key.length>256)throw new UIError('program','Invalid UI node.');const id=prefix+'/'+n.key;
        if(n.t==='state'){
          safeKey(n.name);safeKey(n.setter);const stateKey=prefix+'/state:'+n.name;seenState.add(stateKey);
          if(!this.state.has(stateKey))this.state.set(stateKey,boundedData(evaluateSafe(n.value,local)??null,64000));
          local[n.name]=this.state.get(stateKey);
          local[n.setter]=new Callable((args,eventWork)=>{if(!this.active)throw new UIError('state_during_render','State setters require an interaction.');const value=args[0] instanceof Callable?args[0].run([this.state.get(stateKey)],eventWork):args[0];this.state.set(stateKey,boundedData(value??null,64000));return null;});continue;
        }
        if(n.t==='let'){local[safeKey(n.name)]=evaluateSafe(n.value,local);continue;}
        if(n.t==='literalText'||n.t==='markdown'){const value=document.constants[n.constant];if(typeof value!=='string')throw new UIError('program','Missing text constant.');if(value.trim()||n.t==='literalText')output.push(emit(id,n.t==='markdown'?'markdown':'#text',{},[],value));continue;}
        if(n.t==='expression'){output.push(emit(id,'#text',{},[],display(evaluateSafe(n.value,local))));continue;}
        if(n.t==='if'){
          if(!Array.isArray(n.branches)||n.branches.length>100)throw new UIError('program','Invalid condition branches.');let selected=n.otherwise,branch='else';
          for(let i=0;i<n.branches.length;i++)if(evaluateSafe(n.branches[i].test,local)){selected=n.branches[i].children;branch=String(i);break;}
          output.push(...walk(selected,Object.assign(Object.create(null),local),id+':'+branch,depth+1));continue;
        }
        if(n.t==='each'){
          const values=evaluateSafe(n.value,local);if(values==null)continue;if(!Array.isArray(values)||values.length>LIMITS.items)throw new UIError('loop_limit','Each requires a bounded array.');
          const keys=new Set();for(let i=0;i<values.length;i++){work.tick();const child=Object.assign(Object.create(null),local);child[safeKey(n.name)]=values[i];if(n.index)child[safeKey(n.index)]=i;
            const v=n.itemKey?evaluateSafe(n.itemKey,child):i;if(!['string','number'].includes(typeof v))throw new UIError('loop_key','Loop keys must be strings or numbers.');const item=JSON.stringify(v);if(item.length>200||keys.has(item))throw new UIError('duplicate_key','Loop keys must be distinct and bounded.');keys.add(item);output.push(...walk(n.children,child,id+':'+item,depth+1));}continue;
        }
        if(n.t!=='element'||!Object.hasOwn(this.catalog,n.type)||!record(n.props))throw new UIError('program','Unknown UI instruction or component.');
        const props=Object.create(null),events=[];for(const [name,ast] of Object.entries(n.props)){
          if(!Object.hasOwn(this.catalog[n.type],name))continue;const value=evaluateSafe(ast,local),type=this.catalog[n.type][name];
          if(!validProp(type,value,value instanceof Callable)){if(diagnostics.length<100)diagnostics.push({code:'invalid_prop',message:'Invalid '+n.type+'.'+name});continue;}
          if(type==='event')events.push([name,value]);else props[name]=boundedData(value,200000);
        }
        const nodeId=Object.hasOwn(props,'key')?prefix+'/key:'+props.key:id;
        for(const [name,fn] of events){const eventId=nodeId+':'+name;handlers.set(eventId,fn);props[name]=eventId;}
        if(n.html){const html=document.constants[n.html];if(typeof html!=='string')throw new UIError('program','Missing app source.');props.html=html;}
        output.push(emit(nodeId,n.type,props,walk(n.children,Object.assign(Object.create(null),local),nodeId,depth+1)));
      }
      return output;
    };
    const result=walk(document.program.children,scope);
    // Remove abandoned state only after complete streams, never while a tag is half written.
    if(!document.partial)for(const name of this.state.keys())if(!seenState.has(name))this.state.delete(name);
    if(this.state.size>LIMITS.nodes)throw new UIError('state_limit','UI state exceeds limit.');
    boundedData(Object.fromEntries(this.state),LIMITS.dataBytes);
    this.handlers=handlers;this.diagnostics=diagnostics;return result;
  }
  dispatch(id,args=[],expectedVersion=this.version) {
    if(this.disposed)throw new UIError('disposed','UI runtime is disposed.');
    if(expectedVersion!==this.version)throw new UIError('stale_event','The UI changed before this interaction.');
    const handler=this.handlers.get(id);if(!handler)throw new UIError('event','This event is no longer available.');
    args=boundedData(args,64000);if(!Array.isArray(args))throw new UIError('event','Event arguments must be an array.');
    const state=new Map(this.state);this.actions=[];this.active=true;
    try{handler.run(args,budget());this.active=false;const next=this.render(this.document),operations=diffTrees(this.tree,next);this.tree=next;this.version++;return {...this.result(operations,'interaction'),actions:this.actions};}
    catch(error){this.state=state;throw error;}finally{this.active=false;this.actions=[];}
  }
  result(operations,kind){return {kind,version:this.version,operations,tree:this.tree,diagnostics:[...(this.document?.diagnostics||[]),...(this.diagnostics||[])],recoveryDiagnostics:this.document?.recoveryDiagnostics||[],fallbackMarkdown:renderedFallback(this.tree),actions:[]};}
  snapshot(){return boundedData({state:Object.fromEntries(this.state)});}
  restore(snapshot){const clean=boundedData(snapshot);if(!record(clean.state))throw new UIError('state','Invalid state snapshot.');const entries=Object.entries(clean.state);if(entries.length>LIMITS.nodes)throw new UIError('state_limit','Too many state entries.');this.state=new Map(entries);}
  dispose(){this.disposed=true;this.tree=[];this.state.clear();this.handlers.clear();this.document=null;this.data=Object.create(null);}
}
