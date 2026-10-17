/** All source offsets and zero-based positions count UTF-16 code units. */
export interface Position { line: number; character: number }
export interface Range { start: Position; end: Position }
export interface Span { start: number; end: number }
export interface TextEdit extends Span { text: string; range?: Range }
export interface Diagnostic extends Span { code: string; message: string; severity: 'error' | 'warning' | 'info'; range: Range; line: number; column: number; uri: string }
export interface ParseOptions { uri?: string; maxLength?: number; maxNodes?: number; maxDepth?: number; signal?: AbortSignal }
export interface QualifiedName { prefix: string; localName: string }
export interface AttributeSyntax extends Span, QualifiedName { kind: 'Attribute'; name: string; namespaceURI: string; nameStart: number; nameEnd: number; valueStart: number; valueEnd: number; quote: string; rawValue: string; value: string }
export interface ElementSyntax extends Span, QualifiedName {
  kind: 'Element'; name: string; namespaceURI: string; namespaces: Record<string,string>;
  nameStart: number; nameEnd: number; openEnd: number; closeStart: number;
  closeNameStart?: number; closeNameEnd?: number; selfClosing: boolean;
  attributes: AttributeSyntax[]; children: SyntaxNode[];
}
export interface TextSyntax extends Span { kind: 'Text' | 'Comment' | 'CData' | 'ProcessingInstruction'; value: string; contentStart?: number }
export type SyntaxNode = ElementSyntax | TextSyntax;
export interface SyntaxToken extends Span { kind: 'Type' | 'Property' | 'String' | 'Text' | 'Comment' | 'CData' | 'ProcessingInstruction' | 'Delimiter' | 'Invalid' }
export interface DocumentSyntax extends Span { kind: 'Document'; source: SourceText; children: SyntaxNode[]; elements: ElementSyntax[]; tokens: SyntaxToken[]; diagnostics: Diagnostic[]; root: ElementSyntax | null }
export interface MarkupLiteral extends Span { kind: 'Literal'; value: string; diagnostics?: Diagnostic[] }
export interface MarkupInvalid { kind: 'Invalid'; diagnostics?: Diagnostic[] }
export interface MarkupExtension extends Span, QualifiedName { kind: 'MarkupExtension'; name: string; arguments: Array<Span & { name: string | null; value: MarkupSyntax }>; diagnostics?: Diagnostic[] }
export type MarkupSyntax = MarkupLiteral | MarkupExtension | MarkupInvalid;
export const XAML_NS: string;
export const PRESENTATION_NS: string;
export const XML_NS: string;
export const XMLNS_NS: string;
export const MC_NS: string;
export const DESIGN_NS: string;
export class SourceText {
  constructor(text: string, uri?: string);
  text: string; uri: string; lineStarts: number[];
  positionAt(offset: number): Position;
  offsetAt(position: Position): number;
  range(start: number, end?: number): Range;
}
export function diagnostic(source: SourceText, code: string, message: string, start?: number, end?: number, severity?: Diagnostic['severity']): Diagnostic;
export function qualifiedName(name: string): QualifiedName;
export function isXmlName(name: string): boolean;
export function validXmlChar(codePoint: number): boolean;
export function xmlSpace(value: string): boolean;
export function decodeXml(value: string, report?: (code: string,message: string,start: number,end: number) => void, offset?: number, attribute?: boolean): string;
export function escapeXml(value: unknown, attribute?: boolean): string;
export function parseXaml(text: string, options?: ParseOptions): DocumentSyntax;
export function parseMarkupExtension(text: string, offset?: number): MarkupSyntax;
export function walkElements(document: DocumentSyntax, callback: (element: ElementSyntax) => void): void;
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string;

