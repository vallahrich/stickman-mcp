import {
  CONTRACT_VERSION_V2,
  type AddonConfig,
  type AddonType,
  type AnimationSpec,
  type AnimationSpecV2,
  type CompiledActorSpec,
  type CompiledAnimation,
  type MarkerEvent,
  type PlaybackMode,
  type SampledActorFrame,
  type SampledFrame
} from "./contract.js";
import { cameraSvgTransform } from "./camera.js";
import { ENTRANCE_EXIT_ACTIONS, resolveStageAnchors } from "./choreograph.js";
import { sampleAnimation } from "./compiler.js";
import { getMotionMeta } from "./motion-library.js";
import { escapeXml, renderBlueprintPatternsSvg } from "./props.js";
import { actorToSampledFrame, frameGeometry, renderSceneInnerSvg } from "./render.js";

export type StoryboardTheme = "default" | "blueprint";

export interface StoryboardOptions {
  maxPanels?: number;
  columns?: number;
  panelWidth?: number;
  timestampsMs?: readonly number[];
  mode?: PlaybackMode;
  title?: string;
  theme?: StoryboardTheme;
}

export interface OutOfBoundsFrame {
  timeMs: number;
  kind: "actor" | "addon";
  id: string;
  action?: string;
  x: number;
  y: number;
  reason: string;
}

export interface ActorOverlapWarning {
  actorA: string;
  actorB: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  minDistancePx: number;
  message: string;
}

export interface StoryboardAnalysis {
  panelCount: number;
  timestampsMs: number[];
  durationMs: number;
  actorIds: string[];
  addonTypes: AddonType[];
  outOfBoundsCount: number;
  outOfBoundsFrames: OutOfBoundsFrame[];
  maxSeamStepPx: number;
  seamStepByActorPx: Record<string, number>;
  actorOverlapWarnings: ActorOverlapWarning[];
  beatSummary: string[];
}

export interface StoryboardRasterizeResult {
  pngBase64?: string;
  rasterizerAvailable: boolean;
}

interface ResvgInstanceLike {
  render(): { asPng(): Uint8Array };
}

export interface RasterizeStoryboardOptions {
  loadResvg?: () => Promise<{
    Resvg: new (svg: string, options?: Record<string, unknown>) => ResvgInstanceLike;
  }>;
}

const ENTRANCE_EXIT_SET = new Set<string>(ENTRANCE_EXIT_ACTIONS);

function num(value: number, decimals = 1): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return (Math.abs(rounded) < 1e-6 ? 0 : rounded).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function actionPeakFraction(actionName: string): number {
  switch (actionName) {
    case "idea":
      return 0.68;
    case "reveal":
      return 0.62;
    case "present-card":
      return 0.55;
    case "basketball-shot":
      return 0.58;
    case "kick-ball":
      return 0.66;
    case "write-board":
      return 0.72;
    case "open-door":
      return 0.56;
    default:
      return 0.5;
  }
}

interface BeatCandidate {
  timeMs: number;
  priority: number;
}

export function selectStoryboardTimestamps(program: CompiledAnimation, maxPanels = 8): number[] {
  if (typeof maxPanels !== "number" || !Number.isFinite(maxPanels) || maxPanels < 1) {
    throw new RangeError("maxPanels must be a positive number.");
  }
  const cap = Math.max(1, Math.floor(maxPanels));
  const durationMs = program.spec.durationMs;
  if (cap === 1) return [0];

  const byTime = new Map<number, number>();
  const addCandidate = (rawTimeMs: number, priority: number): void => {
    if (!Number.isFinite(rawTimeMs)) return;
    const t = clamp(Math.round(rawTimeMs), 0, durationMs);
    const prev = byTime.get(t) ?? 0;
    if (priority > prev) byTime.set(t, priority);
  };

  addCandidate(0, 4);
  addCandidate(durationMs, 4);

  for (const event of program.events ?? []) {
    addCandidate(event.timeMs, 3);
  }

  if (program.contractVersion === CONTRACT_VERSION_V2) {
    const v2 = program.spec as AnimationSpecV2;
    for (const actor of v2.actors) {
      for (const act of actor.actions) {
        addCandidate(act.startMs, 1);
        addCandidate(act.startMs + act.durationMs * actionPeakFraction(act.action), 3);
      }
    }
  } else {
    const v1 = program.spec as AnimationSpec;
    for (const act of v1.actions) {
      addCandidate(act.startMs, 1);
      addCandidate(act.startMs + act.durationMs * actionPeakFraction(act.action), 3);
    }
  }

  const sorted: BeatCandidate[] = [...byTime.entries()]
    .map(([timeMs, priority]) => ({ timeMs, priority }))
    .sort((a, b) => a.timeMs - b.timeMs);

  const minGapMs = Math.min(40, Math.max(1, Math.floor(durationMs / (cap * 5))));
  const merged: BeatCandidate[] = [];
  for (const cand of sorted) {
    if (merged.length === 0) {
      merged.push(cand);
      continue;
    }
    const prev = merged[merged.length - 1]!;
    if (cand.timeMs - prev.timeMs < minGapMs && cand.timeMs !== durationMs && prev.timeMs !== 0) {
      if (cand.priority > prev.priority) {
        merged[merged.length - 1] = cand;
      }
    } else if (cand.timeMs === durationMs && cand.timeMs - prev.timeMs < minGapMs && prev.timeMs !== 0) {
      merged[merged.length - 1] = cand;
    } else {
      merged.push(cand);
    }
  }

  if (merged.length <= cap) {
    return merged.map((c) => c.timeMs);
  }

  const interior = merged.slice(1, -1);
  const needed = cap - 2;
  const chosenIndices = new Set<number>();

  for (let slot = 0; slot < needed; slot++) {
    const idealTime = ((slot + 1) / (cap - 1)) * durationMs;
    const windowStart = (slot / needed) * durationMs;
    const windowEnd = ((slot + 1) / needed) * durationMs;

    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < interior.length; i++) {
      if (chosenIndices.has(i)) continue;
      const item = interior[i]!;
      const inBucket = item.timeMs >= windowStart - 1e-6 && item.timeMs <= windowEnd + 1e-6 ? 1 : 0;
      const distPenalty = Math.abs(item.timeMs - idealTime) / Math.max(1, durationMs);
      const score = inBucket * 500 + item.priority * 100 - distPenalty * 120;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      chosenIndices.add(bestIdx);
    }
  }

  const selected = [
    0,
    ...[...chosenIndices].map((idx) => interior[idx]!.timeMs),
    durationMs
  ].sort((a, b) => a - b);

  return [...new Set(selected)];
}

