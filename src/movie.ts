import {
  CONTRACT_VERSION_MOVIE,
  CONTRACT_VERSION_V2,
  type AnimationSpecV2,
  type BackdropPreset,
  type ChoreographInput,
  type ChoreographTheme,
  type CompiledAnimation,
  type CompiledMovie,
  type CompiledMovieScene,
  type ComposeMovieResult,
  type Diagnostic,
  type MovieMarkerEvent,
  type MovieSceneInput,
  type MovieSpecInput,
  type PlaybackMode,
  type RenderStyle,
  type SampledCallout,
  type SampledFrame,
  type SampledMovieFrame,
  type SceneTransitionKind,
  type TransitionOverlay
} from "./contract.js";
import { BACKDROP_PRESETS, SCENE_TRANSITION_KINDS, movieSchema } from "./contract-schema.js";
import { cameraFrustum, cameraSvgTransform } from "./camera.js";
import { resolveCompiledCallouts } from "./callouts.js";
import { choreographAnimation, compileV2Animation } from "./choreograph.js";
import { sampleAnimation } from "./compiler.js";
import { escapeXml, renderBlueprintDefsSvg, renderBlueprintPatternsSvg } from "./props.js";
import {
  BLUEPRINT_STAGE_STYLE,
  HTML_SHELL_STYLE,
  buildCoalescedSvgSlices,
  renderBlueprintFrameSceneSvg,
  renderBlueprintStageBackdropSvg,
  renderSceneInnerSvg,
  type RenderStyleOptions,
  type SceneRenderOptions
} from "./render.js";
import { buildCompactPlayerPayload, renderCompactPlayerScript } from "./player-runtime.js";
import {
  selectStoryboardTimestamps,
  type StoryboardOptions,
  type StoryboardTheme
} from "./storyboard.js";

export {
  BACKDROP_PRESETS,
  CONTRACT_VERSION_MOVIE,
  SCENE_TRANSITION_KINDS,
  movieSchema
};

export interface BackdropRenderOptions {
  blueprint?: boolean;
  accentColor?: string;
  decimals?: number;
}

export interface MovieStoryboardBeat {
  sceneId: string;
  sceneIndex: number;
  sceneTitle?: string;
  localTimeMs: number;
  timeMs: number;
}

const DEFAULT_MOVIE_CANVAS = { width: 1280, height: 720, fps: 30 } as const;
const DEFAULT_MAX_IDLE_TAIL_MS = 600;
const MIN_SETTLE_TAIL_MS = 350;
const DEFAULT_TRANSITION_MS = 400;
const MAX_MOVIE_SCENES = 16;

const BACKDROP_SET = new Set<string>(BACKDROP_PRESETS);
const TRANSITION_SET = new Set<string>(SCENE_TRANSITION_KINDS);
const PASSIVE_TAIL_ACTIONS = new Set<string>(["idle", "seated-idle", "static-pose", "hold-pose"]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Math.abs(rounded) < 1e-6 ? 0 : rounded;
}

function num(value: number, decimals = 2): string {
  return round(value, decimals).toString();
}

