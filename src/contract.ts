import type { MotionClip, PoseKeyFrame } from "./motion-clips.js";

export const CONTRACT_VERSION = "stickman.animation/v1" as const;
export const CONTRACT_VERSION_V2 = "stickman.animation/v2" as const;
export type ContractVersion = typeof CONTRACT_VERSION | typeof CONTRACT_VERSION_V2;

export type ActionName = string;
export type PlaybackMode = "normal" | "reduced" | "static";
export type RenderStyle = "default" | "blueprint";
export type ActorAccessory = "none" | "tie" | "hat" | "glasses" | "badge";
export type GazeTarget = "forward" | "down" | "up" | "target" | Point2D;

export type StageAnchorName =
  | "offstage-left"
  | "left"
  | "center-left"
  | "center"
  | "center-right"
  | "right"
  | "offstage-right"
  | "board"
  | "door-left"
  | "door-right"
  | "hoop"
  | "goal";

export interface Point2D {
  x: number;
  y: number;
}

export interface AnimationAction {
  action: ActionName;
  startMs: number;
  durationMs: number;
  target?: string;
  speed?: number;
  blendMs?: number;
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
  contractVersion: typeof CONTRACT_VERSION | typeof CONTRACT_VERSION_V2;
  spec: AnimationSpec | AnimationSpecV2;
  /** Timed motion markers for syncing host content (slides) to the figure. */
  events?: MarkerEvent[];
}

export interface MarkerEvent {
  timeMs: number;
  actionIndex: number;
  action: ActionName;
  marker: string;
  frame: number;
  actorId?: string;
}

export interface Segment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type AddonType =
  | "anger-mark"
  | "ball"
  | "banner"
  | "bar"
  | "basketball"
  | "bench"
  | "binoculars"
  | "board"
  | "box"
  | "bulb"
  | "cable"
  | "card"
  | "chair"
  | "coffee-mug"
  | "cone"
  | "crate"
  | "cursor"
  | "desk"
  | "detective-hat"
  | "door"
  | "football"
  | "glasses"
  | "glove"
  | "gloves"
  | "goal"
  | "headphones"
  | "hoop"
  | "hurdle"
  | "ladder"
  | "laptop"
  | "ledge"
  | "magnifier"
  | "mug"
  | "notebook"
  | "palm"
  | "pen"
  | "phone"
  | "platform"
  | "pointer"
  | "sand-pit"
  | "sand-puff"
  | "server"
  | "server-module"
  | "server-rack"
  | "sign"
  | "socket"
  | "spear"
  | "stairs"
  | "tablet"
  | "target"
  | "thought-cloud"
  | "thumb"
  | "wall"
  | "watch"
  | "window";

export type AddonSocket =
  | "rHand"
  | "lHand"
  | "bothHands"
  | "aboveHead"
  | "eyes"
  | "wrist"
  | "rFoot"
  | "lFoot"
  | "stage";

export type AddonEnterStyle = "pop" | "fade" | "slide" | "instant";
export type AddonExitStyle = "shrink" | "fade" | "tip" | "persist" | "instant";
export type AddonSlideDirection = "left" | "right" | "top" | "bottom";

export interface AddonFlightConfig {
  from: number;
  to: number;
  target?: string | Point2D;
  apex?: number;
  spin?: number;
  releaseOffset?: Point2D;
  dropToGroundAt?: number;
}

export interface AddonKeyframe {
  at: number;
  x?: number;
  y?: number;
  rotation?: number;
  scale?: number;
  opacity?: number;
  open?: number;
  ink?: number;
  netBulge?: number;
}

export interface AddonConfig {
  id?: string;
  type: AddonType;
  actorId?: string;
  socket?: AddonSocket;
  layer?: "back" | "front";
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  rotation?: number;
  scale?: number;
  opacity?: number;
  color?: string;
  secondaryColor?: string;
  text?: string;
  hinge?: "left" | "right";
  open?: number;
  ink?: number;
  netBulge?: number;
  enter?: AddonEnterStyle;
  enterAt?: number;
  enterDuration?: number;
  slideFrom?: AddonSlideDirection;
  exit?: AddonExitStyle;
  exitAt?: number;
  exitDuration?: number;
  persist?: boolean;
  attachWindow?: { from?: number; until?: number; pinOnRelease?: boolean; pinnedPoint?: Point2D };
  flight?: AddonFlightConfig;
  impact?: { at: number; duration?: number; peakBulge?: number };
  keyframes?: readonly AddonKeyframe[];
}

export interface SampledAddon {
  id: string;
  type: AddonType;
  actorId?: string;
  layer: "back" | "front";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  opacity: number;
  color: string;
  secondaryColor?: string;
  puff?: boolean;
  open?: number;
  hinge?: "left" | "right";
  flipX?: boolean;
  ink?: number;
  netBulge?: number;
  text?: string;
}

export interface SampledActorFrame {
  id: string;
  label?: string;
  action: ActionName | "idle";
  x: number;
  groundY: number;
  head: Point2D;
  segments: Segment[];
  facing?: number;
  gazeDir?: Point2D;
  articulated?: boolean;
  color: string;
  accessory?: ActorAccessory;
  accentColor?: string;
  scale: number;
  zIndex: number;
}

