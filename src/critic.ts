import {
  CONTRACT_VERSION_V2,
  type AddonType,
  type AnimationSpec,
  type AnimationSpecV2,
  type BackdropPreset,
  type CompiledAnimation,
  type CompiledMovie,
  type CompiledMovieScene,
  type PlaybackMode,
  type SampledActorFrame,
  type SampledAddon,
  type SampledCallout,
  type SampledFrame,
  type SampledMovieFrame,
  type SceneTransitionKind
} from "./contract.js";
import { cameraFrustum, cameraSvgTransform, HERO_BEAT_ACTIONS, resolveCueTimeMs } from "./camera.js";
import { resolveCompiledCallouts } from "./callouts.js";
import { ENTRANCE_EXIT_ACTIONS } from "./choreograph.js";
import { sampleAnimation } from "./compiler.js";
import { isCompiledMovie, renderBackdropSvg, sampleMovie } from "./movie.js";
import { ASYMMETRIC_FLIP_TYPES, escapeXml, renderBlueprintPatternsSvg } from "./props.js";
import {
  actorToSampledFrame,
  frameGeometry,
  renderActorHandGlyphsSvg,
  renderSceneInnerSvg,
  resolveHandGlyphKind
} from "./render.js";
import {
  analyzeStoryboard,
  rasterizeStoryboardPng,
  type RasterizeStoryboardOptions,
  type StoryboardTheme
} from "./storyboard.js";

export type CritiqueDimensionKey =
  | "propIntegrity"
  | "spatialContinuity"
  | "stagingAndEyeTrace"
  | "pacingAndReadability"
  | "kinematicAppeal"
  | "cinematography";

export type CritiqueSeverity = "error" | "warning" | "info";

export type CritiqueGrade = "excellent" | "good" | "needs-polish" | "poor";

export interface CritiqueIssue {
  code: string;
  dimension: CritiqueDimensionKey;
  severity: CritiqueSeverity;
  timeMs: number;
  sceneId?: string;
  actorId?: string;
  message: string;
  suggestedPatch?: Record<string, unknown>;
}

export type CritiqueDimensionScores = Record<CritiqueDimensionKey, number>;

export interface CritiqueMetrics {
  deadAirMs: number;
  outOfBoundsCount: number;
  maxSeamStepPx: number;
  maxGravityDropPx: number;
  clutterDurationMs: number;
  calloutCollisionCount: number;
  giantsVsToddlersDetected: boolean;
  minStrokeHeadRatio: number;
  maxStrokeHeadRatio: number;
  sceneCount: number;
}

export interface CritiqueReport {
  version: "1.0.0";
  overallScore: number;
  grade: CritiqueGrade;
  passed: boolean;
  dimensions: CritiqueDimensionScores;
  weights: Readonly<Record<CritiqueDimensionKey, number>>;
  metrics: CritiqueMetrics;
  issues: CritiqueIssue[];
  suggestions: string[];
  sampledTimestampsMs: number[];
}

export interface EvaluateAnimationQualityOptions {
  sampleStepMs?: number;
}

export interface CritiqueSheetOptions {
  maxPanels?: number;
  columns?: number;
  panelWidth?: number;
  title?: string;
  theme?: StoryboardTheme;
  mode?: PlaybackMode;
}

export interface CritiqueAnimationOptions extends CritiqueSheetOptions {
  includePng?: boolean;
  loadResvg?: RasterizeStoryboardOptions["loadResvg"];
}

export interface RubricDimensionSpec {
  readonly key: CritiqueDimensionKey;
  readonly label: string;
  readonly weight: number;
  readonly description: string;
  readonly anchors: Readonly<{
    "9-10": string;
    "7-8": string;
    "4-6": string;
    "1-3": string;
  }>;
  readonly checks: readonly string[];
}

export interface HumanCritiqueRubric {
  readonly version: "1.0.0";
  readonly passThresholds: Readonly<{ overallScore: number; minDimension: number }>;
  readonly grades: Readonly<{ excellent: number; good: number; needsPolish: number; poor: number }>;
  readonly dimensions: readonly RubricDimensionSpec[];
  readonly vlmSelfCritiqueChecklist: readonly string[];
}

export interface CritiqueAnimationResult {
  report: CritiqueReport;
  svg: string;
  rubric: HumanCritiqueRubric;
  pngBase64?: string;
  rasterizerAvailable: boolean;
}

export const CRITIQUE_DIMENSION_WEIGHTS: Readonly<Record<CritiqueDimensionKey, number>> = Object.freeze({
  propIntegrity: 0.22,
  spatialContinuity: 0.2,
  stagingAndEyeTrace: 0.18,
  pacingAndReadability: 0.14,
  kinematicAppeal: 0.14,
  cinematography: 0.12
});

export const HUMAN_CRITIQUE_RUBRIC: HumanCritiqueRubric = Object.freeze({
  version: "1.0.0",
  passThresholds: Object.freeze({ overallScore: 8.0, minDimension: 7.0 }),
  grades: Object.freeze({ excellent: 8.8, good: 8.0, needsPolish: 6.5, poor: 0 }),
  dimensions: Object.freeze([
    Object.freeze({
      key: "propIntegrity" as const,
      label: "Prop Integrity & Physical Interaction",
      weight: 0.22,
      description:
        "Evaluates whether asymmetric props match actor facing, avoid body-through-prop impalement, maintain hand/foot contact, and hand off continuously without morphing.",
      anchors: Object.freeze({
        "9-10": "All asymmetric props face naturally with actors; zero impalement; crisp hand/prop contact and seamless handoffs.",
        "7-8": "Props read cleanly overall with at most minor contact spacing drift on secondary beats.",
        "4-6": "Noticeable prop facing inversion, awkward contact gaps (>22px), or uncoordinated hand-over/catch prop swaps.",
        "1-3": "Severe physical breaks: seated torso impaled by chair backrest, ball clipping through backboard, or backwards props."
      }),
      checks: Object.freeze([
        "Asymmetric props (chair, desk, laptop, door, goal, hoop, stairs) mirror with flipX when actor faces left",
        "No body-through-chair backrest impalement or basketball clipping behind backboard",
        "Hand-held props stay within 22px of active hands during sustained contact",
        "hand-over / catch pairs coordinate via handoffTo or cue-linked prop continuity"
      ])
    }),
    Object.freeze({
      key: "spatialContinuity" as const,
      label: "Spatial Continuity & Grounding",
      weight: 0.2,
      description:
        "Evaluates clip-to-clip grounding, vertical elevation continuity, smooth inter-clip blends, and strict stage containment for actors, props, and callouts.",
      anchors: Object.freeze({
        "9-10": "Zero out-of-bounds actors/props/callouts, grounded feet, smooth C1 seams (<= 6px), and zero teleport drops.",
        "7-8": "Contained within stage with slight seam step (6-14px) on fast transitions.",
        "4-6": "Visible edge clipping on props/callouts or sudden vertical elevation drops (>12px) between actions.",
        "1-3": "Repeated off-canvas clipping, severe foot/pelvis teleport drops, or jarring inter-clip snaps."
      }),
      checks: Object.freeze([
        "Zero vertical elevation drops > 12px between consecutive clips on an actor",
        "Zero out-of-bounds actors, props, or callouts across single scenes and multi-scene movies",
        "Inter-clip seam joint steps remain <= 6px via C1 blending"
      ])
    }),
    Object.freeze({
      key: "stagingAndEyeTrace" as const,
      label: "Staging, Depth & Eye Trace",
      weight: 0.18,
      description:
        "Evaluates clear focal hierarchy, coherent perspective scaling via depth, non-overlapping silhouettes, and collision-free callout typography.",
      anchors: Object.freeze({
        "9-10": "Instant eye trace to focal beat; consistent depth/scale perspective; clean actor separation and zero callout overlaps.",
        "7-8": "Readable ensemble with minor crowding or tight spacing during brief transitions.",
        "4-6": "Competing simultaneous actions without spotlight/camera guidance, sustained actor overlap, or colliding bubbles.",
        "1-3": "Giants-vs-toddlers scale mismatch on a flat floor, chaotic multi-actor clutter, or occluded heads/bubbles."
      }),
      checks: Object.freeze([
        "No giants-vs-toddlers scale mismatch (|scaleA - scaleB| >= 0.2 on same groundY without depth)",
        "No unfocused multi-actor clutter (>= 3 simultaneously active actors with spotlight off and zoom <= 1.05)",
        "No sustained actor-on-actor overlap (< 24px for >= 500ms)",
        "Zero callout-on-callout or callout-on-head collisions"
      ])
    }),
    Object.freeze({
      key: "pacingAndReadability" as const,
      label: "Pacing & Callout Readability",
      weight: 0.14,
      description:
        "Evaluates rhythmic momentum without long dead-air idle tails, comfortable callout reading windows, and avoidance of excessive frozen holds.",
      anchors: Object.freeze({
        "9-10": "Crisp beat cadence, zero dead-air tails > 1.8s, all callouts held >= 900ms at <= 12 words/sec, lively motion.",
        "7-8": "Well-paced overall with one brief quiet beat or slightly dense caption.",
        "4-6": "Dragging dead-air idle stretch (>1.8s), rushed speech/badge flashes (<900ms), or mostly static scene (>70% frozen).",
        "1-3": "Long lifeless dead-air tails, unreadable rapid-fire callouts, or frozen tableaux."
      }),
      checks: Object.freeze([
        "No dead-air stretches > 1.8s where all actors idle without callouts or camera movement",
        "No rushed callouts (< 900ms duration or > 12 words/sec reading speed)",
        "Avoids VBench-style static holds where > 70% of scene stays frozen"
      ])
    }),
    Object.freeze({
      key: "kinematicAppeal" as const,
      label: "Kinematic Appeal & Expressive Rig",
      weight: 0.14,
      description:
        "Evaluates organic Bezier spine curvature, intentional gaze direction toward active targets/props, expressive hand glyphs, and crisp stroke-to-head balance.",
      anchors: Object.freeze({
        "9-10": "Supple curved-spine silhouette, purposeful gaze alignment, crisp hand glyphs on gestures, stroke/head <= 0.28.",
        "7-8": "Expressive silhouettes with minor gaze drift or sparse gesture punctuation.",
        "4-6": "Overly chunky stroke-to-head proportions (>0.28) at small scale, rigid spines, or misaligned gaze.",
        "1-3": "Broken rig proportions, missing expressive hand cues, or inverted gaze away from active props."
      }),
      checks: Object.freeze([
        "Curved quadratic Bezier torso spine engaged in frameGeometry",
        "Gaze direction aligned toward active targets, desks, and interaction props",
        "Expressive hand glyphs present on thumbs-up, point, wave, idea, hold-sign, and grip beats",
        "Stroke-to-head radius ratio remains <= 0.28 across actor scales"
      ])
    }),
    Object.freeze({
      key: "cinematography" as const,
      label: "Cinematography & Composition",
      weight: 0.12,
      description:
        "Evaluates stage utilization, camera frustum containment, balanced rule-of-thirds framing, smooth non-cut camera velocity, and multi-scene backdrop/transition craft.",
      anchors: Object.freeze({
        "9-10": "Intentional framing with auto-director or smooth keyframes, balanced stage coverage, contextual backdrops & transitions.",
        "7-8": "Clean readable composition with mild static framing opportunity or subtle margin imbalance.",
        "4-6": "Underutilized corner-clustered stage (<15% coverage), abrupt whip-pan velocity spikes, or unguided multi-actor wide shot.",
        "1-3": "Focal subject cropped outside camera frustum or chaotic camera motion."
      }),
      checks: Object.freeze([
        "Stage framing avoids tiny (<15%) corner-clustered action on an empty canvas",
        "Focal actors stay inside the active camera frustum",
        "Balanced / rule-of-thirds composition without edge cramming",
        "Smooth camera velocity on non-cut segments without whip-pan spikes",
        "Contextual backdrops and purposeful transitions on multi-scene movies"
      ])
    })
  ]),
  vlmSelfCritiqueChecklist: Object.freeze([
    "Check every asymmetric prop (chair, desk, laptop, door, hoop, goal, stairs): does it face the interacting actor naturally without crossing through their torso or limbs?",
    "Check seated and athletic panels: is the chair backrest behind the actor's spine and does the basketball arc in front of the backboard into the rim?",
    "Check multi-actor scale and ground plane: are smaller actors placed higher on the ground plane via depth, or do giants and toddlers share a flat floor?",
    "Check eye trace at peak action: can your eye find the focal speaker/action within 0.5 seconds, or are 3+ actors competing without spotlight or camera zoom?",
    "Check callouts and captions: are all bubbles completely inside the frame, readable, and clear of actor heads and neighboring bubbles?",
    "Check pacing across panels: do consecutive panels show meaningful story progression rather than repeated static idle holds or dead-air tails?",
    "Check final framing and transitions: does the camera frame subjects with balanced breathing room and clean backdrop/transition continuity?"
  ])
});