function hermite(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

export function isCompiledMovie(value: unknown): value is CompiledMovie {
  return (
    typeof value === "object" &&
    value !== null &&
    "contractVersion" in value &&
    (value as { contractVersion?: unknown }).contractVersion === CONTRACT_VERSION_MOVIE &&
    "scenes" in value &&
    Array.isArray((value as { scenes?: unknown }).scenes)
  );
}

export function renderBackdropSvg(
  preset: BackdropPreset,
  width: number,
  height: number,
  groundY: number,
  options: BackdropRenderOptions = {}
): string {
  if (preset === "none") return "";
  const decimals = options.decimals ?? 2;
  const n = (v: number): string => num(v, decimals);
  const scale = Math.max(0.5, Math.min(2, width / 1280));
  const sw = Math.max(0.9, 1.35 * scale);
  const swThin = Math.max(0.7, 1 * scale);
  const strokeMain = options.blueprint ? "#94a3b8" : "#cbd5e1";
  const strokeSoft = options.blueprint ? "#cbd5e1" : "#e2e8f0";
  const fillWhisper = options.blueprint ? "none" : "#f8fafc";
  const dotMuted = options.blueprint ? "#64748b" : "#94a3b8";

  const gy = clamp(groundY, height * 0.4, height * 0.96);
  const wallH = gy;

  switch (preset) {
    case "office": {
      const winW = width * 0.16;
      const winH = wallH * 0.34;
      const winY = wallH * 0.16;
      const leftWinX = width * 0.08;
      const rightWinX = width * 0.76;
      const baseboardY = gy - 14 * scale;

      const drawWindow = (wx: number): string =>
        `<rect x="${n(wx)}" y="${n(winY)}" width="${n(winW)}" height="${n(winH)}" rx="${n(3 * scale)}" fill="${fillWhisper}" stroke="${strokeMain}" stroke-width="${n(sw)}"/>` +
        `<line x1="${n(wx + winW / 2)}" y1="${n(winY)}" x2="${n(wx + winW / 2)}" y2="${n(winY + winH)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>` +
        `<line x1="${n(wx)}" y1="${n(winY + winH * 0.52)}" x2="${n(wx + winW)}" y2="${n(winY + winH * 0.52)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>` +
        `<line x1="${n(wx - 6 * scale)}" y1="${n(winY + winH + 2 * scale)}" x2="${n(wx + winW + 6 * scale)}" y2="${n(winY + winH + 2 * scale)}" stroke="${strokeMain}" stroke-width="${n(sw)}"/>`;

      // Quiet potted plant outline on far right
      const px = width * 0.93;
      const potW = 26 * scale;
      const potH = 28 * scale;
      const plant =
        `<path d="M${n(px - potW * 0.5)} ${n(gy - potH)}H${n(px + potW * 0.5)}L${n(px + potW * 0.36)} ${n(gy)}H${n(px - potW * 0.36)}Z" fill="${fillWhisper}" stroke="${strokeMain}" stroke-width="${n(sw)}"/>` +
        `<path d="M${n(px)} ${n(gy - potH)}V${n(gy - potH - 42 * scale)}M${n(px)} ${n(gy - potH - 12 * scale)}Q${n(px - 18 * scale)} ${n(gy - potH - 22 * scale)} ${n(px - 14 * scale)} ${n(gy - potH - 36 * scale)}M${n(px)} ${n(gy - potH - 18 * scale)}Q${n(px + 20 * scale)} ${n(gy - potH - 26 * scale)} ${n(px + 15 * scale)} ${n(gy - potH - 40 * scale)}" stroke="${strokeMain}" stroke-width="${n(sw)}" stroke-linecap="round"/>`;

      return (
        `<g data-backdrop="office" fill="none">` +
        `<line x1="0" y1="${n(baseboardY)}" x2="${n(width)}" y2="${n(baseboardY)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>` +
        `${drawWindow(leftWinX)}${drawWindow(rightWinX)}${plant}` +
        `</g>`
      );
    }

    case "datacenter": {
      const rackCount = 5;
      const marginX = width * 0.08;
      const spanW = width - marginX * 2;
      const gap = spanW * 0.04;
      const rackW = (spanW - gap * (rackCount - 1)) / rackCount;
      const rackH = wallH * 0.58;
      const rackY = gy - rackH;
      const racks = Array.from({ length: rackCount }, (_, i) => {
        const rx = marginX + i * (rackW + gap);
        const bays = [0.22, 0.4, 0.58, 0.76]
          .map((frac) => {
            const by = rackY + rackH * frac;
            return (
              `<line x1="${n(rx + 6 * scale)}" y1="${n(by)}" x2="${n(rx + rackW - 6 * scale)}" y2="${n(by)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>` +
              `<circle cx="${n(rx + rackW - 12 * scale)}" cy="${n(by - 8 * scale)}" r="${n(1.8 * scale)}" fill="${dotMuted}" stroke="none"/>`
            );
          })
          .join("");
        return (
          `<rect x="${n(rx)}" y="${n(rackY)}" width="${n(rackW)}" height="${n(rackH)}" rx="${n(3 * scale)}" fill="${fillWhisper}" stroke="${strokeMain}" stroke-width="${n(sw)}"/>` +
          `<circle cx="${n(rx + 10 * scale)}" cy="${n(rackY + 10 * scale)}" r="${n(2 * scale)}" fill="${dotMuted}" stroke="none"/>` +
          `<circle cx="${n(rx + 18 * scale)}" cy="${n(rackY + 10 * scale)}" r="${n(2 * scale)}" fill="${strokeMain}" stroke-width="${n(swThin)}"/>` +
          `${bays}`
        );
      }).join("");

      const cableTrayY = Math.max(16 * scale, rackY - 26 * scale);
      return (
        `<g data-backdrop="datacenter" fill="none">` +
        `<line x1="${n(marginX * 0.5)}" y1="${n(cableTrayY)}" x2="${n(width - marginX * 0.5)}" y2="${n(cableTrayY)}" stroke="${strokeSoft}" stroke-width="${n(sw)}"/>` +
        `<line x1="${n(marginX * 0.5)}" y1="${n(cableTrayY + 6 * scale)}" x2="${n(width - marginX * 0.5)}" y2="${n(cableTrayY + 6 * scale)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>` +
        `${racks}` +
        `</g>`
      );
    }

    case "war-room": {
      const wallX = width * 0.14;
      const wallW = width * 0.72;
      const wallTop = wallH * 0.1;
      const wallDisplayH = wallH * 0.42;
      const splitX = wallX + wallW * 0.56;
      const midY = wallTop + wallDisplayH * 0.58;
      const warStrokeMain = options.blueprint ? "#64748b" : "#94a3b8";
      const warStrokeSoft = options.blueprint ? "#94a3b8" : "#cbd5e1";
      const warSparkline = options.blueprint ? "#475569" : "#64748b";
      const warSw = sw * 1.15;
      const warSwThin = swThin * 1.1;

      // Subtle uptime sparkline inside left display zone
      const spLeft = wallX + 18 * scale;
      const spRight = splitX - 18 * scale;
      const spPoints = [
        [0, 0.72],
        [0.14, 0.68],
        [0.26, 0.7],
        [0.38, 0.34],
        [0.48, 0.24],
        [0.6, 0.52],
        [0.74, 0.66],
        [0.88, 0.68],
        [1, 0.7]
      ]
        .map(([fx, fy]) => `${n(spLeft + (spRight - spLeft) * fx!)},${n(wallTop + wallDisplayH * fy!)}`)
        .join(" ");

      // Incident timeline grid ticks on lower/right panel
      const gridCols = 6;
      const gridLines = Array.from({ length: gridCols }, (_, i) => {
        const gx = wallX + ((i + 1) / (gridCols + 1)) * wallW;
        return `<line x1="${n(gx)}" y1="${n(wallTop + 10 * scale)}" x2="${n(gx)}" y2="${n(wallTop + wallDisplayH - 10 * scale)}" stroke="${warStrokeSoft}" stroke-width="${n(warSwThin)}" stroke-dasharray="${n(3 * scale)} ${n(4 * scale)}"/>`;
      }).join("");

      const timelineY = wallTop + wallDisplayH * 0.78;
      const timelineNodes = [0.64, 0.74, 0.85, 0.93]
        .map((fx) => `<circle cx="${n(wallX + wallW * fx)}" cy="${n(timelineY)}" r="${n(3.1 * scale)}" fill="${fillWhisper}" stroke="${warStrokeMain}" stroke-width="${n(warSwThin)}"/>`)
        .join("");

      return (
        `<g data-backdrop="war-room" fill="none">` +
        `<rect x="${n(wallX)}" y="${n(wallTop)}" width="${n(wallW)}" height="${n(wallDisplayH)}" rx="${n(5 * scale)}" fill="${fillWhisper}" stroke="${warStrokeMain}" stroke-width="${n(warSw)}"/>` +
        `${gridLines}` +
        `<line x1="${n(splitX)}" y1="${n(wallTop + 12 * scale)}" x2="${n(splitX)}" y2="${n(wallTop + wallDisplayH - 12 * scale)}" stroke="${warStrokeSoft}" stroke-width="${n(warSwThin)}"/>` +
        `<line x1="${n(wallX + 12 * scale)}" y1="${n(midY)}" x2="${n(wallX + wallW - 12 * scale)}" y2="${n(midY)}" stroke="${warStrokeSoft}" stroke-width="${n(warSwThin)}"/>` +
        `<polyline points="${spPoints}" stroke="${warSparkline}" stroke-width="${n(sw * 1.35)}" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<line x1="${n(splitX + 16 * scale)}" y1="${n(timelineY)}" x2="${n(wallX + wallW - 16 * scale)}" y2="${n(timelineY)}" stroke="${warStrokeMain}" stroke-width="${n(warSwThin)}"/>` +
        `${timelineNodes}` +
        `</g>`
      );
    }

    case "classroom": {
      const boardX = width * 0.2;
      const boardW = width * 0.6;
      const boardY = wallH * 0.14;
      const boardH = wallH * 0.42;
      const slatXs = [0.05, 0.08, 0.11, 0.14, 0.86, 0.89, 0.92, 0.95];
      const slats = slatXs
        .map((fx) => `<line x1="${n(width * fx)}" y1="${n(wallH * 0.08)}" x2="${n(width * fx)}" y2="${n(gy - 12 * scale)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>`)
        .join("");
      const clockCx = width * 0.89;
      const clockCy = wallH * 0.18;
      const clockR = 16 * scale;
      return (
        `<g data-backdrop="classroom" fill="none">` +
        `${slats}` +
        `<rect x="${n(boardX)}" y="${n(boardY)}" width="${n(boardW)}" height="${n(boardH)}" rx="${n(3 * scale)}" fill="${fillWhisper}" stroke="${strokeMain}" stroke-width="${n(sw)}"/>` +
        `<line x1="${n(boardX - 8 * scale)}" y1="${n(boardY + boardH + 4 * scale)}" x2="${n(boardX + boardW + 8 * scale)}" y2="${n(boardY + boardH + 4 * scale)}" stroke="${strokeMain}" stroke-width="${n(sw)}"/>` +
        `<circle cx="${n(clockCx)}" cy="${n(clockCy)}" r="${n(clockR)}" fill="${fillWhisper}" stroke="${strokeMain}" stroke-width="${n(swThin)}"/>` +
        `<path d="M${n(clockCx)} ${n(clockCy - clockR * 0.55)}V${n(clockCy)}L${n(clockCx + clockR * 0.42)} ${n(clockCy + clockR * 0.22)}" stroke="${strokeMain}" stroke-width="${n(swThin)}" stroke-linecap="round"/>` +
        `</g>`
      );
    }

    case "court": {
      const horizonY = gy - wallH * 0.24;
      const seamXs = [0.2, 0.4, 0.6, 0.8]
        .map((fx) => `<line x1="${n(width * fx)}" y1="0" x2="${n(width * fx)}" y2="${n(horizonY)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>`)
        .join("");
      const floorH = Math.max(12, height - gy);
      const keyY = gy + floorH * 0.42;
      const centerX = width * 0.5;
      const arcR = Math.min(width * 0.11, floorH * 0.72);
      return (
        `<g data-backdrop="court" fill="none">` +
        `${seamXs}` +
        `<line x1="0" y1="${n(horizonY)}" x2="${n(width)}" y2="${n(horizonY)}" stroke="${strokeSoft}" stroke-width="${n(sw)}"/>` +
        `<path d="M${n(width * 0.08)} ${n(gy)}L${n(width * 0.04)} ${n(height)}M${n(width * 0.92)} ${n(gy)}L${n(width * 0.96)} ${n(height)}" stroke="${strokeMain}" stroke-width="${n(swThin)}"/>` +
        `<line x1="${n(width * 0.12)}" y1="${n(keyY)}" x2="${n(width * 0.88)}" y2="${n(keyY)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}" stroke-dasharray="${n(6 * scale)} ${n(4 * scale)}"/>` +
        `<ellipse cx="${n(centerX)}" cy="${n(gy + floorH * 0.36)}" rx="${n(arcR)}" ry="${n(Math.max(4, arcR * 0.24))}" stroke="${strokeMain}" stroke-width="${n(swThin)}"/>` +
        `</g>`
      );
    }

    case "outdoor": {
      const horizonY = gy - wallH * 0.14;
      const cloud = (cx: number, cy: number, s: number): string =>
        `<path d="M${n(cx - 42 * s)} ${n(cy)}H${n(cx + 42 * s)}A${n(14 * s)} ${n(14 * s)} 0 0 0 ${n(cx + 30 * s)} ${n(cy - 18 * s)}A${n(20 * s)} ${n(20 * s)} 0 0 0 ${n(cx - 8 * s)} ${n(cy - 22 * s)}A${n(15 * s)} ${n(15 * s)} 0 0 0 ${n(cx - 42 * s)} ${n(cy)}Z" fill="${fillWhisper}" stroke="${strokeMain}" stroke-width="${n(swThin)}"/>`;
      const ticks = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]
        .map((fx) => `<line x1="${n(width * fx)}" y1="${n(gy)}" x2="${n(width * fx)}" y2="${n(gy + 7 * scale)}" stroke="${strokeMain}" stroke-width="${n(swThin)}"/>`)
        .join("");
      return (
        `<g data-backdrop="outdoor" fill="none">` +
        `<line x1="0" y1="${n(horizonY)}" x2="${n(width)}" y2="${n(horizonY)}" stroke="${strokeSoft}" stroke-width="${n(swThin)}"/>` +
        `${cloud(width * 0.22, wallH * 0.22, scale)}${cloud(width * 0.76, wallH * 0.18, scale * 0.88)}` +
        `${ticks}` +
        `</g>`
      );
    }
  }
}

