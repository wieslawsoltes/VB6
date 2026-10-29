import {parseXaml,applyTextEdits,escapeXml,XMLNS_NS,XAML_NS,PRESENTATION_NS,MACOS26_NS} from '../../packages/xaml-compiler/src/index.js';
import {macos26ColorFallback} from '../theme/macos26-resources.js';
import {patchMacOS26CollectionSource} from './macos26-source-edits.js';
const VB='urn:vb6:forms';
const attrKey=a=>a.namespaceURI+'#'+a.localName;
const attrs=e=>new Map(e.attributes.filter(a=>a.namespaceURI!==XMLNS_NS).map(a=>[attrKey(a),a]));
const ids=syntax=>new Map(syntax.elements.map(e=>[e.attributes.find(a=>a.namespaceURI===VB&&a.localName==='Designer.Id')?.value,e]));
const nodes=form=>[form,...form.controls??[],...form.menus??[]];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** A small source-edit planner shared by native and WinUI synchronization.
 * Offsets always refer to the original text. Insertions are coalesced, and the
 * caller recompiles the final text before publishing any edit. */
function planner(text) {
  const edits=[],insertions=new Map(),declarations=new Map();
  const insert=(offset,value)=>insertions.set(offset,(insertions.get(offset)??'')+value);
  function prefix(element,uri,preferred) {
    const found=Object.entries(element.namespaces).find(([key,value])=>key&&value===uri)?.[0];
    if(found)return found;
    let declared=declarations.get(element);if(!declared)declarations.set(element,declared=new Map());
    if(declared.has(uri))return declared.get(uri);
    let name=preferred;
    while(element.namespaces[name]||[...declared.values()].includes(name))name+='_';
    declared.set(uri,name);insert(element.nameEnd,` xmlns:${name}="${escapeXml(uri)}"`);return name;
  }
  function setAttribute(element,uri,name,value) {
    const attr=element.attributes.find(a=>a.namespaceURI===uri&&a.localName===name);
    if(attr){
      const escaped=escapeXml(String(value));
      edits.push({start:attr.valueStart,end:attr.valueEnd,text:attr.quote==="'"?escaped.replaceAll("'",'&apos;'):escaped});return;
    }
    const qualified=uri?prefix(element,uri,uri===XAML_NS?'x':uri===VB?'vb':'ui')+':'+name:name;
    insert(element.nameEnd,` ${qualified}="${escapeXml(String(value))}"`);
  }
  function setPropertyElement(element,value) {
    if(element.selfClosing){edits.push({start:element.openEnd-2,end:element.openEnd,text:'>'+escapeXml(value)+'</'+element.name+'>'});return true;}
    // Preserve comments and the property-element spelling. Rich/typed object
    // content is deliberately left to the safe canonical fallback.
    if(element.children.some(c=>!['Text','Comment'].includes(c.kind)))return false;
    const content=element.children.filter(c=>c.kind==='Text');
    if(!content.length)insert(element.closeStart,escapeXml(value));
    else for(let i=0;i<content.length;i++)edits.push({start:content[i].start,end:content[i].end,text:i?'':escapeXml(value)});
    return true;
  }
  function replaceProperty(element,uri,name,value) {
    const attribute=element.attributes.find(a=>(a.namespaceURI===uri||uri===element.namespaceURI&&!a.namespaceURI&&name.includes('.'))&&a.localName===name);
    const member=name.includes('.')?name.split('.').at(-1):name;
    const properties=element.children.filter(c=>c.kind==='Element'&&c.namespaceURI===(uri||element.namespaceURI)&&c.localName.endsWith('.'+member));
    if(attribute){if(value===undefined)edits.push({start:attribute.start,end:attribute.end,text:''});else setAttribute(element,attribute.namespaceURI,name,value);return true;}
    if(properties.length>1)return false;
    if(properties.length){
      if(value===undefined){const e=properties[0];edits.push({start:e.start,end:e.end,text:e.children.filter(c=>c.kind==='Comment').map(c=>text.slice(c.start,c.end)).join('')});return true;}
      return setPropertyElement(properties[0],value);
    }
    if(value!==undefined)setAttribute(element,uri,name,value);
    return true;
  }
  return {edits,insert,prefix,setAttribute,replaceProperty,finish:()=>applyTextEdits(text,[...edits,...[...insertions].map(([start,value])=>({start,end:start,text:value}))])};
}

