export type SourceLanguage = 'vb6' | 'pascal';
export interface SourceLocation {start:number; end:number; line:number; column:number; endLine:number; endColumn:number}
export interface Diagnostic {severity:'error'|'warning'|'info'; message:string; source?:string; code?:string; number?:number; line:number; column?:number}
export interface PascalToken extends SourceLocation {type:string; value?:string|number; lower?:string; raw:string}
export interface PascalTokens extends Array<PascalToken> {readonly comments:PascalToken[]; readonly directives:PascalToken[]; readonly diagnostics:Diagnostic[]}
export interface SourceModule {id?:string; name:string; kind?:'module'|'form'|'class'; language?:SourceLanguage; code:string; form?:FormModel; [key:string]:unknown}
export interface FormModel {name:string; type:string; properties:Record<string,unknown>; controls:Record<string,unknown>[]; menus?:Record<string,unknown>[]; [key:string]:unknown}
export interface SourceProject {schema:number; id?:string; name:string; language?:SourceLanguage; startup:string; modules:SourceModule[]; settings?:Record<string,unknown>; [key:string]:unknown}
export interface PascalModuleAst {kind:string; name?:string; [key:string]:unknown}
export interface Instruction {op:string; line:number; source:string; procedure:string; sequencePoint?:boolean; column?:number; endColumn?:number; [key:string]:unknown}
export interface CompiledProcedure {name:string; kind:string; scope:string; line:number; code:Instruction[]; params:Record<string,unknown>[]; returnType:string; [key:string]:unknown}
export interface CompiledModule {name:string; kind:string; source:string; language?:SourceLanguage; generatedSource?:string; procedures:Map<string,CompiledProcedure>; declarations:Record<string,unknown>[]; diagnostics:Diagnostic[]; [key:string]:unknown}
export interface CompiledProject {name:string; startup:string; modules:Map<string,CompiledModule>; diagnostics:Diagnostic[]; valid:boolean; settings:Record<string,unknown>; sourceProject:SourceProject}
export interface PascalOptions {name?:string; moduleName?:string; units?:SourceModule[]; settings?:Record<string,unknown>; form?:FormModel|null; retainSyntax?:boolean}
export interface CompileOptions {project?:SourceProject; retainSyntax?:boolean; [key:string]:unknown}
export declare const PASCAL_VERSION:string;
export declare const PASCAL_DIALECT:'Turbo Pascal 7.0';
export declare const PASCAL_KEYWORDS:Set<string>;
export declare class PascalError extends Error {number:number; code:string; source:string; line:number; column:number; endLine:number; endColumn:number}
export declare function tokenizePascal(source:string,options?:{sourceName?:string; tolerant?:boolean; maxTokens?:number}):PascalTokens;
export declare function parsePascalModule(input:string|SourceModule,options?:CompileOptions):PascalModuleAst;
export declare function lowerPascalModule(input:string|SourceModule,options?:CompileOptions):Record<string,unknown>;
export declare function compilePascalModule(input:SourceModule,options?:CompileOptions):CompiledModule;
export declare function compileModule(input:SourceModule,options?:CompileOptions):CompiledModule;
export declare function compileProject(project:SourceProject,options?:CompileOptions):CompiledProject;
export declare function createPascalProject(source:string,options?:PascalOptions):SourceProject;
export declare function compilePascalSource(source:string,options?:PascalOptions):CompiledProject;
