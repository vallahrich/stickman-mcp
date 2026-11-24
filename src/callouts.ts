import {
  CONTRACT_VERSION_V2,
  type AnimationSpecV2,
  type CalloutIcon,
  type CalloutKind,
  type CalloutTone,
  type CompiledAnimation,
  type SampledActorFrame,
  type SampledCallout,
  type SampledFrame
} from "./contract.js";
import { cameraFrustum, resolveCueTimeMs } from "./camera.js";
import { escapeXml } from "./props.js";

export const MIN_CALLOUT_DURATION_MS = 900;

export interface ResolvedCallout {
  id: string;
  kind: CalloutKind;
  text: string;
  actorId?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  tone: CalloutTone;
  icon?: CalloutIcon;
}

export interface CalloutRenderOptions {
  blueprint?: boolean;
  decimals?: number;
}

interface Box2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TONE_COLORS: Record<CalloutTone, { accent: string; softBg: string; border: string }> = {
  neutral: { accent: "#5c5c5c", softBg: "#f5f5f5", border: "#dedede" },
  accent: { accent: "#b11f4b", softBg: "#fdf2f5", border: "#e7b8c6" },
  success: { accent: "#16a34a", softBg: "#f0fdf4", border: "#bbf7d0" },
  warning: { accent: "#f59e0b", softBg: "#fffbeb", border: "#fde68a" },
  danger: { accent: "#dc2626", softBg: "#fef2f2", border: "#fecaca" }
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const r = Math.round(value * factor) / factor;
  return Math.abs(r) < 1e-6 ? 0 : r;
}

function fmt(value: number, decimals = 2): string {
  return round(value, decimals).toString();
}

export function inferStatusCalloutStyle(text: string): { tone: CalloutTone; icon: CalloutIcon } {
  const lower = text.trim().toLowerCase();
  if (
    lower.includes("!") ||
    /\b(alert|error|fail|failed|failure|critical|down|incident|outage|blocked|crash)\b/.test(lower)
  ) {
    return { tone: "danger", icon: "alert" };
  }
  if (
    lower.includes("✓") ||
    lower.includes("✔") ||
    /\b(ok|green|verified|pass|passed|done|ready|healthy|resolved|shipped|complete)\b/.test(lower)
  ) {
    return { tone: "success", icon: "check" };
  }
  if (/\b(warn|warning|slow|retry|degraded|pending|caution|latency)\b/.test(lower)) {
    return { tone: "warning", icon: "alert" };
  }
  if (/(%|ms\b|s\b|rps\b|kpi\b|\$\d|\d+x\b|\d+\.\d+)/i.test(lower)) {
    return { tone: "accent", icon: "metric" };
  }
  if (/\b(idea|new|spark|ai|launch|beta|magic)\b/.test(lower) || text.includes("✨")) {
    return { tone: "accent", icon: "spark" };
  }
  return { tone: "neutral", icon: "info" };
}

export function hasSceneCallouts(program: CompiledAnimation): boolean {
  if (program.contractVersion !== CONTRACT_VERSION_V2) return false;
  const spec = program.spec as AnimationSpecV2;
  if (spec.callouts && spec.callouts.length > 0) return true;
  return spec.actors.some((actor) =>
    actor.actions.some((act) => Boolean(act.say || act.think || act.badge))
  );
}

