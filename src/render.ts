import type { CompiledAnimation, PlaybackMode, SampledFrame } from "./contract.js";
import { sampleAnimation } from "./compiler.js";
import { sampleClipMotion } from "./motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "./motion-library.js";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function number(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function frameGeometry(frame: SampledFrame) {
  const torso = frame.segments.find(segment => segment.id === "torso");
  const leftUpperArm = frame.segments.find(segment => segment.id === "left-upper-arm");
  const rightUpperArm = frame.segments.find(segment => segment.id === "right-upper-arm");
  const leftThigh = frame.segments.find(segment => segment.id === "left-thigh");
  const rightThigh = frame.segments.find(segment => segment.id === "right-thigh");
  const leftShin = frame.segments.find(segment => segment.id === "left-shin");
  const rightShin = frame.segments.find(segment => segment.id === "right-shin");
  const leftForearm = frame.segments.find(segment => segment.id === "left-forearm");
  const rightForearm = frame.segments.find(segment => segment.id === "right-forearm");
  if (!torso || !leftUpperArm || !rightUpperArm || !leftThigh || !rightThigh || !leftShin || !rightShin || !leftForearm || !rightForearm) throw new Error("Pose is missing required torso or limb segments.");
  const scale = Math.hypot(torso.x2 - torso.x1, torso.y2 - torso.y1) / 30;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Pose has an invalid torso length.");
  const headRadius = 11 * scale;
  const strokeWidth = Math.max(2.5, headRadius * 2 * 0.09);
  const torsoDirection = frame.facing ?? (torso.x2 - torso.x1);
  const kneeDirection = (leftThigh.x2 + rightThigh.x2) / 2 - torso.x1;
  const direction = Math.abs(torsoDirection) > 0.1 * scale ? torsoDirection : kneeDirection;
  const nearSide = direction < 0 ? "left" : "right";
  const farSide = nearSide === "left" ? "right" : "left";
  const frontView = frame.facing !== undefined && Math.abs(frame.facing) < 0.3;
  const frontArm = frame.action === "point" ? "right" : nearSide;
  const backArm = frontArm === "left" ? "right" : "left";
  const farLeg = `${farSide}-leg`;
  const nearLeg = `${nearSide}-leg`;
  const farArm = `${backArm}-arm`;
  const nearArm = `${frontArm}-arm`;
  const segmentOrder = frontView ? ["left-leg", "right-leg", "torso", "left-arm", "right-arm"] : [farArm, farLeg, "torso", nearLeg, nearArm];
  const format = (value: number): string => Number(value.toFixed(3)).toString();
  const path = (x1: number, y1: number, x2: number, y2: number): string =>
    `M${format(x1)} ${format(y1)}L${format(x2)} ${format(y2)}`;
  const curve = (
    root: { x: number; y: number }, joint: { x: number; y: number }, end: { x: number; y: number }
  ): string => {
    const dx = end.x - root.x;
    const dy = end.y - root.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) return path(root.x, root.y, end.x, end.y);
    const signedDistance = ((joint.x - root.x) * dy - (joint.y - root.y) * dx) / length;
    if (Math.abs(signedDistance) < 0.85 * scale) return path(root.x, root.y, end.x, end.y);
    const limitedDistance = Math.max(-0.15 * length, Math.min(0.15 * length, signedDistance));
    const midX = (root.x + end.x) / 2;
    const midY = (root.y + end.y) / 2;
    const cx = midX - dy / length * limitedDistance * 2;
    const cy = midY + dx / length * limitedDistance * 2;
    return `M${format(root.x)} ${format(root.y)}Q${format(cx)} ${format(cy)} ${format(end.x)} ${format(end.y)}`;
  };
  const limb = (id: string, upper: typeof leftUpperArm, lower: typeof leftForearm, kind: "arm" | "leg", near: boolean) => ({
    id, kind, near,
    d: curve({ x: upper.x1, y: upper.y1 }, { x: upper.x2, y: upper.y2 }, { x: lower.x2, y: lower.y2 })
  });
  const headVectorLength = Math.hypot(frame.head.x - torso.x2, frame.head.y - torso.y2);
  const head = headVectorLength > 1e-6
    ? {
        x: torso.x2 + (frame.head.x - torso.x2) / headVectorLength * headRadius,
        y: torso.y2 + (frame.head.y - torso.y2) / headVectorLength * headRadius
      }
    : frame.head;
  const footPath = (shin: typeof leftShin): string => {
    const halfLength = 5.5 * scale;
    const clearance = Math.max(0, frame.groundY - shin.y2);
    const desiredAngle = Math.atan2(shin.x2 - shin.x1, shin.y2 - shin.y1) * 0.3;
    const limit = Math.asin(Math.min(1, clearance / halfLength));
    const angle = Math.max(-Math.min(0.3, limit), Math.min(Math.min(0.3, limit), desiredAngle));
    const dx = Math.cos(angle) * halfLength;
    const dy = Math.sin(angle) * halfLength;
    return path(shin.x2 - dx, shin.y2 - dy, shin.x2 + dx, shin.y2 + dy);
  };
  const limbs = [
    limb("left-arm", leftUpperArm, leftForearm, "arm", frontArm === "left"),
    limb("right-arm", rightUpperArm, rightForearm, "arm", frontArm === "right"),
    limb("left-leg", leftThigh, leftShin, "leg", nearSide === "left"),
    limb("right-leg", rightThigh, rightShin, "leg", nearSide === "right")
  ];
  return {
    scale, headRadius, strokeWidth, head, nearSide, frontArm,
    rearSegments: [] as string[], segmentOrder, limbs,
    handlePath: frame.prop ? path(frame.prop.handleX, frame.prop.handleY - 5 * scale, frame.prop.handleX, frame.prop.handleY + 5 * scale) : null,
    paths: [
      { id: "torso", d: path(torso.x1, torso.y1, torso.x2, torso.y2), near: true },
      { id: "left-foot", d: footPath(leftShin), near: nearSide === "left" },
      { id: "right-foot", d: footPath(rightShin), near: nearSide === "right" },
      {
        id: "point-finger",
        d: (() => {
          const dx = rightForearm.x2 - torso.x2, dy = rightForearm.y2 - torso.y2;
          const reach = Math.hypot(dx, dy);
          if (!Number.isFinite(reach) || reach <= 0) throw new Error("Pointing pose has an invalid arm reach.");
          const extension = frame.action === "point" ? 7 * scale : 0;
          return path(rightForearm.x2, rightForearm.y2,
            rightForearm.x2 + dx / reach * extension, rightForearm.y2 + dy / reach * extension);
        })(),
        near: true, strokeWidth: strokeWidth
      }
    ]
  };
}