function normalizeTransition(
  input: MovieSceneInput["transition"],
  scenePath: string,
  diagnostics: Diagnostic[]
): { kind: SceneTransitionKind; durationMs: number } {
  if (input === undefined) {
    return { kind: "cut", durationMs: 0 };
  }
  if (typeof input === "string") {
    if (!TRANSITION_SET.has(input)) {
      diagnostics.push({
        path: `${scenePath}.transition`,
        code: "invalid_transition",
        message: `Unknown transition "${input}". Expected one of: ${SCENE_TRANSITION_KINDS.join(", ")}.`
      });
      return { kind: "cut", durationMs: 0 };
    }
    const kind = input as SceneTransitionKind;
    return { kind, durationMs: kind === "cut" ? 0 : DEFAULT_TRANSITION_MS };
  }
  if (typeof input === "object" && input !== null) {
    const kindRaw = input.kind;
    if (typeof kindRaw !== "string" || !TRANSITION_SET.has(kindRaw)) {
      diagnostics.push({
        path: `${scenePath}.transition.kind`,
        code: "invalid_transition",
        message: `Unknown transition kind "${String(kindRaw)}". Expected one of: ${SCENE_TRANSITION_KINDS.join(", ")}.`
      });
      return { kind: "cut", durationMs: 0 };
    }
    const kind = kindRaw as SceneTransitionKind;
    if (input.durationMs !== undefined) {
      if (typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 5000) {
        diagnostics.push({
          path: `${scenePath}.transition.durationMs`,
          code: "invalid_transition_duration",
          message: "Transition durationMs must be a finite number between 0 and 5000."
        });
        return { kind, durationMs: kind === "cut" ? 0 : DEFAULT_TRANSITION_MS };
      }
      return { kind, durationMs: kind === "cut" ? 0 : Math.round(input.durationMs) };
    }
    return { kind, durationMs: kind === "cut" ? 0 : DEFAULT_TRANSITION_MS };
  }
  diagnostics.push({
    path: `${scenePath}.transition`,
    code: "invalid_transition",
    message: "Transition must be a transition kind string or { kind, durationMs } object."
  });
  return { kind: "cut", durationMs: 0 };
}

function trimSceneIdleTail(
  program: CompiledAnimation,
  maxIdleTailMs: number
): { program: CompiledAnimation; trimmedIdleMs: number } {
  if (program.contractVersion !== CONTRACT_VERSION_V2) {
    return { program, trimmedIdleMs: 0 };
  }
  const spec = program.spec as AnimationSpecV2;
  let lastActiveActionEndMs = 0;
  let lastAnyActionEndMs = 0;

  for (const actor of spec.actors) {
    for (const act of actor.actions) {
      const endMs = act.startMs + act.durationMs;
      if (endMs > lastAnyActionEndMs) lastAnyActionEndMs = endMs;
      if (!PASSIVE_TAIL_ACTIONS.has(act.action) && endMs > lastActiveActionEndMs) {
        lastActiveActionEndMs = endMs;
      }
    }
  }

  let lastCalloutEndMs = 0;
  for (const callout of resolveCompiledCallouts(program)) {
    if (callout.endMs > lastCalloutEndMs) {
      lastCalloutEndMs = callout.endMs;
    }
  }

  const lastActiveEndMs =
    lastActiveActionEndMs > 0
      ? Math.max(lastActiveActionEndMs, lastCalloutEndMs)
      : Math.max(lastAnyActionEndMs, lastCalloutEndMs);

  const tailMs = spec.durationMs - lastActiveEndMs;
  if (lastActiveEndMs <= 0 || tailMs <= maxIdleTailMs) {
    return { program, trimmedIdleMs: 0 };
  }

  const settleTailMs = Math.max(MIN_SETTLE_TAIL_MS, Math.min(maxIdleTailMs, 400));
  const targetDurationMs = Math.min(spec.durationMs, Math.max(100, Math.ceil(lastActiveEndMs + settleTailMs)));
  if (targetDurationMs >= spec.durationMs) {
    return { program, trimmedIdleMs: 0 };
  }

  const trimmedActors = spec.actors.map((actor) => {
    const nextActions = [];
    for (const act of actor.actions) {
      const endMs = act.startMs + act.durationMs;
      if (endMs <= targetDurationMs) {
        nextActions.push({ ...act });
        continue;
      }
      if (PASSIVE_TAIL_ACTIONS.has(act.action)) {
        if (act.startMs >= targetDurationMs) continue;
        const clampedDuration = targetDurationMs - act.startMs;
        if (clampedDuration >= 100) {
          nextActions.push({ ...act, durationMs: clampedDuration });
        }
        continue;
      }
      nextActions.push({ ...act });
    }
    return { ...actor, actions: nextActions };
  });

  const maxRequiredEndMs = Math.max(
    targetDurationMs,
    lastCalloutEndMs,
    ...trimmedActors.flatMap((a) => a.actions.map((act) => act.startMs + act.durationMs))
  );
  const finalDurationMs = Math.min(spec.durationMs, Math.ceil(maxRequiredEndMs));
  if (finalDurationMs >= spec.durationMs) {
    return { program, trimmedIdleMs: 0 };
  }

  const primaryActions = trimmedActors[0]?.actions ?? [];
  const trimmedSpec: AnimationSpecV2 = {
    ...spec,
    durationMs: finalDurationMs,
    actors: trimmedActors,
    actions: primaryActions
  };
  const recompiled = compileV2Animation(trimmedSpec);
  if (!recompiled.valid || !recompiled.program) {
    return { program, trimmedIdleMs: 0 };
  }
  return {
    program: recompiled.program,
    trimmedIdleMs: spec.durationMs - finalDurationMs
  };
}

