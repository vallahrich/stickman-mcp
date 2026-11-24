import {
  CONTRACT_VERSION_V2,
  type AnimationSpec,
  type AnimationSpecV2,
  type CompiledAnimation,
  type CompiledMovie,
  type CompiledMovieScene,
  type RenderStyle,
  type SampledActorFrame,
  type SampledAddon,
  type SampledCallout,
  type SampledFrame,
  type SampledMovieFrame
} from "./contract.js";
import { renderCalloutSvg } from "./callouts.js";
import { sampleAnimation } from "./compiler.js";
import { renderAddonSvg, escapeXml } from "./props.js";
import {
  actorToSampledFrame,
  frameGeometry,
  renderBlueprintStageBackdropSvg
} from "./render.js";
import {
  isCompiledMovie,
  renderBackdropSvg,
  sampleMovie
} from "./movie.js";

export interface CompactPlayerOptions {
  style?: RenderStyle;
  keyframeFps?: number;
  posThresholdPx?: number;
}

export interface CompactActorTrack {
  id: string;
  c: string;
  ac: string;
  acc?: string;
  sc: number;
  gy: number;
  dp?: number;
  kf: number[][];
}

export type CompactOverlaySpan = [symIdx: number, startMs: number, endMs: number];

export interface CompactMovingOverlay {
  w: number;
  h: number;
  kf: number[][];
}

export type CompactOverlay = CompactOverlaySpan | CompactMovingOverlay;

export interface CompactScene {
  id: string;
  ti?: string;
  s: number;
  e: number;
  bg: string;
  gy: number;
  bd?: number;
  tr?: [kind: "fade" | "wipe", durMs: number];
  cam?: number[][];
  ac: CompactActorTrack[];
  bk?: CompactOverlay[];
  fr?: CompactOverlay[];
  cl?: CompactOverlay[];
}

export type CompactEventTuple = [
  timeMs: number,
  actIdx: number,
  marker: string,
  frame: number,
  actionIndex: number,
  actorId?: string,
  sceneId?: string
];

export interface CompactPlayerPayload {
  v: 1;
  kind: "animation" | "movie";
  w: number;
  h: number;
  fps: number;
  dur: number;
  bp?: 1;
  ti?: string;
  acts: string[];
  sym: string[];
  sc: CompactScene[];
  red: CompactScene;
  ev?: CompactEventTuple[];
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const r = Math.round(value * factor) / factor;
  return Math.abs(r) < 1e-6 ? 0 : r;
}

function qInt(value: number): number {
  const r = Math.round(value);
  return r === 0 ? 0 : r;
}

function compactSvgStr(svg: string, decimals = 1): string {
  const factor = 10 ** decimals;
  const fmt = (raw: string): string => {
    const r = Math.round(Number(raw) * factor) / factor;
    return (Math.abs(r) < 1e-6 ? 0 : r).toString();
  };
  return svg.replace(
    /\b(d|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|stroke-width|font-size|opacity|transform|points)="([^"]+)"/g,
    (_full, attr: string, val: string) =>
      `${attr}="${val.replace(/-?\d+\.\d+/g, fmt)}"`
  );
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function resolveStyle(
  programOrMovie: CompiledAnimation | CompiledMovie,
  explicit?: RenderStyle
): RenderStyle {
  if (explicit !== undefined) {
    if (explicit !== "default" && explicit !== "blueprint") {
      throw new TypeError('Render style must be "default" or "blueprint".');
    }
    return explicit;
  }
  if (isCompiledMovie(programOrMovie)) {
    return programOrMovie.spec.theme?.style === "blueprint" ? "blueprint" : "default";
  }
  const v2 = programOrMovie.contractVersion === CONTRACT_VERSION_V2
    ? (programOrMovie.spec as AnimationSpecV2)
    : undefined;
  return v2?.theme?.style === "blueprint" ? "blueprint" : "default";
}

function collectSampleTimes(
  durationMs: number,
  keyframeFps: number,
  program: CompiledAnimation
): number[] {
  const raw = new Set<number>([0, durationMs]);
  const steps = Math.max(1, Math.ceil((durationMs * keyframeFps) / 1000));
  for (let i = 0; i <= steps; i++) {
    raw.add(Math.min(durationMs, Math.round((i * 1000) / keyframeFps)));
  }
  for (const event of program.events ?? []) {
    if (Number.isFinite(event.timeMs)) {
      raw.add(Math.max(0, Math.min(durationMs, Math.round(event.timeMs))));
    }
  }
  if (program.contractVersion === CONTRACT_VERSION_V2) {
    const v2 = program.spec as AnimationSpecV2;
    for (const actor of v2.actors) {
      for (const act of actor.actions) {
        raw.add(Math.max(0, Math.min(durationMs, Math.round(act.startMs))));
        raw.add(Math.max(0, Math.min(durationMs, Math.round(act.startMs + act.durationMs))));
      }
    }
  } else {
    const v1 = program.spec as AnimationSpec;
    for (const act of v1.actions) {
      raw.add(Math.max(0, Math.min(durationMs, Math.round(act.startMs))));
      raw.add(Math.max(0, Math.min(durationMs, Math.round(act.startMs + act.durationMs))));
    }
  }
  const sorted = [...raw].sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const t of sorted) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1]! >= 1 || t === durationMs) {
      if (deduped.length > 0 && t === durationMs && durationMs - deduped[deduped.length - 1]! < 1) {
        deduped[deduped.length - 1] = durationMs;
      } else {
        deduped.push(t);
      }
    }
  }
  return deduped;
}

