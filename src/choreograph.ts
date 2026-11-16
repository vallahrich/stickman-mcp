import {
  CONTRACT_VERSION_V2,
  type ActionName,
  type ActorAccessory,
  type ActorChoreographySpec,
  type AddonConfig,
  type AddonType,
  type AnimationSpecV2,
  type ChoreographAction,
  type ChoreographAddonInput,
  type ChoreographAddonItem,
  type ChoreographActorInput,
  type ChoreographInput,
  type ChoreographResult,
  type ChoreographTheme,
  type CompileResult,
  type CompiledActorSpec,
  type CompiledAnimation,
  type Diagnostic,
  type PlaybackMode,
  type Point2D,
  type PropSpec,
  type ResolvedActorAction,
  type SampledActorFrame,
  type SampledAddon,
  type SampledFrame,
  type Segment,
  type StageAnchorName,
  type ValidationResult
} from "./contract.js";
import { markerEvents } from "./events.js";
import { sampleClipMotion } from "./motion-clips.js";
import { RUNTIME_ACTION_NAMES, RUNTIME_MOTION_LIBRARY, getMotionClip, getMotionMeta } from "./motion-library.js";
import {
  ADDON_TYPES,
  PROP_DEFINITIONS,
  defaultAddonsForAction,
  sampleActionAddons,
  type AddonPoseSnapshot,
  type AdjacentActionContext
} from "./props.js";

export const STAGE_ANCHOR_NAMES: readonly StageAnchorName[] = Object.freeze([
  "offstage-left",
  "left",
  "center-left",
  "center",
  "center-right",
  "right",
  "offstage-right",
  "board",
  "door-left",
  "door-right",
  "hoop",
  "goal"
]);

export const ACTOR_ACCESSORIES: readonly ActorAccessory[] = Object.freeze([
  "none",
  "tie",
  "hat",
  "glasses",
  "badge"
]);

export const ENTRANCE_EXIT_ACTIONS: readonly string[] = Object.freeze([
  "walk-on",
  "walk-off",
  "walk",
  "run",
  "jog",
  "sneak"
]);

const ACTION_NAME_SET = new Set<string>(RUNTIME_ACTION_NAMES);
const ADDON_TYPE_SET = new Set<string>(ADDON_TYPES);
const ACCESSORY_SET = new Set<string>(ACTOR_ACCESSORIES);
const ENTRANCE_EXIT_SET = new Set<string>(ENTRANCE_EXIT_ACTIONS);
const PURE_LOCOMOTION_SET = new Set<string>(["walk", "run", "jog", "sneak", "walk-backwards"]);
const ELEVATED_STAGE_ANCHORS = new Set<string>(["board", "hoop", "goal"]);
const HOLD_OR_SEATED_FINAL_ACTIONS = new Set<string>([
  "sit-down",
  "type-at-desk",
  "sit-floor",
  "kneel-down",
  "crouch",
  "hold-pose",
  "static-pose",
  "think",
  "point",
  "present-card"
]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const DEFAULT_CANVAS = Object.freeze({ width: 800, height: 450, fps: 30 });
const DEFAULT_ACTOR_COLOR = "#202124";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string, errors: Diagnostic[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      errors.push({
        path: `${path}.${key}`,
        code: "unknown_field",
        message: `Unknown field "${key}". Remove it or use a supported v2 choreography field.`
      });
    }
  }
}

export function normalizeActionName(raw: string): string {
  const trimmed = raw.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) return trimmed;
  const base = trimmed.slice(0, atIndex);
  const version = trimmed.slice(atIndex + 1);
  if (/^\d+\.\d+\.\d+$/.test(version)) return base;
  return trimmed;
}