function nearbyMarkers(events: readonly MarkerEvent[] | undefined, timeMs: number, windowMs: number): MarkerEvent[] {
  if (!events || events.length === 0) return [];
  return events.filter((ev) => Math.abs(ev.timeMs - timeMs) <= windowMs);
}

function formatPanelLabel(
  frame: SampledFrame,
  events: readonly MarkerEvent[] | undefined,
  windowMs: number
): string {
  const actorPart =
    frame.actors && frame.actors.length > 0
      ? frame.actors.map((a) => `${a.id}:${a.action}`).join(" · ")
      : `actor:${frame.action}`;
  const markers = nearbyMarkers(events, frame.timeMs, windowMs);
  const uniqueMarkers = [...new Set(markers.map((m) => m.marker))];
  const markerPart = uniqueMarkers.length > 0 ? ` [${uniqueMarkers.join(",")}]` : "";
  const combined = `${actorPart}${markerPart}`;
  return combined.length > 46 ? `${combined.slice(0, 45)}…` : combined;
}

function toBlueprintMonochromeFrame(frame: SampledFrame): SampledFrame {
  return {
    ...frame,
    ...(frame.actors
      ? {
          actors: frame.actors.map((actor) => ({
            ...actor,
            color: "#0f172a",
            accentColor: "#1e3a5f"
          }))
        }
      : {}),
    ...(frame.addons
      ? {
          addons: frame.addons.map((addon) => ({
            ...addon,
            color: "#1e3a5f"
          }))
        }
      : {})
  };
}

function normalizeBlueprintInnerColors(markup: string): string {
  const preserve = new Set([
    "#fff",
    "#ffffff",
    "#f8fafc",
    "#f1f5f9",
    "#e2e8f0",
    "#cbd5e1",
    "#94a3b8",
    "#334155",
    "#1e3a5f",
    "#0f172a"
  ]);
  return markup
    .replace(/\bfill="(#[0-9a-fA-F]{3,6})"/g, (full, hex: string) =>
      preserve.has(hex.toLowerCase()) ? full : 'fill="#e2e8f0"'
    )
    .replace(/\bstroke="(#[0-9a-fA-F]{3,6})"/g, (full, hex: string) =>
      preserve.has(hex.toLowerCase()) ? full : 'stroke="#1e3a5f"'
    );
}

function registrationMarkSvg(cx: number, cy: number, arm = 4): string {
  return (
    `<path data-part="registration-mark" d="M${num(cx - arm, 1)} ${num(cy, 1)}H${num(cx + arm, 1)}M${num(cx, 1)} ${num(cy - arm, 1)}V${num(cy + arm, 1)}" stroke="#1e3a5f" stroke-width=".9"/>`
  );
}