const PASSIVE_ACTIONS = new Set<string>(["idle", "seated-idle", "static-pose", "hold-pose"]);
const SEATED_ACTIONS = new Set<string>([
  "sit-down",
  "seated-idle",
  "type-at-desk",
  "open-laptop",
  "video-call",
  "frustrated-pc",
  "stand-up"
]);
const STRICT_SEATED_ACTIONS = new Set<string>(["seated-idle", "type-at-desk", "video-call", "frustrated-pc"]);
const HAND_HELD_CONTACT_PROPS = new Set<AddonType>([
  "pen",
  "pointer",
  "phone",
  "tablet",
  "magnifier",
  "coffee-mug",
  "mug",
  "sign",
  "card",
  "cable",
  "watch",
  "gloves",
  "glove",
  "notebook"
]);
const INTERACTION_GAZE_ACTIONS = new Set<string>([
  "type-at-desk",
  "open-laptop",
  "write-board",
  "write-notes",
  "tablet-tap",
  "plug-cable",
  "rack-server",
  "point",
  "inspect-magnifier",
  "hand-over",
  "catch"
]);
const EXPRESSIVE_GLYPH_CHECK_ACTIONS = new Set<string>([
  "thumbs-up",
  "point",
  "wave",
  "idea",
  "hold-sign",
  "present",
  "reveal",
  "cheer",
  "surprised",
  "beckon",
  "shrug",
  "stop-hand"
]);
const PROP_CONTACT_BEAT_ACTIONS = new Set<string>([
  "hand-over",
  "catch",
  "plug-cable",
  "write-board",
  "basketball-shot",
  "kick-ball",
  "open-door",
  "open-laptop",
  "present-card",
  "hold-sign",
  "rack-server"
]);
const ENTRANCE_EXIT_SET = new Set<string>(ENTRANCE_EXIT_ACTIONS);

interface SceneSlice {
  sceneId?: string;
  sceneIndex: number;
  sceneTitle?: string;
  caption?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  backdrop: BackdropPreset;
  transitionKind: SceneTransitionKind;
  program: CompiledAnimation;
}

interface Box2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  const r = Math.round(value * 10) / 10;
  return Math.abs(r) < 1e-6 ? 0 : r;
}

function round3(value: number): number {
  const r = Math.round(value * 1000) / 1000;
  return Math.abs(r) < 1e-6 ? 0 : r;
}

function num(value: number, decimals = 1): string {
  const factor = 10 ** decimals;
  const r = Math.round(value * factor) / factor;
  return (Math.abs(r) < 1e-6 ? 0 : r).toString();
}

function boxesIntersect(a: Box2D, b: Box2D, eps = 0.5): boolean {
  return (
    a.x < b.x + b.width - eps &&
    a.x + a.width > b.x + eps &&
    a.y < b.y + b.height - eps &&
    a.y + a.height > b.y + eps
  );
}

function pointToBoxDistance(px: number, py: number, box: Box2D): number {
  const dx = px < box.x ? box.x - px : px > box.x + box.width ? px - (box.x + box.width) : 0;
  const dy = py < box.y ? box.y - py : py > box.y + box.height ? py - (box.y + box.height) : 0;
  return Math.hypot(dx, dy);
}

function circleIntersectsBox(cx: number, cy: number, r: number, box: Box2D): boolean {
  return pointToBoxDistance(cx, cy, box) < Math.max(1, r - 1);
}

function actorsFromFrame(frame: SampledFrame, defaultColor: string): SampledActorFrame[] {
  if (frame.actors && frame.actors.length > 0) return frame.actors;
  return [
    {
      id: "actor",
      action: frame.action,
      x: frame.x,
      groundY: frame.groundY,
      head: frame.head,
      segments: frame.segments,
      ...(frame.facing !== undefined ? { facing: frame.facing } : {}),
      ...(frame.gazeDir !== undefined ? { gazeDir: frame.gazeDir } : {}),
      ...(frame.articulated ? { articulated: true } : {}),
      color: defaultColor,
      scale: 1,
      zIndex: 0
    }
  ];
}

function maxActorDisplacement(
  prevActors: readonly SampledActorFrame[],
  nextActors: readonly SampledActorFrame[]
): number {
  let maxDist = 0;
  for (const b of nextActors) {
    const a = prevActors.find((item) => item.id === b.id);
    if (!a) continue;
    const headD = Math.hypot(b.head.x - a.head.x, b.head.y - a.head.y);
    if (headD > maxDist) maxDist = headD;
    const len = Math.min(a.segments.length, b.segments.length);
    for (let i = 0; i < len; i++) {
      const sa = a.segments[i]!;
      const sb = b.segments[i]!;
      const d1 = Math.hypot(sb.x1 - sa.x1, sb.y1 - sa.y1);
      const d2 = Math.hypot(sb.x2 - sa.x2, sb.y2 - sa.y2);
      if (d1 > maxDist) maxDist = d1;
      if (d2 > maxDist) maxDist = d2;
    }
  }
  return maxDist;
}

function toSceneSlices(programOrMovie: CompiledAnimation | CompiledMovie): {
  isMovie: boolean;
  canvas: { width: number; height: number; fps: number };
  durationMs: number;
  title?: string;
  slices: SceneSlice[];
  movie?: CompiledMovie;
} {
  if (isCompiledMovie(programOrMovie)) {
    return {
      isMovie: true,
      canvas: programOrMovie.spec.canvas,
      durationMs: programOrMovie.durationMs,
      ...(programOrMovie.spec.title !== undefined ? { title: programOrMovie.spec.title } : {}),
      slices: programOrMovie.scenes.map((s: CompiledMovieScene) => ({
        sceneId: s.id,
        sceneIndex: s.index,
        ...(s.title !== undefined ? { sceneTitle: s.title } : {}),
        ...(s.caption !== undefined ? { caption: s.caption } : {}),
        startMs: s.startMs,
        endMs: s.endMs,
        durationMs: s.durationMs,
        backdrop: s.backdrop,
        transitionKind: s.transition.kind,
        program: s.program
      })),
      movie: programOrMovie
    };
  }
  return {
    isMovie: false,
    canvas: programOrMovie.spec.canvas,
    durationMs: programOrMovie.spec.durationMs,
    slices: [
      {
        sceneIndex: 0,
        startMs: 0,
        endMs: programOrMovie.spec.durationMs,
        durationMs: programOrMovie.spec.durationMs,
        backdrop: "none",
        transitionKind: "cut",
        program: programOrMovie
      }
    ]
  };
}

function collectSceneLocalTimestamps(program: CompiledAnimation, stepMs: number): {
  regularTimes: number[];
  allTimes: number[];
  boundaries: number[];
} {
  const durationMs = program.spec.durationMs;
  const regularTimes: number[] = [];
  for (let t = 0; t <= durationMs; t += stepMs) {
    regularTimes.push(t);
  }
  if (regularTimes.length === 0 || regularTimes[regularTimes.length - 1] !== durationMs) {
    regularTimes.push(durationMs);
  }

  const allSet = new Set<number>(regularTimes);
  const boundarySet = new Set<number>();

  const addTime = (raw: number): void => {
    if (!Number.isFinite(raw)) return;
    allSet.add(clamp(Math.round(raw), 0, durationMs));
  };

  for (const ev of program.events ?? []) {
    addTime(ev.timeMs);
  }

  if (program.contractVersion === CONTRACT_VERSION_V2) {
    const v2 = program.spec as AnimationSpecV2;
    for (const actor of v2.actors) {
      for (const act of actor.actions) {
        addTime(act.startMs);
        addTime(act.startMs + act.durationMs * 0.5);
        addTime(act.startMs + act.durationMs);
        if (act.startMs > 0 && act.startMs < durationMs) boundarySet.add(act.startMs);
        const endMs = act.startMs + act.durationMs;
        if (endMs > 0 && endMs < durationMs) boundarySet.add(endMs);
      }
    }
    for (const callout of resolveCompiledCallouts(program)) {
      addTime(callout.startMs);
      addTime((callout.startMs + callout.endMs) / 2);
      addTime(callout.endMs);
    }
  } else {
    const v1 = program.spec as AnimationSpec;
    for (const act of v1.actions) {
      addTime(act.startMs);
      addTime(act.startMs + act.durationMs * 0.5);
      addTime(act.startMs + act.durationMs);
      if (act.startMs > 0 && act.startMs < durationMs) boundarySet.add(act.startMs);
      const endMs = act.startMs + act.durationMs;
      if (endMs > 0 && endMs < durationMs) boundarySet.add(endMs);
    }
  }

  return {
    regularTimes,
    allTimes: [...allSet].sort((a, b) => a - b),
    boundaries: [...boundarySet].sort((a, b) => a - b)
  };
}

function getCameraCutTimesMs(program: CompiledAnimation): number[] {
  if (program.contractVersion !== CONTRACT_VERSION_V2) return [];
  const v2 = program.spec as AnimationSpecV2;
  if (!Array.isArray(v2.camera)) return [];
  const cuts: number[] = [];
  for (const kf of v2.camera) {
    if (kf.ease !== "cut") continue;
    if (typeof kf.timeMs === "number" && Number.isFinite(kf.timeMs)) {
      cuts.push(clamp(kf.timeMs, 0, v2.durationMs));
    } else if (typeof kf.atCue === "string" && kf.atCue.trim()) {
      const resolved = resolveCueTimeMs(program, kf.atCue.trim());
      if (resolved !== undefined) cuts.push(resolved);
    }
  }
  return cuts;
}

function isActionPropEnteringOrExiting(
  v2: AnimationSpecV2 | undefined,
  actorId: string,
  localTimeMs: number
): boolean {
  if (!v2) return false;
  const actor = v2.actors.find((a) => a.id === actorId);
  if (!actor) return false;
  for (const act of actor.actions) {
    if (localTimeMs >= act.startMs && localTimeMs <= act.startMs + act.durationMs) {
      const p = act.durationMs > 0 ? (localTimeMs - act.startMs) / act.durationMs : 0.5;
      if (p < 0.14 || p > 0.86) return true;
      if (act.action === "hand-over" || act.action === "catch" || act.action === "throw" || act.action === "throw-ball") {
        return true;
      }
      return false;
    }
  }
  return true;
}

