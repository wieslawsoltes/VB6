/** Reproducible, non-executing importer for the pinned Microsoft WinUI resources.
 * Source XAML is parsed as data. This tool never evaluates markup extensions,
 * instantiates controls, loads DLLs, follows dictionary URLs or imports fonts.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseXaml, XAML_NS, XMLNS_NS} from '../packages/xaml-compiler/src/syntax.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const scalarTypes = new Set(['Double','Int32','Boolean','String','Color','Thickness','CornerRadius','GridLength','FontWeight','FontFamily','Visibility','TextTrimming','BackgroundSizing','HorizontalAlignment','VerticalAlignment','Symbol','ListViewItemPresenterCheckMode']);
const elementChildren = node => node.children.filter(child => child.kind === 'Element');
const textContent = node => node.children.filter(child => child.kind === 'Text' || child.kind === 'CData').map(child => child.value).join('').trim();
const attribute = (node, name) => node.attributes.find(item => item.name === name)?.value;
const keyOf = node => node.attributes.find(item => item.namespaceURI === XAML_NS && item.localName === 'Key')?.value;
const literal = value => ({kind:'Literal', value});
const unsupported = (type, reason) => ({kind:'Unsupported', type, reason});

export function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** Native ARGB order is retained; conversion to CSS is a renderer decision. */
export function normalizeWinUI3Color(value) {
  const text = String(value).trim(), named = {transparent:'#00FFFFFF',black:'#FF000000',white:'#FFFFFFFF',lightgray:'#FFD3D3D3'};
  if (Object.hasOwn(named, text.toLowerCase())) return named[text.toLowerCase()];
  if (/^#[\da-f]{8}$/i.test(text)) return text.toUpperCase();
  if (/^#[\da-f]{6}$/i.test(text)) return '#FF' + text.slice(1).toUpperCase();
  if (/^#[\da-f]{3,4}$/i.test(text)) return normalizeWinUI3Color('#' + [...text.slice(1)].map(char => char + char).join(''));
  throw new TypeError('Unsupported XAML color literal: ' + text);
}

function scalar(type, text) {
  if (type === 'Color') return normalizeWinUI3Color(text);
  if (type === 'Boolean') {
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    throw new TypeError('Invalid Boolean resource: ' + text);
  }
  if (type === 'Double' || type === 'Int32') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw new TypeError('Invalid numeric resource: ' + text);
    const result = Number(text);
    if (!Number.isFinite(result) || type === 'Int32' && (!Number.isInteger(result) || result < -2147483648 || result > 2147483647)) throw new RangeError('Numeric resource is outside ' + type + '.');
    return result;
  }
  if (type === 'Thickness' || type === 'CornerRadius') {
    const values = text.split(/[\s,]+/).map(item => scalar('Double', item));
    if (values.length === 1) return Array(4).fill(values[0]);
    if (type === 'Thickness' && values.length === 2) return [values[0], values[1], values[0], values[1]];
    if (values.length === 4) return values;
    throw new TypeError('Invalid ' + type + ' resource: ' + text);
  }
  if (type === 'GridLength') {
    if (/^auto$/i.test(text)) return {unit:'auto', value:1};
    const star = text.endsWith('*'), value = scalar('Double', text === '*' ? '1' : star ? text.slice(0, -1) : text);
    if (value < 0) throw new RangeError('Grid length cannot be negative.');
    return {unit:star ? 'star' : 'pixel', value};
  }
  return text;
}

function expression(text, type) {
  const match = /^\{(StaticResource|ThemeResource)\s+(?:ResourceKey\s*=\s*)?([^{}]+)\}$/.exec(text.trim());
  if (match) return {kind:'Resource', key:match[2].trim(), theme:match[1] === 'ThemeResource'};
  if (text.startsWith('{}')) return literal(text.slice(2));
  if (text.trimStart().startsWith('{')) return unsupported('MarkupExtension', text);
  return literal(type ? scalar(type, text.trim()) : text);
}

function readResource(node) {
  const type = node.localName;
  if (node.namespaceURI.includes('?')) return {type, unsupported:'Conditional XAML namespaces require a platform capability evaluator.'};
  if (scalarTypes.has(type)) {
    if (elementChildren(node).length) return {type, unsupported:'Scalar resource contains object elements.'};
    return {type, value:scalar(type, textContent(node))};
  }
  if (type === 'StaticResource') {
    const key = attribute(node, 'ResourceKey');
    return key ? {type, value:key} : {type, unsupported:'StaticResource is missing ResourceKey.'};
  }
  if (type === 'SolidColorBrush') {
    const unknown = node.attributes.filter(item => item.namespaceURI !== XMLNS_NS && item.namespaceURI !== XAML_NS && !['Color','Opacity'].includes(item.name));
    if (unknown.length || elementChildren(node).length) return {type, unsupported:'Brush transforms, object properties and unknown attributes require a rendering host.'};
    return {type, value:{color:expression(attribute(node, 'Color') ?? 'Black', 'Color'), opacity:expression(attribute(node, 'Opacity') ?? '1', 'Double')}};
  }
  if (type === 'LinearGradientBrush') {
    const point = (text, fallback) => {
      const values = (text ?? fallback).split(/[\s,]+/).map(item => scalar('Double', item));
      if (values.length !== 2) throw new TypeError('A gradient endpoint requires two coordinates.');
      return values;
    };
    const allowed = new Set(['StartPoint','EndPoint','MappingMode','SpreadMethod','Opacity','ColorInterpolationMode']);
    if (node.attributes.some(item => item.namespaceURI !== XMLNS_NS && item.namespaceURI !== XAML_NS && !allowed.has(item.name))) return {type, unsupported:'Unsupported gradient attribute or transform.'};
    const gradientStops = [];
    let relativeTransform = null;
    for (const child of elementChildren(node)) {
      if (child.localName === 'LinearGradientBrush.RelativeTransform') {
        const transform = elementChildren(child);
        if (transform.length !== 1 || transform[0].localName !== 'ScaleTransform' || elementChildren(transform[0]).length || transform[0].attributes.some(item => !['ScaleX','ScaleY','CenterX','CenterY'].includes(item.name))) return {type, unsupported:'Only a scalar relative ScaleTransform is represented for linear gradients.'};
        const scale = transform[0];
        relativeTransform = {type:'ScaleTransform', scaleX:scalar('Double', attribute(scale,'ScaleX') ?? '1'), scaleY:scalar('Double', attribute(scale,'ScaleY') ?? '1'), centerX:scalar('Double', attribute(scale,'CenterX') ?? '0'), centerY:scalar('Double', attribute(scale,'CenterY') ?? '0')};
      } else {
        const stops = child.localName === 'LinearGradientBrush.GradientStops' ? elementChildren(child) : [child];
        for (const stop of stops) {
          if (stop.localName !== 'GradientStop' || elementChildren(stop).length || stop.attributes.some(item => !['Offset','Color'].includes(item.name))) return {type, unsupported:'Unsupported linear gradient child or stop attribute.'};
          gradientStops.push({offset:scalar('Double', attribute(stop,'Offset') ?? '0'), color:expression(attribute(stop,'Color') ?? 'Black','Color')});
        }
      }
    }
    const mappingMode = attribute(node,'MappingMode') ?? 'RelativeToBoundingBox', spreadMethod = attribute(node,'SpreadMethod') ?? 'Pad';
    if (!['Absolute','RelativeToBoundingBox'].includes(mappingMode) || !['Pad','Reflect','Repeat'].includes(spreadMethod)) return {type, unsupported:'Unsupported gradient mapping or spread mode.'};
    return {type, value:{startPoint:point(attribute(node,'StartPoint'),'0,0'), endPoint:point(attribute(node,'EndPoint'),'1,1'), mappingMode, spreadMethod, opacity:expression(attribute(node,'Opacity') ?? '1','Double'), relativeTransform, gradientStops, ...(attribute(node,'ColorInterpolationMode') ? {colorInterpolationMode:attribute(node,'ColorInterpolationMode')} : {})}};
  }
  if (type === 'Style') {
    const target = attribute(node, 'TargetType') ?? '', setters = [], unsupportedSetters = [];
    let children = elementChildren(node);
    const collection = children.find(child => child.localName === 'Style.Setters');
    if (collection) children = [...children.filter(child => child !== collection), ...elementChildren(collection)];
    for (const setter of children) {
      const property = attribute(setter, 'Property');
      if (setter.localName !== 'Setter' || !property || attribute(setter, 'Target')) {
        unsupportedSetters.push({property:property ?? setter.localName, type:setter.localName, reason:'Only property setters are represented by this scalar catalog.'});
        continue;
      }
      const text = attribute(setter, 'Value');
      if (text !== undefined) {
        const value = expression(text);
        if (value.kind !== 'Unsupported') setters.push({property, value});
        else unsupportedSetters.push({property, type:value.type, reason:value.reason});
      } else {
        const propertyElement = elementChildren(setter).find(child => child.localName === 'Setter.Value');
        const valueElement = propertyElement && elementChildren(propertyElement)[0];
        if (valueElement?.localName === 'StaticResource' && attribute(valueElement, 'ResourceKey')) setters.push({property, value:{kind:'Resource', key:attribute(valueElement, 'ResourceKey'), theme:false}});
        else if (valueElement && scalarTypes.has(valueElement.localName)) setters.push({property, value:literal(scalar(valueElement.localName, textContent(valueElement)))});
        else unsupportedSetters.push({property, type:valueElement?.localName ?? 'Object', reason:'Templates, animations and object-valued setters require an explicit host implementation.'});
      }
    }
    const prefix = target.includes(':') ? target.split(':')[0] : '';
    return {type, value:{targetType:target.split(':').at(-1), namespaceURI:node.namespaces[prefix] ?? '', basedOn:attribute(node, 'BasedOn') ? expression(attribute(node, 'BasedOn')) : null, setters, unsupported:unsupportedSetters}};
  }
  return {type, unsupported:type === 'AcrylicBrush' || type === 'DesktopAcrylicBackdrop' ? 'Native material composition requires a platform compositor; no fabricated solid substitute is supplied.' : 'This object resource requires a control, template, animation, converter or brush host.'};
}

/** Tuple format is generated data only: [key, theme, type, value, line, error?].
 * Namescope-local resources inside templates are deliberately not promoted to
 * application resources. Duplicate keys stay visible and fail during lookup.
 */
export function importWinUI3Dictionary(xml, source = {}) {
  const parsed = parseXaml(xml, {uri:source.path ?? '', maxLength:5_000_000, maxNodes:300_000});
  if (parsed.diagnostics.length) throw new Error('Invalid resource XML: ' + parsed.diagnostics.map(d => `${d.line}:${d.column} ${d.message}`).join('; '));
  if (parsed.root?.localName !== 'ResourceDictionary') throw new TypeError('Expected a ResourceDictionary root.');
  const resources = [], themes = [], diagnostics = [];
  const collect = (dictionary, theme) => {
    const seen = new Set();
    for (const node of elementChildren(dictionary)) {
      if (node.localName.includes('.')) continue;
      const key = keyOf(node) ?? (node.localName === 'Style' && attribute(node, 'TargetType') ? '@' + attribute(node, 'TargetType').split(':').at(-1) : undefined);
      if (key === undefined) {
        diagnostics.push({code:'WINUI3_UNKEYED_RESOURCE', line:parsed.source.positionAt(node.start).line + 1, type:node.localName});
        continue;
      }
      const line = parsed.source.positionAt(node.start).line + 1;
      if (seen.has(key)) diagnostics.push({code:'WINUI3_DUPLICATE_RESOURCE', key, theme, line});
      seen.add(key);
      const item = readResource(node), tuple = [key, theme, item.type, item.value ?? null, line];
      if (item.unsupported) tuple.push(item.unsupported);
      resources.push(tuple);
    }
  };
  collect(parsed.root, 'All');
  for (const node of elementChildren(parsed.root)) {
    if (node.localName === 'ResourceDictionary.MergedDictionaries') throw new Error('Pinned source unexpectedly introduces merged dictionary loading: ' + source.path);
    if (node.localName !== 'ResourceDictionary.ThemeDictionaries') continue;
    for (const dictionary of elementChildren(node)) {
      const key = keyOf(dictionary);
      if (dictionary.localName !== 'ResourceDictionary' || !key || themes.includes(key)) throw new Error('Invalid or duplicate theme dictionary in ' + source.path);
      themes.push(key); collect(dictionary, key);
    }
  }
  return {path:source.path ?? '', sha:source.sha ?? gitBlobSha(xml), layer:(source.path ?? '').startsWith('src/dxaml/') ? 'core' : 'controls', density:/\/DensityStyles\//.test(source.path ?? '') ? 'compact' : 'standard', themes, resources, diagnostics};
}

export function renderWinUI3Catalog(manifest, dictionaries) {
  const sources = dictionaries.map(({resources, diagnostics, ...source}) => ({...source, size:manifest.sources.find(item => item.path === source.path)?.size, resourceCount:resources.length, diagnostics}));
  const reference = {repository:manifest.repository, tag:manifest.tag, commit:manifest.commit, license:manifest.license, scope:manifest.scope, sourceCount:sources.length, resourceCount:dictionaries.reduce((count, dictionary) => count + dictionary.resources.length, 0)};
  const header = '/** Generated by tools/import-winui3-resources.mjs; do not edit.\n * Microsoft WinUI resource adaptation. Copyright (c) Microsoft Corporation.\n * Licensed under MIT; complete license: LICENSES/WinUI.txt.\n * All colors use native XAML ARGB order. No templates, fonts or native binaries.\n */\n';
  return header + 'export const WINUI3_GENERATED_REFERENCE = ' + JSON.stringify(reference) + ';\n' +
    'export const WINUI3_GENERATED_SOURCES = ' + JSON.stringify(sources) + ';\n' +
    'export const WINUI3_GENERATED_DICTIONARIES = [\n' + dictionaries.map(dictionary => '  ' + JSON.stringify(dictionary.resources)).join(',\n') + '\n];\n';
}

export async function generateWinUI3Catalog({sourceDirectory, fetchSources = false, check = false, manifestFile = path.join(root, 'tools/winui3-upstream.json'), outputFile = path.join(root, 'src/theme/winui3-resources.generated.js')} = {}) {
  if (!sourceDirectory && !fetchSources) throw new Error('Use --source-dir <pinned checkout> or --fetch; source access is explicit.');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.format !== 1 || !/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.repository !== 'microsoft/microsoft-ui-xaml') throw new Error('Invalid pinned WinUI manifest.');
  const dictionaries = [];
  for (const source of manifest.sources) {
    if (!(source.path === 'src/dxaml/xcp/dxaml/themes/generic.xaml' || /^src\/controls\/dev\/[A-Za-z0-9_./-]+\.xaml$/.test(source.path)) || source.path.split('/').includes('..') || !/^[a-f0-9]{40}$/.test(source.sha)) throw new Error('Invalid WinUI source path or blob SHA.');
    let bytes;
    if (sourceDirectory) bytes = await fs.readFile(path.join(sourceDirectory, source.path));
    else {
      const url = `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${source.path}`;
      const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`Cannot fetch pinned source ${source.path}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.length !== source.size || gitBlobSha(bytes) !== source.sha) throw new Error('Pinned source hash or length mismatch: ' + source.path);
    const xml = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);
    dictionaries.push(importWinUI3Dictionary(xml, source));
  }
  const output = renderWinUI3Catalog(manifest, dictionaries);
  if (check) {
    if (await fs.readFile(outputFile, 'utf8') !== output) throw new Error('WinUI catalog differs from verified pinned sources. Regenerate and review the change.');
  } else await fs.writeFile(outputFile, output);
  return {sources:dictionaries.length, resources:dictionaries.reduce((count, item) => count + item.resources.length, 0), diagnostics:dictionaries.flatMap(item => item.diagnostics.map(diagnostic => ({path:item.path, ...diagnostic}))), outputFile};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--source-dir') { options.sourceDirectory = args[++index]; if (!options.sourceDirectory) throw new Error('--source-dir requires a directory.'); }
    else if (arg === '--fetch') options.fetchSources = true;
    else if (arg === '--check') options.check = true;
    else throw new Error('Unknown importer argument: ' + arg);
  }
  console.log(JSON.stringify(await generateWinUI3Catalog(options), null, 2));
}
