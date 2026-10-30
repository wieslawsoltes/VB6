export type SourceLanguage = 'vb6' | 'pascal';
export interface SourceLocation {start:number; end:number; line:number; column:number; endLine:number; endColumn:number}
export interface Diagnostic {severity:'error'|'warning'|'info'; message:string; source?:string|null; code?:string; number?:number; line:number; column?:number}
export interface PascalToken extends SourceLocation {type:string; value?:string|number; lower?:string; raw:string}
/** The scanner returns an array with retained lexical metadata, not a wrapper. */
export interface PascalTokens extends Array<PascalToken> {
  readonly comments:PascalToken[];
  readonly directives:PascalToken[];
  readonly diagnostics:Diagnostic[];
}
export interface SourceModule {id?:string; name:string; kind?:'module'|'form'|'class'; language?:SourceLanguage; code:string; form?:FormModel|null; conditionalConstants?:Record<string,unknown>; pascalTargetSymbols?:Record<string,boolean>; [key:string]:unknown}
export interface FormModel {name:string; type:string; properties:Record<string,unknown>; controls:Record<string,unknown>[]; menus?:Record<string,unknown>[]; [key:string]:unknown}
export interface ProjectSettings {conditionalConstants?:Record<string,unknown>; [key:string]:unknown}
export interface SourceProject {schema:number; id?:string; name:string; language?:SourceLanguage; startup:string; modules:SourceModule[]; settings?:ProjectSettings; [key:string]:unknown}
export interface PascalNode {kind:string; loc:SourceLocation; [key:string]:unknown}
export interface PascalModuleAst extends PascalNode {
  kind:'pascalModule';
  name:string;
  sourceName:string;
  moduleKind:'program'|'unit'|'fragment';
  header:PascalToken|null;
  uses:PascalNode[];
  interfaceDeclarations:PascalNode[];
  implementationDeclarations:PascalNode[];
  declarations:PascalNode[];
  body:PascalNode|null;
  source:string;
  comments:PascalToken[];
  directives:PascalToken[];
}
export interface PascalSourceMapEntry {generatedLine:number; line:number; column:number; endLine:number; endColumn:number; internal:boolean}
export interface PascalSymbol {name:string; kind:string; vbName:string; type:string|null; line:number; column:number; public:boolean}
export interface PascalMetadata {
  version:'7.0';
  kind:PascalModuleAst['moduleKind'];
  unitName:string;
  uses:string[];
  interfaceUses:string[];
  implementationUses:string[];
  initializer:string|null;
  helpers:string[];
  symbols:{module:PascalSymbol[]; procedures:Record<string,PascalSymbol[]>};
  objectTypes:Record<string,unknown>[];
  objectDispatchers:Record<string,unknown>[];
  hostRequirements:string[];
  directives:{text:string; line:number}[];
}
export interface LoweredPascalModule {
  name:string;
  code:string;
  generatedSource:string;
  source:string;
  sourceMap:PascalSourceMapEntry[];
  ast:PascalModuleAst;
  pascalAst:PascalModuleAst;
  language:'pascal';
  pascal:PascalMetadata;
}
export interface Instruction {op:string; line:number; source:string; procedure:string; sequencePoint?:boolean; column?:number; endColumn?:number; [key:string]:unknown}
export interface CompiledProcedure {name:string; kind:string; scope:string; line:number; code:Instruction[]; params:Record<string,unknown>[]; returnType:string; [key:string]:unknown}
export interface CompiledModule {
  name:string; kind:string; source:string; language?:SourceLanguage; generatedSource?:string;
  procedures:Map<string,CompiledProcedure>; declarations:Record<string,unknown>[]; diagnostics:Diagnostic[];
  form:FormModel|null; sourceMap?:PascalSourceMapEntry[]; pascalAst?:PascalModuleAst; pascal?:PascalMetadata;
  [key:string]:unknown;
}
export interface CompiledPascalModule extends CompiledModule {
  language:'pascal'; generatedSource:string; sourceMap:PascalSourceMapEntry[]; pascalAst:PascalModuleAst; pascal:PascalMetadata;
}
export interface CompiledProject {name:string; startup:string; modules:Map<string,CompiledModule>; diagnostics:Diagnostic[]; valid:boolean; settings:ProjectSettings; sourceProject:SourceProject}
export interface PascalOptions {name?:string; moduleName?:string; units?:SourceModule[]; settings?:ProjectSettings; form?:FormModel|null; retainSyntax?:boolean}
export interface TokenizeOptions {sourceName?:string|null; tolerant?:boolean; maxTokens?:number}
export interface ParseOptions extends TokenizeOptions {maxDepth?:number; defines?:string[]|Set<string>|Record<string,unknown>; conditionalConstants?:Record<string,unknown>; targetSymbols?:Record<string,boolean>}
export interface CompileOptions extends ParseOptions {name?:string; project?:SourceProject; input?:SourceModule; retainSyntax?:boolean; [key:string]:unknown}
export declare const PASCAL_VERSION:string;
export declare const PASCAL_DIALECT:'Turbo Pascal 7.0';
export declare const PASCAL_KEYWORDS:Set<string>;
export declare class PascalError extends Error {
  constructor(message:string,token?:Partial<SourceLocation>,source?:string|null,code?:string);
  number:number; code:string; source:string|null; line:number; column:number; endLine:number; endColumn:number;
}
export declare function tokenizePascal(source:string,options?:TokenizeOptions):PascalTokens;
export declare function parsePascalModule(input:string|SourceModule,options?:ParseOptions):PascalModuleAst;
export declare function lowerPascalModule(input:string|SourceModule|PascalModuleAst,options?:CompileOptions):LoweredPascalModule;
export declare function compilePascalModule(input:string|SourceModule,options?:CompileOptions):CompiledPascalModule;
export declare function compileModule(input:SourceModule,options?:CompileOptions):CompiledModule;
export declare function compileProject(project:SourceProject,options?:CompileOptions):CompiledProject;
export declare function createPascalProject(source:string,options?:PascalOptions):SourceProject;
export declare function compilePascalSource(source:string,options?:PascalOptions):CompiledProject;
