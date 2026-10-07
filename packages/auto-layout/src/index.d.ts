export as namespace VB6AutoLayout;
/** Arbitrary finite logical units; child rectangles are parent-local. */
export interface Rect { x: number; y: number; width: number; height: number; }
export interface Size { width: number; height: number; x?: number; y?: number; }
export type Id = string | number;
export type Insets = number | [number] | [number, number] | [number, number, number, number] | { top?: number; right?: number; bottom?: number; left?: number; };
export type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type Justify = 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
export type SizeMode = 'fixed' | 'hug' | 'fill';
export type Track = number | 'hug' | 'auto' | `${number}fr` | {size: number | string; min?: number; max?: number};
export type Tracks = number | string | Track[];
export interface Limits { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; }
export interface LayoutSettings {
  layout?: number | keyof typeof LayoutMode; padding?: Insets; gap?: number; crossGap?: number; justify?: Justify;
  alignItems?: Align; alignContent?: Justify | 'stretch'; widthMode?: SizeMode; heightMode?: SizeMode;
  columns?: Tracks; rows?: Tracks;
}
export interface LayoutNode extends Limits, LayoutSettings {
  id: Id; parent?: Id | null; bounds?: Partial<Rect>; anchor?: number | string; dock?: number | keyof typeof DockStyle;
  baselineWidth?: number; baselineHeight?: number; margin?: Insets; grow?: number; shrink?: number; basis?: number;
  align?: Align; visible?: boolean; participate?: boolean; ignoreLayout?: boolean;
  preferredWidth?: number; preferredHeight?: number; baseline?: number;
  gridColumn?: number; gridRow?: number; columnSpan?: number; rowSpan?: number; justifySelf?: Exclude<Align,'baseline'>;
  /** Pure intrinsic callback. Called only for leaf Hug sizes. Never mutate the
   * engine or input graph from this callback. Cache expensive font/content work. */
  measure?: (constraint: {width:number;height:number;widthMode:SizeMode;heightMode:SizeMode}) => {width?:number;height?:number;baseline?:number};
}
export interface LayoutOptions extends LayoutSettings { width?: number; height?: number; }
/** Reused buffers; copy them to retain an old frame. */
export interface LayoutResult { rects: Float64Array; changed: Int32Array; changedCount: number; visited: number; revision: number; passes: number; }
export const AnchorStyles: Readonly<{ None:0; Top:1; Bottom:2; Left:4; Right:8; All:15 }>;
export const DockStyle: Readonly<{ None:0; Top:1; Bottom:2; Left:3; Right:4; Fill:5 }>;
export const LayoutMode: Readonly<{ Absolute:0; Horizontal:1; Vertical:2; Wrap:3; VerticalWrap:4; Grid:5 }>;
export function parseAnchor(value?: number | string): number;
export function formatAnchor(value: number | string): string;
export function parseDock(value?: number | string): number;
export function parseLayoutMode(value?: number | string): number;
export function solveAnchor(bounds: Partial<Rect>, baselineClient: Size, client: Size, anchor?: number | string, limits?: Limits, out?: Partial<Rect>): Rect;
export class LayoutEngine {
  constructor(nodes?: LayoutNode[], options?: LayoutOptions);
  readonly nodes: LayoutNode[]; readonly index: Map<Id,number>; readonly count:number; readonly rects:Float64Array; readonly revision:number;
  /** Atomic validation, O(n) topology compilation. */
  setNodes(nodes: LayoutNode[]): this;
  /** Property updates retain typed buffers; topology updates recompile. */
  update(id:Id,patch:Partial<LayoutNode>):this;
  configure(patch?:LayoutOptions):this;
  rebase(id:Id,bounds:Rect,client?:Size):this;
  getBounds(id:Id,out?:Partial<Rect>):Rect;
  getRootBounds(out?:Partial<Rect>):Rect;
  /** O(n) anchor pass and constant-time unchanged-root fast path. Capped flex
   * distribution O(n log n) worst case. Intrinsic wrapping uses bounded passes. */
  arrange(width?:number,height?:number):LayoutResult;
}
