import {parseXaml, parseMarkupExtension, diagnostic, XAML_NS, XMLNS_NS, XML_NS, MC_NS, PRESENTATION_NS, xmlSpace} from './syntax.js';
import {createWinUISchema, convertValue} from './schema.js';
import {parseBindingPath} from './binding.js';

const literal = value => ({kind:'Literal', value});
const span = node => ({start:node.start, end:node.end});
const reference = type => ({namespaceURI:type.namespaceURI, name:type.name});
const modes = ['OneTime','OneWay','TwoWay'];
const directives = new Set(['Name','Key','Class','Uid','DataType','DefaultBindMode','Load','DeferLoadStrategy','FieldModifier']);
const extensionArguments = {
  Binding:['Path','Mode','ElementName','Source','RelativeSource','Converter','ConverterParameter','ConverterLanguage','FallbackValue','TargetNullValue','UpdateSourceTrigger'],
  Bind:['Path','Mode','BindBack','Converter','ConverterParameter','ConverterLanguage','FallbackValue','TargetNullValue','UpdateSourceTrigger'],
  StaticResource:['ResourceKey'], ThemeResource:['ResourceKey'], TemplateBinding:['Property'], RelativeSource:['Mode']
};

/** Syntax -> name/type/member binding -> typed, serializable construction IR.
 * A failed compilation exposes its semantic tree for tooling, never an executable program.
 */