function extractFrameActors(frame: SampledFrame, defaultColor: string): SampledActorFrame[] {
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

function encodeActorPoseRow(
  globalT: number,
  actor: SampledActorFrame,
  actIdx: number
): number[] {
  const sample = actorToSampledFrame(actor, globalT);
  const geom = frameGeometry(sample);
  const segById = new Map(actor.segments.map((s) => [s.id, s]));
  const torso = segById.get("torso")!;
  const lUpper = segById.get("left-upper-arm")!;
  const lFore = segById.get("left-forearm")!;
  const rUpper = segById.get("right-upper-arm")!;
  const rFore = segById.get("right-forearm")!;
  const lThigh = segById.get("left-thigh")!;
  const lShin = segById.get("left-shin")!;
  const rThigh = segById.get("right-thigh")!;
  const rShin = segById.get("right-shin")!;

  const hipX = torso.x1;
  const hipY = torso.y1;
  const facingVal =
    actor.facing !== undefined
      ? Math.max(-1, Math.min(1, actor.facing))
      : geom.nearSide === "left"
        ? -1
        : 1;
  const dirSign = facingVal < 0 ? -1 : 1;
  const facing10 = Math.round(facingVal * 10);
  const op20 = Math.round((actor.opacity ?? 1) * 20);
  let flags = (actor.articulated ? 1 : 0) | (actor.facing !== undefined ? 2 : 0);

  let gazePair: [number, number] | null = null;
  if (actor.gazeDir && Number.isFinite(actor.gazeDir.x) && Number.isFinite(actor.gazeDir.y)) {
    const gLen = Math.hypot(actor.gazeDir.x, actor.gazeDir.y);
    if (gLen > 1e-6) {
      const gx = actor.gazeDir.x / gLen;
      const gy = actor.gazeDir.y / gLen;
      if (Math.abs(gx - dirSign) > 0.12 || Math.abs(gy) > 0.12) {
        flags |= 4;
        gazePair = [Math.round(gx * 10), Math.round(gy * 10)];
      }
    }
  }

  const rootOffs = [
    qInt(lUpper.x1 - torso.x2), qInt(lUpper.y1 - torso.y2),
    qInt(rUpper.x1 - torso.x2), qInt(rUpper.y1 - torso.y2),
    qInt(lThigh.x1 - hipX), qInt(lThigh.y1 - hipY),
    qInt(rThigh.x1 - hipX), qInt(rThigh.y1 - hipY)
  ];
  const hasRootOff = rootOffs.some((v) => Math.abs(v) > 1);
  if (hasRootOff) flags |= 8;

  const row = [
    Math.round(globalT),
    actIdx,
    qInt(actor.x - hipX),
    qInt(hipX), qInt(hipY),
    qInt(torso.x2 - hipX), qInt(torso.y2 - hipY),
    qInt(geom.head.x - hipX), qInt(geom.head.y - hipY),
    qInt(lUpper.x2 - hipX), qInt(lUpper.y2 - hipY),
    qInt(lFore.x2 - hipX), qInt(lFore.y2 - hipY),
    qInt(rUpper.x2 - hipX), qInt(rUpper.y2 - hipY),
    qInt(rFore.x2 - hipX), qInt(rFore.y2 - hipY),
    qInt(lThigh.x2 - hipX), qInt(lThigh.y2 - hipY),
    qInt(lShin.x2 - hipX), qInt(lShin.y2 - hipY),
    qInt(rThigh.x2 - hipX), qInt(rThigh.y2 - hipY),
    qInt(rShin.x2 - hipX), qInt(rShin.y2 - hipY),
    facing10,
    op20,
    flags
  ];

  if (gazePair) row.push(gazePair[0], gazePair[1]);
  if (hasRootOff) row.push(...rootOffs);
  return row;
}

function posesClose(a: number[], b: number[], thrPx: number): boolean {
  if (a.length !== b.length) return false;
  if (a[1] !== b[1] || a[27] !== b[27]) return false;
  if (a[25] !== b[25] || a[26] !== b[26]) return false;
  for (let i = 2; i <= 24; i++) {
    if (Math.abs(a[i]! - b[i]!) >= thrPx) return false;
  }
  let idx = 28;
  if ((a[27]! & 4) !== 0) {
    if (Math.abs(a[idx]! - b[idx]!) > 1 || Math.abs(a[idx + 1]! - b[idx + 1]!) > 1) return false;
    idx += 2;
  }
  if ((a[27]! & 8) !== 0) {
    for (let j = 0; j < 8; j++) {
      if (Math.abs(a[idx + j]! - b[idx + j]!) >= thrPx) return false;
    }
  }
  return true;
}

function simplifyActorKeyframes(kf: number[][], tolPx: number): number[][] {
  if (kf.length <= 2) return kf;
  const out: number[][] = [kf[0]!];
  let anchorIdx = 0;

  while (anchorIdx < kf.length - 1) {
    const a = kf[anchorIdx]!;
    // Hold markers or incompatible next frames cannot be merged across
    if (a.length === 1 || kf[anchorIdx + 1]!.length === 1) {
      out.push(kf[anchorIdx + 1]!);
      anchorIdx++;
      continue;
    }

    let bestEnd = anchorIdx + 1;
    for (let end = anchorIdx + 2; end < kf.length; end++) {
      const b = kf[end]!;
      if (b.length !== a.length || b.length === 1) break;
      if (b[1] !== a[1] || b[26] !== a[26] || b[27] !== a[27]) break;
      const span = b[0]! - a[0]!;
      if (span <= 0 || span > 340) break;

      let fits = true;
      for (let mid = anchorIdx + 1; mid < end; mid++) {
        const m = kf[mid]!;
        if (m.length !== a.length || m[1] !== a[1] || m[26] !== a[26] || m[27] !== a[27]) {
          fits = false;
          break;
        }
        const u = (m[0]! - a[0]!) / span;
        for (let j = 2; j <= 25; j++) {
          const pred = a[j]! + (b[j]! - a[j]!) * u;
          if (Math.abs(m[j]! - pred) > tolPx) {
            fits = false;
            break;
          }
        }
        if (!fits) break;
        for (let j = 28; j < a.length; j++) {
          const pred = a[j]! + (b[j]! - a[j]!) * u;
          if (Math.abs(m[j]! - pred) > tolPx) {
            fits = false;
            break;
          }
        }
        if (!fits) break;
      }
      if (!fits) break;
      bestEnd = end;
    }

    out.push(kf[bestEnd]!);
    anchorIdx = bestEnd;
  }

  return out;
}

function renderV1PropSvg(
  prop: NonNullable<SampledFrame["prop"]>,
  strokeWidth: number,
  scale: number,
  defaultColor: string,
  isBlueprint: boolean,
  canonicalOrigin: boolean
): string {
  const n = (v: number) => roundTo(v, 1).toString();
  const propFill = isBlueprint ? "url(#sm-bp-hatch)" : "#fff";
  const propStroke = isBlueprint ? "#1e3a5f" : escapeXml(defaultColor);
  const handleStroke = isBlueprint ? "#0f172a" : escapeXml(defaultColor);
  const styleAttr = isBlueprint ? ' data-style="blueprint"' : "";
  const rx = canonicalOrigin ? 0 : prop.x;
  const hx = canonicalOrigin ? prop.handleX - prop.x : prop.handleX;
  const handleD = `M${n(hx)} ${n(prop.handleY - 5 * scale)}L${n(hx)} ${n(prop.handleY + 5 * scale)}`;
  return (
    `<g data-prop="${escapeXml(prop.id)}"${styleAttr}>` +
    `<rect x="${n(rx)}" y="${n(prop.y)}" width="${n(prop.width)}" height="${n(prop.height)}" rx="3" fill="${propFill}" stroke="${propStroke}" stroke-width="${n(strokeWidth)}"/>` +
    `<path data-part="handle" d="${handleD}" fill="none" stroke="${handleStroke}" stroke-width="${n(1.4 * scale)}" stroke-linecap="round"/>` +
    `</g>`
  );
}

interface SharedTables {
  sym: string[];
  symMap: Map<string, number>;
  acts: string[];
  actMap: Map<string, number>;
  internSym: (markup: string) => number;
  internAct: (action: string) => number;
}

function createSharedTables(): SharedTables {
  const sym: string[] = [];
  const symMap = new Map<string, number>();
  const acts: string[] = [];
  const actMap = new Map<string, number>();
  return {
    sym,
    symMap,
    acts,
    actMap,
    internSym(markup: string): number {
      const existing = symMap.get(markup);
      if (existing !== undefined) return existing;
      const idx = sym.length;
      sym.push(markup);
      symMap.set(markup, idx);
      return idx;
    },
    internAct(action: string): number {
      const existing = actMap.get(action);
      if (existing !== undefined) return existing;
      const idx = acts.length;
      acts.push(action);
      actMap.set(action, idx);
      return idx;
    }
  };
}

interface OverlaySample {
  timeMs: number;
  endTimeMs: number;
  canonSvg: string;
  x: number;
  y: number;
  rot: number;
  sc: number;
  op: number;
  w: number;
  h: number;
  staticSvg?: string;
}

function encodeOverlayGroup(
  entriesById: Map<string, Array<OverlaySample | null>>,
  sampleTimes: number[],
  sceneEndMs: number,
  tables: SharedTables
): CompactOverlay[] {
  const out: CompactOverlay[] = [];

  for (const samples of entriesById.values()) {
    // Check whether all non-null samples are static (identical position/transform/opacity/svg)
    let firstNonNull: OverlaySample | null = null;
    let isStatic = true;
    for (const s of samples) {
      if (!s) continue;
      if (!firstNonNull) {
        firstNonNull = s;
        continue;
      }
      if (
        s.canonSvg !== firstNonNull.canonSvg ||
        Math.abs(s.x - firstNonNull.x) > 0.3 ||
        Math.abs(s.y - firstNonNull.y) > 0.3 ||
        Math.abs(s.rot - firstNonNull.rot) > 0.4 ||
        Math.abs(s.sc - firstNonNull.sc) > 0.01 ||
        Math.abs(s.op - firstNonNull.op) > 0.015
      ) {
        isStatic = false;
        break;
      }
    }
    if (!firstNonNull) continue;

    if (isStatic && firstNonNull.staticSvg !== undefined) {
      const staticSymIdx = tables.internSym(firstNonNull.staticSvg);
      let spanStart: number | null = null;
      let spanEnd = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s) {
          if (spanStart === null) spanStart = s.timeMs;
          spanEnd = s.endTimeMs;
        } else if (spanStart !== null) {
          out.push([staticSymIdx, Math.round(spanStart), roundTo(spanEnd, 1)]);
          spanStart = null;
        }
      }
      if (spanStart !== null) {
        out.push([staticSymIdx, Math.round(spanStart), roundTo(Math.min(sceneEndMs, spanEnd), 1)]);
      }
      continue;
    }

    // Dynamic/moving overlay: intern canonical symbols lazily and emit delta-compressed transform keyframes
    const kf: number[][] = [];
    let lastFull: number[] | null = null;
    let lastHidden = true;
    let pendingHoldT: number | null = null;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const tMs = Math.round(sampleTimes[i]!);
      if (!s) {
        if (!lastHidden) {
          if (pendingHoldT !== null) {
            kf.push([pendingHoldT]);
            pendingHoldT = null;
          }
          kf.push([tMs, -1]);
          lastFull = null;
          lastHidden = true;
        }
        continue;
      }

      const symIdx = tables.internSym(s.canonSvg);
      const row = [
        tMs,
        symIdx,
        roundTo(s.x, 1),
        roundTo(s.y, 1),
        roundTo(s.rot, 1),
        roundTo(s.sc, 2),
        roundTo(s.op, 2)
      ];

      if (
        lastFull &&
        !lastHidden &&
        lastFull[1] === row[1] &&
        Math.abs(lastFull[2]! - row[2]!) < 0.4 &&
        Math.abs(lastFull[3]! - row[3]!) < 0.4 &&
        Math.abs(lastFull[4]! - row[4]!) < 0.5 &&
        Math.abs(lastFull[5]! - row[5]!) < 0.01 &&
        Math.abs(lastFull[6]! - row[6]!) < 0.02
      ) {
        pendingHoldT = tMs;
      } else {
        if (pendingHoldT !== null) {
          kf.push([pendingHoldT]);
          pendingHoldT = null;
        }
        kf.push(row);
        lastFull = row;
        lastHidden = false;
      }
    }
    if (pendingHoldT !== null) {
      kf.push([pendingHoldT]);
    }
    if (kf.length > 0) {
      out.push({ w: roundTo(firstNonNull.w, 1), h: roundTo(firstNonNull.h, 1), kf: simplifyOverlayKeyframes(kf) });
    }
  }

  return out;
}