/** Native additions/deletions/order and scalar/JSON/property-element edits.
 * Reparenting and type changes fall back instead of losing authored subtrees. */
export function patchNativeSource(text,before,after,compilation,oldCanonical,newCanonical,parentIds) {
  const syntax=compilation.syntax,oldSyntax=parseXaml(oldCanonical),nextSyntax=parseXaml(newCanonical),oldById=ids(oldSyntax),nextById=ids(nextSyntax);
  const sourceByStart=new Map(syntax.elements.map(e=>[e.start,e]));
  const sourceById=new Map(compilation.sourceMap.map(m=>[m.id,sourceByStart.get(m.start)]));
  const oldNodes=new Map(nodes(before).map(n=>[n.id,n])),newNodes=new Map(nodes(after).map(n=>[n.id,n]));
  const parents=form=>new Map([[form.id,null],...['controls','menus'].flatMap(key=>[...parentIds(form[key]??[])].map(([id,parent])=>[id,parent??form.id]))]);
  const oldParents=parents(before),newParents=parents(after),newMenus=new Set((after.menus??[]).map(n=>n.id)),oldMenus=new Set((before.menus??[]).map(n=>n.id));
  if(before.id!==after.id)return null;
  for(const [id,node] of newNodes)if(oldNodes.has(id)) {
    if(oldNodes.get(id).type!==node.type||oldParents.get(id)!==newParents.get(id)||oldMenus.has(id)!==newMenus.has(id)||sourceById.get(id)?.namespaceURI!==VB)return null;
  }
  const plan=planner(text),newline=text.includes('\r\n')?'\r\n':'\n';
  const indent=e=>text.slice(text.lastIndexOf('\n',e.start-1)+1,e.start).match(/^\s*/)?.[0]??'';
  for(const [id,node] of newNodes) {
    if(!oldNodes.has(id))continue;
    const element=sourceById.get(id),old=attrs(oldById.get(id)),next=attrs(nextById.get(id));
    if(!element)return null;
    for(const name of new Set([...old.keys(),...next.keys()])) {
      const a=old.get(name),b=next.get(name);if(a?.value===b?.value)continue;
      const attr=b??a;
      if(!plan.replaceProperty(element,attr.namespaceURI,attr.localName,b?.value))return null;
    }
  }
  for(const [id] of oldNodes)if(!newNodes.has(id)&&newNodes.has(oldParents.get(id))) {
    const element=sourceById.get(id);if(!element)return null;
    plan.edits.push({start:element.start,end:element.end,text:''});
  }
  // Serialize only newly added subtrees. Existing siblings and comments retain
  // their original bytes; Designer.Order preserves the model's flat z-order.
  const append=new Map();
  for(const [id] of newNodes)if(!oldNodes.has(id)&&oldNodes.has(newParents.get(id))) {
    const element=nextById.get(id),parent=sourceById.get(newParents.get(id));if(!element||!parent)return null;
    const menu=newMenus.has(id)&&newParents.get(id)===after.id;
    const host=parent.children.find(c=>c.kind==='Element'&&c.namespaceURI===VB&&c.localName.endsWith(menu?'.Menus':'.Children'))??parent;
    const oldIndent=newCanonical.slice(newCanonical.lastIndexOf('\n',element.start-1)+1,element.start).length;
    let fragment=newCanonical.slice(element.start,element.end).split(/\r?\n/).map((line,i)=>i?line.slice(oldIndent):line).join(newline);
    // A fragment must not depend on the spelling or shadowing of an ancestor's
    // prefix. Canonical descendants inherit this local declaration.
    if(host.namespaces.vb!==VB)fragment=fragment.replace(/^<vb:\w+/,match=>match+' xmlns:vb="'+VB+'"');
    let group=append.get(host);if(!group)append.set(host,group={children:[],menus:[]});
    group[menu&&host===parent?'menus':'children'].push(fragment);
  }
  for(const [host,group] of append) {
    const pad=indent(host),childPad=pad+'  ';
    const block=items=>items.map(item=>item.split(newline).map(line=>childPad+line).join(newline)).join(newline);
    const parts=[];
    if(group.menus.length){
      const menus=childPad+'<'+host.name+'.Menus>'+newline+block(group.menus).split(newline).map(line=>'  '+line).join(newline)+newline+childPad+'</'+host.name+'.Menus>';
      if(host.selfClosing)parts.push(menus);else plan.insert(host.openEnd,newline+menus+newline);
    }
    if(group.children.length)parts.push(block(group.children));
    if(!parts.length)continue;
    const value=newline+parts.join(newline)+newline+pad;
    if(host.selfClosing)plan.edits.push({start:host.openEnd-2,end:host.openEnd,text:'>'+value+'</'+host.name+'>'});
    else plan.insert(host.closeStart,value);
  }
  return plan.finish();
}

