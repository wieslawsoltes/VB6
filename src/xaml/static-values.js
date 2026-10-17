import {convertValue,PRESENTATION_NS,MACOS26_NS} from '../../packages/xaml-compiler/src/index.js';

export const objectProperties = node => Object.fromEntries((node?.properties ?? []).filter(p=>!p.member.attached).map(p=>[p.member.name,p]));
const literal = value => ({kind:'Literal',value});
const propertyKey = member => member.aliasFor ?? (member.attached ? member.namespaceURI+'#'+member.owner+'.'+member.name : member.name);

/** Compile-time resources and styles. This is deliberately not a dependency-
 * property runtime: external I/O and unsupported dynamic setters fail closed.
 * A host can provide a narrowly typed semantic-color resource resolver; the
 * color token then survives style/brush resolution without freezing appearance.
 * Resource closures belong to their declaration, never to the consuming control.
 */
export function createStaticValues(compilation,{themeColor}={}) {
  const schema=compilation.schema;
  const semanticTokens=new WeakSet();
  const syntax=new Map(compilation.syntax.elements.map(node=>[node.start,node]));
  const namespaces=node=>syntax.get(node.source?.start)?.namespaces ?? {'':PRESENTATION_NS};
  const fail=message=>{throw new TypeError(message);};
  const typeName=(value,node)=>{
    if(typeof value!=='string')return fail('Style TargetType must be a literal type name.');
    const parts=value.trim().split(':');
    if(parts.length>2)return fail('Invalid Style TargetType '+value+'.');
    const ns=namespaces(node),uri=parts.length===2?ns[parts[0]]:ns[''];
    const type=schema.getType(uri,parts.at(-1));
    if(!type)return fail('Unknown Style TargetType '+value+'.');
    return type;
  };
  const typeKey=type=>'@type:{'+type.namespaceURI+'}'+type.name;
  function dictionary(value,outer,depth=0) {
    if(depth>64)return fail('Merged resource dictionary nesting exceeds 64.');
    const scope={own:new Map(),merged:[],outer};
    if(!value)return scope;
    let entries;
    if(value.kind==='Dictionary')entries=value.entries;
    else if(value.kind==='Object'&&value.dictionary) {
      const p=objectProperties(value);
      if(p.Source)return fail('External resource dictionaries require an explicit loader; no external data was read.');
      if(p.ThemeDictionaries)return fail('Theme resource dictionaries require a runtime and are not static VB6 values.');
      if(value.properties.some(p=>!['Items','MergedDictionaries'].includes(p.member.name)))return fail('Unsupported resource dictionary property.');
      const merged=p.MergedDictionaries?.value;
      if(merged&&merged.kind!=='Collection')return fail('MergedDictionaries must be a dictionary collection.');
      // The outer scope object is created first so entries can reference siblings.
      // Reverse lookup (below) implements last-merged-dictionary precedence.
      for(const child of merged?.items??[])scope.merged.push(dictionary(child,[scope,...outer],depth+1));
      if(p.Items?.value?.kind!=='Dictionary'&&p.Items)return fail('ResourceDictionary.Items must be keyed entries.');
      entries=p.Items?.value?.entries??[];
    } else return fail('Resources must be a resource dictionary.');
    for(const entry of entries) {
      let key=entry.key;
      if(entry.value.kind==='Object'&&entry.value.type.namespaceURI===PRESENTATION_NS&&entry.value.type.name==='Style'&&entry.value.directives.Key===undefined) {
        key=typeKey(typeName(objectProperties(entry.value).TargetType?.value?.value,entry.value));
      }
      if(scope.own.has(key))return fail('Duplicate resource key '+key+'.');
      scope.own.set(key,{value:entry.value,scopes:[scope,...outer]});
    }
    return scope;
  }
  function inDictionary(scope,key,seen=new Set()) {
    if(seen.has(scope))return undefined;
    seen.add(scope);
    const own=scope.own.get(key);if(own)return own;
    for(let i=scope.merged.length-1;i>=0;i--){const entry=inDictionary(scope.merged[i],key,seen);if(entry)return entry;}
  }
  function lookup(key,scopes) {
    for(const scope of scopes){const entry=inDictionary(scope,key);if(entry)return entry;}
  }
  function resolve(value,scopes,active=new Set()) {
    if(value?.kind!=='Resource')return {value,scopes};
    if(value.theme)return fail('ThemeResource requires a live theme resource runtime.');
    const entry=lookup(value.key,scopes);
    if(!entry)return fail('Unknown static resource '+value.key+'.');
    if(active.has(entry))return fail('Cyclic static resources: '+value.key+'.');
    if(active.size>=64)return fail('Static resource dependency depth exceeds 64.');
    active.add(entry);
    try{return resolve(entry.value,entry.scopes,active);}finally{active.delete(entry);}
  }
  function constant(value,scopes,active=new Set()) {
    if(value?.kind==='Resource') {
      const semantic=value.theme?themeColor?.(value.key):undefined;
      if(value.theme&&!semantic)return fail('ThemeResource '+value.key+' requires a supported live theme resource runtime.');
      if(semantic)semanticTokens.add(semantic);
      const entry=lookup(value.key,scopes);
      // A local or merged declaration wins over the built-in semantic color.
      // Its dependency closure is evaluated at its declaration, just as for
      // StaticResource. A binding/template shadow still fails closed below.
      if(!entry)return semantic ?? fail('Unknown static resource '+value.key+'.');
      if(active.has(entry))return fail('Cyclic static resources: '+value.key+'.');
      if(active.size>=64)return fail('Static resource dependency depth exceeds 64.');
      active.add(entry);
      try{return constant(entry.value,entry.scopes,active);}finally{active.delete(entry);}
    }
    if(value?.kind==='Literal')return semanticTokens.has(value.value)?value.value:structuredClone(value.value);
    if(value?.kind==='Object'&&value.type.namespaceURI===PRESENTATION_NS&&value.type.name==='SolidColorBrush') {
      const p=objectProperties(value);
      if(value.properties.some(p=>!['Color','Opacity'].includes(p.member.name))||p.Opacity&&constant(p.Opacity.value,scopes,active)!==1)return fail('Brush opacity and transforms cannot be discarded by the VB6 target.');
      return constant(p.Color?.value??literal('#000000'),scopes,active);
    }
    return fail('This VB6 target does not implement '+(value?.kind??'empty')+' values. No fallback value was substituted.');
  }
  function convert(value,member,scopes) {
    const raw=constant(value,scopes);
    if(semanticTokens.has(raw)) {
      if(!['Brush','Color'].includes(member.type))return fail('macOS semantic ThemeResource colors require a brush/color property.');
      return raw;
    }
    // Typed primitive resource objects already contain arrays/GridLengths. Do not
    // stringify them through a second type converter.
    if(Array.isArray(raw)&&['Thickness','CornerRadius','Point','DoubleCollection'].includes(member.type))return raw;
    if(raw&&typeof raw==='object'&&member.type==='GridLength'&&['auto','pixel','star'].includes(raw.unit))return raw;
    if(member.type==='Json')return raw;
    return convertValue(raw,member);
  }
  function styleProperties(styleValue,scopes,target,active=new Set()) {
    const resolved=resolve(styleValue,scopes);const style=resolved.value;scopes=resolved.scopes;
    if(style?.kind!=='Object'||style.type.namespaceURI!==PRESENTATION_NS||style.type.name!=='Style')return fail('Style must resolve to a Style object.');
    if(active.has(style))return fail('Cyclic Style.BasedOn chain.');
    if(active.size>=64)return fail('Style.BasedOn depth exceeds 64.');
    active.add(style);
    try {
      const props=objectProperties(style),styleType=typeName(props.TargetType?.value?.value,style);
      if(!schema.isAssignable(target,styleType))return fail('Style TargetType '+styleType.name+' is not assignable to '+target.name+'.');
      if(style.properties.some(p=>!['TargetType','BasedOn','Setters'].includes(p.member.name)))return fail('Unsupported Style property.');
      const result=new Map();
      if(props.BasedOn)for(const p of styleProperties(props.BasedOn.value,scopes,styleType,active))result.set(propertyKey(p.member),p);
      const setters=props.Setters?.value;
      if(setters&&setters.kind!=='Collection')return fail('Style.Setters must be a collection.');
      const own=new Set();
      for(const setter of setters?.items??[]) {
        if(setter.kind!=='Object'||setter.type.namespaceURI!==PRESENTATION_NS||setter.type.name!=='Setter')return fail('A Style can contain only Setters.');
        const p=objectProperties(setter);
        if(p.Target)return fail('Setter.Target requires visual-state runtime support.');
        const name=p.Property?.value?.value;
        if(typeof name!=='string'||!p.Value)return fail('A Setter requires Property and Value.');
        const member=schema.member(styleType,name,namespaces(setter));
        const safeAttached=member?.namespaceURI===PRESENTATION_NS||member?.namespaceURI===MACOS26_NS&&['Appearance','Accessibility'].includes(member.owner);
        if(!member||member.kind==='event'||member.collection||member.dictionary||member.attached&&!safeAttached||['Name','Style','Resources','Children','Child'].includes(member.name))return fail('Unsupported style setter '+name+'.');
        const key=propertyKey(member);
        if(own.has(key))return fail('Duplicate style setter '+name+'.');
        own.add(key);
        // Conversion at use time preserves lexical resource scope and enforces
        // target member types even though Setter.Value itself has type Object.
        result.set(key,{member,value:literal(convert(p.Value.value,member,scopes)),source:p.Value.source,fromStyle:true,styleSource:style.source});
      }
      return [...result.values()];
    } finally {active.delete(style);}
  }
  function properties(node,scopes) {
    const type=schema.getType(node.type.namespaceURI,node.type.name),props=objectProperties(node),explicit=props.Style;
    const implicit=!explicit&&lookup(typeKey(type),scopes);
    // x:Null explicitly suppresses an implicit style.
    const selected=explicit?.value??implicit?.value;
    const styled=selected&&!(selected.kind==='Literal'&&selected.value===null)?styleProperties(selected,explicit?scopes:implicit.scopes,type):[];
    const result=new Map(styled.map(p=>[propertyKey(p.member),p]));
    for(const p of node.properties)if(p.member.name!=='Style'||p.member.attached)result.set(propertyKey(p.member),p);
    return [...result.values()];
  }
  return {dictionary,lookup,resolve,constant,convert,properties};
}