export function composeMovie(input: MovieSpecInput): ComposeMovieResult {
  const diagnostics: Diagnostic[] = [];

  if (!input || typeof input !== "object") {
    return {
      valid: false,
      diagnostics: [{ path: "", code: "invalid_movie", message: "Movie input must be an object." }]
    };
  }

  if (input.version !== undefined && input.version !== CONTRACT_VERSION_MOVIE) {
    diagnostics.push({
      path: "version",
      code: "invalid_version",
      message: `Expected movie contract version "${CONTRACT_VERSION_MOVIE}".`
    });
  }

  const canvas = {
    width: input.canvas?.width ?? DEFAULT_MOVIE_CANVAS.width,
    height: input.canvas?.height ?? DEFAULT_MOVIE_CANVAS.height,
    fps: input.canvas?.fps ?? DEFAULT_MOVIE_CANVAS.fps
  };
  if (!Number.isInteger(canvas.width) || canvas.width < 64 || canvas.width > 4096) {
    diagnostics.push({ path: "canvas.width", code: "invalid_canvas", message: "canvas.width must be an integer between 64 and 4096." });
  }
  if (!Number.isInteger(canvas.height) || canvas.height < 64 || canvas.height > 4096) {
    diagnostics.push({ path: "canvas.height", code: "invalid_canvas", message: "canvas.height must be an integer between 64 and 4096." });
  }
  if (!Number.isInteger(canvas.fps) || canvas.fps < 1 || canvas.fps > 60) {
    diagnostics.push({ path: "canvas.fps", code: "invalid_canvas", message: "canvas.fps must be an integer between 1 and 60." });
  }

  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    diagnostics.push({
      path: "scenes",
      code: "empty_scenes",
      message: "Movie must contain between 1 and 16 scenes."
    });
    return { valid: false, diagnostics };
  }
  if (input.scenes.length > MAX_MOVIE_SCENES) {
    diagnostics.push({
      path: "scenes",
      code: "too_many_scenes",
      message: `Movie may contain at most ${MAX_MOVIE_SCENES} scenes (got ${input.scenes.length}).`
    });
  }

  const defaultTrimIdleTails = input.trimIdleTails ?? true;
  const seenIds = new Set<string>();
  const compiledScenes: CompiledMovieScene[] = [];
  const globalEvents: MovieMarkerEvent[] = [];
  let cursorMs = 0;

  for (let i = 0; i < input.scenes.length; i++) {
    const scene = input.scenes[i]!;
    const scenePath = `scenes[${i}]`;

    if (!scene || typeof scene !== "object") {
      diagnostics.push({ path: scenePath, code: "invalid_scene", message: "Each scene must be an object." });
      continue;
    }

    const sceneId = typeof scene.id === "string" ? scene.id.trim() : "";
    if (!sceneId) {
      diagnostics.push({ path: `${scenePath}.id`, code: "invalid_scene_id", message: "Scene id must be a non-empty string." });
    } else if (seenIds.has(sceneId)) {
      diagnostics.push({ path: `${scenePath}.id`, code: "duplicate_scene_id", message: `Duplicate scene id "${sceneId}".` });
    } else {
      seenIds.add(sceneId);
    }

    const backdropRaw = scene.backdrop ?? "none";
    if (typeof backdropRaw !== "string" || !BACKDROP_SET.has(backdropRaw)) {
      diagnostics.push({
        path: `${scenePath}.backdrop`,
        code: "invalid_backdrop",
        message: `Unknown backdrop "${String(backdropRaw)}". Expected one of: ${BACKDROP_PRESETS.join(", ")}.`
      });
    }
    const backdrop: BackdropPreset = BACKDROP_SET.has(String(backdropRaw)) ? (backdropRaw as BackdropPreset) : "none";

    const rawTransition = normalizeTransition(scene.transition, scenePath, diagnostics);

    if (scene.maxIdleTailMs !== undefined) {
      if (typeof scene.maxIdleTailMs !== "number" || !Number.isFinite(scene.maxIdleTailMs) || scene.maxIdleTailMs < 0) {
        diagnostics.push({
          path: `${scenePath}.maxIdleTailMs`,
          code: "invalid_max_idle_tail",
          message: "maxIdleTailMs must be a finite non-negative number."
        });
      }
    }

    const mergedTheme: ChoreographTheme | undefined =
      input.theme || scene.theme
        ? {
            ...(input.theme ?? {}),
            ...(scene.theme ?? {})
          }
        : undefined;

    const choreographInput: ChoreographInput = {
      canvas,
      ...(scene.durationMs !== undefined ? { durationMs: scene.durationMs } : {}),
      ...(scene.groundY !== undefined ? { groundY: scene.groundY } : {}),
      ...(mergedTheme !== undefined ? { theme: mergedTheme } : {}),
      ...(scene.addons !== undefined ? { addons: scene.addons } : {}),
      ...(scene.anchors !== undefined ? { anchors: scene.anchors } : {}),
      ...(scene.targets !== undefined ? { targets: scene.targets } : {}),
      ...(scene.stageProps !== undefined ? { stageProps: scene.stageProps } : {}),
      ...(scene.customMotions !== undefined ? { customMotions: scene.customMotions } : {}),
      ...(scene.camera !== undefined ? { camera: scene.camera } : {}),
      ...(scene.spotlight !== undefined ? { spotlight: scene.spotlight } : {}),
      ...(scene.callouts !== undefined ? { callouts: scene.callouts } : {}),
      ...(scene.actors !== undefined ? { actors: scene.actors } : {}),
      ...(scene.actor !== undefined ? { actor: scene.actor } : {}),
      ...(scene.actions !== undefined ? { actions: scene.actions } : {})
    };

    const choreo = choreographAnimation(choreographInput);
    if (!choreo.valid || !choreo.program) {
      for (const diag of choreo.diagnostics) {
        diagnostics.push({
          path: diag.path ? `${scenePath}.${diag.path}` : scenePath,
          code: diag.code,
          message: diag.message
        });
      }
      continue;
    }

    let sceneProgram = choreo.program;
    let trimmedIdleMs = 0;
    const shouldTrim = scene.trimIdleTails ?? defaultTrimIdleTails;
    if (shouldTrim) {
      const trimmed = trimSceneIdleTail(sceneProgram, scene.maxIdleTailMs ?? DEFAULT_MAX_IDLE_TAIL_MS);
      sceneProgram = trimmed.program;
      trimmedIdleMs = trimmed.trimmedIdleMs;
    }

    const sceneDurationMs = sceneProgram.spec.durationMs;
    const effectiveTransitionMs =
      rawTransition.kind === "cut"
        ? 0
        : Math.min(rawTransition.durationMs, Math.floor(sceneDurationMs * 0.45));

    const startMs = cursorMs;
    const endMs = startMs + sceneDurationMs;
    cursorMs = endMs;

    for (const ev of sceneProgram.events ?? []) {
      globalEvents.push({
        ...ev,
        timeMs: Number((startMs + ev.timeMs).toFixed(3)),
        sceneId
      });
    }

    compiledScenes.push({
      id: sceneId,
      index: i,
      ...(scene.title !== undefined ? { title: scene.title } : {}),
      ...(scene.caption !== undefined ? { caption: scene.caption } : {}),
      backdrop,
      transition: { kind: rawTransition.kind, durationMs: effectiveTransitionMs },
      startMs,
      endMs,
      durationMs: sceneDurationMs,
      trimmedIdleMs,
      program: sceneProgram
    });
  }

  if (diagnostics.length > 0 || compiledScenes.length === 0) {
    return { valid: false, diagnostics };
  }

  const totalDurationMs = compiledScenes[compiledScenes.length - 1]!.endMs;
  const movie: CompiledMovie = {
    contractVersion: CONTRACT_VERSION_MOVIE,
    spec: {
      version: CONTRACT_VERSION_MOVIE,
      ...(input.title !== undefined ? { title: input.title } : {}),
      canvas,
      durationMs: totalDurationMs,
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      trimIdleTails: defaultTrimIdleTails,
      scenes: input.scenes
    },
    scenes: compiledScenes,
    durationMs: totalDurationMs,
    events: globalEvents
  };

  return { valid: true, diagnostics: [], movie };
}

