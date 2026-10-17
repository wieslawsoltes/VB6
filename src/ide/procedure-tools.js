import {scanDeclarations} from '../editor/intelligence.js';
import {KEYWORDS} from '../editor/language-service.js';
import {lower} from '../core/core.js';
import {moduleLanguage} from '../project/language.js';
import {PASCAL_KEYWORDS,pascalProcedureEdit,pascalTokens} from '../editor/pascal-service.js';
const reserved=new Set(KEYWORDS.map(lower));
/** Produces source, never modifies a live project until the dialog commits. */
export function addProcedureSource(module,{name,type='Sub',scope='Public',staticLocals=false,language=moduleLanguage(module)}={}){
 name=String(name||'').trim();if(!/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(name)||(language==='pascal'?PASCAL_KEYWORDS.includes(lower(name)):reserved.has(lower(name))))throw new Error('Enter a valid, nonreserved procedure name beginning with a letter.');
 if(!['Sub','Function','Property'].includes(type)||!['Public','Private'].includes(scope))throw new Error('Invalid procedure type or scope.');
 if(scanDeclarations({...module,language}).symbols.some(s=>!s.owner&&lower(s.name)===lower(name)))throw new Error('A module member already has that name.');
 if(language==='pascal'){
  if(type==='Property')throw new Error('Turbo Pascal uses functions and procedures for accessors. Choose Function or Procedure.');
  if(staticLocals)throw new Error('Declare persistent Pascal state in the unit var section.');
  const edit=pascalProcedureEdit(module,{name,returnType:type==='Function'?'Variant':null}),tokens=pascalTokens(module.code),implementation=tokens.find(t=>t.type==='id'&&String(t.value).toLowerCase()==='implementation');
  let code=module.code.slice(0,edit.start)+edit.text+module.code.slice(edit.end),caret=edit.caret;
  if(scope==='Public'&&implementation){const header=(type==='Function'?'function ':'procedure ')+name+(type==='Function'?': Variant':'')+';\n\n';code=code.slice(0,implementation.start)+header+code.slice(implementation.start);caret+=header.length;}
  return {name,code,line:code.slice(0,caret).split('\n').length};
 }
 const prefix=module.code.trimEnd()+'\n\n',head=scope+(staticLocals?' Static':'');
 const source=type==='Property'?`${head} Property Get ${name}() As Variant\n\nEnd Property\n\n${head} Property Let ${name}(ByVal vNewValue As Variant)\n\nEnd Property\n`:`${head} ${type} ${name}()${type==='Function'?' As Variant':''}\n\nEnd ${type}\n`;
 return {code:prefix+source,line:prefix.split('\n').length+1,name};
}
const attrPattern=/^Attribute\s+([A-Za-z_]\w*)\.(VB_Description|VB_HelpID|VB_UserMemId|VB_MemberFlags)\s*=\s*(.*)$/i;
export function readProcedureAttributes(module,name){const out={description:'',helpContext:0,memberId:null,hidden:false,restricted:false};for(const line of module.attributes||[]){const m=line.match(attrPattern);if(!m||lower(m[1])!==lower(name))continue;const key=lower(m[2]);if(key==='vb_description')out.description=m[3].replace(/^"|"$/g,'').replace(/""/g,'"');else if(key==='vb_helpid')out.helpContext=Number(m[3])||0;else if(key==='vb_usermemid')out.memberId=Number(m[3]);else{const flags=m[3].replace(/"/g,''),bits=parseInt(flags,16)||0;out.hidden=!!(bits&64);out.restricted=!!(bits&1);}}
 return out;
}
export function updateProcedureAttributes(module,name,{description='',helpContext=0,memberId=null,hidden=false,restricted=false}={}){
 if(!scanDeclarations(module).procedures.some(p=>lower(p.name)===lower(name)))throw new Error('Select an existing procedure.');
 if(typeof description!=='string'||description.length>4096||/[\r\n\0]/.test(description))throw new Error('Description must be one line of at most 4,096 characters.');
 helpContext=Number(helpContext);if(!Number.isInteger(helpContext)||helpContext<0||helpContext>2147483647)throw new Error('Help context must be an integer from 0 to 2147483647.');
 if(memberId!==null&&memberId!==''){memberId=Number(memberId);if(!Number.isInteger(memberId)||memberId< -2147483648||memberId>2147483647)throw new Error('Procedure ID must fit a signed Long.');}else memberId=null;
 const lines=(module.attributes||[]).filter(line=>{const m=line.match(attrPattern);return !m||lower(m[1])!==lower(name);});
 if(description)lines.push(`Attribute ${name}.VB_Description = "${description.replace(/"/g,'""')}"`);
 if(helpContext)lines.push(`Attribute ${name}.VB_HelpID = ${helpContext}`);
 if(memberId!==null)lines.push(`Attribute ${name}.VB_UserMemId = ${memberId}`);
 if(hidden||restricted)lines.push(`Attribute ${name}.VB_MemberFlags = "${((hidden?64:0)|(restricted?1:0)).toString(16).toUpperCase()}"`);
 return lines;
}
/** Container-local twip geometry. Different containers never share a coordinate plane. */
export function formatControls(form,controls,command,grid=120,primaryId=controls[0]?.id){
 if(!controls.length)return false;if(controls.some(c=>(c.parent||'')!==(controls[0].parent||'')))throw new Error('Select controls in the same container.');
 grid=Number(grid);if(!Number.isFinite(grid)||grid<1)throw new Error('Invalid grid size.');
 const axis=command.startsWith('horizontal')?'horizontal':command.startsWith('vertical')?'vertical':null,key=axis==='horizontal'?'Left':'Top',size=axis==='horizontal'?'Width':'Height';
 if(axis){if(controls.length<2)return false;const items=[...controls].sort((a,b)=>a.properties[key]-b.properties[key]),mode=command.slice(axis.length),last=items.at(-1).properties;
  if(mode==='Equal'&&items.length>=3){const first=items[0].properties,total=items.reduce((n,c)=>n+Number(c.properties[size]),0),gap=(last[key]+last[size]-first[key]-total)/(items.length-1);let position=first[key]+first[size]+gap;for(let i=1;i<items.length-1;i++){items[i].properties[key]=Math.round(position);position+=items[i].properties[size]+gap;}return true;}
  if(!['Increase','Decrease','Remove'].includes(mode))return false;
  const anchor=Math.max(0,items.findIndex(c=>c.id===primaryId));if(mode==='Remove'){for(let i=anchor+1;i<items.length;i++)items[i].properties[key]=items[i-1].properties[key]+items[i-1].properties[size];for(let i=anchor-1;i>=0;i--)items[i].properties[key]=items[i+1].properties[key]-items[i].properties[size];}else for(let i=0;i<items.length;i++)items[i].properties[key]+=(mode==='Increase'?grid:-grid)*(i-anchor);return true;
 }
 const parent=controls[0].parent?form.controls.find(c=>lower(c.name)===lower(controls[0].parent)):null,props=parent?.properties||form.properties;
 if(command==='centerHorizontalInForm'||command==='centerVerticalInForm'){
  const horizontal=command==='centerHorizontalInForm',key=horizontal?'Left':'Top',size=horizontal?'Width':'Height',available=Number(parent?props[size]:props[horizontal?'ClientWidth':'ClientHeight']),dummy=0;for(const c of controls)c.properties[key]=Math.round((available-c.properties[size])/2);return true;
 }
 if(command==='sizeToGrid'){for(const c of controls)for(const key of ['Width','Height'])c.properties[key]=Math.max(grid,Math.round(c.properties[key]/grid)*grid);return true;}
 if(command==='sizeToTallest'||command==='sizeToShortest'||command==='sizeToWidest'||command==='sizeToNarrowest'){const key=/Widest|Narrowest/.test(command)?'Width':'Height',value=(/Tallest|Widest/.test(command)?Math.max:Math.min)(...controls.map(c=>c.properties[key]));for(const c of controls)c.properties[key]=value;return true;}
 return false;
}
