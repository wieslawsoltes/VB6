export as namespace VB6AutoLayout;
/** Arbitrary, finite logical units. Root and child rectangles are parent-local. */
export interface Rect { x: number; y: number; width: number; height: number; }
export interface Size { width: number; height: number; x?: number; y?: number; }
export type Id = string | number;
export type Insets = number | [number] | [number, number] | [number, number, number, number] | { top?: number; right?: number; bottom?: number; left?: number; };
export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Justify = 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
export interface Limits { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; }
export interface LayoutNode extends Limits {
  id: Id; parent?: Id | null; bounds?: Partial<Rect>;
  anchor?: number | string; dock?: number | keyof typeof DockStyle; layout?: number | keyof typeof LayoutMode;
  baselineWidth?: number; baselineHeight?: number;
  padding?: Insets; margin?: Insets; gap?: number; grow?: number; shrink?: number; basis?: number;
  align?: Align; justify?: Justify; visible?: boolean; participate?: boolean;
}
export interface LayoutOptions { width?: number; height?: number; padding?: Insets; layout?: number | keyof typeof LayoutMode; gap?: number; justify?: Justify; }
/** Reused by the engine: copy buffers to retain a previous frame. */
export interface LayoutResult {
  rects: Float64Array; changed: Int32Array; changedCount: number; visited: number; revision: number;
}
export const AnchorStyles: Readonly<{ None: 0; Top: 1; Bottom: 2; Left: 4; Right: 8; All: 15 }>;
export const DockStyle: Readonly<{ None: 0; Top: 1; Bottom: 2; Left: 3; Right: 4; Fill: 5 }>;
export const LayoutMode: Readonly<{ Absolute: 0; Horizontal: 1; Vertical: 2; Wrap: 3 }>;
export function parseAnchor(value?: number | string): number;
export function formatAnchor(value: number | string): string;
export function parseDock(value?: number | string): number;
export function parseLayoutMode(value?: number | string): number;
export function solveAnchor(bounds: Partial<Rect>, baselineClient: Size, client: Size, anchor?: number | string, limits?: Limits, out?: Partial<Rect>): Rect;
export class LayoutEngine {
  constructor(nodes?: LayoutNode[], options?: LayoutOptions);
  readonly nodes: LayoutNode[];
  readonly index: Map<Id, number>;
  readonly count: number;
  readonly rects: Float64Array;
  readonly revision: number;
  /** Replace the graph and capture new baselines. Failed validation is atomic. */
  setNodes(nodes: LayoutNode[]): this;
  /** O(1) property validation/update; topology changes rebuild in O(n). */
  update(id: Id, patch: Partial<LayoutNode>): this;
  /** Root configuration does not reset child baselines. */
  configure(patch?: LayoutOptions): this;
  rebase(id: Id, bounds: Rect, client?: Size): this;
  getBounds(id: Id, out?: Partial<Rect>): Rect;
  /** O(n) anchors/docks, with a constant-time unchanged-root fast path. */
  arrange(width?: number, height?: number): LayoutResult;
}
