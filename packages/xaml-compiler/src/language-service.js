import {SourceText,parseXaml,parseMarkupExtension,applyTextEdits,XAML_NS,XML_NS,XMLNS_NS,PRESENTATION_NS,xmlSpace} from './syntax.js';
import {createWinUISchema} from './schema.js';
import {compileXaml} from './compiler.js';

const inSpan = (offset, item) => item.start <= offset && offset <= item.end;
function nodeAt(syntax, offset) { return syntax.elements.findLast(e => inSpan(offset,e)); }
function valueRange(attr) { return {start:attr.valueStart,end:attr.valueEnd}; }
function typeFor(schema, syntax, element) {
  if (!element) return null;
  if (element.localName.includes('.')) element = syntax.elements.findLast(e => e !== element && e.start < element.start && e.end >= element.end);
  return element && schema.getType(element.namespaceURI,element.localName);
}
function declaredNames(compilation) {
  const result = [], elements = new Map(compilation.syntax.elements.map(e => [e.start,e]));
  for (const node of compilation.nodes) {
    if (!node.name) continue;
    const element = elements.get(node.source.start);
    for (const attr of element.attributes) if (attr.namespaceURI === XAML_NS && attr.localName === 'Name' || (!attr.namespaceURI||attr.namespaceURI===element.namespaceURI) && attr.localName === compilation.schema.runtimeNameProperty(compilation.schema.getType(node.type.namespaceURI,node.type.name))) {
      result.push({kind:'name',name:node.name,scope:node.scope,...valueRange(attr),declaration:true});
    }
  }
  return result;
}
function occurrences(compilation) {
  const result = declaredNames(compilation), nodes = new Map(compilation.nodes.map(n => [n.source.start,n]));
  for (const e of compilation.syntax.elements) {
    const node = nodes.get(e.start), scope = node?.scope ?? 0;
    for (const a of e.attributes) {
      if (a.namespaceURI === XAML_NS && a.localName === 'Key') result.push({kind:'resource',name:a.value,scope:0,...valueRange(a),declaration:true});
      if (a.localName === 'Storyboard.TargetName') result.push({kind:'name',name:a.value,scope,...valueRange(a)});
      if (!a.value.startsWith('{') || a.value.startsWith('{}')) continue;
      const walk = markup => {
        if (markup.kind !== 'MarkupExtension') return;
        const uri = e.namespaces[markup.prefix] ?? '';
        if (compilation.schema.markupExtensionNamespaces.has(uri) && ['StaticResource','ThemeResource'].includes(markup.localName)) {
          const arg = markup.arguments.find(arg => arg.name === 'ResourceKey' || arg.name === null)?.value;
          if (arg?.kind === 'Literal') result.push({kind:'resource',name:arg.value,scope:0,start:arg.start,end:arg.end,encoded:a.rawValue !== a.value});
        }
        if (compilation.schema.markupExtensionNamespaces.has(uri) && markup.localName === 'Binding') {
          const arg = markup.arguments.find(arg => arg.name === 'ElementName')?.value;
          if (arg?.kind === 'Literal') result.push({kind:'name',name:arg.value,scope,start:arg.start,end:arg.end,encoded:a.rawValue !== a.value});
        }
        if (uri === XAML_NS && markup.localName === 'Bind') {
          const arg = markup.arguments.find(arg => arg.name === 'Path' || arg.name === null)?.value;
          const first = arg?.kind === 'Literal' && /^[A-Za-z_]\w*/.exec(arg.value);
          if (first && result.some(d => d.declaration && d.kind === 'name' && d.scope === scope && d.name === first[0])) result.push({kind:'name',name:first[0],scope,start:arg.start,end:arg.start+first[0].length,encoded:a.rawValue !== a.value});
        }
        for (const arg of markup.arguments) walk(arg.value);
      };
      walk(parseMarkupExtension(a.value,a.valueStart));
    }
  }
  return result;
}