export interface TypeReference { namespaceURI: string; name: string }
export interface MemberDefinition {
  type?: string; kind?: 'property' | 'event'; values?: readonly string[]; collection?: boolean;
  dictionary?: boolean; itemType?: string; itemNamespaceURI?: string; attached?: boolean; nullable?: boolean;
  /** Canonical assignment identity for a host-defined member alias. Original spelling remains in IR. */
  aliasFor?: string;
  parameters?: readonly string[]; convert?: (value: unknown) => unknown;
}
export interface BoundMember extends MemberDefinition, TypeReference { owner: string }
export interface TypeDefinition {
  base?: string | TypeReference | null; members?: Record<string,string | MemberDefinition>;
  contentProperty?: string | null; runtimeNameProperty?: string | null;
  assignableTo?: TypeReference[]; primitive?: string; template?: boolean; dictionary?: boolean;
}
export interface XamlType extends TypeReference, Omit<TypeDefinition,'members'> { readonly members: Readonly<Record<string,Readonly<MemberDefinition>>> }
export class XamlSchemaContext {
  constructor();
  readonly types: Map<string,XamlType>; revision: number;
  readonly markupExtensionNamespaces: Set<string>;
  readonly themeResourceKeys: Set<string>;
  registerType(namespaceURI: string, name: string, definition?: TypeDefinition): XamlType;
  getType(namespaceURI: string, name: string): XamlType | undefined;
  resolveType(name: string, namespaces?: Record<string,string>): XamlType | undefined;
  baseType(type: XamlType): XamlType | null | undefined;
  members(type: XamlType): Record<string,Readonly<MemberDefinition>>;
  contentProperty(type: XamlType): string | null;
  runtimeNameProperty(type: XamlType): string | null;
  member(type: XamlType, name: string, namespaces?: Record<string,string>): BoundMember | null;
  isAssignable(type: XamlType | undefined, base: XamlType | undefined): boolean;
  listTypes(namespaceURI?: string): XamlType[];
}
export function safeMember(name: string): string;
export function createWinUISchema(): XamlSchemaContext;
export const MACOS26_NS: 'urn:vb6:macos26';
export const MACOS26_CONTROL_SIZES: readonly ['mini','small','regular','large','extraLarge'];
export const MACOS26_CONTROL_STYLES: readonly string[];
export const MACOS26_MATERIALS: readonly string[];
export const MACOS26_SEMANTIC_COLORS: readonly string[];
export const MACOS26_CONTROLS: Readonly<Record<string,Readonly<{presentationType: string; nativeType: string}>>>;
export function registerMacOS26Schema(schema: XamlSchemaContext): XamlSchemaContext;
export function createMacOS26Schema(): XamlSchemaContext;
export function convertValue(value: unknown, member?: MemberDefinition): unknown;

export type BindingExpression =
  | (Span & { kind: 'Root' })
  | (Span & { kind: 'Constant'; value: string | number | boolean | null })
  | (Span & { kind: 'Member'; name: string; target: BindingExpression })
  | (Span & { kind: 'Static'; name: string; target: BindingExpression })
  | (Span & { kind: 'Index'; key: string | number; target: BindingExpression })
  | (Span & { kind: 'Cast'; type: string; operand: BindingExpression })
  | (Span & { kind: 'Not'; operand: BindingExpression })
  | (Span & { kind: 'Call'; target: BindingExpression; arguments: BindingExpression[] });
export interface BindingOptions {
  read?: (target: unknown, key: string | number) => unknown;
  write?: (target: unknown, key: string | number, value: unknown) => void;
  resolveStatic?: (name: string) => unknown;
  cast?: (type: string, value: unknown) => unknown;
  invoke?: (fn: Function, owner: unknown, args: unknown[]) => unknown;
}
export function parseBindingPath(text: string, options?: { maxLength?: number; functions?: boolean }): BindingExpression;
export function evaluateBindingPath(expression: BindingExpression, root: unknown, options?: BindingOptions): unknown;
export function assignBindingPath(expression: BindingExpression, root: unknown, value: unknown, options?: BindingOptions): void;
export function bindingDependencies(expression: BindingExpression): BindingExpression[];