function renderBlueprintStoryboardSvg(
  program: CompiledAnimation,
  timestamps: readonly number[],
  options: {
    cols: number;
    rows: number;
    panelW: number;
    sceneH: number;
    footerH: number;
    panelH: number;
    pad: number;
    scale: number;
    mode: PlaybackMode;
    markerWindowMs: number;
    title?: string;
  }
): string {
  const { canvas, durationMs } = program.spec;
  const { cols, rows, panelW, sceneH, panelH, pad, scale, mode, markerWindowMs } = options;
  const panelCount = Math.max(1, timestamps.length);
  const headerH = 30;
  const sheetFooterH = 24;
  const totalW = cols * panelW + (cols + 1) * pad;
  const totalH = headerH + rows * panelH + (rows + 1) * pad + sheetFooterH;
  const titleText = options.title ? options.title : "ORTHOGRAPHIC CAD STORYBOARD";
  const scaleRatio = num(1 / scale, 2);
  const specText = `SCALE 1:${scaleRatio} | ${canvas.width}×${canvas.height} @ ${canvas.fps}FPS`;

  const regMarks = [
    registrationMarkSvg(6, 6),
    registrationMarkSvg(totalW - 6, 6),
    registrationMarkSvg(6, totalH - 6),
    registrationMarkSvg(totalW - 6, totalH - 6)
  ].join("");

  const headerMarkup =
    `<g data-part="blueprint-header">` +
    `<text class="bp-t" x="${pad}" y="19">${escapeXml(titleText)}</text>` +
    `<text class="bp-m" x="${totalW - pad}" y="19" text-anchor="end">${escapeXml(specText)}</text>` +
    `<line x1="${pad}" y1="${headerH}" x2="${totalW - pad}" y2="${headerH}" stroke="#1e3a5f" stroke-width=".9"/>` +
    `</g>`;

  const panelsMarkup = timestamps
    .map((t, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const px = pad + col * (panelW + pad);
      const py = headerH + pad + row * (panelH + pad);

      const frame = sampleAnimation(program, t, mode);
      const monoFrame = toBlueprintMonochromeFrame(frame);
      const rawInner = renderSceneInnerSvg(monoFrame, {
        defaultColor: "#0f172a",
        themeAccentColor: "#1e3a5f",
        blueprint: true,
        decimals: 0,
        compact: true
      });
      const inner = normalizeBlueprintInnerColors(rawInner);

      const anchors = resolveStageAnchors(canvas, frame.groundY);
      const gyPanel = frame.groundY * scale;
      const gyStr = num(gyPanel, 1);

      const anchorTicks = (
        [
          ["L", anchors.left?.x ?? Math.round(canvas.width * 0.2)],
          ["C", anchors.center?.x ?? Math.round(canvas.width * 0.5)],
          ["R", anchors.right?.x ?? Math.round(canvas.width * 0.8)]
        ] as const
      )
        .map(([code, wx]) => {
          const ax = num(wx * scale, 1);
          const lblY = num(Math.min(sceneH - 2, gyPanel + 9.5), 1);
          return (
            `<line x1="${ax}" y1="${num(gyPanel - 2.5, 1)}" x2="${ax}" y2="${num(gyPanel + 2.5, 1)}" stroke="#1e3a5f" stroke-width=".8"/>` +
            `<text class="bp-a" x="${ax}" y="${lblY}">${code}</text>`
          );
        })
        .join("");

      const primaryActor =
        frame.actors && frame.actors.length > 0
          ? (frame.actors.find((a) => a.x >= 0 && a.x <= canvas.width) ?? frame.actors[0]!)
          : undefined;
      const actorScale = primaryActor?.scale ?? 1;
      const rootWorldX = frame.x;
      const clampedRootX = clamp(
        (primaryActor ? primaryActor.x : rootWorldX) * scale,
        14,
        panelW - 28
      );
      const leaderX = clamp(clampedRootX - 18, 6, panelW - 34);
      const leaderTopY = clamp((frame.groundY - 144 * actorScale) * scale, 22, Math.max(24, gyPanel - 12));

      const dimensionLeaders =
        `<g data-part="dimension-leader">` +
        `<line x1="${num(leaderX, 1)}" y1="${num(leaderTopY, 1)}" x2="${num(leaderX, 1)}" y2="${gyStr}" stroke="#1e3a5f" stroke-width=".75"/>` +
        `<line x1="${num(leaderX - 2.5, 1)}" y1="${num(leaderTopY, 1)}" x2="${num(leaderX + 2.5, 1)}" y2="${num(leaderTopY, 1)}" stroke="#1e3a5f" stroke-width=".75"/>` +
        `<line x1="${num(leaderX - 2.5, 1)}" y1="${gyStr}" x2="${num(leaderX + 2.5, 1)}" y2="${gyStr}" stroke="#1e3a5f" stroke-width=".75"/>` +
        `<text class="bp-d" x="${num(leaderX + 3, 1)}" y="${num((leaderTopY + gyPanel) / 2, 1)}">144u</text>` +
        `<line x1="${num(clampedRootX, 1)}" y1="${num(gyPanel - 4, 1)}" x2="${num(clampedRootX, 1)}" y2="${num(gyPanel + 4, 1)}" stroke="#0f172a" stroke-width=".9"/>` +
        `<text class="bp-d" x="${num(clampedRootX + 3, 1)}" y="${num(Math.max(26, gyPanel - 4), 1)}">x=${Math.round(rootWorldX)}</text>` +
        `</g>`;

      const badgeText = `T+${(frame.timeMs / 1000).toFixed(2)}s`;
      const badgeW = Math.max(44, Math.round(badgeText.length * 6.2 + 10));
      const labelText = formatPanelLabel(frame, program.events, markerWindowMs);

      return (
        `<g data-panel="${idx}" data-time-ms="${num(frame.timeMs, 0)}" transform="translate(${px} ${py})">` +
        `<rect width="${panelW}" height="${panelH}" fill="#f8fafc" stroke="#1e3a5f" stroke-width="1"/>` +
        `<g clip-path="url(#sm-sb-clip)">` +
        `<rect width="${panelW}" height="${sceneH}" fill="#f8fafc"/>` +
        `<rect width="${panelW}" height="${sceneH}" fill="url(#sm-bp-grid)"/>` +
        `<line data-part="ground-datum" x1="0" y1="${gyStr}" x2="${panelW}" y2="${gyStr}" stroke="#1e3a5f" stroke-width=".9" stroke-dasharray="3 3"/>` +
        `<text class="bp-d" data-part="datum-label" x="${panelW - 4}" y="${num(Math.max(12, gyPanel - 3), 1)}" text-anchor="end">Y=${Math.round(frame.groundY)}</text>` +
        `<g data-part="anchor-ticks">${anchorTicks}</g>` +
        `<g class="sb-s" transform="scale(${num(scale, 3)})">${inner}</g>` +
        `${dimensionLeaders}` +
        `<rect x="5" y="5" width="${badgeW}" height="15" rx="2" fill="#0f172a" stroke="#1e3a5f" stroke-width=".6"/>` +
        `<text class="sb-b" data-part="timestamp-badge" x="${num(5 + badgeW / 2, 1)}" y="12.8">${escapeXml(badgeText)}</text>` +
        `</g>` +
        `<line x1="0" y1="${sceneH}" x2="${panelW}" y2="${sceneH}" stroke="#1e3a5f" stroke-width=".8"/>` +
        `<text class="bp-l" data-part="panel-label" x="6" y="${sceneH + 14.5}">${escapeXml(labelText)}</text>` +
        `</g>`
      );
    })
    .join("");

  const footerTopY = totalH - sheetFooterH;
  const footerSummary = `CONTRACT ${program.contractVersion} | PANELS ${panelCount} | DUR ${(durationMs / 1000).toFixed(2)}s`;
  const footerRight = `DATUM ORTHOGRAPHIC | REF 144u | ${mode.toUpperCase()}`;
  const footerMarkup =
    `<g data-part="blueprint-footer">` +
    `<line x1="${pad}" y1="${footerTopY}" x2="${totalW - pad}" y2="${footerTopY}" stroke="#1e3a5f" stroke-width=".9"/>` +
    `<text class="bp-m" x="${pad}" y="${footerTopY + 15}">${escapeXml(footerSummary)}</text>` +
    `<text class="bp-m" x="${totalW - pad}" y="${footerTopY + 15}" text-anchor="end">${escapeXml(footerRight)}</text>` +
    `</g>`;

  const style =
    `.sb-s{stroke-linecap:round;stroke-linejoin:round}` +
    `.sb-b{font:700 9px Consolas,"Courier New",monospace;fill:#f8fafc;text-anchor:middle;dominant-baseline:middle}` +
    `.bp-t{font:700 11px Consolas,"Courier New",monospace;fill:#0f172a;letter-spacing:.06em}` +
    `.bp-m{font:9px Consolas,"Courier New",monospace;fill:#1e3a5f}` +
    `.bp-l{font:9px Consolas,"Courier New",monospace;fill:#0f172a}` +
    `.bp-d{font:7.8px Consolas,"Courier New",monospace;fill:#1e3a5f}` +
    `.bp-a{font:700 7.5px Consolas,"Courier New",monospace;fill:#1e3a5f;text-anchor:middle}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-theme="blueprint" role="img" aria-label="Stickman blueprint storyboard (${panelCount} panels)" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">` +
    `<defs>` +
    `<clipPath id="sm-sb-clip"><rect width="${panelW}" height="${sceneH}"/></clipPath>` +
    `${renderBlueprintPatternsSvg()}` +
    `<style>${style}</style>` +
    `</defs>` +
    `<rect width="100%" height="100%" fill="#f8fafc"/>` +
    `<rect x="1.5" y="1.5" width="${num(totalW - 3, 1)}" height="${num(totalH - 3, 1)}" fill="none" stroke="#1e3a5f" stroke-width="1"/>` +
    `${regMarks}${headerMarkup}${panelsMarkup}${footerMarkup}</svg>`
  );
}