function simplifyOverlayKeyframes(kf: number[][]): number[][] {
  if (kf.length <= 2) return kf;
  const out: number[][] = [kf[0]!];
  let anchorIdx = 0;
  while (anchorIdx < kf.length - 1) {
    const a = kf[anchorIdx]!;
    if (a.length <= 2 || kf[anchorIdx + 1]!.length <= 2) {
      out.push(kf[anchorIdx + 1]!);
      anchorIdx++;
      continue;
    }
    let bestEnd = anchorIdx + 1;
    for (let end = anchorIdx + 2; end < kf.length; end++) {
      const b = kf[end]!;
      if (b.length !== a.length || b[1] !== a[1]) break;
      const span = b[0]! - a[0]!;
      if (span <= 0 || span > 340) break;
      let fits = true;
      for (let mid = anchorIdx + 1; mid < end; mid++) {
        const m = kf[mid]!;
        if (m.length !== a.length || m[1] !== a[1]) { fits = false; break; }
        const u = (m[0]! - a[0]!) / span;
        if (
          Math.abs(m[2]! - (a[2]! + (b[2]! - a[2]!) * u)) > 0.9 ||
          Math.abs(m[3]! - (a[3]! + (b[3]! - a[3]!) * u)) > 0.9 ||
          Math.abs(m[4]! - (a[4]! + (b[4]! - a[4]!) * u)) > 1.2 ||
          Math.abs(m[5]! - (a[5]! + (b[5]! - a[5]!) * u)) > 0.02 ||
          Math.abs(m[6]! - (a[6]! + (b[6]! - a[6]!) * u)) > 0.03
        ) {
          fits = false;
          break;
        }
      }
      if (!fits) break;
      bestEnd = end;
    }
    out.push(kf[bestEnd]!);
    anchorIdx = bestEnd;
  }
  return out;
}

function encodeSceneBlock(params: {
  sceneId: string;
  sceneTitle?: string;
  startMs: number;
  endMs: number;
  width: number;
  height: number;
  bg: string;
  defaultColor: string;
  themeAccentColor?: string;
  isBlueprint: boolean;
  backdropSvg: string;
  transition?: [kind: "fade" | "wipe", durMs: number];
  samples: Array<{ globalT: number; frame: SampledFrame }>;
  tables: SharedTables;
  posThresholdPx: number;
}): CompactScene {
  const {
    sceneId,
    sceneTitle,
    startMs,
    endMs,
    defaultColor,
    themeAccentColor,
    isBlueprint,
    backdropSvg,
    transition,
    samples,
    tables,
    posThresholdPx
  } = params;

  const thrPx = Math.max(0.6, posThresholdPx);
  const firstFrame = samples[0]!.frame;
  const defaultGy = roundTo(firstFrame.groundY, 1);

  const bdSym = backdropSvg ? tables.internSym(compactSvgStr(backdropSvg, 1)) : undefined;

  // Preserve painter's order across actors
  const actorOrder: string[] = [];
  const actorMetaMap = new Map<string, Omit<CompactActorTrack, "kf">>();
  const actorKfMap = new Map<string, { kf: number[][]; lastFull: number[] | null; pendingHoldT: number | null }>();

  const backMap = new Map<string, Array<OverlaySample | null>>();
  const frontMap = new Map<string, Array<OverlaySample | null>>();
  const callMap = new Map<string, Array<OverlaySample | null>>();
  const callBasePos = new Map<string, { x: number; y: number; ax?: number; ay?: number }>();

  const camKf: number[][] = [];
  let lastCam: number[] | null = null;
  let pendingCamHold: number | null = null;

  const sampleTimes = samples.map((s) => s.globalT);
  const count = samples.length;

  const ensureTrack = (map: Map<string, Array<OverlaySample | null>>, id: string) => {
    let arr = map.get(id);
    if (!arr) {
      arr = new Array<OverlaySample | null>(count).fill(null);
      map.set(id, arr);
    }
    return arr;
  };

  for (let i = 0; i < count; i++) {
    const { globalT, frame } = samples[i]!;
    const endT = i < count - 1 ? sampleTimes[i + 1]! - 0.5 : endMs;
    const actors = extractFrameActors(frame, defaultColor);
    const actorById = new Map(actors.map((a) => [a.id, a]));

    for (const rawActor of actors) {
      const actor: SampledActorFrame = isBlueprint
        ? { ...rawActor, color: "#0f172a", accentColor: "#1e3a5f" }
        : rawActor;

      if (!actorMetaMap.has(actor.id)) {
        actorOrder.push(actor.id);
        actorMetaMap.set(actor.id, {
          id: actor.id,
          c: actor.color,
          ac: actor.accentColor ?? (isBlueprint ? "#1e3a5f" : (themeAccentColor ?? "#2563eb")),
          ...(actor.accessory && actor.accessory !== "none" ? { acc: actor.accessory } : {}),
          sc: roundTo(actor.scale, 3),
          gy: roundTo(actor.groundY, 1),
          ...(actor.depth !== undefined && actor.depth > 0.05 ? { dp: roundTo(actor.depth, 3) } : {})
        });
        actorKfMap.set(actor.id, { kf: [], lastFull: null, pendingHoldT: null });
      }

      const actIdx = tables.internAct(actor.action);
      const row = encodeActorPoseRow(globalT, actor, actIdx);
      const state = actorKfMap.get(actor.id)!;
      if (state.lastFull && posesClose(state.lastFull, row, thrPx)) {
        state.pendingHoldT = row[0]!;
      } else {
        if (state.pendingHoldT !== null) {
          state.kf.push([state.pendingHoldT]);
          state.pendingHoldT = null;
        }
        state.kf.push(row);
        state.lastFull = row;
      }
    }

    // Addons (back & front)
    if (frame.addons && frame.addons.length > 0) {
      for (const addon of frame.addons) {
        if (addon.opacity <= 0.001 || addon.scale <= 0.001 || addon.width <= 0 || addon.height <= 0) {
          continue;
        }
        const owner = addon.actorId !== undefined ? actorById.get(addon.actorId) : undefined;
        const sw = owner ? Math.max(1.25, 2.97 * Math.pow(owner.scale, 0.75)) : 2.5;
        const themeColor = isBlueprint ? "#1e3a5f" : (owner?.color ?? defaultColor);
        const renderOpts = {
          strokeWidth: sw,
          themeColor,
          ...(isBlueprint ? { blueprint: true, hatchPatternId: "sm-bp-hatch" } : {})
        };
        const canonicalAddon: SampledAddon = {
          ...addon,
          x: 0,
          y: 0,
          rotation: 0,
          scale: 1,
          opacity: 1,
          ...(addon.ink !== undefined ? { ink: Math.round(addon.ink * 6) / 6 } : {}),
          ...(addon.open !== undefined ? { open: Math.round(addon.open * 6) / 6 } : {}),
          ...(addon.netBulge !== undefined ? { netBulge: Math.round(addon.netBulge * 4) / 4 } : {})
        };
        const canonicalSvg = renderAddonSvg(canonicalAddon, renderOpts);
        if (!canonicalSvg) continue;
        const canonCompact = compactSvgStr(canonicalSvg, 1);
        const fullSvg = compactSvgStr(renderAddonSvg(addon, renderOpts), 1);

        const targetMap = addon.layer === "back" ? backMap : frontMap;
        const key = `${addon.layer}:${addon.id}`;
        const arr = ensureTrack(targetMap, key);
        arr[i] = {
          timeMs: globalT,
          endTimeMs: endT,
          canonSvg: canonCompact,
          x: addon.x,
          y: addon.y,
          rot: addon.rotation,
          sc: addon.scale,
          op: addon.opacity,
          w: addon.width,
          h: addon.height,
          staticSvg: fullSvg
        };
      }
    }

    // v1 prop
    if (frame.prop) {
      const geom = frameGeometry(frame);
      const canonSvg = renderV1PropSvg(frame.prop, geom.strokeWidth, geom.scale, defaultColor, isBlueprint, true);
      const fullSvg = renderV1PropSvg(frame.prop, geom.strokeWidth, geom.scale, defaultColor, isBlueprint, false);
      const arr = ensureTrack(frontMap, `v1prop:${frame.prop.id}`);
      arr[i] = {
        timeMs: globalT,
        endTimeMs: endT,
        canonSvg,
        x: frame.prop.x,
        y: 0,
        rot: 0,
        sc: 1,
        op: 1,
        w: 0,
        h: 0,
        staticSvg: fullSvg
      };
    }

    // Callouts
    if (frame.callouts && frame.callouts.length > 0) {
      for (const callout of frame.callouts) {
        if (callout.opacity <= 0.001) continue;
        let base = callBasePos.get(callout.id);
        if (!base) {
          base = {
            x: callout.x,
            y: callout.y,
            ...(callout.anchorX !== undefined ? { ax: callout.anchorX } : {}),
            ...(callout.anchorY !== undefined ? { ay: callout.anchorY } : {})
          };
          callBasePos.set(callout.id, base);
        }
        const canonAx = base.ax ?? callout.anchorX;
        const canonAy = base.ay ?? callout.anchorY;
        const canonicalCallout: SampledCallout = {
          ...callout,
          x: base.x,
          y: base.y,
          ...(canonAx !== undefined ? { anchorX: canonAx } : {}),
          ...(canonAy !== undefined ? { anchorY: canonAy } : {}),
          opacity: 1
        };
        const canonSvg = compactSvgStr(
          renderCalloutSvg(canonicalCallout, { blueprint: isBlueprint, decimals: 1 }),
          1
        );
        const fullSvg =
          Math.abs(callout.opacity - 1) <= 0.001 &&
          Math.abs(callout.x - base.x) < 0.3 &&
          Math.abs(callout.y - base.y) < 0.3
            ? canonSvg
            : compactSvgStr(
                renderCalloutSvg(
                  {
                    ...callout,
                    ...(canonAx !== undefined ? { anchorX: canonAx } : {}),
                    ...(canonAy !== undefined ? { anchorY: canonAy } : {})
                  },
                  { blueprint: isBlueprint, decimals: 1 }
                ),
                1
              );

        const arr = ensureTrack(callMap, callout.id);
        arr[i] = {
          timeMs: globalT,
          endTimeMs: endT,
          canonSvg,
          x: callout.x - base.x,
          y: callout.y - base.y,
          rot: 0,
          sc: 1,
          op: callout.opacity,
          w: 0,
          h: 0,
          staticSvg: fullSvg
        };
      }
    }

    // Camera
    if (frame.camera) {
      const camRow = [
        Math.round(globalT),
        roundTo(frame.camera.x, 1),
        roundTo(frame.camera.y, 1),
        roundTo(frame.camera.zoom, 3)
      ];
      if (
        lastCam &&
        Math.abs(lastCam[1]! - camRow[1]!) < 0.4 &&
        Math.abs(lastCam[2]! - camRow[2]!) < 0.4 &&
        Math.abs(lastCam[3]! - camRow[3]!) < 0.002
      ) {
        pendingCamHold = camRow[0]!;
      } else {
        if (pendingCamHold !== null) {
          camKf.push([pendingCamHold]);
          pendingCamHold = null;
        }
        camKf.push(camRow);
        lastCam = camRow;
      }
    }
  }

  if (pendingCamHold !== null) {
    camKf.push([pendingCamHold]);
  }

  const actorTracks: CompactActorTrack[] = actorOrder.map((id) => {
    const meta = actorMetaMap.get(id)!;
    const state = actorKfMap.get(id)!;
    if (state.pendingHoldT !== null) {
      state.kf.push([state.pendingHoldT]);
    }
    return { ...meta, kf: simplifyActorKeyframes(state.kf, Math.max(1.5, posThresholdPx * 1.9)) };
  });

  const bk = encodeOverlayGroup(backMap, sampleTimes, endMs, tables);
  const fr = encodeOverlayGroup(frontMap, sampleTimes, endMs, tables);
  const cl = encodeOverlayGroup(callMap, sampleTimes, endMs, tables);

  return {
    id: sceneId,
    ...(sceneTitle !== undefined ? { ti: sceneTitle } : {}),
    s: Math.round(startMs),
    e: Math.round(endMs),
    bg: params.bg,
    gy: defaultGy,
    ...(bdSym !== undefined ? { bd: bdSym } : {}),
    ...(transition !== undefined ? { tr: transition } : {}),
    ...(camKf.length > 0 ? { cam: camKf } : {}),
    ac: actorTracks,
    ...(bk.length > 0 ? { bk } : {}),
    ...(fr.length > 0 ? { fr } : {}),
    ...(cl.length > 0 ? { cl } : {})
  };
}

