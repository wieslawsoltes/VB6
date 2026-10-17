import {convertValue,PRESENTATION_NS,WINUI_CONTROLS_NS,MACOS26_NS} from '../../packages/xaml-compiler/src/index.js';

export const objectProperties = node => Object.fromEntries((node?.properties ?? []).filter(p=>!p.member.attached).map(p=>[p.member.name,p]));
const literal = value => ({kind:'Literal',value});
const propertyKey = member => member.aliasFor ?? (member.attached ? member.namespaceURI+'#'+member.owner+'.'+member.name : member.name);

/** Compile-time resources and styles. This is deliberately not a dependency-
 * property runtime: external I/O and unsupported dynamic setters fail closed.
 * A host can provide a narrowly typed semantic-color resource resolver; the
 * color token then survives style/brush resolution without freezing appearance.
 * Resource closures belong to their declaration, never to the consuming control.
 */
export function createStaticValues(compilation,{themeColor,themeResource,builtinResource,builtinDictionary,defaultStyle,brushColor,linearBrush,initialTheme='Light'}={}) {
  const schema=compilation.schema;
  const semanticTokens=new WeakSet();
  const syntax=new Map(compilation.syntax.elements.map(node=>[node.start,node]));
  const namespaces=node=>node.builtinStyle||node.builtinPresentation?{'':PRESENTATION_NS}:syntax.get(node.source?.start)?.namespaces ?? {'':PRESENTATION_NS};
  const fail=message=>{throw new TypeError(message);};
  const typeName=(value,node)=>{
    if(typeof value!=='string')return fail('Style TargetType must be a literal type name.');
    const parts=value.trim().split(':');
    if(parts.length>2)return fail('Invalid Style TargetType '+value+'.');
    const ns=namespaces(node),uri=parts.length===2?ns[parts[0]]:ns[''];
    const type=schema.getType(uri,parts.at(-1));
    if(!type)return fail('Unknown Style TargetType '+value+'.');
    return type.namespaceURI===WINUI_CONTROLS_NS?schema.getType(PRESENTATION_NS,type.name):type;
  };
  const typeKey=type=>'@type:{'+(type.namespaceURI===WINUI_CONTROLS_NS?PRESENTATION_NS:type.namespaceURI)+'}'+type.name;
  function dictionary(value,outer,depth=0) {
    if(depth>64)return fail('Merged resource dictionary nesting exceeds 64.');
    const scope={own:new Map(),merged:[],themes:new Map(),outer,theme:outer[0]?.theme??initialTheme};
    if(!value)return scope;
    let entries;
    if(value.kind==='Dictionary')entries=value.entries;
    else if(value.kind==='Object'&&value.dictionary) {
      const p=objectProperties(value);
      scope.builtin=builtinDictionary?.(value)??false;
      if(p.Source&&!scope.builtin)return fail('External resource dictionaries require an explicit allowlisted loader; no external data was read.');
      if(value.properties.some(p=>!['Items','MergedDictionaries','ThemeDictionaries','Source'].includes(p.member.name)))return fail('Unsupported resource dictionary property.');
      if(p.ThemeDictionaries) {
        if(!themeResource)return fail('Theme resource dictionaries require a live theme resource runtime.');
        const themes=p.ThemeDictionaries.value;
        if(themes.kind!=='Dictionary')return fail('ThemeDictionaries must contain keyed ResourceDictionary objects.');
        for(const entry of themes.entries) {
          if(!['Default','Light','Dark','HighContrast'].includes(entry.key))return fail('Unsupported theme dictionary '+entry.key+'. Expected Default, Light, Dark or HighContrast.');
          if(scope.themes.has(entry.key))return fail('Duplicate theme dictionary '+entry.key+'.');
          if(entry.value.kind!=='Object'||!entry.value.dictionary)return fail('ThemeDictionaries entries must be ResourceDictionary objects.');
          scope.themes.set(entry.key,dictionary(entry.value,[scope,...outer],depth+1));
        }
      }
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
  function builtin(key,scopes,theme,policy) {
    const value=builtinResource?.(key,theme,policy);
    return value===undefined?undefined:{value,scopes,identity:'builtin:'+JSON.stringify(policy??null)+':'+theme+':'+key};
  }
  function inDictionary(scope,key,theme,seen=new Set()) {
    if(seen.has(scope))return undefined;
    seen.add(scope);
    const own=scope.own.get(key);if(own)return own;
    for(let i=scope.merged.length-1;i>=0;i--){const entry=inDictionary(scope.merged[i],key,theme,seen);if(entry)return entry;}
    // Native WinUI looks in current entries, reverse merged dictionaries, then
    // one selected theme dictionary. Default is a dictionary fallback, never a
    // per-key fallback for an existing but incomplete Light/Dark dictionary.
    const selected=scope.themes.get(theme)??scope.themes.get('Default');
    if(selected){const entry=inDictionary(selected,key,theme,seen);if(entry)return entry;}
    if(scope.builtin)return builtin(key,[scope,...scope.outer],theme,scope.builtin);
  }
  function lookup(key,scopes,theme=scopes[0]?.theme??initialTheme) {
    for(const scope of scopes){const entry=inDictionary(scope,key,theme);if(entry)return entry.identity?{...entry,scopes}:entry;}
    // Intrinsic WinUI dictionaries provide host defaults. Their expressions
    // retain the requesting lexical scope so application resource overrides
    // reach aliases and template brush dependencies, instead of being hidden
    // behind the synthetic catalog dictionary. Authored declarations above
    // retain their own declaration scopes, including static Style closures.
    return builtin(key,scopes,theme);
  }
  function resolve(value,scopes,active=new Set()) {
    if(value?.kind!=='Resource')return {value,scopes};
    if(value.theme)return fail('ThemeResource requires a live theme resource runtime.');
    const entry=lookup(value.key,scopes);
    if(!entry)return fail('Unknown static resource '+value.key+'.');
    const identity=entry.identity??entry;
    if(active.has(identity))return fail('Cyclic static resources: '+value.key+'.');
    if(active.size>=64)return fail('Static resource dependency depth exceeds 64.');
    active.add(identity);
    try{return resolve(entry.value,entry.scopes,active);}finally{active.delete(identity);}
  }
  function constant(value,scopes,active=new Set(),frozenTheme) {
    if(value?.kind==='Resource') {
      const semantic=value.theme?themeColor?.(value.key):undefined;
      if(value.theme&&!semantic&&!themeResource)return fail('ThemeResource '+value.key+' requires a supported live theme resource runtime.');
      if(semantic)semanticTokens.add(semantic);
      if(value.theme&&!semantic&&themeResource&&frozenTheme===undefined) {
        const variants=Object.create(null);
        for(const theme of ['Light','Dark','HighContrast'])variants[theme]=constant(value,scopes,active,theme);
        // RequestedTheme.Default selects the host's effective Light/Dark theme;
        // it is not a fourth appearance. The serialized default fallback follows
        // WinUI's dark convention while each real theme uses native selection.
        variants.Default=variants.Dark;
        const token=themeResource(value.key,variants);semanticTokens.add(token);return token;
      }
      const entry=lookup(value.key,scopes,frozenTheme??scopes[0]?.theme??initialTheme);
      // A local or merged declaration wins over the built-in semantic color.
      // Its dependency closure is evaluated at its declaration, just as for
      // StaticResource. A binding/template shadow still fails closed below.
      if(!entry)return semantic ?? fail('Unknown static resource '+value.key+'.');
      const identity=entry.identity??entry;
      if(active.has(identity))return fail('Cyclic static resources: '+value.key+'.');
      if(active.size>=64)return fail('Static resource dependency depth exceeds 64.');
      active.add(identity);
      try{return constant(entry.value,entry.scopes,active,frozenTheme);}finally{active.delete(identity);}
    }
    if(value?.kind==='Literal')return semanticTokens.has(value.value)?value.value:structuredClone(value.value);
    if(value?.kind==='Object'&&value.type.namespaceURI===PRESENTATION_NS&&value.type.name==='LinearGradientBrush'&&linearBrush) {
      const result=linearBrush(value,(item)=>constant(item,scopes,active,frozenTheme));
      if(result?.kind==='WinUI3ThemeResource')semanticTokens.add(result);return result;
    }
    if(value?.kind==='Object'&&value.type.namespaceURI===PRESENTATION_NS&&value.type.name==='SolidColorBrush') {
      const p=objectProperties(value);
      if(value.properties.some(p=>!['Color','Opacity'].includes(p.member.name)))return fail('Brush transforms cannot be discarded by the VB6 target.');
      const color=constant(p.Color?.value??literal('#000000'),scopes,active,frozenTheme),opacity=p.Opacity?constant(p.Opacity.value,scopes,active,frozenTheme):1;
      if(brushColor){const result=brushColor(color,opacity);if(result?.kind==='WinUI3ThemeResource')semanticTokens.add(result);return result;}
      if(opacity!==1)return fail('Brush opacity cannot be discarded by the VB6 target.');
      return color;
    }
    return fail('This VB6 target does not implement '+(value?.kind??'empty')+' values. No fallback value was substituted.');
  }
  function convert(value,member,scopes) {
    const raw=constant(value,scopes);
    if(semanticTokens.has(raw)) {
      if(raw.kind==='WinUI3ThemeResource') {
        const variants=Object.fromEntries(Object.entries(raw.values).map(([theme,value])=>[theme,convertLiteral(value,member)]));
        const token=themeResource(raw.key,variants);semanticTokens.add(token);return token;
      }
      if(!['Brush','Color'].includes(member.type))return fail('macOS semantic ThemeResource colors require a brush/color property.');
      return raw;
    }
    return convertLiteral(raw,member);
  }
  function convertLiteral(raw,member) {
    // Typed primitive resource objects already contain arrays/GridLengths. Do not
    // stringify them through a second type converter.
    if(Array.isArray(raw)&&['Thickness','CornerRadius','Point','DoubleCollection'].includes(member.type))return raw;
    if(raw&&typeof raw==='object'&&member.type==='GridLength'&&['auto','pixel','star'].includes(raw.unit))return raw;
    if(member.type==='Json')return raw;
    if(member.type==='Brush'&&raw?.kind==='LinearGradientBrush'&&linearBrush)return raw;
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
      const result=new Map(),base=props.BasedOn?styleProperties(props.BasedOn.value,scopes,styleType,active):[];
      for(const p of base)result.set(propertyKey(p.member),p);
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
        result.set(key,{member,value:literal(convert(p.Value.value,member,scopes)),source:p.Value.source,fromStyle:true,styleSource:style.source,builtinStyle:style.builtinStyle});
      }
      return Object.assign([...result.values()],{builtinStyle:style.builtinStyle??base.builtinStyle});
    } finally {active.delete(style);}
  }
  function properties(node,scopes) {
    const type=schema.getType(node.type.namespaceURI,node.type.name),props=objectProperties(node),explicit=props.Style;
    const implicit=!explicit&&lookup(typeKey(type),scopes);
    // A native theme style supplies lower-precedence defaults independently of
    // the authored Style. For example AccentButtonStyle has no BasedOn, but its
    // unset font, padding and focus metrics still inherit the Button theme style.
    // x:Null suppresses an authored implicit style, never the native theme style.
    const defaultValue=defaultStyle?.(node,scopes),defaults=defaultValue?styleProperties(defaultValue,scopes,type):[];
    const selected=explicit?.value??implicit?.value;
    const styled=selected&&!(selected.kind==='Literal'&&selected.value===null)?styleProperties(selected,explicit?scopes:implicit?.scopes??scopes,type):[];
    const result=new Map([...defaults,...styled].map(p=>[propertyKey(p.member),p]));
    for(const p of node.properties)if(p.member.name!=='Style'||p.member.attached)result.set(propertyKey(p.member),p);
    return Object.assign([...result.values()],{builtinStyle:styled.builtinStyle??defaults.builtinStyle});
  }
  return {dictionary,lookup,resolve,constant,convert,properties};
}