function frameMarkup(frame: SampledFrame, color: string, width: number, height: number): string {
  const geometry = frameGeometry(frame);
  const limbById = new Map(geometry.limbs.map(limb => [limb.id, limb]));
  const detailById = new Map(geometry.paths.map(item => [item.id, item]));
  const footForSide = (side: "left" | "right"): string => {
    const foot = detailById.get(`${side}-foot`);
    return foot ? `<path id="${foot.id}" d="${foot.d}"/>` : "";
  };
  const limb = (id: string): string => {
    const item = limbById.get(id);
    if (!item) throw new Error(`Missing limb ${id}.`);
    const foot = item.kind === "leg" ? footForSide(id.startsWith("left") ? "left" : "right") : "";
    return `<path id="${item.id}" d="${item.d}"/>${foot}`;
  };
  const figure = `${limb(geometry.segmentOrder[0]!)}${limb(geometry.segmentOrder[1]!)}<path id="torso" d="${geometry.paths.find(item => item.id === "torso")?.d ?? `M${number(frame.segments[0]!.x1)} ${number(frame.segments[0]!.y1)}L${number(frame.segments[0]!.x2)} ${number(frame.segments[0]!.y2)}`}"/>` +
    `<circle id="head" cx="${number(geometry.head.x)}" cy="${number(geometry.head.y)}" r="${number(geometry.headRadius)}" fill="#ffffff" stroke="${xml(color)}" stroke-width="${number(geometry.strokeWidth)}"/>` +
    `${limb(geometry.segmentOrder[3]!)}${limb(geometry.segmentOrder[4]!)}` +
    `${detailById.get("point-finger") ? `<path id="point-finger" d="${detailById.get("point-finger")!.d}"/>` : ""}`;
  const prop = frame.prop
    ? `<g id="prop"><rect x="${number(frame.prop.x)}" y="${number(frame.prop.y)}" width="${number(frame.prop.width)}" height="${number(frame.prop.height)}" rx="3" fill="#fff" stroke="${xml(color)}" stroke-width="${number(geometry.strokeWidth)}"/><path id="handle" d="${geometry.handlePath}" fill="none" stroke="${xml(color)}" stroke-width="${number(1.4 * geometry.scale)}" stroke-linecap="round"/></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Stick figure ${xml(frame.action)} at ${number(frame.timeMs)} milliseconds" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#ffffff"/><path id="ground" d="M0 ${number(frame.groundY)}H${width}" stroke="#d8dbe0" stroke-width="1"/>
<g fill="none" stroke="${xml(color)}" stroke-width="${number(geometry.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${figure}</g>${prop}
</svg>`;
}