function closestActions(value: string): string[] {
  const needle = normalizeActionName(value).toLowerCase();
  const distance = (a: string, b: string): number => {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) rows[0]![j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        rows[i]![j] = Math.min(
          rows[i - 1]![j]! + 1,
          rows[i]![j - 1]! + 1,
          rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return rows[a.length]![b.length]!;
  };
  return [...ACTION_NAME_SET]
    .map((id) => ({ id, score: distance(needle, id.toLowerCase()) }))
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((item) => item.id);
}

export function resolveStageAnchors(
  canvas: { width?: number; height?: number } = {},
  groundY?: number,
  customAnchors?: Record<string, Point2D | { x: number; y?: number }>
): Record<string, Point2D> {
  const width = finiteNumber(canvas.width) ? canvas.width : DEFAULT_CANVAS.width;
  const height = finiteNumber(canvas.height) ? canvas.height : DEFAULT_CANVAS.height;
  const floorY = finiteNumber(groundY) ? groundY : Math.round(height * 0.82);

  const anchors: Record<string, Point2D> = {
    "offstage-left": { x: -48, y: floorY },
    left: { x: Math.round(width * 0.18), y: floorY },
    "center-left": { x: Math.round(width * 0.35), y: floorY },
    center: { x: Math.round(width * 0.5), y: floorY },
    "center-right": { x: Math.round(width * 0.65), y: floorY },
    right: { x: Math.round(width * 0.82), y: floorY },
    "offstage-right": { x: width + 48, y: floorY },
    board: { x: Math.round(width * 0.62), y: Math.max(24, Math.round(floorY - height * 0.28)) },
    "door-left": { x: Math.round(width * 0.08), y: floorY },
    "door-right": { x: Math.round(width * 0.92), y: floorY },
    hoop: { x: Math.round(width * 0.84), y: Math.max(24, Math.round(floorY - height * 0.38)) },
    goal: { x: Math.round(width * 0.86), y: Math.max(24, Math.round(floorY - height * 0.14)) }
  };

  if (customAnchors && isRecord(customAnchors)) {
    for (const [name, raw] of Object.entries(customAnchors)) {
      if (isRecord(raw) && finiteNumber(raw.x)) {
        anchors[name] = {
          x: raw.x,
          y: finiteNumber(raw.y) ? raw.y : floorY
        };
      }
    }
  }

  return anchors;
}

function actorRigBaseScale(
  canvasWidth: number,
  actorGroundY: number,
  actions: readonly { action: string }[]
): number {
  const headroom = actions.some((a) => a.action === "stairs-up" || a.action === "stairs-down")
    ? 208
    : actions.some((a) => a.action === "jump" || a.action === "long-jump" || a.action === "basketball-shot" || a.action === "climb-ladder")
      ? 192
      : 174;
  return Math.min(1, canvasWidth / 180, (actorGroundY - 4) / headroom);
}

function isTravelActionName(actionName: string): boolean {
  const meta = getMotionMeta(actionName);
  return actionName === "walk" || actionName === "run" || (meta?.travel === "travel" && actionName !== "push");
}

function clipPoseDxSpan(actionName: string): number {
  const clip = getMotionClip(actionName);
  if (!clip?.poseKeys || clip.poseKeys.length < 2) return 0;
  const first = clip.poseKeys[0]!.pose;
  const last = clip.poseKeys[clip.poseKeys.length - 1]!.pose;
  const f0 = clamp(first.facing ?? 1, -1, 1);
  const f1 = clamp(last.facing ?? 1, -1, 1);
  const x0 = f0 * (first.dx ?? 0);
  const x1 = f1 * (last.dx ?? 0);
  const net = x1 - x0;
  if (clip.meta?.facingChange === 180 || f0 * f1 < 0) {
    return Math.max(16, net);
  }
  return net;
}

function computeNaturalDurationMs(
  actionName: string,
  distance: number,
  effectiveScale: number,
  speed: number
): number {
  const clip = getMotionClip(actionName);
  const clipFrames = clip?.frames.length ?? 60;
  const clipFps = clip?.fps ?? 30;
  const rawClipDuration = Math.round((clipFrames / clipFps) * 1000 / speed);

  if (actionName === "hold-pose" || actionName === "static-pose") {
    return Math.max(300, Math.round(1000 / speed));
  }

  if (PURE_LOCOMOTION_SET.has(actionName)) {
    const basePxPerSec =
      actionName === "run"
        ? 220
        : actionName === "jog"
          ? 165
          : actionName === "sneak" || actionName === "walk-backwards"
            ? 75
            : 115;
    const effectiveSpeedPxPerSec = Math.max(20, basePxPerSec * Math.max(0.25, effectiveScale) * speed);
    const fromDistance = distance > 1 ? Math.round((distance / effectiveSpeedPxPerSec) * 1000) : rawClipDuration;
    return clamp(Math.max(400, rawClipDuration, fromDistance), 300, 120000);
  }

  return clamp(Math.max(300, rawClipDuration), 300, 120000);
}

function synthesizeForwardAimTarget(
  actionName: string,
  rootX: number,
  facing: -1 | 1,
  actorGroundY: number,
  effectiveScale: number,
  canvas: { width: number; height: number }
): Point2D {
  const meta = getMotionMeta(actionName);
  const forwardOffset = Math.max(36, Math.round(120 * effectiveScale));
  let x = rootX + facing * forwardOffset;
  if (facing > 0) {
    x = rootX <= canvas.width - 12 ? clamp(x, Math.min(canvas.width - 8, rootX + 16), canvas.width - 8) : canvas.width - 4;
  } else {
    x = rootX >= 12 ? clamp(x, 8, Math.max(8, rootX - 16)) : 4;
  }
  const verticalLift = meta?.aim === "head" ? 108 * effectiveScale : 96 * effectiveScale;
  const y = clamp(Math.round(actorGroundY - verticalLift), 16, canvas.height - 16);
  return { x, y };
}

function computeCueOffsetMs(
  actionName: string,
  durationMs: number,
  speed: number,
  emitCueAt: string | undefined,
  path: string,
  diagnostics: Diagnostic[]
): number {
  const cueAt = emitCueAt ?? "end";
  if (cueAt === "start") return 0;
  if (cueAt === "end") return durationMs;

  const clip = getMotionClip(actionName);
  const markers = clip?.markers ?? clip?.meta?.markers;
  if (!clip || !markers || !Object.hasOwn(markers, cueAt)) {
    const supported = markers ? Object.keys(markers).join(", ") : "none";
    diagnostics.push({
      path: `${path}.emitCueAt`,
      code: "invalid_cue_marker",
      message: `Action "${actionName}" does not define marker "${cueAt}". Use "start", "end", or a clip marker (${supported}).`
    });
    return durationMs;
  }

  const frame = markers[cueAt]!;
  const n = clip.frames.length;
  if (n < 2) return durationMs;
  let progress = 1;
  if (clip.loop && clip.meta?.kind !== "hold") {
    const cycles = clip.poseKeys?.length
      ? Math.max(1, Math.round((durationMs * speed) / ((n / clip.fps) * 1000)))
      : speed;
    progress = clamp01(frame / (cycles * n));
  } else {
    progress = clamp01(frame / ((n - 1) * speed));
  }
  return Math.round(progress * durationMs);
}

const ADDON_SOCKET_VALUES = ["rHand", "lHand", "bothHands", "aboveHead", "eyes", "wrist", "rFoot", "lFoot", "stage"] as const;
const ADDON_LAYER_VALUES = ["back", "front"] as const;
const ADDON_HINGE_VALUES = ["left", "right"] as const;
const ADDON_ENTER_VALUES = ["pop", "fade", "slide", "instant"] as const;
const ADDON_SLIDE_VALUES = ["left", "right", "top", "bottom"] as const;
const ADDON_EXIT_VALUES = ["shrink", "fade", "tip", "persist", "instant"] as const;

const ADDON_SOCKET_SET = new Set<string>(ADDON_SOCKET_VALUES);
const ADDON_LAYER_SET = new Set<string>(ADDON_LAYER_VALUES);
const ADDON_HINGE_SET = new Set<string>(ADDON_HINGE_VALUES);
const ADDON_ENTER_SET = new Set<string>(ADDON_ENTER_VALUES);
const ADDON_SLIDE_SET = new Set<string>(ADDON_SLIDE_VALUES);
const ADDON_EXIT_SET = new Set<string>(ADDON_EXIT_VALUES);

const ADDON_CONFIG_KEYS = [
  "id",
  "type",
  "actorId",
  "socket",
  "layer",
  "x",
  "y",
  "dx",
  "dy",
  "width",
  "height",
  "rotation",
  "scale",
  "opacity",
  "color",
  "secondaryColor",
  "text",
  "hinge",
  "open",
  "ink",
  "netBulge",
  "enter",
  "enterAt",
  "enterDuration",
  "slideFrom",
  "exit",
  "exitAt",
  "exitDuration",
  "persist",
  "attachWindow",
  "flight",
  "impact",
  "keyframes"
] as const;

function validateAddonPoint2D(value: unknown, pointPath: string, diagnostics: Diagnostic[]): void {
  if (!isRecord(value)) {
    diagnostics.push({
      path: pointPath,
      code: "invalid_type",
      message: "Point must be an object with finite numeric x and y."
    });
    return;
  }
  hasOnlyKeys(value, ["x", "y"], pointPath, diagnostics);
  if (!finiteNumber(value.x)) {
    diagnostics.push({ path: `${pointPath}.x`, code: "invalid_number", message: "x must be a finite number." });
  }
  if (!finiteNumber(value.y)) {
    diagnostics.push({ path: `${pointPath}.y`, code: "invalid_number", message: "y must be a finite number." });
  }
}

function validateAddonConfigFields(item: Record<string, unknown>, itemPath: string, diagnostics: Diagnostic[]): boolean {
  const startLen = diagnostics.length;
  hasOnlyKeys(item, ADDON_CONFIG_KEYS, itemPath, diagnostics);

  for (const strKey of ["id", "actorId"] as const) {
    const val = item[strKey];
    if (val !== undefined && (typeof val !== "string" || !val.trim())) {
      diagnostics.push({
        path: `${itemPath}.${strKey}`,
        code: "invalid_type",
        message: `${strKey} must be a non-empty string.`
      });
    }
  }

  for (const strKey of ["color", "secondaryColor"] as const) {
    const val = item[strKey];
    if (val !== undefined && (typeof val !== "string" || !val.trim())) {
      diagnostics.push({
        path: `${itemPath}.${strKey}`,
        code: "invalid_type",
        message: `${strKey} must be a non-empty color string.`
      });
    }
  }

  if (item.text !== undefined && typeof item.text !== "string") {
    diagnostics.push({
      path: `${itemPath}.text`,
      code: "invalid_type",
      message: "addon.text must be a string."
    });
  }

  if (item.socket !== undefined && (typeof item.socket !== "string" || !ADDON_SOCKET_SET.has(item.socket))) {
    diagnostics.push({
      path: `${itemPath}.socket`,
      code: "invalid_enum",
      message: `addon.socket must be one of: ${ADDON_SOCKET_VALUES.join(", ")}.`
    });
  }

  if (item.layer !== undefined && (typeof item.layer !== "string" || !ADDON_LAYER_SET.has(item.layer))) {
    diagnostics.push({
      path: `${itemPath}.layer`,
      code: "invalid_enum",
      message: `addon.layer must be one of: ${ADDON_LAYER_VALUES.join(", ")}.`
    });
  }

  if (item.hinge !== undefined && (typeof item.hinge !== "string" || !ADDON_HINGE_SET.has(item.hinge))) {
    diagnostics.push({
      path: `${itemPath}.hinge`,
      code: "invalid_enum",
      message: `addon.hinge must be one of: ${ADDON_HINGE_VALUES.join(", ")}.`
    });
  }

  if (item.enter !== undefined && (typeof item.enter !== "string" || !ADDON_ENTER_SET.has(item.enter))) {
    diagnostics.push({
      path: `${itemPath}.enter`,
      code: "invalid_enum",
      message: `addon.enter must be one of: ${ADDON_ENTER_VALUES.join(", ")}.`
    });
  }

  if (item.slideFrom !== undefined && (typeof item.slideFrom !== "string" || !ADDON_SLIDE_SET.has(item.slideFrom))) {
    diagnostics.push({
      path: `${itemPath}.slideFrom`,
      code: "invalid_enum",
      message: `addon.slideFrom must be one of: ${ADDON_SLIDE_VALUES.join(", ")}.`
    });
  }

  if (item.exit !== undefined && (typeof item.exit !== "string" || !ADDON_EXIT_SET.has(item.exit))) {
    diagnostics.push({
      path: `${itemPath}.exit`,
      code: "invalid_enum",
      message: `addon.exit must be one of: ${ADDON_EXIT_VALUES.join(", ")}.`
    });
  }

  if (item.persist !== undefined && typeof item.persist !== "boolean") {
    diagnostics.push({
      path: `${itemPath}.persist`,
      code: "invalid_type",
      message: "addon.persist must be a boolean."
    });
  }

  for (const numKey of ["x", "y", "dx", "dy", "rotation"] as const) {
    const val = item[numKey];
    if (val !== undefined && !finiteNumber(val)) {
      diagnostics.push({
        path: `${itemPath}.${numKey}`,
        code: "invalid_number",
        message: `addon.${numKey} must be a finite number.`
      });
    }
  }

  for (const posKey of ["width", "height", "scale"] as const) {
    const val = item[posKey];
    if (val !== undefined) {
      if (!finiteNumber(val)) {
        diagnostics.push({
          path: `${itemPath}.${posKey}`,
          code: "invalid_number",
          message: `addon.${posKey} must be a finite positive number.`
        });
      } else if (val <= 0) {
        diagnostics.push({
          path: `${itemPath}.${posKey}`,
          code: "out_of_range",
          message: `addon.${posKey} must be greater than 0.`
        });
      }
    }
  }

  for (const unitKey of ["opacity", "open", "ink", "enterAt", "enterDuration", "exitAt", "exitDuration"] as const) {
    const val = item[unitKey];
    if (val !== undefined) {
      if (!finiteNumber(val)) {
        diagnostics.push({
          path: `${itemPath}.${unitKey}`,
          code: "invalid_number",
          message: `addon.${unitKey} must be a finite number from 0 to 1.`
        });
      } else if (val < 0 || val > 1) {
        diagnostics.push({
          path: `${itemPath}.${unitKey}`,
          code: "out_of_range",
          message: `addon.${unitKey} must be between 0 and 1.`
        });
      }
    }
  }

  if (item.netBulge !== undefined) {
    if (!finiteNumber(item.netBulge)) {
      diagnostics.push({
        path: `${itemPath}.netBulge`,
        code: "invalid_number",
        message: "addon.netBulge must be a finite non-negative number."
      });
    } else if (item.netBulge < 0) {
      diagnostics.push({
        path: `${itemPath}.netBulge`,
        code: "out_of_range",
        message: "addon.netBulge must be >= 0."
      });
    }
  }

  if (item.attachWindow !== undefined) {
    const awPath = `${itemPath}.attachWindow`;
    if (!isRecord(item.attachWindow)) {
      diagnostics.push({ path: awPath, code: "invalid_type", message: "addon.attachWindow must be an object." });
    } else {
      hasOnlyKeys(item.attachWindow, ["from", "until", "pinOnRelease", "pinnedPoint"], awPath, diagnostics);
      for (const k of ["from", "until"] as const) {
        const v = item.attachWindow[k];
        if (v !== undefined) {
          if (!finiteNumber(v)) {
            diagnostics.push({ path: `${awPath}.${k}`, code: "invalid_number", message: `${k} must be a finite number from 0 to 1.` });
          } else if (v < 0 || v > 1) {
            diagnostics.push({ path: `${awPath}.${k}`, code: "out_of_range", message: `${k} must be between 0 and 1.` });
          }
        }
      }
      if (item.attachWindow.pinOnRelease !== undefined && typeof item.attachWindow.pinOnRelease !== "boolean") {
        diagnostics.push({ path: `${awPath}.pinOnRelease`, code: "invalid_type", message: "pinOnRelease must be a boolean." });
      }
      if (item.attachWindow.pinnedPoint !== undefined) {
        validateAddonPoint2D(item.attachWindow.pinnedPoint, `${awPath}.pinnedPoint`, diagnostics);
      }
    }
  }

  if (item.flight !== undefined) {
    const flPath = `${itemPath}.flight`;
    if (!isRecord(item.flight)) {
      diagnostics.push({ path: flPath, code: "invalid_type", message: "addon.flight must be an object." });
    } else {
      hasOnlyKeys(item.flight, ["from", "to", "target", "apex", "spin", "releaseOffset", "dropToGroundAt"], flPath, diagnostics);
      for (const reqKey of ["from", "to"] as const) {
        const v = item.flight[reqKey];
        if (!finiteNumber(v)) {
          diagnostics.push({ path: `${flPath}.${reqKey}`, code: "invalid_number", message: `flight.${reqKey} is required and must be a finite number from 0 to 1.` });
        } else if (v < 0 || v > 1) {
          diagnostics.push({ path: `${flPath}.${reqKey}`, code: "out_of_range", message: `flight.${reqKey} must be between 0 and 1.` });
        }
      }
      if (item.flight.target !== undefined) {
        if (typeof item.flight.target === "string") {
          if (!item.flight.target.trim()) {
            diagnostics.push({ path: `${flPath}.target`, code: "invalid_type", message: "flight.target string must be non-empty." });
          }
        } else if (isRecord(item.flight.target)) {
          validateAddonPoint2D(item.flight.target, `${flPath}.target`, diagnostics);
        } else {
          diagnostics.push({ path: `${flPath}.target`, code: "invalid_type", message: "flight.target must be a target id string or { x, y } point." });
        }
      }
      for (const k of ["apex", "spin"] as const) {
        if (item.flight[k] !== undefined && !finiteNumber(item.flight[k])) {
          diagnostics.push({ path: `${flPath}.${k}`, code: "invalid_number", message: `flight.${k} must be a finite number.` });
        }
      }
      if (item.flight.releaseOffset !== undefined) {
        validateAddonPoint2D(item.flight.releaseOffset, `${flPath}.releaseOffset`, diagnostics);
      }
      if (item.flight.dropToGroundAt !== undefined) {
        if (!finiteNumber(item.flight.dropToGroundAt)) {
          diagnostics.push({ path: `${flPath}.dropToGroundAt`, code: "invalid_number", message: "flight.dropToGroundAt must be a finite number from 0 to 1." });
        } else if (item.flight.dropToGroundAt < 0 || item.flight.dropToGroundAt > 1) {
          diagnostics.push({ path: `${flPath}.dropToGroundAt`, code: "out_of_range", message: "flight.dropToGroundAt must be between 0 and 1." });
        }
      }
    }
  }

  if (item.impact !== undefined) {
    const imPath = `${itemPath}.impact`;
    if (!isRecord(item.impact)) {
      diagnostics.push({ path: imPath, code: "invalid_type", message: "addon.impact must be an object." });
    } else {
      hasOnlyKeys(item.impact, ["at", "duration", "peakBulge"], imPath, diagnostics);
      if (!finiteNumber(item.impact.at)) {
        diagnostics.push({ path: `${imPath}.at`, code: "invalid_number", message: "impact.at is required and must be a finite number from 0 to 1." });
      } else if (item.impact.at < 0 || item.impact.at > 1) {
        diagnostics.push({ path: `${imPath}.at`, code: "out_of_range", message: "impact.at must be between 0 and 1." });
      }
      if (item.impact.duration !== undefined) {
        if (!finiteNumber(item.impact.duration)) {
          diagnostics.push({ path: `${imPath}.duration`, code: "invalid_number", message: "impact.duration must be a finite number from 0 to 1." });
        } else if (item.impact.duration < 0 || item.impact.duration > 1) {
          diagnostics.push({ path: `${imPath}.duration`, code: "out_of_range", message: "impact.duration must be between 0 and 1." });
        }
      }
      if (item.impact.peakBulge !== undefined) {
        if (!finiteNumber(item.impact.peakBulge)) {
          diagnostics.push({ path: `${imPath}.peakBulge`, code: "invalid_number", message: "impact.peakBulge must be a finite non-negative number." });
        } else if (item.impact.peakBulge < 0) {
          diagnostics.push({ path: `${imPath}.peakBulge`, code: "out_of_range", message: "impact.peakBulge must be >= 0." });
        }
      }
    }
  }

  if (item.keyframes !== undefined) {
    const kfBasePath = `${itemPath}.keyframes`;
    if (!Array.isArray(item.keyframes)) {
      diagnostics.push({ path: kfBasePath, code: "invalid_type", message: "addon.keyframes must be an array of keyframe objects." });
    } else {
      for (let kIdx = 0; kIdx < item.keyframes.length; kIdx++) {
        const kf = item.keyframes[kIdx];
        const kfPath = `${kfBasePath}[${kIdx}]`;
        if (!isRecord(kf)) {
          diagnostics.push({ path: kfPath, code: "invalid_type", message: "Each addon keyframe must be an object." });
          continue;
        }
        hasOnlyKeys(kf, ["at", "x", "y", "rotation", "scale", "opacity", "open", "ink", "netBulge"], kfPath, diagnostics);
        if (!finiteNumber(kf.at)) {
          diagnostics.push({ path: `${kfPath}.at`, code: "invalid_number", message: "keyframe.at is required and must be a finite number from 0 to 1." });
        } else if (kf.at < 0 || kf.at > 1) {
          diagnostics.push({ path: `${kfPath}.at`, code: "out_of_range", message: "keyframe.at must be between 0 and 1." });
        }
        for (const numK of ["x", "y", "rotation"] as const) {
          if (kf[numK] !== undefined && !finiteNumber(kf[numK])) {
            diagnostics.push({ path: `${kfPath}.${numK}`, code: "invalid_number", message: `keyframe.${numK} must be a finite number.` });
          }
        }
        if (kf.scale !== undefined) {
          if (!finiteNumber(kf.scale)) {
            diagnostics.push({ path: `${kfPath}.scale`, code: "invalid_number", message: "keyframe.scale must be a finite non-negative number." });
          } else if (kf.scale < 0) {
            diagnostics.push({ path: `${kfPath}.scale`, code: "out_of_range", message: "keyframe.scale must be >= 0." });
          }
        }
        for (const unitK of ["opacity", "open", "ink"] as const) {
          if (kf[unitK] !== undefined) {
            if (!finiteNumber(kf[unitK])) {
              diagnostics.push({ path: `${kfPath}.${unitK}`, code: "invalid_number", message: `keyframe.${unitK} must be a finite number from 0 to 1.` });
            } else if (kf[unitK] < 0 || kf[unitK] > 1) {
              diagnostics.push({ path: `${kfPath}.${unitK}`, code: "out_of_range", message: `keyframe.${unitK} must be between 0 and 1.` });
            }
          }
        }
        if (kf.netBulge !== undefined) {
          if (!finiteNumber(kf.netBulge)) {
            diagnostics.push({ path: `${kfPath}.netBulge`, code: "invalid_number", message: "keyframe.netBulge must be a finite non-negative number." });
          } else if (kf.netBulge < 0) {
            diagnostics.push({ path: `${kfPath}.netBulge`, code: "out_of_range", message: "keyframe.netBulge must be >= 0." });
          }
        }
      }
    }
  }

  return diagnostics.length === startLen;
}

interface NormalizedAddonResolution {
  enabled: boolean;
  overrides?: AddonConfig[];
  mergeDefaults: boolean;
  persist: boolean;
}

function normalizeActionAddon(
  actionName: string,
  addonInput: unknown,
  actionPersist: boolean | undefined,
  sceneAddons: "auto" | "none",
  path: string,
  diagnostics: Diagnostic[]
): NormalizedAddonResolution {
  const basePersist = Boolean(actionPersist);
  if (addonInput === undefined) {
    return {
      enabled: sceneAddons === "auto",
      mergeDefaults: true,
      persist: basePersist
    };
  }
  if (addonInput === false || addonInput === "none") {
    return { enabled: false, mergeDefaults: false, persist: false };
  }
  if (addonInput === true || addonInput === "auto") {
    return { enabled: true, mergeDefaults: true, persist: basePersist };
  }

  const convertItem = (item: unknown, itemPath: string): AddonConfig[] => {
    if (typeof item === "string") {
      if (!ADDON_TYPE_SET.has(item)) {
        diagnostics.push({
          path: itemPath,
          code: "unsupported_addon",
          message: `Unsupported addon type "${item}". Supported types: ${ADDON_TYPES.join(", ")}.`
        });
        return [];
      }
      return [{ type: item as AddonType, ...(basePersist ? { persist: true } : {}) }];
    }
    if (isRecord(item)) {
      if (item.type !== undefined) {
        const typeValid = typeof item.type === "string" && ADDON_TYPE_SET.has(item.type);
        if (!typeValid) {
          diagnostics.push({
            path: `${itemPath}.type`,
            code: "unsupported_addon",
            message: `Unsupported addon type "${String(item.type)}". Supported types: ${ADDON_TYPES.join(", ")}.`
          });
        }
        const fieldsValid = validateAddonConfigFields(item, itemPath, diagnostics);
        if (!typeValid || !fieldsValid) return [];
        const cfg = { ...(item as unknown as AddonConfig), type: item.type as AddonType };
        if (basePersist && cfg.persist === undefined) cfg.persist = true;
        return [cfg];
      }
      const fieldsValid = validateAddonConfigFields(item, itemPath, diagnostics);
      const defaults = defaultAddonsForAction(actionName);
      if (defaults.length === 0) {
        diagnostics.push({
          path: itemPath,
          code: "missing_addon_type",
          message: `Addon override on "${actionName}" must include "type" because "${actionName}" has no default addon.`
        });
        return [];
      }
      if (!fieldsValid) return [];
      return defaults.map((def) => ({
        ...def,
        ...(item as Partial<AddonConfig>),
        type: def.type,
        ...(basePersist && item.persist === undefined ? { persist: true } : {})
      }));
    }
    diagnostics.push({
      path: itemPath,
      code: "invalid_type",
      message: "addon must be a boolean, \"auto\", \"none\", an addon type string, an addon config object, or an array of addons."
    });
    return [];
  };

  if (Array.isArray(addonInput)) {
    const items = addonInput.flatMap((entry, idx) => convertItem(entry, `${path}.addon[${idx}]`));
    const anyPersist = basePersist || items.some((c) => Boolean(c.persist));
    return {
      enabled: items.length > 0,
      overrides: items,
      mergeDefaults: sceneAddons === "auto",
      persist: anyPersist
    };
  }

  const overrides = convertItem(addonInput, `${path}.addon`);
  const anyPersist = basePersist || overrides.some((c) => Boolean(c.persist));
  return {
    enabled: overrides.length > 0,
    overrides,
    mergeDefaults: sceneAddons === "auto",
    persist: anyPersist
  };
}

interface PendingActionNode {
  actorIdx: number;
  actionIdx: number;
  path: string;
  action: ActionName;
  rawStartMs?: number;
  durationMs: number;
  delayMs: number;
  from?: Point2D;
  to?: Point2D;
  target?: string;
  speed?: number;
  blendMs?: number;
  afterCue?: string;
  emitCue?: string;
  emitCueAt?: "start" | "end" | string;
  cueOffsetMs: number;
  addon?: ChoreographAddonInput;
  persist?: boolean;
  startMs: number;
  endMs: number;
}

export function choreographAnimation(input: unknown): ChoreographResult {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(input)) {
    return {
      valid: false,
      diagnostics: [{ path: "$", code: "invalid_type", message: "Choreography input must be a JSON object." }]
    };
  }

  hasOnlyKeys(
    input,
    ["version", "canvas", "durationMs", "groundY", "theme", "addons", "anchors", "targets", "actors", "actor", "actions", "prop"],
    "$",
    diagnostics
  );

  if (input.version !== undefined && input.version !== CONTRACT_VERSION_V2) {
    diagnostics.push({
      path: "$.version",
      code: "unsupported_version",
      message: `Expected "${CONTRACT_VERSION_V2}".`
    });
  }

  let width: number = DEFAULT_CANVAS.width;
  let height: number = DEFAULT_CANVAS.height;
  let fps: number = DEFAULT_CANVAS.fps;
  if (input.canvas !== undefined) {
    if (!isRecord(input.canvas)) {
      diagnostics.push({ path: "$.canvas", code: "invalid_type", message: "canvas must be an object." });
    } else {
      hasOnlyKeys(input.canvas, ["width", "height", "fps"], "$.canvas", diagnostics);
      for (const [field, min, max, fallback] of [
        ["width", 64, 4096, DEFAULT_CANVAS.width],
        ["height", 64, 4096, DEFAULT_CANVAS.height],
        ["fps", 1, 60, DEFAULT_CANVAS.fps]
      ] as const) {
        const val = input.canvas[field];
        if (val !== undefined) {
          if (!finiteNumber(val) || !Number.isInteger(val) || val < min || val > max) {
            diagnostics.push({
              path: `$.canvas.${field}`,
              code: "out_of_range",
              message: `${field} must be an integer from ${min} to ${max}.`
            });
          } else {
            if (field === "width") width = val;
            else if (field === "height") height = val;
            else fps = val;
          }
        } else {
          if (field === "width") width = fallback;
          else if (field === "height") height = fallback;
          else fps = fallback;
        }
      }
    }
  }
  const canvas = { width, height, fps };

  let sceneGroundY = Math.round(height * 0.82);
  if (input.groundY !== undefined) {
    if (!finiteNumber(input.groundY)) {
      diagnostics.push({ path: "$.groundY", code: "invalid_number", message: "groundY must be a finite number." });
    } else if (input.groundY < 0 || input.groundY > height) {
      diagnostics.push({ path: "$.groundY", code: "outside_canvas", message: "groundY must lie inside the canvas height." });
    } else {
      sceneGroundY = input.groundY;
    }
  }

  let theme: ChoreographTheme | undefined;
  if (input.theme !== undefined) {
    if (!isRecord(input.theme)) {
      diagnostics.push({ path: "$.theme", code: "invalid_type", message: "theme must be an object." });
    } else {
      hasOnlyKeys(input.theme, ["accentColor", "background"], "$.theme", diagnostics);
      for (const field of ["accentColor", "background"] as const) {
        const val = input.theme[field];
        if (val !== undefined && (typeof val !== "string" || !HEX_COLOR.test(val))) {
          diagnostics.push({
            path: `$.theme.${field}`,
            code: "invalid_color",
            message: `theme.${field} must be a six-digit hex color such as #b11f4b.`
          });
        }
      }
      theme = {
        ...(typeof input.theme.accentColor === "string" ? { accentColor: input.theme.accentColor } : {}),
        ...(typeof input.theme.background === "string" ? { background: input.theme.background } : {})
      };
    }
  }

  let sceneAddons: "auto" | "none" = "auto";
  if (input.addons !== undefined) {
    if (input.addons !== "auto" && input.addons !== "none") {
      diagnostics.push({
        path: "$.addons",
        code: "invalid_addons_mode",
        message: 'addons must be "auto" or "none".'
      });
    } else {
      sceneAddons = input.addons;
    }
  }

  if (input.durationMs !== undefined) {
    if (!finiteNumber(input.durationMs) || !Number.isInteger(input.durationMs) || input.durationMs < 100 || input.durationMs > 120000) {
      diagnostics.push({
        path: "$.durationMs",
        code: "out_of_range",
        message: "durationMs must be an integer from 100 to 120000."
      });
    }
  }

  const customAnchorsRaw: Record<string, Point2D> = {};
  for (const field of ["anchors", "targets"] as const) {
    const mapVal = input[field];
    if (mapVal === undefined) continue;
    if (!isRecord(mapVal)) {
      diagnostics.push({ path: `$.${field}`, code: "invalid_type", message: `${field} must map anchor names to x/y coordinates.` });
      continue;
    }
    for (const [name, pt] of Object.entries(mapVal)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
        diagnostics.push({
          path: `$.${field}.${name}`,
          code: "invalid_name",
          message: "Anchor/target names must start with a letter and contain only letters, digits, hyphens, or underscores."
        });
        continue;
      }
      if (!isRecord(pt) || !finiteNumber(pt.x) || (pt.y !== undefined && !finiteNumber(pt.y))) {
        diagnostics.push({
          path: `$.${field}.${name}`,
          code: "invalid_target",
          message: "Anchor/target coordinates require a finite numeric x and optional numeric y."
        });
        continue;
      }
      hasOnlyKeys(pt, ["x", "y"], `$.${field}.${name}`, diagnostics);
      const resolvedY = finiteNumber(pt.y) ? pt.y : sceneGroundY;
      customAnchorsRaw[name] = { x: pt.x, y: resolvedY };
    }
  }

  const anchors = resolveStageAnchors(canvas, sceneGroundY, customAnchorsRaw);

  let rawActors: Array<{ spec: unknown; basePath: string }> = [];
  if (input.actors !== undefined) {
    if (!Array.isArray(input.actors)) {
      diagnostics.push({ path: "$.actors", code: "invalid_type", message: "actors must be an array of 1 to 8 actors." });
    } else if (input.actors.length < 1 || input.actors.length > 8) {
      diagnostics.push({
        path: "$.actors",
        code: "out_of_range",
        message: "actors must contain between 1 and 8 actors."
      });
    } else {
      rawActors = input.actors.map((spec, idx) => ({ spec, basePath: `$.actors[${idx}]` }));
    }
  } else if (input.actions !== undefined) {
    if (!Array.isArray(input.actions)) {
      diagnostics.push({ path: "$.actions", code: "required_array", message: "actions must be an array." });
    } else {
      const shorthandActor: ChoreographActorInput = isRecord(input.actor) ? (input.actor as ChoreographActorInput) : {};
      if (input.actor !== undefined && !isRecord(input.actor)) {
        diagnostics.push({ path: "$.actor", code: "invalid_type", message: "actor must be an object." });
      }
      rawActors = [
        {
          spec: {
            ...shorthandActor,
            id: typeof shorthandActor.id === "string" && shorthandActor.id.trim() ? shorthandActor.id : "actor",
            actions: input.actions
          },
          basePath: input.actor !== undefined ? "$.actor" : "$"
        }
      ];
    }
  } else {
    diagnostics.push({
      path: "$",
      code: "missing_actors_or_actions",
      message: "Provide either multi-actor `actors` (1..8) or single-actor `actions`."
    });
  }

  const resolvePointRef = (
    ref: unknown,
    actorFloorY: number,
    forTravel: boolean,
    isEntranceExit: boolean,
    refPath: string
  ): Point2D | undefined => {
    if (typeof ref === "string") {
      if (!Object.hasOwn(anchors, ref)) {
        diagnostics.push({
          path: refPath,
          code: "unbound_target",
          message: `Unknown stage anchor or target "${ref}". Supported stage anchors: ${STAGE_ANCHOR_NAMES.join(", ")}.`
        });
        return undefined;
      }
      const base = anchors[ref]!;
      const isOffstage = ref === "offstage-left" || ref === "offstage-right" || base.x < 0 || base.x > width;
      if (isOffstage && !isEntranceExit) {
        diagnostics.push({
          path: refPath,
          code: "target_outside_canvas",
          message: `Offstage anchor "${ref}" is only allowed on entrance/exit locomotion (${ENTRANCE_EXIT_ACTIONS.join(", ")}).`
        });
        return undefined;
      }
      if (base.y < 0 || base.y > height) {
        diagnostics.push({
          path: refPath,
          code: "target_outside_canvas",
          message: `Target "${ref}" y=${base.y} lies outside canvas height 0..${height}.`
        });
        return undefined;
      }
      if (forTravel && (ELEVATED_STAGE_ANCHORS.has(ref) || !Object.hasOwn(customAnchorsRaw, ref))) {
        return { x: base.x, y: actorFloorY };
      }
      return forTravel ? { x: base.x, y: base.y } : { ...base };
    }

    if (isRecord(ref)) {
      hasOnlyKeys(ref, ["x", "y"], refPath, diagnostics);
      if (!finiteNumber(ref.x) || (ref.y !== undefined && !finiteNumber(ref.y))) {
        diagnostics.push({
          path: refPath,
          code: "invalid_target",
          message: "Inline target must provide finite numeric x and optional numeric y."
        });
        return undefined;
      }
      const y = finiteNumber(ref.y) ? ref.y : actorFloorY;
      const isOffstageX = ref.x < 0 || ref.x > width;
      if (isOffstageX && (!isEntranceExit || ref.x < -240 || ref.x > width + 240)) {
        diagnostics.push({
          path: refPath,
          code: "target_outside_canvas",
          message: `Target x=${ref.x} lies outside canvas 0..${width}; offstage coordinates are only supported for entrance/exit locomotion.`
        });
        return undefined;
      }
      if (y < 0 || y > height) {
        diagnostics.push({
          path: refPath,
          code: "target_outside_canvas",
          message: `Target y=${y} lies outside canvas 0..${height}.`
        });
        return undefined;
      }
      return { x: ref.x, y: forTravel && ref.y === undefined ? actorFloorY : y };
    }

    diagnostics.push({
      path: refPath,
      code: "invalid_target",
      message: "Target must be an anchor name or { x, y? } coordinates."
    });
    return undefined;
  };

  const seenActorIds = new Set<string>();
  const compiledActorsDraft: Array<{
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
    nodes: PendingActionNode[];
  }> = [];
  const allNodes: PendingActionNode[] = [];

  for (let actorIdx = 0; actorIdx < rawActors.length; actorIdx++) {
    const { spec: rawActor, basePath } = rawActors[actorIdx]!;
    const actionsArrayPath = input.actors !== undefined ? `${basePath}.actions` : "$.actions";
    if (!isRecord(rawActor)) {
      diagnostics.push({ path: basePath, code: "invalid_type", message: "Each actor must be an object." });
      continue;
    }

    hasOnlyKeys(
      rawActor,
      ["id", "label", "x", "groundY", "color", "accessory", "accentColor", "scale", "zIndex", "facing", "actions"],
      basePath === "$" ? "$.actor" : basePath,
      diagnostics
    );

    const idPath = basePath === "$" ? "$.actor.id" : `${basePath}.id`;
    const actorId = typeof rawActor.id === "string" && rawActor.id.trim() ? rawActor.id.trim() : "";
    if (!actorId) {
      diagnostics.push({ path: idPath, code: "invalid_id", message: "Actor id must be a non-empty string." });
      continue;
    }
    if (seenActorIds.has(actorId)) {
      diagnostics.push({
        path: idPath,
        code: "duplicate_actor_id",
        message: `Duplicate actor id "${actorId}". Every actor in $.actors must have a unique id.`
      });
      continue;
    }
    seenActorIds.add(actorId);

    if (rawActor.label !== undefined && typeof rawActor.label !== "string") {
      diagnostics.push({ path: `${basePath}.label`, code: "invalid_type", message: "Actor label must be a string." });
    }

    let actorGroundY = sceneGroundY;
    if (rawActor.groundY !== undefined) {
      if (!finiteNumber(rawActor.groundY)) {
        diagnostics.push({ path: `${basePath}.groundY`, code: "invalid_number", message: "actor.groundY must be a finite number." });
      } else if (rawActor.groundY < 0 || rawActor.groundY > height) {
        diagnostics.push({ path: `${basePath}.groundY`, code: "outside_canvas", message: "actor.groundY must lie inside the canvas." });
      } else {
        actorGroundY = rawActor.groundY;
      }
    }

    let actorColor = DEFAULT_ACTOR_COLOR;
    if (rawActor.color !== undefined) {
      if (typeof rawActor.color !== "string" || !HEX_COLOR.test(rawActor.color)) {
        diagnostics.push({
          path: `${basePath}.color`,
          code: "invalid_color",
          message: "Use a six-digit hex color such as #202124."
        });
      } else {
        actorColor = rawActor.color;
      }
    }

    let accessory: ActorAccessory | undefined;
    if (rawActor.accessory !== undefined) {
      if (typeof rawActor.accessory !== "string" || !ACCESSORY_SET.has(rawActor.accessory)) {
        diagnostics.push({
          path: `${basePath}.accessory`,
          code: "invalid_accessory",
          message: `Unsupported accessory "${String(rawActor.accessory)}". Supported: ${ACTOR_ACCESSORIES.join(", ")}.`
        });
      } else {
        accessory = rawActor.accessory as ActorAccessory;
      }
    }

    let accentColor = theme?.accentColor;
    if (rawActor.accentColor !== undefined) {
      if (typeof rawActor.accentColor !== "string" || !HEX_COLOR.test(rawActor.accentColor)) {
        diagnostics.push({
          path: `${basePath}.accentColor`,
          code: "invalid_color",
          message: "actor.accentColor must be a six-digit hex color such as #b11f4b."
        });
      } else {
        accentColor = rawActor.accentColor;
      }
    }

    let userScale = 1;
    if (rawActor.scale !== undefined) {
      if (!finiteNumber(rawActor.scale) || rawActor.scale < 0.25 || rawActor.scale > 2.5) {
        diagnostics.push({
          path: `${basePath}.scale`,
          code: "out_of_range",
          message: "actor.scale must be a finite number from 0.25 to 2.5."
        });
      } else {
        userScale = rawActor.scale;
      }
    }

    let zIndex = 0;
    if (rawActor.zIndex !== undefined) {
      if (!finiteNumber(rawActor.zIndex)) {
        diagnostics.push({ path: `${basePath}.zIndex`, code: "invalid_number", message: "actor.zIndex must be a finite number." });
      } else {
        zIndex = rawActor.zIndex;
      }
    }

    if (!Array.isArray(rawActor.actions)) {
      diagnostics.push({ path: actionsArrayPath, code: "required_array", message: "Actor actions must be an array." });
      continue;
    }

    const rawActionsList: unknown[] = rawActor.actions;
    const normalizedActionNames = rawActionsList.map((item) =>
      isRecord(item) && typeof item.action === "string" ? normalizeActionName(item.action) : ""
    );

    const baseRigScale = actorRigBaseScale(width, actorGroundY, normalizedActionNames.map((action) => ({ action })));
    if (baseRigScale * userScale < 0.2) {
      diagnostics.push({
        path: `${basePath}.groundY`,
        code: "rig_too_small",
        message: "This floor leaves too little headroom for a readable rig (minimum effective scale 0.2)."
      });
    }
    const effectiveScale = Math.max(0.2, baseRigScale * userScale);

    const firstActionName = normalizedActionNames[0] ?? "";
    const firstActionEntrance = ENTRANCE_EXIT_SET.has(firstActionName);
    const firstRawObj = isRecord(rawActionsList[0]) ? rawActionsList[0] : undefined;

    let initialX: number;
    if (rawActor.x !== undefined) {
      const actorXPath = basePath === "$" ? "$.actor.x" : `${basePath}.x`;
      if (typeof rawActor.x === "number") {
        if (!finiteNumber(rawActor.x)) {
          diagnostics.push({ path: actorXPath, code: "invalid_number", message: "actor.x must be a finite number or anchor name." });
          initialX = anchors["center-left"]!.x;
        } else {
          const isOffstage = rawActor.x < 0 || rawActor.x > width;
          if (isOffstage && (!firstActionEntrance || rawActor.x < -240 || rawActor.x > width + 240)) {
            diagnostics.push({
              path: actorXPath,
              code: "outside_canvas",
              message: "actor.x must lie inside the canvas unless the actor's first action is an entrance locomotion."
            });
          }
          initialX = rawActor.x;
        }
      } else if (typeof rawActor.x === "string") {
        const pt = resolvePointRef(rawActor.x, actorGroundY, true, firstActionEntrance, actorXPath);
        initialX = pt?.x ?? anchors["center-left"]!.x;
      } else {
        diagnostics.push({ path: actorXPath, code: "invalid_type", message: "actor.x must be a number or stage anchor name." });
        initialX = anchors["center-left"]!.x;
      }
    } else if (firstRawObj?.from !== undefined) {
      const fromPt = resolvePointRef(firstRawObj.from, actorGroundY, true, firstActionEntrance, `${actionsArrayPath}[0].from`);
      initialX = fromPt?.x ?? anchors["offstage-left"]!.x;
    } else if (firstActionName === "walk-on") {
      const firstToRef = firstRawObj?.to ?? firstRawObj?.target;
      const peekX = typeof firstToRef === "string" ? anchors[firstToRef]?.x : isRecord(firstToRef) && finiteNumber(firstToRef.x) ? firstToRef.x : undefined;
      initialX = peekX !== undefined && peekX > width * 0.7 ? anchors["offstage-right"]!.x : anchors["offstage-left"]!.x;
    } else if (rawActors.length === 1) {
      initialX = anchors["center-left"]!.x;
    } else {
      const defaultSlots: StageAnchorName[] = ["center-left", "center-right", "left", "right", "center"];
      const slot = defaultSlots[actorIdx % defaultSlots.length]!;
      initialX = anchors[slot]!.x;
    }

    let initialFacing: -1 | 1;
    if (rawActor.facing !== undefined) {
      if (rawActor.facing === 1 || rawActor.facing === "right") initialFacing = 1;
      else if (rawActor.facing === -1 || rawActor.facing === "left") initialFacing = -1;
      else {
        diagnostics.push({
          path: `${basePath}.facing`,
          code: "invalid_facing",
          message: 'actor.facing must be 1, -1, "right", or "left".'
        });
        initialFacing = 1;
      }
    } else if (initialX > width) {
      initialFacing = -1;
    } else if (initialX < 0) {
      initialFacing = 1;
    } else if (rawActors.length > 1 && actorIdx > 0 && compiledActorsDraft[0] && initialX > compiledActorsDraft[0].x) {
      initialFacing = -1;
    } else {
      initialFacing = 1;
    }

    let curX = initialX;
    let curFacing: -1 | 1 = initialFacing;
    const actorNodes: PendingActionNode[] = [];

    for (let i = 0; i < rawActionsList.length; i++) {
      const actionPath = `${actionsArrayPath}[${i}]`;
      const rawAct = rawActionsList[i];
      if (!isRecord(rawAct)) {
        diagnostics.push({ path: actionPath, code: "invalid_type", message: "Each action must be an object." });
        continue;
      }

      hasOnlyKeys(
        rawAct,
        [
          "action",
          "startMs",
          "durationMs",
          "delayMs",
          "from",
          "to",
          "target",
          "speed",
          "blendMs",
          "afterCue",
          "emitCue",
          "emitCueAt",
          "addon",
          "persist"
        ],
        actionPath,
        diagnostics
      );

      const rawName = typeof rawAct.action === "string" ? rawAct.action : "";
      const actionName = normalizeActionName(rawName);
      if (!rawName || !ACTION_NAME_SET.has(actionName)) {
        diagnostics.push({
          path: `${actionPath}.action`,
          code: "unsupported_action",
          message: `Unsupported action "${rawName}". Did you mean ${closestActions(rawName).join(", ")}? Supported actions: ${[...ACTION_NAME_SET].join(", ")}.`
        });
        continue;
      }

      let speed: number | undefined;
      if (rawAct.speed !== undefined) {
        if (!finiteNumber(rawAct.speed) || rawAct.speed < 0.5 || rawAct.speed > 2) {
          diagnostics.push({ path: `${actionPath}.speed`, code: "out_of_range", message: "speed must be a number from 0.5 to 2." });
        } else {
          speed = rawAct.speed;
        }
      }
      const effectiveSpeed = speed ?? 1;

      let blendMs: number | undefined;
      if (rawAct.blendMs !== undefined) {
        if (!finiteNumber(rawAct.blendMs) || !Number.isInteger(rawAct.blendMs) || rawAct.blendMs < 0 || rawAct.blendMs > 5000) {
          diagnostics.push({ path: `${actionPath}.blendMs`, code: "out_of_range", message: "blendMs must be an integer from 0 to 5000." });
        } else {
          blendMs = rawAct.blendMs;
        }
      }

      let delayMs = 0;
      if (rawAct.delayMs !== undefined) {
        if (!finiteNumber(rawAct.delayMs) || !Number.isInteger(rawAct.delayMs) || rawAct.delayMs < 0 || rawAct.delayMs > 60000) {
          diagnostics.push({ path: `${actionPath}.delayMs`, code: "out_of_range", message: "delayMs must be an integer from 0 to 60000." });
        } else {
          delayMs = rawAct.delayMs;
        }
      }

      let rawStartMs: number | undefined;
      if (rawAct.startMs !== undefined) {
        if (!finiteNumber(rawAct.startMs) || !Number.isInteger(rawAct.startMs) || rawAct.startMs < 0) {
          diagnostics.push({ path: `${actionPath}.startMs`, code: "invalid_time", message: "startMs must be a non-negative integer." });
        } else {
          rawStartMs = rawAct.startMs;
        }
      }

      let explicitDurationMs: number | undefined;
      if (rawAct.durationMs !== undefined) {
        if (!finiteNumber(rawAct.durationMs) || !Number.isInteger(rawAct.durationMs) || rawAct.durationMs < 100 || rawAct.durationMs > 120000) {
          diagnostics.push({ path: `${actionPath}.durationMs`, code: "invalid_duration", message: "durationMs must be an integer from 100 to 120000." });
        } else {
          explicitDurationMs = rawAct.durationMs;
        }
      }

      if (rawAct.persist !== undefined && typeof rawAct.persist !== "boolean") {
        diagnostics.push({ path: `${actionPath}.persist`, code: "invalid_type", message: "persist must be a boolean." });
      }

      const isEntranceExit = ENTRANCE_EXIT_SET.has(actionName);
      const isTravel = isTravelActionName(actionName);
      const meta = getMotionMeta(actionName);

      let resolvedFrom: Point2D | undefined;
      if (rawAct.from !== undefined) {
        resolvedFrom = resolvePointRef(rawAct.from, actorGroundY, true, isEntranceExit, `${actionPath}.from`);
        if (resolvedFrom) curX = resolvedFrom.x;
      }

      const startX = curX;
      if ((startX < 0 || startX > width) && !isEntranceExit) {
        diagnostics.push({
          path: actionPath,
          code: "outside_canvas",
          message: `Actor "${actorId}" is offstage (x=${startX}) before "${actionName}". Use an entrance locomotion (${ENTRANCE_EXIT_ACTIONS.join(", ")}) to enter the canvas first.`
        });
      }
      let resolvedTo: Point2D | undefined;
      let targetLabel: string | undefined;

      if (rawAct.target !== undefined && typeof rawAct.target !== "string") {
        diagnostics.push({ path: `${actionPath}.target`, code: "invalid_type", message: "target must be an anchor or target name string." });
      }

      const rawDest = rawAct.to !== undefined ? rawAct.to : rawAct.target;
      const rawDestPath = rawAct.to !== undefined ? `${actionPath}.to` : `${actionPath}.target`;
      if (typeof rawAct.target === "string") targetLabel = rawAct.target;
      else if (typeof rawAct.to === "string") targetLabel = rawAct.to;

      if (rawDest !== undefined) {
        resolvedTo = resolvePointRef(rawDest, actorGroundY, isTravel, isEntranceExit, rawDestPath);
        if (isTravel && resolvedTo && Math.abs(resolvedTo.y - actorGroundY) > 0.001) {
          diagnostics.push({
            path: rawDestPath,
            code: "non_flat_ground",
            message: `Travel locomotion "${actionName}" requires flat ground y=${actorGroundY} (got y=${resolvedTo.y}).`
          });
        }
      } else if (isTravel) {
        if (actionName === "walk-on") {
          resolvedTo = startX > width / 2 ? { ...anchors.right!, y: actorGroundY } : { ...anchors.left!, y: actorGroundY };
        } else if (actionName === "walk-off") {
          resolvedTo = curFacing < 0 ? { ...anchors["offstage-left"]!, y: actorGroundY } : { ...anchors["offstage-right"]!, y: actorGroundY };
        } else if (PURE_LOCOMOTION_SET.has(actionName)) {
          diagnostics.push({
            path: `${actionPath}.to`,
            code: "unbound_target",
            message: `Locomotion "${actionName}" requires a \`to\` or \`target\` stage anchor or point.`
          });
        } else {
          const dxSpan = clipPoseDxSpan(actionName);
          const naturalEndX = clamp(Math.round(startX + curFacing * dxSpan * effectiveScale), 24, width - 24);
          resolvedTo = { x: naturalEndX, y: actorGroundY };
        }
      } else if (actionName === "point" || Boolean(meta?.aim)) {
        // Sign 7: auto-synthesize a forward target for aim gestures when omitted in v2
        resolvedTo = synthesizeForwardAimTarget(actionName, startX, curFacing, actorGroundY, effectiveScale, canvas);
      }

      const endX = isTravel && resolvedTo ? resolvedTo.x : startX;
      const distance = Math.abs(endX - startX);
      const durationMs = explicitDurationMs ?? computeNaturalDurationMs(actionName, distance, effectiveScale, effectiveSpeed);

      let direction: -1 | 1 = curFacing;
      if (isTravel && distance > 1e-6) {
        direction = Math.sign(endX - startX) as -1 | 1;
      } else if (!isTravel && resolvedTo && Math.abs(resolvedTo.x - startX) > 1e-6) {
        direction = Math.sign(resolvedTo.x - startX) as -1 | 1;
      }

      curX = endX;
      curFacing = meta?.facingChange === 180 ? (-direction as -1 | 1) : direction;

      const addonRes = normalizeActionAddon(
        actionName,
        rawAct.addon,
        typeof rawAct.persist === "boolean" ? rawAct.persist : undefined,
        sceneAddons,
        actionPath,
        diagnostics
      );

      let afterCue: string | undefined;
      if (rawAct.afterCue !== undefined) {
        if (typeof rawAct.afterCue !== "string" || !rawAct.afterCue.trim()) {
          diagnostics.push({
            path: `${actionPath}.afterCue`,
            code: "invalid_cue_reference",
            message: "afterCue must be a non-empty cue name."
          });
        } else {
          afterCue = rawAct.afterCue.trim();
        }
      }

      let emitCue: string | undefined;
      if (rawAct.emitCue !== undefined) {
        if (typeof rawAct.emitCue !== "string" || !rawAct.emitCue.trim()) {
          diagnostics.push({
            path: `${actionPath}.emitCue`,
            code: "invalid_cue_name",
            message: "emitCue must be a non-empty cue name."
          });
        } else {
          emitCue = rawAct.emitCue.trim();
        }
      }

      let emitCueAt: string | undefined;
      if (rawAct.emitCueAt !== undefined) {
        if (typeof rawAct.emitCueAt !== "string" || !rawAct.emitCueAt.trim()) {
          diagnostics.push({
            path: `${actionPath}.emitCueAt`,
            code: "invalid_cue_marker",
            message: 'emitCueAt must be "start", "end", or a clip marker name.'
          });
        } else {
          emitCueAt = rawAct.emitCueAt.trim();
        }
      }

      const cueOffsetMs = emitCue
        ? computeCueOffsetMs(actionName, durationMs, effectiveSpeed, emitCueAt, actionPath, diagnostics)
        : durationMs;

      const node: PendingActionNode = {
        actorIdx: compiledActorsDraft.length,
        actionIdx: actorNodes.length,
        path: actionPath,
        action: actionName,
        ...(rawStartMs !== undefined ? { rawStartMs } : {}),
        durationMs,
        delayMs,
        ...(resolvedFrom ? { from: resolvedFrom } : {}),
        ...(resolvedTo ? { to: resolvedTo } : {}),
        ...(targetLabel ? { target: targetLabel } : {}),
        ...(speed !== undefined ? { speed } : {}),
        ...(blendMs !== undefined ? { blendMs } : {}),
        ...(afterCue !== undefined ? { afterCue } : {}),
        ...(emitCue !== undefined ? { emitCue } : {}),
        ...(emitCueAt !== undefined ? { emitCueAt } : {}),
        cueOffsetMs,
        ...(rawAct.addon !== undefined ? { addon: rawAct.addon as ChoreographAddonInput } : {}),
        ...(addonRes.persist ? { persist: true } : {}),
        startMs: 0,
        endMs: 0
      };

      actorNodes.push(node);
      allNodes.push(node);
    }

    compiledActorsDraft.push({
      id: actorId,
      ...(typeof rawActor.label === "string" ? { label: rawActor.label } : {}),
      x: initialX,
      groundY: actorGroundY,
      color: actorColor,
      ...(accessory !== undefined ? { accessory } : {}),
      ...(accentColor !== undefined ? { accentColor } : {}),
      scale: userScale,
      zIndex,
      facing: initialFacing,
      nodes: actorNodes
    });
  }

  // Pass 2: Resolve cue emitters, check missing/duplicate/cyclic cues, and compute exact timestamps
  const cueEmitters = new Map<string, PendingActionNode>();
  for (const node of allNodes) {
    if (!node.emitCue) continue;
    if (cueEmitters.has(node.emitCue)) {
      diagnostics.push({
        path: `${node.path}.emitCue`,
        code: "duplicate_cue",
        message: `Cue "${node.emitCue}" is already emitted by another action; cue names must be unique.`
      });
    } else {
      cueEmitters.set(node.emitCue, node);
    }
  }

  for (const node of allNodes) {
    if (node.afterCue && !cueEmitters.has(node.afterCue)) {
      diagnostics.push({
        path: `${node.path}.afterCue`,
        code: "invalid_cue_reference",
        message: `Unknown cue "${node.afterCue}". Emit it from an action via emitCue.`
      });
    }
  }

  if (diagnostics.length === 0) {
    const state = new Map<PendingActionNode, "visiting" | "visited">();
    const reportedCycleNodes = new Set<PendingActionNode>();

    const dependenciesOf = (node: PendingActionNode): PendingActionNode[] => {
      const deps: PendingActionNode[] = [];
      const actorDraft = compiledActorsDraft[node.actorIdx]!;
      if (node.actionIdx > 0 && node.rawStartMs === undefined) {
        deps.push(actorDraft.nodes[node.actionIdx - 1]!);
      }
      if (node.afterCue) {
        const emitter = cueEmitters.get(node.afterCue);
        if (emitter) deps.push(emitter);
      }
      return deps;
    };

    const visit = (node: PendingActionNode, stack: PendingActionNode[]): void => {
      const curState = state.get(node);
      if (curState === "visited") return;
      if (curState === "visiting") {
        const cycleStart = stack.indexOf(node);
        const cycleSlice = cycleStart >= 0 ? stack.slice(cycleStart) : [node];
        for (const cyc of cycleSlice) {
          if (cyc.afterCue && !reportedCycleNodes.has(cyc)) {
            reportedCycleNodes.add(cyc);
            diagnostics.push({
              path: `${cyc.path}.afterCue`,
              code: "cyclic_cue_dependency",
              message: `Cyclic cue dependency detected involving cue "${cyc.afterCue}".`
            });
          }
        }
        return;
      }

      state.set(node, "visiting");
      stack.push(node);
      for (const dep of dependenciesOf(node)) {
        visit(dep, stack);
      }
      stack.pop();

      const actorDraft = compiledActorsDraft[node.actorIdx]!;
      const prevEnd = node.actionIdx > 0 ? actorDraft.nodes[node.actionIdx - 1]!.endMs : 0;
      if (node.rawStartMs !== undefined) {
        node.startMs = node.rawStartMs;
      } else if (node.afterCue) {
        const emitter = cueEmitters.get(node.afterCue)!;
        const cueTimeMs = emitter.startMs + emitter.cueOffsetMs;
        node.startMs = Math.round(Math.max(prevEnd, cueTimeMs) + node.delayMs);
      } else {
        node.startMs = Math.round(prevEnd + node.delayMs);
      }
      node.endMs = node.startMs + node.durationMs;
      state.set(node, "visited");
    };

    for (const node of allNodes) {
      visit(node, []);
    }
  }

  if (diagnostics.length > 0) {
    return { valid: false, diagnostics };
  }

  let maxTimelineEndMs = 0;
  for (const actorDraft of compiledActorsDraft) {
    let lastEnd = 0;
    for (const node of actorDraft.nodes) {
      if (node.startMs < lastEnd) {
        diagnostics.push({
          path: `${node.path}.startMs`,
          code: "overlapping_actions",
          message: `Action "${node.action}" starts at ${node.startMs}ms before previous action ends at ${lastEnd}ms.`
        });
      }
      lastEnd = Math.max(lastEnd, node.endMs);
      maxTimelineEndMs = Math.max(maxTimelineEndMs, node.endMs);
    }
  }

  let durationMs: number;
  if (finiteNumber(input.durationMs)) {
    durationMs = input.durationMs;
    for (const node of allNodes) {
      if (node.endMs > durationMs) {
        diagnostics.push({
          path: node.path,
          code: "action_exceeds_duration",
          message: `Action "${node.action}" ends at ${node.endMs}ms after animation durationMs (${durationMs}ms).`
        });
      }
    }
  } else {
    durationMs = maxTimelineEndMs > 0 ? clamp(Math.ceil(maxTimelineEndMs), 300, 120000) : 1000;
  }

  if (diagnostics.length > 0) {
    return { valid: false, diagnostics };
  }

  const compiledActors: CompiledActorSpec[] = compiledActorsDraft.map((actorDraft) => ({
    id: actorDraft.id,
    ...(actorDraft.label !== undefined ? { label: actorDraft.label } : {}),
    x: actorDraft.x,
    groundY: actorDraft.groundY,
    color: actorDraft.color,
    ...(actorDraft.accessory !== undefined ? { accessory: actorDraft.accessory } : {}),
    ...(actorDraft.accentColor !== undefined ? { accentColor: actorDraft.accentColor } : {}),
    scale: actorDraft.scale,
    zIndex: actorDraft.zIndex,
    facing: actorDraft.facing,
    actions: actorDraft.nodes.map((node): ResolvedActorAction => ({
      action: node.action,
      startMs: node.startMs,
      durationMs: node.durationMs,
      ...(node.from ? { from: { ...node.from } } : {}),
      ...(node.to ? { to: { ...node.to } } : {}),
      ...(node.target !== undefined ? { target: node.target } : {}),
      ...(node.speed !== undefined ? { speed: node.speed } : {}),
      ...(node.blendMs !== undefined ? { blendMs: node.blendMs } : {}),
      ...(node.afterCue !== undefined ? { afterCue: node.afterCue } : {}),
      ...(node.emitCue !== undefined ? { emitCue: node.emitCue } : {}),
      ...(node.emitCueAt !== undefined ? { emitCueAt: node.emitCueAt } : {}),
      ...(node.addon !== undefined ? { addon: node.addon } : {}),
      ...(node.persist ? { persist: true } : {})
    }))
  }));

  const primary = compiledActors[0]!;
  const spec: AnimationSpecV2 = {
    version: CONTRACT_VERSION_V2,
    canvas,
    durationMs,
    groundY: sceneGroundY,
    ...(theme && Object.keys(theme).length > 0 ? { theme } : {}),
    addons: sceneAddons,
    ...(Object.keys(customAnchorsRaw).length > 0 ? { anchors: customAnchorsRaw } : {}),
    actor: {
      id: primary.id,
      ...(primary.label !== undefined ? { label: primary.label } : {}),
      x: primary.x,
      groundY: primary.groundY,
      color: primary.color,
      ...(primary.accessory !== undefined ? { accessory: primary.accessory } : {}),
      ...(primary.accentColor !== undefined ? { accentColor: primary.accentColor } : {}),
      scale: primary.scale,
      zIndex: primary.zIndex,
      facing: primary.facing
    },
    ...(isRecord(input.prop) ? { prop: structuredClone(input.prop as unknown as PropSpec) } : {}),
    actors: compiledActors,
    actions: primary.actions.map((act) => structuredClone(act))
  };

  const program: CompiledAnimation = {
    contractVersion: CONTRACT_VERSION_V2,
    spec
  };
  const events = markerEvents(spec, RUNTIME_MOTION_LIBRARY);
  if (events.length > 0) program.events = events;

  return {
    valid: true,
    diagnostics: [],
    spec,
    program,
    anchors
  };
}