function buildSceneCaptionCallout(
  scene: CompiledMovieScene,
  frame: SampledFrame,
  canvasWidth: number,
  canvasHeight: number
): SampledCallout | undefined {
  const rawText = scene.caption?.trim();
  if (!rawText) return undefined;

  const existing = frame.callouts ?? [];
  if (existing.some((c) => c.kind === "caption" && c.text.trim() === rawText)) {
    return undefined;
  }

  const margin = 10;
  let minX = margin;
  let minY = margin;
  let maxX = canvasWidth - margin;
  let maxY = canvasHeight - margin;

  if (frame.camera && frame.camera.zoom > 1.001) {
    const frustum = cameraFrustum(frame.camera, canvasWidth, canvasHeight);
    minX = Math.max(minX, frustum.x + margin);
    minY = Math.max(minY, frustum.y + margin);
    maxX = Math.min(maxX, frustum.x + frustum.width - margin);
    maxY = Math.min(maxY, frustum.y + frustum.height - margin);
  }

  const viewportW = Math.max(120, maxX - minX);
  const estWidth = Math.ceil(Math.min(viewportW - 12, Math.max(140, rawText.length * 7.4 + 32)));
  const estHeight = rawText.length > 72 ? 50 : 34;
  const x = round(clamp((minX + maxX) / 2 - estWidth / 2, minX, Math.max(minX, maxX - estWidth)), 2);
  let y = round(clamp(maxY - estHeight, minY, Math.max(minY, maxY - estHeight)), 2);

  // If another caption already sits at the bottom, nudge slightly above it
  const otherCaptions = existing.filter((c) => c.kind === "caption");
  if (otherCaptions.length > 0) {
    const topMost = Math.min(...otherCaptions.map((c) => c.y));
    y = round(Math.max(minY, topMost - estHeight - 6), 2);
  }

  return {
    id: `scene-caption-${scene.id}`,
    kind: "caption",
    text: rawText,
    tone: "neutral",
    x,
    y,
    width: estWidth,
    height: estHeight,
    opacity: 1
  };
}

export function sampleMovie(
  movie: CompiledMovie,
  timeMs = 0,
  mode: PlaybackMode = "normal"
): SampledMovieFrame {
  if (!movie.scenes.length) {
    throw new Error("CompiledMovie has no scenes.");
  }
  const safeTime = Number.isFinite(timeMs) ? timeMs : 0;
  const clampedTime = clamp(safeTime, 0, movie.durationMs);

  let activeScene = movie.scenes[movie.scenes.length - 1]!;
  for (let i = 0; i < movie.scenes.length; i++) {
    const candidate = movie.scenes[i]!;
    if (clampedTime < candidate.endMs || i === movie.scenes.length - 1) {
      activeScene = candidate;
      break;
    }
  }

  const localTimeMs = clamp(clampedTime - activeScene.startMs, 0, activeScene.durationMs);
  const baseFrame = sampleAnimation(activeScene.program, localTimeMs, mode);

  const captionCallout = buildSceneCaptionCallout(
    activeScene,
    baseFrame,
    movie.spec.canvas.width,
    movie.spec.canvas.height
  );
  const mergedCallouts = captionCallout
    ? [...(baseFrame.callouts ?? []), captionCallout]
    : baseFrame.callouts;

  let transitionOverlay: TransitionOverlay | undefined;
  const hasNext = activeScene.index < movie.scenes.length - 1;
  if (
    mode === "normal" &&
    hasNext &&
    activeScene.transition.kind !== "cut" &&
    activeScene.transition.durationMs > 0
  ) {
    const transStart = activeScene.endMs - activeScene.transition.durationMs;
    if (clampedTime >= transStart - 1e-6 && clampedTime <= activeScene.endMs + 1e-6) {
      const rawProgress = clamp01((clampedTime - transStart) / activeScene.transition.durationMs);
      const progress = round(hermite(rawProgress), 4);
      const nextScene = movie.scenes[activeScene.index + 1]!;
      transitionOverlay = {
        kind: activeScene.transition.kind,
        progress,
        opacity: progress,
        nextSceneId: nextScene.id
      };
    }
  }

  return {
    ...baseFrame,
    timeMs: round(clampedTime, 3),
    ...(mergedCallouts !== undefined ? { callouts: mergedCallouts } : {}),
    sceneId: activeScene.id,
    sceneIndex: activeScene.index,
    ...(activeScene.title !== undefined ? { sceneTitle: activeScene.title } : {}),
    backdrop: activeScene.backdrop,
    ...(transitionOverlay !== undefined ? { transitionOverlay } : {})
  };
}

function resolveMovieRenderStyle(movie: CompiledMovie, options?: RenderStyleOptions): RenderStyle {
  if (options?.style !== undefined) {
    if (options.style !== "default" && options.style !== "blueprint") {
      throw new TypeError('Render style must be "default" or "blueprint".');
    }
    return options.style;
  }
  return movie.spec.theme?.style === "blueprint" ? "blueprint" : "default";
}

function sceneThemeFor(movie: CompiledMovie, scene: CompiledMovieScene): ChoreographTheme {
  const v2 = scene.program.contractVersion === CONTRACT_VERSION_V2 ? (scene.program.spec as AnimationSpecV2) : undefined;
  return {
    ...(movie.spec.theme ?? {}),
    ...(v2?.theme ?? {})
  };
}

