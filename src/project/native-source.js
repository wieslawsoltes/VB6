/** Lossless native source overlay. The original is authoritative for unedited data. */
import {linesOf,lineBody,lineEnding,preferredEOL,replaceLineValue,commentAt,quote} from './native-text.js';
import {nativeCodeStatements,nativeAttributeKey} from './native-code.js';
import {VBError} from '../language/lexer.js';
const fail=message=>{throw new VBError('Native source: '+message,1002);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const nodeKey=node=>node.name.toLowerCase()+'#'+(node.properties?.Index??'');
const modelNodes=module=>module.form?[module.form,...module.form.controls,...module.form.menus]:[];

/** Parse only the designer envelope; the remainder is code, never designer input. */
export function nativeTree(text){
  const lines=linesOf(text),prefix=[],stack=[];let root=null,tail='',end=-1;
  for(let i=0;i<lines.length;i++){
    const line=lines[i],body=lineBody(line),trim=body.trim();let m;
    if((m=trim.match(/^Begin\s+(\S+)\s+(\w+)\s*(?:'.*)?$/i))){
      const node={kind:'node',type:m[1],name:m[2],begin:line,end:'',items:[],properties:{}};
      if(stack.length)stack.at(-1).items.push(node);else {if(root)fail('multiple designer roots');root=node;}
      stack.push(node);
    }else if((m=trim.match(/^BeginProperty\s+(\w+(?:\(\d+\))?)(.*)$/i))&&stack.length){
      const group={kind:'group',name:m[1],suffix:m[2],begin:line,end:'',items:[]};stack.at(-1).items.push(group);stack.push(group);
    }else if(/^EndProperty\s*(?:'.*)?$/i.test(trim)&&stack.length){
      if(stack.at(-1).kind!=='group')fail('unexpected EndProperty');stack.pop().end=line;
    }else if(/^End\s*(?:'.*)?$/i.test(trim)&&stack.length){
      if(stack.at(-1).kind!=='node')fail('unterminated property group');stack.pop().end=line;
      if(!stack.length){end=i;tail=lines.slice(i+1).join('');break;}
    }else if(stack.length){
      const entry={kind:'line',line};
      if((m=body.match(/^\s*([^=]+?)\s*=\s*(.*)$/))){entry.key=m[1].trim();entry.value=m[2];if(entry.key.toLowerCase()==='index'&&stack.at(-1).properties)stack.at(-1).properties.Index=Number(m[2].split("'")[0].trim());}
      stack.at(-1).items.push(entry);
    }else prefix.push(line);
  }
  if(root&&end<0)fail('unterminated designer envelope');
  return {root,prefix:prefix.join(''),tail:root?tail:text};
}
function treeNodes(tree){const out=[];const visit=node=>{out.push(node);for(const child of node.items)if(child.kind==='node')visit(child);};if(tree.root)visit(tree.root);return out;}
function mapNodes(tree,identities){
  const byKey=new Map(identities.map(n=>[n.key,n.id])),out=new Map();
  for(const node of treeNodes(tree)){const id=byKey.get(nodeKey(node));if(!id)fail('unmapped designer node '+node.name);node.id=id;out.set(id,node);}
  return out;
}
function groupKey(item){return item.name.toLowerCase();}
function values(container,parse){const result=new Map();for(const item of container?.items||[])if(item.kind==='line'&&item.key)result.set(item.key.toLowerCase(),parse(item.value));return result;}
function groups(container){return new Map((container?.items||[]).filter(x=>x.kind==='group').map(x=>[groupKey(x),x]));}
function rawText(node){return node.begin+node.items.map(item=>item.kind==='line'?item.line:rawText(item)).join('')+node.end;}

/** Keep comments, spelling, repeated records, opaque lines and nested property groups. */
function mergeContainer(original,before,after,parse,renderChild){
  const oldValues=values(before,parse),newValues=values(after,parse),oldGroups=groups(before),newGroups=groups(after);
  const emitted=new Set(),emittedGroups=new Set(),originalKeys=new Set();let out='';
  const children=after.items.filter(item=>item.kind==='node');let childIndex=0;
  for(const item of original.items){
    if(item.kind==='node'){if(childIndex<children.length)out+=renderChild(children[childIndex++]);continue;}
    if(item.kind==='group'){
      const key=groupKey(item),next=newGroups.get(key);emittedGroups.add(key);
      if(next)out+=item.begin+mergeContainer(item,oldGroups.get(key)||item,next,parse,renderChild)+item.end;
      else if(!oldGroups.has(key))out+=rawText(item);
      continue;
    }
    if(!item.key){out+=item.line;continue;}
    const key=item.key.toLowerCase();originalKeys.add(key);
    if(!oldValues.has(key)&&!newValues.has(key)){out+=item.line;continue;}
    if(!newValues.has(key))continue;
    emitted.add(key);
    if(same(oldValues.get(key),newValues.get(key)))out+=item.line;
    else{const target=after.items.filter(x=>x.kind==='line'&&x.key?.toLowerCase()===key).at(-1);out+=replaceLineValue(item.line,target.value.slice(0,commentAt(target.value)<0?undefined:commentAt(target.value)).trim());}
  }
  for(const item of after.items){
    if(item.kind==='line'&&item.key&&!emitted.has(item.key.toLowerCase())&&!originalKeys.has(item.key.toLowerCase())){out+=item.line;emitted.add(item.key.toLowerCase());}
    if(item.kind==='group'&&!emittedGroups.has(groupKey(item))){out+=rawText(item);emittedGroups.add(groupKey(item));}
  }
  while(childIndex<children.length)out+=renderChild(children[childIndex++]);
  return out;
}

export function rememberNativeSource(module,document,canonical){
  module.nativeSource={...document,path:module.sourcePath,canonical,resourceReferences:modelNodes(module).flatMap(node=>Object.entries(node.properties||{}).filter(([,value])=>value?.resource).map(([key,value])=>({id:node.id,key,value:structuredClone(value)}))),classHeader:module.nativeClassHeader||null,name:module.name,code:module.code,attributes:structuredClone(module.attributes||[]),identities:modelNodes(module).map(n=>({id:n.id,key:nodeKey(n)}))};
  return module;
}

/** Hidden member attributes follow their original accessor, not every same-named procedure. */
function mergeCode(module,source,original,{strict=true}={}){
  const classChanged=module.nativeClassHeader!==(source.classHeader??module.nativeClassHeader);
  if(module.code===source.code&&!classChanged&&same(module.attributes||[],source.attributes)){
    if(module.name===source.name)return original;
    let found=false;const renamed=linesOf(original).map(line=>{
      if(/^\s*Attribute\s+VB_Name\s*=/i.test(line)){found=true;return replaceLineValue(line,quote(module.name));}
      return line;
    }).join('');if(found)return renamed;
  }
  const eol=preferredEOL(original||source.text||''),attributes=module.attributes||[],used=new Set(),header=[],members=new Map();
  const attrKey=nativeAttributeKey;
  const terminate=line=>lineEnding(line)?line:line+eol;
  const oldStatements=nativeCodeStatements(original),newStatements=nativeCodeStatements(module.code);
  const oldAnchors=oldStatements.flatMap(s=>s.anchors),newAnchors=newStatements.flatMap(s=>s.anchors);
  let owners=[];
  for(const statement of oldStatements){
    if(statement.anchors.length)owners=statement.anchors;
    const line=statement.raw,key=attrKey(line);if(!key)continue;
    if(key==='vb_name'){header.push(terminate(replaceLineValue(line,quote(module.name))));continue;}
    let index=attributes.findIndex((a,i)=>!used.has(i)&&a.trim()===line.trim());
    if(index<0)index=attributes.findIndex((a,i)=>!used.has(i)&&attrKey(a)===key);
    if(index<0)continue;used.add(index);
    const replacement=attributes[index].trim()===line.trim()?line:replaceLineValue(line,attributes[index].slice(attributes[index].indexOf('=')+1).trim());
    if(!key.includes('.')){header.push(terminate(replacement));continue;}
    const name=key.split('.')[0],target=owners.find(a=>a.name===name)||oldAnchors.find(a=>a.name===name);
    if(!target)fail('member attribute without an identifiable declaration: '+key);
    const list=members.get(target.key)||[];list.push(terminate(replacement));members.set(target.key,list);
  }
  if(!header.some(line=>attrKey(line)==='vb_name'))header.unshift('Attribute VB_Name = '+quote(module.name)+eol);
  for(let i=0;i<attributes.length;i++){
    if(used.has(i))continue;const key=attrKey(attributes[i]);if(key==='vb_name')continue;
    if(!key||/[\r\n\0]/.test(attributes[i]))fail('invalid hidden attribute');
    if(!key.includes('.')){header.push(attributes[i]+eol);continue;}
    const name=key.split('.')[0],candidates=newAnchors.filter(a=>a.name===name);
    // A VB property has several accessors but only one COM member. Prefer the
    // original owning accessor, then Get, rather than duplicating attributes.
    if(strict&&!source.text&&new Set(candidates.map(a=>a.base)).size<candidates.length)fail('ambiguous hidden attribute owner: '+attributes[i]);
    const target=candidates.find(a=>members.has(a.key))||candidates.find(a=>a.key.startsWith('property get '))||candidates[0];
    if(!target){if(strict)fail('cannot place new or renamed member attribute: '+attributes[i]);continue;}
    const list=members.get(target.key)||[];list.push(attributes[i]+eol);members.set(target.key,list);
  }
  const originalClassHeader=original.match(/^(?:VERSION[^\r\n]*[\r\n]+)?BEGIN[\s\S]*?^END[^\r\n]*(?:\r\n|\r|\n)/im)?.[0]||'';
  const classHeader=classChanged?(module.nativeClassHeader||'').replace(/\r\n|\r|\n/g,eol).replace(/[\r\n]*$/,eol):originalClassHeader;
  let output=classHeader+header.join('');const written=new Set();
  for(const statement of newStatements){
    if(/^\s*Attribute\s+/i.test(statement.text))fail('edit hidden attributes through module metadata, not visible code');
    output+=statement.raw.replace(/\r\n|\r|\n/g,eol);
    for(const {key} of statement.anchors)if(members.has(key)&&!written.has(key)){
      if(!/[\r\n]$/.test(output))output+=eol;
      output+=members.get(key).join('');written.add(key);
    }
  }
  for(const key of members.keys())if(!written.has(key))fail('procedure '+key+' owns hidden attributes; remove or retarget its attributes before deleting/renaming it');
  return output;
}

/** Generate code for a fresh module; attributes are attached once, after logical declarations. */
export function serializeNativeCode(module,defaults=[],strict=false){
  const value={...module,attributes:module.attributes||defaults,code:module.code.replace(/\r\n|\r|\n/g,'\n').trim()+'\n'};
  return mergeCode(value,{code:null,name:module.name,attributes:[],classHeader:module.nativeClassHeader},'',{strict}).replace(/[\r\n]+$/,'');
}

export function patchNativeSource(module,generated,parse){
  const source=module.nativeSource;if(!source)return generated;
  if(module.nativeOpaque){
    if(module.code!==source.code||module.name!==source.name||!same(module.attributes||[],source.attributes))fail('this binary/custom designer is preserved, but cannot be edited safely');
    return source.text;
  }
  const original=nativeTree(source.text),before=nativeTree(source.canonical),after=nativeTree(generated);
  if(!original.root)return mergeCode(module,source,source.text);
  if(!before.root||!after.root)fail('designer root removed');
  const oldMap=mapNodes(original,source.identities),beforeMap=mapNodes(before,source.identities),newMap=mapNodes(after,modelNodes(module).map(n=>({id:n.id,key:nodeKey(n)})));
  const render=node=>{
    const raw=oldMap.get(node.id),old=beforeMap.get(node.id);if(!raw||!old)return rawText(node);
    const begin=raw.type===node.type&&raw.name===node.name?raw.begin:raw.begin.replace(/(Begin\s+)\S+\s+\w+/i,'$1'+node.type+' '+node.name);
    return begin+mergeContainer(raw,old,node,parse,render)+raw.end;
  };
  const prefix=before.prefix===after.prefix?original.prefix:after.prefix;
  return prefix+render(newMap.get(after.root.id))+mergeCode(module,source,original.tail);
}
