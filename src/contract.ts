export const CONTRACT_VERSION = "stickman.animation/v1" as const;

export type ActionName = "walk" | "run" | "wave" | "point" | "jump" | "push";
export type PlaybackMode = "normal" | "reduced" | "static";

export interface Point2D {
  x: number;
  y: number;
}

export interface AnimationAction {
  action: ActionName;
  startMs: number;
  durationMs: number;
  target?: string;
}

export interface PropSpec {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  toX: number;
  handle: Point2D;
}

export interface AnimationSpec {
  version: typeof CONTRACT_VERSION;
  canvas: { width: number; height: number; fps: number };
  durationMs: number;
  actor?: { x?: number; groundY?: number; color?: string };
  targets?: Record<string, Point2D>;
  prop?: PropSpec;
  actions: AnimationAction[];
}

export interface Diagnostic {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export interface CompiledAnimation {
  contractVersion: typeof CONTRACT_VERSION;
  spec: AnimationSpec;
}

export interface Segment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SampledFrame {
  timeMs: number;
  action: ActionName | "idle";
  x: number;
  groundY: number;
  head: Point2D;
  segments: Segment[];
  prop: null | { id: string; x: number; y: number; width: number; height: number; handleX: number; handleY: number };
}

export interface CompileResult extends ValidationResult {
  program?: CompiledAnimation;
}
