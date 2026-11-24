import {
  CONTRACT_VERSION_V2,
  type AnimationSpecV2,
  type CameraEase,
  type CameraFraming,
  type CameraKeyframe,
  type CompiledActorSpec,
  type CompiledAnimation,
  type SampledActorFrame,
  type SampledCamera,
  type SampledFrame
} from "./contract.js";

export const HERO_BEAT_ACTIONS: ReadonlySet<string> = new Set([
  "idea",
  "reveal",
  "present-card",
  "write-board",
  "thumbs-up",
  "surprised",
  "frustrated-pc"
]);

const PASSIVE_ACTIONS: ReadonlySet<string> = new Set([
  "idle",
  "seated-idle",
  "static-pose"
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  const r = Math.round(value * factor) / factor;
  return Math.abs(r) < 1e-6 ? 0 : r;
}

function fmt(value: number, decimals = 2): string {
  return round(value, decimals).toString();
}

function hermite(u: number): number {
  const t = clamp01(u);
  return t * t * (3 - 2 * t);
}

export interface CameraFrustum {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cameraFrustum(camera: SampledCamera, width: number, height: number): CameraFrustum {
  const zoom = clamp(Number.isFinite(camera.zoom) ? camera.zoom : 1, 0.5, 3.0);
  const vw = width / zoom;
  const vh = height / zoom;
  return {
    x: round(camera.x - vw / 2, 3),
    y: round(camera.y - vh / 2, 3),
    width: round(vw, 3),
    height: round(vh, 3)
  };
}

export function cameraSvgTransform(
  camera: SampledCamera,
  width: number,
  height: number,
  decimals = 3
): string {
  const zoom = clamp(Number.isFinite(camera.zoom) ? camera.zoom : 1, 0.5, 3.0);
  const f = cameraFrustum(camera, width, height);
  if (Math.abs(zoom - 1) < 1e-4 && Math.abs(f.x) < 1e-3 && Math.abs(f.y) < 1e-3) {
    return "";
  }
  return `scale(${fmt(zoom, decimals)}) translate(${fmt(-f.x, decimals)} ${fmt(-f.y, decimals)})`;
}

export function resolveCueTimeMs(program: CompiledAnimation, cueName: string): number | undefined {
  if (!cueName) return undefined;
  const event = program.events?.find((ev) => ev.marker === cueName);
  if (event && Number.isFinite(event.timeMs)) {
    return clamp(event.timeMs, 0, program.spec.durationMs);
  }
  if (program.contractVersion === CONTRACT_VERSION_V2) {
    const v2 = program.spec as AnimationSpecV2;
    for (const actor of v2.actors) {
      for (const act of actor.actions) {
        if (act.emitCue === cueName) {
          const offset = act.emitCueAt === "start" ? 0 : act.durationMs;
          return clamp(act.startMs + offset, 0, v2.durationMs);
        }
      }
    }
  }
  return undefined;
}

interface ActorFocusMetrics {
  id: string;
  x: number;
  midTorsoY: number;
  headTop: number;
  feetBottom: number;
  facing: number;
  scale: number;
}

function actorMetricsFromSampled(actor: SampledActorFrame): ActorFocusMetrics {
  const torso = actor.segments.find((s) => s.id === "torso");
  const headRadius = 11 * actor.scale;
  const headTop = actor.head.y - headRadius;
  const lShin = actor.segments.find((s) => s.id === "left-shin");
  const rShin = actor.segments.find((s) => s.id === "right-shin");
  const feetBottom = Math.max(actor.groundY, lShin?.y2 ?? actor.groundY, rShin?.y2 ?? actor.groundY);
  const midTorsoY = torso
    ? (torso.y1 + torso.y2) / 2
    : (headTop + feetBottom) / 2;
  return {
    id: actor.id,
    x: actor.x,
    midTorsoY,
    headTop,
    feetBottom,
    facing: actor.facing ?? 1,
    scale: actor.scale
  };
}

function estimateActorPosition(actor: CompiledActorSpec, timeMs: number): ActorFocusMetrics {
  let x = actor.x;
  let facing: number = actor.facing;
  for (const act of actor.actions) {
    const startX = act.from ? act.from.x : x;
    const endX = act.to ? act.to.x : startX;
    if (timeMs < act.startMs) {
      if (act.from && act === actor.actions[0]) x = act.from.x;
      break;
    }
    const endMs = act.startMs + act.durationMs;
    if (timeMs <= endMs) {
      const p = act.durationMs > 0 ? clamp01((timeMs - act.startMs) / act.durationMs) : 1;
      if (act.to && Math.abs(endX - startX) > 1e-3 && (act.from || act.action.includes("walk") || act.action.includes("run") || act.action === "jog" || act.action === "skip" || act.action === "sneak")) {
        x = startX + (endX - startX) * p;
      } else {
        x = startX;
      }
      if (Math.abs(endX - startX) > 1e-3) {
        facing = endX >= startX ? 1 : -1;
      }
      break;
    }
    if (act.to && (act.from || act.action.includes("walk") || act.action.includes("run") || act.action === "jog" || act.action === "skip" || act.action === "sneak")) {
      x = endX;
      if (Math.abs(endX - startX) > 1e-3) facing = endX >= startX ? 1 : -1;
    }
  }
  const scale = Math.max(0.2, actor.scale);
  const headTop = actor.groundY - 144 * scale;
  const feetBottom = actor.groundY;
  const midTorsoY = actor.groundY - 84 * scale;
  return {
    id: actor.id,
    x,
    midTorsoY,
    headTop,
    feetBottom,
    facing,
    scale
  };
}

function resolveActorMetrics(
  spec: AnimationSpecV2,
  actorId: string,
  timeMs: number,
  frame?: SampledFrame
): ActorFocusMetrics | undefined {
  const fromFrame = frame?.actors?.find((a) => a.id === actorId);
  if (fromFrame) return actorMetricsFromSampled(fromFrame);
  const compiled = spec.actors.find((a) => a.id === actorId);
  if (compiled) return estimateActorPosition(compiled, timeMs);
  return undefined;
}

function framingFraction(framing?: CameraFraming): number {
  if (framing === "thirds-left") return 0.36;
  if (framing === "thirds-right") return 0.64;
  return 0.5;
}

function clampCameraPose(
  rawX: number,
  rawY: number,
  rawZoom: number,
  width: number,
  height: number,
  focalActor?: ActorFocusMetrics
): { x: number; y: number; zoom: number } {
  const zoom = clamp(Number.isFinite(rawZoom) ? rawZoom : 1, 0.5, 3.0);
  const vw = width / zoom;
  const vh = height / zoom;

  let x = Number.isFinite(rawX) ? rawX : width / 2;
  let y = Number.isFinite(rawY) ? rawY : height / 2;

  if (focalActor && zoom > 1.001) {
    const padX = Math.min(28, vw * 0.08);
    const padY = Math.min(20, vh * 0.08);
    // Keep focal actor comfortably inside camera frustum (head & feet visible)
    const minCenterXForActor = focalActor.x + padX - vw / 2;
    const maxCenterXForActor = focalActor.x - padX + vw / 2;
    if (minCenterXForActor <= maxCenterXForActor) {
      x = clamp(x, minCenterXForActor, maxCenterXForActor);
    } else {
      x = focalActor.x;
    }

    const minCenterYForFeet = focalActor.feetBottom + padY - vh / 2;
    const maxCenterYForHead = focalActor.headTop - padY + vh / 2;
    if (minCenterYForFeet <= maxCenterYForHead) {
      y = clamp(y, minCenterYForFeet, maxCenterYForHead);
    } else {
      y = (focalActor.headTop + focalActor.feetBottom) / 2;
    }
  }

  // Viewport clamp invariant: frustum stays cleanly within [0..width, 0..height] when zoom >= 1
  if (vw <= width) {
    x = clamp(x, vw / 2, width - vw / 2);
  } else {
    x = clamp(x, width - vw / 2, vw / 2);
  }

  if (vh <= height) {
    y = clamp(y, vh / 2, height - vh / 2);
  } else {
    y = clamp(y, height - vh / 2, vh / 2);
  }

  return { x, y, zoom };
}

function makeSampledCamera(
  x: number,
  y: number,
  zoom: number,
  width: number,
  height: number,
  activeActorId?: string
): SampledCamera {
  const rx = round(x, 3);
  const ry = round(y, 3);
  const rz = round(zoom, 4);
  const vw = width / rz;
  const vh = height / rz;
  const vx = rx - vw / 2;
  const vy = ry - vh / 2;
  return {
    x: rx,
    y: ry,
    zoom: rz,
    viewBox: `${fmt(vx, 2)} ${fmt(vy, 2)} ${fmt(vw, 2)} ${fmt(vh, 2)}`,
    ...(activeActorId !== undefined ? { activeActorId } : {})
  };
}

interface ResolvedCameraKeyframe {
  timeMs: number;
  x?: number;
  y?: number;
  zoom: number;
  followActor?: string;
  framing: CameraFraming;
  holdMs: number;
  ease?: CameraEase;
  order: number;
}

export function buildAutoDirectorKeyframes(program: CompiledAnimation): CameraKeyframe[] {
  const { width, height } = program.spec.canvas;
  const durationMs = program.spec.durationMs;
  const wideOpen: CameraKeyframe = {
    timeMs: 0,
    x: width / 2,
    y: height / 2,
    zoom: 1,
    holdMs: Math.min(420, Math.round(durationMs * 0.14)),
    ease: "inOut"
  };

  if (program.contractVersion !== CONTRACT_VERSION_V2) {
    return [wideOpen];
  }

  const spec = program.spec as AnimationSpecV2;
  const establishMs = Math.min(420, Math.round(durationMs * 0.14));
  const resolveStartMs = durationMs >= 1400 ? Math.round(durationMs * 0.88) : durationMs;

  interface DirectorBeat {
    actorId: string;
    startMs: number;
    endMs: number;
    peakMs: number;
    action: string;
    isHero: boolean;
    hasSpeechOrCue: boolean;
    priority: number;
    actorX: number;
    actorFacing: number;
    actorScale: number;
  }

  const calloutActorAt = (actorId: string, startMs: number, endMs: number): boolean => {
    if (!spec.callouts) return false;
    return spec.callouts.some((c) => {
      if (c.actorId !== actorId) return false;
      const cs = c.startMs ?? (c.atCue ? resolveCueTimeMs(program, c.atCue) ?? 0 : 0);
      const ce = cs + Math.max(900, c.durationMs ?? 1200);
      return cs <= endMs && ce >= startMs;
    });
  };

  const candidates: DirectorBeat[] = [];
  for (const actor of spec.actors) {
    for (const act of actor.actions) {
      if (PASSIVE_ACTIONS.has(act.action)) continue;
      const startMs = act.startMs;
      const endMs = act.startMs + act.durationMs;
      const midMs = Math.round(startMs + act.durationMs * 0.45);
      const est = estimateActorPosition(actor, midMs);
      const isHero = HERO_BEAT_ACTIONS.has(act.action);
      const hasSpeechOrCue = Boolean(
        act.say || act.think || act.badge || act.emitCue || calloutActorAt(actor.id, startMs, endMs)
      );
      const priority = (isHero ? 3 : 0) + (hasSpeechOrCue ? 2 : 0) + 1;
      candidates.push({
        actorId: actor.id,
        startMs,
        endMs,
        peakMs: Math.round(startMs + act.durationMs * 0.35),
        action: act.action,
        isHero,
        hasSpeechOrCue,
        priority,
        actorX: est.x,
        actorFacing: est.facing,
        actorScale: est.scale
      });
    }
  }

  candidates.sort((a, b) => a.startMs - b.startMs || b.priority - a.priority || a.actorId.localeCompare(b.actorId));

  // Filter overlapping candidates to avoid erratic whip-pans while honoring hero beats and speaker switches
  const minBeatGapMs = Math.min(520, Math.max(260, Math.round(durationMs * 0.14)));
  const selectedBeats: DirectorBeat[] = [];
  for (const beat of candidates) {
    if (beat.startMs >= resolveStartMs - 120 && durationMs >= 1400) continue;
    const prev = selectedBeats[selectedBeats.length - 1];
    if (!prev) {
      selectedBeats.push(beat);
      continue;
    }
    const timeSincePrev = beat.startMs - prev.startMs;
    if (timeSincePrev < minBeatGapMs) {
      if (beat.priority > prev.priority) {
        selectedBeats[selectedBeats.length - 1] = beat;
      }
      continue;
    }
    if (beat.actorId === prev.actorId && !beat.isHero && prev.isHero && beat.startMs < prev.endMs + 200) {
      continue;
    }
    selectedBeats.push(beat);
  }

  if (selectedBeats.length === 0) {
    return [wideOpen];
  }

  const keyframes: CameraKeyframe[] = [wideOpen];
  const minKeyframeStep = 140;

  for (let i = 0; i < selectedBeats.length; i++) {
    const beat = selectedBeats[i]!;
    const rawTime = Math.max(establishMs + minKeyframeStep, beat.peakMs);
    const clampedTime = durationMs >= 1400
      ? Math.min(resolveStartMs - 100, rawTime)
      : Math.min(durationMs, rawTime);
    const lastKfTime = keyframes[keyframes.length - 1]?.timeMs ?? 0;
    if (clampedTime <= lastKfTime + 80) continue;

    const actorHeight = 144 * beat.actorScale;
    const maxSafeZoom = clamp((height - 44) / Math.max(100, actorHeight), 1.15, 1.32);
    const desiredZoom = beat.isHero ? 1.28 : beat.hasSpeechOrCue ? 1.22 : 1.18;
    const zoom = round(clamp(desiredZoom, 1.15, Math.min(1.32, maxSafeZoom)), 3);

    let framing: CameraFraming = "center";
    if (beat.actorX < width * 0.44 || (beat.actorX <= width * 0.56 && beat.actorFacing > 0 && spec.actors.length > 1)) {
      framing = "thirds-left";
    } else if (beat.actorX > width * 0.56 || (beat.actorX >= width * 0.44 && beat.actorFacing < 0 && spec.actors.length > 1)) {
      framing = "thirds-right";
    }

    const nextBeatTime = i + 1 < selectedBeats.length
      ? selectedBeats[i + 1]!.peakMs
      : resolveStartMs;
    const availableWindow = Math.max(0, nextBeatTime - clampedTime);
    const holdMs = Math.min(Math.round((beat.endMs - beat.startMs) * 0.45), Math.round(availableWindow * 0.5), 700);

    keyframes.push({
      timeMs: clampedTime,
      followActor: beat.actorId,
      framing,
      zoom,
      ...(holdMs > 40 ? { holdMs } : {}),
      ease: "inOut"
    });
  }

  // Pull back cleanly to wide establishing framing for the finale/resolve
  const lastKf = keyframes[keyframes.length - 1]!;
  if (lastKf.zoom !== 1 || lastKf.followActor !== undefined) {
    const finaleTime = durationMs;
    keyframes.push({
      timeMs: finaleTime,
      x: width / 2,
      y: height / 2,
      zoom: 1,
      ease: "inOut"
    });
  }

  return keyframes;
}

export function sampleCamera(
  program: CompiledAnimation,
  timeMs: number,
  frame?: SampledFrame
): SampledCamera {
  const { width, height } = program.spec.canvas;
  const durationMs = program.spec.durationMs;
  const clampedT = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, durationMs);

  if (program.contractVersion !== CONTRACT_VERSION_V2) {
    return makeSampledCamera(width / 2, height / 2, 1, width, height);
  }

  const spec = program.spec as AnimationSpecV2;
  if (spec.camera === undefined) {
    return makeSampledCamera(width / 2, height / 2, 1, width, height);
  }

  const rawList: readonly CameraKeyframe[] =
    spec.camera === "auto-director"
      ? buildAutoDirectorKeyframes(program)
      : spec.camera;

  if (rawList.length === 0) {
    return makeSampledCamera(width / 2, height / 2, 1, width, height);
  }

  const resolved: ResolvedCameraKeyframe[] = rawList.map((kf, idx) => {
    let t: number;
    if (typeof kf.timeMs === "number" && Number.isFinite(kf.timeMs)) {
      t = clamp(kf.timeMs, 0, durationMs);
    } else if (typeof kf.atCue === "string" && kf.atCue.trim()) {
      t = resolveCueTimeMs(program, kf.atCue.trim()) ?? 0;
    } else {
      t = idx === 0 ? 0 : Math.round((idx / Math.max(1, rawList.length - 1)) * durationMs);
    }
    return {
      timeMs: t,
      ...(typeof kf.x === "number" && Number.isFinite(kf.x) ? { x: kf.x } : {}),
      ...(typeof kf.y === "number" && Number.isFinite(kf.y) ? { y: kf.y } : {}),
      zoom: clamp(typeof kf.zoom === "number" && Number.isFinite(kf.zoom) ? kf.zoom : 1, 0.5, 3.0),
      ...(typeof kf.followActor === "string" && kf.followActor.trim() ? { followActor: kf.followActor.trim() } : {}),
      framing: kf.framing ?? "center",
      holdMs: typeof kf.holdMs === "number" && Number.isFinite(kf.holdMs) && kf.holdMs > 0 ? kf.holdMs : 0,
      ...(kf.ease !== undefined ? { ease: kf.ease } : {}),
      order: idx
    };
  });

  resolved.sort((a, b) => a.timeMs - b.timeMs || a.order - b.order);

  const evalKeyframe = (kf: ResolvedCameraKeyframe, evalTimeMs: number) => {
    const zoom = kf.zoom;
    const vw = width / zoom;
    const actor = kf.followActor ? resolveActorMetrics(spec, kf.followActor, evalTimeMs, frame) : undefined;
    let rawX = kf.x ?? width / 2;
    let rawY = kf.y ?? height / 2;
    if (actor) {
      const f = framingFraction(kf.framing);
      if (kf.x === undefined) {
        rawX = actor.x + (0.5 - f) * vw;
      }
      if (kf.y === undefined) {
        rawY = actor.midTorsoY;
      }
    }
    const clamped = clampCameraPose(rawX, rawY, zoom, width, height, actor);
    return {
      ...clamped,
      actor,
      ...(kf.followActor !== undefined ? { activeActorId: kf.followActor } : {})
    };
  };

  if (resolved.length === 1 || clampedT <= resolved[0]!.timeMs) {
    const p = evalKeyframe(resolved[0]!, clampedT);
    return makeSampledCamera(p.x, p.y, p.zoom, width, height, p.activeActorId);
  }

  const last = resolved[resolved.length - 1]!;
  if (clampedT >= last.timeMs) {
    const p = evalKeyframe(last, clampedT);
    return makeSampledCamera(p.x, p.y, p.zoom, width, height, p.activeActorId);
  }

  // Locate surrounding keyframes prev <= clampedT < next
  let segIdx = 0;
  for (let i = 0; i < resolved.length - 1; i++) {
    if (clampedT >= resolved[i]!.timeMs && clampedT < resolved[i + 1]!.timeMs) {
      segIdx = i;
      break;
    }
  }

  const prev = resolved[segIdx]!;
  const next = resolved[segIdx + 1]!;
  const ease: CameraEase = next.ease ?? prev.ease ?? "inOut";
  const holdEnd = Math.min(next.timeMs, prev.timeMs + prev.holdMs);

  if (clampedT <= holdEnd || ease === "cut") {
    const p = evalKeyframe(prev, clampedT);
    return makeSampledCamera(p.x, p.y, p.zoom, width, height, p.activeActorId);
  }

  const span = Math.max(1e-6, next.timeMs - holdEnd);
  const u = clamp01((clampedT - holdEnd) / span);
  const w = ease === "linear" ? u : hermite(u);

  const a = evalKeyframe(prev, clampedT);
  const b = evalKeyframe(next, clampedT);
  const interpZoom = a.zoom + (b.zoom - a.zoom) * w;
  const interpX = a.x + (b.x - a.x) * w;
  const interpY = a.y + (b.y - a.y) * w;
  const activeActorId = w < 0.5 ? (a.activeActorId ?? b.activeActorId) : (b.activeActorId ?? a.activeActorId);
  const focalActor = w < 0.5 ? a.actor : b.actor;
  const clamped = clampCameraPose(interpX, interpY, interpZoom, width, height, focalActor);

  return makeSampledCamera(clamped.x, clamped.y, clamped.zoom, width, height, activeActorId);
}