const reverseValue=(value,encoding)=>{
  if(encoding==='dip')return typeof value==='number'?value/15:undefined;
  if(encoding==='font')return typeof value==='number'?value/0.75:undefined;
  if(encoding==='flag')return value===0?'False':value===-1?'True':undefined;
  if(encoding==='checked')return value===2?'{x:Null}':value===0?'False':value===1?'True':undefined;
  if(encoding==='radio-checked')return value===0?'False':value===-1?'True':undefined;
  if(encoding==='visibility')return value===0?'Collapsed':value===-1?'Visible':undefined;
  if(encoding==='bold')return value===0?'Normal':value===-1?'Bold':undefined;
  if(encoding==='italic')return value===0?'Normal':value===-1?'Italic':undefined;
  if(encoding==='alignment')return ['Left','Right','Center'][value];
  if(encoding==='orientation')return value===1?'Horizontal':value===2?'Vertical':undefined;
  if(encoding==='range-orientation')return value===0?'Horizontal':value===1?'Vertical':undefined;
  if(encoding==='stepper-orientation')return value===1?'Horizontal':value===0?'Vertical':undefined;
  if(encoding==='image-stretch')return value===-1?'Fill':value===0?'None':undefined;
  if(encoding==='color')return Number.isInteger(value)&&value>=0&&value<=0xffffff?'#'+[value&255,(value>>>8)&255,(value>>>16)&255].map(n=>n.toString(16).padStart(2,'0')).join(''):undefined;
  return typeof value==='string'||typeof value==='number'||typeof value==='boolean'?value:undefined;
};
/** Preserve presentation and macOS resources/styles. A style-derived edit becomes a LOCAL
 * property, never a mutation of a shared Setter. Native-only designer fields
 * remain explicit vb:Designer.Properties overrides rather than being dropped. */
