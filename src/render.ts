import type { CompiledAnimation, PlaybackMode, SampledFrame } from "./contract.js";
import { sampleAnimation } from "./compiler.js";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function number(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function frameMarkup(frame: SampledFrame, color: string, width: number, height: number): string {
  const lines = frame.segments.map((line) =>
    `<line id="${xml(line.id)}" x1="${number(line.x1)}" y1="${number(line.y1)}" x2="${number(line.x2)}" y2="${number(line.y2)}"/>`
  ).join("");
  const prop = frame.prop
    ? `<g id="prop"><rect x="${number(frame.prop.x)}" y="${number(frame.prop.y)}" width="${number(frame.prop.width)}" height="${number(frame.prop.height)}" rx="3" fill="#fff" stroke="${xml(color)}" stroke-width="4"/><circle cx="${number(frame.prop.handleX)}" cy="${number(frame.prop.handleY)}" r="6" fill="${xml(color)}"/></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Stick figure ${xml(frame.action)} at ${number(frame.timeMs)} milliseconds" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#ffffff"/><path d="M0 ${number(frame.groundY)}H${width}" stroke="#d8dbe0" stroke-width="1"/>
<g fill="none" stroke="${xml(color)}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${lines}</g>
<circle id="head" cx="${number(frame.head.x)}" cy="${number(frame.head.y)}" r="15" fill="#ffffff" stroke="${xml(color)}" stroke-width="5"/>${prop}
</svg>`;
}

export function renderSvgFrame(program: CompiledAnimation, timeMs = 0, mode: PlaybackMode = "normal"): string {
  const frame = sampleAnimation(program, timeMs, mode);
  return frameMarkup(frame, program.spec.actor?.color ?? "#202124", program.spec.canvas.width, program.spec.canvas.height);
}

function animateAttribute(attribute: string, values: number[], durationSeconds: number, keyTimes: string): string {
  return `<animate attributeName="${attribute}" dur="${number(durationSeconds)}s" values="${values.map(number).join(";")}" keyTimes="${keyTimes}" fill="freeze" calcMode="linear"/>`;
}

export function renderAnimatedSvg(program: CompiledAnimation): string {
  const { durationMs, canvas } = program.spec;
  const frames = Math.max(2, Math.ceil(durationMs * canvas.fps / 1000) + 1);
  const samples = Array.from({ length: frames }, (_, index) => sampleAnimation(program, durationMs * index / (frames - 1)));
  const keys = samples.map((_, index) => number(index / (frames - 1))).join(";");
  const seconds = durationMs / 1000;
  const first = samples[0]!;
  const colors = program.spec.actor?.color ?? "#202124";
  const lineIds = first.segments.map((s) => s.id);
  const lines = lineIds.map((id) => {
    const at = samples.map((frame) => frame.segments.find((segment) => segment.id === id)!);
    const start = at[0]!;
    return `<line id="${xml(id)}" x1="${number(start.x1)}" y1="${number(start.y1)}" x2="${number(start.x2)}" y2="${number(start.y2)}">${animateAttribute("x1", at.map((s) => s.x1), seconds, keys)}${animateAttribute("y1", at.map((s) => s.y1), seconds, keys)}${animateAttribute("x2", at.map((s) => s.x2), seconds, keys)}${animateAttribute("y2", at.map((s) => s.y2), seconds, keys)}</line>`;
  }).join("");
  const head = `<circle id="head" cx="${number(first.head.x)}" cy="${number(first.head.y)}" r="15" fill="#fff" stroke="${xml(colors)}" stroke-width="5">${animateAttribute("cx", samples.map((s) => s.head.x), seconds, keys)}${animateAttribute("cy", samples.map((s) => s.head.y), seconds, keys)}</circle>`;
  const prop = first.prop ? `<g id="prop"><rect y="${number(first.prop.y)}" width="${number(first.prop.width)}" height="${number(first.prop.height)}" rx="3" fill="#fff" stroke="${xml(colors)}" stroke-width="4">${animateAttribute("x", samples.map((s) => s.prop?.x ?? first.prop!.x), seconds, keys)}</rect><circle cy="${number(first.prop.handleY)}" r="6" fill="${xml(colors)}">${animateAttribute("cx", samples.map((s) => s.prop?.handleX ?? first.prop!.handleX), seconds, keys)}</circle></g>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}" role="img" aria-label="Deterministic stick figure animation">
<rect width="100%" height="100%" fill="#fff"/><path d="M0 ${number(first.groundY)}H${canvas.width}" stroke="#d8dbe0"/>
<g fill="none" stroke="${xml(colors)}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${lines}</g>${head}${prop}</svg>`;
}

export function renderHtml(program: CompiledAnimation): string {
  const { canvas } = program.spec;
  const initial = sampleAnimation(program, 0);
  const svg = frameMarkup(initial, program.spec.actor?.color ?? "#202124", canvas.width, canvas.height);
  const sampler = sampleAnimation.toString();
  const programJson = scriptJson(program);
  const controls = `<label>Motion mode <select id="mode"><option value="normal">Normal</option><option value="reduced">Reduced</option><option value="static">Static</option></select></label><label>Playhead <input id="seek" type="range" min="0" max="${program.spec.durationMs}" step="1" value="0"></label><button id="toggle" type="button">Pause</button>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stickman animation</title>
<style>body{margin:0;background:#f3f4f6;color:#202124;font:16px system-ui,sans-serif}main{max-width:1000px;margin:2rem auto;padding:1rem}svg{display:block;width:100%;height:auto;background:white;border:1px solid #d8dbe0;border-radius:8px}nav{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;padding:.8rem 0}input{min-width:12rem}</style>
<main><nav>${controls}</nav><div id="stage">${svg}</div></main>
<script>(()=>{"use strict";const program=${programJson};const sample=${sampler};const svg=document.querySelector("#stage svg");const modeSelect=document.querySelector("#mode");const seek=document.querySelector("#seek");const toggle=document.querySelector("#toggle");const duration=program.spec.durationMs;let mode=matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"normal";modeSelect.value=mode;let time=0;let playing=mode==="normal";toggle.textContent=playing?"Pause":"Play";let previous=0;function draw(){const frame=sample(program,time,mode);for(const segment of frame.segments){const el=document.getElementById(segment.id);if(!el)continue;el.setAttribute("x1",segment.x1);el.setAttribute("y1",segment.y1);el.setAttribute("x2",segment.x2);el.setAttribute("y2",segment.y2)}const head=document.getElementById("head");head.setAttribute("cx",frame.head.x);head.setAttribute("cy",frame.head.y);const prop=document.querySelector("#prop");if(frame.prop&&prop){prop.querySelector("rect").setAttribute("x",frame.prop.x);prop.querySelector("circle").setAttribute("cx",frame.prop.handleX);prop.querySelector("circle").setAttribute("cy",frame.prop.handleY)}seek.value=String(time)}function tick(now){if(!playing)return;if(previous)time+=now-previous;previous=now;if(time>=duration){time=duration;playing=false;toggle.textContent="Play"}draw();if(playing)requestAnimationFrame(tick)}modeSelect.addEventListener("change",()=>{mode=modeSelect.value;if(mode!=="normal"){playing=false;time=duration;toggle.textContent="Play"}else{time=0;previous=0;playing=true;toggle.textContent="Pause";requestAnimationFrame(tick)}draw()});seek.addEventListener("input",()=>{time=Number(seek.value);previous=0;draw()});toggle.addEventListener("click",()=>{if(mode!=="normal"){mode="normal";modeSelect.value=mode}if(!playing){if(time>=duration)time=0;playing=true;previous=0;toggle.textContent="Pause";requestAnimationFrame(tick)}else{playing=false;toggle.textContent="Play"}});draw();if(playing)requestAnimationFrame(tick)})();</script></html>`;
}
