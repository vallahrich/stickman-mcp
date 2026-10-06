import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function loadEngineRenderer() {
  try {
    const [render, clips, lib] = await Promise.all([
      import(pathToFileURL(path.join(repo, "dist", "render.js")).href),
      import(pathToFileURL(path.join(repo, "dist", "motion-clips.js")).href),
      import(pathToFileURL(path.join(repo, "dist", "motion-library.js")).href)
    ]);
    const [compiler, contract] = await Promise.all([
      import(pathToFileURL(path.join(repo, "dist", "compiler.js")).href),
      import(pathToFileURL(path.join(repo, "dist", "contract.js")).href)
    ]);
    return { ...render, ...clips, runtimeLibrary: lib.RUNTIME_MOTION_LIBRARY, compileAnimation: compiler.compileAnimation, sampleAnimation: compiler.sampleAnimation, CONTRACT_VERSION: contract.CONTRACT_VERSION };
  } catch (error) {
    throw new Error(`Review pages use the shipping renderer. Run "npm run build" first so dist/render.js and dist/motion-clips.js exist. ${error.message}`);
  }
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function num(value) {
  return Number(Number(value).toFixed(3)).toString();
}

function line(a, b) {
  return `M${num(a.x)} ${num(a.y)}L${num(b.x)} ${num(b.y)}`;
}

export const REVIEW_STAGE = { rootX: 160, groundY: 150, scale: 0.75 };
const ADDON_TYPES = new Set(["ball", "football", "basketball", "goal", "hoop", "hurdle", "spear", "card", "cone", "target", "sand-pit", "board", "sand-puff", "phone", "sign", "laptop", "tablet", "magnifier", "notebook", "pen"]);

function officePropSize(type) {
  return ({ laptop: { w: 48, h: 34 }, tablet: { w: 22, h: 30 }, magnifier: { w: 24, h: 34 }, notebook: { w: 30, h: 36 }, pen: { w: 4, h: 22 } })[type];
}

// Normalized grip coordinates in the unrotated drawing; the nib points down.
function officePropAnchor(prop) {
  if (prop.type === "magnifier") return { x: prop.x + prop.w * 0.76, y: prop.y + prop.h * 0.83 };
  if (prop.type === "pen") return { x: prop.x + prop.w * 0.5, y: prop.y + prop.h * 0.42 };
  return { x: prop.x + prop.w / 2, y: prop.y + prop.h / 2 };
}

function attachOfficeProp(prop, point, attach, stage) {
  const anchor = officePropAnchor(prop);
  prop.x += point.x - anchor.x + (attach.dx ?? 0) * stage.scale;
  prop.y += point.y - anchor.y - (attach.dy ?? 0) * stage.scale;
  if (prop.type === "pen" && point.angle !== undefined) prop.rot += point.angle * 180 / Math.PI - 90;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

export function addonLifecycleState(item = {}, frameIndex = 0, stage = REVIEW_STAGE) {
  const state = { visible: true, opacity: 1, scale: 1, rot: 0, dx: 0, dy: 0, puff: false, tip: false };
  const enter = item.enter;
  if (enter) {
    const start = enter.frame ?? 0;
    const dur = Math.max(1, enter.dur ?? 1);
    if (frameIndex < start) return { ...state, visible: false };
    const t = clamp01((frameIndex - start) / dur);
    if (t < 1) {
      if (enter.style === "pop") {
        state.scale *= t < 0.5 ? lerp(0, 1.1, t / 0.5) : lerp(1.1, 1, (t - 0.5) / 0.5);
        state.puff = true;
      } else if (enter.style === "fade") {
        state.opacity *= t;
      } else if (enter.style === "slide") {
        const distX = stage.rootX + 140;
        const distY = stage.groundY + 120;
        const d = 1 - t;
        if (enter.from === "right") state.dx += distX * d;
        else if (enter.from === "top") state.dy -= distY * d;
        else if (enter.from === "bottom") state.dy += distY * d;
        else state.dx -= distX * d;
      }
    }
  }
  const exit = item.exit;
  if (exit) {
    const start = exit.frame ?? 0;
    const dur = Math.max(1, exit.dur ?? 1);
    if (frameIndex >= start + dur) return { ...state, visible: false };
    if (frameIndex >= start) {
      const t = clamp01((frameIndex - start) / dur);
      if (exit.style === "shrink") state.scale *= 1 - t;
      else if (exit.style === "tip") {
        state.opacity *= 1 - t;
        state.rot += 15 * t;
        state.tip = true;
      } else state.opacity *= 1 - t;
    }
  }
  state.visible = state.opacity > 0.001 && state.scale > 0.001;
  return state;
}

function interpAddonKeys(keys = [], frameIndex = 0) {
  if (!Array.isArray(keys) || !keys.length) return { x: 0, y: 0, rot: 0, scale: 1 };
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  let a = sorted[0], b = sorted[sorted.length - 1];
  if (frameIndex <= sorted[0].frame) b = a;
  else if (frameIndex >= b.frame) a = b;
  else for (let i = 0; i < sorted.length - 1; i++) if (frameIndex >= sorted[i].frame && frameIndex <= sorted[i + 1].frame) { a = sorted[i]; b = sorted[i + 1]; break; }
  const t = b.frame === a.frame ? 0 : clamp01((frameIndex - a.frame) / (b.frame - a.frame));
  return {
    x: lerp(a.x ?? 0, b.x ?? a.x ?? 0, t),
    y: lerp(a.y ?? 0, b.y ?? a.y ?? 0, t),
    rot: lerp(a.rot ?? 0, b.rot ?? a.rot ?? 0, t),
    scale: lerp(a.scale ?? 1, b.scale ?? a.scale ?? 1, t)
  };
}

export function computeAddonFlightPoint(start, end, flight = {}, frameIndex = 0, stage = REVIEW_STAGE) {
  const from = flight.from ?? 0;
  const to = Math.max(from + 1, flight.to ?? from + 1);
  const t = clamp01((frameIndex - from) / (to - from));
  const apex = (flight.apex ?? 0) * stage.scale;
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t) - apex * 4 * t * (1 - t),
    rot: (flight.spin ?? 0) * t
  };
}

/** Samples one frame through the shipping engine (sampleClipMotion) exactly as compiler.ts does. */
export function engineSampledFrame(sampleClipMotion, clip, frameIndex, stage = { rootX: 160, groundY: 150, scale: 0.75 }) {
  const n = clip.frames.length;
  const authoredLoop = clip.loop && clip.poseKeys?.length;
  const cycles = authoredLoop ? Math.max(1, Math.floor(frameIndex / n) + 1) : 1;
  const localFrame = clip.loop && !authoredLoop ? ((frameIndex % n) + n) % n : frameIndex;
  const progress = clip.loop ? localFrame / (n * cycles) : frameIndex / Math.max(1, n - 1);
  const pose = sampleClipMotion({ clips: { [clip.name]: clip } }, { action: clip.name, clipId: clip.name, progress, ...(clip.loop && clip.poseKeys?.length ? { durationMs: cycles * n / clip.fps * 1000 } : {}), startX: stage.rootX, endX: stage.rootX, groundY: stage.groundY, facing: 1, scale: stage.scale });
  const cameraX = clip.loop && clip.strideLength && pose.articulated ? pose.joints.pelvis.x : pose.rootX;
  return { timeMs: Math.round(frameIndex / clip.fps * 1000), action: clip.name, x: cameraX, groundY: stage.groundY, head: pose.headPoint, segments: pose.segments, prop: null, ...(pose.facing !== undefined ? { facing: pose.facing } : {}), ...(pose.articulated ? { articulated: true } : {}) };
}

export async function clipFrameToSampledFrame(clip, frameIndex) {
  const { sampleClipMotion } = await loadEngineRenderer();
  return engineSampledFrame(sampleClipMotion, clip, frameIndex);
}


/** Props are authored in engine local units (same space as poseKeys foot/hand targets): x forward from the root, y = bottom edge height above ground. */
function layoutProp(spec, propsCatalog, frameIndex = 0, stage = { rootX: 160, groundY: 150, scale: 0.75 }) {
  const type = spec.prop;
  if (!type) return null;
  const office = officePropSize(type);
  const def = propsCatalog.props?.find((item) => item.type === type) ?? propsCatalog.props?.find((item) => item.type === (type === "bench" ? "chair" : type)) ?? { type, defaultSize: office ?? { w: 60, h: 40 } };
  const review = spec.review ?? {};
  const base = review.prop ?? {};
  const size = def.defaultSize ?? office ?? {};
  const w = base.w ?? size.w ?? (size.r ? size.r * 2 : 60);
  const h = base.h ?? size.h ?? (size.r ? size.r * 2 : 40);
  let x = base.x ?? 40;
  let y = base.y ?? 0;
  let open = base.open ?? 0;
  let ink = base.ink ?? 0;
  let scale = base.scale ?? 1;
  let fade = base.fade ?? 1;
  let rot = base.rot ?? 0;
  const keys = review.propMotion;
  if (Array.isArray(keys) && keys.length) {
    const sorted = [...keys].sort((a, b) => a.frame - b.frame);
    let a = sorted[0], b = sorted[sorted.length - 1];
    if (frameIndex <= sorted[0].frame) b = a;
    else if (frameIndex >= b.frame) a = b;
    else for (let i = 0; i < sorted.length - 1; i++) if (frameIndex >= sorted[i].frame && frameIndex <= sorted[i + 1].frame) { a = sorted[i]; b = sorted[i + 1]; break; }
    const t = b.frame === a.frame ? 0 : Math.max(0, Math.min(1, (frameIndex - a.frame) / (b.frame - a.frame)));
    x += (a.x ?? 0) + ((b.x ?? a.x ?? 0) - (a.x ?? 0)) * t;
    y += (a.y ?? 0) + ((b.y ?? a.y ?? 0) - (a.y ?? 0)) * t;
    if (a.open !== undefined || b.open !== undefined) open = (a.open ?? open) + ((b.open ?? a.open ?? open) - (a.open ?? open)) * t;
    if (a.ink !== undefined || b.ink !== undefined) ink = (a.ink ?? ink) + ((b.ink ?? a.ink ?? ink) - (a.ink ?? ink)) * t;
    if (a.scale !== undefined || b.scale !== undefined) scale = (a.scale ?? scale) + ((b.scale ?? a.scale ?? scale) - (a.scale ?? scale)) * t;
    if (a.fade !== undefined || b.fade !== undefined) fade = (a.fade ?? fade) + ((b.fade ?? a.fade ?? fade) - (a.fade ?? fade)) * t;
    if (office && (a.rot !== undefined || b.rot !== undefined)) rot = lerp(a.rot ?? rot, b.rot ?? a.rot ?? rot, t);
  }
  const k = stage.scale;
  const hinge = base.hinge ?? (x >= 0 ? "right" : "left");
  const monitorW = base.monitorW !== undefined ? base.monitorW * k : undefined;
  const monitorH = base.monitorH !== undefined ? base.monitorH * k : undefined;
  return { type: def.type ?? type, id: base.id, x: stage.rootX + x * k, y: stage.groundY - (y + h) * k, w: w * k, h: h * k, r: size.r, steps: base.steps ?? size.steps, rungs: base.rungs ?? size.rungs, open, ink, scale, fade, opacity: fade, ...(office ? { rot, drawScale: scale } : {}), hinge, monitorW, monitorH, color: base.color, clipFigureFrom: base.clipFigureFrom, clipFigureUntil: base.clipFigureUntil, enter: base.enter, exit: base.exit };
}