export function validateV2Animation(input: unknown): ValidationResult {
  const res = choreographAnimation(input);
  return { valid: res.valid, diagnostics: res.diagnostics };
}

export function compileV2Animation(input: unknown): CompileResult {
  const res = choreographAnimation(input);
  if (!res.valid || !res.program) {
    return { valid: false, diagnostics: res.diagnostics };
  }
  return { valid: true, diagnostics: [], program: res.program };
}

// ============================================================================
// Multi-Actor V2 Deterministic Sampler
// ============================================================================

interface ActorActionTrajectory {
  item: ResolvedActorAction;
  index: number;
  startX: number;
  endX: number;
  direction: -1 | 1;
  afterFacing: -1 | 1;
  isTravel: boolean;
  pointTarget?: Point2D;
  addonEnabled: boolean;
  addonOverrides?: AddonConfig[];
  addonMergeDefaults: boolean;
  addonPersist: boolean;
}

interface RawActorPose {
  action: ActionName | "idle";
  x: number;
  groundY: number;
  head: Point2D;
  segments: Segment[];
  facing: number;
  articulated: boolean;
  activeIndex: number;
  prevCompletedIndex: number;
  nextPendingIndex: number;
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

function extractPoseKinematics(pose: RawActorPose, effectiveScale: number) {
  const byId = new Map(pose.segments.map((s) => [s.id, s]));
  const torso = byId.get("torso")!;
  const pelvis = { x: torso.x1, y: torso.y1 };
  const chest = { x: torso.x2, y: torso.y2 };
  const torsoDx = chest.x - pelvis.x;
  const torsoDy = chest.y - pelvis.y;
  const tLen = Math.hypot(torsoDx, torsoDy) || 45 * effectiveScale;
  const tAngle = Math.atan2(torsoDx, -torsoDy);
  const neckDx = pose.head.x - chest.x;
  const neckDy = pose.head.y - chest.y;
  const nLen = Math.hypot(neckDx, neckDy) || 20.5 * effectiveScale;
  const nRel = wrapAngle(Math.atan2(neckDx, -neckDy) - tAngle);

  const arm = (side: "left" | "right") => {
    const ua = byId.get(`${side}-upper-arm`)!;
    const fa = byId.get(`${side}-forearm`)!;
    const shOff = { x: ua.x1 - chest.x, y: ua.y1 - chest.y };
    const uDx = ua.x2 - ua.x1;
    const uDy = ua.y2 - ua.y1;
    const uLen = Math.hypot(uDx, uDy) || 28 * effectiveScale;
    const uAngle = Math.atan2(uDx, uDy);
    const fDx = fa.x2 - fa.x1;
    const fDy = fa.y2 - fa.y1;
    const fLen = Math.hypot(fDx, fDy) || 28 * effectiveScale;
    const bend = wrapAngle(Math.atan2(fDx, fDy) - uAngle);
    return { shOff, uLen, uAngle, fLen, bend };
  };

  const leg = (side: "left" | "right") => {
    const th = byId.get(`${side}-thigh`)!;
    const sh = byId.get(`${side}-shin`)!;
    const hipOff = { x: th.x1 - pelvis.x, y: th.y1 - pelvis.y };
    const tDx = th.x2 - th.x1;
    const tDy = th.y2 - th.y1;
    const l1 = Math.hypot(tDx, tDy) || 36 * effectiveScale;
    const l1Angle = Math.atan2(tDx, tDy);
    const sDx = sh.x2 - sh.x1;
    const sDy = sh.y2 - sh.y1;
    const l2 = Math.hypot(sDx, sDy) || 36 * effectiveScale;
    const kneeBend = wrapAngle(Math.atan2(sDx, sDy) - l1Angle);
    return { hipOff, tLen: l1, tAngle: l1Angle, sLen: l2, kneeBend };
  };

  return {
    x: pose.x,
    pelvis,
    torsoLen: tLen,
    torsoAngle: tAngle,
    neckLen: nLen,
    neckRel: nRel,
    leftArm: arm("left"),
    rightArm: arm("right"),
    leftLeg: leg("left"),
    rightLeg: leg("right"),
    facing: pose.facing
  };
}

function solveTwoBoneFloorClamp(
  rootPt: Point2D,
  jointFk: Point2D,
  endFk: Point2D,
  l1: number,
  l2: number,
  floorY: number,
  defaultBranch: number
): { joint: Point2D; end: Point2D } {
  if (endFk.y <= floorY) return { joint: jointFk, end: endFk };
  const target = { x: endFk.x, y: floorY };
  const dx = target.x - rootPt.x;
  const dy = target.y - rootPt.y;
  const rawD = Math.hypot(dx, dy) || 1e-9;
  const d = Math.max(Math.abs(l1 - l2) + 1e-6, Math.min(l1 + l2 - 1e-6, rawD));
  const ux = dx / rawD;
  const uy = dy / rawD;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = { x: uy, y: -ux };
  const dot = (jointFk.x - rootPt.x) * perp.x + (jointFk.y - rootPt.y) * perp.y;
  const branch = Math.abs(dot) > 1e-6 ? Math.sign(dot) : defaultBranch;
  return {
    joint: { x: rootPt.x + ux * a + perp.x * h * branch, y: rootPt.y + uy * a + perp.y * h * branch },
    end: { x: rootPt.x + ux * d, y: rootPt.y + uy * d }
  };
}

function inertializeActorPose(
  prior: RawActorPose,
  start: RawActorPose,
  curr: RawActorPose,
  w: number,
  effectiveScale: number
): RawActorPose {
  const Kp = extractPoseKinematics(prior, effectiveScale);
  const Ks = extractPoseKinematics(start, effectiveScale);
  const Kc = extractPoseKinematics(curr, effectiveScale);
  const inertVal = (p: number, s: number, c: number): number => c + w * (p - s);
  const inertLen = (p: number, s: number, c: number): number =>
    Math.max(Math.min(p, s, c), Math.min(Math.max(p, s, c), c + w * (p - s)));
  const inertAng = (p: number, s: number, c: number): number => c + w * wrapAngle(p - s);

  const floorY = curr.groundY;
  const blendedFacing = clamp(inertVal(Kp.facing, Ks.facing, Kc.facing), -1, 1);
  const dirSign = Math.sign(blendedFacing) || 1;
  const pelvis = {
    x: inertVal(Kp.pelvis.x, Ks.pelvis.x, Kc.pelvis.x),
    y: Math.min(floorY, inertVal(Kp.pelvis.y, Ks.pelvis.y, Kc.pelvis.y))
  };

  const evalLeg = (side: "leftLeg" | "rightLeg") => {
    const lp = Kp[side];
    const ls = Ks[side];
    const lc = Kc[side];
    const hipPt = {
      x: pelvis.x + inertVal(lp.hipOff.x, ls.hipOff.x, lc.hipOff.x),
      y: Math.min(floorY, pelvis.y + inertVal(lp.hipOff.y, ls.hipOff.y, lc.hipOff.y))
    };
    const l1 = inertLen(lp.tLen, ls.tLen, lc.tLen);
    const l2 = inertLen(lp.sLen, ls.sLen, lc.sLen);
    const ang1 = inertAng(lp.tAngle, ls.tAngle, lc.tAngle);
    const bend = inertAng(lp.kneeBend, ls.kneeBend, lc.kneeBend);
    const kneeFk = { x: hipPt.x + Math.sin(ang1) * l1, y: hipPt.y + Math.cos(ang1) * l1 };
    const ankleFk = { x: kneeFk.x + Math.sin(ang1 + bend) * l2, y: kneeFk.y + Math.cos(ang1 + bend) * l2 };
    return { hipPt, ...solveTwoBoneFloorClamp(hipPt, kneeFk, ankleFk, l1, l2, floorY, dirSign) };
  };

  let lLeg = evalLeg("leftLeg");
  let rLeg = evalLeg("rightLeg");
  const kneeExcess = Math.max(0, lLeg.joint.y - floorY, rLeg.joint.y - floorY);
  if (kneeExcess > 0) {
    pelvis.y -= kneeExcess;
    lLeg = evalLeg("leftLeg");
    rLeg = evalLeg("rightLeg");
  }

  const tLen = inertLen(Kp.torsoLen, Ks.torsoLen, Kc.torsoLen);
  const tAng = inertAng(Kp.torsoAngle, Ks.torsoAngle, Kc.torsoAngle);
  const chest = { x: pelvis.x + Math.sin(tAng) * tLen, y: pelvis.y - Math.cos(tAng) * tLen };
  const nLen = inertLen(Kp.neckLen, Ks.neckLen, Kc.neckLen);
  const nWorld = tAng + inertAng(Kp.neckRel, Ks.neckRel, Kc.neckRel);
  const headPt = { x: chest.x + Math.sin(nWorld) * nLen, y: chest.y - Math.cos(nWorld) * nLen };

  const evalArm = (side: "leftArm" | "rightArm") => {
    const ap = Kp[side];
    const as = Ks[side];
    const ac = Kc[side];
    const shPt = {
      x: chest.x + inertVal(ap.shOff.x, as.shOff.x, ac.shOff.x),
      y: Math.min(floorY, chest.y + inertVal(ap.shOff.y, as.shOff.y, ac.shOff.y))
    };
    const l1 = inertLen(ap.uLen, as.uLen, ac.uLen);
    const l2 = inertLen(ap.fLen, as.fLen, ac.fLen);
    const ang1 = inertAng(ap.uAngle, lsOrAc(as.uAngle), ac.uAngle);
    const bend = inertAng(ap.bend, as.bend, ac.bend);
    const elbowFk = { x: shPt.x + Math.sin(ang1) * l1, y: shPt.y + Math.cos(ang1) * l1 };
    const handFk = { x: elbowFk.x + Math.sin(ang1 + bend) * l2, y: elbowFk.y + Math.cos(ang1 + bend) * l2 };
    return { shPt, ...solveTwoBoneFloorClamp(shPt, elbowFk, handFk, l1, l2, floorY, -dirSign) };
  };

  function lsOrAc(v: number): number {
    return v;
  }

  const lArm = evalArm("leftArm");
  const rArm = evalArm("rightArm");

  const outSegments: Segment[] = [
    { id: "torso", x1: pelvis.x, y1: pelvis.y, x2: chest.x, y2: chest.y },
    { id: "left-upper-arm", x1: lArm.shPt.x, y1: lArm.shPt.y, x2: lArm.joint.x, y2: lArm.joint.y },
    { id: "left-forearm", x1: lArm.joint.x, y1: lArm.joint.y, x2: lArm.end.x, y2: lArm.end.y },
    { id: "right-upper-arm", x1: rArm.shPt.x, y1: rArm.shPt.y, x2: rArm.joint.x, y2: rArm.joint.y },
    { id: "right-forearm", x1: rArm.joint.x, y1: rArm.joint.y, x2: rArm.end.x, y2: rArm.end.y },
    { id: "left-thigh", x1: lLeg.hipPt.x, y1: lLeg.hipPt.y, x2: lLeg.joint.x, y2: lLeg.joint.y },
    { id: "left-shin", x1: lLeg.joint.x, y1: lLeg.joint.y, x2: lLeg.end.x, y2: lLeg.end.y },
    { id: "right-thigh", x1: rLeg.hipPt.x, y1: rLeg.hipPt.y, x2: rLeg.joint.x, y2: rLeg.joint.y },
    { id: "right-shin", x1: rLeg.joint.x, y1: rLeg.joint.y, x2: rLeg.end.x, y2: rLeg.end.y }
  ];

  return {
    ...curr,
    x: inertVal(Kp.x, Ks.x, Kc.x),
    head: headPt,
    segments: outSegments,
    facing: blendedFacing,
    articulated: Boolean(curr.articulated || (w > 0.5 && prior.articulated))
  };
}

function buildActorTrajectories(
  actor: CompiledActorSpec,
  sceneAddons: "auto" | "none"
): ActorActionTrajectory[] {
  const noopDiagnostics: Diagnostic[] = [];
  let curX = actor.x;
  let curFacing: -1 | 1 = actor.facing;
  const trajectories: ActorActionTrajectory[] = [];

  for (let i = 0; i < actor.actions.length; i++) {
    const item = actor.actions[i]!;
    const meta = getMotionMeta(item.action);
    const isTravel = isTravelActionName(item.action);
    const startX = item.from ? item.from.x : curX;
    const endX = isTravel ? (item.to?.x ?? startX) : startX;
    const distance = Math.abs(endX - startX);
    let direction: -1 | 1 = curFacing;
    if (isTravel && distance > 1e-6) {
      direction = Math.sign(endX - startX) as -1 | 1;
    } else if (!isTravel && item.to && Math.abs(item.to.x - startX) > 1e-6) {
      direction = Math.sign(item.to.x - startX) as -1 | 1;
    }
    const afterFacing: -1 | 1 = meta?.facingChange === 180 ? (-direction as -1 | 1) : direction;
    curX = endX;
    curFacing = afterFacing;

    const addonNorm = normalizeActionAddon(item.action, item.addon, item.persist, sceneAddons, "$", noopDiagnostics);
    trajectories.push({
      item,
      index: i,
      startX,
      endX,
      direction,
      afterFacing,
      isTravel,
      ...(!isTravel && item.to ? { pointTarget: item.to } : {}),
      addonEnabled: addonNorm.enabled,
      ...(addonNorm.overrides !== undefined ? { addonOverrides: addonNorm.overrides } : {}),
      addonMergeDefaults: addonNorm.mergeDefaults,
      addonPersist: addonNorm.persist
    });
  }

  return trajectories;
}

function toAdjacentAddonContext(traj: ActorActionTrajectory): AdjacentActionContext {
  return {
    action: traj.item.action,
    ...(traj.addonOverrides !== undefined ? { addons: traj.addonOverrides } : {}),
    mergeDefaults: traj.addonMergeDefaults
  };
}

function extractStageIdsForTrajectory(traj: ActorActionTrajectory): Set<string> {
  if (!traj.addonEnabled) return new Set<string>();
  const configs =
    traj.addonOverrides === undefined
      ? defaultAddonsForAction(traj.item.action)
      : traj.addonMergeDefaults
        ? [...defaultAddonsForAction(traj.item.action), ...traj.addonOverrides]
        : traj.addonOverrides;
  const ids = new Set<string>();
  for (const cfg of configs) {
    const def = PROP_DEFINITIONS[cfg.type];
    if ((cfg.socket ?? def.socket) === "stage") {
      ids.add(cfg.id ?? cfg.type);
    }
  }
  return ids;
}

export function sampleAnimationV2(
  program: CompiledAnimation,
  timeMs: number,
  mode: PlaybackMode = "normal"
): SampledFrame {
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) {
    throw new TypeError("timeMs must be a finite number.");
  }
  if (mode !== "normal" && mode !== "reduced" && mode !== "static") {
    throw new TypeError('mode must be "normal", "reduced", or "static".');
  }