/** Immutable per-version snapshots; all positions are UTF-16 and zero-based. */
export class XamlLanguageService {
  constructor(options = {}) { this.schema = options.schema ?? createWinUISchema(); this.options = options; this.documents = new Map(); }
  openDocument(uri, text, version = 1) {
    if (typeof uri !== 'string' || typeof text !== 'string' || !Number.isSafeInteger(version)) throw new TypeError('Invalid XAML document snapshot.');
    if (text.length > (this.options.maxLength ?? 2_000_000)) throw new RangeError('XAML document too large.');
    const old = this.documents.get(uri);
    if (old && (version < old.version || version === old.version && text !== old.text)) throw new Error('Stale XAML document version.');
    if (old?.version === version && old.text === text) return old;
    if (!old && this.documents.size >= (this.options.maxDocuments ?? 128)) throw new RangeError('Too many open XAML documents.');
    const document = {uri,text,version,source:new SourceText(text,uri),compilation:null,schemaRevision:-1};
    this.documents.set(uri,document); return document;
  }
  changeDocument(uri, changes, version) {
    const old = this.document(uri); if (version <= old.version) throw new Error('Stale XAML document version.');
    if (!Array.isArray(changes) || changes.length > 1000) throw new RangeError('Invalid XAML edit batch.');
    let text = old.text;
    for (const edit of changes) {
      if (!edit.range) text = edit.text;
      else {
        const source = new SourceText(text,uri), start = source.offsetAt(edit.range.start), end = source.offsetAt(edit.range.end);
        text = applyTextEdits(text,[{start,end,text:edit.text}]);
      }
    }
    return this.openDocument(uri,text,version);
  }
  closeDocument(uri) { this.documents.delete(uri); }
  document(uri) { const d = this.documents.get(uri); if (!d) throw new Error('XAML document is not open: ' + uri); return d; }
  analyze(uri) {
    const d = this.document(uri);
    if (!d.compilation || d.schemaRevision !== this.schema.revision) { d.compilation = compileXaml(d.text,{...this.options,schema:this.schema,uri}); d.schemaRevision = this.schema.revision; }
    return d.compilation;
  }
  diagnostics(uri) { return this.analyze(uri).diagnostics; }
  completion(uri, position) {
    const d = this.document(uri), offset = typeof position === 'number' ? position : d.source.offsetAt(position), c = this.analyze(uri), element = nodeAt(c.syntax,offset), type = typeFor(this.schema,c.syntax,element);
    const attr = element?.attributes.find(a => a.valueStart <= offset && offset <= a.valueEnd);
    const before = d.text.slice(0,offset), word = /[\p{L}\p{N}_:.\-]*$/u.exec(before)[0], start = offset - word.length;
    const suggestions = [], add = (label,kind,detail,insertText = label,range = {start,end:offset}) => suggestions.push({label,kind,detail,insertText,range:d.source.range(range.start,range.end),start:range.start,end:range.end});
    if (attr) {
      const member = type && this.schema.member(type,attr.name,element.namespaces), valuePrefix = d.text.slice(attr.valueStart,offset);
      const resource=/\{(?:\w+:)?(StaticResource|ThemeResource)\s+[^}]*$/.exec(valuePrefix);
      if (resource) {
        const seen=new Set();
        for (const s of occurrences(c).filter(s => s.declaration && s.kind === 'resource')) {if(!seen.has(s.name))add(s.name,'value','Resource key');seen.add(s.name);}
        if(resource[1]==='ThemeResource')for(const key of this.schema.themeResourceKeys)if(!seen.has(key))add(key,'value','Semantic theme resource');
      }
      else if (/(?:Mode|DefaultBindMode)\s*=\s*[^,}]*$/.test(valuePrefix) || attr.namespaceURI === XAML_NS && attr.localName === 'DefaultBindMode') for (const mode of ['OneTime','OneWay','TwoWay']) add(mode,'value','Binding mode');
      else if (/ElementName\s*=\s*[^,}]*$/.test(valuePrefix)) for (const s of declaredNames(c)) add(s.name,'reference','Named element');
      else {
        for (const value of member?.values ?? (member?.type === 'Boolean' ? ['True','False'] : [])) add(value,'value',member.type);
        if (!valuePrefix || valuePrefix.startsWith('{')) {
          const x = Object.entries(element.namespaces).find(([,uri]) => uri === XAML_NS)?.[0];
          for (const name of ['Binding','StaticResource','ThemeResource','TemplateBinding',...(x ? [x+':Bind',x+':Null'] : [])]) add('{'+name+'}','snippet','Markup extension','{'+name+'}',{start:attr.valueStart,end:attr.valueEnd});
        }
      }
      return suggestions.filter(s => s.label.toLowerCase().includes(word.toLowerCase()) || s.kind === 'snippet');
    }
    if (before[start-1] === '<' || before.slice(Math.max(0,start-2),start) === '</') {
      if (before.slice(Math.max(0,start-2),start) === '</') {
        for (const e of c.syntax.elements.filter(e => e.start < start && e.end >= offset && !e.selfClosing).reverse()) add(e.name,'type','Close element',e.name+'>');
      } else {
        const namespaces = element?.namespaces ?? {'':PRESENTATION_NS,x:XAML_NS};
        for (const [prefix,uri] of Object.entries(namespaces)) for (const t of this.schema.listTypes(uri)) add((prefix?prefix+':':'')+t.name,'type',t.namespaceURI);
      }
    } else if (element && offset <= element.openEnd && type) {
      const existing = new Set(element.attributes.filter(a => !inSpan(offset,a)).map(a => a.name));
      for (const [name,m] of Object.entries(this.schema.members(type))) if (!existing.has(name) && !m.attached && !name.startsWith('$')) add(name,m.kind === 'event' ? 'event' : 'property',m.type,name+'=""');
      for (const [prefix,uri] of Object.entries(element.namespaces)) {
        if (uri === XAML_NS) for (const name of ['Name','Key','Class','Uid','DataType','DefaultBindMode','Load']) if (!existing.has(prefix+':'+name)) add(prefix+':'+name,'property','XAML directive',prefix+':'+name+'=""');
        for (const t of this.schema.listTypes(uri)) for (const [name,m] of Object.entries(t.members)) if (m.attached) { const key = (prefix?prefix+':':'')+t.name+'.'+name; if (!existing.has(key)) add(key,'property',m.type,key+'=""'); }
      }
    }
    return suggestions.filter(s => s.label.toLowerCase().startsWith(word.toLowerCase()));
  }
  hover(uri, position) {
    const d = this.document(uri), offset = typeof position === 'number' ? position : d.source.offsetAt(position), c = this.analyze(uri), element = nodeAt(c.syntax,offset), type = typeFor(this.schema,c.syntax,element);
    if (!element || !type) return null;
    const attr = element.attributes.find(a => inSpan(offset,a)), member = attr && this.schema.member(type,attr.name,element.namespaces);
    const text = attr ? member ? `${member.owner}.${member.name}: ${member.type}${member.collection?' collection':''}${member.attached?' (attached)':''}${member.kind==='event'?' (event)':''}${member.aliasFor?' (alias for '+member.aliasFor+')':''}${member.values?'\n'+member.values.join(' | '):''}` : attr.namespaceURI === XAML_NS ? `XAML directive ${attr.name}` : null : `${type.name}${type.base?' : '+(typeof type.base==='string'?type.base:type.base.name):''}\n${type.namespaceURI}`;
    return text ? {contents:{kind:'plaintext',value:text},range:d.source.range(attr?.start ?? element.nameStart,attr?.end ?? element.nameEnd)} : null;
  }
  references(uri, position, includeDeclaration = true) {
    const d = this.document(uri), offset = typeof position === 'number' ? position : d.source.offsetAt(position), all = occurrences(this.analyze(uri)), hit = all.find(s => inSpan(offset,s));
    if (!hit) return [];
    return all.filter(s => s.kind === hit.kind && s.name === hit.name && s.scope === hit.scope && (includeDeclaration || !s.declaration)).map(s => ({...s,uri,range:d.source.range(s.start,s.end)}));
  }
  definition(uri, position) { return this.references(uri,position).filter(r => r.declaration); }
  rename(uri, position, newName) {
    const refs = this.references(uri,position), d = this.document(uri);
    if (!refs.length) throw new Error('No renameable XAML symbol here.');
    if (refs.some(r => r.encoded)) throw new Error('Rename requires unescaped symbol references; edit the encoded attribute explicitly.');
    if (refs[0].kind === 'name' && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(newName) || !newName || /[&<>"'{}]/.test(newName)) throw new Error('Invalid XAML symbol name.');
    const all = occurrences(this.analyze(uri)), declarations = refs.filter(r => r.declaration);
    if (declarations.length !== 1) throw new Error('Rename is ambiguous across resource scopes.');
    if (all.some(r => r.declaration && r.kind === refs[0].kind && r.scope === refs[0].scope && r.name === newName && r.name !== refs[0].name)) throw new Error('The target name already exists.');
    const edits = refs.map(r => ({start:r.start,end:r.end,text:newName,range:d.source.range(r.start,r.end)}));
    return {uri,version:d.version,edits,text:applyTextEdits(d.text,edits)};
  }
  symbols(uri) {
    const c = this.analyze(uri), source = c.syntax.source;
    const visit = element => ({name:element.attributes.find(a => a.namespaceURI === XAML_NS && a.localName === 'Name' || a.name === 'Name')?.value ?? element.name,detail:element.name,kind:element.localName.includes('.')?'property':'object',range:source.range(element.start,element.end),selectionRange:source.range(element.nameStart,element.nameEnd),children:element.children.filter(n => n.kind === 'Element').map(visit)});
    return c.syntax.root ? [visit(c.syntax.root)] : [];
  }
  foldingRanges(uri) {
    const c = this.analyze(uri), source = c.syntax.source;
    return [...c.syntax.elements,...c.syntax.children.filter(n => n.kind === 'Comment')].filter(e => source.positionAt(e.start).line < source.positionAt(e.end).line).map(e => ({startLine:source.positionAt(e.start).line,endLine:source.positionAt(e.closeStart ?? e.end).line,kind:e.kind === 'Comment'?'comment':'region'}));
  }
  semanticTokens(uri) {
    const c = this.analyze(uri), source = c.syntax.source, result = [];
    const kinds = {Type:'type',Property:'property',String:'string',Comment:'comment',CData:'string',ProcessingInstruction:'keyword',Delimiter:'operator'};
    for (const token of c.syntax.tokens) {
      if (!kinds[token.kind]) continue;
      let offset = token.start;
      while (offset < token.end) {
        const pos = source.positionAt(offset), next = source.lineStarts[pos.line+1] ?? source.text.length, end = Math.min(token.end,next);
        const length = source.text.slice(offset,end).replace(/[\r\n]+$/,'').length;
        if (length) result.push({...pos,length,type:kinds[token.kind],start:offset,end:offset+length});
        if (end <= offset) break; offset = end;
      }
    }
    return result.sort((a,b) => a.start-b.start);
  }
  format(uri, options = {}) { const d = this.document(uri), text = formatXaml(d.text,options); return text === d.text ? [] : [{start:0,end:d.text.length,text,range:d.source.range(0,d.text.length)}]; }
}

/** Conservative formatter: mixed-content and xml:space subtrees remain byte-for-byte intact. */
export function formatXaml(text,{tabSize=2,insertSpaces=true,newline} = {}) {
  const syntax = parseXaml(text);
  if (syntax.diagnostics.length) throw new Error('Fix XML syntax errors before formatting.');
  const indent = insertSpaces ? ' '.repeat(Math.max(1,Math.min(8,tabSize))) : '\t', nl = newline ?? (text.includes('\r\n')?'\r\n':'\n');
  const print = (node, depth, preserve = false) => {
    const pad = indent.repeat(depth);
    if (node.kind !== 'Element') return pad + text.slice(node.start,node.end);
    const space = node.attributes.find(a => a.namespaceURI === XML_NS && a.localName === 'space')?.value;
    preserve = space ? space === 'preserve' : preserve;
    if (preserve || node.children.some(n => n.kind === 'CData' || n.kind === 'Text' && !xmlSpace(n.value))) return pad + text.slice(node.start,node.end);
    if (node.selfClosing) return pad + text.slice(node.start,node.end);
    const children = node.children.filter(n => n.kind !== 'Text');
    const open = text.slice(node.start,node.openEnd), close = text.slice(node.closeStart,node.end);
    if (!children.length) return pad + open + close;
    return pad + open + nl + children.map(n => print(n,depth+1,preserve)).join(nl) + nl + pad + close;
  };
  return syntax.children.filter(n => n.kind !== 'Text').map(n => print(n,0)).join(nl) + nl;
}