function doorMarkup(prop, strokeWidth, color, layer = "all") {
  const sw = num(strokeWidth);
  const g = doorGeometry(prop, strokeWidth);
  const { x, y, w, h, open, hingeX, freeX, nearTop, nearBottom, farTop, farBottom, handleX, handleY } = g;
  const attrs = `fill="#fff" stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const opening = open > 0.05 ? `<rect data-prop="door-opening" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="#4a4f57" opacity="0.85"/>` : "";
  const frame = `<rect data-prop="door-frame" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2" fill="none" stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const leaf = `<path data-prop="door-leaf" d="M${num(nearTop.x)} ${num(nearTop.y)}L${num(farTop.x)} ${num(farTop.y)}L${num(farBottom.x)} ${num(farBottom.y)}L${num(nearBottom.x)} ${num(nearBottom.y)}Z" ${attrs}/>`;
  const hinge = `<path data-prop="door-hinge" d="${line(nearTop, nearBottom)}" stroke="${xml(color)}" stroke-width="${num(strokeWidth * 1.15)}" stroke-linecap="round"/>`;
  const handle = `<circle data-prop="door-handle" cx="${num(handleX)}" cy="${num(handleY)}" r="${num(Math.max(2, strokeWidth))}" fill="#fff" stroke="${xml(color)}" stroke-width="${sw}"/>`;
  const rightPost = `<path data-prop="door-right-post" d="${line({ x: x + w, y }, { x: x + w, y: y + h })}" stroke="${xml(color)}" stroke-width="${num(strokeWidth * 1.25)}" stroke-linecap="round"/>`;
  if (layer === "back") return `<g data-prop="door">${opening}${leaf}${hinge}${handle}</g>`;
  if (layer === "back-opening") return `<g data-prop="door">${opening}</g>`;
  if (layer === "front-leaf") return `<g data-prop="door-front-leaf">${leaf}${hinge}${handle}</g>`;
  if (layer === "front") return `<g data-prop="door-frame-front">${frame}${rightPost}</g>`;
  return `<g data-prop="door">${opening}${leaf}${hinge}${handle}${frame}${rightPost}</g>`;
}

export function doorGeometry(prop, strokeWidth = 4) {
  const x = prop.x, y = prop.y, w = prop.w, h = prop.h;
  const open = Math.max(0, Math.min(1, prop.open ?? 0));
  const hingeLeft = prop.hinge === "left";
  const hingeX = hingeLeft ? x : x + w;
  const angle = open * Math.PI / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const freeX = hingeLeft ? x + w * c : x + w - w * c;
  const inset = h * 0.04 * s;
  const nearTop = { x: hingeX, y };
  const nearBottom = { x: hingeX, y: y + h };
  const farTop = { x: freeX, y: y + inset };
  const farBottom = { x: freeX, y: y + h - inset };
  const handleInset = Math.min(w * 0.18, Math.max(strokeWidth, w * 0.1));
  const towardHinge = hingeLeft ? -1 : 1;
  const gap = Math.abs(hingeX - freeX);
  const handleX = freeX + towardHinge * Math.min(handleInset, gap * 0.45);
  const handleY = y + h * 0.52;
  return { x, y, w, h, open, hingeLeft, hingeX, freeX, nearTop, nearBottom, farTop, farBottom, handleX, handleY };
}

function partialPolyline(points, amount) {
  const t = Math.max(0, Math.min(1, amount ?? 0));
  if (t <= 0 || points.length < 2) return "";
  const lengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    lengths.push(d);
    total += d;
  }
  let remaining = total * t;
  let d = `M${num(points[0].x)} ${num(points[0].y)}`;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining >= lengths[i]) {
      d += `L${num(points[i + 1].x)} ${num(points[i + 1].y)}`;
      remaining -= lengths[i];
    } else {
      const u = lengths[i] === 0 ? 0 : remaining / lengths[i];
      d += `L${num(points[i].x + (points[i + 1].x - points[i].x) * u)} ${num(points[i].y + (points[i + 1].y - points[i].y) * u)}`;
      break;
    }
  }
  return d;
}