  const spec = program.spec as AnimationSpecV2;
  const playheadT = mode === "normal" ? Math.min(spec.durationMs, Math.max(0, timeMs)) : spec.durationMs;
  const sceneAddonsMode: "auto" | "none" = spec.addons ?? "auto";

  const sampledByIndex: Array<{
    actorIndex: number;
    zIndex: number;
    actorFrame: SampledActorFrame;
    addons: SampledAddon[];
  }> = [];

  for (let actorIndex = 0; actorIndex < spec.actors.length; actorIndex++) {
    const actor = spec.actors[actorIndex]!;
    const baseRigScale = actorRigBaseScale(spec.canvas.width, actor.groundY, actor.actions);
    const effectiveScale = Math.max(0.2, baseRigScale * actor.scale);
    const trajectories = buildActorTrajectories(actor, sceneAddonsMode);
    const themeAccentColor = actor.accentColor ?? spec.theme?.accentColor;

    const sampleIdleClip = (rootX: number, facing: -1 | 1, progress: number): RawActorPose => {
      const clip = sampleClipMotion(RUNTIME_MOTION_LIBRARY, {
        action: "idle",
        clipId: "idle",
        progress: clamp01(progress),
        startX: rootX,
        endX: rootX,
        groundY: actor.groundY,
        facing,
        scale: effectiveScale
      });
      return {
        action: "idle",
        x: clip.rootX,
        groundY: actor.groundY,
        head: clip.headPoint!,
        segments: clip.segments!,
        facing: clip.facing ?? facing,
        articulated: Boolean(clip.articulated),
        activeIndex: -1,
        prevCompletedIndex: -1,
        nextPendingIndex: -1
      };
    };

    const sampleTrajectoryClip = (traj: ActorActionTrajectory, progress: number): RawActorPose => {
      const p = clamp01(progress);
      const clip = sampleClipMotion(RUNTIME_MOTION_LIBRARY, {
        action: traj.item.action,
        clipId: traj.item.action,
        progress: p,
        durationMs: traj.item.durationMs,
        startX: traj.startX,
        endX: traj.endX,
        groundY: actor.groundY,
        facing: traj.direction,
        scale: effectiveScale,
        ...(traj.pointTarget ? { pointTarget: traj.pointTarget } : {}),
        ...(traj.item.speed !== undefined ? { speed: traj.item.speed } : {})
      });
      let maxExcessY = 0;
      for (const seg of clip.segments!) {
        if (seg.y1 > actor.groundY) maxExcessY = Math.max(maxExcessY, seg.y1 - actor.groundY);
        if (seg.y2 > actor.groundY) maxExcessY = Math.max(maxExcessY, seg.y2 - actor.groundY);
      }
      const headPt = maxExcessY > 0 ? { x: clip.headPoint!.x, y: clip.headPoint!.y - maxExcessY } : clip.headPoint!;
      const segs = maxExcessY > 0
        ? clip.segments!.map((seg) => ({ id: seg.id, x1: seg.x1, y1: seg.y1 - maxExcessY, x2: seg.x2, y2: seg.y2 - maxExcessY }))
        : clip.segments!;
      return {
        action: traj.item.action,
        x: clip.rootX,
        groundY: actor.groundY,
        head: headPt,
        segments: segs,
        facing: clip.facing ?? traj.direction,
        articulated: Boolean(clip.articulated),
        activeIndex: traj.index,
        prevCompletedIndex: traj.index - 1,
        nextPendingIndex: traj.index + 1 < trajectories.length ? traj.index + 1 : -1
      };
    };

    const poseAtTrajectoryProgress = (traj: ActorActionTrajectory) => (p: number): AddonPoseSnapshot => {
      const pose = sampleTrajectoryClip(traj, p);
      return {
        x: pose.x,
        groundY: pose.groundY,
        head: pose.head,
        segments: pose.segments,
        facing: pose.facing,
        scale: effectiveScale
      };
    };

    if (mode !== "normal") {
      let finalX = actor.x;
      let finalFacing: -1 | 1 = actor.facing;
      let lastOnstageX: number | undefined = actor.x >= 0 && actor.x <= spec.canvas.width ? actor.x : undefined;
      let lastOnstageFacing: -1 | 1 = actor.facing;
      let lastOnstageActionIdx = -1;

      for (const traj of trajectories) {
        finalX = traj.endX;
        finalFacing = traj.afterFacing;
        if (traj.endX >= 0 && traj.endX <= spec.canvas.width) {
          lastOnstageX = traj.endX;
          lastOnstageFacing = traj.afterFacing;
          lastOnstageActionIdx = traj.index;
        } else if (traj.startX >= 0 && traj.startX <= spec.canvas.width && lastOnstageX === undefined) {
          lastOnstageX = traj.startX;
          lastOnstageFacing = traj.direction;
        }
      }

      const endedOnstage = finalX >= 0 && finalX <= spec.canvas.width;
      const summaryX = endedOnstage
        ? finalX
        : lastOnstageX ?? clamp(finalX, Math.min(48, spec.canvas.width / 2), Math.max(48, spec.canvas.width - 48));
      const summaryFacing = endedOnstage ? finalFacing : lastOnstageFacing;
      const summaryActIdx = endedOnstage ? trajectories.length - 1 : lastOnstageActionIdx;
      const summaryTraj = summaryActIdx >= 0 ? trajectories[summaryActIdx] : undefined;

      const finalPose =
        summaryTraj && HOLD_OR_SEATED_FINAL_ACTIONS.has(summaryTraj.item.action)
          ? sampleTrajectoryClip(summaryTraj, 1)
          : sampleIdleClip(summaryX, summaryFacing, 0);

      const actorFrame: SampledActorFrame = {
        id: actor.id,
        ...(actor.label !== undefined ? { label: actor.label } : {}),
        action: finalPose.action,
        x: finalPose.x,
        groundY: finalPose.groundY,
        head: finalPose.head,
        segments: finalPose.segments,
        facing: finalPose.facing,
        ...(finalPose.articulated ? { articulated: true } : {}),
        color: actor.color,
        ...(actor.accessory !== undefined ? { accessory: actor.accessory } : {}),
        ...(themeAccentColor !== undefined ? { accentColor: themeAccentColor } : {}),
        scale: effectiveScale,
        zIndex: actor.zIndex
      };

      const finalAddons: SampledAddon[] = [];
      const seenAddonKeys = new Set<string>();
      for (let k = trajectories.length - 1; k >= 0; k--) {
        const traj = trajectories[k]!;
        if (!traj.addonEnabled) continue;
        const shouldInclude =
          traj.addonPersist || (k === summaryActIdx && HOLD_OR_SEATED_FINAL_ACTIONS.has(traj.item.action));
        if (!shouldInclude) continue;
        const poseSnap = poseAtTrajectoryProgress(traj)(1);
        const sampled = sampleActionAddons({
          action: traj.item.action,
          progress: 1,
          pose: poseSnap,
          originX: traj.startX,
          poseAtProgress: poseAtTrajectoryProgress(traj),
          actorId: actor.id,
          canvas: spec.canvas,
          ...(traj.addonOverrides !== undefined ? { addons: traj.addonOverrides } : {}),
          mergeDefaults: traj.addonMergeDefaults,
          ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
          persist: true
        });
        for (const addon of sampled) {
          if (!seenAddonKeys.has(addon.id)) {
            seenAddonKeys.add(addon.id);
            finalAddons.unshift(addon);
          }
        }
      }

      sampledByIndex.push({ actorIndex, zIndex: actor.zIndex, actorFrame, addons: finalAddons });
      continue;
    }

    const sampleRawAt = (t: number): RawActorPose => {
      let idleX = trajectories[0]?.item.from ? trajectories[0].item.from.x : actor.x;
      let idleFacing: -1 | 1 = actor.facing;
      let prevCompletedIndex = -1;
      let nextPendingIndex = -1;

      for (let i = 0; i < trajectories.length; i++) {
        const traj = trajectories[i]!;
        const start = traj.item.startMs;
        const end = start + traj.item.durationMs;
        if (t < start) {
          nextPendingIndex = i;
          if (traj.item.from && prevCompletedIndex < 0) idleX = traj.item.from.x;
          break;
        }
        const isLastAtEnd = i === trajectories.length - 1 && end === spec.durationMs && t <= end;
        if (t < end || isLastAtEnd) {
          const p = clamp01((t - start) / traj.item.durationMs);
          return sampleTrajectoryClip(traj, p);
        }
        idleX = traj.endX;
        idleFacing = traj.afterFacing;
        prevCompletedIndex = i;
      }

      const pose = sampleIdleClip(idleX, idleFacing, ((t / 1000) % 2) / 2);
      pose.prevCompletedIndex = prevCompletedIndex;
      pose.nextPendingIndex = nextPendingIndex;
      return pose;
    };

    const sampleBlendedAt = (evalTime: number, depth: number): RawActorPose => {
      const raw = sampleRawAt(evalTime);
      if (depth >= 2) return raw;

      let boundaryMs = 0;
      let effectiveBlendMs = 0;
      if (raw.activeIndex >= 0) {
        const activeTraj = trajectories[raw.activeIndex]!;
        boundaryMs = activeTraj.item.startMs;
        if (boundaryMs > 0 || raw.activeIndex > 0) {
          const requested = activeTraj.item.blendMs !== undefined ? activeTraj.item.blendMs : 140;
          effectiveBlendMs = Math.min(requested, Math.floor(activeTraj.item.durationMs * 0.35));
        }
      } else if (raw.prevCompletedIndex >= 0) {
        const prevTraj = trajectories[raw.prevCompletedIndex]!;
        boundaryMs = prevTraj.item.startMs + prevTraj.item.durationMs;
        const nextStart = raw.nextPendingIndex >= 0 ? trajectories[raw.nextPendingIndex]!.item.startMs : spec.durationMs;
        const idleSpan = Math.max(0, nextStart - boundaryMs);
        effectiveBlendMs = Math.min(140, idleSpan);
      }

      if (effectiveBlendMs > 0 && evalTime >= boundaryMs && evalTime < boundaryMs + effectiveBlendMs) {
        const u = clamp01((evalTime - boundaryMs) / effectiveBlendMs);
        const w = 1 - (3 * u * u - 2 * u * u * u);
        if (w > 1e-9 && boundaryMs > 0) {
          const priorPose = sampleBlendedAt(Math.max(0, boundaryMs - 1e-4), depth + 1);
          const startPose = evalTime === boundaryMs ? raw : sampleRawAt(boundaryMs);
          if (Math.abs(priorPose.x - startPose.x) <= 80 * effectiveScale) {
            return inertializeActorPose(priorPose, startPose, raw, w, effectiveScale);
          }
        }
      }
      return raw;
    };

    const blended = sampleBlendedAt(playheadT, 0);
    const actorFrame: SampledActorFrame = {
      id: actor.id,
      ...(actor.label !== undefined ? { label: actor.label } : {}),
      action: blended.action,
      x: blended.x,
      groundY: blended.groundY,
      head: blended.head,
      segments: blended.segments,
      facing: blended.facing,
      ...(blended.articulated ? { articulated: true } : {}),
      color: actor.color,
      ...(actor.accessory !== undefined ? { accessory: actor.accessory } : {}),
      ...(themeAccentColor !== undefined ? { accentColor: themeAccentColor } : {}),
      scale: effectiveScale,
      zIndex: actor.zIndex
    };

    const actorAddons: SampledAddon[] = [];
    const activeIdx = blended.activeIndex;

    if (activeIdx >= 0) {
      const traj = trajectories[activeIdx]!;
      if (traj.addonEnabled) {
        const progress = clamp01((playheadT - traj.item.startMs) / traj.item.durationMs);
        const prevTraj = activeIdx > 0 ? trajectories[activeIdx - 1] : undefined;
        const nextTraj = activeIdx + 1 < trajectories.length ? trajectories[activeIdx + 1] : undefined;
        const sameSpotPrev = prevTraj && prevTraj.addonEnabled && Math.abs(prevTraj.endX - traj.startX) < 1e-3;
        const sameSpotNext = nextTraj && nextTraj.addonEnabled && Math.abs(traj.endX - nextTraj.startX) < 1e-3;

        const currentPoseSnap: AddonPoseSnapshot = {
          x: actorFrame.x,
          groundY: actorFrame.groundY,
          head: actorFrame.head,
          segments: actorFrame.segments,
          facing: traj.isTravel || Math.abs(actorFrame.facing ?? 1) < 0.05 ? traj.direction : (actorFrame.facing ?? traj.direction),
          scale: effectiveScale
        };

        const sampled = sampleActionAddons({
          action: traj.item.action,
          progress,
          pose: currentPoseSnap,
          originX: traj.startX,
          poseAtProgress: poseAtTrajectoryProgress(traj),
          actorId: actor.id,
          canvas: spec.canvas,
          ...(traj.addonOverrides !== undefined ? { addons: traj.addonOverrides } : {}),
          mergeDefaults: traj.addonMergeDefaults,
          ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
          ...(traj.addonPersist ? { persist: true } : {}),
          ...(sameSpotPrev ? { previousAction: toAdjacentAddonContext(prevTraj) } : {}),
          ...(sameSpotNext ? { nextAction: toAdjacentAddonContext(nextTraj) } : {})
        });
        actorAddons.push(...sampled);
      }
    } else if (blended.prevCompletedIndex >= 0 && blended.nextPendingIndex >= 0) {
      // Bridge shared stage props seamlessly across short idle gaps at the same stage spot
      const prevTraj = trajectories[blended.prevCompletedIndex]!;
      const nextTraj = trajectories[blended.nextPendingIndex]!;
      if (prevTraj.addonEnabled && nextTraj.addonEnabled && Math.abs(prevTraj.endX - nextTraj.startX) < 1e-3) {
        const prevIds = extractStageIdsForTrajectory(prevTraj);
        const nextIds = extractStageIdsForTrajectory(nextTraj);
        const sharedIds = [...prevIds].filter((id) => nextIds.has(id));
        if (sharedIds.length > 0) {
          const sampled = sampleActionAddons({
            action: prevTraj.item.action,
            progress: 1,
            pose: poseAtTrajectoryProgress(prevTraj)(1),
            originX: prevTraj.startX,
            poseAtProgress: poseAtTrajectoryProgress(prevTraj),
            actorId: actor.id,
            canvas: spec.canvas,
            ...(prevTraj.addonOverrides !== undefined ? { addons: prevTraj.addonOverrides } : {}),
            mergeDefaults: prevTraj.addonMergeDefaults,
            ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
            persist: true
          });
          for (const addon of sampled) {
            if (sharedIds.includes(addon.id)) actorAddons.push(addon);
          }
        }
      }
    }

    // Carry forward explicitly persisted (`persist: true`) addons from earlier completed actions
    const completedCeiling = activeIdx >= 0 ? activeIdx - 1 : blended.prevCompletedIndex;
    const presentIds = new Set(actorAddons.map((a) => a.id));
    for (let j = completedCeiling; j >= 0; j--) {
      const earlier = trajectories[j]!;
      if (!earlier.addonEnabled || !earlier.addonPersist) continue;
      const persistedSample = sampleActionAddons({
        action: earlier.item.action,
        progress: 1,
        pose: poseAtTrajectoryProgress(earlier)(1),
        originX: earlier.startX,
        poseAtProgress: poseAtTrajectoryProgress(earlier),
        actorId: actor.id,
        canvas: spec.canvas,
        ...(earlier.addonOverrides !== undefined ? { addons: earlier.addonOverrides } : {}),
        mergeDefaults: earlier.addonMergeDefaults,
        ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
        persist: true
      });
      for (const addon of persistedSample) {
        if (!presentIds.has(addon.id)) {
          presentIds.add(addon.id);
          actorAddons.unshift(addon);
        }
      }
    }

    sampledByIndex.push({ actorIndex, zIndex: actor.zIndex, actorFrame, addons: actorAddons });
  }

  const primary = sampledByIndex[0]!.actorFrame;
  const sortedEntries = [...sampledByIndex].sort((a, b) => a.zIndex - b.zIndex || a.actorIndex - b.actorIndex);
  const sortedActors = sortedEntries.map((entry) => entry.actorFrame);
  const allAddons = sortedEntries.flatMap((entry) => entry.addons);

  return {
    timeMs: playheadT,
    action: primary.action,
    x: primary.x,
    groundY: primary.groundY,
    head: primary.head,
    segments: primary.segments,
    prop: null,
    ...(primary.facing !== undefined ? { facing: primary.facing } : {}),
    ...(primary.articulated ? { articulated: true } : {}),
    addons: allAddons,
    actors: sortedActors
  };
}