export function resolveCompiledCallouts(program: CompiledAnimation): ResolvedCallout[] {
  if (program.contractVersion !== CONTRACT_VERSION_V2) return [];
  const spec = program.spec as AnimationSpecV2;
  const durationMs = spec.durationMs;
  const minHold = Math.min(MIN_CALLOUT_DURATION_MS, durationMs);
  const out: ResolvedCallout[] = [];
  const seenIds = new Set<string>();

  const uniqueId = (base: string): string => {
    let candidate = base;
    let n = 2;
    while (seenIds.has(candidate)) {
      candidate = `${base}-${n++}`;
    }
    seenIds.add(candidate);
    return candidate;
  };

  const pushResolved = (params: {
    id: string;
    kind: CalloutKind;
    text: string;
    actorId?: string;
    rawStartMs: number;
    rawDurationMs: number;
    tone: CalloutTone;
    icon?: CalloutIcon;
  }): void => {
    const effDuration = Math.min(durationMs, Math.max(minHold, Math.round(params.rawDurationMs)));
    const effStart = clamp(Math.round(params.rawStartMs), 0, Math.max(0, durationMs - effDuration));
    const effEnd = effStart + effDuration;
    out.push({
      id: uniqueId(params.id),
      kind: params.kind,
      text: params.text.trim(),
      ...(params.actorId !== undefined ? { actorId: params.actorId } : {}),
      startMs: effStart,
      endMs: effEnd,
      durationMs: effDuration,
      tone: params.tone,
      ...(params.icon !== undefined ? { icon: params.icon } : {})
    });
  };

  // 1. Inline ergonomic action shorthands (say, think, badge)
  for (const actor of spec.actors) {
    actor.actions.forEach((act, idx) => {
      if (typeof act.say === "string" && act.say.trim()) {
        pushResolved({
          id: `${actor.id}-act-${idx}-say`,
          kind: "speech",
          text: act.say,
          actorId: actor.id,
          rawStartMs: act.startMs,
          rawDurationMs: Math.max(MIN_CALLOUT_DURATION_MS, act.durationMs),
          tone: "neutral"
        });
      }
      if (typeof act.think === "string" && act.think.trim()) {
        pushResolved({
          id: `${actor.id}-act-${idx}-think`,
          kind: "thought",
          text: act.think,
          actorId: actor.id,
          rawStartMs: act.startMs,
          rawDurationMs: Math.max(MIN_CALLOUT_DURATION_MS, act.durationMs),
          tone: "neutral"
        });
      }
      if (typeof act.badge === "string" && act.badge.trim()) {
        const inferred = inferStatusCalloutStyle(act.badge);
        pushResolved({
          id: `${actor.id}-act-${idx}-badge`,
          kind: "status",
          text: act.badge,
          actorId: actor.id,
          rawStartMs: act.startMs,
          rawDurationMs: Math.max(MIN_CALLOUT_DURATION_MS, act.durationMs),
          tone: inferred.tone,
          icon: inferred.icon
        });
      }
    });
  }

  // 2. Explicit scene-level callouts
  (spec.callouts ?? []).forEach((item, idx) => {
    const kind: CalloutKind = item.kind ?? (item.actorId ? "speech" : "caption");
    const rawStartMs =
      typeof item.startMs === "number" && Number.isFinite(item.startMs)
        ? item.startMs
        : typeof item.atCue === "string" && item.atCue.trim()
          ? (resolveCueTimeMs(program, item.atCue.trim()) ?? 0)
          : 0;
    const rawDurationMs =
      typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
        ? Math.max(MIN_CALLOUT_DURATION_MS, item.durationMs)
        : Math.max(MIN_CALLOUT_DURATION_MS, 1500);

    const inferred = kind === "status" ? inferStatusCalloutStyle(item.text) : undefined;
    const tone: CalloutTone = item.tone ?? inferred?.tone ?? "neutral";
    const icon: CalloutIcon | undefined = item.icon ?? inferred?.icon;

    pushResolved({
      id: item.id?.trim() || `callout-${idx}`,
      kind,
      text: item.text,
      ...(item.actorId !== undefined ? { actorId: item.actorId } : {}),
      rawStartMs,
      rawDurationMs,
      tone,
      ...(icon !== undefined ? { icon } : {})
    });
  });

  return out;
}

function estimateCharWidth(ch: string, fontSize: number): number {
  if (ch === " ") return fontSize * 0.3;
  if ("ilI1|!.,:;'\"".includes(ch)) return fontSize * 0.34;
  if ("MW@#%&".includes(ch)) return fontSize * 0.82;
  if (ch >= "A" && ch <= "Z") return fontSize * 0.66;
  return fontSize * 0.56;
}

function measureTextWidth(text: string, fontSize: number): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum += estimateCharWidth(text[i]!, fontSize);
  }
  return sum;
}

