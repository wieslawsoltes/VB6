/** Portable opt-in layout metadata. Never emit extension properties into .frm. */
import {LAYOUT_KEYS,layoutKey,layoutEnabled,validateLayout} from './contract.js';
import {VBError} from '../language/lexer.js';
const FORMAT='VB6Studio.Layout',MAX_BYTES=20*1024*1024;
const fail=message=>{throw new VBError('Layout companion: '+message,1002);};
export const layoutSidecarPath=path=>path+'.vb6layout.json';
const identity=n=>n.name.toLowerCase()+'#'+(n.properties?.Index??'');
export function encodeLayoutSidecar(project) {
  const modules=[];
  for(const m of project.modules||[])if(m.form){
    const nodes=[];
    for(const n of [m.form,...m.form.controls]){
      const properties=Object.fromEntries(LAYOUT_KEYS.filter(k=>Object.hasOwn(n.properties||{},k)).map(k=>[k,n.properties[k]]));
      if(Object.keys(properties).length)nodes.push({name:n.name,index:n.properties?.Index??null,form:n===m.form,properties});
    }
    if(nodes.length)modules.push({name:m.name,nodes});
  }
  if(!layoutEnabled(project)&&!modules.length)return null;
  const bytes=new TextEncoder().encode(JSON.stringify({format:FORMAT,version:1,enabled:layoutEnabled(project),modules},null,2)+'\n');
  if(bytes.length>MAX_BYTES)fail('file exceeds 20 MiB');return bytes;
}
export function decodeLayoutSidecar(bytes) {
  if(bytes.length>MAX_BYTES)fail('file exceeds 20 MiB');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid UTF-8 JSON');}
  if(value?.format!==FORMAT||value.version!==1||typeof value.enabled!=='boolean'||!Array.isArray(value.modules)||value.modules.length>1000)fail('unsupported format, version, or settings');
  const modules=new Set();let count=0;
  for(const m of value.modules){
    if(typeof m?.name!=='string'||!/^[A-Za-z_]\w*$/.test(m.name)||!Array.isArray(m.nodes)||m.nodes.length>10001||modules.has(m.name.toLowerCase()))fail('invalid or duplicate module');modules.add(m.name.toLowerCase());
    const nodes=new Set();
    for(const n of m.nodes){
      if(++count>100000)fail('node limit exceeded');
      if(typeof n?.name!=='string'||!/^[A-Za-z_]\w*$/.test(n.name)||typeof n.form!=='boolean'||n.index!==null&&(!Number.isInteger(n.index)||n.index<0||n.index>32767)||!n.properties||Array.isArray(n.properties)||typeof n.properties!=='object')fail('invalid node');
      const id=(n.form?'form:':'control:')+n.name.toLowerCase()+'#'+(n.index??'');if(nodes.has(id))fail('duplicate node');nodes.add(id);
      for(const [key,v]of Object.entries(n.properties))if(!LAYOUT_KEYS.includes(key)||typeof v!=='number'&&typeof v!=='string'||typeof v==='string'&&v.length>128)fail('invalid property '+key);
    }
  }
  return value;
}
/** Match names and array indices, not session IDs; validate atomically before publishing. */
export function applyLayoutSidecar(project,bytes) {
  const value=decodeLayoutSidecar(bytes),copy=structuredClone(project),modules=new Map(copy.modules.map(m=>[m.name.toLowerCase(),m]));
  for(const saved of value.modules){
    const m=modules.get(saved.name.toLowerCase());if(!m?.form)fail('missing form '+saved.name);
    const controls=new Map(m.form.controls.map(n=>[identity(n),n]));
    for(const n of saved.nodes){const target=n.form?m.form:controls.get(n.name.toLowerCase()+'#'+(n.index??''));if(!target||target.name.toLowerCase()!==n.name.toLowerCase())fail('missing component '+saved.name+'.'+n.name);for(const k of LAYOUT_KEYS)delete target.properties[k];Object.assign(target.properties,n.properties);}
  }
  copy.settings={...copy.settings,anchoring:value.enabled};validateLayout(copy);
  project.settings={...project.settings,anchoring:value.enabled};
  for(let i=0;i<project.modules.length;i++){const a=project.modules[i].form,b=copy.modules[i].form;if(!a)continue;const nodes=[a,...a.controls],next=[b,...b.controls];for(let j=0;j<nodes.length;j++)for(const k of LAYOUT_KEYS)if(Object.hasOwn(next[j].properties,k))nodes[j].properties[k]=next[j].properties[k];else delete nodes[j].properties[k];}
  return project;
}
/** Remove only designer-envelope extension entries. Preserve code and line endings. */
export function stripLayoutDesignerProperties(text) {
  let depth=0,groups=0,ended=false;
  return text.split(/(?<=\n)|(?<=\r)(?!\n)/).filter(line=>{
    const t=line.trim();if(ended)return true;
    if(/^Begin\s+\S+\s+\w+/i.test(t))depth++;
    else if(/^BeginProperty\b/i.test(t))groups++;
    else if(/^EndProperty\b/i.test(t))groups--;
    else if(/^End\s*(?:'.*)?$/i.test(t)&&depth){if(!--depth)ended=true;}
    else if(depth&&!groups){const match=t.match(/^([A-Za-z_]\w*)\s*=/);if(match&&layoutKey(match[1]))return false;}
    return true;
  }).join('');
}