function encodeEvents(
  events: ReadonlyArray<{ timeMs: number; actionIndex: number; action: string; marker: string; frame: number; actorId?: string; sceneId?: string }> | undefined,
  tables: SharedTables
): CompactEventTuple[] | undefined {
  if (!events || events.length === 0) return undefined;
  return events.map((e) => {
    const tuple: CompactEventTuple = [
      roundTo(e.timeMs, 1),
      tables.internAct(e.action),
      e.marker,
      e.frame,
      e.actionIndex
    ];
    if (e.actorId !== undefined || e.sceneId !== undefined) {
      tuple.push(e.actorId ?? "");
      if (e.sceneId !== undefined) tuple.push(e.sceneId);
    }
    return tuple;
  });
}

function buildMovieBackdropSvg(
  movie: CompiledMovie,
  scene: CompiledMovieScene,
  groundY: number,
  isBlueprint: boolean
): string {
  const { width, height } = movie.spec.canvas;
  const v2 = scene.program.contractVersion === CONTRACT_VERSION_V2
    ? (scene.program.spec as AnimationSpecV2)
    : undefined;
  const accentColor = v2?.theme?.accentColor ?? movie.spec.theme?.accentColor;
  const presetSvg = renderBackdropSvg(scene.backdrop, width, height, groundY, {
    blueprint: isBlueprint,
    ...(accentColor !== undefined ? { accentColor } : {}),
    decimals: 1
  });
  if (isBlueprint) {
    const bpStage = renderBlueprintStageBackdropSvg(width, height, groundY, v2?.anchors, 1);
    return `${bpStage}${presetSvg}`;
  }
  return presetSvg;
}