function wrapCalloutText(text: string, fontSize: number, maxTextWidth: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  const pushWord = (word: string): void => {
    if (!current) {
      if (measureTextWidth(word, fontSize) <= maxTextWidth) {
        current = word;
        return;
      }
      // Hard-split single very long token
      let chunk = "";
      for (const ch of word) {
        if (chunk && measureTextWidth(chunk + ch, fontSize) > maxTextWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
      return;
    }
    const candidate = `${current} ${word}`;
    if (measureTextWidth(candidate, fontSize) <= maxTextWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = "";
      pushWord(word);
    }
  };

  for (const word of words) {
    pushWord(word);
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  kept[maxLines - 1] = last.length > 3 ? `${last.slice(0, Math.max(1, last.length - 1))}…` : `${last}…`;
  return kept;
}

interface CalloutMetrics {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  width: number;
  height: number;
  padX: number;
  padY: number;
  iconSpace: number;
  accentBarWidth: number;
}

function measureCallout(
  kind: CalloutKind,
  text: string,
  tone: CalloutTone,
  icon: CalloutIcon | undefined,
  viewportW: number
): CalloutMetrics {
  if (kind === "status") {
    const fontSize = 11.5;
    const lineHeight = 14;
    const padX = 10;
    const padY = 5.5;
    const iconSpace = icon ? 16 : 0;
    const accentBarWidth = 3;
    const maxTextW = Math.max(80, Math.min(200, viewportW * 0.34) - padX * 2 - iconSpace - accentBarWidth);
    const lines = wrapCalloutText(text, fontSize, maxTextW, 1);
    const textW = Math.max(...lines.map((l) => measureTextWidth(l, fontSize)));
    const width = Math.ceil(Math.max(58, textW + padX * 2 + iconSpace + accentBarWidth + 4));
    const height = Math.ceil(lines.length * lineHeight + padY * 2);
    return { lines, fontSize, lineHeight, width, height, padX, padY, iconSpace, accentBarWidth };
  }

  if (kind === "caption") {
    const fontSize = 13;
    const lineHeight = 17;
    const padX = 14;
    const padY = 8;
    const maxTextW = Math.max(120, Math.min(viewportW - 36, 620) - padX * 2);
    const lines = wrapCalloutText(text, fontSize, maxTextW, 2);
    const textW = Math.max(...lines.map((l) => measureTextWidth(l, fontSize)));
    const width = Math.ceil(Math.min(viewportW - 16, Math.max(110, textW + padX * 2 + 4)));
    const height = Math.ceil(lines.length * lineHeight + padY * 2);
    return { lines, fontSize, lineHeight, width, height, padX, padY, iconSpace: 0, accentBarWidth: 0 };
  }

  // speech or thought
  const fontSize = 12.5;
  const lineHeight = 16;
  const padX = 12;
  const padY = 8;
  const accentBarWidth = kind === "speech" && tone !== "neutral" ? 3 : 0;
  const iconSpace = icon ? 16 : 0;
  const maxBoxW = Math.max(110, Math.min(230, Math.floor(viewportW * 0.38)));
  const maxTextW = Math.max(70, maxBoxW - padX * 2 - iconSpace - accentBarWidth);
  const lines = wrapCalloutText(text, fontSize, maxTextW, 3);
  const textW = Math.max(...lines.map((l) => measureTextWidth(l, fontSize)));
  const width = Math.ceil(Math.min(maxBoxW, Math.max(68, textW + padX * 2 + iconSpace + accentBarWidth + 4)));
  const height = Math.ceil(lines.length * lineHeight + padY * 2);
  return { lines, fontSize, lineHeight, width, height, padX, padY, iconSpace, accentBarWidth };
}

function boxesOverlap(a: Box2D, b: Box2D, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap - 1e-6 &&
    a.x + a.width + gap > b.x + 1e-6 &&
    a.y < b.y + b.height + gap - 1e-6 &&
    a.y + a.height + gap > b.y + 1e-6
  );
}

function overlapArea(a: Box2D, b: Box2D): number {
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ox * oy;
}

function computeTailSide(
  box: Box2D,
  anchorX?: number,
  anchorY?: number
): "bottom" | "top" | "left" | "right" | undefined {
  if (anchorX === undefined || anchorY === undefined) return undefined;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (anchorY >= box.y + box.height - 2) return "bottom";
  if (anchorY <= box.y + 2) return "top";
  if (anchorX <= cx) return "left";
  if (anchorX > cx) return "right";
  return cy <= anchorY ? "bottom" : "top";
}

export function sampleCallouts(
  program: CompiledAnimation,
  timeMs: number,
  frame?: SampledFrame
): SampledCallout[] {
  if (program.contractVersion !== CONTRACT_VERSION_V2) return [];
  const spec = program.spec as AnimationSpecV2;
  const allCallouts = resolveCompiledCallouts(program);
  if (allCallouts.length === 0) return [];

  const t = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, spec.durationMs);
  const active = allCallouts.filter((c) => t >= c.startMs - 1e-6 && t <= c.endMs + 1e-6);
  if (active.length === 0) return [];

  const { width: canvasW, height: canvasH } = spec.canvas;
  const margin = 8;
  let minX = margin;
  let minY = margin;
  let maxX = canvasW - margin;
  let maxY = canvasH - margin;

  if (frame?.camera && frame.camera.zoom > 1.001) {
    const frustum = cameraFrustum(frame.camera, canvasW, canvasH);
    minX = Math.max(minX, frustum.x + margin);
    minY = Math.max(minY, frustum.y + margin);
    maxX = Math.min(maxX, frustum.x + frustum.width - margin);
    maxY = Math.min(maxY, frustum.y + frustum.height - margin);
  }

  const viewportW = Math.max(80, maxX - minX);

  const actorMap = new Map<string, SampledActorFrame>();
  const headObstacles: Box2D[] = [];
  if (frame?.actors && frame.actors.length > 0) {
    for (const actor of frame.actors) {
      actorMap.set(actor.id, actor);
      const hr = 11 * actor.scale + 4;
      headObstacles.push({
        x: actor.head.x - hr,
        y: actor.head.y - hr,
        width: hr * 2,
        height: hr * 2
      });
    }
  } else if (frame) {
    const hr = 15;
    headObstacles.push({
      x: frame.head.x - hr,
      y: frame.head.y - hr,
      width: hr * 2,
      height: hr * 2
    });
  }

  interface CandidateCallout {
    item: ResolvedCallout;
    metrics: CalloutMetrics;
    prefX: number;
    prefY: number;
    anchorX?: number;
    anchorY?: number;
    order: number;
  }

  const prepared: CandidateCallout[] = active.map((item, idx) => {
    const metrics = measureCallout(item.kind, item.text, item.tone, item.icon, viewportW);
    const actor = item.actorId ? actorMap.get(item.actorId) : undefined;
    const compiledActor = !actor && item.actorId ? spec.actors.find((a) => a.id === item.actorId) : undefined;

    let anchorX: number | undefined;
    let anchorY: number | undefined;
    let prefX: number;
    let prefY: number;

    if (item.kind === "caption") {
      prefX = clamp((minX + maxX) / 2 - metrics.width / 2, minX, Math.max(minX, maxX - metrics.width));
      prefY = clamp(maxY - metrics.height, minY, Math.max(minY, maxY - metrics.height));
    } else if (actor) {
      const hr = 11 * actor.scale;
      anchorX = actor.head.x;
      anchorY = actor.head.y - hr - 4;
      const tailGap = item.kind === "status" ? 10 : 14;
      prefX = clamp(anchorX - metrics.width / 2, minX, Math.max(minX, maxX - metrics.width));
      prefY = clamp(anchorY - metrics.height - tailGap, minY, Math.max(minY, maxY - metrics.height));
    } else if (compiledActor) {
      const hr = 11 * compiledActor.scale;
      anchorX = compiledActor.x;
      anchorY = compiledActor.groundY - 144 * compiledActor.scale - hr;
      prefX = clamp(anchorX - metrics.width / 2, minX, Math.max(minX, maxX - metrics.width));
      prefY = clamp(anchorY - metrics.height - 14, minY, Math.max(minY, maxY - metrics.height));
    } else {
      // Unanchored status / speech
      prefX = clamp((minX + maxX) / 2 - metrics.width / 2, minX, Math.max(minX, maxX - metrics.width));
      prefY = minY + 4;
    }

    return {
      item,
      metrics,
      prefX,
      prefY,
      ...(anchorX !== undefined ? { anchorX } : {}),
      ...(anchorY !== undefined ? { anchorY } : {}),
      order: idx
    };
  });

  // Deterministic placement order: captions first (bottom), then actor bubbles left-to-right, then status badges
  const kindRank = (k: CalloutKind): number => (k === "caption" ? 0 : k === "status" ? 2 : 1);
  prepared.sort(
    (a, b) =>
      kindRank(a.item.kind) - kindRank(b.item.kind) ||
      (a.anchorX ?? a.prefX) - (b.anchorX ?? b.prefX) ||
      a.order - b.order
  );

  // If two non-caption callouts have overlapping preferred boxes side-by-side, gently pre-nudge them apart horizontally
  const gap = 8;
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i]!;
      const b = prepared[j]!;
      if (a.item.kind === "caption" || b.item.kind === "caption") continue;
      const boxA: Box2D = { x: a.prefX, y: a.prefY, width: a.metrics.width, height: a.metrics.height };
      const boxB: Box2D = { x: b.prefX, y: b.prefY, width: b.metrics.width, height: b.metrics.height };
      if (boxesOverlap(boxA, boxB, gap)) {
        const ax = a.anchorX ?? a.prefX + a.metrics.width / 2;
        const bx = b.anchorX ?? b.prefX + b.metrics.width / 2;
        if (Math.abs(ax - bx) > 12) {
          const left = ax <= bx ? a : b;
          const right = ax <= bx ? b : a;
          const overlapX = left.prefX + left.metrics.width + gap - right.prefX;
          if (overlapX > 0) {
            const half = Math.ceil(overlapX / 2);
            left.prefX = clamp(left.prefX - half, minX, Math.max(minX, maxX - left.metrics.width));
            right.prefX = clamp(right.prefX + half, minX, Math.max(minX, maxX - right.metrics.width));
          }
        }
      }
    }
  }

  const placed: Array<{ cand: CandidateCallout; box: Box2D }> = [];

  for (const cand of prepared) {
    const bw = cand.metrics.width;
    const bh = cand.metrics.height;
    const limitX = Math.max(minX, maxX - bw);
    const limitY = Math.max(minY, maxY - bh);

    const makeBox = (x: number, y: number): Box2D => ({
      x: clamp(x, minX, limitX),
      y: clamp(y, minY, limitY),
      width: bw,
      height: bh
    });

    const isFreeOfCallouts = (box: Box2D): boolean =>
      placed.every((p) => !boxesOverlap(box, p.box, gap));

    const headOverlapCost = (box: Box2D): number =>
      headObstacles.reduce((sum, h) => sum + overlapArea(box, h), 0);

    const calloutOverlapCost = (box: Box2D): number =>
      placed.reduce((sum, p) => {
        const padded: Box2D = {
          x: p.box.x - gap / 2,
          y: p.box.y - gap / 2,
          width: p.box.width + gap,
          height: p.box.height + gap
        };
        return sum + overlapArea(box, padded);
      }, 0);

    const initial = makeBox(cand.prefX, cand.prefY);
    if (isFreeOfCallouts(initial) && headOverlapCost(initial) === 0) {
      placed.push({ cand, box: initial });
      continue;
    }

    // Build deterministic candidate coordinates: direct neighbor edges around existing boxes & head boxes + grid sweep
    const candidateCoords: Array<{ x: number; y: number }> = [{ x: initial.x, y: initial.y }];

    for (const p of placed) {
      candidateCoords.push(
        { x: cand.prefX, y: p.box.y - bh - gap },
        { x: cand.prefX, y: p.box.y + p.box.height + gap },
        { x: p.box.x - bw - gap, y: cand.prefY },
        { x: p.box.x + p.box.width + gap, y: cand.prefY },
        { x: p.box.x - bw - gap, y: p.box.y },
        { x: p.box.x + p.box.width + gap, y: p.box.y },
        { x: p.box.x, y: p.box.y - bh - gap },
        { x: p.box.x, y: p.box.y + p.box.height + gap }
      );
    }

    for (const h of headObstacles) {
      candidateCoords.push(
        { x: cand.prefX, y: h.y - bh - 10 },
        { x: h.x - bw - 10, y: cand.prefY },
        { x: h.x + h.width + 10, y: cand.prefY }
      );
    }

    // Deterministic ring & grid fallback to guarantee finding a non-overlapping spot anywhere in viewport
    const stepX = Math.max(24, Math.round(bw * 0.45));
    const stepY = Math.max(18, Math.round(bh + gap));
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        candidateCoords.push({
          x: cand.prefX + dx * stepX,
          y: cand.prefY + dy * stepY
        });
      }
    }
    for (let y = minY; y <= limitY; y += Math.max(16, Math.round(bh + gap))) {
      for (let x = minX; x <= limitX; x += Math.max(28, Math.round(bw * 0.5))) {
        candidateCoords.push({ x, y });
      }
    }

    let bestBox = initial;
    let bestScore = Infinity;

    for (const pt of candidateCoords) {
      const box = makeBox(pt.x, pt.y);
      const cOverlap = calloutOverlapCost(box);
      const hOverlap = headOverlapCost(box);
      const dist = Math.hypot(box.x - cand.prefX, box.y - cand.prefY);
      const belowPenalty = box.y > cand.prefY + 4 ? 18 : 0;
      const score = cOverlap * 1_000_000 + hOverlap * 10_000 + dist + belowPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestBox = box;
      }
    }

    placed.push({ cand, box: bestBox });
  }

  return placed.map(({ cand, box }): SampledCallout => {
    const tailSide =
      cand.item.kind === "speech" || cand.item.kind === "thought"
        ? computeTailSide(box, cand.anchorX, cand.anchorY)
        : undefined;
    return {
      id: cand.item.id,
      kind: cand.item.kind,
      text: cand.item.text,
      ...(cand.item.actorId !== undefined ? { actorId: cand.item.actorId } : {}),
      tone: cand.item.tone,
      ...(cand.item.icon !== undefined ? { icon: cand.item.icon } : {}),
      x: round(box.x, 2),
      y: round(box.y, 2),
      width: round(box.width, 2),
      height: round(box.height, 2),
      opacity: 1,
      ...(cand.anchorX !== undefined ? { anchorX: round(cand.anchorX, 2) } : {}),
      ...(cand.anchorY !== undefined ? { anchorY: round(cand.anchorY, 2) } : {}),
      ...(tailSide !== undefined ? { tailSide } : {})
    };
  });
}