function renderSingleMovieSceneWorld(
  movie: CompiledMovie,
  scene: CompiledMovieScene,
  frame: SampledMovieFrame,
  style: RenderStyle,
  decimals: number,
  compact = false,
  transparent = false,
  hoistBackdrop?: (markup: string) => string
): string {
  const { width, height } = movie.spec.canvas;
  const theme = sceneThemeFor(movie, scene);
  const v2 = scene.program.contractVersion === CONTRACT_VERSION_V2 ? (scene.program.spec as AnimationSpecV2) : undefined;
  const defaultColor = scene.program.spec.actor?.color ?? "#202124";
  const rawBackdrop = renderBackdropSvg(frame.backdrop, width, height, frame.groundY, {
    blueprint: style === "blueprint",
    ...(theme.accentColor !== undefined ? { accentColor: theme.accentColor } : {}),
    decimals
  });
  const backdropMarkup = rawBackdrop && hoistBackdrop ? hoistBackdrop(rawBackdrop) : rawBackdrop;

  if (style === "blueprint") {
    const rawBpStage = renderBlueprintStageBackdropSvg(width, height, frame.groundY, v2?.anchors, decimals, transparent);
    const bpStage = hoistBackdrop ? hoistBackdrop(rawBpStage) : rawBpStage;
    const bpInner = renderBlueprintFrameSceneSvg(frame, width, decimals);
    return `${bpStage}${backdropMarkup}${bpInner}`;
  }

  const renderOpts: SceneRenderOptions = {
    defaultColor,
    ...(theme.accentColor !== undefined ? { themeAccentColor: theme.accentColor } : {}),
    decimals,
    ...(compact ? { compact: true } : {})
  };
  const groundLine = `<path d="M0 ${num(frame.groundY, decimals)}H${width}" stroke="#d8dbe0" stroke-width="1"/>`;
  const inner = renderSceneInnerSvg(frame, renderOpts);
  const world = `${backdropMarkup}${groundLine}${inner}`;

  if (frame.camera) {
    const camTransform = cameraSvgTransform(frame.camera, width, height, decimals);
    const transformAttr = camTransform ? ` transform="${camTransform}"` : "";
    return `<g data-camera="true" data-camera-zoom="${num(frame.camera.zoom, 3)}" data-camera-viewbox="${escapeXml(frame.camera.viewBox)}"${transformAttr}>${world}</g>`;
  }
  return world;
}

function renderTransitionOverlaySvg(
  movie: CompiledMovie,
  frame: SampledMovieFrame,
  style: RenderStyle,
  decimals: number,
  clipPrefix: string,
  transparent = false,
  hoistBackdrop?: (markup: string) => string
): { defs: string; overlay: string } {
  const tr = frame.transitionOverlay;
  if (!tr || tr.progress <= 0.001) return { defs: "", overlay: "" };

  const { width, height } = movie.spec.canvas;
  const nextScene = movie.scenes.find((s) => s.id === tr.nextSceneId);
  if (!nextScene) return { defs: "", overlay: "" };

  const nextTheme = sceneThemeFor(movie, nextScene);
  const nextBg = style === "blueprint" ? "#f8fafc" : (nextTheme.background ?? "#ffffff");
  const nextFrame = sampleMovie(movie, nextScene.startMs, "normal");
  const nextBgRect = transparent ? "" : `<rect width="${width}" height="${height}" fill="${escapeXml(nextBg)}"/>`;
  const nextWorld =
    nextBgRect +
    renderSingleMovieSceneWorld(movie, nextScene, nextFrame, style, decimals, false, transparent, hoistBackdrop);

  if (tr.kind === "fade") {
    return {
      defs: "",
      overlay:
        `<g data-transition="fade" data-transition-progress="${num(tr.progress, 3)}" data-transition-next="${escapeXml(tr.nextSceneId)}" opacity="${num(tr.opacity, 3)}">` +
        `${nextWorld}` +
        `</g>`
    };
  }

  // Wipe transition: clean left-to-right reveal of next scene with subtle edge divider
  const wipeX = round(width * tr.progress, decimals);
  const clipId = `${clipPrefix}-wipe`;
  return {
    defs: `<clipPath id="${escapeXml(clipId)}"><rect x="0" y="0" width="${num(wipeX, decimals)}" height="${height}"/></clipPath>`,
    overlay:
      `<g data-transition="wipe" data-transition-progress="${num(tr.progress, 3)}" data-transition-next="${escapeXml(tr.nextSceneId)}" clip-path="url(#${escapeXml(clipId)})">` +
      `${nextWorld}` +
      `</g>` +
      `<line data-transition-edge="wipe" x1="${num(wipeX, decimals)}" y1="0" x2="${num(wipeX, decimals)}" y2="${height}" stroke="#cbd5e1" stroke-width="1.5"/>`
  };
}

export function renderMovieSvgFrame(
  movie: CompiledMovie,
  timeMs = 0,
  mode: PlaybackMode = "normal",
  options?: RenderStyleOptions
): string {
  const style = resolveMovieRenderStyle(movie, options);
  const transparent = options?.transparent === true;
  const frame = sampleMovie(movie, timeMs, mode);
  const scene = movie.scenes[frame.sceneIndex]!;
  const { width, height } = movie.spec.canvas;
  const theme = sceneThemeFor(movie, scene);
  const background = style === "blueprint" ? "#f8fafc" : (theme.background ?? "#ffffff");

  const world = renderSingleMovieSceneWorld(movie, scene, frame, style, 3, false, transparent);
  const trans = renderTransitionOverlaySvg(movie, frame, style, 3, "sm-mv-frame", transparent);
  const styleAttr = style === "blueprint" ? ' data-style="blueprint"' : "";
  const extraDefs =
    style === "blueprint"
      ? `${renderBlueprintDefsSvg()}${trans.defs ? `<defs>${trans.defs}</defs>` : ""}<style>${BLUEPRINT_STAGE_STYLE}</style>`
      : `<defs><clipPath id="sm-cam-clip"><rect width="${width}" height="${height}"/></clipPath>${trans.defs}</defs>`;
  const sceneClip = style === "blueprint" ? "" : ' clip-path="url(#sm-cam-clip)"';
  const ariaLabel = `Stickman movie scene ${frame.sceneId} (${frame.action}) at ${num(frame.timeMs, 1)} milliseconds`;
  const bgRect = transparent ? "" : `<rect width="100%" height="100%" fill="${escapeXml(background)}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${styleAttr} data-movie-scene="${escapeXml(frame.sceneId)}" data-scene-index="${frame.sceneIndex}" role="img" aria-label="${escapeXml(ariaLabel)}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `${extraDefs}` +
    `${bgRect}` +
    `<g id="scene"${sceneClip}>${world}${trans.overlay}</g>` +
    `</svg>`
  );
}

export function renderMovieAnimatedSvg(
  movie: CompiledMovie,
  options?: RenderStyleOptions
): string {
  const style = resolveMovieRenderStyle(movie, options);
  const { width, height, fps } = movie.spec.canvas;
  const durationMs = movie.durationMs;
  const frameCount = Math.max(2, Math.ceil((durationMs * fps) / 1000) + 1);
  const samples = Array.from({ length: frameCount }, (_, idx) =>
    sampleMovie(movie, (durationMs * idx) / (frameCount - 1), "normal")
  );

  const seconds = Math.max(0.1, durationMs / 1000);
  const intervals = Math.max(1, samples.length - 1);
  const slicePercent = num(100 / intervals, 4);
  const durStr = `${num(seconds, 4)}s`;
  const wipeDefs: string[] = [];
  const hoistedDefs: string[] = [];
  const hoistedMap = new Map<string, string>();
  const hoistBackdrop = (markup: string): string => {
    let id = hoistedMap.get(markup);
    if (!id) {
      id = `sm-bd-${hoistedDefs.length}`;
      hoistedMap.set(markup, id);
      hoistedDefs.push(`<g id="${id}">${markup}</g>`);
    }
    return `<use href="#${id}"/>`;
  };

  const sceneBgs = new Set(
    movie.scenes.map((scene) =>
      style === "blueprint" ? "#f8fafc" : (sceneThemeFor(movie, scene).background ?? "#ffffff")
    )
  );
  const sharedBg = sceneBgs.size === 1 ? [...sceneBgs][0]! : undefined;

  const renderFrameBody = (sample: SampledMovieFrame, clipKey: string): string => {
    const scene = movie.scenes[sample.sceneIndex]!;
    const theme = sceneThemeFor(movie, scene);
    const bg = style === "blueprint" ? "#f8fafc" : (theme.background ?? "#ffffff");
    const world = renderSingleMovieSceneWorld(movie, scene, sample, style, 2, false, false, hoistBackdrop);
    const trans = renderTransitionOverlaySvg(movie, sample, style, 2, clipKey, false, hoistBackdrop);
    if (trans.defs) wipeDefs.push(trans.defs);
    const bgRect = sharedBg !== undefined ? "" : `<rect width="${width}" height="${height}" fill="${escapeXml(bg)}"/>`;
    return `${bgRect}${world}${trans.overlay}`;
  };

  const { frameGroups, extraKeyframes, hasHoldFinal } = buildCoalescedSvgSlices(
    samples,
    (sample, idx) => renderFrameBody(sample, `sm-mv-f${idx}`),
    seconds,
    (sample) => ` data-scene="${escapeXml(sample.sceneId)}"`,
    (a, b) => a.sceneId === b.sceneId
  );

  const reducedSample = sampleMovie(movie, durationMs, "reduced");
  const reducedInner = renderFrameBody(reducedSample, "sm-mv-reduced");

  const css =
    `${style === "blueprint" ? BLUEPRINT_STAGE_STYLE : ""}` +
    `.sm-f{visibility:hidden;animation:sm-slice ${durStr} steps(1,end) 0s 1 normal forwards}` +
    `.sm-f.sm-last{animation-name:sm-final}` +
    (hasHoldFinal ? `.sm-f.sm-hold{animation-name:sm-hold}` : "") +
    `.sm-reduced{display:none}` +
    `@keyframes sm-slice{0%{visibility:visible}${slicePercent}%{visibility:hidden}100%{visibility:hidden}}` +
    `${extraKeyframes}` +
    `@keyframes sm-final{0%{visibility:hidden}100%{visibility:visible}}` +
    (hasHoldFinal ? `@keyframes sm-hold{0%{visibility:visible}100%{visibility:visible}}` : "") +
    `@media (prefers-reduced-motion:reduce){.sm-f{animation:none!important;visibility:hidden!important}.sm-reduced{display:inline}}`;

  const defs =
    `<defs><clipPath id="sm-cam-clip"><rect width="${width}" height="${height}"/></clipPath>` +
    `${style === "blueprint" ? renderBlueprintPatternsSvg() : ""}` +
    `${hoistedDefs.join("")}` +
    `${wipeDefs.join("")}</defs>`;
  const styleAttr = style === "blueprint" ? ' data-style="blueprint"' : "";
  const ariaLabel = movie.spec.title
    ? `Deterministic stickman movie: ${movie.spec.title}`
    : "Deterministic stickman movie";
  const sharedBgRect = sharedBg !== undefined ? `<rect width="100%" height="100%" fill="${escapeXml(sharedBg)}"/>` : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg"${styleAttr} viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(ariaLabel)}">\n` +
    `${defs}<style>${css}</style>\n` +
    `${sharedBgRect}<g clip-path="url(#sm-cam-clip)">${frameGroups}<g class="sm-reduced">${reducedInner}</g></g></svg>`
  );
}