function buildEngineSuggestions(issues: readonly CritiqueIssue[], isMovie: boolean): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];
  const add = (text: string): void => {
    if (!seen.has(text)) {
      seen.add(text);
      suggestions.push(text);
    }
  };

  for (const issue of issues) {
    switch (issue.code) {
      case "giants_vs_toddlers":
        add(
          "Use actor `depth` (0.0 foreground to 1.0 background) instead of raw differing `scale` on a flat `groundY` so perspective height and size stay coherent."
        );
        break;
      case "unfocused_multi_actor_clutter":
        add(
          'Enable `spotlight: "auto"` and `camera: "auto-director"` (or stagger actions with `emitCue` / `afterCue`) so <= 2 actors compete for attention at once.'
        );
        break;
      case "dead_air_idle":
        add(
          isMovie
            ? "Enable `trimIdleTails: true` on `stickman_movie` (or shorten trailing `idle` durations) so scenes end within 0.4s-0.6s after the final beat."
            : "Trim trailing `idle` durations or tighten `durationMs` (or compose via `stickman_movie` with `trimIdleTails: true`) to eliminate dead air > 1.8s."
        );
        break;
      case "rushed_callout":
        add(
          "Set callout `durationMs >= 1200` (minimum 900ms) and keep copy concise (<= 12 words/sec) so viewers can read speech bubbles and status badges comfortably."
        );
        break;
      case "static_hold_excessive":
        add(
          'Add expressive beat actions (`present`, `point`, `idea`, `nod`) or `camera: "auto-director"` so less than 70% of the scene stays visually frozen.'
        );
        break;
      case "asymmetric_prop_facing_mismatch":
        add(
          'Align asymmetric `stageProps` (`chair`, `desk`, `laptop`, `door`, `goal`, `hoop`, `stairs`) with `facing: "left"` when actors face left, or let `addons: "auto"` auto-mirror.'
        );
        break;
      case "prop_impalement_chair":
        add(
          'Keep seated `chair` props on `layer: "back"` and mirrored with the actor facing so the backrest stays behind the seated spine.'
        );
        break;
      case "prop_impalement_hoop":
        add(
          "Ensure the `hoop` prop faces the shooter (`facing` aligned toward actor) so the basketball arcs into the rim from the front of the backboard."
        );
        break;
      case "prop_contact_gap":
        add(
          'Use default socketed props (`addons: "auto"`) or align custom prop offsets closer to actor hands so held objects stay within 22px of the grip.'
        );
        break;
      case "uncoordinated_prop_handoff":
        add(
          'Coordinate `hand-over` and `catch` with `handoffTo: { actorId, propType }` and `emitCue` / `afterCue` so a single shared prop transfers seamlessly.'
        );
        break;
      case "vertical_elevation_drop":
        add(
          "Set `toGround: true` and `blendMs: 220` on transitions from elevated or crouched clips to eliminate abrupt vertical drops > 12px."
        );
        break;
      case "inter_clip_seam_jump":
        add(
          "Increase `blendMs` (e.g. `200`-`260`) or insert a bridge transition between dissimilar consecutive clips to keep seam joint steps <= 6px."
        );
        break;
      case "actor_out_of_bounds":
      case "addon_out_of_bounds":
      case "callout_out_of_bounds":
        add(
          "Anchor actors on named stage datums (`left`, `center-left`, `center`, `center-right`, `right`) and keep props/callouts inside the canvas bounds."
        );
        break;
      case "actor_overlap":
        add(
          "Separate simultaneous onstage actors by at least 24px horizontally (use distinct named anchors like `left`, `center`, `right`) to keep silhouettes distinct."
        );
        break;
      case "callout_overlap":
      case "callout_head_collision":
        add(
          "Stagger concurrent `say`/`think`/`badge` callouts via `emitCue`/`afterCue` or shorten bubble text so callouts never collide with each other or actor heads."
        );
        break;
      case "chunky_stroke_head_ratio":
        add(
          "Keep actor `scale >= 0.45` (or use `camera: \"auto-director\"` zoom instead of tiny actors) so `strokeWidth / headRadius` stays <= 0.28."
        );
        break;
      case "gaze_target_misalignment":
        add(
          'Set `gaze: "target"` (or explicit `{ x, y }` coordinates) on interaction actions so actors look toward their active prop or partner.'
        );
        break;
      case "underutilized_stage_framing":
      case "static_camera_opportunity":
      case "unbalanced_composition":
      case "subject_outside_camera_frustum":
      case "abrupt_camera_whip_pan":
        add(
          'Use `camera: "auto-director"` (or smooth `ease: "inOut"` camera keyframes with `followActor` and `thirds-left`/`thirds-right` framing) for balanced, steady composition.'
        );
        break;
      case "missing_scene_backdrops":
        add(
          'Assign contextual scene `backdrop` presets (`"office"`, `"datacenter"`, `"war-room"`, `"classroom"`, `"court"`, `"outdoor"`) in `stickman_movie` to ground each beat.'
        );
        break;
      case "all_hard_cut_transitions":
        add(
          'Mix intentional `"fade"` or `"wipe"` transitions between story acts in `stickman_movie` to reinforce temporal or location shifts.'
        );
        break;
      case "cognitive_overload_pacing":
        add(
          'Stagger ensemble actions into sequential beats with `emitCue` / `afterCue` and `spotlight: "auto"` instead of animating 4+ actors simultaneously.'
        );
        break;
      default:
        break;
    }
  }

  return suggestions;
}

