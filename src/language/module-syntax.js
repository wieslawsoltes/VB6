import {DeclarationCursor} from './declaration-cursor.js';
import {parseParameters,checkDeclarationType} from './declarations.js';
import {defaultIdentifierType} from './default-types.js';
import {parseExpression} from './expression.js';

const SUFFIX=/[$%&!#@]$/;
function plainName(cursor) {
  const token=cursor.peek(),name=cursor.name();
  if(SUFFIX.test(name))cursor.fail('Type-declaration character is not permitted here');
  return {name,token};
}
function libraryString(cursor,label) {
  const token=cursor.peek();
  if(token.type!=='string'||!token.value||/[\0\r\n]/.test(token.value))cursor.fail('Expected nonempty '+label+' string');
  cursor.index++;return token.value;
}

/** Module-only headers, using the same opaque tokens and parameter grammar as
 * ordinary procedures. No declaration loads a DLL or constructs a host object. */
export function parseModuleHeader(text,defaultTypes={}) {
  if(!/^(?:(?:Public|Private)\s+)?(?:Declare|Enum|Type|Event|Implements)\b/i.test(text))return null;
  const p=new DeclarationCursor(text);
  const explicitScope=p.match('private')?'private':p.match('public')?'public':null,scope=explicitScope||'public';
  if(p.match('implements')) {
    if(explicitScope)p.fail('Implements cannot specify visibility');
    const name=p.qualifiedName();p.end();return {kind:'implements',name};
  }
  const kind=p.match('enum')?'enum':p.match('type')?'type':p.match('event')?'event':null;
  if(kind) {
    const {name}=plainName(p);
    if(kind!=='event'){p.end();return {kind,name,scope};}
    const args=p.group();p.end();
    const params=parseParameters(args||'',defaultTypes);
    if(params.some(a=>a.optional||a.paramArray))p.fail('Event parameters cannot be Optional or ParamArray');
    return {kind,name,scope,params};
  }
  p.expect('declare');
  if(p.match('ptrsafe'))p.fail('PtrSafe is a VBA7 extension, not a VB6 Declare modifier');
  const procedureKind=p.match('function')?'function':p.match('sub')?'sub':null;
  if(!procedureKind)p.fail('Expected Function or Sub in Declare');
  const name=p.name();p.expect('lib');const library=libraryString(p,'Lib');
  const alias=p.match('alias')?libraryString(p,'Alias'):null;
  if(alias?.startsWith('#')&&!/^#\d+$/.test(alias))p.fail('Declare ordinal Alias must contain only decimal digits after #');
  const args=p.group(),explicit=p.match('as');
  const returnType=explicit?p.qualifiedName():defaultIdentifierType(name,defaultTypes);p.end();
  checkDeclarationType(name,returnType,explicit);
  if(procedureKind==='sub'&&(explicit||SUFFIX.test(name)))p.fail('Declare Sub cannot specify a return type');
  const params=parseParameters(args||'',defaultTypes,{allowAny:true});
  if(params.some(a=>a.optional||a.paramArray||a.autoNew))p.fail('Declare parameters cannot be Optional, ParamArray or As New');
  return {kind:'declare',name,procedureKind,scope,params,returnType,external:{library,entry:alias||name.replace(SUFFIX,'')}};
}

/** Enum values retain expression trees for the shared checked constant binder. */
export function parseEnumMember(text,previous=null) {
  const p=new DeclarationCursor(text),{name}=plainName(p);
  const initial=p.match('=')?parseExpression(p.rest()):previous
    ?{kind:'binary',op:'+',left:{kind:'id',name:previous},right:{kind:'literal',value:1}}
    :{kind:'literal',value:0};
  p.end();return {name,initial};
}