function renderCalloutIconSvg(
  icon: CalloutIcon,
  cx: number,
  cy: number,
  color: string,
  decimals: number
): string {
  const n = (v: number): string => fmt(v, decimals);
  if (icon === "alert") {
    return (
      `<g data-callout-icon="alert">` +
      `<path d="M${n(cx)} ${n(cy - 5.2)}L${n(cx + 5.2)} ${n(cy + 4.2)}H${n(cx - 5.2)}Z" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M${n(cx)} ${n(cy - 2)}V${n(cy + 1)}" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>` +
      `<circle cx="${n(cx)}" cy="${n(cy + 2.8)}" r="0.8" fill="${color}"/>` +
      `</g>`
    );
  }
  if (icon === "check") {
    return (
      `<g data-callout-icon="check">` +
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="5.2" fill="none" stroke="${color}" stroke-width="1.3"/>` +
      `<path d="M${n(cx - 2.4)} ${n(cy + 0.2)}L${n(cx - 0.6)} ${n(cy + 2.1)}L${n(cx + 2.8)} ${n(cy - 2)}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</g>`
    );
  }
  if (icon === "spark") {
    return (
      `<g data-callout-icon="spark">` +
      `<path d="M${n(cx)} ${n(cy - 5.2)}L${n(cx + 1.5)} ${n(cy - 1.5)}L${n(cx + 5.2)} ${n(cy)}L${n(cx + 1.5)} ${n(cy + 1.5)}L${n(cx)} ${n(cy + 5.2)}L${n(cx - 1.5)} ${n(cy + 1.5)}L${n(cx - 5.2)} ${n(cy)}L${n(cx - 1.5)} ${n(cy - 1.5)}Z" fill="${color}"/>` +
      `</g>`
    );
  }
  if (icon === "metric") {
    return (
      `<g data-callout-icon="metric">` +
      `<rect x="${n(cx - 4.8)}" y="${n(cy + 0.4)}" width="2.4" height="4.2" rx="0.6" fill="${color}"/>` +
      `<rect x="${n(cx - 1.2)}" y="${n(cy - 2.2)}" width="2.4" height="6.8" rx="0.6" fill="${color}"/>` +
      `<rect x="${n(cx + 2.4)}" y="${n(cy - 4.6)}" width="2.4" height="9.2" rx="0.6" fill="${color}"/>` +
      `</g>`
    );
  }
  // info
  return (
    `<g data-callout-icon="info">` +
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="5.2" fill="none" stroke="${color}" stroke-width="1.3"/>` +
    `<circle cx="${n(cx)}" cy="${n(cy - 2.2)}" r="0.85" fill="${color}"/>` +
    `<path d="M${n(cx)} ${n(cy - 0.4)}V${n(cy + 2.8)}" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>` +
    `</g>`
  );
}

export function renderCalloutSvg(
  callout: SampledCallout,
  options: CalloutRenderOptions = {}
): string {
  const decimals = options.decimals ?? 2;
  const blueprint = options.blueprint === true;
  const n = (v: number): string => fmt(v, decimals);

  const tonePalette = TONE_COLORS[callout.tone] ?? TONE_COLORS.neutral;
  const accentColor = blueprint ? "#1e3a5f" : tonePalette.accent;
  const surfaceBg = blueprint ? "#f8fafc" : "#ffffff";
  const borderColor = blueprint ? "#1e3a5f" : "#dedede";
  const textColor = blueprint ? "#0f172a" : "#242424";
  const fontFamily = '"Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif';

  const { x, y, width, height, kind } = callout;
  const opacityAttr = callout.opacity < 0.999 ? ` opacity="${n(callout.opacity)}"` : "";
  const actorAttr = callout.actorId ? ` data-actor-id="${escapeXml(callout.actorId)}"` : "";

  if (kind === "caption") {
    const metrics = measureCallout("caption", callout.text, callout.tone, undefined, Math.max(width + 24, 240));
    const bg = blueprint ? "#0f172a" : "#242424";
    const stroke = blueprint ? "#1e3a5f" : "#474747";
    const firstBaseline = y + (height - (metrics.lines.length - 1) * metrics.lineHeight) / 2 + metrics.fontSize * 0.34;
    const textMarkup = metrics.lines
      .map(
        (line, idx) =>
          `<text x="${n(x + width / 2)}" y="${n(firstBaseline + idx * metrics.lineHeight)}" fill="#ffffff" font-family="${escapeXml(fontFamily)}" font-size="${n(metrics.fontSize)}" font-weight="500" text-anchor="middle">${escapeXml(line)}</text>`
      )
      .join("");
    return (
      `<g data-callout="${escapeXml(callout.id)}" data-callout-kind="caption" data-callout-tone="${escapeXml(callout.tone)}"${opacityAttr}>` +
      `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="8" fill="${bg}" fill-opacity="0.88" stroke="${stroke}" stroke-width="1"/>` +
      `${textMarkup}</g>`
    );
  }

  const metrics = measureCallout(kind, callout.text, callout.tone, callout.icon, Math.max(width * 3, 400));
  const rx = kind === "thought" ? 14 : 10;

  let tailMarkup = "";
  if (kind === "speech" && callout.anchorX !== undefined && callout.anchorY !== undefined) {
    const side = callout.tailSide ?? "bottom";
    if (side === "bottom") {
      const tipX = clamp(callout.anchorX, x + 12, x + width - 12);
      const baseX = clamp(tipX, x + 14, x + width - 14);
      const tipY = Math.min(callout.anchorY, y + height + 14);
      tailMarkup =
        `<path data-part="callout-tail" d="M${n(baseX - 5.5)} ${n(y + height - 0.5)}L${n(tipX)} ${n(tipY)}L${n(baseX + 5.5)} ${n(y + height - 0.5)}Z" fill="${surfaceBg}"/>` +
        `<path d="M${n(baseX - 5.5)} ${n(y + height)}L${n(tipX)} ${n(tipY)}L${n(baseX + 5.5)} ${n(y + height)}" fill="none" stroke="${borderColor}" stroke-width="1" stroke-linejoin="round"/>`;
    } else if (side === "top") {
      const tipX = clamp(callout.anchorX, x + 12, x + width - 12);
      const baseX = clamp(tipX, x + 14, x + width - 14);
      const tipY = Math.max(callout.anchorY, y - 14);
      tailMarkup =
        `<path data-part="callout-tail" d="M${n(baseX - 5.5)} ${n(y + 0.5)}L${n(tipX)} ${n(tipY)}L${n(baseX + 5.5)} ${n(y + 0.5)}Z" fill="${surfaceBg}"/>` +
        `<path d="M${n(baseX - 5.5)} ${n(y)}L${n(tipX)} ${n(tipY)}L${n(baseX + 5.5)} ${n(y)}" fill="none" stroke="${borderColor}" stroke-width="1" stroke-linejoin="round"/>`;
    } else if (side === "left") {
      const baseY = clamp(callout.anchorY, y + 12, y + height - 12);
      const tipX = Math.max(callout.anchorX, x - 12);
      tailMarkup =
        `<path data-part="callout-tail" d="M${n(x + 0.5)} ${n(baseY - 5)}L${n(tipX)} ${n(baseY)}L${n(x + 0.5)} ${n(baseY + 5)}Z" fill="${surfaceBg}"/>` +
        `<path d="M${n(x)} ${n(baseY - 5)}L${n(tipX)} ${n(baseY)}L${n(x)} ${n(baseY + 5)}" fill="none" stroke="${borderColor}" stroke-width="1" stroke-linejoin="round"/>`;
    } else {
      const baseY = clamp(callout.anchorY, y + 12, y + height - 12);
      const tipX = Math.min(callout.anchorX, x + width + 12);
      tailMarkup =
        `<path data-part="callout-tail" d="M${n(x + width - 0.5)} ${n(baseY - 5)}L${n(tipX)} ${n(baseY)}L${n(x + width - 0.5)} ${n(baseY + 5)}Z" fill="${surfaceBg}"/>` +
        `<path d="M${n(x + width)} ${n(baseY - 5)}L${n(tipX)} ${n(baseY)}L${n(x + width)} ${n(baseY + 5)}" fill="none" stroke="${borderColor}" stroke-width="1" stroke-linejoin="round"/>`;
    }
  } else if (kind === "thought" && callout.anchorX !== undefined && callout.anchorY !== undefined) {
    const startX = clamp(callout.anchorX, x + 14, x + width - 14);
    const startY = y + height + 3;
    const midX = startX + (callout.anchorX - startX) * 0.45;
    const midY = Math.min(callout.anchorY, startY + 6.5);
    const endX = startX + (callout.anchorX - startX) * 0.8;
    const endY = Math.min(callout.anchorY, startY + 12);
    tailMarkup =
      `<circle data-part="thought-dot" cx="${n(midX)}" cy="${n(midY)}" r="3.2" fill="${surfaceBg}" stroke="${borderColor}" stroke-width="1"/>` +
      `<circle data-part="thought-dot" cx="${n(endX)}" cy="${n(endY)}" r="2" fill="${surfaceBg}" stroke="${borderColor}" stroke-width="1"/>`;
  }

  const showAccentBar = kind === "status" || (kind === "speech" && callout.tone !== "neutral");
  const accentBarMarkup = showAccentBar
    ? `<rect x="${n(x + 1)}" y="${n(y + 4)}" width="3" height="${n(Math.max(6, height - 8))}" rx="1.5" fill="${accentColor}"/>`
    : "";

  const leftContentStart = x + metrics.padX + (showAccentBar ? 4 : 0);
  const iconMarkup = callout.icon
    ? renderCalloutIconSvg(callout.icon, leftContentStart + 5.5, y + height / 2, accentColor, decimals)
    : "";

  const textX = leftContentStart + (callout.icon ? 15 : 0);
  const firstBaseline = y + (height - (metrics.lines.length - 1) * metrics.lineHeight) / 2 + metrics.fontSize * 0.34;
  const fontWeight = kind === "status" ? "600" : "400";
  const fontStyle = kind === "thought" ? ' font-style="italic"' : "";
  const strokeDash = kind === "thought" ? ' stroke-dasharray="3.5 2"' : "";

  const textMarkup = metrics.lines
    .map(
      (line, idx) =>
        `<text x="${n(textX)}" y="${n(firstBaseline + idx * metrics.lineHeight)}" fill="${textColor}" font-family="${escapeXml(fontFamily)}" font-size="${n(metrics.fontSize)}" font-weight="${fontWeight}"${fontStyle}>${escapeXml(line)}</text>`
    )
    .join("");

  return (
    `<g data-callout="${escapeXml(callout.id)}" data-callout-kind="${escapeXml(kind)}" data-callout-tone="${escapeXml(callout.tone)}"${actorAttr}${opacityAttr}>` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${rx}" fill="${surfaceBg}" stroke="${borderColor}" stroke-width="1"${strokeDash}/>` +
    `${tailMarkup}${accentBarMarkup}${iconMarkup}${textMarkup}</g>`
  );
}
