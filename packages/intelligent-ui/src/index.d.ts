export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface Diagnostic {code:string;message:string;offset?:number}
export interface CompiledUI {version:1;program:{children:Json[]};constants:Record<string,string>;diagnostics:Diagnostic[];recoveryDiagnostics:Diagnostic[];fallbackMarkdown:string;partial:boolean}
export interface UINode {id:string;type:string;props:Record<string,Json>;children:UINode[];text?:string}
export type UIOperation = {op:'create';id:string;type:string}|{op:'remove';id:string}|{op:'set';id:string;props:Record<string,Json>;text:string|null}|{op:'place';id:string;parent:string;index:number};
export interface UIActionContext {signal?:AbortSignal}
export interface UIAction {type:'message'|'copy'|'link'|'tool'|'context'|'entity';args:Json[]}
export interface UIResult {kind:string;version:number;operations:UIOperation[];tree:UINode[];diagnostics:Diagnostic[];recoveryDiagnostics:Diagnostic[];fallbackMarkdown:string;actions:UIAction[]}
export interface UIViewport {width:number;height:number}
export interface UIOptions {partial?:boolean;data?:Record<string,Json>;viewport?:UIViewport}
export interface UIPatch {constants?:Record<string,string>;data?:Record<string,Json>;partial?:boolean;viewport?:UIViewport}
export const BREAKPOINTS:Readonly<{sm:640;md:768;lg:1024;xl:1280}>;
export function normalizeViewport(value?:Partial<UIViewport>):UIViewport;
export type Catalog = Readonly<Record<string,Readonly<Record<string,string|readonly string[]>>>>;
export interface StateSnapshot {state:Record<string,Json>}
export class UIError extends Error {code:string;offset:number;constructor(code:string,message:string,offset?:number)}
export const LIMITS:Readonly<Record<string,number>>;
export function boundedData<T>(value:T,limit?:number,options?:{maxText?:number}):T;
export function safeUrl(value:string):string;
export function normalizeAction(action:unknown):UIAction;
export const CATALOG:Catalog;
export function createCatalog(extensions?:Record<string,Record<string,string|readonly string[]>>):Catalog;
export function catalogDescription(catalog?:Catalog):{name:string;properties:Catalog[string]}[];
export function compile(source:string,options?:{partial?:boolean;catalog?:Catalog}):CompiledUI;
export function classifyUpdate(previous:CompiledUI|null,next:CompiledUI):'program'|'constants'|'none';
export class StreamingCompiler {source:string;document:CompiledUI|null;revision:number;constructor(options?:{catalog?:Catalog});append(chunk:string):{kind:string;revision:number;document:CompiledUI};replace(source:string,partial?:boolean):ReturnType<StreamingCompiler['append']>;finish():ReturnType<StreamingCompiler['append']>}
export class UIRuntime {version:number;tree:UINode[];constructor(options?:{catalog?:Catalog});update(source:string,options?:UIOptions):UIResult;apply(document:CompiledUI,options?:UIOptions):UIResult;patch(patch:UIPatch,expectedVersion?:number):UIResult;resize(viewport:UIViewport,expectedVersion?:number):UIResult;dispatch(id:string,args?:Json[],expectedVersion?:number):UIResult;snapshot():StateSnapshot;restore(snapshot:StateSnapshot):void;dispose():void}
export function diffTrees(before:UINode[],after:UINode[]):UIOperation[];
export interface RenderFactoryResult {node:HTMLElement;childHost?:HTMLElement;update?:(props:Record<string,Json>,previous:Record<string,Json>)=>void;dispose?:()=>void}
export type RenderFactory = (context:{document:Document;id:string;onEvent:(event:string,args:Json[])=>void;onAction:(action:UIAction,context:UIActionContext)=>unknown})=>RenderFactoryResult;
export interface RendererOptions {onEvent?:(id:string,args:Json[])=>unknown;onAction?:(action:UIAction,context:UIActionContext)=>unknown;onError?:(error:Error)=>void;factories?:Record<string,RenderFactory>;allowResource?:(url:string)=>boolean}
export class DOMRenderer {constructor(root:HTMLElement,options?:RendererOptions);apply(operations:UIOperation[]):void;dispose():void}
export interface SurfaceOptions extends Pick<RendererOptions,'factories'|'allowResource'> {workerSource?:string;catalog?:Catalog;snapshot?:StateSnapshot;responsive?:boolean;onAction?:(action:UIAction,surface:UISurface,context:UIActionContext)=>unknown;onUpdate?:(result:UIResult,surface:UISurface)=>void;resolveReference?:(id:string|null,context:{type:string;query:string;signal:AbortSignal})=>UIReference|null|Promise<UIReference|null>;approveResource?:(url:string)=>boolean|Promise<boolean>;subscribeReferences?:(listener:(event:{id:string|null;revision:number})=>void)=>()=>void}
export class UISurface {root:HTMLElement;viewport:HTMLElement;client:UIClient;version:number;result?:UIResult;constructor(root:HTMLElement,options?:SurfaceOptions);update(source:string,options?:UIOptions):Promise<UIResult>;updateCompiled(document:CompiledUI,options?:UIOptions):Promise<UIResult>;setViewport(viewport:UIViewport):void;event(id:string,args:Json[]):Promise<UIResult|undefined>;snapshot():StateSnapshot;refreshReferences():void;restart():void;dispose():void}
export class UIClient {backend:'worker'|'bounded-main';constructor(options?:{workerSource?:string;window?:Window|object;timeout?:number;snapshot?:StateSnapshot;catalog?:Catalog});request(method:'update',payload:{source:string;options?:UIOptions}):Promise<UIResult>;request(method:'apply',payload:{document:CompiledUI;options?:UIOptions}):Promise<UIResult>;request(method:'patch',payload:{patch:UIPatch;version?:number}):Promise<UIResult>;request(method:'resize',payload:{viewport:UIViewport;version?:number}):Promise<UIResult>;request(method:'event',payload:{id:string;args?:Json[];version?:number}):Promise<UIResult>;snapshot():StateSnapshot;dispose():void}
export function startUIWorker(scope:{addEventListener(type:"message",listener:(event:{data:any})=>void):void;postMessage(message:unknown):void}):void;
export function splitUIMessage(text:string):({kind:'text';id:string;text:string}|{kind:'ui';id:string;source:string;partial:boolean})[];
export const MCP_UI_URI:string,MCP_UI_MIME:string,MCP_APP_VERSION:string;
export const MCP_UI_META:Readonly<object>,UI_TOOL_SCHEMAS:Readonly<Record<string,object>>,UI_TOOL_REQUIRED:Readonly<Record<string,string[]>>,UI_TOOL_DESCRIPTIONS:Readonly<Record<string,string>>;
export interface UIOwner {principal?:string;sessionKey?:string;signal?:AbortSignal}
export class McpUIService {constructor(options?:{onChange?:(event:{type:string;result:Json;owner:string})=>void;maxDocuments?:number;maxOwners?:number;resourceHtml?:string});capture(tool:string,result:Json,context:UIOwner):void;reference(id:string,context:UIOwner):UIReference|null;run(method:'catalog'|'present'|'update'|'read'|'list'|'close',args:Record<string,Json>,context:UIOwner):any;resources():object[];readResource(uri:string):object[];revoke(owner:string):void;clear():void;dispose():void}
export class McpAppClient {ready:boolean;context:Record<string,Json>;capabilities:Record<string,Json>;constructor(options?:{window?:Window;hostOrigin?:string;timeout?:number;onNotification?:(method:string,params:Record<string,Json>)=>unknown;onTeardown?:()=>void});connect():Promise<any>;request(method:string,params?:Record<string,Json>):Promise<any>;notify(method:string,params:Record<string,Json>):void;dispose():void}
export function startMcpApp(options?:{root?:HTMLElement}):{client:McpAppClient;surface:UISurface;ready:Promise<void>;dispose():void};

