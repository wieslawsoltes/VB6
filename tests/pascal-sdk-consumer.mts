import {
  PASCAL_DIALECT, PASCAL_VERSION, PASCAL_KEYWORDS, PascalError,
  tokenizePascal, parsePascalModule, lowerPascalModule, compilePascalModule,
  compileModule, compileProject, createPascalProject, compilePascalSource,
  type PascalToken, type PascalTokens, type PascalModuleAst,
  type LoweredPascalModule, type CompiledPascalModule, type SourceProject,
} from '@vb6/turbo-pascal';
import '@vb6/turbo-pascal/browser';

function require(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message);}
const source='program Consumer; var Answer:Integer; begin Answer:=6*7; WriteLn(Answer) end.';
const tokens:PascalTokens=tokenizePascal(source,{sourceName:'Consumer',tolerant:true});
const first:PascalToken|undefined=tokens[0];
const names:string[]=tokens.filter(token=>token.type==='id').map(token=>String(token.value));
require(first?.value==='program'&&names.includes('Answer'),'Token array contract');
require(tokens.comments.length===0&&tokens.directives.length===0&&tokens.diagnostics.length===0,'Lexical metadata');
// @ts-expect-error The runtime result is the token array itself, not {tokens}.
tokens.tokens;
const ast:PascalModuleAst=parsePascalModule(source,{sourceName:'Consumer'});
const kind:'program'|'unit'|'fragment'=ast.moduleKind;
require(kind==='program'&&ast.name==='Consumer'&&ast.body?.kind==='block','AST contract');
const lowered:LoweredPascalModule=lowerPascalModule(ast);
require(lowered.ast===ast&&lowered.pascal.version==='7.0'&&lowered.sourceMap[0]?.generatedLine===1,'Lowered module contract');
const module:CompiledPascalModule=compilePascalModule(source,{name:'Consumer',retainSyntax:true});
require(module.language==='pascal'&&module.pascal.unitName==='Consumer'&&module.procedures.has('main'),'Pascal module contract');
const project:SourceProject=createPascalProject(source,{name:'Consumer'});
require(compileProject(project).valid&&compilePascalSource(source).valid,'Project compilation');
require(compileModule({name:'Main',language:'vb6',code:'Public Sub Main()\nEnd Sub'}).procedures.has('main'),'Shared module compilation');
const error=new PascalError('Example',{line:3,column:4},null,'TP_EXAMPLE');
const nullableSource:string|null=error.source;
require(nullableSource===null&&error.code==='TP_EXAMPLE'&&error.line===3,'Error construction and null source');
require(PASCAL_DIALECT==='Turbo Pascal 7.0'&&PASCAL_VERSION.length>0&&PASCAL_KEYWORDS.has('program'),'Package constants');
require(globalThis.TurboPascal.compileProject(project).valid,'Typed browser global');
require(Object.keys(globalThis.TurboPascal).length===12,'Browser API export count');
export const qualified=true;