export function buildCompactPlayerPayload(
  programOrMovie: CompiledAnimation | CompiledMovie,
  options: CompactPlayerOptions = {}
): CompactPlayerPayload {
  const style = resolveStyle(programOrMovie, options.style);
  const isBlueprint = style === "blueprint";
  const keyframeFps = Math.max(6, Math.min(30, Math.round(options.keyframeFps ?? 12)));
  const posThresholdPx = Math.max(0.1, options.posThresholdPx ?? 0.8);
  const tables = createSharedTables();

  if (isCompiledMovie(programOrMovie)) {
    const movie = programOrMovie;
    const { width, height, fps } = movie.spec.canvas;
    const scenes: CompactScene[] = [];

    for (const scene of movie.scenes) {
      const v2 = scene.program.contractVersion === CONTRACT_VERSION_V2
        ? (scene.program.spec as AnimationSpecV2)
        : undefined;
      const bg = isBlueprint ? "#f8fafc" : (v2?.theme?.background ?? movie.spec.theme?.background ?? "#ffffff");
      const accent = v2?.theme?.accentColor ?? movie.spec.theme?.accentColor;
      const defaultColor = scene.program.spec.actor?.color ?? "#202124";
      const localTimes = collectSampleTimes(scene.durationMs, keyframeFps, scene.program);
      const samples = localTimes.map((lt) => {
        const globalT = scene.startMs + lt;
        // Sample inside this scene (avoid crossing into next scene at exact endMs)
        const sampleT =
          lt >= scene.durationMs && scene.index < movie.scenes.length - 1
            ? Math.max(scene.startMs, scene.endMs - 0.01)
            : globalT;
        const frame: SampledMovieFrame = sampleMovie(movie, sampleT, "normal");
        return { globalT, frame };
      });
      const firstGy = samples[0]!.frame.groundY;
      const bdSvg = buildMovieBackdropSvg(movie, scene, firstGy, isBlueprint);
      const tr: [kind: "fade" | "wipe", durMs: number] | undefined =
        scene.index < movie.scenes.length - 1 &&
        scene.transition.kind !== "cut" &&
        scene.transition.durationMs > 0
          ? [scene.transition.kind, scene.transition.durationMs]
          : undefined;

      scenes.push(
        encodeSceneBlock({
          sceneId: scene.id,
          ...(scene.title !== undefined ? { sceneTitle: scene.title } : {}),
          startMs: scene.startMs,
          endMs: scene.endMs,
          width,
          height,
          bg,
          defaultColor,
          ...(accent !== undefined ? { themeAccentColor: accent } : {}),
          isBlueprint,
          backdropSvg: bdSvg,
          ...(tr !== undefined ? { transition: tr } : {}),
          samples,
          tables,
          posThresholdPx
        })
      );
    }

    const redFrame = sampleMovie(movie, movie.durationMs, "reduced");
    const redSceneMeta = movie.scenes[redFrame.sceneIndex]!;
    const redV2 = redSceneMeta.program.contractVersion === CONTRACT_VERSION_V2
      ? (redSceneMeta.program.spec as AnimationSpecV2)
      : undefined;
    const redBg = isBlueprint ? "#f8fafc" : (redV2?.theme?.background ?? movie.spec.theme?.background ?? "#ffffff");
    const redAccent = redV2?.theme?.accentColor ?? movie.spec.theme?.accentColor;
    const redScene = encodeSceneBlock({
      sceneId: redSceneMeta.id,
      ...(redSceneMeta.title !== undefined ? { sceneTitle: redSceneMeta.title } : {}),
      startMs: 0,
      endMs: movie.durationMs,
      width,
      height,
      bg: redBg,
      defaultColor: redSceneMeta.program.spec.actor?.color ?? "#202124",
      ...(redAccent !== undefined ? { themeAccentColor: redAccent } : {}),
      isBlueprint,
      backdropSvg: buildMovieBackdropSvg(movie, redSceneMeta, redFrame.groundY, isBlueprint),
      samples: [{ globalT: movie.durationMs, frame: redFrame }],
      tables,
      posThresholdPx
    });

    const ev = encodeEvents(movie.events, tables);
    return {
      v: 1,
      kind: "movie",
      w: width,
      h: height,
      fps,
      dur: movie.durationMs,
      ...(isBlueprint ? { bp: 1 } : {}),
      ...(movie.spec.title !== undefined ? { ti: movie.spec.title } : {}),
      acts: tables.acts,
      sym: tables.sym,
      sc: scenes,
      red: redScene,
      ...(ev ? { ev } : {})
    };
  }

  // Single CompiledAnimation (v2 or blueprint)
  const program = programOrMovie;
  const { canvas, durationMs } = program.spec;
  const v2 = program.contractVersion === CONTRACT_VERSION_V2
    ? (program.spec as AnimationSpecV2)
    : undefined;
  const bg = isBlueprint ? "#f8fafc" : (v2?.theme?.background ?? "#ffffff");
  const defaultColor = program.spec.actor?.color ?? "#202124";
  const accent = v2?.theme?.accentColor;

  const times = collectSampleTimes(durationMs, keyframeFps, program);
  const samples = times.map((t) => ({ globalT: t, frame: sampleAnimation(program, t, "normal") }));
  const mainScene = encodeSceneBlock({
    sceneId: "main",
    startMs: 0,
    endMs: durationMs,
    width: canvas.width,
    height: canvas.height,
    bg,
    defaultColor,
    ...(accent !== undefined ? { themeAccentColor: accent } : {}),
    isBlueprint,
    backdropSvg: "",
    samples,
    tables,
    posThresholdPx
  });

  const redFrame = sampleAnimation(program, durationMs, "reduced");
  const redScene = encodeSceneBlock({
    sceneId: "main",
    startMs: 0,
    endMs: durationMs,
    width: canvas.width,
    height: canvas.height,
    bg,
    defaultColor,
    ...(accent !== undefined ? { themeAccentColor: accent } : {}),
    isBlueprint,
    backdropSvg: "",
    samples: [{ globalT: durationMs, frame: redFrame }],
    tables,
    posThresholdPx
  });

  const ev = encodeEvents(program.events, tables);
  return {
    v: 1,
    kind: "animation",
    w: canvas.width,
    h: canvas.height,
    fps: canvas.fps,
    dur: durationMs,
    ...(isBlueprint ? { bp: 1 } : {}),
    acts: tables.acts,
    sym: tables.sym,
    sc: [mainScene],
    red: redScene,
    ...(ev ? { ev } : {})
  };
}

/**
 * Self-contained (< 12 KB) 60fps client vector renderer for CompactPlayerPayload.
 * Reconstructs curved Bezier torsos, articulated/smooth limbs, gaze dots, hand glyphs,
 * accessories, blueprint dimension leaders, depth shadows, camera transforms, deduplicated
 * symbol props/callouts, and movie fade/wipe transitions with zero external dependencies.
 */