export interface LiteralValue { kind: 'Literal'; value: unknown; directives?: Record<string,unknown>; source?: Span }
export interface ResourceValue { kind: 'Resource'; key: string; theme: boolean; source: Span }
export interface CollectionValue { kind: 'Collection'; items: ConstructionValue[] }
export interface DictionaryValue { kind: 'Dictionary'; entries: Array<{key: string; value: ConstructionValue}> }
export interface RelativeSourceValue { kind: 'RelativeSource'; mode: string }
export interface BindingValue {
  kind: 'Binding'; compiled: boolean; template?: boolean; mode: string; path: string;
  expression: BindingExpression | null; arguments: Record<string,ConstructionValue>; source: Span;
}
export interface ObjectValue {
  kind: 'Object'; id: number; type: TypeReference; source: Span; scope: number;
  properties: Array<{member: BoundMember; value: ConstructionValue; source: Span; implicit: boolean}>;
  directives: Record<string,unknown>; name: string | null; template: boolean; dictionary: boolean; primitive: string | null;
}
export type ConstructionValue = LiteralValue | ObjectValue | ResourceValue | CollectionValue | DictionaryValue | RelativeSourceValue | BindingValue | {kind: 'Invalid'};
export interface XamlProgram { version: 1; root: ObjectValue }
export interface CompilerOptions extends ParseOptions { schema?: XamlSchemaContext }
export interface XamlSymbol extends Span { kind: 'name' | 'resource'; name: string; scope: number; nodeId?: number }
export interface Compilation {
  success: boolean; syntax: DocumentSyntax; diagnostics: Diagnostic[]; nodes: ObjectValue[];
  symbols: XamlSymbol[]; references: XamlSymbol[]; schema: XamlSchemaContext;
  root: ObjectValue | null; program: XamlProgram | null;
}
export function compileXaml(text: string | DocumentSyntax, options?: CompilerOptions): Compilation;
export function emitXamlModule(compilation: Compilation, options?: {runtimeModule?: string}): string;
export interface InstantiateOptions { resources?: Map<string,unknown> | Record<string,unknown>; signal?: AbortSignal; maxOperations?: number }
export interface HostContext<T> { root: T; names: Map<string,T>; resources: Map<string,unknown>[]; node: ObjectValue; readResource(key: string, theme?: boolean): unknown }
export interface XamlInstance<T> { root: T; names: Map<string,T>; scopes: Map<number,Map<string,T>>; dispose(): void }
export interface XamlHost<T = unknown> {
  create(type: TypeReference, context: {node: ObjectValue; names: Map<string,T>; resources: Map<string,unknown>[]}): T;
  set(target: T, member: BoundMember, value: unknown): void;
  add?(target: T, member: BoundMember, value: unknown): void;
  resource?(key: string, context: {theme: boolean; resources: Map<string,unknown>[]; root: T | undefined; names: Map<string,T>}): unknown;
  bind?(target: T, member: BoundMember, binding: BindingValue, context: HostContext<T>): void | (() => void);
  listen?(target: T, member: BoundMember, handler: ConstructionValue, context: HostContext<T>): void | (() => void);
  template?(node: ObjectValue, create: (options?: InstantiateOptions) => XamlInstance<T>): T;
  begin?(program: XamlProgram): void; commit?(root: T): void; rollback?(error: unknown): void; dispose?(target: T): void;
}
export interface InertXamlObject { type: TypeReference; properties: Record<string,unknown> }
export function instantiateXaml<T>(program: XamlProgram, host: XamlHost<T>, options?: InstantiateOptions): XamlInstance<T>;
export function createObjectHost(): XamlHost<InertXamlObject>;

export interface DocumentSnapshot { uri: string; text: string; version: number; source: SourceText; compilation: Compilation | null; schemaRevision: number }
export interface CompletionItem extends Span { label: string; kind: 'type' | 'property' | 'event' | 'value' | 'reference' | 'snippet'; detail: string; insertText: string; range: Range }
export interface SymbolLocation extends XamlSymbol { uri: string; range: Range; declaration?: boolean; encoded?: boolean }
export interface DocumentSymbol { name: string; detail: string; kind: 'property' | 'object'; range: Range; selectionRange: Range; children: DocumentSymbol[] }
export interface SemanticToken extends Position, Span { length: number; type: 'type' | 'property' | 'string' | 'comment' | 'keyword' | 'operator' }
export interface FormattingOptions { tabSize?: number; insertSpaces?: boolean; newline?: string }
export class XamlLanguageService {
  constructor(options?: CompilerOptions & {maxDocuments?: number});
  schema: XamlSchemaContext; documents: Map<string,DocumentSnapshot>;
  openDocument(uri: string, text: string, version?: number): DocumentSnapshot;
  changeDocument(uri: string, changes: Array<{text: string; range?: Range}>, version: number): DocumentSnapshot;
  closeDocument(uri: string): void; document(uri: string): DocumentSnapshot; analyze(uri: string): Compilation;
  diagnostics(uri: string): Diagnostic[];
  completion(uri: string, position: Position | number): CompletionItem[];
  hover(uri: string, position: Position | number): {contents: {kind: 'plaintext'; value: string}; range: Range} | null;
  references(uri: string, position: Position | number, includeDeclaration?: boolean): SymbolLocation[];
  definition(uri: string, position: Position | number): SymbolLocation[];
  rename(uri: string, position: Position | number, newName: string): {uri: string; version: number; edits: TextEdit[]; text: string};
  symbols(uri: string): DocumentSymbol[];
  foldingRanges(uri: string): Array<{startLine: number; endLine: number; kind: 'region' | 'comment'}>;
  semanticTokens(uri: string): SemanticToken[];
  format(uri: string, options?: FormattingOptions): TextEdit[];
}
export function formatXaml(text: string, options?: FormattingOptions): string;