export function compileXaml(text, options = {}) {
  const schema = options.schema ?? createWinUISchema();
  const syntax = typeof text === 'string' ? parseXaml(text, options) : text;
  if (!syntax || syntax.kind !== 'Document') throw new TypeError('Expected XAML text or a parsed document.');
  const source = syntax.source, diagnostics = [...syntax.diagnostics], nodes = [], symbols = [], references = [], scopes = [];
  const report = (code, message, at, severity = 'error') => {
    if (diagnostics.length < 400) diagnostics.push(diagnostic(source, code, message, at?.start ?? 0, at?.end ?? source.text.length, severity));
  };
  const newScope = () => { const scope = {id:scopes.length, names:new Map()}; scopes.push(scope); return scope; };
  const bindName = (node, value, at, scope) => {
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(value)) report('XAML1001','Invalid XAML name ' + value + '.',at);
    if (scope.names.has(value)) report('XAML1002','Duplicate name ' + value + ' in this namescope.',at);
    if (node.name && node.name !== value) report('XAML1003','Name and x:Name must not disagree.',at);
    node.name = value; scope.names.set(value,node);
    symbols.push({kind:'name',name:value,nodeId:node.id,scope:scope.id,...span(at)});
  };
  function extension(value, member, owner, context, at) {
    const markup = parseMarkupExtension(value, at.valueStart ?? at.start);
    if (markup.diagnostics?.length) for (const d of markup.diagnostics) report(d.code,d.message,d);
    if (markup.kind === 'Literal') {
      try { return literal(convertValue(markup.value,member)); }
      catch (error) { report('XAML1010',error.message,at); return literal(markup.value); }
    }
    return bindExtension(markup,member,owner,context,at);
  }
  function bindExtension(markup, member, owner, context, at) {
    const uri = owner.namespaces[markup.prefix] ?? '', name = markup.localName;
    if (name === 'Null' && uri === XAML_NS) {
      if (markup.arguments.length) report('XAML1011','x:Null does not accept arguments.',at);
      try { return literal(convertValue(null,member)); } catch (error) { report('XAML1010',error.message,at); return literal(null); }
    }
    const valid = name === 'Bind' ? uri === XAML_NS : schema.markupExtensionNamespaces.has(uri) && Object.hasOwn(extensionArguments,name);
    if (!valid) { report('XAML1012','Unsupported markup extension ' + markup.name + '.',at); return {kind:'Invalid'}; }
    const args = Object.create(null), allowed = extensionArguments[name];
    let positional = 0, namedSeen = false;
    for (const arg of markup.arguments) {
      if (arg.name) namedSeen = true;
      else if (positional++ || namedSeen) report('XAML1013','Only one leading positional argument is allowed for ' + name + '.',arg);
      const key = arg.name ?? allowed[0];
      if (!allowed.includes(key)) { report('XAML1013','Unknown ' + name + ' argument ' + key + '.',arg); continue; }
      if (Object.hasOwn(args,key)) report('XAML1013','Duplicate ' + name + ' argument ' + key + '.',arg);
      args[key] = arg.value.kind === 'MarkupExtension' ? bindExtension(arg.value,{type:'Object'},owner,context,arg) : literal(arg.value.value);
    }
    if (name === 'StaticResource' || name === 'ThemeResource') {
      const key = args.ResourceKey?.value;
      if (typeof key !== 'string' || !key) report('XAML1014',name + ' requires a nonempty literal key.',at);
      references.push({kind:'resource',name:key,scope:context.scope.id,...span(at)});
      return {kind:'Resource',key,theme:name === 'ThemeResource',source:span(at)};
    }
    if (name === 'RelativeSource') {
      if (!['Self','TemplatedParent'].includes(args.Mode?.value)) report('XAML1014','RelativeSource requires Self or TemplatedParent.',at);
      return {kind:'RelativeSource',mode:args.Mode?.value};
    }
    if (name === 'TemplateBinding') return {kind:'Binding',compiled:false,template:true,mode:'OneWay',path:args.Property?.value ?? '',expression:bindingPath(args.Property?.value ?? '',false,at),arguments:args,source:span(at)};
    const mode = args.Mode?.value ?? (name === 'Bind' ? context.defaultBindMode : 'OneWay');
    if (!modes.includes(mode)) report('XAML1015','Unknown binding mode ' + mode + '.',at);
    const path = args.Path?.value ?? '';
    if (typeof path !== 'string') report('XAML1016','Binding Path must be a literal expression.',at);
    const expression = bindingPath(path,name === 'Bind',at);
    if (mode === 'TwoWay' && expression && !['Member','Index'].includes(expression.kind) && !args.BindBack) report('XAML1017','TwoWay requires an assignable path or BindBack.',at);
    if (['Source','ElementName','RelativeSource'].filter(k => Object.hasOwn(args,k)).length > 1) report('XAML1018','Binding source selectors are mutually exclusive.',at);
    if (args.ElementName?.value) references.push({kind:'name',name:args.ElementName.value,scope:context.scope.id,...span(at)});
    return {kind:'Binding',compiled:name === 'Bind',mode,path,expression,arguments:args,source:span(at)};
  }
  function bindingPath(path, functions, at) {
    try { return parseBindingPath(path,{functions}); }
    catch (error) { report('XAML1016',error.message,at); return null; }
  }
  function propertyValue(children, member, owner, context, propertySyntax) {
    // Whitespace between objects is trivia, not a collection item. Significant
    // text is collapsed unless xml:space=preserve; adjacent text/CDATA coalesce.
    const values = []; let pending = '';
    const flush = () => {
      const value = context.preserveSpace ? pending : pending.replace(/[\x20\t\r\n]+/g,' ').trim();
      if (value && (context.preserveSpace || !xmlSpace(value))) {
        try { values.push(literal(convertValue(value, member.collection || member.dictionary ? {type:'String'} : member))); }
        catch (error) { report('XAML1010',error.message,propertySyntax); }
      }
      pending = '';
    };
    for (const child of children) {
      if (child.kind === 'Text' || child.kind === 'CData') { pending += child.value; continue; }
      if (child.kind !== 'Element') continue;
      flush();
      if (child.localName.includes('.')) { report('XAML1020','Property elements cannot be nested directly inside a property value.',child); continue; }
      const result = object(child,context);
      if (result) {
        if (result.primitive) values.push({...result.properties.find(p => p.member.name === '$value')?.value ?? literal(''), directives:result.directives, source:result.source});
        else values.push(result);
        if (member.itemType && member.itemType !== 'Object' && !result.primitive) {
          const expected = schema.getType(member.itemNamespaceURI ?? member.namespaceURI,member.itemType), actual = schema.getType(result.type.namespaceURI,result.type.name);
          if (expected && !schema.isAssignable(actual,expected)) report('XAML1021',result.type.name + ' is not assignable to ' + member.itemType + '.',child);
        }
      }
    }
    flush();
    if (member.dictionary) {
      if (values.length === 1 && values[0].kind === 'Object' && values[0].dictionary) return values[0];
      const seen = new Set(), entries = [];
      for (const value of values) {
        const target = value.kind === 'Object' && value.type.name === 'Style' ? value.properties.find(p => p.member.name === 'TargetType')?.value?.value : null;
        const key = value.directives?.Key ?? (target ? '@type:' + target : null);
        if (typeof key !== 'string' || !key) report('XAML1022','Dictionary entries require x:Key (or an implicit Style TargetType).',value.source ?? propertySyntax);
        else if (seen.has(key)) report('XAML1023','Duplicate resource key ' + key + '.',value.source ?? propertySyntax);
        seen.add(key); entries.push({key,value});
        symbols.push({kind:'resource',name:key,scope:context.scope.id,nodeId:value.id,...(value.source ?? span(propertySyntax))});
      }
      return {kind:'Dictionary',entries};
    }
    if (member.collection) return {kind:'Collection',items:values};
    if (values.length > 1) report('XAML1024','Property ' + member.name + ' accepts only one value.',propertySyntax);
    return values[0] ?? literal(member.type === 'String' ? '' : null);
  }
  function object(element, inherited) {
    options.signal?.throwIfAborted();
    const context = {...inherited,ignorable:new Set(inherited.ignorable)};
    const compatibility = element.attributes.find(a => a.namespaceURI === MC_NS && a.localName === 'Ignorable');
    if (compatibility) for (const prefix of compatibility.value.trim().split(/\s+/)) {
      if (!element.namespaces[prefix]) report('XAML1030','Undeclared ignorable prefix ' + prefix + '.',compatibility);
      else context.ignorable.add(element.namespaces[prefix]);
    }
    const type = schema.getType(element.namespaceURI,element.localName);
    if (!type) {
      if (context.ignorable.has(element.namespaceURI)) return null;
      report('XAML1031','Unknown XAML type {' + element.namespaceURI + '}' + element.localName + '.',element); return null;
    }
    const node = {kind:'Object',id:nodes.length,type:reference(type),source:span(element),scope:context.scope.id,properties:[],directives:{},name:null,template:!!type.template,dictionary:!!type.dictionary,primitive:type.primitive ?? null};
    nodes.push(node);
    for (const attr of element.attributes) {
      if (attr.namespaceURI === XML_NS && attr.localName === 'space') {
        if (!['preserve','default'].includes(attr.value)) report('XAML1032','xml:space must be preserve or default.',attr);
        context.preserveSpace = attr.value === 'preserve';
      }
      if (attr.namespaceURI === XAML_NS && attr.localName === 'DefaultBindMode') {
        if (!modes.includes(attr.value)) report('XAML1015','Unknown x:DefaultBindMode.',attr);
        else context.defaultBindMode = attr.value;
      }
    }
    const assigned = new Set();
    const assign = (member, value, at, implicit = false) => {
      const key = member.aliasFor ?? (member.attached ? member.namespaceURI + '#' + member.owner + '.' + member.name : member.name);
      if (assigned.has(key)) report('XAML1033','Property ' + key + ' is assigned more than once.',at);
      assigned.add(key);
      // Only serializable metadata enters executable IR; converters remain in the schema.
      const {convert, ...metadata} = member;
      node.properties.push({member:metadata,value,source:span(at),implicit});
      if (!member.attached && member.name === schema.runtimeNameProperty(type) && value.kind === 'Literal') bindName(node,String(value.value),at,context.scope);
    };
    for (const attr of element.attributes) {
      if (attr.namespaceURI === XMLNS_NS || attr.namespaceURI === XML_NS) continue;
      if (attr.namespaceURI === MC_NS) {
        if (attr.localName !== 'Ignorable') report('XAML1034','Unsupported markup compatibility directive ' + attr.name + '.',attr);
        continue;
      }
      if (attr.namespaceURI === XAML_NS) {
        if (!directives.has(attr.localName)) { report('XAML1035','Unsupported XAML directive ' + attr.name + '.',attr); continue; }
        if (attr.localName === 'Name') bindName(node,attr.value,{start:attr.valueStart,end:attr.valueEnd},context.scope);
        if (attr.localName === 'Class' && element !== syntax.root) report('XAML1036','x:Class is only valid on the document root.',attr);
        node.directives[attr.localName] = attr.localName === 'Load' ? extension(attr.value,{type:'Boolean'},element,context,attr) : attr.value;
        continue;
      }
      const member = schema.member(type,attr.name,element.namespaces);
      if (!member) {
        if (!context.ignorable.has(attr.namespaceURI)) report('XAML1037','Unknown member ' + attr.name + ' on ' + type.name + '.',attr);
        continue;
      }
      const value = extension(attr.value,member,element,context,attr);
      if (member.kind === 'event' && value.kind === 'Literal' && !/^[A-Za-z_]\w*$/.test(value.value)) report('XAML1038','Event handlers must be method identifiers.',attr);
      assign(member,value,attr);
    }
    const childContext = node.template ? {...context,scope:newScope()} : context;
    let content = [];
    const flushContent = () => {
      if (!content.some(c => c.kind === 'Element' || (c.kind === 'Text' || c.kind === 'CData') && (!xmlSpace(c.value) || context.preserveSpace))) { content = []; return; }
      const key = schema.contentProperty(type), member = key && schema.member(type,key,element.namespaces);
      if (!member) report('XAML1039',type.name + ' does not accept direct content.',element);
      else assign(member,propertyValue(content,member,element,childContext,element),element,true);
      content = [];
    };
    for (const child of element.children) {
      if (child.kind !== 'Element' || !child.localName.includes('.')) { content.push(child); continue; }
      flushContent();
      if (child.attributes.some(a => a.namespaceURI !== XMLNS_NS && a.namespaceURI !== XML_NS)) report('XAML1040','Property elements cannot have value attributes.',child);
      const member = schema.member(type,child.name,child.namespaces);
      if (!member) { if (!context.ignorable.has(child.namespaceURI)) report('XAML1037','Unknown property element ' + child.name + '.',child); continue; }
      assign(member,propertyValue(child.children,member,element,childContext,child),child);
    }
    flushContent();
    return node;
  }
  let root = null;
  if (syntax.root) root = object(syntax.root,{scope:newScope(),ignorable:new Set(),defaultBindMode:'OneTime',preserveSpace:false});
  const success = !!root && !diagnostics.some(d => d.severity === 'error');
  return {success,syntax,diagnostics,nodes,symbols,references,schema,root,program:success ? {version:1,root} : null};
}

/** Emits an ES module containing data plus a call into the explicit host runtime. */
export function emitXamlModule(compilation, {runtimeModule = '@vb6/xaml-compiler'} = {}) {
  if (!compilation?.success || !compilation.program) throw new Error('Cannot emit XAML with compilation errors.');
  const json = JSON.stringify(compilation.program,null,2).replace(/[\u2028\u2029<>]/g,c => '\\u' + c.charCodeAt(0).toString(16).padStart(4,'0'));
  return `import {instantiateXaml} from ${JSON.stringify(runtimeModule)};\nexport const program = ${json};\nexport function build(host, options) { return instantiateXaml(program, host, options); }\n`;
}