export function patchWinUISource(text,before,after,compiled) {
  const oldNodes=nodes(before),newNodes=nodes(after);
  if(oldNodes.length!==newNodes.length)return null;
  const mappings=new Map(compiled.sourceMap.map(m=>[m.id,m])),byStart=new Map(compiled.syntax.elements.map(e=>[e.start,e])),irByStart=new Map(compiled.compilation.nodes.map(n=>[n.source.start,n])),plan=planner(text);
  const state=n=>Object.fromEntries(Object.entries(n).filter(([key])=>!['name','properties','controls','menus'].includes(key)));
  for(let i=0;i<oldNodes.length;i++) {
    const a=oldNodes[i],b=newNodes[i],mapping=mappings.get(a.id);
    if(!mapping||mapping.native||a.id!==b.id||!same(state(a),state(b)))return null;
    const element=byStart.get(mapping.start),overridesAttr=element.attributes.find(a=>a.namespaceURI===VB&&a.localName==='Designer.Properties');
    let overrides=overridesAttr?JSON.parse(overridesAttr.value.startsWith('{}')?overridesAttr.value.slice(2):overridesAttr.value):{};
    let overridesChanged=false;
    if(a.name!==b.name) {
      plan.setAttribute(element,XAML_NS,'Name',b.name);
      plan.setAttribute(element,VB,'Designer.Id',b.id);
      const klass=element.attributes.find(a=>a.namespaceURI===XAML_NS&&a.localName==='Class');
      if(klass)plan.setAttribute(element,XAML_NS,'Class',b.name);
      // Event-handler references are code identities, not arbitrary strings.
      for(const attr of element.attributes)if((!attr.namespaceURI||attr.namespaceURI===element.namespaceURI)&&new RegExp('^'+a.name+'_','i').test(attr.value)&&['Action','Click','TextChanged','PasswordChanged','DateChanged','SelectionChanged','ValueChanged','ColumnClick','GotFocus','LostFocus','KeyDown','KeyUp'].includes(attr.localName))plan.setAttribute(element,attr.namespaceURI,attr.localName,b.name+attr.value.slice(a.name.length));
    }
    const properties=new Set([...Object.keys(a.properties),...Object.keys(b.properties)]),used=new Set(),handled=patchMacOS26CollectionSource({before:a,after:b,mapping,irByStart,byStart,plan,overrides});
    if(handled===null)return null;
    const replaceMapped=(source,value,theme=false)=>{
      const original=!source.fromStyle&&element.attributes.find(attr=>attr.start===source.start&&attr.end===source.end);
      const uri=original?original.namespaceURI:source.attached?source.namespaceURI??(source.name.startsWith('Designer.')?VB:PRESENTATION_NS):'';
      let literal;
      if(theme) {
        const namespace=element.namespaces[''],prefix=[PRESENTATION_NS,MACOS26_NS].includes(namespace)?'':plan.prefix(element,PRESENTATION_NS,'ui')+':';
        literal='{'+prefix+'ThemeResource macOS.'+value+'}';
      } else {
        const isNull=source.encoding==='checked'&&value==='{x:Null}',isString=typeof value==='string'&&value.startsWith('{')&&!isNull;
        literal=isString?'{}'+value:String(value);
        if(isNull)literal='{'+plan.prefix(element,XAML_NS,'x')+':Null}';
      }
      return plan.replaceProperty(element,uri,source.name,literal);
    };
    for(const [color,role] of [['BackColor','MacOSBackgroundRole'],['ForeColor','MacOSForegroundRole']]) {
      if(same(a.properties[color],b.properties[color])&&same(a.properties[role],b.properties[role]))continue;
      if(!Object.hasOwn(a.properties,role)&&!Object.hasOwn(b.properties,role))continue;
      if(b.properties[color]===undefined)return null;
      const source=mapping.properties[role],nextRole=b.properties[role];
      if(nextRole&&source&&!Object.hasOwn(overrides,role)&&!Object.hasOwn(overrides,color)) {
        if(!replaceMapped(source,nextRole,source.encoding==='theme-resource'))return null;
        used.add(source.name);
        // Choosing a semantic role in the Inspector does not rewrite an
        // authored OLE fallback. Keep that exact fallback while making the
        // changed role visible in the original consuming XAML expression.
        if(b.properties[color]!==macos26ColorFallback(nextRole)) {
          overrides[color]=b.properties[color];overrides[role]=nextRole;overridesChanged=true;
        }
      } else {
        // An explicit native paint relinquishes a semantic binding. Keeping the
        // override in Designer.Properties preserves its exact OLE system color,
        // while the compiler removes the old role before applying that override.
        overrides[color]=b.properties[color];
        if(Object.hasOwn(b.properties,role))overrides[role]=nextRole;else delete overrides[role];
        overridesChanged=true;
      }
      handled.add(color);handled.add(role);
    }
    for(const key of properties) {
      if(handled.has(key))continue;
      const x=a.properties[key],y=b.properties[key];if(same(x,y))continue;
      if(y===undefined)return null;
      if(key==='Name'&&y===b.name)continue;
      const source=mapping.properties[key],value=source&&reverseValue(y,source.encoding);
      // Thickness and other one-to-many mappings need a single coherent tuple;
      // persist their native axes explicitly rather than writing the same source
      // property repeatedly or changing its unaffected axes.
      const multiple=source&&Object.values(mapping.properties).filter(p=>p.start===source.start&&p.end===source.end).length>1;
      if(source&&value!==undefined&&!multiple&&!used.has(source.name)&&!Object.hasOwn(overrides,key)) {
        if(!replaceMapped(source,value))return null;
        used.add(source.name);
      } else {overrides[key]=y;overridesChanged=true;}
    }
    // Direct model clients may intentionally keep an explicit presentation
    // record while editing its native fallback. A rewritten XAML scalar also
    // recomputes that record, so retain the exact caller-owned record as an
    // explicit override instead of regenerating the entire authored document.
    if(b.properties.WinUI3&&same(a.properties.WinUI3,b.properties.WinUI3)&&['BackColor','ForeColor','FontBold','FontName','FontSize','LayoutPaddingLeft','LayoutPaddingTop','LayoutPaddingRight','LayoutPaddingBottom'].some(key=>!same(a.properties[key],b.properties[key]))) {
      overrides.WinUI3=b.properties.WinUI3;overridesChanged=true;
    }
    if(overridesChanged)plan.setAttribute(element,VB,'Designer.Properties','{}'+JSON.stringify(overrides));
  }
  return plan.finish();
}