export interface AppCsp {connectDomains?:string[];resourceDomains?:string[];frameDomains?:string[];baseUriDomains?:string[]}
export interface UIReference {kind:'image'|'images'|'entity'|'citation';title?:string;src?:string;url?:string;details?:Json;items?:{src:string;alt?:string;title?:string;url?:string}[];provenance:{source:string;capturedAt?:string;revision?:number|null}}
export class UIReferenceStore {revision:number;constructor(options?:{maxEntries?:number;maxBytes?:number});put(id:string,value:UIReference):UIReference;get(id:string):UIReference|null;list():{id:string;kind:string;title:string;provenance:UIReference['provenance']}[];delete(id:string):boolean;clear():void;subscribe(listener:(change:{id:string|null;revision:number})=>void):()=>void;dispose():void}
export function validateReference(value:unknown):UIReference;
export function createReferenceFactories(options?:{resolveReference?:SurfaceOptions['resolveReference'];allowResource?:(url:string)=>boolean;approveResource?:(url:string)=>boolean|Promise<boolean>;onAction?:(action:UIAction,context:UIActionContext)=>unknown;subscribe?:SurfaceOptions['subscribeReferences']}):Record<string,RenderFactory>;
export function normalizeAppCsp(input?:AppCsp):Required<AppCsp>;
export function appProxyUrl(value:string,hostOrigin:string,csp?:AppCsp):URL;
export function sandboxCsp(input?:AppCsp,options?:{proxy?:boolean;parentOrigin?:string}):string;
export function startSandboxProxy(window?:Window):{dispose():void};
export interface AppHostOptions {proxyUrl:string;html:string;csp?:AppCsp;hostContext?:Record<string,Json>;tools?:{name:string;_meta?:{ui?:{visibility?:string[]}}}[];resourceUris?:string[];callTool?:(name:string,args:Record<string,Json>,context:{signal:AbortSignal})=>unknown;readResource?:(uri:string,context:{signal:AbortSignal})=>unknown;onMessage?:(message:Record<string,Json>,context:{signal:AbortSignal})=>unknown;onContext?:(context:Record<string,Json>,options:{signal:AbortSignal})=>unknown;openLink?:(url:string,context:{signal:AbortSignal})=>unknown;downloadFile?:(files:Record<string,Json>,context:{signal:AbortSignal})=>unknown;approve?:(action:{method:string;params:Record<string,Json>},context:{signal:AbortSignal})=>boolean|Promise<boolean>;onError?:(error:Error)=>void;timeout?:number}
export class McpAppHost {ready:boolean;frame:HTMLIFrameElement;constructor(root:HTMLElement,options:AppHostOptions);setToolInput(args:Record<string,Json>,options?:{partial?:boolean}):void;setToolResult(result:Record<string,Json>):void;updateHostContext(context:Record<string,Json>):void;listAppTools():Promise<unknown>;callAppTool(name:string,args?:Record<string,Json>):Promise<unknown>;cancel():void;teardown():Promise<void>;dispose():void}
export function appBlockDocument(html:string):string;
export function createAppBlockFactory(options?:{proxyUrl?:string|(()=>string);approveApp?:(app:{html:string;title:string;proxyUrl:string})=>boolean|Promise<boolean>;approveAction?:AppHostOptions['approve'];onAction?:(action:UIAction,context:UIActionContext)=>unknown;hostContext?:()=>Record<string,Json>;subscribeLifecycle?:(listener:()=>void)=>()=>void}):RenderFactory;