export function evaluateAnimationQuality(
  programOrMovie: CompiledAnimation | CompiledMovie,
  options: EvaluateAnimationQualityOptions = {}
): CritiqueReport {
  const stepMs = clamp(Math.round(options.sampleStepMs ?? 100), 40, 250);
  const normalized = toSceneSlices(programOrMovie);
  const { isMovie, canvas, slices } = normalized;
  const issues: CritiqueIssue[] = [];

  const penalties: Record<CritiqueDimensionKey, number> = {
    propIntegrity: 0,
    spatialContinuity: 0,
    stagingAndEyeTrace: 0,
    pacingAndReadability: 0,
    kinematicAppeal: 0,
    cinematography: 0
  };

  const addPenalty = (dim: CritiqueDimensionKey, amount: number): void => {
    penalties[dim] = Math.min(10, penalties[dim] + amount);
  };

  const sampledGlobalSet = new Set<number>();

  let totalDeadAirMs = 0;
  let totalOutOfBoundsCount = 0;
  let globalMaxSeamStepPx = 0;
  let globalMaxGravityDropPx = 0;
  let totalClutterDurationMs = 0;
  let totalCalloutCollisionCount = 0;
  let giantsVsToddlersDetected = false;
  let minStrokeHeadRatio = Infinity;
  let maxStrokeHeadRatio = 0;

  let totalActorSamplesForSpine = 0;
  let curvedSpineSamples = 0;
  let missingGazeCount = 0;
  let expressiveActionCount = 0;
  let missingGlyphCount = 0;

  for (const slice of slices) {
    const program = slice.program;
    const isV2 = program.contractVersion === CONTRACT_VERSION_V2;
    const v2 = isV2 ? (program.spec as AnimationSpecV2) : undefined;
    const defaultColor = program.spec.actor?.color ?? "#202124";
    const { regularTimes, allTimes, boundaries } = collectSceneLocalTimestamps(program, stepMs);
    const sceneW = program.spec.canvas.width;
    const sceneH = program.spec.canvas.height;

    for (const lt of allTimes) {
      sampledGlobalSet.add(Math.round(slice.startMs + lt));
    }

    const sampleAt = (localTimeMs: number): SampledFrame => {
      if (isMovie && normalized.movie) {
        return sampleMovie(normalized.movie, slice.startMs + localTimeMs, "normal");
      }
      return sampleAnimation(program, localTimeMs, "normal");
    };

    // -----------------------------------------------------------------------
    // A. Reuse analyzeStoryboard for OOB actors/addons + seam steps
    // -----------------------------------------------------------------------
    const sbAnalysis = analyzeStoryboard(program);
    totalOutOfBoundsCount += sbAnalysis.outOfBoundsCount;
    if (sbAnalysis.maxSeamStepPx > globalMaxSeamStepPx) {
      globalMaxSeamStepPx = sbAnalysis.maxSeamStepPx;
    }

    const oobByEntity = new Map<string, { kind: "actor" | "addon"; id: string; count: number; firstTimeMs: number; reason: string }>();
    for (const oob of sbAnalysis.outOfBoundsFrames) {
      const key = `${oob.kind}:${oob.id}`;
      const existing = oobByEntity.get(key);
      if (!existing) {
        oobByEntity.set(key, {
          kind: oob.kind,
          id: oob.id,
          count: 1,
          firstTimeMs: slice.startMs + oob.timeMs,
          reason: oob.reason
        });
      } else {
        existing.count += 1;
      }
    }
    for (const entry of oobByEntity.values()) {
      const isActor = entry.kind === "actor";
      addPenalty("spatialContinuity", (isActor ? 1.8 : 1.2) + Math.min(1.5, (entry.count - 1) * 0.1));
      issues.push({
        code: isActor ? "actor_out_of_bounds" : "addon_out_of_bounds",
        dimension: "spatialContinuity",
        severity: "error",
        timeMs: Math.round(entry.firstTimeMs),
        ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
        ...(isActor ? { actorId: entry.id } : {}),
        message: `${entry.kind} "${entry.id}" goes out of bounds (${entry.count} sample(s)): ${entry.reason}.`,
        suggestedPatch: isActor ? { x: "center" } : { addons: "auto" }
      });
    }

    for (const [actorId, seamPx] of Object.entries(sbAnalysis.seamStepByActorPx)) {
      if (seamPx > 6) {
        const isSevere = seamPx > 14;
        addPenalty("spatialContinuity", isSevere ? 2.0 : 0.9);
        issues.push({
          code: "inter_clip_seam_jump",
          dimension: "spatialContinuity",
          severity: isSevere ? "error" : "warning",
          timeMs: Math.round(slice.startMs + (boundaries[0] ?? 0)),
          ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
          actorId,
          message: `Actor "${actorId}" has an inter-clip seam jump of ${seamPx.toFixed(1)}px (> 6px threshold).`,
          suggestedPatch: { blendMs: 240 }
        });
      }
    }

    // -----------------------------------------------------------------------
    // B. Vertical foot/elevation drops across clip boundaries (> 12px)
    // -----------------------------------------------------------------------
    const reportedDropActors = new Set<string>();
    for (const b of boundaries) {
      const before = sampleAnimation(program, Math.max(0, b - 1), "normal");
      const after = sampleAnimation(program, b, "normal");
      const beforeActors = actorsFromFrame(before, defaultColor);
      const afterActors = actorsFromFrame(after, defaultColor);

      for (const aAfter of afterActors) {
        const aBefore = beforeActors.find((item) => item.id === aAfter.id);
        if (!aBefore) continue;
        const bLShin = aBefore.segments.find((s) => s.id === "left-shin");
        const bRShin = aBefore.segments.find((s) => s.id === "right-shin");
        const aLShin = aAfter.segments.find((s) => s.id === "left-shin");
        const aRShin = aAfter.segments.find((s) => s.id === "right-shin");
        const bTorso = aBefore.segments.find((s) => s.id === "torso");
        const aTorso = aAfter.segments.find((s) => s.id === "torso");

        const beforeFootY = Math.max(bLShin?.y2 ?? aBefore.groundY, bRShin?.y2 ?? aBefore.groundY);
        const afterFootY = Math.max(aLShin?.y2 ?? aAfter.groundY, aRShin?.y2 ?? aAfter.groundY);
        const footDrop = afterFootY - beforeFootY;
        const pelvisDrop = bTorso && aTorso ? aTorso.y1 - bTorso.y1 : 0;
        const dropPx = Math.max(footDrop, pelvisDrop);

        if (dropPx > globalMaxGravityDropPx) {
          globalMaxGravityDropPx = dropPx;
        }
        if (dropPx > 12 && !reportedDropActors.has(`${aAfter.id}:${b}`)) {
          reportedDropActors.add(`${aAfter.id}:${b}`);
          addPenalty("spatialContinuity", 2.2);
          issues.push({
            code: "vertical_elevation_drop",
            dimension: "spatialContinuity",
            severity: "error",
            timeMs: Math.round(slice.startMs + b),
            ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
            actorId: aAfter.id,
            message: `Actor "${aAfter.id}" drops downward by ${dropPx.toFixed(1)}px instantaneously at ${Math.round(slice.startMs + b)}ms (> 12px threshold).`,
            suggestedPatch: { toGround: true, blendMs: 220 }
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // C. Static actor-spec checks: giants-vs-toddlers & uncoordinated handoffs
    // -----------------------------------------------------------------------
    if (v2 && v2.actors.length >= 2) {
      let flaggedGiantsInScene = false;
      for (let i = 0; i < v2.actors.length; i++) {
        for (let j = i + 1; j < v2.actors.length; j++) {
          const a = v2.actors[i]!;
          const b = v2.actors[j]!;
          const scaleDiff = Math.abs(a.scale - b.scale);
          const groundDiff = Math.abs(a.groundY - b.groundY);
          const usesDepth =
            (a.depth !== undefined || b.depth !== undefined) &&
            Math.abs((a.depth ?? 0) - (b.depth ?? 0)) >= 0.05;
          if (scaleDiff >= 0.2 && groundDiff < 10 && !usesDepth) {
            giantsVsToddlersDetected = true;
            if (!flaggedGiantsInScene) {
              flaggedGiantsInScene = true;
              addPenalty("stagingAndEyeTrace", 4.0);
              issues.push({
                code: "giants_vs_toddlers",
                dimension: "stagingAndEyeTrace",
                severity: "error",
                timeMs: Math.round(slice.startMs),
                ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                actorId: a.scale < b.scale ? a.id : b.id,
                message: `Scale mismatch ("giants-vs-toddlers"): "${a.id}" (scale ${a.scale}) and "${b.id}" (scale ${b.scale}) share groundY (${a.groundY} vs ${b.groundY}) without depth layering.`,
                suggestedPatch: { depth: 0.45 }
              });
            }
          }
        }
      }

      // Check uncoordinated hand-over / catch pairs
      for (const sender of v2.actors) {
        for (const sAct of sender.actions) {
          if (sAct.action !== "hand-over") continue;
          const sEnd = sAct.startMs + sAct.durationMs;
          const nearbyReceivers = v2.actors.filter(
            (cand) =>
              cand.id !== sender.id &&
              cand.actions.some(
                (rAct) =>
                  (rAct.action === "catch" || rAct.action === "present-card") &&
                  rAct.startMs <= sEnd + 600 &&
                  rAct.startMs + rAct.durationMs >= sAct.startMs - 200
              )
          );
          if (nearbyReceivers.length === 0) continue;

          const hasExplicitHandoff = Boolean(sAct.handoffTo);
          const hasCueLinkedReceiver =
            Boolean(sAct.emitCue) &&
            nearbyReceivers.some((rec) =>
              rec.actions.some(
                (rAct) =>
                  (rAct.action === "catch" || rAct.action === "present-card") &&
                  rAct.afterCue === sAct.emitCue
              )
            );

          if (!hasExplicitHandoff && !hasCueLinkedReceiver) {
            const targetReceiver = nearbyReceivers[0]!;
            addPenalty("propIntegrity", 1.8);
            issues.push({
              code: "uncoordinated_prop_handoff",
              dimension: "propIntegrity",
              severity: "error",
              timeMs: Math.round(slice.startMs + sAct.startMs),
              ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
              actorId: sender.id,
              message: `Actor "${sender.id}" performs "hand-over" alongside "${targetReceiver.id}" without "handoffTo" or cue-linked coordination, risking a prop morph.`,
              suggestedPatch: {
                handoffTo: { actorId: targetReceiver.id, propType: "card" }
              }
            });
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // D. Authored callout pacing checks (before MIN_CALLOUT_DURATION_MS clamp)
    // -----------------------------------------------------------------------
    if (v2) {
      const checkAuthoredCallout = (
        text: string,
        rawDurationMs: number,
        startMs: number,
        actorId?: string
      ): void => {
        const clean = text.trim();
        if (!clean) return;
        const words = clean.split(/\s+/).filter(Boolean).length;
        const durSec = Math.max(0.05, rawDurationMs / 1000);
        const wps = words / durSec;
        const recommendedMs = Math.max(1200, Math.ceil((words / 3.5) * 1000));

        if (rawDurationMs < 900) {
          addPenalty("pacingAndReadability", 3.2);
          issues.push({
            code: "rushed_callout",
            dimension: "pacingAndReadability",
            severity: "error",
            timeMs: Math.round(slice.startMs + startMs),
            ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
            ...(actorId !== undefined ? { actorId } : {}),
            message: `Callout "${clean.slice(0, 36)}" has duration ${Math.round(rawDurationMs)}ms (< 900ms minimum readable hold).`,
            suggestedPatch: { durationMs: recommendedMs }
          });
        } else if (words >= 4 && wps > 12) {
          addPenalty("pacingAndReadability", 1.5);
          issues.push({
            code: "rushed_callout",
            dimension: "pacingAndReadability",
            severity: "warning",
            timeMs: Math.round(slice.startMs + startMs),
            ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
            ...(actorId !== undefined ? { actorId } : {}),
            message: `Callout "${clean.slice(0, 36)}" reads at ${wps.toFixed(1)} words/sec (> 12 words/sec ceiling).`,
            suggestedPatch: { durationMs: recommendedMs }
          });
        }
      };

      for (const actor of v2.actors) {
        for (const act of actor.actions) {
          if (typeof act.say === "string" && act.say.trim()) {
            checkAuthoredCallout(act.say, act.durationMs, act.startMs, actor.id);
          }
          if (typeof act.think === "string" && act.think.trim()) {
            checkAuthoredCallout(act.think, act.durationMs, act.startMs, actor.id);
          }
          if (typeof act.badge === "string" && act.badge.trim()) {
            checkAuthoredCallout(act.badge, act.durationMs, act.startMs, actor.id);
          }
        }
      }

      for (const c of v2.callouts ?? []) {
        const startMs =
          typeof c.startMs === "number" && Number.isFinite(c.startMs)
            ? c.startMs
            : typeof c.atCue === "string" && c.atCue.trim()
              ? (resolveCueTimeMs(program, c.atCue.trim()) ?? 0)
              : 0;
        const rawDur =
          typeof c.durationMs === "number" && Number.isFinite(c.durationMs)
            ? c.durationMs
            : 1500;
        checkAuthoredCallout(c.text, rawDur, startMs, c.actorId);
      }
    }

    if (slice.caption && slice.caption.trim()) {
      const words = slice.caption.trim().split(/\s+/).filter(Boolean).length;
      const wps = words / Math.max(0.1, slice.durationMs / 1000);
      if (slice.durationMs < 900 || (words >= 4 && wps > 12)) {
        addPenalty("pacingAndReadability", 1.2);
        issues.push({
          code: "rushed_callout",
          dimension: "pacingAndReadability",
          severity: "warning",
          timeMs: Math.round(slice.startMs),
          ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
          message: `Scene caption "${slice.caption.slice(0, 36)}" has insufficient reading time (${slice.durationMs}ms, ${wps.toFixed(1)} words/sec).`,
          suggestedPatch: { durationMs: Math.max(1200, Math.ceil((words / 3.5) * 1000)) }
        });
      }
    }

    // -----------------------------------------------------------------------
    // E. Regular timeline sweep (props, clutter, dead air, overlaps, callouts,
    //    kinematics, cinematography)
    // -----------------------------------------------------------------------
    const spotlightActive =
      v2 !== undefined &&
      (v2.spotlight === true || (v2.spotlight === "auto" && v2.actors.length >= 3));
    const cameraCutTimes = getCameraCutTimesMs(program);

    const regularFrames = regularTimes.map((lt) => ({
      localTimeMs: lt,
      globalTimeMs: slice.startMs + lt,
      frame: sampleAt(lt)
    }));

    const reportedPropFlip = new Set<string>();
    const reportedChairImpale = new Set<string>();
    const reportedHoopImpale = new Set<string>();
    const reportedContactGap = new Set<string>();
    const reportedCalloutOob = new Set<string>();
    const reportedCalloutOverlap = new Set<string>();
    const reportedCalloutHead = new Set<string>();
    const reportedGazeMisalign = new Set<string>();
    const reportedFrustumCrop = new Set<string>();
    let reportedWhipPan = false;

    let deadAirRunStart: number | null = null;
    let deadAirRunEnd = 0;
    let sceneClutterMs = 0;
    let firstClutterTimeMs: number | null = null;
    let maxSimultaneousActive = 0;
    let frozenMs = 0;

    let unionMinX = Infinity;
    let unionMaxX = -Infinity;
    let unionMinY = Infinity;
    let unionMaxY = -Infinity;
    let maxActorHeightPx = 0;
    let frustumAreaSum = 0;
    let frustumHeightSum = 0;
    let frustumCount = 0;
    let relXSum = 0;
    let relXCount = 0;
    let maxCameraZoom = 1;
    let hasEntranceOrExit = v2
      ? v2.actors.some((a) => a.actions.some((act) => ENTRANCE_EXIT_SET.has(act.action)))
      : false;

    const flushDeadAirRun = (): void => {
      if (deadAirRunStart !== null) {
        const span = deadAirRunEnd - deadAirRunStart;
        if (span > 1800) {
          totalDeadAirMs += span;
          const isTrailing = deadAirRunEnd >= slice.durationMs - stepMs * 1.5;
          const isSevere = span >= 2500;
          addPenalty("pacingAndReadability", Math.min(4.0, 2.2 + ((span - 1800) / 1000) * 0.6));
          issues.push({
            code: "dead_air_idle",
            dimension: "pacingAndReadability",
            severity: isSevere ? "error" : "warning",
            timeMs: Math.round(slice.startMs + deadAirRunStart),
            ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
            message: `${isTrailing ? "Trailing dead-air" : "Dead-air"} idle stretch of ${(span / 1000).toFixed(2)}s (> 1.8s) with no active motion, callouts, or camera moves.`,
            suggestedPatch: { trimIdleTails: true }
          });
        }
        deadAirRunStart = null;
      }
    };

    for (let idx = 0; idx < regularFrames.length; idx++) {
      const entry = regularFrames[idx]!;
      const prevEntry = idx > 0 ? regularFrames[idx - 1] : undefined;
      const dt = prevEntry ? entry.localTimeMs - prevEntry.localTimeMs : 0;
      const frame = entry.frame;
      const actors = actorsFromFrame(frame, defaultColor);
      const addons = frame.addons ?? [];
      const callouts = frame.callouts ?? [];
      const visibleAddons = addons.filter((a) => a.opacity > 0.15 && a.scale > 0.15);
      const visibleCallouts = callouts.filter((c) => c.opacity > 0.05);

      const camZoom = frame.camera?.zoom ?? 1;
      if (camZoom > maxCameraZoom) maxCameraZoom = camZoom;
      const frustum = frame.camera
        ? cameraFrustum(frame.camera, sceneW, sceneH)
        : { x: 0, y: 0, width: sceneW, height: sceneH };
      frustumAreaSum += frustum.width * frustum.height;
      frustumHeightSum += frustum.height;
      frustumCount += 1;

      // 1. Prop Integrity checks
      for (const addon of visibleAddons) {
        const owner = addon.actorId ? actors.find((a) => a.id === addon.actorId) : undefined;

        // Asymmetric prop orientation check
        if (ASYMMETRIC_FLIP_TYPES.has(addon.type)) {
          const relevantActor =
            owner ??
            actors.find(
              (a) =>
                (!PASSIVE_ACTIONS.has(a.action) || SEATED_ACTIONS.has(a.action)) &&
                Math.abs(a.x - (addon.x + addon.width / 2)) < Math.max(120, addon.width * 1.4)
            );
          const actorFacing = relevantActor?.facing ?? 1;
          if (relevantActor && actorFacing < -0.25 && addon.flipX !== true) {
            const key = `${addon.id}:${relevantActor.id}`;
            if (!reportedPropFlip.has(key)) {
              reportedPropFlip.add(key);
              addPenalty("propIntegrity", reportedPropFlip.size === 1 ? 2.2 : 0.8);
              issues.push({
                code: "asymmetric_prop_facing_mismatch",
                dimension: "propIntegrity",
                severity: "error",
                timeMs: Math.round(entry.globalTimeMs),
                ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                actorId: relevantActor.id,
                message: `Asymmetric prop "${addon.type}" (${addon.id}) is not mirrored (flipX !== true) while actor "${relevantActor.id}" faces left.`,
                suggestedPatch: {
                  stageProps: [{ id: addon.id, type: addon.type, facing: "left" }]
                }
              });
            }
          }
        }

        // Chair backrest impalement check
        if (addon.type === "chair") {
          const chairCenterX = addon.x + addon.width / 2;
          const seatedActor =
            (owner && SEATED_ACTIONS.has(owner.action) ? owner : undefined) ??
            actors.find(
              (a) =>
                SEATED_ACTIONS.has(a.action) &&
                Math.abs(a.x - chairCenterX) < addon.width * 1.15
            );
          if (seatedActor) {
            const torso = seatedActor.segments.find((s) => s.id === "torso");
            const pelvisX = torso ? torso.x1 : seatedActor.x;
            const facing = seatedActor.facing ?? 1;
            const backrestX = addon.flipX === true ? addon.x + addon.width * 0.82 : addon.x + addon.width * 0.18;
            const backrestInFront =
              STRICT_SEATED_ACTIONS.has(seatedActor.action) &&
              ((facing >= 0 && backrestX > pelvisX + 6) || (facing < 0 && backrestX < pelvisX - 6));
            const chairOnFrontLayer = addon.layer === "front";
            if (chairOnFrontLayer || backrestInFront) {
              const key = `${addon.id}:${seatedActor.id}`;
              if (!reportedChairImpale.has(key)) {
                reportedChairImpale.add(key);
                addPenalty("propIntegrity", 2.4);
                issues.push({
                  code: "prop_impalement_chair",
                  dimension: "propIntegrity",
                  severity: "error",
                  timeMs: Math.round(entry.globalTimeMs),
                  ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                  actorId: seatedActor.id,
                  message: chairOnFrontLayer
                    ? `Chair "${addon.id}" renders on front layer over seated actor "${seatedActor.id}".`
                    : `Chair "${addon.id}" backrest crosses in front of seated actor "${seatedActor.id}" pelvis.`,
                  suggestedPatch: {
                    stageProps: [
                      {
                        id: addon.id,
                        type: "chair",
                        layer: "back",
                        facing: facing < 0 ? "left" : "right"
                      }
                    ]
                  }
                });
              }
            }
          }
        }

        // Hand-held prop contact distance check (> 22px during sustained hold)
        if (
          HAND_HELD_CONTACT_PROPS.has(addon.type) &&
          owner &&
          addon.opacity > 0.7 &&
          addon.scale > 0.7 &&
          !isActionPropEnteringOrExiting(v2, owner.id, entry.localTimeMs)
        ) {
          const lFore = owner.segments.find((s) => s.id === "left-forearm");
          const rFore = owner.segments.find((s) => s.id === "right-forearm");
          if (lFore && rFore) {
            const box: Box2D = {
              x: addon.x,
              y: addon.y,
              width: addon.width,
              height: addon.height
            };
            const minHandDist = Math.min(
              pointToBoxDistance(lFore.x2, lFore.y2, box),
              pointToBoxDistance(rFore.x2, rFore.y2, box)
            );
            if (minHandDist > 22) {
              const key = `${addon.id}:${owner.id}`;
              if (!reportedContactGap.has(key)) {
                reportedContactGap.add(key);
                addPenalty("propIntegrity", 1.0);
                issues.push({
                  code: "prop_contact_gap",
                  dimension: "propIntegrity",
                  severity: "warning",
                  timeMs: Math.round(entry.globalTimeMs),
                  ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                  actorId: owner.id,
                  message: `Held prop "${addon.type}" (${addon.id}) drifts ${minHandDist.toFixed(1)}px from actor "${owner.id}" hands (> 22px contact gap).`,
                  suggestedPatch: { addons: "auto" }
                });
              }
            }
          }
        }
      }

      // Basketball trajectory behind backboard check
      const hoop = visibleAddons.find((a) => a.type === "hoop");
      const basketball = visibleAddons.find((a) => a.type === "basketball");
      if (hoop && basketball) {
        const bx = basketball.x + basketball.width / 2;
        const by = basketball.y + basketball.height / 2;
        const inBackboardBand = by >= hoop.y - 6 && by <= hoop.y + hoop.height * 0.55;
        const backboardX = hoop.flipX === true ? hoop.x + hoop.width * 0.22 : hoop.x + hoop.width * 0.78;
        const behindBackboard = hoop.flipX === true ? bx < backboardX - 6 : bx > backboardX + 6;
        if (inBackboardBand && behindBackboard) {
          const key = `${hoop.id}:${basketball.id}`;
          if (!reportedHoopImpale.has(key)) {
            reportedHoopImpale.add(key);
            addPenalty("propIntegrity", 2.0);
            issues.push({
              code: "prop_impalement_hoop",
              dimension: "propIntegrity",
              severity: "error",
              timeMs: Math.round(entry.globalTimeMs),
              ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
              message: `Basketball trajectory crosses behind hoop "${hoop.id}" backboard at ${Math.round(entry.globalTimeMs)}ms.`,
              suggestedPatch: {
                stageProps: [{ id: hoop.id, type: "hoop", facing: hoop.flipX ? "right" : "left" }]
              }
            });
          }
        }
      }

      // 2. Callout OOB + Callout-on-Callout + Callout-on-Head collisions
      for (let i = 0; i < visibleCallouts.length; i++) {
        const c = visibleCallouts[i]!;
        if (c.x < -2 || c.y < -2 || c.x + c.width > sceneW + 2 || c.y + c.height > sceneH + 2) {
          totalOutOfBoundsCount += 1;
          if (!reportedCalloutOob.has(c.id)) {
            reportedCalloutOob.add(c.id);
            addPenalty("spatialContinuity", 1.2);
            issues.push({
              code: "callout_out_of_bounds",
              dimension: "spatialContinuity",
              severity: "error",
              timeMs: Math.round(entry.globalTimeMs),
              ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
              ...(c.actorId !== undefined ? { actorId: c.actorId } : {}),
              message: `Callout "${c.id}" extends outside canvas [${sceneW}x${sceneH}].`
            });
          }
        }

        for (let j = i + 1; j < visibleCallouts.length; j++) {
          const other = visibleCallouts[j]!;
          if (boxesIntersect(c, other, 0.5)) {
            totalCalloutCollisionCount += 1;
            const pairKey = [c.id, other.id].sort().join("|");
            if (!reportedCalloutOverlap.has(pairKey)) {
              reportedCalloutOverlap.add(pairKey);
              addPenalty("stagingAndEyeTrace", 1.8);
              issues.push({
                code: "callout_overlap",
                dimension: "stagingAndEyeTrace",
                severity: "error",
                timeMs: Math.round(entry.globalTimeMs),
                ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                message: `Callouts "${c.id}" and "${other.id}" overlap visually at ${Math.round(entry.globalTimeMs)}ms.`
              });
            }
          }
        }

        for (const actor of actors) {
          if (actor.x < 0 || actor.x > sceneW) continue;
          const headRadius = 11 * actor.scale;
          if (circleIntersectsBox(actor.head.x, actor.head.y, headRadius, c)) {
            totalCalloutCollisionCount += 1;
            const pairKey = `${c.id}:${actor.id}`;
            if (!reportedCalloutHead.has(pairKey)) {
              reportedCalloutHead.add(pairKey);
              addPenalty("stagingAndEyeTrace", 1.5);
              issues.push({
                code: "callout_head_collision",
                dimension: "stagingAndEyeTrace",
                severity: "error",
                timeMs: Math.round(entry.globalTimeMs),
                ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                actorId: actor.id,
                message: `Callout "${c.id}" overlaps actor "${actor.id}" head at ${Math.round(entry.globalTimeMs)}ms.`
              });
            }
          }
        }
      }

      // 3. Multi-actor clutter + dead-air + static hold tracking
      const onstageActors = actors.filter((a) => a.x >= -10 && a.x <= sceneW + 10);
      const activeActorsNow = onstageActors.filter((a) => {
        if (!PASSIVE_ACTIONS.has(a.action)) return true;
        return visibleAddons.some((ad) => ad.actorId === a.id);
      });
      if (activeActorsNow.length > maxSimultaneousActive) {
        maxSimultaneousActive = activeActorsNow.length;
      }

      if (activeActorsNow.length >= 3 && !spotlightActive && camZoom <= 1.05) {
        if (firstClutterTimeMs === null) firstClutterTimeMs = entry.globalTimeMs;
        sceneClutterMs += dt > 0 ? dt : stepMs;
      }

      const cameraMoved =
        prevEntry?.frame.camera !== undefined &&
        frame.camera !== undefined &&
        (Math.hypot(frame.camera.x - prevEntry.frame.camera.x, frame.camera.y - prevEntry.frame.camera.y) >= 0.5 ||
          Math.abs(frame.camera.zoom - prevEntry.frame.camera.zoom) >= 0.002);

      const allPassive = onstageActors.length > 0 && onstageActors.every((a) => PASSIVE_ACTIONS.has(a.action));
      const isDeadAirStep = allPassive && visibleCallouts.length === 0 && !cameraMoved;

      if (isDeadAirStep) {
        if (deadAirRunStart === null) {
          deadAirRunStart = entry.localTimeMs;
        }
        deadAirRunEnd = entry.localTimeMs;
      } else {
        flushDeadAirRun();
      }

      if (prevEntry && dt > 0) {
        const prevActors = actorsFromFrame(prevEntry.frame, defaultColor);
        const actorDisp = maxActorDisplacement(prevActors, actors);
        const camMotion =
          prevEntry.frame.camera && frame.camera
            ? Math.hypot(frame.camera.x - prevEntry.frame.camera.x, frame.camera.y - prevEntry.frame.camera.y) +
              Math.abs(frame.camera.zoom - prevEntry.frame.camera.zoom) * 200
            : 0;
        const calloutChanged =
          (prevEntry.frame.callouts?.map((c) => c.id).join(",") ?? "") !==
          (frame.callouts?.map((c) => c.id).join(",") ?? "");
        if (actorDisp < 0.75 && camMotion < 0.75 && !calloutChanged) {
          frozenMs += dt;
        }

        // Camera whip-pan velocity check on non-cut segments
        if (prevEntry.frame.camera && frame.camera) {
          const crossesCut = cameraCutTimes.some(
            (ct) => ct >= prevEntry.localTimeMs - 1e-3 && ct <= entry.localTimeMs + 1e-3
          );
          if (!crossesCut) {
            const dtSec = dt / 1000;
            const speedPxPerSec =
              Math.hypot(frame.camera.x - prevEntry.frame.camera.x, frame.camera.y - prevEntry.frame.camera.y) / dtSec;
            const zoomRatePerSec = Math.abs(frame.camera.zoom - prevEntry.frame.camera.zoom) / dtSec;
            if ((speedPxPerSec > sceneW * 2.2 || zoomRatePerSec > 3.2) && !reportedWhipPan) {
              reportedWhipPan = true;
              addPenalty("cinematography", 1.5);
              issues.push({
                code: "abrupt_camera_whip_pan",
                dimension: "cinematography",
                severity: "warning",
                timeMs: Math.round(entry.globalTimeMs),
                ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                message: `Abrupt non-cut camera velocity spike (${Math.round(speedPxPerSec)}px/s, zoom rate ${zoomRatePerSec.toFixed(2)}/s) at ${Math.round(entry.globalTimeMs)}ms.`,
                suggestedPatch: { camera: "auto-director" }
              });
            }
          }
        }
      }

      // 4. Kinematic Appeal + Framing union bbox + Frustum containment
      for (const actor of onstageActors) {
        const geom = frameGeometry(actorToSampledFrame(actor, entry.localTimeMs));
        totalActorSamplesForSpine += 1;
        const torsoPath = geom.paths.find((p) => p.id === "torso")?.d ?? "";
        if (torsoPath.includes("Q")) {
          curvedSpineSamples += 1;
        }

        const ratio = geom.strokeWidth / Math.max(1e-3, geom.headRadius);
        if (ratio < minStrokeHeadRatio) minStrokeHeadRatio = ratio;
        if (ratio > maxStrokeHeadRatio) maxStrokeHeadRatio = ratio;

        if (!actor.gazeDir) {
          missingGazeCount += 1;
        } else if (INTERACTION_GAZE_ACTIONS.has(actor.action)) {
          const prop = visibleAddons.find((ad) => ad.actorId === actor.id);
          if (prop) {
            const propCenterX = prop.x + prop.width / 2;
            const dxToProp = propCenterX - actor.head.x;
            if (Math.abs(dxToProp) > 24 && dxToProp * actor.gazeDir.x < -0.25) {
              const key = `${actor.id}:${actor.action}`;
              if (!reportedGazeMisalign.has(key)) {
                reportedGazeMisalign.add(key);
                addPenalty("kinematicAppeal", 1.0);
                issues.push({
                  code: "gaze_target_misalignment",
                  dimension: "kinematicAppeal",
                  severity: "warning",
                  timeMs: Math.round(entry.globalTimeMs),
                  ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                  actorId: actor.id,
                  message: `Actor "${actor.id}" gaze points away from active "${prop.type}" prop during "${actor.action}".`,
                  suggestedPatch: { gaze: "target" }
                });
              }
            }
          }
        }

        if (EXPRESSIVE_GLYPH_CHECK_ACTIONS.has(actor.action)) {
          expressiveActionCount += 1;
          const kind = resolveHandGlyphKind(actor.action);
          const glyphSvg = kind ? renderActorHandGlyphsSvg(actor, geom, geom.strokeWidth, 1) : "";
          if (!glyphSvg.includes('data-part="hand-glyph"')) {
            missingGlyphCount += 1;
          }
        }

        // Union bounding box accumulation
        const headTop = geom.head.y - geom.headRadius;
        const actorHeight = Math.max(20, actor.groundY - headTop);
        if (actorHeight > maxActorHeightPx) maxActorHeightPx = actorHeight;
        const halfW = Math.max(18, 28 * actor.scale);
        unionMinX = Math.min(unionMinX, actor.x - halfW);
        unionMaxX = Math.max(unionMaxX, actor.x + halfW);
        unionMinY = Math.min(unionMinY, headTop);
        unionMaxY = Math.max(unionMaxY, actor.groundY);

        relXSum += (actor.x - frustum.x) / Math.max(1, frustum.width);
        relXCount += 1;

        // Camera frustum subject containment check
        if (frame.camera && camZoom > 1.001) {
          const isFocal =
            frame.camera.activeActorId === actor.id ||
            (frame.camera.activeActorId === undefined && !PASSIVE_ACTIONS.has(actor.action));
          if (isFocal) {
            const pad = 14;
            const outOfFrustum =
              geom.head.x < frustum.x - pad ||
              geom.head.x > frustum.x + frustum.width + pad ||
              headTop < frustum.y - pad ||
              actor.groundY > frustum.y + frustum.height + pad;
            if (outOfFrustum && !reportedFrustumCrop.has(actor.id)) {
              reportedFrustumCrop.add(actor.id);
              addPenalty("cinematography", 2.2);
              issues.push({
                code: "subject_outside_camera_frustum",
                dimension: "cinematography",
                severity: "error",
                timeMs: Math.round(entry.globalTimeMs),
                ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                actorId: actor.id,
                message: `Focal actor "${actor.id}" is cropped outside the active camera frustum at ${Math.round(entry.globalTimeMs)}ms.`,
                suggestedPatch: { camera: "auto-director" }
              });
            }
          }
        }
      }

      for (const addon of visibleAddons) {
        unionMinX = Math.min(unionMinX, addon.x);
        unionMaxX = Math.max(unionMaxX, addon.x + addon.width);
        unionMinY = Math.min(unionMinY, addon.y);
        unionMaxY = Math.max(unionMaxY, addon.y + addon.height);
      }
      for (const c of visibleCallouts) {
        unionMinX = Math.min(unionMinX, c.x);
        unionMaxX = Math.max(unionMaxX, c.x + c.width);
        unionMinY = Math.min(unionMinY, c.y);
        unionMaxY = Math.max(unionMaxY, c.y + c.height);
      }
    }

    flushDeadAirRun();

    // Unfocused multi-actor clutter issue
    if (sceneClutterMs >= 300) {
      totalClutterDurationMs += sceneClutterMs;
      const severeClutter = sceneClutterMs >= 800 || maxSimultaneousActive >= 4;
      addPenalty("stagingAndEyeTrace", severeClutter ? 4.0 : 2.5);
      issues.push({
        code: "unfocused_multi_actor_clutter",
        dimension: "stagingAndEyeTrace",
        severity: severeClutter ? "error" : "warning",
        timeMs: Math.round(firstClutterTimeMs ?? slice.startMs),
        ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
        message: `Unfocused multi-actor clutter: up to ${maxSimultaneousActive} actors active simultaneously for ${(sceneClutterMs / 1000).toFixed(2)}s with spotlight off and static wide camera.`,
        suggestedPatch: { spotlight: "auto", camera: "auto-director" }
      });

      if (maxSimultaneousActive >= 4) {
        addPenalty("pacingAndReadability", 2.0);
        issues.push({
          code: "cognitive_overload_pacing",
          dimension: "pacingAndReadability",
          severity: "warning",
          timeMs: Math.round(firstClutterTimeMs ?? slice.startMs),
          ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
          message: `${maxSimultaneousActive} actors animate simultaneously without cue staggering, causing visual cognitive overload.`,
          suggestedPatch: { spotlight: "auto" }
        });
      }
    }

    // Actor-on-actor overlap (< 24px for >= 500ms)
    if (v2 && v2.actors.length >= 2) {
      for (let i = 0; i < v2.actors.length; i++) {
        for (let j = i + 1; j < v2.actors.length; j++) {
          const idA = v2.actors[i]!.id;
          const idB = v2.actors[j]!.id;
          let runStart: number | null = null;
          let runEnd = 0;
          let minDist = Infinity;

          const flushOverlap = (): void => {
            if (runStart !== null) {
              const span = runEnd - runStart;
              if (span >= 500) {
                const isSevere = minDist < 14;
                addPenalty("stagingAndEyeTrace", isSevere ? 2.0 : 1.4);
                issues.push({
                  code: "actor_overlap",
                  dimension: "stagingAndEyeTrace",
                  severity: isSevere ? "error" : "warning",
                  timeMs: Math.round(slice.startMs + runStart),
                  ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
                  actorId: idA,
                  message: `Actors "${idA}" and "${idB}" overlap horizontally (min |Δx|=${minDist.toFixed(1)}px < 24px) for ${Math.round(span)}ms.`,
                  suggestedPatch: { x: "center-right" }
                });
              }
              runStart = null;
              minDist = Infinity;
            }
          };

          for (const rf of regularFrames) {
            const actors = rf.frame.actors ?? [];
            const a = actors.find((item) => item.id === idA);
            const b = actors.find((item) => item.id === idB);
            const bothOnstage =
              a !== undefined &&
              b !== undefined &&
              a.x >= 0 &&
              a.x <= sceneW &&
              b.x >= 0 &&
              b.x <= sceneW;
            const dist = bothOnstage ? Math.abs(a!.x - b!.x) : Infinity;
            if (dist < 24) {
              if (runStart === null) runStart = rf.localTimeMs;
              runEnd = rf.localTimeMs;
              if (dist < minDist) minDist = dist;
            } else {
              flushOverlap();
            }
          }
          flushOverlap();
        }
      }
    }

    // VBench-style static-hold guard (> 70% frozen)
    if (slice.durationMs >= 1000) {
      const frozenRatio = frozenMs / Math.max(1, slice.durationMs);
      if (frozenRatio > 0.7) {
        const isSevere = frozenRatio > 0.85;
        addPenalty("pacingAndReadability", isSevere ? 2.4 : 1.5);
        issues.push({
          code: "static_hold_excessive",
          dimension: "pacingAndReadability",
          severity: isSevere ? "error" : "warning",
          timeMs: Math.round(slice.startMs + slice.durationMs * 0.5),
          ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
          message: `Scene stays visually frozen for ${Math.round(frozenRatio * 100)}% of its duration (> 70% VBench static-hold threshold).`,
          suggestedPatch: { camera: "auto-director", trimIdleTails: true }
        });
      }
    }

    // Stage framing utilization & balanced composition checks
    if (Number.isFinite(unionMinX) && frustumCount > 0) {
      const avgFrustumArea = frustumAreaSum / frustumCount;
      const avgFrustumHeight = frustumHeightSum / frustumCount;
      const unionW = Math.max(0, unionMaxX - unionMinX);
      const unionH = Math.max(0, unionMaxY - unionMinY);
      const unionAreaRatio = (unionW * unionH) / Math.max(1, avgFrustumArea);
      const heightRatio = maxActorHeightPx / Math.max(1, avgFrustumHeight);
      const unionCenterXRatio = (unionMinX + unionMaxX) / (2 * Math.max(1, sceneW));
      const isCornerClustered = unionCenterXRatio < 0.28 || unionCenterXRatio > 0.72;

      if (unionAreaRatio < 0.15 && maxCameraZoom <= 1.02 && (isCornerClustered || heightRatio < 0.22)) {
        addPenalty("cinematography", 2.0);
        issues.push({
          code: "underutilized_stage_framing",
          dimension: "cinematography",
          severity: "warning",
          timeMs: Math.round(slice.startMs),
          ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
          message: `Action occupies only ${Math.round(unionAreaRatio * 100)}% of the canvas (${isCornerClustered ? "corner-clustered" : "undersized subjects"}) with no camera framing.`,
          suggestedPatch: { camera: "auto-director" }
        });
      }

      if (relXCount > 0 && !hasEntranceOrExit) {
        const avgRelX = relXSum / relXCount;
        if (avgRelX < 0.15 || avgRelX > 0.85) {
          addPenalty("cinematography", 1.2);
          issues.push({
            code: "unbalanced_composition",
            dimension: "cinematography",
            severity: "warning",
            timeMs: Math.round(slice.startMs),
            ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
            message: `Stage composition is pushed to the extreme horizontal edge (mean x=${Math.round(avgRelX * 100)}%).`,
            suggestedPatch: { camera: "auto-director" }
          });
        }
      }
    }

    // Multi-actor scenes with zero camera direction
    if (v2 && v2.actors.length >= 2 && v2.camera === undefined) {
      const ensemblePenalty = v2.actors.length >= 4 ? 2.5 : 0.6;
      addPenalty("cinematography", ensemblePenalty);
      issues.push({
        code: "static_camera_opportunity",
        dimension: "cinematography",
        severity: v2.actors.length >= 4 ? "warning" : "info",
        timeMs: Math.round(slice.startMs),
        ...(slice.sceneId !== undefined ? { sceneId: slice.sceneId } : {}),
        message: `Multi-actor scene (${v2.actors.length} actors) uses a static full-canvas shot with no camera direction.`,
        suggestedPatch: { camera: "auto-director" }
      });
    }
  }

  // Global Kinematic Appeal checks
  if (totalActorSamplesForSpine > 0 && curvedSpineSamples / totalActorSamplesForSpine < 0.8) {
    addPenalty("kinematicAppeal", 1.5);
    issues.push({
      code: "rigid_spine_geometry",
      dimension: "kinematicAppeal",
      severity: "warning",
      timeMs: 0,
      message: "Torso silhouette lacks quadratic Bezier curvature across sampled frames."
    });
  }

  if (missingGlyphCount > 0) {
    addPenalty("kinematicAppeal", 1.2);
    issues.push({
      code: "missing_hand_glyph",
      dimension: "kinematicAppeal",
      severity: "warning",
      timeMs: 0,
      message: `Expressive gesture frames (${missingGlyphCount}) did not emit hand glyphs.`
    });
  }

  if (maxStrokeHeadRatio > 0.28) {
    const isSevere = maxStrokeHeadRatio > 0.35;
    addPenalty("kinematicAppeal", isSevere ? 2.2 : 1.5);
    issues.push({
      code: "chunky_stroke_head_ratio",
      dimension: "kinematicAppeal",
      severity: isSevere ? "error" : "warning",
      timeMs: 0,
      message: `Stroke-to-head radius ratio peaked at ${maxStrokeHeadRatio.toFixed(3)} (> 0.28 crispness ceiling).`,
      suggestedPatch: { scale: 0.75 }
    });
  }

  if (totalActorSamplesForSpine > 0 && missingGazeCount === totalActorSamplesForSpine) {
    addPenalty("kinematicAppeal", 0.4);
    issues.push({
      code: "missing_gaze_direction",
      dimension: "kinematicAppeal",
      severity: "info",
      timeMs: 0,
      message: "Animation uses v1 rig without expressive gaze direction."
    });
  } else if (expressiveActionCount === 0 && normalized.durationMs >= 2000) {
    addPenalty("kinematicAppeal", 0.3);
  }

  // Multi-scene movie backdrop & transition craft checks
  if (isMovie && slices.length >= 2) {
    const withBackdrop = slices.filter((s) => s.backdrop !== "none").length;
    if (withBackdrop === 0) {
      addPenalty("cinematography", 0.8);
      issues.push({
        code: "missing_scene_backdrops",
        dimension: "cinematography",
        severity: "info",
        timeMs: 0,
        message: "Multi-scene movie has no contextual backdrop presets on any scene.",
        suggestedPatch: { backdrop: "office" }
      });
    }
    if (slices.length >= 3) {
      const nonCutCount = slices.slice(0, -1).filter((s) => s.transitionKind !== "cut").length;
      if (nonCutCount === 0) {
        addPenalty("cinematography", 0.3);
        issues.push({
          code: "all_hard_cut_transitions",
          dimension: "cinematography",
          severity: "info",
          timeMs: Math.round(slices[0]!.endMs),
          message: "Multi-scene movie uses only hard cuts across all scene boundaries.",
          suggestedPatch: { transition: { kind: "fade", durationMs: 400 } }
        });
      }
    }
  }

  const dimensions: CritiqueDimensionScores = {
    propIntegrity: round1(clamp(10 - penalties.propIntegrity, 0, 10)),
    spatialContinuity: round1(clamp(10 - penalties.spatialContinuity, 0, 10)),
    stagingAndEyeTrace: round1(clamp(10 - penalties.stagingAndEyeTrace, 0, 10)),
    pacingAndReadability: round1(clamp(10 - penalties.pacingAndReadability, 0, 10)),
    kinematicAppeal: round1(clamp(10 - penalties.kinematicAppeal, 0, 10)),
    cinematography: round1(clamp(10 - penalties.cinematography, 0, 10))
  };

  const rawWeighted =
    dimensions.propIntegrity * CRITIQUE_DIMENSION_WEIGHTS.propIntegrity +
    dimensions.spatialContinuity * CRITIQUE_DIMENSION_WEIGHTS.spatialContinuity +
    dimensions.stagingAndEyeTrace * CRITIQUE_DIMENSION_WEIGHTS.stagingAndEyeTrace +
    dimensions.pacingAndReadability * CRITIQUE_DIMENSION_WEIGHTS.pacingAndReadability +
    dimensions.kinematicAppeal * CRITIQUE_DIMENSION_WEIGHTS.kinematicAppeal +
    dimensions.cinematography * CRITIQUE_DIMENSION_WEIGHTS.cinematography;

  const minDimension = Math.min(...Object.values(dimensions));
  const errorCount = issues.filter((i) => i.severity === "error").length;

  // Severe perceptual flaws pull overall score down proportionally to the weakest dimension
  let adjustedOverall = rawWeighted;
  if (minDimension < 6.5) {
    adjustedOverall -= (6.5 - minDimension) * 0.45;
  }
  if (errorCount > 0) {
    adjustedOverall -= Math.min(2.0, errorCount * 0.25);
  }
  if (errorCount >= 2 && minDimension < 4.5) {
    adjustedOverall = Math.min(adjustedOverall, minDimension + 4.0);
  }

  const overallScore = round1(clamp(adjustedOverall, 0, 10));
  const grade: CritiqueGrade =
    overallScore >= 8.8
      ? "excellent"
      : overallScore >= 8.0
        ? "good"
        : overallScore >= 6.5
          ? "needs-polish"
          : "poor";
  const passed = overallScore >= 8.0 && minDimension >= 7.0;

  issues.sort(
    (a, b) =>
      a.timeMs - b.timeMs ||
      (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : b.severity === "error" ? 1 : a.severity === "warning" ? -1 : 1) ||
      a.code.localeCompare(b.code)
  );

  const metrics: CritiqueMetrics = {
    deadAirMs: Math.round(totalDeadAirMs),
    outOfBoundsCount: totalOutOfBoundsCount,
    maxSeamStepPx: round3(globalMaxSeamStepPx),
    maxGravityDropPx: round3(globalMaxGravityDropPx),
    clutterDurationMs: Math.round(totalClutterDurationMs),
    calloutCollisionCount: totalCalloutCollisionCount,
    giantsVsToddlersDetected,
    minStrokeHeadRatio: Number.isFinite(minStrokeHeadRatio) ? round3(minStrokeHeadRatio) : 0,
    maxStrokeHeadRatio: round3(maxStrokeHeadRatio),
    sceneCount: slices.length
  };

  return {
    version: "1.0.0",
    overallScore,
    grade,
    passed,
    dimensions,
    weights: CRITIQUE_DIMENSION_WEIGHTS,
    metrics,
    issues,
    suggestions: buildEngineSuggestions(issues, isMovie),
    sampledTimestampsMs: [...sampledGlobalSet].sort((a, b) => a - b)
  };
}

interface CritiqueBeatCandidate {
  timeMs: number;
  priority: number;
  reason: string;
}

function selectCritiqueTimestamps(
  programOrMovie: CompiledAnimation | CompiledMovie,
  report: CritiqueReport,
  maxPanels: number
): number[] {
  const cap = clamp(Math.floor(maxPanels), 1, 12);
  const normalized = toSceneSlices(programOrMovie);
  const durationMs = normalized.durationMs;
  if (cap === 1) {
    const topIssue = report.issues[0];
    return [topIssue ? clamp(Math.round(topIssue.timeMs), 0, durationMs) : 0];
  }

  const byTime = new Map<number, CritiqueBeatCandidate>();
  const addCandidate = (rawTimeMs: number, priority: number, reason: string): void => {
    if (!Number.isFinite(rawTimeMs)) return;
    const t = clamp(Math.round(rawTimeMs), 0, durationMs);
    const prev = byTime.get(t);
    if (!prev || priority > prev.priority) {
      byTime.set(t, { timeMs: t, priority, reason });
    }
  };

  // 1. Flagged issue timestamps get highest priority
  for (const issue of report.issues) {
    const prio = issue.severity === "error" ? 9 : issue.severity === "warning" ? 7 : 4;
    addCandidate(issue.timeMs, prio, issue.code);
  }

  // 2. Opening anticipation & finale
  addCandidate(0, 5, "opening");
  addCandidate(durationMs, 5, "finale");

  // 3. Per-scene narrative peak, prop contact/handoff, callout beat, and scene start
  for (const slice of normalized.slices) {
    if (normalized.isMovie) {
      addCandidate(slice.startMs + Math.round(slice.durationMs * 0.35), 5, `scene:${slice.sceneId ?? slice.sceneIndex}`);
    }
    const prog = slice.program;
    if (prog.contractVersion === CONTRACT_VERSION_V2) {
      const v2 = prog.spec as AnimationSpecV2;
      for (const actor of v2.actors) {
        for (const act of actor.actions) {
          if (PASSIVE_ACTIONS.has(act.action)) continue;
          const peakFrac = HERO_BEAT_ACTIONS.has(act.action) ? 0.58 : 0.5;
          const prio =
            PROP_CONTACT_BEAT_ACTIONS.has(act.action) || act.handoffTo
              ? 6
              : HERO_BEAT_ACTIONS.has(act.action)
                ? 5
                : 3;
          addCandidate(slice.startMs + act.startMs + act.durationMs * peakFrac, prio, act.action);
        }
      }
      for (const callout of resolveCompiledCallouts(prog)) {
        addCandidate(slice.startMs + (callout.startMs + callout.endMs) / 2, 5, `callout:${callout.id}`);
      }
    } else {
      const v1 = prog.spec as AnimationSpec;
      for (const act of v1.actions) {
        addCandidate(slice.startMs + act.startMs + act.durationMs * 0.5, 4, act.action);
      }
    }
  }

  const sorted = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
  const minGapMs = Math.min(80, Math.max(15, Math.floor(durationMs / (cap * 5))));
  const merged: CritiqueBeatCandidate[] = [];
  for (const cand of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(cand);
      continue;
    }
    if (cand.timeMs - prev.timeMs < minGapMs) {
      if (cand.priority > prev.priority) {
        merged[merged.length - 1] = cand;
      }
    } else {
      merged.push(cand);
    }
  }

  if (merged.length <= cap) {
    return merged.map((c) => c.timeMs);
  }

  // Always reserve top issue timestamps first (up to cap - 2), then fill remaining slots evenly across the timeline
  const selected = new Set<number>();
  const issueCandidates = merged.filter((c) => c.priority >= 7).sort((a, b) => b.priority - a.priority || a.timeMs - b.timeMs);
  for (const ic of issueCandidates) {
    if (selected.size >= Math.max(1, cap - 2)) break;
    selected.add(ic.timeMs);
  }

  selected.add(0);
  if (selected.size < cap) selected.add(durationMs);

  const remainingSlots = cap - selected.size;
  if (remainingSlots > 0) {
    const pool = merged.filter((c) => !selected.has(c.timeMs));
    for (let slot = 0; slot < remainingSlots && pool.length > 0; slot++) {
      const idealTime = ((slot + 1) / (remainingSlots + 1)) * durationMs;
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const item = pool[i]!;
        const distPenalty = Math.abs(item.timeMs - idealTime) / Math.max(1, durationMs);
        const minSpacing = Math.min(...[...selected].map((s) => Math.abs(s - item.timeMs)));
        const spacingBonus = Math.min(1, minSpacing / Math.max(1, durationMs / cap));
        const score = item.priority * 40 + spacingBonus * 60 - distPenalty * 50;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      const picked = pool.splice(bestIdx, 1)[0]!;
      selected.add(picked.timeMs);
    }
  }

  return [...selected].sort((a, b) => a - b).slice(0, cap);
}

export function renderCritiqueSheetSvg(
  programOrMovie: CompiledAnimation | CompiledMovie,
  report?: CritiqueReport,
  options: CritiqueSheetOptions = {}
): string {
  const effectiveReport = report ?? evaluateAnimationQuality(programOrMovie);
  const theme: StoryboardTheme = options.theme ?? "default";
  if (theme !== "default" && theme !== "blueprint") {
    throw new TypeError('Critique sheet theme must be "default" or "blueprint".');
  }
  const isBlueprint = theme === "blueprint";
  const normalized = toSceneSlices(programOrMovie);
  const { width: canvasW, height: canvasH } = normalized.canvas;
  const maxPanels = clamp(Math.floor(options.maxPanels ?? 8), 1, 12);
  const columns = Math.max(1, Math.floor(options.columns ?? 4));
  const mode: PlaybackMode = options.mode ?? "normal";

  const timestamps = selectCritiqueTimestamps(programOrMovie, effectiveReport, maxPanels);
  const panelCount = Math.max(1, timestamps.length);
  const cols = Math.min(columns, panelCount);
  const rows = Math.ceil(panelCount / cols);

  const panelW = Math.max(120, Math.round(options.panelWidth ?? 232));
  const sceneH = Math.max(68, Math.round((panelW * canvasH) / canvasW));
  const footerH = 22;
  const panelH = sceneH + footerH;
  const pad = 10;
  const headerH = 44;
  const scale = panelW / canvasW;

  const totalW = cols * panelW + (cols + 1) * pad;
  const totalH = headerH + rows * panelH + (rows + 1) * pad;

  const scoreStr = effectiveReport.overallScore.toFixed(1);
  const badgeStatus = effectiveReport.passed ? "PASS" : "NEEDS POLISH";
  const badgeText = `${scoreStr}/10 ${badgeStatus}`;
  const badgeColor = effectiveReport.passed
    ? "#16a34a"
    : effectiveReport.overallScore >= 6.5
      ? "#f59e0b"
      : "#dc2626";
  const badgeW = Math.max(96, Math.round(badgeText.length * 6.8 + 16));

  const titleText = options.title ?? normalized.title ?? "Stickman Perceptual Critique";
  const d = effectiveReport.dimensions;
  const dimStrip =
    `PROP ${d.propIntegrity.toFixed(1)} · CONT ${d.spatialContinuity.toFixed(1)} · ` +
    `STAGE ${d.stagingAndEyeTrace.toFixed(1)} · PACE ${d.pacingAndReadability.toFixed(1)} · ` +
    `KIN ${d.kinematicAppeal.toFixed(1)} · CINE ${d.cinematography.toFixed(1)}`;

  const issueWindowMs = Math.max(140, Math.round(normalized.durationMs / (panelCount * 2)));
  const hoistedDefs: string[] = [];
  const hoistedBackdropMap = new Map<string, string>();
  const hoistBackdrop = (markup: string): string => {
    if (!markup) return "";
    let id = hoistedBackdropMap.get(markup);
    if (!id) {
      id = `cs-bd-${hoistedDefs.length}`;
      hoistedBackdropMap.set(markup, id);
      hoistedDefs.push(`<g id="${id}">${markup}</g>`);
    }
    return `<use href="#${id}"/>`;
  };
  const compactPanelInner = (raw: string): string =>
    raw
      .replaceAll(' font-family="&quot;Segoe UI&quot;,Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif"', "")
      .replaceAll(' stroke-linecap="round"', "")
      .replaceAll(' stroke-linejoin="round"', "")
      .replace(/\sdata-[a-z-]+="[^"]*"/g, "");

  const panelsMarkup = timestamps
    .map((t, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const px = pad + col * (panelW + pad);
      const py = headerH + pad + row * (panelH + pad);

      let frame: SampledFrame;
      let sceneId: string | undefined;
      let sceneIdx = 0;
      let backdrop: BackdropPreset = "none";
      let defaultColor = "#202124";
      let themeAccentColor: string | undefined;
      let stageBg = isBlueprint ? "#f8fafc" : "#ffffff";

      if (normalized.isMovie && normalized.movie) {
        const mf: SampledMovieFrame = sampleMovie(normalized.movie, t, mode);
        frame = mf;
        sceneId = mf.sceneId;
        sceneIdx = mf.sceneIndex;
        backdrop = mf.backdrop;
        const sc = normalized.movie.scenes[mf.sceneIndex]!;
        const v2Spec =
          sc.program.contractVersion === CONTRACT_VERSION_V2 ? (sc.program.spec as AnimationSpecV2) : undefined;
        defaultColor = sc.program.spec.actor?.color ?? "#202124";
        themeAccentColor = v2Spec?.theme?.accentColor ?? normalized.movie.spec.theme?.accentColor;
        if (!isBlueprint) stageBg = v2Spec?.theme?.background ?? normalized.movie.spec.theme?.background ?? "#ffffff";
      } else {
        const prog = programOrMovie as CompiledAnimation;
        frame = sampleAnimation(prog, t, mode);
        const v2Spec = prog.contractVersion === CONTRACT_VERSION_V2 ? (prog.spec as AnimationSpecV2) : undefined;
        defaultColor = prog.spec.actor?.color ?? "#202124";
        themeAccentColor = v2Spec?.theme?.accentColor;
        if (!isBlueprint) stageBg = v2Spec?.theme?.background ?? "#ffffff";
      }

      const panelIssues = effectiveReport.issues.filter(
        (iss) =>
          (iss.severity === "error" || iss.severity === "warning") &&
          Math.abs(iss.timeMs - t) <= issueWindowMs &&
          (sceneId === undefined || iss.sceneId === undefined || iss.sceneId === sceneId)
      );
      const hasError = panelIssues.some((iss) => iss.severity === "error");
      const hasWarning = panelIssues.some((iss) => iss.severity === "warning");
      const issuePillColor = hasError ? "#dc2626" : "#f59e0b";
      const borderColor = hasError
        ? "#dc2626"
        : hasWarning
          ? "#f59e0b"
          : isBlueprint
            ? "#1e3a5f"
            : "#cbd5e1";

      const rawBackdropMarkup =
        backdrop !== "none"
          ? renderBackdropSvg(backdrop, canvasW, canvasH, frame.groundY, {
              blueprint: isBlueprint,
              ...(themeAccentColor !== undefined ? { accentColor: themeAccentColor } : {}),
              decimals: 0
            })
          : "";
      const backdropMarkup = hoistBackdrop(rawBackdropMarkup);
      const inner = compactPanelInner(
        renderSceneInnerSvg(frame, {
          defaultColor: isBlueprint ? "#0f172a" : defaultColor,
          ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
          blueprint: isBlueprint,
          decimals: 0,
          compact: true
        })
      );
      const groundLine = `<path d="M0 ${num(frame.groundY, 0)}H${canvasW}" stroke="${isBlueprint ? "#1e3a5f" : "#d8dbe0"}" stroke-width="${num(1 / scale, 1)}"/>`;
      const world = `${backdropMarkup}${groundLine}${inner}`;
      const camTransform = frame.camera ? cameraSvgTransform(frame.camera, canvasW, canvasH, 2) : "";
      const panelWorld = frame.camera
        ? `<g data-camera="true"${camTransform ? ` transform="${camTransform}"` : ""}>${world}</g>`
        : world;

      const timeBadge = normalized.isMovie
        ? `S${sceneIdx + 1} · ${(t / 1000).toFixed(2)}s`
        : `${(t / 1000).toFixed(2)}s`;
      const timeBadgeW = Math.max(40, Math.round(timeBadge.length * 6.2 + 10));

      let issuePillMarkup = "";
      if (panelIssues.length > 0) {
        const topCode = panelIssues[0]!.code;
        const pillText = `${panelIssues.length} ${hasError ? "ERR" : "WARN"}`;
        const pillW = Math.max(46, Math.round(pillText.length * 6.2 + 10));
        const pillX = panelW - pillW - 6;
        issuePillMarkup =
          `<rect data-issue-pill="${hasError ? "error" : "warning"}" data-issue-code="${escapeXml(topCode)}" x="${pillX}" y="6" width="${pillW}" height="15" rx="4" fill="${issuePillColor}"/>` +
          `<text class="cs-b" x="${num(pillX + pillW / 2, 1)}" y="14">${escapeXml(pillText)}</text>`;
      }

      const actorSummary =
        frame.actors && frame.actors.length > 0
          ? frame.actors.slice(0, 3).map((a) => `${a.id}:${a.action}`).join(" · ")
          : `actor:${frame.action}`;
      const rawFooter =
        panelIssues.length > 0
          ? `${panelIssues[0]!.code} — ${actorSummary}`
          : sceneId
            ? `${sceneId} — ${actorSummary}`
            : actorSummary;
      const footerLabel = rawFooter.length > 42 ? `${rawFooter.slice(0, 41)}…` : rawFooter;

      return (
        `<g data-panel="${idx}" data-time-ms="${num(t, 0)}"${sceneId ? ` data-scene="${escapeXml(sceneId)}"` : ""} transform="translate(${px} ${py})">` +
        `<rect width="${panelW}" height="${panelH}" rx="6" fill="#f8fafc" stroke="${borderColor}" stroke-width="${hasError || hasWarning ? "1.4" : "1"}"/>` +
        `<g clip-path="url(#sm-cs-clip)">` +
        `<rect width="${panelW}" height="${sceneH}" fill="${escapeXml(stageBg)}"/>` +
        `${isBlueprint ? `<rect width="${panelW}" height="${sceneH}" fill="url(#sm-bp-grid)"/>` : ""}` +
        `<g class="cs-s" transform="scale(${num(scale, 3)})">${panelWorld}</g>` +
        `<rect x="6" y="6" width="${timeBadgeW}" height="15" rx="4" fill="#0f172a" fill-opacity=".82"/>` +
        `<text class="cs-b" data-part="timecode-badge" x="${num(6 + timeBadgeW / 2, 1)}" y="14">${escapeXml(timeBadge)}</text>` +
        `${issuePillMarkup}` +
        `</g>` +
        `<line x1="0" y1="${sceneH}" x2="${panelW}" y2="${sceneH}" stroke="${isBlueprint ? "#1e3a5f" : "#e2e8f0"}"/>` +
        `<text class="cs-l" data-part="panel-label" x="7" y="${sceneH + 14.5}">${escapeXml(footerLabel)}</text>` +
        `</g>`
      );
    })
    .join("");

  const headerBadgeX = totalW - pad - badgeW;
  const headerMarkup =
    `<g data-part="critique-header">` +
    `<text class="cs-t" x="${pad}" y="18">${escapeXml(titleText)}</text>` +
    `<text class="cs-m" x="${pad}" y="34">${escapeXml(dimStrip)}</text>` +
    `<rect data-part="score-badge" data-passed="${effectiveReport.passed}" x="${headerBadgeX}" y="8" width="${badgeW}" height="24" rx="5" fill="${badgeColor}"/>` +
    `<text class="cs-s-txt" x="${num(headerBadgeX + badgeW / 2, 1)}" y="21">${escapeXml(badgeText)}</text>` +
    `<line x1="${pad}" y1="${headerH - 2}" x2="${totalW - pad}" y2="${headerH - 2}" stroke="${isBlueprint ? "#1e3a5f" : "#cbd5e1"}"/>` +
    `</g>`;

  const css =
    `.cs-s{stroke-linecap:round;stroke-linejoin:round}` +
    `.cs-s text{font-family:"Segoe UI",Aptos,Calibri,sans-serif}` +
    `.cs-t{font:700 13px "Segoe UI",Arial,sans-serif;fill:${isBlueprint ? "#0f172a" : "#242424"}}` +
    `.cs-m{font:8.8px Consolas,monospace;fill:${isBlueprint ? "#1e3a5f" : "#5c5c5c"}}` +
    `.cs-b{font:700 8.8px Consolas,monospace;fill:#fff;text-anchor:middle;dominant-baseline:middle}` +
    `.cs-s-txt{font:700 10.5px Consolas,monospace;fill:#fff;text-anchor:middle;dominant-baseline:middle}` +
    `.cs-l{font:9px "Segoe UI",Arial,sans-serif;fill:#334155}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${isBlueprint ? ' data-theme="blueprint"' : ""} data-critique-score="${scoreStr}" data-critique-passed="${effectiveReport.passed}" role="img" aria-label="Stickman critique sheet (${scoreStr}/10 ${badgeStatus}, ${panelCount} panels)" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">` +
    `<defs><clipPath id="sm-cs-clip"><rect width="${panelW}" height="${sceneH}" rx="5"/></clipPath>` +
    `${isBlueprint ? renderBlueprintPatternsSvg() : ""}` +
    `${hoistedDefs.join("")}` +
    `<style>${css}</style></defs>` +
    `<rect width="100%" height="100%" fill="${isBlueprint ? "#f8fafc" : "#f1f5f9"}"/>` +
    `${headerMarkup}${panelsMarkup}</svg>`
  );
}

export async function critiqueAnimation(
  programOrMovie: CompiledAnimation | CompiledMovie,
  options: CritiqueAnimationOptions = {}
): Promise<CritiqueAnimationResult> {
  const report = evaluateAnimationQuality(programOrMovie);
  const svg = renderCritiqueSheetSvg(programOrMovie, report, options);
  const includePng = options.includePng ?? true;

  if (!includePng) {
    return {
      report,
      svg,
      rubric: HUMAN_CRITIQUE_RUBRIC,
      rasterizerAvailable: false
    };
  }

  const raster = await rasterizeStoryboardPng(
    svg,
    options.loadResvg ? { loadResvg: options.loadResvg } : {}
  );
  return {
    report,
    svg,
    rubric: HUMAN_CRITIQUE_RUBRIC,
    ...(raster.pngBase64 !== undefined ? { pngBase64: raster.pngBase64 } : {}),
    rasterizerAvailable: raster.rasterizerAvailable
  };
}