export function renderSvgFrame(program: CompiledAnimation, timeMs = 0, mode: PlaybackMode = "normal"): string {
  return frameMarkup(sampleAnimation(program, timeMs, mode), program.spec.actor?.color ?? "#202124", program.spec.canvas.width, program.spec.canvas.height);
}

function animateAttribute(attribute: string, values: number[], durationSeconds: number, keyTimes: string): string {
  return `<animate attributeName="${attribute}" dur="${number(durationSeconds)}s" values="${values.map(number).join(";")}" keyTimes="${keyTimes}" fill="freeze" calcMode="discrete"/>`;
}

export function renderAnimatedSvg(program: CompiledAnimation): string {
  const { durationMs, canvas } = program.spec;
  // A cached vector frame must retain its solved bone lengths and contacts;
  // interpolating separate endpoints between poses breaks those constraints.
  const frames = Math.max(2, Math.ceil(durationMs * canvas.fps / 1000) + 1);
  const samples = Array.from({ length: frames }, (_, index) => sampleAnimation(program, durationMs * index / (frames - 1)));
  const shapes = samples.map(frameGeometry);
  const keys = samples.map((_, index) => (index / (frames - 1)).toString()).join(";");
  const seconds = durationMs / 1000;
  const first = samples[0]!;
  const firstShape = shapes[0]!;
  const color = program.spec.actor?.color ?? "#202124";
  const limbFor = (shape: typeof firstShape, side: "left" | "right", kind: "arm" | "leg") =>
    shape.limbs.find(limb => limb.id === `${side}-${kind}`)!;
  const pathFor = (shape: typeof firstShape, id: string) => shape.paths.find(item => item.id === id)!;
  const animatedPath = (id: string, initialD: string, values: string[], visibility?: string[]): string =>
    `<path id="${id}" d="${initialD}"><animate attributeName="d" dur="${number(seconds)}s" values="${values.join(";")}" keyTimes="${keys}" fill="freeze" calcMode="discrete"/>${visibility ? `<animate attributeName="visibility" dur="${number(seconds)}s" values="${visibility.join(";")}" keyTimes="${keys}" fill="freeze" calcMode="discrete"/>` : ""}</path>`;
  const limbLayer = (near: boolean): string => {
    const name = near ? "near" : "far";
    const sides = (["left", "right"] as const).flatMap(side => (["arm", "leg"] as const).map(kind => {
      const limbs = shapes.map(shape => limbFor(shape, side, kind));
      const visibility = limbs.map(limb => limb.near === near ? "visible" : "hidden");
      const foot = kind === "leg"
        ? animatedPath(`${name}-${side}-foot`, pathFor(firstShape, `${side}-foot`).d, shapes.map(shape => pathFor(shape, `${side}-foot`).d), visibility)
        : "";
      return animatedPath(`${name}-${side}-${kind}`, limbs[0]!.d, limbs.map(limb => limb.d), visibility) + foot;
    })).join("");
    return `<g data-layer="${name}">${sides}</g>`;
  };
  const torso = animatedPath("torso", pathFor(firstShape, "torso").d, shapes.map(shape => pathFor(shape, "torso").d));
  const pointFinger = animatedPath("point-finger", pathFor(firstShape, "point-finger").d, shapes.map(shape => pathFor(shape, "point-finger").d));
  const head = `<circle id="head" cx="${number(firstShape.head.x)}" cy="${number(firstShape.head.y)}" r="${number(firstShape.headRadius)}" fill="#fff" stroke="${xml(color)}" stroke-width="${number(firstShape.strokeWidth)}">${animateAttribute("cx", shapes.map(shape => shape.head.x), seconds, keys)}${animateAttribute("cy", shapes.map(shape => shape.head.y), seconds, keys)}</circle>`;
  const prop = first.prop
    ? `<g id="prop"><rect y="${number(first.prop.y)}" width="${number(first.prop.width)}" height="${number(first.prop.height)}" rx="3" fill="#fff" stroke="${xml(color)}" stroke-width="${number(firstShape.strokeWidth)}">${animateAttribute("x", samples.map(s => s.prop!.x), seconds, keys)}</rect><path id="handle" d="${firstShape.handlePath}" fill="none" stroke="${xml(color)}" stroke-width="${number(1.4 * firstShape.scale)}" stroke-linecap="round"><animate attributeName="d" dur="${number(seconds)}s" values="${shapes.map(shape => shape.handlePath).join(";")}" keyTimes="${keys}" fill="freeze" calcMode="discrete"/></path></g>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}" role="img" aria-label="Deterministic stick figure animation">
<rect width="100%" height="100%" fill="#fff"/><path id="ground" d="M0 ${number(first.groundY)}H${canvas.width}" stroke="#d8dbe0"/>
<g fill="none" stroke="${xml(color)}" stroke-width="${number(firstShape.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${limbLayer(false)}${torso}${head}${limbLayer(true)}${pointFinger}</g>${prop}</svg>`;
}

