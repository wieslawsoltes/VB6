import {isWebBrowser,WEB_BROWSER_EVENTS} from '../controls/webbrowser-contract.js';
import {validParameterList} from './signature-syntax.js';
import {CONTROL_EVENTS,DEFAULT_EVENTS,NONVISUAL_TYPES} from '../controls/controls.js';
import {defaultEventSignature} from './language-service.js';
import {IDENTIFIER,symbolKey,splitArguments} from './source-context.js';

const eq=(a,b)=>symbolKey(a)===symbolKey(b);
const event=(type,name,extra=[])=>({name,kind:'event',type:'Void',params:[...extra,...splitArguments(defaultEventSignature(type,name)||'')]});
const usable=s=>!s.hidden&&!s.restricted&&s.scope!=='private';
/** Object/Procedure dropdown contents are derived from the same live index as
 * completion. No project, COM server, control constructor or event is run. */
export function declarationTargets(project,module,service,controlRegistry=null){
  const index=service.index(module,project),result=[];
  if(module.form){
    const formName=module.form.type==='MDIForm'?'MDIForm':'Form';
    result.push({id:'$form',name:formName,kind:'events',members:[...new Set(['Initialize','Load','Activate','Deactivate','Resize','Paint','QueryUnload','Unload',...CONTROL_EVENTS])].map(name=>event(formName,name))});
    const controls=new Map((module.form.controls||[]).map(c=>[symbolKey(c.name),c]));
    for(const control of controls.values()){
      const names=NONVISUAL_TYPES.has(control.type)?(control.type==='Timer'?['Timer']:[]):[DEFAULT_EVENTS[control.type]||'Click',...CONTROL_EVENTS];
      const extra=control.properties?.Index!==undefined?['Index As Integer']:[];
      const custom=controlRegistry?.describe?.(control.type)?.events||(isWebBrowser(control.type)?WEB_BROWSER_EVENTS:null);
      result.push({id:control.id||'control:'+control.name,name:control.name,type:control.type,kind:'events',members:custom?.length?custom.map(e=>({name:e.name,kind:'event',type:'Void',params:[...extra,...e.params.map(p=>(p.byRef?'ByRef ':'ByVal ')+p.name+(p.array?'()':'')+' As '+p.type)]})):[...new Set(names)].map(name=>event(control.type,name,extra))});
    }
    const menus=new Map((module.form.menus||[]).filter(m=>m.name).map(m=>[symbolKey(m.name),m]));
    for(const menu of menus.values())result.push({id:menu.id||'menu:'+menu.name,name:menu.name,kind:'events',members:[event('Menu','Click',menu.properties?.Index!==undefined?['Index As Integer']:[])]});
  }else if(module.kind==='class')result.push({id:'$class',name:'Class',kind:'events',members:['Initialize','Terminate'].map(name=>event('Class',name))});
  if(module.kind!=='module'){
    for(const source of index.symbols.filter(s=>!s.owner&&s.withEvents&&!s.array)){
      const type=service.type(project,module,source.type);
      result.push({id:'withevents:'+source.offset,name:source.name,kind:'events',members:(type?.members||[]).filter(s=>s.kind==='event'&&usable(s))});
    }
    for(const name of index.interfaces){
      const type=service.type(project,module,name),members=(type?.members||[]).filter(s=>s.kind!=='event'&&usable(s)).flatMap(s=>{
        if(s.accessors)return s.accessors;
        // Public scalar fields are get/let (or get/set) members of a VB class
        // interface. Generate the same contract as the compiler's binder.
        if(s.kind==='variable'&&!s.array){
          const object=!/^(Variant|String|Boolean|Byte|Integer|Long|Single|Double|Currency|Date)$/i.test(s.type),accessor=object?'set':'let';
          return [{...s,kind:'property',accessor:'get',params:[]},{...s,kind:'property',accessor,params:['ByRef value As '+s.type]}];
        }
        return [s];
      });
      result.push({name:name.split('.').at(-1),type:name,kind:'interface',members:members.filter(s=>s.params).map(s=>({...s,label:s.name+(s.accessor?' ('+s.accessor+')':''),key:s.name+(s.accessor?':'+s.accessor:'')}))});
    }
  }
  return result;
}
/** Return an undo-ready edit or an existing declaration. The caller must
 * verify project identity and read-only/run state before applying this edit. */
export function handlerEdit(project,module,service,object,key,controlRegistry=null){
  const target=declarationTargets(project,module,service,controlRegistry).find(t=>eq(t.name,object));
  const selected=target?.members.find(m=>eq(m.key||m.name,key));
  if(!target||!selected)return null;
  const name=target.name+'_'+selected.name;
  if(!new RegExp('^'+IDENTIFIER+'$','u').test(name))return null;
  const accessor=selected.accessor||null;
  const existing=service.index(module,project).procedures.find(p=>eq(p.name,name)&&p.accessor===accessor);
  if(existing)return {existing,name,line:existing.line,offset:existing.offset};
  let kind=target.kind==='events'?'Sub':accessor?'Property '+accessor[0].toUpperCase()+accessor.slice(1):selected.type==='Void'||selected.kind==='sub'?'Sub':'Function';
  const suffix=/^(Function|Property Get)$/.test(kind)?' As '+(selected.type||'Variant')+(selected.array?'()':''):'';
  const ending=kind.startsWith('Property')?'Property':kind;
  // Retain all argument modes/types; interface names and imported metadata are
  // validated before reaching here. Parameters cannot add source statements.
  if(!validParameterList(selected.params||[]))return null;
  const eol=module.code.includes('\r\n')?'\r\n':'\n',indent=' '.repeat(project.settings?.tabWidth||4);
  const start=module.code.length,prefix=module.code.endsWith(eol)?eol:eol+eol;
  const header='Private '+kind+' '+name+'('+(selected.params||[]).join(', ')+')'+suffix;
  return {name,start,end:start,text:prefix+header+eol+indent+eol+'End '+ending+eol,caret:start+prefix.length+header.length+eol.length+indent.length};
}