export function renderStoryboardSvg(program: CompiledAnimation, options: StoryboardOptions = {}): string {
  const theme: StoryboardTheme = options.theme ?? "default";
  if (theme !== "default" && theme !== "blueprint") {
    throw new TypeError('Storyboard theme must be "default" or "blueprint".');
  }
  const { canvas } = program.spec;
  const maxPanels = options.maxPanels ?? 8;
  const columns = Math.max(1, Math.floor(options.columns ?? 4));
  if (!Number.isFinite(columns)) throw new RangeError("columns must be a positive finite integer.");

  const timestamps = options.timestampsMs
    ? [...options.timestampsMs].map((t) => clamp(t, 0, program.spec.durationMs))
    : selectStoryboardTimestamps(program, maxPanels);
  const mode = options.mode ?? "normal";

  const panelW = Math.max(96, Math.round(options.panelWidth ?? 232));
  const sceneH = Math.max(64, Math.round((panelW * canvas.height) / canvas.width));
  const footerH = 22;
  const panelH = sceneH + footerH;
  const pad = 10;

  const panelCount = Math.max(1, timestamps.length);
  const cols = Math.min(columns, panelCount);
  const rows = Math.ceil(panelCount / cols);
  const scale = panelW / canvas.width;

  const v2Spec = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
  const defaultColor = program.spec.actor?.color ?? "#202124";
  const themeAccentColor = v2Spec?.theme?.accentColor;
  const stageBg = v2Spec?.theme?.background ?? "#ffffff";
  const markerWindowMs = Math.max(25, Math.round(500 / canvas.fps));

  if (theme === "blueprint") {
    return renderBlueprintStoryboardSvg(program, timestamps, {
      cols,
      rows,
      panelW,
      sceneH,
      footerH,
      panelH,
      pad,
      scale,
      mode,
      markerWindowMs,
      ...(options.title !== undefined ? { title: options.title } : {})
    });
  }

  const headerH = options.title ? 26 : 0;
  const totalW = cols * panelW + (cols + 1) * pad;
  const totalH = headerH + rows * panelH + (rows + 1) * pad;

  const titleMarkup = options.title
    ? `<text class="sb-t" x="${pad}" y="20">${escapeXml(options.title)}</text>`
    : "";

  const panelsMarkup = timestamps
    .map((t, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const px = pad + col * (panelW + pad);
      const py = headerH + pad + row * (panelH + pad);

      const frame = sampleAnimation(program, t, mode);
      const inner = renderSceneInnerSvg(frame, {
        defaultColor,
        ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
        decimals: 0,
        compact: true
      });
      const groundAndInner = `<path d="M0 ${num(frame.groundY, 0)}H${canvas.width}" stroke="#d8dbe0" stroke-width="${num(1 / scale, 1)}"/>${inner}`;
      const camTransform = frame.camera ? cameraSvgTransform(frame.camera, canvas.width, canvas.height, 2) : "";
      const panelWorld = frame.camera
        ? `<g data-camera="true"${camTransform ? ` transform="${camTransform}"` : ""}>${groundAndInner}</g>`
        : groundAndInner;
      const badgeText = `${(frame.timeMs / 1000).toFixed(2)}s`;
      const badgeW = Math.max(36, Math.round(badgeText.length * 6.4 + 10));
      const labelText = formatPanelLabel(frame, program.events, markerWindowMs);

      return (
        `<g data-panel="${idx}" data-time-ms="${num(frame.timeMs, 0)}" transform="translate(${px} ${py})">` +
        `<rect width="${panelW}" height="${panelH}" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>` +
        `<g clip-path="url(#sm-sb-clip)">` +
        `<rect width="${panelW}" height="${sceneH}" fill="${escapeXml(stageBg)}"/>` +
        `<g class="sb-s" transform="scale(${num(scale, 3)})">` +
        `${panelWorld}` +
        `</g>` +
        `<rect x="6" y="6" width="${badgeW}" height="16" rx="4" fill="#0f172a" fill-opacity=".78"/>` +
        `<text class="sb-b" data-part="timestamp-badge" x="${num(6 + badgeW / 2, 1)}" y="14.5">${escapeXml(badgeText)}</text>` +
        `</g>` +
        `<line x1="0" y1="${sceneH}" x2="${panelW}" y2="${sceneH}" stroke="#e2e8f0"/>` +
        `<text class="sb-l" data-part="panel-label" x="7" y="${sceneH + 14.5}">${escapeXml(labelText)}</text>` +
        `</g>`
      );
    })
    .join("");

  const style =
    `.sb-s{stroke-linecap:round;stroke-linejoin:round}` +
    `.sb-b{font:700 9.5px Consolas,monospace;fill:#fff;text-anchor:middle;dominant-baseline:middle}` +
    `.sb-l{font:9.5px "Segoe UI",Arial,sans-serif;fill:#334155}` +
    `.sb-t{font:700 13px "Segoe UI",Arial,sans-serif;fill:#1f2937}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Stickman storyboard (${panelCount} panels)" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">` +
    `<defs><clipPath id="sm-sb-clip"><rect width="${panelW}" height="${sceneH}" rx="5"/></clipPath><style>${style}</style></defs>` +
    `<rect width="100%" height="100%" fill="#f1f5f9"/>` +
    `${titleMarkup}${panelsMarkup}</svg>`
  );
}