export function renderMovieHtml(
  movie: CompiledMovie,
  options?: RenderStyleOptions
): string {
  const style = resolveMovieRenderStyle(movie, options);
  const durationMs = movie.durationMs;
  const initialSvg = renderMovieSvgFrame(movie, 0, "normal", { style });
  const scenesMeta = movie.scenes.map((scene) => ({
    id: scene.id,
    index: scene.index,
    title: scene.title ?? scene.id,
    startMs: scene.startMs,
    endMs: scene.endMs,
    backdrop: scene.backdrop
  }));

  const chapterButtons = scenesMeta
    .map(
      (s) =>
        `<button type="button" class="cp-chapter" data-scene-jump="${s.startMs}" data-scene-id="${escapeXml(s.id)}">S${s.index + 1} · ${escapeXml(s.title)}</button>`
    )
    .join("");

  const controls =
    `<label>Motion mode <select id="mode"><option value="normal">Normal</option><option value="reduced">Reduced</option><option value="static">Static</option></select></label>` +
    `<label>Playhead <input id="seek" type="range" min="0" max="${durationMs}" step="1" value="0"></label>` +
    `<output id="timecode" class="cp-timecode" data-timecode="true" for="seek">0.00s / ${(durationMs / 1000).toFixed(2)}s</output>` +
    `<button id="toggle" type="button">Pause</button>`;

  const extraCss =
    `.cp-chapters{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem}` +
    `.cp-chapter[aria-current="true"]{border-color:var(--cp-accent);background:var(--cp-accent-soft);color:var(--cp-text);font-weight:600}`;

  const payload = buildCompactPlayerPayload(movie, { style });
  const script = renderCompactPlayerScript(payload);

  const title = movie.spec.title ?? "Stickman movie";
  return (
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(title)}</title>\n` +
    `<script>(()=>{const param=new URLSearchParams(window.location.search).get("scoutTheme");const theme=param||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",theme);})();</script>\n` +
    `<style>${HTML_SHELL_STYLE}${extraCss}</style>\n` +
    `<main><nav>${controls}</nav><div class="cp-chapters" role="group" aria-label="Movie scenes">${chapterButtons}</div><div id="stage">${initialSvg}</div></main><script id="stickman-movie-player">${script}</script></html>`
  );
}

export function selectMovieStoryboardBeats(
  movie: CompiledMovie,
  maxPanels = 8
): MovieStoryboardBeat[] {
  if (typeof maxPanels !== "number" || !Number.isFinite(maxPanels) || maxPanels < 1) {
    throw new RangeError("maxPanels must be a positive number.");
  }
  const cap = Math.max(1, Math.floor(maxPanels));
  const scenes = movie.scenes;
  if (scenes.length === 0) return [];

  if (cap < scenes.length) {
    // Pick evenly spaced scenes when panel budget is smaller than scene count
    const out: MovieStoryboardBeat[] = [];
    for (let slot = 0; slot < cap; slot++) {
      const sIdx = cap === 1 ? 0 : Math.round((slot * (scenes.length - 1)) / (cap - 1));
      const scene = scenes[sIdx]!;
      const localTimeMs = sIdx === 0 ? 0 : Math.round(scene.durationMs * 0.45);
      out.push({
        sceneId: scene.id,
        sceneIndex: scene.index,
        ...(scene.title !== undefined ? { sceneTitle: scene.title } : {}),
        localTimeMs,
        timeMs: scene.startMs + localTimeMs
      });
    }
    return out;
  }

  // Guarantee at least 1 panel per scene, then distribute remaining slots proportionally to scene duration
  const counts = scenes.map(() => 1);
  let remaining = cap - scenes.length;
  if (remaining > 0) {
    const totalDur = Math.max(1, scenes.reduce((sum, s) => sum + s.durationMs, 0));
    const exactExtras = scenes.map((s) => (s.durationMs / totalDur) * remaining);
    const floors = exactExtras.map((v) => Math.floor(v));
    for (let i = 0; i < scenes.length; i++) {
      counts[i] = counts[i]! + floors[i]!;
      remaining -= floors[i]!;
    }
    if (remaining > 0) {
      const order = scenes
        .map((_, idx) => ({ idx, rem: exactExtras[idx]! - floors[idx]! }))
        .sort((a, b) => b.rem - a.rem || a.idx - b.idx);
      for (let r = 0; r < remaining; r++) {
        const target = order[r % order.length]!;
        counts[target.idx] = counts[target.idx]! + 1;
      }
    }
  }

  const beats: MovieStoryboardBeat[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const count = counts[i]!;
    let localTimes: number[];
    if (count === 1) {
      localTimes = [i === 0 ? 0 : Math.round(scene.durationMs * 0.45)];
    } else {
      const raw = selectStoryboardTimestamps(scene.program, count);
      // Avoid picking the exact end frame of non-final scenes if it collides with the next scene's start
      localTimes = raw.map((t, idx) =>
        i < scenes.length - 1 && idx === raw.length - 1 && t >= scene.durationMs
          ? Math.max(0, Math.round(scene.durationMs * 0.85))
          : t
      );
      localTimes = [...new Set(localTimes)].sort((a, b) => a - b);
    }

    for (const localTimeMs of localTimes) {
      beats.push({
        sceneId: scene.id,
        sceneIndex: scene.index,
        ...(scene.title !== undefined ? { sceneTitle: scene.title } : {}),
        localTimeMs,
        timeMs: scene.startMs + localTimeMs
      });
    }
  }

  return beats;
}

export function renderMovieStoryboardSvg(
  movie: CompiledMovie,
  options: StoryboardOptions = {}
): string {
  const theme: StoryboardTheme = options.theme ?? (movie.spec.theme?.style === "blueprint" ? "blueprint" : "default");
  if (theme !== "default" && theme !== "blueprint") {
    throw new TypeError('Storyboard theme must be "default" or "blueprint".');
  }
  const { width: canvasW, height: canvasH } = movie.spec.canvas;
  const maxPanels = options.maxPanels ?? Math.max(6, Math.min(12, movie.scenes.length * 3));
  const columns = Math.max(1, Math.floor(options.columns ?? 4));
  if (!Number.isFinite(columns)) throw new RangeError("columns must be a positive finite integer.");

  const beats: MovieStoryboardBeat[] = options.timestampsMs
    ? options.timestampsMs.map((rawT) => {
        const clamped = clamp(rawT, 0, movie.durationMs);
        const sampled = sampleMovie(movie, clamped, options.mode ?? "normal");
        const sc = movie.scenes[sampled.sceneIndex]!;
        return {
          sceneId: sc.id,
          sceneIndex: sc.index,
          ...(sc.title !== undefined ? { sceneTitle: sc.title } : {}),
          localTimeMs: clamp(clamped - sc.startMs, 0, sc.durationMs),
          timeMs: clamped
        };
      })
    : selectMovieStoryboardBeats(movie, maxPanels);

  const mode = options.mode ?? "normal";
  const panelW = Math.max(96, Math.round(options.panelWidth ?? 248));
  const sceneH = Math.max(64, Math.round((panelW * canvasH) / canvasW));
  const footerH = 22;
  const panelH = sceneH + footerH;
  const pad = 10;

  const panelCount = Math.max(1, beats.length);
  const cols = Math.min(columns, panelCount);
  const rows = Math.ceil(panelCount / cols);
  const scale = panelW / canvasW;

  const titleText = options.title ?? movie.spec.title;
  const headerH = titleText ? 26 : 0;
  const totalW = cols * panelW + (cols + 1) * pad;
  const totalH = headerH + rows * panelH + (rows + 1) * pad;

  const titleMarkup = titleText
    ? `<text class="sb-t" x="${pad}" y="20">${escapeXml(titleText)}</text>`
    : "";

  const isBlueprint = theme === "blueprint";
  const panelWipeDefs: string[] = [];

  const panelsMarkup = beats
    .map((beat, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const px = pad + col * (panelW + pad);
      const py = headerH + pad + row * (panelH + pad);

      const frame = sampleMovie(movie, beat.timeMs, mode);
      const scene = movie.scenes[frame.sceneIndex]!;
      const sceneTheme = sceneThemeFor(movie, scene);
      const stageBg = isBlueprint ? "#f8fafc" : (sceneTheme.background ?? "#ffffff");
      const world = renderSingleMovieSceneWorld(movie, scene, frame, isBlueprint ? "blueprint" : "default", 0, true);
      const trans = renderTransitionOverlaySvg(movie, frame, isBlueprint ? "blueprint" : "default", 0, `sm-msb-${idx}`);
      if (trans.defs) panelWipeDefs.push(trans.defs);

      const badgeText = `S${beat.sceneIndex + 1} · ${(beat.timeMs / 1000).toFixed(2)}s`;
      const badgeW = Math.max(62, Math.round(badgeText.length * 6.2 + 12));
      const actorSummary =
        frame.actors && frame.actors.length > 0
          ? frame.actors.map((a) => `${a.id}:${a.action}`).join(" · ")
          : `actor:${frame.action}`;
      const rawLabel = `${beat.sceneTitle ?? beat.sceneId} — ${actorSummary}`;
      const labelText = rawLabel.length > 48 ? `${rawLabel.slice(0, 47)}…` : rawLabel;

      return (
        `<g data-panel="${idx}" data-scene="${escapeXml(beat.sceneId)}" data-scene-index="${beat.sceneIndex}" data-time-ms="${num(beat.timeMs, 0)}" transform="translate(${px} ${py})">` +
        `<rect width="${panelW}" height="${panelH}" rx="6" fill="#f8fafc" stroke="${isBlueprint ? "#1e3a5f" : "#cbd5e1"}"/>` +
        `<g clip-path="url(#sm-msb-clip)">` +
        `<rect width="${panelW}" height="${sceneH}" fill="${escapeXml(stageBg)}"/>` +
        `<g class="sb-s" transform="scale(${num(scale, 3)})">${world}${trans.overlay}</g>` +
        `<rect x="6" y="6" width="${badgeW}" height="16" rx="4" fill="#0f172a" fill-opacity=".82"/>` +
        `<text class="sb-b" data-part="scene-badge" x="${num(6 + badgeW / 2, 1)}" y="14.5">${escapeXml(badgeText)}</text>` +
        `</g>` +
        `<line x1="0" y1="${sceneH}" x2="${panelW}" y2="${sceneH}" stroke="${isBlueprint ? "#1e3a5f" : "#e2e8f0"}"/>` +
        `<text class="sb-l" data-part="panel-label" x="7" y="${sceneH + 14.5}">${escapeXml(labelText)}</text>` +
        `</g>`
      );
    })
    .join("");

  const css =
    `${isBlueprint ? BLUEPRINT_STAGE_STYLE : ""}` +
    `.sb-s{stroke-linecap:round;stroke-linejoin:round}` +
    `.sb-b{font:700 9.5px Consolas,monospace;fill:#fff;text-anchor:middle;dominant-baseline:middle}` +
    `.sb-l{font:9.5px "Segoe UI",Arial,sans-serif;fill:#334155}` +
    `.sb-t{font:700 13px "Segoe UI",Arial,sans-serif;fill:#1f2937}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${isBlueprint ? ' data-theme="blueprint"' : ""} role="img" aria-label="Stickman movie storyboard (${panelCount} panels across ${movie.scenes.length} scenes)" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">` +
    `<defs><clipPath id="sm-msb-clip"><rect width="${panelW}" height="${sceneH}" rx="5"/></clipPath>` +
    `${isBlueprint ? renderBlueprintPatternsSvg() : ""}` +
    `${panelWipeDefs.join("")}` +
    `<style>${css}</style></defs>` +
    `<rect width="100%" height="100%" fill="${isBlueprint ? "#f8fafc" : "#f1f5f9"}"/>` +
    `${titleMarkup}${panelsMarkup}</svg>`
  );
}