export interface SampledFrame {
  timeMs: number;
  action: ActionName | "idle";
  x: number;
  groundY: number;
  head: Point2D;
  segments: Segment[];
  prop: null | { id: string; x: number; y: number; width: number; height: number; handleX: number; handleY: number };
  facing?: number;
  gazeDir?: Point2D;
  /** Draw limbs through the actual knee/elbow (key-pose motions with deep bends). */
  articulated?: boolean;
  addons?: SampledAddon[];
  actors?: SampledActorFrame[];
}

export interface ChoreographTheme {
  accentColor?: string;
  background?: string;
  style?: RenderStyle;
}

export type ChoreographTargetInput = string | { x: number; y?: number };
export type ChoreographAddonItem = AddonType | Partial<AddonConfig>;
export type ChoreographAddonInput =
  | boolean
  | "auto"
  | "none"
  | ChoreographAddonItem
  | ReadonlyArray<ChoreographAddonItem>;

export interface StagePropSpec {
  id: string;
  type: AddonType;
  x?: number;
  y?: number;
  anchor?: string;
  width?: number;
  height?: number;
  facing?: "left" | "right";
  color?: string;
  text?: string;
  layer?: "back" | "front";
  scale?: number;
}

export interface HandoffSpec {
  actorId: string;
  propType?: AddonType;
  propId?: string;
  atProgress?: number;
}

export interface CustomMotionDraftSpec {
  id?: string;
  label?: string;
  frames: number;
  fps?: number;
  loop?: boolean;
  kind?: "oneshot" | "loop" | "hold";
  travel?: "in-place" | "travel";
  facingChange?: 0 | 90 | 180;
  prop?: string | null;
  aim?: "hand" | "head" | null;
  markers?: Record<string, number>;
  strideLength?: number;
  poseKeys: PoseKeyFrame[];
  [key: string]: unknown;
}

export type CustomMotionClipSpec = MotionClip | CustomMotionDraftSpec;

export interface ChoreographAction {
  action: ActionName;
  startMs?: number;
  durationMs?: number;
  delayMs?: number;
  from?: ChoreographTargetInput;
  to?: ChoreographTargetInput;
  target?: string;
  gaze?: GazeTarget;
  speed?: number;
  blendMs?: number;
  afterCue?: string;
  emitCue?: string;
  emitCueAt?: "start" | "end" | string;
  addon?: ChoreographAddonInput;
  persist?: boolean;
  handoffTo?: HandoffSpec;
  toGround?: boolean;
}

export interface ActorChoreographySpec {
  id: string;
  label?: string;
  x?: number | string;
  groundY?: number;
  color?: string;
  accessory?: ActorAccessory;
  accentColor?: string;
  scale?: number;
  zIndex?: number;
  facing?: -1 | 1 | "left" | "right";
  gaze?: GazeTarget;
  actions: ChoreographAction[];
}

export interface ChoreographActorInput {
  id?: string;
  label?: string;
  x?: number | string;
  groundY?: number;
  color?: string;
  accessory?: ActorAccessory;
  accentColor?: string;
  scale?: number;
  zIndex?: number;
  facing?: -1 | 1 | "left" | "right";
  gaze?: GazeTarget;
}

export interface ResolvedActorAction extends AnimationAction {
  from?: Point2D;
  to?: Point2D;
  gaze?: GazeTarget;
  afterCue?: string;
  emitCue?: string;
  emitCueAt?: "start" | "end" | string;
  addon?: ChoreographAddonInput;
  persist?: boolean;
  handoffTo?: HandoffSpec;
  toGround?: boolean;
}

export interface CompiledActorSpec {
  id: string;
  label?: string;
  x: number;
  groundY: number;
  color: string;
  accessory?: ActorAccessory;
  accentColor?: string;
  scale: number;
  zIndex: number;
  facing: -1 | 1;
  gaze?: GazeTarget;
  actions: ResolvedActorAction[];
}

export interface AnimationSpecV2 {
  version: typeof CONTRACT_VERSION_V2;
  canvas: { width: number; height: number; fps: number };
  durationMs: number;
  groundY?: number;
  theme?: ChoreographTheme;
  addons?: "auto" | "none";
  anchors?: Record<string, Point2D>;
  targets?: Record<string, Point2D>;
  actor?: {
    id?: string;
    label?: string;
    x?: number;
    groundY?: number;
    color?: string;
    accessory?: ActorAccessory;
    accentColor?: string;
    scale?: number;
    zIndex?: number;
    facing?: -1 | 1;
    gaze?: GazeTarget;
  };
  prop?: PropSpec;
  stageProps?: StagePropSpec[];
  customMotions?: Record<string, CustomMotionClipSpec>;
  actors: CompiledActorSpec[];
  actions: ResolvedActorAction[];
}

export interface ChoreographInput {
  version?: typeof CONTRACT_VERSION_V2;
  canvas?: { width?: number; height?: number; fps?: number };
  durationMs?: number;
  groundY?: number;
  theme?: ChoreographTheme;
  addons?: "auto" | "none";
  anchors?: Record<string, Point2D | { x: number; y?: number }>;
  targets?: Record<string, Point2D | { x: number; y?: number }>;
  stageProps?: StagePropSpec[];
  customMotions?: Record<string, CustomMotionClipSpec>;
  actors?: ActorChoreographySpec[];
  actor?: ChoreographActorInput;
  actions?: ChoreographAction[];
}

export interface ChoreographResult extends ValidationResult {
  spec?: AnimationSpecV2;
  program?: CompiledAnimation;
  anchors?: Record<string, Point2D>;
}

export interface CompileResult extends ValidationResult {
  program?: CompiledAnimation;
}