interface ActorSpanInfo {
  action: string;
  startMs: number;
  endMs: number;
  startX: number;
  endX: number;
  isEntranceExit: boolean;
  slidingAddonIds: Set<string>;
  slideEndProgressById: Map<string, number>;
}

function isTravelActionName(actionName: string): boolean {
  const meta = getMotionMeta(actionName);
  return actionName === "walk" || actionName === "run" || (meta?.travel === "travel" && actionName !== "push");
}

function extractSlidingAddons(addonInput: unknown): { ids: Set<string>; endById: Map<string, number> } {
  const ids = new Set<string>();
  const endById = new Map<string, number>();
  const inspectItem = (item: unknown): void => {
    if (typeof item === "object" && item !== null && "enter" in item) {
      const cfg = item as Partial<AddonConfig>;
      if (cfg.enter === "slide" && cfg.type) {
        const id = cfg.id ?? cfg.type;
        ids.add(id);
        endById.set(id, (cfg.enterAt ?? 0) + (cfg.enterDuration ?? 0.25));
      }
    }
  };
  if (Array.isArray(addonInput)) {
    for (const item of addonInput) inspectItem(item);
  } else {
    inspectItem(addonInput);
  }
  return { ids, endById };
}

function buildActorSpanMap(program: CompiledAnimation): Map<string, { initialX: number; spans: ActorSpanInfo[] }> {
  const map = new Map<string, { initialX: number; spans: ActorSpanInfo[] }>();
  if (program.contractVersion !== CONTRACT_VERSION_V2) return map;

  const v2 = program.spec as AnimationSpecV2;
  for (const actor of v2.actors) {
    let curX = actor.x;
    const spans: ActorSpanInfo[] = [];
    for (const act of actor.actions) {
      const isTravel = isTravelActionName(act.action);
      const startX = act.from ? act.from.x : curX;
      const endX = isTravel ? (act.to?.x ?? startX) : startX;
      curX = endX;
      const sliding = extractSlidingAddons(act.addon);
      spans.push({
        action: act.action,
        startMs: act.startMs,
        endMs: act.startMs + act.durationMs,
        startX,
        endX,
        isEntranceExit: ENTRANCE_EXIT_SET.has(act.action),
        slidingAddonIds: sliding.ids,
        slideEndProgressById: sliding.endById
      });
    }
    map.set(actor.id, { initialX: actor.x, spans });
  }
  return map;
}