export const COMPACT_CLIENT_RENDERER_JS = [
  `function mountStickmanCompactPlayer(P,O){O=O||{};`,
  `const M=Math,H=M.hypot,A=M.abs,C=M.cos,S=M.sin,MN=M.min,MX=M.max,s=k=>new Set(k.split(","));`,
  `const FC=s("run,run-start,jog,crouch,sit-down,seated-idle,type-at-desk,open-laptop,video-call,frustrated-pc,sad-slump,bow,sneak,crawl,push,push-walk,pick-up,put-down,lift-carry,write-notes,tablet-tap,hurdle,long-jump,vault"),`,
  `OC=s("cheer,fist-pump,idea,present,present-card,reveal,surprised,basketball-shot,throw-ball,jump,hop"),`,
  `PG=s("point,idea,tap-element,tablet-tap"),OG=s("wave,stop-hand,cheer,surprised,beckon,shrug,present,reveal"),O2=s("cheer,surprised,shrug,reveal"),`,
  `GG=s("hold-sign,phone-call,write-board,write-notes,open-door,pick-up,lift-carry,pull,plug-cable,rack-server,inspect-magnifier,hand-over,catch"),G2=s("hold-sign,pick-up,lift-carry,pull,rack-server,hand-over,catch");`,
  `const f=v=>{const r=M.round(v*10)/10;return(A(r)<1e-6?0:r).toString()},f2=v=>{const r=M.round(v*100)/100;return(A(r)<1e-6?0:r).toString()},`,
  `cl=(v,a,b)=>MX(a,MN(b,v)),lp=(a,b,u)=>a+(b-a)*u,xe=v=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),`,
  `P0='<path d="',P1='"/>',SR=' stroke-linecap="round"',SJ=' stroke-linejoin="round"',SN=' stroke="none"',FN=' fill="none"',SW=' stroke-width="',SK=' stroke="',FL=' fill="',`,
  `sa=(e,k,v)=>e.setAttribute(k,String(v)),on=(e,k,fn)=>{if(e)e.addEventListener(k,fn)},`,
  `pL=(a,b,c,d)=>"M"+f(a)+" "+f(b)+"L"+f(c)+" "+f(d),`,
  `pS=(d,c,w)=>P0+d+'"'+FN+SK+c+'"'+SW+f(w)+'"'+SR+P1,`,
  `cc=(x,y,r,fl,st)=>'<circle cx="'+f(x)+'" cy="'+f(y)+'" r="'+f(r)+'"'+(fl?FL+fl+'"':"")+(st||"")+'/>',`,
  `ln=(a,b,c,d,k,w,ex)=>'<line'+(ex||"")+' x1="'+f(a)+'" y1="'+f(b)+'" x2="'+f(c)+'" y2="'+f(d)+'"'+SK+k+'"'+SW+w+'"/>';`,
  `const rK=(k,i)=>{while(i>0&&k[i].length===1)i--;return k[i]};`,
  `const bi=(k,t)=>{let l=0,h=k.length-1;while(l<h){const m=(l+h+1)>>1;if(k[m][0]<=t+1e-6)l=m;else h=m-1}return l};`,
  `function sp(k,t){if(k.length===1)return k[0];const i=bi(k,t),a=k[i],b=rK(k,i);if(i>=k.length-1)return b;const c=k[i+1];if(c.length===1)return b;const d=c[0]-a[0];if(d<=0||d>360||b[1]!==c[1]||b[27]!==c[27]||b.length!==c.length)return b;const u=cl((t-a[0])/d,0,1);if(u<=1e-3)return b;if(u>=.999)return c;const o=b.slice();o[0]=t;for(let j=2;j<=26;j++)o[j]=lp(b[j],c[j],u);for(let j=28;j<b.length;j++)o[j]=lp(b[j],c[j],u);return o}`,
  `function lm(a,b,c,d,e,g,sc,ar){const x=e-a,y=g-b,L=H(x,y);if(L<=1e-6)return pL(a,b,e,g);const sd=((c-a)*y-(d-b)*x)/L;if(A(sd)<.85*sc)return pL(a,b,e,g);if(ar){const l1=H(c-a,d-b),l2=H(e-c,g-d);if(l1<=1e-6||l2<=1e-6)return pL(a,b,e,g);const r=MN(l1,l2)*.22;return"M"+f(a)+" "+f(b)+"L"+f(c+(a-c)*r/l1)+" "+f(d+(b-d)*r/l1)+"Q"+f(c)+" "+f(d)+" "+f(c+(e-c)*r/l2)+" "+f(d+(g-d)*r/l2)+"L"+f(e)+" "+f(g)}const ld=cl(sd,-.15*L,.15*L);return"M"+f(a)+" "+f(b)+"Q"+f((a+e)/2+y/L*ld*2)+" "+f((b+g)/2-x/L*ld*2)+" "+f(e)+" "+f(g)}`,
  `const ft=(a,b,c,d,gy,sc)=>{const hl=5.5*sc,lim=M.asin(MN(1,MX(0,gy-d)/hl)),an=cl(M.atan2(c-a,d-b)*.3,-MN(.3,lim),MN(.3,lim)),dx=C(an)*hl,dy=S(an)*hl;return pL(c-dx,d-dy,c+dx,d+dy)};`,
  `function dAc(ac,r,bp,W){`,
  `const act=P.acts[r[1]]||"idle",hx=r[3],hy=r[4],ax=hx+r[2],nx=hx+r[5],ny=hy+r[6],hdx=hx+r[7],hdy=hy+r[8],`,
  `leX=hx+r[9],leY=hy+r[10],lwX=hx+r[11],lwY=hy+r[12],reX=hx+r[13],reY=hy+r[14],rwX=hx+r[15],rwY=hy+r[16],`,
  `lkX=hx+r[17],lkY=hy+r[18],laX=hx+r[19],laY=hy+r[20],rkX=hx+r[21],rkY=hy+r[22],raX=hx+r[23],raY=hy+r[24],`,
  `fac=r[25]/10,op=r[26]/20,fl=r[27],ar=(fl&1)!==0,hF=(fl&2)!==0;`,
  `let ix=28,gx=null,gyG=null;if(fl&4){gx=r[ix]/10;gyG=r[ix+1]/10;ix+=2}`,
  `let lsX=nx,lsY=ny,rsX=nx,rsY=ny,lhX=hx,lhY=hy,rhX=hx,rhY=hy;if(fl&8){lsX+=r[ix];lsY+=r[ix+1];rsX+=r[ix+2];rsY+=r[ix+3];lhX+=r[ix+4];lhY+=r[ix+5];rhX+=r[ix+6];rhY+=r[ix+7]}`,
  `const tdx=nx-hx,tdy=ny-hy,tL=H(tdx,tdy)||30,sc=tL/30,hr=11*sc,sw=MX(1.25,2.97*M.pow(sc/1.5,.75)),`,
  `tD=hF?fac:tdx,dir=A(tD)>.1*sc?tD:(lkX+rkX)/2-hx,ds=dir<0?-1:1,nr=dir<0?"l":"r",fv=hF&&A(fac)<.3,fA=act==="point"?"r":nr,`,
  `ord=fv?["ll","rl","t","la","ra"]:[(fA==="l"?"r":"l")+"a",(nr==="l"?"r":"l")+"l","t",nr+"l",fA+"a"],`,
  `tlf=tdx*ds/tL,hl=(hdx-nx)*ds/MX(1,hr),cr=cl(1-((laY+raY)/2-hy)/(48*sc),0,1);`,
  `let sb=FC.has(act)?-MN(.11,MX(.045,.055+MX(0,tlf)*.09+cr*.05+MX(0,hl)*.015)):OC.has(act)?MN(.095,MX(.035,.045+MX(0,-tlf)*.08+MX(0,-hl)*.015)):tlf>=0?-MN(.08,MX(.018,.018+tlf*.12+cr*.03)):MN(.07,MX(.018,.018-tlf*.12));if(fv)sb*=.55;`,
  `const td="M"+f(hx)+" "+f(hy)+"Q"+f((hx+nx)/2-tdy/tL*ds*tL*sb)+" "+f((hy+ny)/2+tdx/tL*ds*tL*sb)+" "+f(nx)+" "+f(ny),`,
  `L={la:P0+lm(lsX,lsY,leX,leY,lwX,lwY,sc,ar)+P1,ra:P0+lm(rsX,rsY,reX,reY,rwX,rwY,sc,ar)+P1,ll:P0+lm(lhX,lhY,lkX,lkY,laX,laY,sc,ar)+P1+P0+ft(lkX,lkY,laX,laY,ac.gy,sc)+P1,rl:P0+lm(rhX,rhY,rkX,rkY,raX,raY,sc,ar)+P1+P0+ft(rkX,rkY,raX,raY,ac.gy,sc)+P1},`,
  `col=xe(ac.c),accC=xe(ac.ac),af=A(fac),fds=fac<0?-1:1,gvx=gx!==null?gx:fds,gvy=gyG!==null?gyG:0,er=MX(.85,hr*.105),mo=MX(.5,hr*.56),`,
  `ci=(x,y)=>{const d=H(x,y);return d<=mo?[hdx+x,hdy+y]:[hdx+x*mo/d,hdy+y*mo/d]},dyb=cl(-hr*.1+gvy*hr*.34,-hr*.46,hr*.36),dot=p=>cc(p[0],p[1],er);`,
  `const gz='<g data-part="gaze"'+FL+col+'"'+SN+'>'+(af>=.72?dot(ci(cl(fds*hr*.32+gvx*hr*.14,-hr*.5,hr*.5),dyb)):(()=>{const sx=cl(fac*hr*.22+gvx*hr*.14,-hr*.3,hr*.3),q=hr*(.24-af*.08);return dot(ci(sx-q,dyb))+dot(ci(sx+q,dyb))})())+"</g>";`,
  `let aS="";if(ac.acc){`,
  `const dX=(hx-nx)/tL,dY=(hy-ny)/tL,nL=H(hdx-nx,hdy-ny),uX=nL>1e-6?(hdx-nx)/nL:-dX,uY=nL>1e-6?(hdy-ny)/nL:-dY,tX=-uY,tY=uX,pX=-dY,pY=dX;`,
  `if(ac.acc==="tie"){const sX=nx+dX*tL*.06+pX*fac*hr*.14,sY=ny+dY*tL*.06+pY*fac*hr*.14,wt=hr*.14,wm=hr*.23,pt=(a,b)=>f(sX+dX*a+pX*b)+","+f(sY+dY*a+pY*b);aS='<g data-accessory="tie"><polygon points="'+[pt(0,-wt),pt(0,wt),pt(tL*.08,wt*.72),pt(tL*.3,wm),pt(tL*.44,0),pt(tL*.3,-wm),pt(tL*.08,-wt*.72)].join(" ")+'"'+FL+accC+'"'+SK+col+'"'+SW+f(MX(.9,sw*.32))+'"'+SJ+'/></g>'}`,
  `else if(ac.acc==="hat"){const hp=(u,t)=>[hdx+uX*u+tX*t,hdy+uY*u+tY*t],a=hp(hr*.72,-hr*.84),b=hp(hr*.72,hr*.84),c=hp(hr*1.32,-hr*.56),d=hp(hr*1.32,hr*.56),e=hp(hr*.7,-fds*hr*.92),g=hp(hr*.66,fds*hr*1.28);aS='<g data-accessory="hat">'+P0+"M"+f(a[0])+" "+f(a[1])+"L"+f(c[0])+" "+f(c[1])+"L"+f(d[0])+" "+f(d[1])+"L"+f(b[0])+" "+f(b[1])+'Z"'+FL+accC+'"'+SK+col+'"'+SW+f(MX(1.1,sw*.45))+'"'+SJ+'/>'+pS(pL(e[0],e[1],g[0],g[1]),accC,MX(1.8,sw*.82))+"</g>"}`,
  `else if(ac.acc==="glasses"){const eX=hdx+uX*hr*.06,eY=hdy+uY*hr*.06,hh=hr*.19,lq=(ct,hw)=>{const q=(u,t)=>f(eX+uX*u+tX*t)+" "+f(eY+uY*u+tY*t);return"M"+q(hh,ct-hw)+"L"+q(hh,ct+hw)+"L"+q(-hh,ct+hw)+"L"+q(-hh,ct-hw)+"Z"},sl=(a,b)=>pL(eX+tX*a,eY+tY*a,eX+tX*b,eY+tY*b);aS='<g data-accessory="glasses" fill="#fff" fill-opacity=".7"'+SK+accC+'"'+SW+f(MX(1.3,sw*.52))+'"'+SJ+'>'+(af<.35?P0+lq(-hr*.36,hr*.22)+P1+P0+lq(hr*.36,hr*.22)+P1+P0+sl(-hr*.14,hr*.14)+'"'+FN+'/>':(()=>{const nt=fds*hr*.16,ft0=fds*hr*.64,nw=hr*.21,fw=hr*.17;return P0+sl(-fds*hr*.62,nt-fds*nw)+'"'+FN+'/>'+P0+lq(nt,nw)+P1+P0+lq(ft0,fw)+P1+P0+sl(nt+fds*nw,ft0-fds*fw)+'"'+FN+'/>'})())+"</g>"}`,
  `else if(ac.acc==="badge")aS='<g data-accessory="badge">'+cc(nx+dX*tL*.22+pX*fds*hr*.24,ny+dY*tL*.22+pY*fds*hr*.24,MX(1.8,hr*.2),accC,' stroke="#fff"'+SW+f(MX(.9,sw*.32))+'"')+"</g>"}`,
  `let hg="";const gk=act==="thumbs-up"?"thumbs-up":PG.has(act)?"point":OG.has(act)?"open":GG.has(act)||act.startsWith("pull-banner")?"grip":null;`,
  `if(gk){const sds=(gk==="open"&&O2.has(act))||(gk==="grip"&&(G2.has(act)||act.startsWith("pull-banner")))?["l","r"]:act==="point"?["r"]:[rwY<=lwY+1e-3?"r":"l"];`,
  `hg='<g data-part="hand-glyph" data-glyph="'+gk+'">'+sds.map(sd=>{const ex=sd==="l"?leX:reX,ey=sd==="l"?leY:reY,wx=sd==="l"?lwX:rwX,wy=sd==="l"?lwY:rwY,ln0=H(wx-ex,wy-ey)||1,ux=(wx-ex)/ln0,uy=(wy-ey)/ln0;let px=-uy,py=ux;if(py>0){px=-px;py=-py}`,
  `if(gk==="thumbs-up"){const fx=wx+ux*1.1*sc,fy=wy+uy*1.1*sc;return cc(fx,fy,MX(1.6,2.25*sc),col,SN)+pS("M"+f(fx-fds*.55*sc)+" "+f(fy-1.2*sc)+"Q"+f(fx-fds*.95*sc)+" "+f(fy-4.8*sc)+" "+f(fx+fds*.55*sc)+" "+f(fy-6.1*sc),col,MX(1.1,sw*.78))}`,
  `if(gk==="point")return pS(pL(wx,wy,wx+ux*5.2*sc,wy+uy*5.2*sc)+pL(wx+ux*.6*sc,wy+uy*.6*sc,wx+ux*2.1*sc+px*1.7*sc,wy+uy*2.1*sc+py*1.7*sc),col,MX(1,sw*.72));`,
  `if(gk==="open"){const ba=M.atan2(uy,ux);return pS([-.56,0,.56].map((da,k)=>{const a=ba+da,rl=(k===1?4.1:3.2)*sc;return pL(wx,wy,wx+C(a)*rl,wy+S(a)*rl)}).join(""),col,MX(.95,sw*.62))}`,
  `const cx=wx+ux*1.2*sc,cy=wy+uy*1.2*sc,gr=MX(1.4,2.1*sc);return pS("M"+f(cx-px*gr)+" "+f(cy-py*gr)+"Q"+f(cx+ux*gr*1.45)+" "+f(cy+uy*gr*1.45)+" "+f(cx+px*gr)+" "+f(cy+py*gr),col,MX(1,sw*.7))+cc(wx,wy,MX(.95,sw*.44),col,SN)}).join("")+"</g>"}`,
  `const sh=ac.dp&&ac.dp>.05?'<ellipse data-part="depth-shadow" cx="'+f(ax)+'" cy="'+f(ac.gy)+'" rx="'+f(MX(10,18*sc))+'" ry="'+f(MX(2.2,3.4*sc))+'"'+FL+(bp?"#1e3a5f":"#0f172a")+'" fill-opacity="'+(bp?".12":".1")+'"'+(bp?' stroke="#1e3a5f" stroke-width=".6" stroke-dasharray="2 2"':SN)+'/>':"";`,
  `let fig='<g data-actor="'+xe(ac.id)+'" data-action="'+xe(act)+'"'+(ac.acc?' data-accessory-type="'+xe(ac.acc)+'"':"")+(op<.999?' opacity="'+f2(op)+'"':"")+FN+SK+col+'"'+SW+f(sw)+'"'+SR+SJ+'>'+sh+L[ord[0]]+L[ord[1]]+P0+td+P1+cc(hdx,hdy,hr,bp?"#f8fafc":"#fff",SK+col+'"'+SW+f(sw)+'"')+gz+aS+L[ord[3]]+L[ord[4]]+hg+"</g>";`,
  `if(bp){const aS0=ac.sc>0?ac.sc:1,sH=144*aS0,tY=cl(ac.gy-sH,12,MX(14,ac.gy-16)),lx=cl(ax-28*aS0-10,8,MX(8,W-64)),rx=cl(ax,4,MX(4,W-4)),hc=A(aS0-1)<.005?"144u":"144u ("+(M.round(sH)||0)+"px)",b="#1e3a5f";fig+='<g data-part="dimension-leader" data-actor-dimension="'+xe(ac.id)+'">'+ln(lx,tY,lx,ac.gy,b,1,' data-part="rig-height-leader" stroke-dasharray="2 2"')+ln(lx-4,tY,lx+4,tY,b,1)+ln(lx-4,ac.gy,lx+4,ac.gy,b,1)+'<text class="bp-d" data-part="rig-height-label" x="'+f(lx+5)+'" y="'+f((tY+ac.gy)/2)+'">'+hc+"</text>"+ln(rx,ac.gy-5,rx,ac.gy+5,"#0f172a",1.1,' data-part="actor-root-tick"')+'<text class="bp-d" data-part="actor-root-label" x="'+f(cl(rx+4,8,MX(8,W-56)))+'" y="'+f(MX(16,ac.gy-6))+'">x='+(M.round(ax)||0)+"</text></g>"}`,
  `return fig}`,
  `function dOv(ls,t){if(!ls||!ls.length)return"";let o="";for(const it of ls){if(Array.isArray(it)){if(t>=it[1]-1e-6&&t<=it[2]+1e-6)o+=P.sym[it[0]]||"";continue}const kf=it.kf;if(!kf.length||t<kf[0][0]-1e-6)continue;const i=bi(kf,t),k0=kf[i],b0=rK(kf,i);if(b0[1]<0)continue;let sx=b0[1],x=b0[2],y=b0[3],rt=b0[4],sc=b0[5],op=b0[6];if(i<kf.length-1){const k1=kf[i+1];if(k1.length>2&&k1[1]===sx){const d=k1[0]-k0[0];if(d>0&&d<=360){const u=cl((t-k0[0])/d,0,1);x=lp(x,k1[2],u);y=lp(y,k1[3],u);rt=lp(rt,k1[4],u);sc=lp(sc,k1[5],u);op=lp(op,k1[6],u)}}}if(op<=1e-3||sc<=1e-3)continue;const raw=P.sym[sx]||"",hT=A(x)>.05||A(y)>.05||A(rt)>.05||A(sc-1)>.005,hO=A(op-1)>.005;if(!hT&&!hO){o+=raw;continue}let tf="";if(hT){if(A(rt)>.05||A(sc-1)>.005){const cx=it.w/2,cy=it.h/2;tf="translate("+f(x+cx)+" "+f(y+cy)+") rotate("+f(rt)+") scale("+f2(sc)+") translate("+f(-cx)+" "+f(-cy)+")"}else tf="translate("+f(x)+" "+f(y)+")"}o+="<g"+(tf?' transform="'+tf+'"':"")+(hO?' opacity="'+f2(op)+'"':"")+">"+raw+"</g>"}return o}`,
  `function sCam(c,t){if(!c||!c.length)return null;const i=bi(c,t),k0=c[i],b0=rK(c,i);if(i>=c.length-1)return b0;const k1=c[i+1];if(k1.length===1)return b0;const d=k1[0]-k0[0];if(d<=0)return b0;const u=cl((t-k0[0])/d,0,1);return[t,lp(b0[1],k1[1],u),lp(b0[2],k1[2],u),lp(b0[3],k1[3],u)]}`,
  `function dW(sc,t,mv){const bp=P.bp===1,bd=sc.bd!==undefined?P.sym[sc.bd]||"":"",bk=dOv(sc.bk,t),fr=dOv(sc.fr,t),cS=dOv(sc.cl,t);let aS="",a0="idle";for(let i=0;i<sc.ac.length;i++){const a=sc.ac[i],p=sp(a.kf,t);if(i===0)a0=P.acts[p[1]]||"idle";aS+=dAc(a,p,bp,P.w)}const cw=cS?'<g data-layer="callouts">'+cS+"</g>":"",cam=sCam(sc.cam,t),gl=!bp&&(mv||cam)?'<path id="ground" d="M0 '+f(sc.gy)+"H"+P.w+'" stroke="#d8dbe0" stroke-width="1"/>':"",inn=bd+gl+bk+aS+fr+cw;if(cam&&!bp){const zm=MX(.5,cam[3]),tf=A(zm-1)>1e-3||A(cam[1]-P.w/2)>.1||A(cam[2]-P.h/2)>.1?"translate("+f(P.w/2)+" "+f(P.h/2)+") scale("+f2(zm)+") translate("+f(-cam[1])+" "+f(-cam[2])+")":"";return{html:'<g data-camera="true" data-camera-zoom="'+f2(zm)+'"'+(tf?' transform="'+tf+'"':"")+">"+inn+"</g>",act:a0}}return{html:inn,act:a0}}`,
  `const fS=t=>{const a=P.sc;for(let i=0;i<a.length;i++)if(t<a[i].e||i===a.length-1)return i;return a.length-1};`,
  `const rt=O.root||document,q=x=>rt.querySelector?rt.querySelector(x):null,g=x=>(rt.getElementById?rt.getElementById(x):null)||q("#"+x),`,
  `svg=O.svg||q("#stage svg"),scEl=O.sceneEl||g("scene"),gEl=O.groundEl||g("ground"),mSel=O.modeSelect||q("#mode"),sk=O.seek||q("#seek"),tg=O.toggle||q("#toggle"),tc=O.timecode||(rt.getElementById?rt.getElementById("timecode"):null),`,
  `ch=Array.from(rt.querySelectorAll?rt.querySelectorAll(".cp-chapter"):[]),dur=P.dur,mv=P.kind==="movie";`,
  `let mode=typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"normal";`,
  `if(mSel)mSel.value=mode;let tm=0,pl=mode==="normal",pv=0,rf=null;if(tg)tg.textContent=pl?"Pause":"Play";`,
  `function sDf(m){if(!svg||!svg.querySelector)return;let d=svg.querySelector("#sm-mv-dyn-defs");if(!d&&m&&document.createElementNS){d=document.createElementNS("http://www.w3.org/2000/svg","defs");sa(d,"id","sm-mv-dyn-defs");svg.insertBefore(d,svg.firstChild)}if(d)d.innerHTML=m||""}`,
  `function draw(){const nm=mode==="normal",t=nm?cl(tm,0,dur):dur;let si=0,sc=P.red,st=dur;if(nm){si=fS(t);sc=P.sc[si];st=t}const w=dW(sc,st,mv);let mk=mv?'<rect width="'+P.w+'" height="'+P.h+'"'+FL+xe(sc.bg)+'"/>'+w.html:w.html,df="";`,
  `if(nm&&mv&&sc.tr&&si<P.sc.length-1){const ts=sc.e-sc.tr[1];if(t>=ts-1e-6&&t<=sc.e+1e-6){const u=cl((t-ts)/sc.tr[1],0,1),pr=u*u*(3-2*u);if(pr>1e-3){const nx=P.sc[si+1],nw='<rect width="'+P.w+'" height="'+P.h+'"'+FL+xe(nx.bg)+'"/>'+dW(nx,nx.s,true).html,trA=' data-transition-progress="'+f2(pr)+'" data-transition-next="'+xe(nx.id)+'"';if(sc.tr[0]==="fade")mk+='<g data-transition="fade"'+trA+' opacity="'+f2(pr)+'">'+nw+"</g>";else{const wx=f(P.w*pr);df='<clipPath id="sm-mv-wipe"><rect x="0" y="0" width="'+wx+'" height="'+P.h+'"/></clipPath>';mk+='<g data-transition="wipe"'+trA+' clip-path="url(#sm-mv-wipe)">'+nw+'</g>'+ln(wx,0,wx,P.h,"#cbd5e1",1.5,' data-transition-edge="wipe"')}}}}`,
  `if(mv)sDf(df);if(scEl){scEl.innerHTML=mk;if(scEl.setAttribute){sa(scEl,"data-time-ms",M.round(st));sa(scEl,"data-action",w.act);if(mv)sa(scEl,"data-scene",sc.id)}}`,
  `if(gEl&&!mv&&!sc.cam&&!P.bp)sa(gEl,"d","M0 "+f(sc.gy)+"H"+P.w);`,
  `if(svg){if(mv){sa(svg,"data-movie-scene",sc.id);sa(svg,"data-scene-index",si);sa(svg,"aria-label","Stickman movie scene "+sc.id+" ("+w.act+") at "+M.round(st)+" milliseconds")}else sa(svg,"aria-label","Stick figure "+w.act+" at "+M.round(st)+" milliseconds")}`,
  `for(const b of ch)sa(b,"aria-current",b.getAttribute("data-scene-id")===sc.id?"true":"false");`,
  `if(sk)sk.value=String(M.round(st));if(tc)tc.textContent=(st/1e3).toFixed(2)+"s / "+(dur/1e3).toFixed(2)+"s"}`,
  `const stop=()=>{pl=false;pv=0;if(rf!==null){cancelAnimationFrame(rf);rf=null}if(tg)tg.textContent="Play"},sched=()=>{if(pl&&rf===null)rf=requestAnimationFrame(tick)},evs=P.ev||[];let em=-1;`,
  `const emit=(a,b)=>{for(const e of evs){const t0=Array.isArray(e)?e[0]:e.timeMs;if(t0>a&&t0<=b){const d=Array.isArray(e)?{timeMs:e[0],action:P.acts[e[1]]||"",marker:e[2],frame:e[3],actionIndex:e[4],...(e[5]?{actorId:e[5]}:{}),...(e[6]?{sceneId:e[6]}:{})}:{...e};if(document.dispatchEvent)document.dispatchEvent(new CustomEvent("stickman:marker",{detail:d}));if(typeof window!=="undefined"&&window.parent&&window.parent!==window)window.parent.postMessage({type:"stickman:marker",...d},"*")}}};`,
  `function tick(n){rf=null;if(!pl)return;if(pv)tm+=n-pv;pv=n;if(tm>=dur){tm=dur;stop()}const b=em;em=tm;emit(b,tm);draw();sched()}`,
  `const start=()=>{if(mode!=="normal"){mode="normal";if(mSel)mSel.value=mode}if(tm>=dur)tm=0;em=tm>0?tm:-1;pl=true;pv=0;if(tg)tg.textContent="Pause";draw();sched()};`,
  `on(mSel,"change",()=>{stop();mode=mSel.value;if(mode==="normal"){tm=0;start()}else{tm=dur;draw()}});`,
  `on(sk,"input",()=>{tm=Number(sk.value);em=tm;pv=0;draw()});`,
  `on(tg,"click",()=>{pl?stop():start()});`,
  `for(const b of ch)on(b,"click",()=>{tm=Number(b.getAttribute("data-scene-jump")||"0");em=tm;pv=0;draw()});`,
  `draw();sched();return{draw,start,stop,seek:ms=>{tm=cl(ms,0,dur);em=tm;pv=0;draw()}}}`
].join("");

export function renderCompactPlayerScript(payload: CompactPlayerPayload): string {
  return `(()=>{"use strict";const P=${scriptJson(payload)};${COMPACT_CLIENT_RENDERER_JS};mountStickmanCompactPlayer(P);})();`;
}