export function renderHtml(program: CompiledAnimation): string {
  const { canvas } = program.spec;
  const svg = frameMarkup(sampleAnimation(program, 0), program.spec.actor?.color ?? "#202124", canvas.width, canvas.height);
  const controls = `<label>Motion mode <select id="mode"><option value="normal">Normal</option><option value="reduced">Reduced</option><option value="static">Static</option></select></label><label>Playhead <input id="seek" type="range" min="0" max="${program.spec.durationMs}" step="1" value="0"></label><button id="toggle" type="button">Pause</button>`;
  const script = `(()=>{"use strict";const program=${scriptJson(program)};const geometry=${frameGeometry.toString()};const sample=(program,timeMs,mode)=>{const RUNTIME_MOTION_LIBRARY=${scriptJson(RUNTIME_MOTION_LIBRARY)};globalThis.__stickmanMotionLibrary=RUNTIME_MOTION_LIBRARY;const sampleClipMotion=${sampleClipMotion.toString()};return (${sampleAnimation.toString()})(program,timeMs,mode);};const svg=document.querySelector("#stage svg");
const modeSelect=document.querySelector("#mode"),seek=document.querySelector("#seek"),toggle=document.querySelector("#toggle");
const duration=program.spec.durationMs;
let mode=matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"normal";
modeSelect.value=mode;let time=0;let playing=mode==="normal";let previous=0;let requestId=null;
toggle.textContent=playing?"Pause":"Play";
function draw(){
const frameDuration=1000/program.spec.canvas.fps;
const sampleTime=mode==="normal"?Math.min(program.spec.durationMs,Math.floor(time/frameDuration+1e-9)*1000/program.spec.canvas.fps):time;
const frame=sample(program,sampleTime,mode),shape=geometry(frame);
for(const limb of shape.limbs){const el=document.getElementById(limb.id);if(!el)throw Error("Missing limb "+limb.id);el.setAttribute("d",limb.d);}
for(const detail of shape.paths){const el=document.getElementById(detail.id);if(el)el.setAttribute("d",detail.d);}
const head=document.getElementById("head");head.setAttribute("cx",shape.head.x);head.setAttribute("cy",shape.head.y);head.setAttribute("r",shape.headRadius);
function appendDrawn(id){const el=document.getElementById(id);if(el)el.parentNode.appendChild(el);if(id.endsWith("-leg")){const foot=document.getElementById(id.replace("-leg","-foot"));if(foot)foot.parentNode.appendChild(foot);}}
for(const id of shape.segmentOrder.slice(0,3)){appendDrawn(id);}
head.parentNode.appendChild(head);
for(const id of shape.segmentOrder.slice(3)){appendDrawn(id);}
const finger=document.getElementById("point-finger");if(finger)finger.parentNode.appendChild(finger);
document.getElementById("ground").setAttribute("d","M0 "+frame.groundY+"H"+program.spec.canvas.width);
svg.setAttribute("aria-label","Stick figure "+frame.action+" at "+frame.timeMs+" milliseconds");
const prop=document.querySelector("#prop");if(frame.prop&&prop){prop.querySelector("rect").setAttribute("x",frame.prop.x);document.getElementById("handle").setAttribute("d",shape.handlePath);}
seek.value=String(frame.timeMs);
}
function stop(){playing=false;previous=0;if(requestId!==null){cancelAnimationFrame(requestId);requestId=null;}toggle.textContent="Play";}
function schedule(){if(playing&&requestId===null)requestId=requestAnimationFrame(tick);}
function tick(now){requestId=null;if(!playing)return;if(previous)time+=now-previous;previous=now;if(time>=duration){time=duration;stop();}draw();schedule();}
function start(){if(mode!=="normal"){mode="normal";modeSelect.value=mode;}if(time>=duration)time=0;playing=true;previous=0;toggle.textContent="Pause";draw();schedule();}
modeSelect.addEventListener("change",()=>{stop();mode=modeSelect.value;if(mode==="normal"){time=0;start();}else{time=duration;draw();}});
seek.addEventListener("input",()=>{time=Number(seek.value);previous=0;draw();});
toggle.addEventListener("click",()=>{if(playing)stop();else start();});
draw();schedule();})();`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stickman animation</title>
<script>(()=>{const param=new URLSearchParams(window.location.search).get("scoutTheme");const theme=param||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",theme);})();</script>
<style>
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
body{margin:0;background:var(--cp-bg);color:var(--cp-text);font:16px "Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif}
main{max-width:1000px;margin:2rem auto;padding:1rem}svg{display:block;width:100%;height:auto;border:1px solid var(--cp-border);border-radius:0.625rem}
nav{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;padding:.8rem 0}input{min-width:12rem;accent-color:var(--cp-accent)}
button,select{font:inherit;background:var(--cp-surface);color:var(--cp-text);border:1px solid var(--cp-border);border-radius:0.625rem;padding:.35rem .6rem}
</style>
<main><nav>${controls}</nav><div id="stage">${svg}</div></main><script id="stickman-player">${script}</script></html>`;
}
