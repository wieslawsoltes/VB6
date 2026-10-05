/** Loss-preserving VBW document rectangles. Native tool docking is not stored here. */
import {decodeNativeText,encodeNativeText,linesOf,lineBody,lineEnding,preferredEOL} from './native-text.js';
const key=value=>String(value).toLowerCase();
export function nativeWindowStatePath(project){return (project.nativeProject?.path||project.name+'.vbp').replace(/\.vbp$/i,'.vbw');}
function pane(parts){
  if(parts.length!==5||parts.slice(0,4).some(v=>!/^\s*-?\d+\s*$/.test(v)))return null;
  const [left,top,right,bottom]=parts.slice(0,4).map(Number),flag=parts[4].trim().toUpperCase();
  if(!['','C','Z'].includes(flag)||[left,top,right,bottom].some(v=>!Number.isSafeInteger(v)||Math.abs(v)>1000000))return null;
  return {rect:{x:left,y:top,width:right-left,height:bottom-top},closed:flag==='C',maximized:flag==='Z'};
}
export function parseVBW(input,options={}){
  const document=decodeNativeText(input,options);if(document.text.length>1024*1024)throw new Error('VBW exceeds 1 MiB');
  const records=[],warnings=[],seen=new Set(),opaqueNames=[];
  for(const [index,line]of linesOf(document.text).entries()){
    const match=lineBody(line).match(/^(\s*([A-Za-z_]\w*)\s*=\s*)(.*)$/);if(!match)continue;
    const fields=match[3].split(','),code=pane(fields.slice(0,5)),form=fields.length>=10?pane(fields.slice(5,10)):null;
    if(![5,10].includes(fields.length)||!code||fields.length===10&&!form){opaqueNames.push(match[2]);warnings.push('Unrecognized VBW record at line '+(index+1)+' preserved without restoring it.');continue;}
    if(seen.has(key(match[2]))){warnings.push('Duplicate VBW module '+match[2]+' preserved without restoring it.');records.filter(r=>key(r.name)===key(match[2])).forEach(r=>r.ambiguous=true);continue;}
    seen.add(key(match[2]));records.push({name:match[2],index,prefix:match[1],code,form});
  }
  return {version:1,document,records,warnings,opaqueNames};
}
export function attachNativeWindowState(project,entries,options={}){
  if(!project.nativeProject)return;
  const wanted=key(nativeWindowStatePath(project)),matches=[...entries.keys()].filter(p=>key(p)===wanted);if(matches.length!==1)return;
  const state=parseVBW(entries.get(matches[0]),options);state.path=matches[0];
  // Stable module IDs permit later native renames without guessing by display name.
  for(const record of state.records){const m=project.modules.find(m=>key(m.name)===key(record.name));if(m)record.moduleId=m.id;}
  project.nativeWindowState=state;
}
export function nativeDocumentWindows(project){
  const state=project.nativeWindowState;if(state?.version!==1)return [];
  if(state.current){validateSnapshot(project,state.current);return structuredClone(state.current);}
  const windows=[];
  for(const record of state.records||[]){if(record.ambiguous)continue;const m=project.modules.find(m=>m.id===record.moduleId||key(m.name)===key(record.name));if(!m)continue;
    for(const view of ['code','form']){const value=record[view];if(!value||value.closed||view==='form'&&!m.form)continue;windows.push({key:m.id+':'+view,id:m.id,view,rect:value.rect,maximized:value.maximized,minimized:false});}
  }return windows;
}
function validWindow(w){return w&&['code','form'].includes(w.view)&&w.rect&&['x','y','width','height'].every(k=>Number.isFinite(w.rect[k])&&Math.abs(w.rect[k])<=1000000)&&w.rect.width>0&&w.rect.height>0;}
function validateSnapshot(project,windows){
  if(!Array.isArray(windows)||windows.length>512||windows.some(w=>!validWindow(w)||!project.modules.some(m=>m.id===w.id&&(w.view==='code'||m.form))))throw new Error('Invalid native document window snapshot');
  if(new Set(windows.map(w=>w.id+':'+w.view)).size!==windows.length)throw new Error('Duplicate native document window');
}
export function captureNativeWindowState(project,windows){
  validateSnapshot(project,windows);const allowed=windows;
  project.nativeWindowState ||= {version:1,path:nativeWindowStatePath(project),document:{text:'',encoding:project.nativeProject?.document?.encoding||'windows-1252',bom:false},records:[],warnings:[]};
  project.nativeWindowState.current=structuredClone(allowed);
}
function fields(value,old){
  const rect=value?.rect||old?.rect||{x:0,y:0,width:0,height:0};
  const {x,y,width,height}=rect;return [x,y,x+width,y+height].map(Math.round).concat(!value?'C':value.maximized?'Z':'').join(', ');
}
export function serializeVBW(project){
  const state=project.nativeWindowState;if(!state)return null;
  if(state.version!==1)throw new Error('Unsupported native window state');
  if(!state.current)return encodeNativeText(state.document.text,state.document);
  validateSnapshot(project,state.current);
  const lines=linesOf(state.document.text),eol=preferredEOL(state.document.text),used=new Set();
  const render=(m,record)=>{const pane=view=>state.current.find(w=>w.id===m.id&&w.view===view);return (record?.prefix.replace(record.name,m.name)||m.name+' = ')+fields(pane('code'),record?.code)+(m.form?', '+fields(pane('form'),record?.form):'');};
  for(const record of state.records||[]){if(record.ambiguous)continue;const m=project.modules.find(m=>m.id===record.moduleId||key(m.name)===key(record.name));if(!m)continue;lines[record.index]=render(m,record)+(lineEnding(lines[record.index])||eol);used.add(m.id);}
  for(const m of project.modules)if(!used.has(m.id)&&!state.records?.some(r=>key(r.name)===key(m.name))&&!state.opaqueNames?.some(n=>key(n)===key(m.name))){if(lines.length&&!lineEnding(lines.at(-1)))lines[lines.length-1]+=eol;lines.push(render(m)+eol);}
  return encodeNativeText(lines.join(''),state.document);
}