function isHorizontalOffstagePermitted(
  spanData: { initialX: number; spans: ActorSpanInfo[] } | undefined,
  canvasWidth: number,
  timeMs: number
): boolean {
  if (!spanData || spanData.spans.length === 0) return false;
  const isOff = (x: number): boolean => x < 0 || x > canvasWidth;
  const spans = spanData.spans;
  const first = spans[0]!;

  if (timeMs < first.startMs) {
    return isOff(first.startX) && first.isEntranceExit;
  }

  let prevCompleted: ActorSpanInfo | undefined;
  for (const span of spans) {
    if (timeMs >= span.startMs && timeMs <= span.endMs) {
      if (
        span.isEntranceExit &&
        (span.action === "walk-on" || span.action === "walk-off" || isOff(span.startX) || isOff(span.endX))
      ) {
        return true;
      }
      return false;
    }
    if (timeMs > span.endMs) {
      prevCompleted = span;
    }
  }

  if (prevCompleted && isOff(prevCompleted.endX) && prevCompleted.isEntranceExit) {
    return true;
  }
  return false;
}

function isAddonSlidingAt(
  spanData: { initialX: number; spans: ActorSpanInfo[] } | undefined,
  addonId: string,
  timeMs: number
): boolean {
  if (!spanData) return false;
  for (const span of spanData.spans) {
    if (timeMs >= span.startMs && timeMs <= span.endMs && span.slidingAddonIds.has(addonId)) {
      const duration = Math.max(1, span.endMs - span.startMs);
      const progress = (timeMs - span.startMs) / duration;
      const endProg = span.slideEndProgressById.get(addonId) ?? 0.3;
      if (progress <= endProg + 0.03) return true;
    }
  }
  return false;
}