function boardInkMarkup(prop, strokeWidth, color) {
  const ink = Math.max(0, Math.min(1, prop.ink ?? 0));
  if (ink <= 0) return "";
  const x = prop.x, y = prop.y, w = prop.w, h = prop.h, bh = h * 0.62;
  const sx = (v) => x + w * (v + 0.27);
  const sy = (v) => y + bh * v;
  const strokes = [
    [{ x: sx(0), y: sy(0.62) }, { x: sx(0.1), y: sy(0.2) }, { x: sx(0.2), y: sy(0.62) }],
    [{ x: sx(0.05), y: sy(0.43) }, { x: sx(0.16), y: sy(0.43) }],
    [{ x: sx(0.24), y: sy(0.22) }, { x: sx(0.37), y: sy(0.22) }],
    [{ x: sx(0.32), y: sy(0.22) }, { x: sx(0.32), y: sy(0.62) }],
    [{ x: sx(0.24), y: sy(0.62) }, { x: sx(0.4), y: sy(0.62) }],
    [{ x: sx(0), y: sy(0.7) }, { x: sx(0.36), y: sy(0.7) }],
    [{ x: sx(0.34), y: sy(0.58) }, { x: sx(0.4), y: sy(0.68) }, { x: sx(0.46), y: sy(0.5) }]
  ];
  const ranges = [0.3, 0.1, 0.14, 0.11, 0.08, 0.13, 0.14];
  let used = 0;
  const parts = [];
  for (let i = 0; i < strokes.length; i++) {
    const local = Math.max(0, Math.min(1, (ink - used) / ranges[i]));
    if (local > 0) parts.push(`<path d="${partialPolyline(strokes[i], local)}" fill="none" stroke="${xml(color)}" stroke-width="${num(strokeWidth * 0.55)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    used += ranges[i];
  }
  return parts.join("");
}

function binocularsMarkup(prop, strokeWidth, color) {
  const sw = num(strokeWidth);
  const x = prop.x, y = prop.y, w = prop.w, h = prop.h;
  const cx = x + w / 2, cy = y + h / 2;
  const barrelW = w * 0.34, barrelH = h * 0.68, gap = w * 0.12;
  const leftX = cx - gap / 2 - barrelW, rightX = cx + gap / 2, by = cy - barrelH / 2;
  const lensR = barrelH * 0.42;
  const strap = `M${num(cx - w * 0.38)} ${num(cy + h * 0.16)}Q${num(cx)} ${num(cy + h * 0.78)} ${num(cx + w * 0.38)} ${num(cy + h * 0.16)}`;
  return `<g data-prop="binoculars" fill="#fff" stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${strap}" fill="none" stroke-width="${num(strokeWidth * 0.42)}"/><rect x="${num(leftX)}" y="${num(by)}" width="${num(barrelW)}" height="${num(barrelH)}" rx="${num(barrelH * 0.25)}"/><rect x="${num(rightX)}" y="${num(by)}" width="${num(barrelW)}" height="${num(barrelH)}" rx="${num(barrelH * 0.25)}"/><circle cx="${num(leftX + barrelW * 0.78)}" cy="${num(cy)}" r="${num(lensR)}"/><circle cx="${num(rightX + barrelW * 0.78)}" cy="${num(cy)}" r="${num(lensR)}"/><path d="${line({ x: leftX + barrelW, y: cy }, { x: rightX, y: cy })}" stroke-width="${num(strokeWidth * 0.8)}"/></g>`;
}

function palmMarkup(prop, strokeWidth, color) {
  const wristX = prop.x + prop.w / 2, wristY = prop.y + prop.h / 2;
  const palmW = Math.max(prop.w * 1.05, 14), palmH = Math.max(prop.h * 1.05, 14);
  const fingerH = Math.max(prop.h * 0.72, 10);
  const fingerW = palmW * 0.2, gap = palmW * 0.04;
  const palmX = wristX - palmW / 2, palmY = wristY - palmH;
  const fingers = [-1.5, -0.5, 0.5, 1.5].map((slot, i) => {
    const x = wristX + slot * (fingerW + gap) - fingerW / 2;
    const extra = (i === 1 || i === 2) ? fingerH * 0.08 : 0;
    return `<rect x="${num(x)}" y="${num(palmY - fingerH - extra)}" width="${num(fingerW)}" height="${num(fingerH + extra + palmH * 0.22)}" rx="${num(fingerW * 0.48)}"/>`;
  }).join("");
  const thumbStart = { x: palmX + palmW * 0.08, y: palmY + palmH * 0.58 };
  const thumbEnd = { x: palmX - palmW * 0.42, y: palmY + palmH * 0.28 };
  const thumbOutline = `<path d="${line(thumbStart, thumbEnd)}" fill="none" stroke="${xml(color)}" stroke-width="${num(Math.max(strokeWidth * 2.5, palmW * 0.28))}" stroke-linecap="round"/>`;
  const thumbFill = `<path d="${line(thumbStart, thumbEnd)}" fill="none" stroke="#fff" stroke-width="${num(Math.max(strokeWidth * 1.55, palmW * 0.18))}" stroke-linecap="round"/>`;
  const separators = [-1, 0, 1].map((slot) => {
    const x = wristX + slot * (fingerW + gap);
    return `<path d="${line({ x, y: palmY - fingerH * 0.72 }, { x, y: palmY - palmH * 0.02 })}" fill="none" stroke-width="${num(strokeWidth * 0.38)}"/>`;
  }).join("");
  const palm = `<rect x="${num(palmX)}" y="${num(palmY)}" width="${num(palmW)}" height="${num(palmH)}" rx="${num(palmW * 0.24)}"/>`;
  return `<g data-prop="palm" fill="#fff" stroke="${xml(color)}" stroke-width="${num(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${thumbOutline}${fingers}${palm}${thumbFill}${separators}</g>`;
}

function thumbMarkup(prop, strokeWidth, color) {
  const cx = prop.x + prop.w / 2, cy = prop.y + prop.h / 2;
  const fistW = Math.max(prop.w * 0.72, 10), fistH = Math.max(prop.h * 1.08, 18);
  const x = cx - fistW * 0.36, y = cy - fistH * 0.38;
  const thumbW = Math.max(fistW * 0.42, strokeWidth * 1.7), thumbH = fistH * 0.7;
  const tx = x - thumbW * 0.62, ty = y - thumbH * 0.48;
  const knuckles = [0.28, 0.43, 0.58, 0.73].map((t) => `<path d="${line({ x: x + fistW * 0.18, y: y + fistH * t }, { x: x + fistW * 0.76, y: y + fistH * t })}" stroke-width="${num(strokeWidth * 0.48)}"/>`).join("");
  const thumb = `<rect x="${num(tx)}" y="${num(ty)}" width="${num(thumbW)}" height="${num(thumbH)}" rx="${num(thumbW * 0.48)}" transform="rotate(-18 ${num(x)} ${num(y)})"/>`;
  const notch = `<path d="${line({ x: x + fistW * 0.08, y: y + fistH * 0.08 }, { x: x - fistW * 0.08, y: y + fistH * 0.18 })}" fill="none" stroke-width="${num(strokeWidth * 0.7)}"/>`;
  return `<g data-prop="thumb" fill="#fff" stroke="${xml(color)}" stroke-width="${num(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${thumb}<rect x="${num(x)}" y="${num(y)}" width="${num(fistW)}" height="${num(fistH)}" rx="${num(fistW * 0.42)}"/>${notch}${knuckles}</g>`;
}

function glassesMarkup(prop, strokeWidth, color) {
  const cx = prop.x + prop.w / 2, cy = prop.y + prop.h / 2;
  const side = Math.sign(prop.facing ?? 1) || 1;
  const front = Math.abs(prop.facing ?? 1);
  const r = Math.min(prop.w * 0.22, prop.h * 0.34);
  const spread = prop.w * (0.24 + 0.08 * (1 - front));
  const faceOffset = side * prop.w * 0.12 * front;
  const c1 = { x: cx + faceOffset - spread / 2, y: cy };
  const c2 = { x: cx + faceOffset + spread / 2, y: cy };
  const armEnd = { x: cx - side * prop.w * 0.38, y: cy + prop.h * 0.1 };
  return `<g data-prop="glasses" fill="none" stroke="${xml(color)}" stroke-width="${num(strokeWidth * 0.72)}" stroke-linecap="round" stroke-linejoin="round"><circle cx="${num(c1.x)}" cy="${num(c1.y)}" r="${num(r)}"/><circle cx="${num(c2.x)}" cy="${num(c2.y)}" r="${num(r)}"/><path d="${line({ x: c1.x + r, y: cy }, { x: c2.x - r, y: cy })}"/><path d="${line({ x: c1.x - side * r * 0.8, y: cy }, armEnd)}"/></g>`;
}

function watchMarkup(prop, strokeWidth, color) {
  const cx = prop.x + prop.w / 2, cy = prop.y + prop.h / 2;
  const a = prop.angle ?? -Math.PI / 2;
  const ux = Math.cos(a), uy = Math.sin(a);
  const px = -uy, py = ux;
  const faceR = Math.min(prop.w, prop.h) * 0.32;
  const face = { x: cx - ux * faceR * 0.35, y: cy - uy * faceR * 0.35 };
  const strapA = { x: face.x - px * faceR * 1.8, y: face.y - py * faceR * 1.8 };
  const strapB = { x: face.x + px * faceR * 1.8, y: face.y + py * faceR * 1.8 };
  const hand1 = { x: face.x + faceR * 0.05, y: face.y - faceR * 0.62 };
  const hand2 = { x: face.x + faceR * 0.55, y: face.y + faceR * 0.1 };
  return `<g data-prop="watch" fill="#fff" stroke="${xml(color)}" stroke-width="${num(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"><path d="${line(strapA, strapB)}" stroke-width="${num(strokeWidth * 1.15)}"/><circle cx="${num(face.x)}" cy="${num(face.y)}" r="${num(faceR)}"/><path d="${line(face, hand1)}" stroke-width="${num(strokeWidth * 0.45)}"/><path d="${line(face, hand2)}" stroke-width="${num(strokeWidth * 0.45)}"/></g>`;
}

function gloveMarkup(prop, strokeWidth, color) {
  const cx = prop.x + prop.w / 2, cy = prop.y + prop.h / 2;
  const a = prop.angle ?? 0;
  const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
  const w = Math.max(prop.w, 13), h = Math.max(prop.h, 10);
  const p = (f, s) => ({ x: cx + ux * f + px * s, y: cy + uy * f + py * s });
  const mittCx = cx + ux * w * 0.45, mittCy = cy + uy * w * 0.45;
  const rot = a * 180 / Math.PI;
  return `<g data-prop="glove" fill="#202124" stroke="${xml(color)}" stroke-width="${num(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"><rect x="${num(cx - w * 0.17)}" y="${num(cy - h * 0.28)}" width="${num(w * 0.34)}" height="${num(h * 0.56)}" rx="${num(h * 0.12)}" fill="#fff" transform="rotate(${num(rot)} ${num(cx)} ${num(cy)})"/><rect x="${num(mittCx - w * 0.35)}" y="${num(mittCy - h * 0.5)}" width="${num(w * 0.78)}" height="${num(h)}" rx="${num(h * 0.42)}" transform="rotate(${num(rot)} ${num(mittCx)} ${num(mittCy)})"/><path d="${line(p(w * 0.45, -h * 0.28), p(w * 0.42, h * 0.08))}" stroke="#fff" stroke-width="${num(strokeWidth * 0.45)}"/></g>`;
}

function wrapPropMarkup(prop, markup) {
  if (!markup) return "";
  const opacity = prop.opacity ?? 1;
  const scale = prop.drawScale ?? 1;
  const rot = prop.rot ?? 0;
  if (Math.abs(opacity - 1) < 0.001 && Math.abs(scale - 1) < 0.001 && Math.abs(rot) < 0.001 && !prop.puff) return markup;
  const anchor = officePropSize(prop.type) ? officePropAnchor(prop) : addonCenter(prop);
  const cx = anchor.x, cy = anchor.y;
  const rx = prop.tipPivot ? cx : cx, ry = prop.tipPivot ? prop.y + prop.h : cy;
  const transform = `translate(${num(cx)} ${num(cy)}) scale(${num(scale)}) translate(${num(-cx)} ${num(-cy)}) rotate(${num(rot)} ${num(rx)} ${num(ry)})`;
  const puff = prop.puff ? puffMarkup(prop, "#202124") : "";
  return `<g opacity="${num(opacity)}" transform="${transform}">${markup}</g>${puff}`;
}

function puffMarkup(prop, color) {
  const cx = prop.x + prop.w / 2, cy = prop.y + prop.h / 2;
  const r = Math.max(prop.w, prop.h) * 0.72;
  const arms = [
    [{ x: cx - r, y: cy }, { x: cx - r * 1.22, y: cy }],
    [{ x: cx + r, y: cy }, { x: cx + r * 1.22, y: cy }],
    [{ x: cx, y: cy - r }, { x: cx, y: cy - r * 1.22 }],
    [{ x: cx, y: cy + r }, { x: cx, y: cy + r * 1.22 }]
  ];
  return `<g data-addon-puff="true" fill="none" stroke="${xml(color)}" stroke-width="1" opacity="0.35" stroke-linecap="round">${arms.map(([a, b]) => `<path d="${line(a, b)}"/>`).join("")}</g>`;
}

function addonColor(prop, fallback = "#202124") {
  return prop.color ?? ({
    basketball: "#F28C28",
    hoop: "#D84A2B",
    hurdle: "#B11F4B",
    spear: "#8B5A2B",
    cone: "#F28C28",
    target: "#D62828",
    card: "#B11F4B",
    "sand-pit": "#e8c872",
    "sand-puff": "#e8c872",
    sign: "#fff7d6"
  }[prop.type] ?? fallback);
}

function addonMarkup(prop, strokeWidth, color) {
  const x = prop.x, y = prop.y, w = prop.w, h = prop.h, sw = num(strokeWidth);
  const c = addonColor(prop, color);
  const attrs = `stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  if (prop.type === "ball") {
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
    const seam = (s) => `M${num(cx + s * r * 0.34)} ${num(cy - r * 0.78)}Q${num(cx + s * r * 0.66)} ${num(cy)} ${num(cx + s * r * 0.34)} ${num(cy + r * 0.78)}`;
    const stitches = [-0.5, -0.18, 0.18, 0.5].map((t) => `<path d="${line({ x: cx - r * 0.42, y: cy + r * t }, { x: cx - r * 0.26, y: cy + r * (t + 0.1) })}"/><path d="${line({ x: cx + r * 0.42, y: cy + r * t }, { x: cx + r * 0.26, y: cy + r * (t + 0.1) })}"/>`).join("");
    return `<g data-addon="ball" ${attrs}><circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="#fff"/><g fill="none" stroke="#C62828" stroke-width="${num(strokeWidth * 0.42)}">${seam(-1)}${seam(1)}${stitches}</g></g>`;
  }
  if (prop.type === "football") {
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
    const patch = `M${num(cx)} ${num(cy - r * 0.38)}L${num(cx + r * 0.36)} ${num(cy - r * 0.12)}L${num(cx + r * 0.22)} ${num(cy + r * 0.32)}L${num(cx - r * 0.22)} ${num(cy + r * 0.32)}L${num(cx - r * 0.36)} ${num(cy - r * 0.12)}Z`;
    return `<g data-addon="football" ${attrs}><circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="#fff"/><path d="${patch}" fill="${xml(color)}"/><path d="${line({ x: cx - r * 0.8, y: cy - r * 0.15 }, { x: cx - r * 0.35, y: cy - r * 0.12 })}"/><path d="${line({ x: cx + r * 0.35, y: cy - r * 0.12 }, { x: cx + r * 0.8, y: cy - r * 0.15 })}"/></g>`;
  }
  if (prop.type === "basketball") {
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
    return `<g data-addon="basketball" ${attrs}><circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${xml(c)}"/><path d="${line({ x: cx - r, y: cy }, { x: cx + r, y: cy })}" fill="none"/><path d="${line({ x: cx, y: cy - r }, { x: cx, y: cy + r })}" fill="none"/><path d="M${num(cx - r * 0.72)} ${num(cy - r * 0.7)}Q${num(cx)} ${num(cy)} ${num(cx - r * 0.72)} ${num(cy + r * 0.7)}" fill="none"/><path d="M${num(cx + r * 0.72)} ${num(cy - r * 0.7)}Q${num(cx)} ${num(cy)} ${num(cx + r * 0.72)} ${num(cy + r * 0.7)}" fill="none"/></g>`;
  }
  if (prop.type === "goal") {
    const grid = [0.33, 0.66].map((t) => `<path d="${line({ x: x + w * t, y: y + h * 0.18 }, { x: x + w * t, y: y + h })}" stroke="#c9ced6" stroke-width="${num(strokeWidth * 0.35)}"/>`).join("") + [0.45, 0.72].map((t) => `<path d="${line({ x, y: y + h * t }, { x: x + w, y: y + h * t })}" stroke="#c9ced6" stroke-width="${num(strokeWidth * 0.35)}"/>`).join("");
    const bulge = prop.reactStyle === "bulge" ? ` transform="translate(${num(w * 0.08 * Math.sin((prop.reactT ?? 0) * Math.PI))} 0)"` : "";
    return `<g data-addon="goal" ${attrs} fill="none"><g${bulge}>${grid}</g><path d="M${num(x)} ${num(y + h)}V${num(y + h * 0.15)}H${num(x + w)}V${num(y + h)}"/></g>`;
  }
  if (prop.type === "hoop") {
    const wob = prop.reactStyle === "swish" || prop.reactStyle === "wobble" ? Math.sin((prop.reactT ?? 0) * Math.PI * 4) * 1.2 : 0;
    const bx = x, by = y, rimY = y + h * 0.48 + wob, rimX = x + w * 0.58;
    return `<g data-addon="hoop" ${attrs}><rect x="${num(bx)}" y="${num(by)}" width="${num(w * 0.48)}" height="${num(h * 0.36)}" rx="2" fill="#fff"/><path d="${line({ x: x + w * 0.48, y: rimY }, { x: x + w * 0.9, y: rimY })}" stroke="${xml(c)}" stroke-width="${num(strokeWidth * 1.15)}"/><path d="M${num(rimX - w * 0.12)} ${num(rimY)}L${num(rimX - w * 0.06)} ${num(y + h * 0.8)}M${num(rimX + w * 0.08)} ${num(rimY)}L${num(rimX + w * 0.02)} ${num(y + h * 0.8)}" fill="none" stroke="#c9ced6" stroke-width="${num(strokeWidth * 0.45)}"/></g>`;
  }
  if (prop.type === "hurdle") {
    const fall = prop.reactStyle === "fall" ? (prop.reactT ?? 0) * 82 : 0;
    const bar = `<g transform="rotate(${num(fall)} ${num(x + w * 0.08)} ${num(y + h * 0.18)})"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h * 0.2)}" rx="2" fill="#fff"/><path d="${line({ x: x + w * 0.22, y: y + h * 0.1 }, { x: x + w * 0.42, y: y + h * 0.1 })}" stroke="${xml(c)}"/><path d="${line({ x: x + w * 0.62, y: y + h * 0.1 }, { x: x + w * 0.82, y: y + h * 0.1 })}" stroke="${xml(c)}"/></g>`;
    return `<g data-addon="hurdle" ${attrs}>${bar}<path d="${line({ x: x + w * 0.12, y: y + h * 0.2 }, { x: x + w * 0.12, y: y + h })}"/><path d="${line({ x: x + w * 0.88, y: y + h * 0.2 }, { x: x + w * 0.88, y: y + h })}"/></g>`;
  }
  if (prop.type === "spear") return `<g data-addon="spear" ${attrs}><path d="${line({ x, y: y + h * 0.55 }, { x: x + w * 0.82, y: y + h * 0.45 })}" stroke="${xml(c)}" stroke-width="${num(strokeWidth * 0.8)}"/><path d="M${num(x + w * 0.82)} ${num(y + h * 0.45)}L${num(x + w)} ${num(y + h * 0.38)}L${num(x + w * 0.84)} ${num(y + h * 0.56)}Z" fill="#9aa0a6"/></g>`;
  if (prop.type === "card") return `<g data-addon="card" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2" fill="#fff"/><path d="${line({ x: x + w * 0.12, y: y + h * 0.18 }, { x: x + w * 0.88, y: y + h * 0.18 })}" stroke="${xml(c)}" stroke-width="${num(strokeWidth * 0.8)}"/><path d="${line({ x: x + w * 0.16, y: y + h * 0.48 }, { x: x + w * 0.74, y: y + h * 0.48 })}" stroke-width="${num(strokeWidth * 0.45)}"/><path d="${line({ x: x + w * 0.16, y: y + h * 0.68 }, { x: x + w * 0.58, y: y + h * 0.68 })}" stroke-width="${num(strokeWidth * 0.45)}"/></g>`;
  if (prop.type === "cone") return `<g data-addon="cone" ${attrs}><path d="M${num(x + w * 0.5)} ${num(y)}L${num(x + w * 0.88)} ${num(y + h * 0.86)}H${num(x + w * 0.12)}Z" fill="${xml(c)}"/><path d="${line({ x: x + w * 0.26, y: y + h * 0.56 }, { x: x + w * 0.74, y: y + h * 0.56 })}" stroke="#fff"/><path d="${line({ x: x, y: y + h }, { x: x + w, y: y + h })}"/></g>`;
  if (prop.type === "target") {
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
    return `<g data-addon="target" ${attrs}><circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${xml(c)}"/><circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r * 0.66)}" fill="#fff"/><circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r * 0.34)}" fill="${xml(c)}"/></g>`;
  }
  if (prop.type === "phone") {
    const rx = Math.min(w * 0.22, h * 0.13);
    return `<g data-addon="phone" stroke="${xml(color)}" stroke-width="${num(strokeWidth * 0.45)}" stroke-linecap="round" stroke-linejoin="round"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(rx)}" fill="${xml(c)}"/><rect x="${num(x + w * 0.18)}" y="${num(y + h * 0.14)}" width="${num(w * 0.64)}" height="${num(h * 0.72)}" rx="${num(rx * 0.45)}" fill="#dfe5ee" stroke="none"/><path d="${line({ x: x + w * 0.18, y: y + h * 0.12 }, { x: x + w * 0.82, y: y + h * 0.12 })}" stroke="#f8fafc" stroke-width="${num(strokeWidth * 0.3)}"/><circle cx="${num(x + w * 0.5)}" cy="${num(y + h * 0.93)}" r="${num(Math.max(0.45, w * 0.08))}" fill="#dfe5ee" stroke="none"/></g>`;
  }
  if (prop.type === "sign") {
    const stickLen = prop.stickLen ?? h * 1.125;
    const cx = x + w / 2;
    const text = String(prop.text ?? "").slice(0, 24);
    const fontSize = text ? Math.max(3, Math.min(h * 0.46, w / Math.max(1, text.length * 0.62))) : 0;
    const label = text ? `<text x="${num(cx)}" y="${num(y + h * 0.53)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${num(fontSize)}" fill="#202124" stroke="none">${xml(text)}</text>` : "";
    return `<g data-addon="sign" stroke="${xml(color)}" stroke-linecap="round" stroke-linejoin="round"><path d="${line({ x: cx, y: y + h }, { x: cx, y: y + h + stickLen })}" stroke="#8B5A2B" stroke-width="${num(Math.max(strokeWidth * 0.8, w * 0.08))}"/><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(Math.min(h * 0.14, 2))}" fill="${xml(c)}" stroke-width="${num(strokeWidth * 0.5)}"/>${label}</g>`;
  }
  if (prop.type === "sand-pit") {
    const outline = prop.color ? color : "#9b7b35";
    const grains = [
      [0.16, 0.32], [0.28, 0.62], [0.42, 0.42], [0.56, 0.72], [0.7, 0.34], [0.82, 0.58],
      [0.23, 0.82], [0.5, 0.25], [0.9, 0.78]
    ].map(([gx, gy]) => `<circle cx="${num(x + w * gx)}" cy="${num(y + h * gy)}" r="${num(Math.max(0.7, strokeWidth * 0.22))}" fill="#b89543" stroke="none"/>`).join("");
    return `<g data-addon="sand-pit" stroke="${xml(outline)}" stroke-width="${num(strokeWidth * 0.55)}" stroke-linecap="round" stroke-linejoin="round"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(Math.min(h * 0.25, 3))}" fill="${xml(c)}"/>${grains}</g>`;
  }
  if (prop.type === "board") {
    return `<g data-addon="board" stroke="${xml(color)}" stroke-width="${num(strokeWidth * 0.55)}" stroke-linecap="round" stroke-linejoin="round"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(Math.min(h * 0.18, 2))}" fill="#fff"/></g>`;
  }
  if (prop.type === "sand-puff") {
    const cx = x + w / 2, cy = y + h / 2;
    const dots = [
      [0, 0, 0.16], [-0.34, -0.18, 0.12], [0.34, -0.12, 0.11], [-0.22, 0.26, 0.1],
      [0.22, 0.26, 0.12], [-0.48, 0.1, 0.08], [0.48, 0.08, 0.08], [0.02, -0.42, 0.09]
    ].map(([dx, dy, rr]) => `<circle cx="${num(cx + w * dx)}" cy="${num(cy + h * dy)}" r="${num(Math.max(0.8, Math.min(w, h) * rr))}" fill="${xml(c)}" stroke="#b89543" stroke-width="${num(strokeWidth * 0.18)}"/>`).join("");
    return `<g data-addon="sand-puff">${dots}</g>`;
  }
  return null;
}

function bulbMarkup(prop, strokeWidth, color) {
  const s = Math.max(0, prop.scale ?? 1);
  if (s <= 0.01) return "";
  const cx = prop.x + prop.w / 2, cy = prop.y + prop.h * 0.4, w = prop.w * s, h = prop.h * s;
  const x = cx - w / 2, y = cy - h * 0.4;
  const sw = num(strokeWidth);
  const glassR = w * 0.32;
  const baseY = y + h * 0.63;
  const ray = (a, b) => `<path d="${line(a, b)}" fill="none" stroke="#F2B705" stroke-width="${num(strokeWidth * 0.75)}" stroke-linecap="round"/>`;
  return `<g data-prop="bulb" stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><circle cx="${num(cx)}" cy="${num(y + h * 0.34)}" r="${num(glassR)}" fill="#FFD43B"/><path d="M${num(cx - glassR * 0.48)} ${num(y + h * 0.52)}Q${num(cx)} ${num(y + h * 0.62)} ${num(cx + glassR * 0.48)} ${num(y + h * 0.52)}" fill="#FFD43B"/><path d="${line({ x: cx - w * 0.18, y: baseY }, { x: cx + w * 0.18, y: baseY })}" fill="none" stroke="#4a4a4a"/><path d="${line({ x: cx - w * 0.16, y: baseY + h * 0.1 }, { x: cx + w * 0.16, y: baseY + h * 0.1 })}" fill="none" stroke="#4a4a4a"/><path d="${line({ x: cx - w * 0.12, y: baseY + h * 0.2 }, { x: cx + w * 0.12, y: baseY + h * 0.2 })}" fill="none" stroke="#4a4a4a"/><path d="M${num(cx - w * 0.11)} ${num(y + h * 0.34)}Q${num(cx)} ${num(y + h * 0.45)} ${num(cx + w * 0.11)} ${num(y + h * 0.34)}" fill="none" stroke="${xml(color)}" stroke-width="${num(strokeWidth * 0.6)}"/>${ray({ x: cx, y: y - h * 0.08 }, { x: cx, y: y - h * 0.26 })}${ray({ x: x + w * 0.1, y: y + h * 0.16 }, { x: x - w * 0.08, y: y + h * 0.05 })}${ray({ x: x + w * 0.9, y: y + h * 0.16 }, { x: x + w * 1.08, y: y + h * 0.05 })}</g>`;
}

function officePropMarkup(prop, strokeWidth, color) {
  if (!officePropSize(prop.type)) return "";
  const { x, y, w, h } = prop;
  const c = xml(prop.color ?? ({ laptop: "#6675cc", tablet: "#259b91", magnifier: "#e2a532", notebook: "#cf647e", pen: "#4169c1" })[prop.type]);
  const sw = num(Math.min(strokeWidth, w * 0.055, h * 0.055));
  const attrs = `stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const p = (px, py) => ({ x: x + w * px, y: y + h * py });
  const path = (points) => points.map((pt, i) => `${i ? "L" : "M"}${num(pt.x)} ${num(pt.y)}`).join("") + "Z";
  const rect = (part, px, py, pw, ph, fill, rx = 0.03) => `<rect data-part="${part}" x="${num(x + w * px)}" y="${num(y + h * py)}" width="${num(w * pw)}" height="${num(h * ph)}" rx="${num(Math.min(w, h) * rx)}" fill="${fill}"/>`;
  let drawing = "";
  if (prop.type === "laptop") {
    const open = clamp01(prop.open ?? 0), hingeY = 0.76;
    const lidTop = hingeY - 0.04 - open * 0.7;
    const lid = path([p(0.08 + open * 0.05, lidTop), p(0.92 - open * 0.05, lidTop), p(0.92, hingeY), p(0.08, hingeY)]);
    const screen = open > 0.02 ? `<path data-part="laptop-screen" d="${path([p(0.18, lidTop + open * 0.08), p(0.82, lidTop + open * 0.08), p(0.84, hingeY - open * 0.08), p(0.16, hingeY - open * 0.08)])}" fill="#c8ecf6"/>` : "";
    const keys = open > 0.02 ? [0, 1, 2].map(row => `<path data-part="laptop-keyboard" d="${line(p(0.2 - row * 0.02, 0.8 + row * 0.045), p(0.8 + row * 0.02, 0.8 + row * 0.045))}" stroke="#e0e7fa"/>`).join("") : "";
    drawing = `<path data-part="laptop-base" d="${path([p(0.08, hingeY), p(0.92, hingeY), p(1, 0.97), p(0, 0.97)])}" fill="${c}"/>${keys}<path data-part="laptop-lid" d="${lid}" fill="${c}"/>${screen}<path data-part="laptop-hinge" d="${line(p(0.08, hingeY), p(0.92, hingeY))}" fill="none"/>`;
  } else if (prop.type === "tablet") {
    drawing = rect("tablet-bezel", 0, 0, 1, 1, c, 0.12) + rect("tablet-screen", 0.12, 0.1, 0.76, 0.78, "#c8ecf6", 0.04) +
      `<circle data-part="tablet-button" cx="${num(x + w * 0.5)}" cy="${num(y + h * 0.94)}" r="${num(w * 0.035)}" fill="#fff"/><path data-part="tablet-content" d="${line(p(0.24, 0.32), p(0.75, 0.32))}${line(p(0.24, 0.45), p(0.64, 0.45))}" fill="none" stroke="#5594b5"/>`;
  } else if (prop.type === "magnifier") {
    const center = p(0.4, 0.3), radius = Math.min(w * 0.34, h * 0.25);
    drawing = `<path data-part="magnifier-handle" d="${path([p(0.52, 0.51), p(0.64, 0.46), p(0.94, 0.92), p(0.8, 1)])}" fill="${c}"/><circle data-part="magnifier-ring" cx="${num(center.x)}" cy="${num(center.y)}" r="${num(radius * 0.885)}" fill="none" stroke="${c}" stroke-width="${num(radius * 0.23)}"/><circle data-part="magnifier-lens" cx="${num(center.x)}" cy="${num(center.y)}" r="${num(radius * 0.77)}" fill="#bdeaf6" fill-opacity="0.25"/><path data-part="magnifier-glint" d="${line(p(0.25, 0.23), p(0.35, 0.14))}" stroke="#fff"/>`;
  } else if (prop.type === "notebook") {
    const rules = [0.3, 0.44, 0.58, 0.72, 0.86].map(yy => `<path data-part="notebook-rule" d="${line(p(0.25, yy), p(0.84, yy))}" stroke="#a6bbd8"/>`).join("");
    const ink = [0, 1, 2, 3].map(i => {
      const t = clamp01(clamp01(prop.ink ?? 0) * 4 - i);
      if (!t) return "";
      const yy = 0.28 + i * 0.14;
      return `<path data-part="notebook-ink" d="${line(p(0.28, yy), p(0.28 + (i % 2 ? 0.38 : 0.5) * t, yy))}" stroke="#334d87"/>`;
    }).join("");
    drawing = rect("notebook-cover", 0, 0, 1, 1, c, 0.05) +
      `<path data-part="notebook-pages" d="${path([p(0.16, 0.05), p(0.91, 0.05), p(0.96, 0.13), p(0.96, 0.94), p(0.16, 0.94)])}" fill="#fff9ed"/><path data-part="notebook-fold" d="${line(p(0.91, 0.05), p(0.91, 0.13))}${line(p(0.91, 0.13), p(0.96, 0.13))}" fill="none"/>${rules}${ink}` +
      [0.2, 0.4, 0.6, 0.8].map(yy => `<path data-part="notebook-binding" d="${line(p(0.05, yy), p(0.2, yy))}" stroke="#555e70"/>`).join("");
  } else if (prop.type === "pen") {
    drawing = `<path data-part="pen-body" d="${path([p(0.16, 0.08), p(0.84, 0.08), p(0.84, 0.78), p(0.16, 0.78)])}" fill="${c}"/><path data-part="pen-nib" d="${path([p(0.16, 0.78), p(0.84, 0.78), p(0.5, 1)])}" fill="#e3c591"/><path data-part="pen-tip" d="${line(p(0.5, 0.94), p(0.5, 1))}" stroke="#202124"/><path data-part="pen-clip" d="${line(p(0.76, 0.12), p(0.76, 0.35))}" stroke="#e0e7fa"/>`;
  }
  return `<g data-${prop.addon ? "addon" : "prop"}="${prop.type}" ${attrs}>${drawing}</g>`;
}

function propMarkup(prop, strokeWidth, color) {
  if (!prop) return "";
  const office = officePropMarkup(prop, strokeWidth, color);
  if (office) return office;
  const sw = num(strokeWidth);
  const attrs = `fill="#fff" stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const x = prop.x, y = prop.y, w = prop.w, h = prop.h;
  const addOn = prop.addon ? addonMarkup(prop, strokeWidth, color) : null;
  if (addOn) return addOn;
  if (prop.type === "ball") return `<circle data-prop="ball" cx="${num(x + w / 2)}" cy="${num(y + h / 2)}" r="${num(w / 2)}" ${attrs}/>`;
  if (prop.type === "ladder") {
    const ladderAttrs = `fill="none" stroke="${xml(prop.color ?? color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
    const rungs = prop.rungs ?? 7;
    const rung = Array.from({ length: rungs }, (_, i) => {
      const yy = y + h * (i + 1) / (rungs + 1);
      return `<path d="${line({ x: x + w * 0.16, y: yy }, { x: x + w * 0.84, y: yy })}"/>`;
    }).join("");
    return `<g data-prop="ladder" ${ladderAttrs}><path d="${line({ x: x + w * 0.14, y }, { x: x + w * 0.14, y: y + h })}"/><path d="${line({ x: x + w * 0.86, y }, { x: x + w * 0.86, y: y + h })}"/>${rung}</g>`;
  }
  if (prop.type === "box" && prop.color) return `<rect data-prop="box" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="3" fill="${xml(prop.color)}" stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (prop.type === "chair") return `<g data-prop="chair" ${attrs}><path d="M${num(x + w * 0.2)} ${num(y)}L${num(x + w * 0.2)} ${num(y + h * 0.58)}L${num(x + w * 0.82)} ${num(y + h * 0.58)}"/><path d="M${num(x + w * 0.28)} ${num(y + h * 0.58)}L${num(x + w * 0.18)} ${num(y + h)}"/><path d="M${num(x + w * 0.76)} ${num(y + h * 0.58)}L${num(x + w * 0.88)} ${num(y + h)}"/></g>`;
  if (prop.type === "platform" || prop.type === "ledge") return `<rect data-prop="${prop.type}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="3" ${attrs}/>`;
  if (prop.type === "stairs") {
    const steps = prop.steps ?? 4;
    const d = Array.from({ length: steps }, (_, i) => `H${num(x + w * (i + 1) / steps)}V${num(y + h * (1 - (i + 1) / steps))}`).join("");
    return `<path data-prop="stairs" d="M${num(x)} ${num(y + h)}${d}" ${attrs}/>`;
  }
  if (prop.type === "desk") {
    // Desk with a monitor (screen lines) and a keyboard on the front edge; x..x+w is the tabletop.
    const top = y + h * 0.42, mw = prop.monitorW ?? w * 0.56, mh = prop.monitorH ?? h * 0.46, mx = x + w * 0.42, my = top - h * 0.1 - mh;
    return `<g data-prop="desk" ${attrs}><path d="${line({ x, y: top }, { x: x + w, y: top })}"/><path d="${line({ x: x + w * 0.08, y: top }, { x: x + w * 0.08, y: y + h })}"/><path d="${line({ x: x + w * 0.92, y: top }, { x: x + w * 0.92, y: y + h })}"/><rect x="${num(mx)}" y="${num(my)}" width="${num(mw)}" height="${num(mh)}" rx="2"/><path d="${line({ x: mx + mw / 2, y: my + mh }, { x: mx + mw / 2, y: top })}"/><path d="${line({ x: mx + mw * 0.15, y: my + mh * 0.3 }, { x: mx + mw * 0.7, y: my + mh * 0.3 })}" stroke-width="${num(strokeWidth * 0.5)}"/><path d="${line({ x: mx + mw * 0.15, y: my + mh * 0.55 }, { x: mx + mw * 0.55, y: my + mh * 0.55 })}" stroke-width="${num(strokeWidth * 0.5)}"/><path d="${line({ x: x + w * 0.04, y: top - strokeWidth }, { x: x + w * 0.38, y: top - strokeWidth })}"/></g>`;
  }
  if (prop.type === "board") {
    const bh = h * 0.62;
    return `<g data-prop="board" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(bh)}" rx="2"/>${boardInkMarkup(prop, strokeWidth, color)}<path d="${line({ x: x + w * 0.2, y: y + bh }, { x: x + w * 0.12, y: y + h })}"/><path d="${line({ x: x + w * 0.8, y: y + bh }, { x: x + w * 0.88, y: y + h })}"/><path d="${line({ x: x + w * 0.25, y: y + bh + strokeWidth }, { x: x + w * 0.75, y: y + bh + strokeWidth })}"/></g>`;
  }
  if (prop.type === "card") return `<g data-prop="card" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2"/><path d="${line({ x: x + w * 0.15, y: y + h * 0.35 }, { x: x + w * 0.8, y: y + h * 0.35 })}" stroke-width="${num(strokeWidth * 0.5)}"/><path d="${line({ x: x + w * 0.15, y: y + h * 0.62 }, { x: x + w * 0.6, y: y + h * 0.62 })}" stroke-width="${num(strokeWidth * 0.5)}"/></g>`;
  if (prop.type === "bulb") return bulbMarkup(prop, strokeWidth, color);
  if (prop.type === "binoculars") return binocularsMarkup(prop, strokeWidth, color);
  if (prop.type === "palm") return palmMarkup(prop, strokeWidth, color);
  if (prop.type === "thumb") return thumbMarkup(prop, strokeWidth, color);
  if (prop.type === "glasses") return glassesMarkup(prop, strokeWidth, color);
  if (prop.type === "watch") return watchMarkup(prop, strokeWidth, color);
  if (prop.type === "glove") return gloveMarkup(prop, strokeWidth, color);
  if (prop.type === "banner") return `<g data-prop="banner" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2"/><path d="${line({ x: x + w * 0.12, y: y + h * 0.45 }, { x: x + w * 0.88, y: y + h * 0.45 })}"/><path d="${line({ x: x + w * 0.2, y: y + h * 0.7 }, { x: x + w * 0.7, y: y + h * 0.7 })}" stroke-width="${num(strokeWidth * 0.5)}"/></g>`;
  if (prop.type === "door") return doorMarkup(prop, strokeWidth, color);
  if (prop.type === "sign") return `<g data-prop="sign" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h * 0.55)}" rx="3"/><path d="${line({ x: x + w / 2, y: y + h * 0.55 }, { x: x + w / 2, y: y + h })}"/></g>`;
  return `<rect data-prop="${xml(prop.type)}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="3" ${attrs}/>`;
}

export function figureMarkup(frame, geometry, color = "#202124", opacity = 1) {
  const limbById = new Map(geometry.limbs.map((limb) => [limb.id, limb]));
  const detailById = new Map(geometry.paths.map((item) => [item.id, item]));
  const footForSide = (side) => {
    const foot = detailById.get(`${side}-foot`);
    return foot ? `<path id="${foot.id}" d="${foot.d}"/>` : "";
  };
  const limb = (id) => {
    const item = limbById.get(id);
    const foot = item.kind === "leg" ? footForSide(id.startsWith("left") ? "left" : "right") : "";
    return `<path id="${item.id}" d="${item.d}"/>${foot}`;
  };
  return `<g data-stickman="exact-pivot" fill="none" stroke="${xml(color)}" stroke-width="${num(geometry.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" opacity="${num(opacity)}">${limb(geometry.segmentOrder[0])}${limb(geometry.segmentOrder[1])}<path id="torso" d="${detailById.get("torso").d}"/><circle id="head" cx="${num(geometry.head.x)}" cy="${num(geometry.head.y)}" r="${num(geometry.headRadius)}" fill="#fff" stroke="${xml(color)}" stroke-width="${num(geometry.strokeWidth)}"/>${limb(geometry.segmentOrder[3])}${limb(geometry.segmentOrder[4])}${detailById.get("point-finger") ? `<path id="point-finger" d="${detailById.get("point-finger").d}"/>` : ""}</g>`;
}

function doorClipsFigure(door, frameIndex) {
  return Boolean(door && door.type === "door" && door.clipFigureFrom !== undefined && frameIndex >= door.clipFigureFrom && (door.clipFigureUntil === undefined || frameIndex < door.clipFigureUntil));
}

function figureMarkupWithDoorClip(frame, geometry, door, frameIndex, color = "#202124") {
  if (!doorClipsFigure(door, frameIndex)) return figureMarkup(frame, geometry, color, 1);
  if (door.open <= 0.02 && (door.opacity ?? 1) < 0.999) return "";
  const id = `door-figure-clip-${frameIndex}`;
  return `<defs><clipPath id="${id}"><rect x="${num(door.x)}" y="${num(door.y)}" width="${num(door.w)}" height="${num(door.h)}"/></clipPath></defs><g clip-path="url(#${id})">${figureMarkup(frame, geometry, color, 1)}</g>`;
}

/**
 * All props for a review frame: the main prop (optionally carried by a hand via review.prop.attach =
 * {hand:"r"|"l", from, to, dx, dy, hiddenBefore, hiddenAfter}) plus static review.extraProps [{type,x,y,w,h}].
 * Office props accept color, rot (degrees), scale, fade, enter/exit; laptop.open and notebook.ink
 * are 0..1, sampled via review.propMotion (extraProps use their own propMotion; addons use keys).
 * Defaults in local units: laptop 48x34, tablet 22x30, magnifier 24x34, notebook 30x36, pen 4x22.
 * Attachments grip magnifier at (.76w,.83h), pen at (.5w,.42h), others at center.
 * Pen nib follows the forearm with rot as an additional offset; transforms pivot on the grip.
 * handAt(frame, side) returns the world-space hand point; it is only needed for attached props.
 */
function layoutScene(spec, propsCatalog, frameIndex, handAt, stage = { rootX: 160, groundY: 150, scale: 0.75 }) {
  const out = [];
  const pointAt = handAt;
  const applyLifecycle = (item, descriptor) => {
    const state = addonLifecycleState(descriptor, frameIndex, stage);
    if (!state.visible) return null;
    item.x += state.dx;
    item.y += state.dy;
    item.opacity = (item.opacity ?? 1) * state.opacity;
    item.drawScale = (item.drawScale ?? 1) * state.scale;
    item.rot = (item.rot ?? 0) + state.rot;
    item.puff = state.puff;
    item.tipPivot = state.tip;
    return item;
  };
  const placeAttached = (main, attach) => {
    if (!main || !attach || !handAt) return main;
    const from = attach.from ?? 0, to = attach.to ?? attach.until ?? Infinity;
    if (!(frameIndex < from && attach.hiddenBefore) && !(frameIndex > to && attach.hiddenAfter)) {
      if (frameIndex >= from) {
        const ix = Math.min(frameIndex, to);
        const target = attach.hand;
        const point = target === "both"
          ? (() => { const l = pointAt(ix, "left-hand"), r = pointAt(ix, "right-hand"); return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, facing: r.facing ?? l.facing }; })()
          : pointAt(ix, target === "head" ? "head" : target === "l" ? "left-hand" : target === "r" ? "right-hand" : target);
        const offsetDir = target === "head" ? (Math.sign(point.facing ?? 1) || 1) : 1;
        if (officePropSize(main.type)) attachOfficeProp(main, point, { ...attach, dx: (attach.dx ?? 0) * offsetDir }, stage);
        else {
          main.x = point.x - main.w / 2 + (attach.dx ?? 0) * stage.scale * offsetDir;
          main.y = point.y - main.h / 2 - (attach.dy ?? 0) * stage.scale;
        }
        if (point.facing !== undefined) main.facing = point.facing;
        if (point.angle !== undefined) main.angle = point.angle;
        main.front = true;
      }
      return main;
    }
    return null;
  };
  const main = layoutProp(spec, propsCatalog, frameIndex, stage);
  const placedMain = placeAttached(main, spec.review?.prop?.attach);
  const lifeMain = placedMain ? applyLifecycle(placedMain, spec.review?.prop ?? {}) : null;
  if (lifeMain) out.push(lifeMain);
  for (const extra of spec.review?.extraProps ?? []) {
    const p = layoutProp({ prop: extra.type, review: { prop: extra, ...(officePropSize(extra.type) ? { propMotion: extra.propMotion } : {}) } }, propsCatalog, frameIndex, stage);
    const placed = placeAttached(p, extra.attach);
    const life = placed ? applyLifecycle(placed, extra) : null;
    if (life) out.push(life);
  }
  const addonDefs = spec.review?.addons ?? [];
  for (const addon of addonDefs) {
    const p = layoutAddon(addon, frameIndex, pointAt, addonDefs, stage);
    if (p) out.push(p);
  }
  return out;
}

function addonDefaultSize(type) {
  if (officePropSize(type)) return officePropSize(type);
  return ({
    ball: { w: 10, h: 10 }, football: { w: 14, h: 14 }, basketball: { w: 14, h: 14 }, goal: { w: 46, h: 34 }, hoop: { w: 32, h: 38 },
    hurdle: { w: 34, h: 22 }, spear: { w: 48, h: 6 }, card: { w: 24, h: 16 }, cone: { w: 14, h: 18 }, target: { w: 24, h: 24 },
    "sand-pit": { w: 82, h: 16 }, board: { w: 28, h: 5 }, "sand-puff": { w: 24, h: 16 }, phone: { w: 4, h: 7 }, sign: { w: 26, h: 16 }
  })[type] ?? { w: 16, h: 16 };
}

function layoutAddonRaw(addon, frameIndex, stage = REVIEW_STAGE) {
  if (officePropSize(addon.type)) return { ...layoutProp({ prop: addon.type, review: { prop: { ...addon, x: addon.x ?? 0 }, propMotion: addon.keys } }, { props: [] }, frameIndex, stage), addon: true };
  const size = addonDefaultSize(addon.type);
  const wLocal = addon.w ?? size.w, hLocal = addon.h ?? size.h;
  const key = interpAddonKeys(addon.keys, frameIndex);
  const k = stage.scale;
  const xLocal = (addon.x ?? 0) + (key.x ?? 0);
  const yLocal = (addon.y ?? 0) + (key.y ?? 0);
  return {
    id: addon.id, type: addon.type, addon: true, color: addon.color, text: addon.text, w: wLocal * k, h: hLocal * k,
    x: stage.rootX + xLocal * k,
    y: stage.groundY - (yLocal + hLocal) * k,
    stickLen: addon.type === "sign" ? (addon.stickLen ?? 18) * k : undefined,
    gripOffset: addon.type === "sign" ? (addon.gripOffset ?? 4) * k : undefined,
    rot: key.rot ?? 0,
    drawScale: key.scale ?? 1,
    enter: addon.enter,
    exit: addon.exit,
    react: addon.react,
    flight: addon.flight,
    attach: addon.attach
  };
}

function addonCenter(prop) {
  return { x: prop.x + prop.w / 2, y: prop.y + prop.h / 2 };
}

function addonTargetCenter(prop) {
  if (prop.type === "goal") return { x: prop.x + prop.w * 0.52, y: prop.y + prop.h * 0.6 };
  if (prop.type === "hoop") return { x: prop.x + prop.w * 0.7, y: prop.y + prop.h * 0.48 };
  return addonCenter(prop);
}

function layoutAddon(addon, frameIndex, pointAt, addonDefs, stage = REVIEW_STAGE, opts = {}) {
  let p = layoutAddonRaw(addon, frameIndex, stage);
  const activeAttach = (addon.attach ?? []).find((a) => frameIndex >= (a.from ?? 0) && frameIndex <= (a.until ?? (officePropSize(addon.type) && typeof a.to === "string" ? Infinity : a.to) ?? Infinity));
  if (activeAttach && pointAt) {
    const pt = pointAt(frameIndex, activeAttach.to);
    if (officePropSize(p.type)) attachOfficeProp(p, pt, activeAttach, stage);
    else {
      p.x = pt.x - p.w / 2 + (activeAttach.dx ?? 0) * stage.scale;
      p.y = p.type === "sign"
        ? pt.y - (p.h + (p.stickLen ?? 0) - (p.gripOffset ?? 0)) - (activeAttach.dy ?? 0) * stage.scale
        : pt.y - p.h / 2 - (activeAttach.dy ?? 0) * stage.scale;
      if (pt.angle !== undefined && p.type !== "sign") p.rot += pt.angle * 180 / Math.PI;
    }
    p.front = true;
  }
  if (addon.flight && frameIndex >= (addon.flight.from ?? 0) && !opts.skipFlight) {
    const start = addonCenter(layoutAddon(addon, addon.flight.from ?? 0, pointAt, addonDefs, stage, { skipFlight: true }) ?? p);
    let end;
    if (typeof addon.flight.target === "string") {
      const targetDef = addonDefs.find((item) => item.id === addon.flight.target);
      end = targetDef ? addonTargetCenter(layoutAddonRaw(targetDef, addon.flight.to ?? frameIndex, stage)) : start;
    } else if (addon.flight.target && Number.isFinite(addon.flight.target.x)) {
      end = { x: stage.rootX + addon.flight.target.x * stage.scale, y: stage.groundY - (addon.flight.target.y ?? 0) * stage.scale };
    } else {
      end = { x: start.x + 70 * stage.scale, y: stage.groundY - p.h / 2 };
    }
    const fp = computeAddonFlightPoint(start, end, addon.flight, frameIndex, stage);
    p.x = fp.x - p.w / 2;
    p.y = frameIndex > (addon.flight.to ?? addon.flight.from ?? 0) && !addon.flight.target ? stage.groundY - p.h : fp.y - p.h / 2;
    p.rot += fp.rot;
  }
  if (addon.react && frameIndex >= (addon.react.frame ?? 0) && frameIndex < (addon.react.frame ?? 0) + Math.max(1, addon.react.dur ?? 1)) {
    p.reactStyle = addon.react.style;
    p.reactT = clamp01((frameIndex - (addon.react.frame ?? 0)) / Math.max(1, addon.react.dur ?? 1));
    if (addon.react.style === "wobble") p.x += Math.sin(p.reactT * Math.PI * 6) * stage.scale * 2;
  }
  const life = addonLifecycleState(addon, frameIndex, stage);
  if (!life.visible) return null;
  p.x += life.dx;
  p.y += life.dy;
  p.opacity = (p.opacity ?? 1) * life.opacity;
  p.drawScale *= life.scale;
  p.rot += life.rot;
  p.puff = life.puff;
  p.tipPivot = life.tip;
  return p;
}

function pointFromSample(sample, target) {
  if (target === "head") return { x: sample.head.x, y: sample.head.y, facing: sample.facing ?? 1 };
  const normalized = target === "left" || target === "l" || target === "left-hand" ? "left-hand"
    : target === "right" || target === "r" || target === "right-hand" ? "right-hand"
    : target;
  const side = normalized?.startsWith("left") ? "left" : "right";
  if (normalized?.endsWith("foot")) {
    const shin = sample.segments.find((s) => s.id === `${side}-shin`);
    return { x: shin.x2, y: shin.y2, facing: sample.facing ?? 1, angle: Math.atan2(shin.y2 - shin.y1, shin.x2 - shin.x1) };
  }
  const fore = sample.segments.find((s) => s.id === `${side}-forearm`);
  return { x: fore.x2, y: fore.y2, facing: sample.facing ?? 1, angle: Math.atan2(fore.y2 - fore.y1, fore.x2 - fore.x1) };
}

function handFromSample(sample, side) {
  return pointFromSample(sample, side === "left" ? "left-hand" : side === "right" ? "right-hand" : side);
}

function viewBoxFor(sample) {
  // Camera locks to the root so static props never appear to move when the body sways.
  const cx = Number.isFinite(sample.x) ? sample.x : 160;
  return `${num(cx - 160)} -54 320 224`;
}

function scenePropMarkup(prop, strokeWidth, color, layer = "all") {
  const stroke = color;
  const markup = prop.type === "door" ? doorMarkup(prop, strokeWidth, stroke, layer) : propMarkup(prop, strokeWidth, stroke);
  return wrapPropMarkup(prop, markup);
}

export async function renderStaticSvg({ clip, spec, propsCatalog, frameIndex = 0, onion = false, width = 1000, height = 700 }) {
  const { frameGeometry, sampleClipMotion } = await loadEngineRenderer();
  const sample = engineSampledFrame(sampleClipMotion, clip, frameIndex);
  const geometry = frameGeometry(sample);
  const onionFrames = onion ? [-6, -3, 3, 6].map((delta) => frameIndex + delta).filter((ix) => ix >= 0 && ix < clip.frames.length) : [];
  const onionMarkup = onionFrames.map((ix) => {
    const f = engineSampledFrame(sampleClipMotion, clip, ix);
    return figureMarkup(f, frameGeometry(f), "#202124", 0.18);
  }).join("");
  const handAt = (ix, side) => pointFromSample(engineSampledFrame(sampleClipMotion, clip, ix), side);
  const props = layoutScene(spec, propsCatalog, frameIndex, handAt);
  const clipDoor = props.find((p) => doorClipsFigure(p, frameIndex));
  const back = props.filter((p) => !p.front).map((p) => scenePropMarkup(p, geometry.strokeWidth, "#202124", p.type === "door" ? (clipDoor === p ? "back-opening" : "back") : "all")).join("");
  const front = props.map((p) => p.type === "door" ? `${clipDoor === p ? scenePropMarkup(p, geometry.strokeWidth, "#202124", "front-leaf") : ""}${scenePropMarkup(p, geometry.strokeWidth, "#202124", "front")}` : p.front ? scenePropMarkup(p, geometry.strokeWidth, "#202124") : "").join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBoxFor(sample)}" role="img" aria-label="${xml(clip.name)} frame ${frameIndex}"><rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff"/><path id="ground" d="M-10000 ${num(sample.groundY)}H10000" stroke="#d8dbe0" stroke-width="1"/>${back}${onionMarkup}${figureMarkupWithDoorClip(sample, geometry, clipDoor, frameIndex, "#202124")}${front}<text x="${num(Number(viewBoxFor(sample).split(" ")[0]) + 6)}" y="-42" font-size="9" fill="#888">${xml(clip.name)} f${frameIndex}</text></svg>`;
}

/** The approved run exactly as the product ships it: a compiled scene (root motion, planted feet) sampled at 30 fps. */
export async function shippingRunFrames() {
  const { compileAnimation, sampleAnimation, CONTRACT_VERSION } = await loadEngineRenderer();
  const durationMs = 2600, groundY = 640;
  const result = compileAnimation({
    version: CONTRACT_VERSION, canvas: { width: 1600, height: 800, fps: 30 }, durationMs,
    actor: { x: 280, groundY }, targets: { travel: { x: 1320, y: groundY } },
    actions: [{ action: "run", startMs: 0, durationMs, target: "travel" }]
  });
  if (!result.program) throw new Error(`Reference run failed to compile: ${JSON.stringify(result.errors ?? result)}`);
  const frames = [];
  for (let t = 0; t <= durationMs; t += 1000 / 30) frames.push(sampleAnimation(result.program, t));
  return frames;
}

/** Browser-side source of the shipping engine sampler + figure/prop drawing, for self-contained pages (demo decks). */
export async function stageKitSource() {
  const { frameGeometry, sampleMotionClip, sampleClipMotion } = await loadEngineRenderer();
  return `const REVIEW_STAGE=${JSON.stringify(REVIEW_STAGE)};
const ENGINE_FRAME_GEOMETRY=${frameGeometry.toString()};
${sampleMotionClip.toString()}
${sampleClipMotion.toString()}
const engineSampledFrame=${engineSampledFrame.toString()};
const figureMarkup=${figureMarkup.toString()};
const doorClipsFigure=${doorClipsFigure.toString()};
const figureMarkupWithDoorClip=${figureMarkupWithDoorClip.toString()};
const layoutProp=${layoutProp.toString()};
const officePropSize=${officePropSize.toString()};
const officePropAnchor=${officePropAnchor.toString()};
const attachOfficeProp=${attachOfficeProp.toString()};
const officePropMarkup=${officePropMarkup.toString()};
const ADDON_TYPES=new Set(${JSON.stringify([...ADDON_TYPES])});
const clamp01=${clamp01.toString()};
const lerp=${lerp.toString()};
const addonLifecycleState=${addonLifecycleState.toString()};
const interpAddonKeys=${interpAddonKeys.toString()};
const computeAddonFlightPoint=${computeAddonFlightPoint.toString()};
const doorGeometry=${doorGeometry.toString()};
const doorMarkup=${doorMarkup.toString()};
const partialPolyline=${partialPolyline.toString()};
const boardInkMarkup=${boardInkMarkup.toString()};
const binocularsMarkup=${binocularsMarkup.toString()};
const palmMarkup=${palmMarkup.toString()};
const thumbMarkup=${thumbMarkup.toString()};
const glassesMarkup=${glassesMarkup.toString()};
const watchMarkup=${watchMarkup.toString()};
const gloveMarkup=${gloveMarkup.toString()};
const wrapPropMarkup=${wrapPropMarkup.toString()};
const puffMarkup=${puffMarkup.toString()};
const addonColor=${addonColor.toString()};
const addonMarkup=${addonMarkup.toString()};
const bulbMarkup=${bulbMarkup.toString()};
const layoutScene=${layoutScene.toString()};
const addonDefaultSize=${addonDefaultSize.toString()};
const layoutAddonRaw=${layoutAddonRaw.toString()};
const addonCenter=${addonCenter.toString()};
const addonTargetCenter=${addonTargetCenter.toString()};
const layoutAddon=${layoutAddon.toString()};
const pointFromSample=${pointFromSample.toString()};
const handFromSample=${handFromSample.toString()};
const scenePropMarkup=${scenePropMarkup.toString()};
const propMarkup=${propMarkup.toString()};
const xml=${xml.toString()}; const num=${num.toString()}; const line=${line.toString()};`;
}

export async function renderReviewHtml({ clip, spec, report, propsCatalog }) {
  const { frameGeometry, sampleMotionClip, sampleClipMotion } = await loadEngineRenderer();
  const runFrames = await shippingRunFrames();
  const data = JSON.stringify({ clip, spec, report, runFrames, propsCatalog }).replaceAll("<", "\\u003c");
  return `<!doctype html><html><meta charset="utf-8"><title>${xml(clip.name)} motion review</title><script>
(() => {
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  const theme = param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();
</script><style>
:root {
  color-scheme: light;
  --cp-bg: #f7f4ef;
  --cp-bg-elevated: #fcfbf8;
  --cp-surface: #ffffff;
  --cp-surface-soft: #f5f5f5;
  --cp-border: #dedede;
  --cp-border-strong: #919191;
  --cp-text: #242424;
  --cp-text-muted: #5c5c5c;
  --cp-text-soft: #6f6f6f;
  --cp-accent: #b11f4b;
  --cp-accent-hover: #9a1a41;
  --cp-accent-soft: rgba(177, 31, 75, 0.08);
  --cp-accent-fg: #ffffff;
  --cp-success: #16a34a;
  --cp-danger: #dc2626;
  --cp-warning: #f59e0b;
  --cp-link: #0078d4;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  --cp-overlay: rgba(255, 255, 255, 0.8);
  --cp-panel: rgba(255, 255, 255, 0.86);
  --cp-panel-strong: rgba(255, 255, 255, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.55);
  --cp-highlight: rgba(177, 31, 75, 0.12);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --cp-bg: #3d3b3a;
  --cp-bg-elevated: #343231;
  --cp-surface: #292929;
  --cp-surface-soft: #2e2e2e;
  --cp-border: #474747;
  --cp-border-strong: #5f5f5f;
  --cp-text: #dedede;
  --cp-text-muted: #919191;
  --cp-text-soft: #b0b0b0;
  --cp-accent: #fd8ea1;
  --cp-accent-hover: #fb7b91;
  --cp-accent-soft: rgba(253, 142, 161, 0.14);
  --cp-accent-fg: #1a1a1a;
  --cp-success: #4ade80;
  --cp-danger: #f87171;
  --cp-warning: #fbbf24;
  --cp-link: #4da6ff;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  --cp-overlay: rgba(41, 41, 41, 0.88);
  --cp-panel: rgba(41, 41, 41, 0.72);
  --cp-panel-strong: rgba(41, 41, 41, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.04);
  --cp-highlight: rgba(253, 142, 161, 0.12);
}
body{font:14px "Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif;margin:0;background:var(--cp-bg);color:var(--cp-text)}.bar{position:sticky;top:0;background:var(--cp-surface);border-bottom:1px solid var(--cp-border);padding:12px;z-index:3}.bare .bar,.bare h3,.bare .film{display:none}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}.bare main{display:block;padding:0}.panel{background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:16px;padding:12px}.bare .panel{border:0;border-radius:0;padding:0}svg.stage{width:100%;height:440px}.bare svg.stage{width:100vw;height:100vh}.film{display:grid;grid-template-columns:repeat(8,1fr);gap:8px}.film svg{height:90px;background:var(--cp-surface-soft);border-radius:10px}button,select,input{vertical-align:middle;accent-color:var(--cp-accent)}button,select{background:var(--cp-surface-soft);color:var(--cp-text);border:1px solid var(--cp-border);border-radius:10px;padding:4px 8px}</style><body><div class="bar"><b>${xml(clip.name)}</b> <button id="play">pause</button> speed <select id="speed"><option value=".1">0.1x</option><option value=".25">0.25x</option><option value=".5">0.5x</option><option value="1" selected>1x</option></select> onion <input id="onion" type="checkbox"> frame <input id="scrub" type="range" min="0" max="${clip.frames.length - 1}" value="0"> <span id="frameNo">0</span></div><main><section class="panel"><h3>Candidate (shipping engine)</h3><svg id="stage" class="stage"></svg><div id="film" class="film"></div></section><section class="panel" id="refPanel"><h3>Approved run (shipping engine)</h3><svg id="ref" class="stage"></svg></section></main><script id="data" type="application/json">${data}</script><script>
const REVIEW_STAGE=${JSON.stringify(REVIEW_STAGE)};
const ENGINE_FRAME_GEOMETRY=${frameGeometry.toString()};
${sampleMotionClip.toString()}
${sampleClipMotion.toString()}
const engineSampledFrame=${engineSampledFrame.toString()};
const figureMarkup=${figureMarkup.toString()};
const figureMarkupWithDoorClip=${figureMarkupWithDoorClip.toString()};
const layoutProp=${layoutProp.toString()};
const officePropSize=${officePropSize.toString()};
const officePropAnchor=${officePropAnchor.toString()};
const attachOfficeProp=${attachOfficeProp.toString()};
const officePropMarkup=${officePropMarkup.toString()};
const ADDON_TYPES=new Set(${JSON.stringify([...ADDON_TYPES])});
const clamp01=${clamp01.toString()};
const lerp=${lerp.toString()};
const addonLifecycleState=${addonLifecycleState.toString()};
const interpAddonKeys=${interpAddonKeys.toString()};
const computeAddonFlightPoint=${computeAddonFlightPoint.toString()};
const doorGeometry=${doorGeometry.toString()};
const doorMarkup=${doorMarkup.toString()};
const partialPolyline=${partialPolyline.toString()};
const boardInkMarkup=${boardInkMarkup.toString()};
const binocularsMarkup=${binocularsMarkup.toString()};
const palmMarkup=${palmMarkup.toString()};
const thumbMarkup=${thumbMarkup.toString()};
const glassesMarkup=${glassesMarkup.toString()};
const watchMarkup=${watchMarkup.toString()};
const gloveMarkup=${gloveMarkup.toString()};
const wrapPropMarkup=${wrapPropMarkup.toString()};
const puffMarkup=${puffMarkup.toString()};
const addonColor=${addonColor.toString()};
const addonMarkup=${addonMarkup.toString()};
const bulbMarkup=${bulbMarkup.toString()};
const layoutScene=${layoutScene.toString()};
const addonDefaultSize=${addonDefaultSize.toString()};
const layoutAddonRaw=${layoutAddonRaw.toString()};
const addonCenter=${addonCenter.toString()};
const addonTargetCenter=${addonTargetCenter.toString()};
const layoutAddon=${layoutAddon.toString()};
const pointFromSample=${pointFromSample.toString()};
const handFromSample=${handFromSample.toString()};
const scenePropMarkup=${scenePropMarkup.toString()};
const propMarkup=${propMarkup.toString()};
const viewBoxFor=${viewBoxFor.toString()};
const xml=${xml.toString()}; const num=${num.toString()}; const line=${line.toString()};
const D=JSON.parse(document.getElementById('data').textContent),clip=D.clip,runFrames=D.runFrames,spec=D.spec,propsCatalog=D.propsCatalog; let f=0,playing=true,last=performance.now();
function drawRef(){const s=runFrames[Math.floor(performance.now()/1000*30)%runFrames.length],g=ENGINE_FRAME_GEOMETRY(s);ref.setAttribute('viewBox','200 '+num(s.groundY-260)+' 1200 330');ref.innerHTML='<rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff"/><path d="M-10000 '+num(s.groundY)+'H10000" stroke="#d8dbe0"/>'+figureMarkup(s,g);}
const params=new URLSearchParams(location.search); if(params.get('bare')==='1')document.body.classList.add('bare'); if(params.has('onion'))onion.checked=params.get('onion')!=='0'; if(params.has('frame')){f=Number(params.get('frame'))||0;playing=false;play.textContent='play';scrub.value=Math.max(0,Math.min(clip.frames.length-1,Math.round(f)));}
const doorClipsFigure=${doorClipsFigure.toString()};
function drawSvg(svg,c,ix,onionMode,withProp){const sample=engineSampledFrame(sampleClipMotion,c,ix),g=ENGINE_FRAME_GEOMETRY(sample);svg.setAttribute('viewBox',viewBoxFor(sample));let h='<rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff"/><path d="M-10000 '+num(sample.groundY)+'H10000" stroke="#d8dbe0"/>';const scene=withProp?layoutScene(spec,propsCatalog,ix,(j,side)=>pointFromSample(engineSampledFrame(sampleClipMotion,c,j),side)):[];const clipDoor=scene.find(p=>doorClipsFigure(p,ix));for(const p of scene)if(!p.front)h+=scenePropMarkup(p,g.strokeWidth,'#202124',p.type==='door'?(clipDoor===p?'back-opening':'back'):'all');if(onionMode){for(const d of [-6,-3,3,6]){const oi=ix+d;if(oi>=0&&oi<c.frames.length){const os=engineSampledFrame(sampleClipMotion,c,oi);h+=figureMarkup(os,ENGINE_FRAME_GEOMETRY(os),'#202124',.18);}}}h+=figureMarkupWithDoorClip(sample,g,clipDoor,ix,'#202124');for(const p of scene)h+=p.type==='door'?((clipDoor===p?scenePropMarkup(p,g.strokeWidth,'#202124','front-leaf'):'')+scenePropMarkup(p,g.strokeWidth,'#202124','front')):(p.front?scenePropMarkup(p,g.strokeWidth,'#202124'):'');svg.innerHTML=h;}
for(let k=0;k<8;k++){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');drawSvg(s,clip,Math.round(k*(clip.frames.length-1)/7),false,true);film.append(s)}play.onclick=()=>{playing=!playing;play.textContent=playing?'pause':'play'};scrub.oninput=()=>{playing=false;play.textContent='play';f=Number(scrub.value);draw()};function draw(){const ix=clip.loop?(clip.strideLength&&clip.poseKeys?.length?Math.max(0,f):f%clip.frames.length):Math.max(0,Math.min(clip.frames.length-1,f));const local=clip.loop?ix%clip.frames.length:ix;scrub.value=Math.floor(local);frameNo.textContent=String(Math.floor(local))+(clip.loop?' (cycle '+(Math.floor(f/clip.frames.length)+1)+')':'');drawSvg(stage,clip,ix,onion.checked,true);drawRef()}function tick(t){const dt=(t-last)/1000;last=t;if(playing){f=f+dt*clip.fps*Number(speed.value);if(!clip.loop&&f>clip.frames.length-1+20)f=0;}draw();requestAnimationFrame(tick)}draw();if(params.get('bare')!=='1')requestAnimationFrame(tick);</script></body></html>`;
}
