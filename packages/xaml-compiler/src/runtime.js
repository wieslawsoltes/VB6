import {safeMember} from './schema.js';

/** An explicit object writer, not a WinUI UI implementation. Hosts own controls,
 * dependency properties, binding observation, events, templates and disposal. */
export function instantiateXaml(program, host, options = {}) {
  if (program?.version !== 1 || program.root?.kind !== 'Object') throw new TypeError('Unsupported XAML construction program.');
  if (typeof host?.create !== 'function' || typeof host?.set !== 'function') throw new TypeError('A host with create and set methods is required.');
  const objects = new Map(), constructing = new Set(), names = new Map(), scopes = new Map(), created = [], subscriptions = [], pending = [], dictionaryDetails=new WeakMap(),activeResources=new Set();
  const appearance=options.theme??'Light';
  if(!['Light','Dark','HighContrast'].includes(appearance))throw new TypeError('Object writer theme must be Light, Dark or HighContrast.');
  let root, disposed = false, count = 0;
  const dispose = () => {
    if (disposed) return; disposed = true;
    const errors = [];
    for (const release of subscriptions.reverse()) try { release(); } catch (error) { errors.push(error); }
    for (const value of created.reverse()) try { host.dispose?.(value); } catch (error) { errors.push(error); }
    objects.clear(); names.clear(); scopes.clear();
    if (errors.length) throw new AggregateError(errors,'Errors disposing XAML objects.');
  };
  const members = node => new Map(node.properties.map(p => [p.member.name,p.value]));
  function dictionary(value,outer,depth=0) {
    if(depth>64)throw new RangeError('Resource dictionary nesting exceeds 64.');
    const scope=new Map(),details={merged:[],themes:new Map()};dictionaryDetails.set(scope,details);
    let entries=[];
    if(value?.kind==='Dictionary')entries=value.entries;
    else if(value?.kind==='Object'&&value.dictionary) {
      const props=members(value);
      if(props.has('Source'))throw new Error('External resource dictionaries require explicit host preprocessing.');
      const merged=props.get('MergedDictionaries');
      if(merged&&merged.kind!=='Collection')throw new TypeError('MergedDictionaries must be a dictionary collection.');
      for(const child of merged?.items??[])details.merged.push(dictionary(child,[scope,...outer],depth+1));
      const themes=props.get('ThemeDictionaries');
      if(themes) {
        if(themes.kind!=='Dictionary')throw new TypeError('ThemeDictionaries must contain keyed resource dictionaries.');
        for(const entry of themes.entries) {
          if(!['Default','Light','Dark','HighContrast'].includes(entry.key)||entry.value.kind!=='Object'||!entry.value.dictionary)throw new TypeError('Unsupported theme dictionary '+entry.key+'.');
          if(details.themes.has(entry.key))throw new TypeError('Duplicate theme dictionary '+entry.key+'.');
          details.themes.set(entry.key,dictionary(entry.value,[scope,...outer],depth+1));
        }
      }
      const items=props.get('Items');
      if(items&&items.kind!=='Dictionary')throw new TypeError('ResourceDictionary.Items must be keyed entries.');
      entries=items?.entries??[];
    } else if(value!==undefined)throw new TypeError('Resources must be a resource dictionary.');
    for(const entry of entries) {
      if(scope.has(entry.key))throw new TypeError('Duplicate resource key '+entry.key+'.');
      scope.set(entry.key,{value:entry.value,resources:[scope,...outer]});
    }
    return scope;
  }
  function findInDictionary(scope,key,seen=new Set()) {
    if(seen.has(scope))return undefined;seen.add(scope);
    if(scope.has(key))return scope.get(key);
    const details=dictionaryDetails.get(scope);
    for(let i=(details?.merged.length??0)-1;i>=0;i--){const item=findInDictionary(details.merged[i],key,seen);if(item)return item;}
    const selected=details?.themes.get(appearance)??details?.themes.get('Default');
    return selected?findInDictionary(selected,key,seen):undefined;
  }
  function resourceKeys(scope,keys,seen=new Set()) {
    if(seen.has(scope))return;seen.add(scope);
    for(const key of scope.keys())keys.add(key);
    const details=dictionaryDetails.get(scope);
    for(const merged of details?.merged??[])resourceKeys(merged,keys,seen);
    const selected=details?.themes.get(appearance)??details?.themes.get('Default');
    if(selected)resourceKeys(selected,keys,seen);
  }
  function lookupResource(key,resources) {
    for(const scope of resources) {
      const item=findInDictionary(scope,key);if(!item)continue;
      if(item.external)return {found:true,value:item.value};
      if(activeResources.has(item))throw new Error('Cyclic resource construction: '+key+'.');
      if(activeResources.size>=64)throw new RangeError('Resource dependency depth exceeds 64.');
      activeResources.add(item);
      try{return {found:true,value:value(item.value,item.resources)};}finally{activeResources.delete(item);}
    }
    return {found:false};
  }
  const readResource = (key, resources, theme) => {
    const lookup=()=>{const item=lookupResource(key,resources);if(!item.found)throw new Error('Missing XAML resource '+key+'.');return item.value;};
    // A generic object writer cannot own a dependency-property theme lifecycle.
    // The host receives the exact scoped resolver and chooses how to subscribe,
    // replace brushes and invalidate controls. StaticResource remains a snapshot.
    if(theme) {
      if(!host.resource)throw new Error('ThemeResource requires host.resource.');
      return host.resource(key,{theme:true,effectiveTheme:appearance,resources,root,names,lookup});
    }
    const item=lookupResource(key,resources);if(item.found)return item.value;
    if(host.resource)return host.resource(key,{theme:false,effectiveTheme:appearance,resources,root,names,lookup});
    throw new Error('Missing XAML resource '+key+'.');
  };
  function value(node, resources, depth = 0) {
    if (++count > (options.maxOperations ?? 200000) || depth > 256) throw new RangeError('XAML object writer budget exceeded.');
    options.signal?.throwIfAborted();
    if (node?.kind === 'Literal') return node.value;
    if (node?.kind === 'Resource') return readResource(node.key,resources,node.theme);
    if (node?.kind === 'Collection') return node.items.map(n => value(n,resources,depth + 1));
    if (node?.kind === 'Dictionary') return new Map(node.entries.map(e => [e.key,value(e.value,resources,depth + 1)]));
    if (node?.kind === 'RelativeSource') return node;
    if (node?.kind !== 'Object') throw new TypeError('Unsupported construction value ' + node?.kind + '.');
    if (objects.has(node)) return objects.get(node);
    if (constructing.has(node)) throw new Error('Cyclic resource construction.');
    if (node.directives?.Load || node.directives?.DeferLoadStrategy) throw new Error('Deferred x:Load and x:DeferLoadStrategy require host preprocessing.');
    if (node.template) {
      if (!host.template) throw new Error('Templates require host.template.');
      const create = instanceOptions => {
        const content = node.properties.find(p => p.member.name === 'Content')?.value;
        if (content?.kind !== 'Object') throw new Error('Template content must be an object.');
        const keys=new Set();for(const scope of resources)resourceKeys(scope,keys);
        // The template captures the declaration's selected resource snapshot,
        // including merged/themed entries and their ordinary lookup precedence.
        // ThemeResource still delegates to host.resource for its live lifecycle.
        const snapshot=new Map([...keys].map(key=>[key,readResource(key,resources,false)]));
        return instantiateXaml({version:1,root:content},host,{...options,...instanceOptions,resources:snapshot});
      };
      const result = host.template(node,create); objects.set(node,result); return result;
    }
    constructing.add(node);
    const resourceValue=node.dictionary?node:node.properties.find(p=>p.member.name==='Resources')?.value;
    const local=dictionary(resourceValue,resources),resourceScopes=[local,...resources];
    const instance = host.create(node.type,{node,names,resources:resourceScopes});
    created.push(instance);
    const scope = scopes.get(node.scope) ?? new Map(); scopes.set(node.scope,scope);
    if (node.name) { if (scope.has(node.name)) throw new Error('Duplicate runtime name ' + node.name + '.'); scope.set(node.name,instance); if (node.scope === program.root.scope) names.set(node.name,instance); }
    // Do not cache an instance before its properties finish: resource cycles
    // must not be mistaken for legal references to half-initialized objects.
    for (const property of node.properties) {
      const {member} = property, expression = property.value;
      safeMember(member.name);
      if (expression.kind === 'Binding' || member.kind === 'event') { pending.push({instance,member,expression,node,resources:resourceScopes,scope}); continue; }
      const result = value(expression,resourceScopes,depth + 1);
      if (expression.kind === 'Collection') {
        if (!host.add) throw new Error('Collections require host.add.');
        for (const item of result) host.add(instance,member,item);
      } else host.set(instance,member,result);
    }
    constructing.delete(node); objects.set(node,instance); return instance;
  }
  try {
    host.begin?.(program);
    const resources = options.resources instanceof Map ? options.resources : new Map(Object.entries(options.resources ?? {}));
    root = value(program.root,[new Map([...resources].map(([key,value]) => [key,{value,external:true}]))]);
    for (const item of pending) {
      const context = {root,names:item.scope,resources:item.resources,node:item.node,readResource:(key,theme=false) => readResource(key,item.resources,theme)};
      let release;
      if (item.member.kind === 'event') {
        if (!host.listen) throw new Error('Event connections require host.listen.');
        release = host.listen(item.instance,item.member,item.expression,context);
      } else {
        if (!host.bind) throw new Error('Bindings require host.bind.');
        release = host.bind(item.instance,item.member,item.expression,context);
      }
      if (typeof release === 'function') subscriptions.push(release);
    }
    host.commit?.(root);
    return {root,names,scopes,dispose};
  } catch (error) {
    const failures = [error];
    try { dispose(); } catch (cleanup) { failures.push(cleanup); }
    try { host.rollback?.(error); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures,'XAML construction and rollback failed.',{cause:error});
    throw error;
  }
}

/** Useful for tooling/tests: constructs inert data, never HTML or native widgets. */
export function createObjectHost() {
  return {
    create(type) { return {type:{...type},properties:Object.create(null)}; },
    set(target, member, value) { target.properties[safeMember(member.attached ? member.owner + '.' + member.name : member.name)] = value; },
    add(target, member, value) { const key = safeMember(member.name); (target.properties[key] ??= []).push(value); }
  };
}