function maxJointStepBetween(
  a: SampledActorFrame | SampledFrame,
  b: SampledActorFrame | SampledFrame
): number {
  const pointsOf = (f: SampledActorFrame | SampledFrame) => [
    f.head,
    ...f.segments.flatMap((seg) => [
      { x: seg.x1, y: seg.y1 },
      { x: seg.x2, y: seg.y2 }
    ])
  ];
  const ptsA = pointsOf(a);
  const ptsB = pointsOf(b);
  if (ptsA.length !== ptsB.length || ptsA.length === 0) return 0;
  let maxDist = 0;
  for (let i = 0; i < ptsA.length; i++) {
    const d = Math.hypot(ptsA[i]!.x - ptsB[i]!.x, ptsA[i]!.y - ptsB[i]!.y);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

function describeStageZone(x: number, width: number): string {
  if (x < 0) return "offstage-left";
  if (x > width) return "offstage-right";
  const ratio = x / width;
  if (ratio < 0.28) return "left";
  if (ratio < 0.44) return "center-left";
  if (ratio <= 0.56) return "center";
  if (ratio <= 0.72) return "center-right";
  return "right";
}

export function analyzeStoryboard(program: CompiledAnimation): StoryboardAnalysis {
  const { durationMs, canvas } = program.spec;
  const { width, height, fps } = canvas;
  const timestampsMs = selectStoryboardTimestamps(program, 8);
  const panelCount = timestampsMs.length;

  const isV2 = program.contractVersion === CONTRACT_VERSION_V2;
  const v2Spec = isV2 ? (program.spec as AnimationSpecV2) : undefined;
  const actorIds = v2Spec ? v2Spec.actors.map((a) => a.id) : ["actor"];
  const spanMap = buildActorSpanMap(program);

  const sampleSet = new Set<number>(timestampsMs);
  const totalSteps = Math.max(1, Math.ceil((durationMs * fps) / 1000));
  for (let i = 0; i <= totalSteps; i++) {
    sampleSet.add(Math.min(durationMs, Number(((i * 1000) / fps).toFixed(3))));
  }
  const evalTimes = [...sampleSet].sort((a, b) => a - b);

  const seenAddonTypes = new Set<AddonType>();
  const outOfBoundsFrames: OutOfBoundsFrame[] = [];
  const tolX = 1.5;
  const tolY = 2;

  for (const t of evalTimes) {
    const frame = sampleAnimation(program, t, "normal");
    for (const addon of frame.addons ?? []) {
      seenAddonTypes.add(addon.type);
    }

    const actorsToCheck: SampledActorFrame[] =
      frame.actors && frame.actors.length > 0
        ? frame.actors
        : [
            {
              id: "actor",
              action: frame.action,
              x: frame.x,
              groundY: frame.groundY,
              head: frame.head,
              segments: frame.segments,
              ...(frame.facing !== undefined ? { facing: frame.facing } : {}),
              ...(frame.articulated ? { articulated: true } : {}),
              color: program.spec.actor?.color ?? "#202124",
              scale: 1,
              zIndex: 0
            }
          ];

    for (const actor of actorsToCheck) {
      const allowOffstageX = isHorizontalOffstagePermitted(spanMap.get(actor.id), width, t);
      const geom = frameGeometry(actorToSampledFrame(actor, t));
      const headLeft = geom.head.x - geom.headRadius;
      const headRight = geom.head.x + geom.headRadius;
      const headTop = geom.head.y - geom.headRadius;
      const headBottom = geom.head.y + geom.headRadius;

      const lShin = actor.segments.find((s) => s.id === "left-shin");
      const rShin = actor.segments.find((s) => s.id === "right-shin");
      const feet = [
        ...(lShin ? [{ label: "left-foot", x: lShin.x2, y: lShin.y2 }] : []),
        ...(rShin ? [{ label: "right-foot", x: rShin.x2, y: rShin.y2 }] : [])
      ];

      let reason: string | undefined;
      let badX = actor.x;
      let badY = geom.head.y;

      if (headTop < -tolY || headBottom > height + tolY) {
        reason = `head vertical bounds [${num(headTop, 1)}..${num(headBottom, 1)}] outside [0..${height}]`;
        badX = geom.head.x;
        badY = headTop < -tolY ? headTop : headBottom;
      } else if (!allowOffstageX && (headLeft < -tolX || headRight > width + tolX)) {
        reason = `head horizontal bounds [${num(headLeft, 1)}..${num(headRight, 1)}] outside [0..${width}]`;
        badX = headLeft < -tolX ? headLeft : headRight;
        badY = geom.head.y;
      } else {
        for (const foot of feet) {
          if (foot.y < -tolY || foot.y > height + tolY) {
            reason = `${foot.label} y=${num(foot.y, 1)} outside [0..${height}]`;
            badX = foot.x;
            badY = foot.y;
            break;
          }
          if (!allowOffstageX && (foot.x < -tolX || foot.x > width + tolX)) {
            reason = `${foot.label} x=${num(foot.x, 1)} outside [0..${width}]`;
            badX = foot.x;
            badY = foot.y;
            break;
          }
        }
      }

      if (reason !== undefined) {
        outOfBoundsFrames.push({
          timeMs: Number(t.toFixed(2)),
          kind: "actor",
          id: actor.id,
          action: actor.action,
          x: Number(badX.toFixed(2)),
          y: Number(badY.toFixed(2)),
          reason
        });
      }
    }

    for (const addon of frame.addons ?? []) {
      if (addon.opacity <= 0.05 || addon.scale <= 0.05) continue;
      const ownerSpan = addon.actorId !== undefined ? spanMap.get(addon.actorId) : undefined;
      if (isAddonSlidingAt(ownerSpan, addon.id, t)) continue;
      const ownerOffstageAllowed =
        addon.actorId !== undefined && isHorizontalOffstagePermitted(ownerSpan, width, t);

      const left = addon.x;
      const right = addon.x + addon.width;
      const top = addon.y;
      const bottom = addon.y + addon.height;

      const verticalOut = top < -tolY || bottom > height + tolY;
      const horizontalOut = !ownerOffstageAllowed && (left < -tolY || right > width + tolY);

      if (verticalOut || horizontalOut) {
        outOfBoundsFrames.push({
          timeMs: Number(t.toFixed(2)),
          kind: "addon",
          id: addon.id,
          x: Number(addon.x.toFixed(2)),
          y: Number(addon.y.toFixed(2)),
          reason: verticalOut
            ? `addon "${addon.type}" vertical [${num(top, 1)}..${num(bottom, 1)}] outside [0..${height}]`
            : `addon "${addon.type}" horizontal [${num(left, 1)}..${num(right, 1)}] outside [0..${width}]`
        });
      }
    }
  }

  // Seam step across contiguous action boundaries (and idle<->action boundaries) per actor
  const seamStepByActorPx: Record<string, number> = {};
  let maxSeamStepPx = 0;

  if (v2Spec) {
    for (const actor of v2Spec.actors) {
      let actorMax = 0;
      const boundaries = new Set<number>();
      for (let i = 0; i < actor.actions.length; i++) {
        const act = actor.actions[i]!;
        if (act.startMs > 0 && act.startMs <= durationMs) {
          boundaries.add(act.startMs);
        }
        const endMs = act.startMs + act.durationMs;
        if (endMs > 0 && endMs < durationMs) {
          boundaries.add(endMs);
        }
      }
      for (const b of boundaries) {
        const beforeFrame = sampleAnimation(program, Math.max(0, b - 1), "normal");
        const afterFrame = sampleAnimation(program, b, "normal");
        const beforeActor = beforeFrame.actors?.find((item) => item.id === actor.id);
        const afterActor = afterFrame.actors?.find((item) => item.id === actor.id);
        if (beforeActor && afterActor) {
          const step = maxJointStepBetween(beforeActor, afterActor);
          if (step > actorMax) actorMax = step;
        }
      }
      const rounded = Number(actorMax.toFixed(3));
      seamStepByActorPx[actor.id] = rounded;
      if (rounded > maxSeamStepPx) maxSeamStepPx = rounded;
    }
  } else {
    const v1 = program.spec as AnimationSpec;
    let actorMax = 0;
    for (const act of v1.actions) {
      if (act.startMs > 0 && act.startMs <= durationMs) {
        const step = maxJointStepBetween(
          sampleAnimation(program, Math.max(0, act.startMs - 1), "normal"),
          sampleAnimation(program, act.startMs, "normal")
        );
        if (step > actorMax) actorMax = step;
      }
    }
    const rounded = Number(actorMax.toFixed(3));
    seamStepByActorPx.actor = rounded;
    maxSeamStepPx = rounded;
  }

  // Actor overlap warnings: 2+ onstage actors occupying |xA - xB| < 14 simultaneously for >= 500ms
  const actorOverlapWarnings: ActorOverlapWarning[] = [];
  if (v2Spec && v2Spec.actors.length >= 2) {
    const overlapStepMs = 20;
    const overlapTimes: number[] = [];
    for (let t = 0; t <= durationMs; t += overlapStepMs) {
      overlapTimes.push(t);
    }
    if (overlapTimes[overlapTimes.length - 1] !== durationMs) {
      overlapTimes.push(durationMs);
    }

    const actorsByStep = overlapTimes.map((t) => {
      const f = sampleAnimation(program, t, "normal");
      const byId = new Map<string, SampledActorFrame>();
      for (const a of f.actors ?? []) byId.set(a.id, a);
      return { timeMs: t, byId };
    });

    const specs: CompiledActorSpec[] = v2Spec.actors;
    for (let i = 0; i < specs.length; i++) {
      for (let j = i + 1; j < specs.length; j++) {
        const idA = specs[i]!.id;
        const idB = specs[j]!.id;
        let activeStart: number | null = null;
        let activeEnd = 0;
        let minDist = Infinity;

        const flushRun = (): void => {
          if (activeStart !== null) {
            const span = activeEnd - activeStart;
            if (span >= 500) {
              const roundedDist = Number(minDist.toFixed(2));
              actorOverlapWarnings.push({
                actorA: idA,
                actorB: idB,
                startMs: activeStart,
                endMs: activeEnd,
                durationMs: span,
                minDistancePx: roundedDist,
                message: `Actors "${idA}" and "${idB}" overlap horizontally (min |Δx|=${roundedDist}px < 14px) from ${activeStart}ms to ${activeEnd}ms (${span}ms).`
              });
            }
            activeStart = null;
            minDist = Infinity;
          }
        };

        for (const step of actorsByStep) {
          const a = step.byId.get(idA);
          const b = step.byId.get(idB);
          const bothOnstage =
            a !== undefined &&
            b !== undefined &&
            a.x >= 0 &&
            a.x <= width &&
            b.x >= 0 &&
            b.x <= width;
          const dist = bothOnstage ? Math.abs(a!.x - b!.x) : Infinity;
          if (dist < 14) {
            if (activeStart === null) {
              activeStart = step.timeMs;
            }
            activeEnd = step.timeMs;
            if (dist < minDist) minDist = dist;
          } else {
            flushRun();
          }
        }
        flushRun();
      }
    }
  }

  // Concise narrative beat summary for LLM self-review
  const markerWindowMs = Math.max(25, Math.round(500 / fps));
  const beatSummary = timestampsMs.map((t) => {
    const frame = sampleAnimation(program, t, "normal");
    const timeTag = `${(t / 1000).toFixed(2)}s`;
    const actorDescs =
      frame.actors && frame.actors.length > 0
        ? frame.actors.map(
            (a) => `${a.id} ${a.action} (${describeStageZone(a.x, width)}, x=${Math.round(a.x)})`
          )
        : [`actor ${frame.action} (${describeStageZone(frame.x, width)}, x=${Math.round(frame.x)})`];
    const visibleAddons = [...new Set((frame.addons ?? []).filter((a) => a.opacity > 0.05).map((a) => a.type))];
    const markers = [...new Set(nearbyMarkers(program.events, t, markerWindowMs).map((m) => m.marker))];
    const addonNote = visibleAddons.length > 0 ? ` + props[${visibleAddons.join(",")}]` : "";
    const markerNote = markers.length > 0 ? ` [markers:${markers.join(",")}]` : "";
    return `${timeTag}: ${actorDescs.join(" | ")}${addonNote}${markerNote}`;
  });

  return {
    panelCount,
    timestampsMs,
    durationMs,
    actorIds,
    addonTypes: [...seenAddonTypes],
    outOfBoundsCount: outOfBoundsFrames.length,
    outOfBoundsFrames,
    maxSeamStepPx,
    seamStepByActorPx,
    actorOverlapWarnings,
    beatSummary
  };
}

export async function rasterizeStoryboardPng(
  svg: string,
  options: RasterizeStoryboardOptions = {}
): Promise<StoryboardRasterizeResult> {
  try {
    const mod = options.loadResvg
      ? await options.loadResvg()
      : ((await import("@resvg/resvg-js")) as {
          Resvg: new (svgInput: string, opts?: Record<string, unknown>) => ResvgInstanceLike;
        });
    if (!mod || typeof mod.Resvg !== "function") {
      return { rasterizerAvailable: false };
    }
    const pngBytes = new mod.Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
    return {
      pngBase64: Buffer.from(pngBytes).toString("base64"),
      rasterizerAvailable: true
    };
  } catch {
    return { rasterizerAvailable: false };
  }
}
