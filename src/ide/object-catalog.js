import {layoutMembers,layoutType} from '../layout/intelligence.js';
import {EditorIntelligence} from '../editor/intelligence.js';
import {TYPE_CATALOG,ENUM_TYPES,BUILTIN_SYMBOLS,runtimeType,builtinGroup} from '../editor/type-catalog.js';
import {readProcedureAttributes} from './procedure-tools.js';
import {compileModule} from '../language/compiler.js';
import {BASIC_CONTROL_TYPES,EXTENDED_CONTROL_TYPES,createControl,createForm} from '../project/model.js';
import {procedures,defaultEventSignature} from '../editor/language-service.js';
import {DEFAULT_EVENTS} from '../controls/controls.js';

const glyphs={function:'◇',sub:'◇',property:'▣',variable:'•',constant:'◆',event:'ϟ',type:'▤',control:'▣'};
export function buildObjectCatalog(project){
  const classes=[];
  const add=(library,name,description,members,moduleId=null)=>{const key=library+':'+(moduleId||name);const entry={key,library,name,label:name,description,moduleId,members:members.map((m,i)=>({...m,key:key+':'+(m.key||m.name+':'+m.kind+':'+i),classKey:key,className:name,library,moduleId:m.moduleId||moduleId,glyph:glyphs[m.kind]||'•',label:m.name+(m.accessor?' ('+m.accessor+')':'')}))};classes.push(entry);return entry;};
  for(const input of project.modules){let compiled;try{compiled=compileModule(input);}catch(error){compiled={procedures:new Map(),declarations:[],types:{},diagnostics:[error]};}const lines=input.code.split('\n'),members=[],find=name=>Math.max(0,lines.findIndex(l=>new RegExp('\\b'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(l)))+1;
    for(const proc of compiled.procedures.values())members.push({name:proc.name,kind:proc.kind,accessor:proc.accessor,scope:proc.scope||'public',line:proc.line,signature:lines[proc.line-1]?.trim()||proc.name});
    const procNames=new Set(members.map(m=>m.name.toLowerCase()+':'+(m.accessor||'')));
    // Preserve navigation while a procedure body is temporarily incomplete.
    for(const p of procedures(input.code)){const accessor=p.kind.match(/Property\s+(\w+)/i)?.[1]?.toLowerCase();if(!procNames.has(p.name.toLowerCase()+':'+(accessor||'')))members.push({name:p.name,kind:accessor?'property':p.kind.toLowerCase(),accessor,line:p.line,scope:/^\s*Private\b/i.test(lines[p.line-1])?'private':'public',signature:lines[p.line-1].trim(),incomplete:true});}
    for(const d of compiled.declarations){const line=d.line||find(d.name);members.push({name:d.name,kind:d.constant?'constant':'variable',scope:d.scope||'public',line,signature:(d.scope||'public')+' '+(d.constant?'Const ':'')+d.name+(d.bounds?'()':'')+' As '+d.type});}
    for(const e of compiled.events?.values()||[])members.push({name:e.name,kind:'event',scope:e.scope||'public',line:e.line||find(e.name),signature:lines[(e.line||find(e.name))-1].trim()});
    for(const name of Object.keys(compiled.types))members.push({name,kind:'type',line:find(name),signature:'Type '+name});
    for(const c of input.form?.controls||[])members.push({name:c.name,kind:'control',scope:'public',line:1,signature:c.name+' As '+c.type+(c.properties.Index!==undefined?' ('+c.properties.Index+')':'')});
    for(const member of members){const attributes=readProcedureAttributes(input,member.name);member.description=attributes.description;member.hidden=attributes.hidden;member.helpContext=attributes.helpContext;}
    const tolerant=new EditorIntelligence().index(input,project);
    for(const symbol of tolerant.symbols.filter(s=>!s.owner)){
      const current=members.find(m=>m.name.toLowerCase()===symbol.name.toLowerCase()&&(m.accessor||null)===(symbol.accessor||null));
      if(current){if(symbol.type)current.type=symbol.type;if(symbol.params)current.params=symbol.params;}
      else members.push({...symbol,kind:symbol.accessor?'property':symbol.kind,incomplete:!!compiled.diagnostics.length});
    }
    add(project.name,input.name,input.kind+' in current project'+(compiled.diagnostics.length?' — source contains diagnostics':''),members,input.id);
  }
  const groups={};
  for(const intrinsic of BUILTIN_SYMBOLS){const group=builtinGroup(intrinsic.name);(groups[group]||=[]).push({...intrinsic,description:'Implemented browser runtime intrinsic. Typed metadata is shared with IntelliSense; full native coercion parity is not implied.'});}
  for(const [group,members]of Object.entries(groups))if(members.length)add('VBA',group,'Implemented intrinsic functions',members);
  for(const name of ['Form','MDIForm',...BASIC_CONTROL_TYPES.filter(n=>!['Pointer','OLE'].includes(n)),...EXTENDED_CONTROL_TYPES]){
    const props=['Form','MDIForm'].includes(name)?createForm().form.properties:createControl(name).properties;
    const members=Object.entries(props).map(([name,value])=>({name,kind:'property',signature:name+' As '+(typeof value==='number'?'Long':Array.isArray(value)?'Variant':'String'),description:'Browser control property. Default: '+JSON.stringify(value)}));
    const event=DEFAULT_EVENTS[name];if(event)members.push({name:event,kind:'event',signature:'Event '+event+'('+defaultEventSignature(name,event)+')',description:'Default browser control event.'});
    add('VB',name,'Browser control adapter; catalog lists authored properties and the default event, not complete native OCX type information.',members);
  }
  add('Scripting','Dictionary','Browser dictionary adapter',[
    ['Add','Sub Add(Key, Item)'],['Item','Property Item(Key) As Variant'],['Exists','Function Exists(Key) As Boolean'],['Keys','Function Keys()'],['Items','Function Items()'],['Remove','Sub Remove(Key)'],['RemoveAll','Sub RemoveAll()'],['Count','Property Count As Long'],['CompareMode','Property CompareMode As Long']
  ].map(([name,signature])=>({name,kind:signature.startsWith('Property')?'property':'function',signature})));
  // Share the same declarative signatures and types as the source editor.
  // Keep legacy default-event descriptors, but replace guessed property types.
  const intelligence=new EditorIntelligence();
  for(const type of [...TYPE_CATALOG.values(),...ENUM_TYPES.values(),...intelligence.referenceTypes(project),...['AnchorStyles','DockStyle','LayoutMode'].map(n=>layoutType(project,n)).filter(Boolean)]){
    const library=type.library||(type.name.includes('.')?type.name.split('.')[0]:'VB'),name=type.name.split('.').slice(type.name.includes('.')?1:0).join('.');
    const current=classes.find(c=>c.library===library&&c.name===name),members=[...(runtimeType(project,type.name)||type).members,...((type.aliases||[]).some(a=>a.startsWith('VB.'))?layoutMembers(project,type.name):[])];
    const typed=new Set(members.map(m=>m.name.toLowerCase())),extra=current?.members.filter(m=>!typed.has(m.name.toLowerCase()))||[];
    if(current)classes.splice(classes.indexOf(current),1);
    add(library,name,type.library?'Explicit portable type-library metadata; native execution is not implied.':'Browser adapter metadata shared with IntelliSense; not complete native OCX type information.',[...extra,...members]);
  }
  for(const group of classes.filter(c=>c.library==='VBA'))for(const m of group.members){const declared=BUILTIN_SYMBOLS.find(s=>s.name===m.name);if(declared)m.signature=declared.signature;}
  for(const module of project.modules)for(const type of intelligence.index(module,project).records)add(project.name,module.name+'.'+type.name,'Project '+type.kind+' declaration',type.members);
  return classes.sort((a,b)=>a.name.localeCompare(b.name));
}
export function searchCatalog(classes,query,library='*',showPrivate=true){const q=String(query).toLowerCase();return classes.filter(c=>library==='*'||c.library===library).flatMap(c=>c.members.filter(m=>(showPrivate||m.scope!=='private'&&!m.hidden)&&(m.name.toLowerCase().includes(q)||c.name.toLowerCase().includes(q))).map(m=>({...m,label:c.library+' · '+c.name+' · '+m.label})));}
