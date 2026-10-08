// Stickman motion provider for dynamic-presentations decks.
// Pre-composes one continuous stickman performance (approved motions, automatic bridges, continuity <= 14)
// across the deck's scene slides, renders it per frame, and injects an offline adapter-1.0 provider plus a
// timed autoplay wrapper into an already rendered deck HTML. The presentation MCP itself is never modified.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeFilm, loadShowcaseResources } from "../film/runtime.mjs";
import { createPerformanceRenderer } from "./performance.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FPS = 30;
export const MAX_FRAMES = 1800;

/** The cloud-migration story: who does what on which slide and beat ("slide/beat"). */
export const cloudDeckPlan = {
  id: "cloud-deck",
  provider: "stickman",
  // Film-space window shown inside every 740x440 scene slot (same aspect ratio as the slot).
  view: { x: 150, y: 60, w: 900, h: 535 },
  slides: [
    { id: "question", frames: 105 },
    { id: "on-prem", scene: true },
    { id: "cloud", scene: true },
    { id: "evidence", scene: true },
    { id: "decision", frames: 180 }
  ],
  performance: [
    { motion: "rack-server", root: 330, hold: 12, beat: "on-prem/0" },
    { walk: { to: 600 }, beat: "on-prem/1" }, { motion: "shrug", hold: 12 },
    { motion: "check-watch", hold: 22, beat: "on-prem/2" },
    { relocate: 460, beat: "cloud/0" }, { motion: "idea", hold: 22 },
    { motion: "present", hold: 40, beat: "cloud/1" },
    { motion: "think", hold: 30, beat: "cloud/2" },
    { relocate: 285, beat: "evidence/0" }, { motion: "inspect-magnifier", hold: 6 },
    { walk: { to: 705 }, beat: "evidence/1" }, { motion: "present", hold: 8 },
    { walk: { to: 915 }, beat: "evidence/2" }, { motion: "thumbs-up", hold: 30 }
  ],
  // Props that stay on stage for a whole slide (the rack the admin just filled).
  sets: { "on-prem": [{ motion: "rack-server", types: ["server-rack", "platform"], root: 330 }] }
};

const beatsOf = plan => plan.performance.filter(item => item.beat).map(item => item.beat);

/** Compose the lead performance through the shared film composer (approved gating, auto bridges). */
export async function composeDeckPerformance(plan = cloudDeckPlan, resources) {
  resources ??= await loadShowcaseResources();
  const scenes = beatsOf(plan).map(id => ({ id, state: id, cues: [{ frame: 0, text: id }] }));
  const composed = await composeFilm({ id: plan.id, bridge: "auto", performance: plan.performance, scenes, set: [] }, resources);
  return { resources, composed };
}

/** Deck timeline: every slide/beat in order with its frame range; scene beats take their performance length. */
export function deckTimeline(plan, storyboard, composed) {
  const beatScenes = new Map(composed.timeline.scenes.map(scene => [scene.id, scene]));
  const timeline = [], scenes = {}, cueSlides = {};
  let start = 0;
  for (const slide of plan.slides) {
    const board = storyboard.slides.find(item => item.id === slide.id);
    if (!board) throw new Error(`Storyboard has no slide ${slide.id}.`);
    const states = board.beats.length + 1;
    if (slide.scene) {
      if (board.scene?.provider !== plan.provider) throw new Error(`${slide.id}: scene provider must be ${plan.provider}.`);
      for (const cue of board.scene.cues) cueSlides[cue.id] = slide.id;
      scenes[slide.id] = [];
      for (let beat = 0; beat < states; beat++) {
        const scene = beatScenes.get(`${slide.id}/${beat}`);
        if (!scene) throw new Error(`${slide.id}: the performance has no beat ${beat}.`);
        scenes[slide.id].push([scene.startFrame, scene.startFrame + scene.frames]);
        timeline.push({ slide: slide.id, beat, start, frames: scene.frames, perf: scene.startFrame });
        start += scene.frames;
      }
    } else {
      if (board.scene) throw new Error(`${slide.id}: scene slides need performance beats.`);
      if (states !== 1) throw new Error(`${slide.id}: non-scene slides use one timed state.`);
      timeline.push({ slide: slide.id, beat: 0, start, frames: slide.frames });
      start += slide.frames;
    }
  }
  if (start > MAX_FRAMES) throw new Error(`Deck story is ${start} frames; the limit is ${MAX_FRAMES} (60 s).`);
  return { timeline, scenes, cueSlides, totalFrames: start };
}

// Colours become tokens that the browser swaps for the deck's live theme variables (light or dark).
export function tokenTheme(svg) {
  return svg.replace(/(fill|stroke)="(#[a-fA-F0-9]{3,8}|rgba?\([^"]+\))"/g, (_, attr, color) => {
    const pale = /^#(fff(?:fff)?|f[0-9a-f]{5}|e[0-9a-f]{5})$/i.test(color);
    const dark = /^#[0-4]/i.test(color);
    const neutral = /^#(?:([0-9a-f])\1\1|([0-9a-f]{2})\2\2|d8dbe0)$/i.test(color);
    return `${attr}="@${pale ? "s" : dark ? "t" : neutral ? "b" : "a"}"`;
  });
}

// Sub-pixel precision and element ids are invisible at slot size; dropping them keeps the deck small.
export const compactSvg = svg => svg
  .replace(/ (?:id|data-part)="[^"]*"/g, "")
  .replace(/-?\d+\.\d{2,}/g, value => String(Math.round(Number(value) * 10) / 10));

// Where the actor stands on stage (film x). rootTrack is a render offset, so derive it from the segments.
export function stagePosition(performance, frame) {
  const segments = performance.segments;
  const index = segments.findIndex(seg => frame <= seg.end);
  const seg = segments[index];
  if (frame < seg.start) return segments[index - 1]?.root ?? seg.root;
  if (seg.kind !== "walk") return seg.root;
  const to = segments[index + 1]?.root ?? seg.root;
  return seg.root + (to - seg.root) * (frame - seg.start) / Math.max(1, seg.end - seg.start);
}

/** Render every performance frame into deduplicated back/actor/front SVG fragments. */
export async function renderDeckFrames(plan, composed, resources, ranges) {
  const { performance, motions } = composed;
  const { sampleClipMotion, frameGeometry, propsCatalog } = resources;
  const renderers = new Map();
  const rendererFor = slide => {
    const set = plan.sets?.[slide] ?? [];
    const key = JSON.stringify(set);
    if (!renderers.has(key)) renderers.set(key, createPerformanceRenderer(performance, { sampleClipMotion, frameGeometry, propsCatalog, set, theme: tokenTheme, motions }));
    return renderers.get(key);
  };
  const owner = new Array(performance.frames).fill(null);
  for (const [slide, beats] of Object.entries(ranges)) for (const [a, b] of beats) for (let f = a; f < b; f++) owner[f] = slide;
  const dict = [], index = new Map(), frames = [], roots = [];
  const ref = raw => {
    const markup = compactSvg(raw);
    if (!index.has(markup)) { index.set(markup, dict.length); dict.push(markup); }
    return index.get(markup);
  };
  for (let f = 0; f < performance.frames; f++) {
    const layers = await rendererFor(owner[f])(f);
    frames.push([ref(layers.back), ref(layers.actor), ref(layers.front)]);
    roots.push(Math.round(stagePosition(performance, f)));
  }
  return { dict, frames, roots };
}

const safeJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");

/** Inject provider, frames, timing metadata and autoplay controls into a rendered deck. */
export function injectDeck(html, { timing, film, client }) {
  if (!html.includes('id="deck-data"') || !html.includes('id="deck-toolbar"')) throw new Error("Not a dynamic-presentations deck.");
  if (html.includes('id="stickman-frames"')) throw new Error("Deck already has a stickman provider.");
  const controls = `\n<button type="button" id="play" aria-label="Play or pause the timed story">Play</button>` +
    `\n<input type="range" id="seek" min="0" max="${timing.totalFrames - 1}" step="1" value="0" aria-label="Story position (frames)">`;
  const style = `<style id="stickman-provider-style">.toolbar #seek{flex:0 1 180px;min-width:90px;accent-color:var(--cp-accent)}` +
    `.toolbar #play{min-width:72px;font-weight:600}.stickman-stage{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:hidden}</style>`;
  const payload = `<script id="data" type="application/json">${safeJson(timing)}</script>\n` +
    `<script id="stickman-frames" type="application/json">${safeJson(film)}</script>\n${style}\n<script>${client}</script>\n`;
  let out = html.replace(/(<div id="deck-toolbar"[^>]*>)/, `$1${controls}`);
  // Keep the toolbar (and its Play/Replay controls) visible in Present view; C still hides it.
  out = out.replace(/(<body\b[^>]*data-controls=")hidden(")/, "$1shown$2");
  const end = out.lastIndexOf("</body>");
  if (end < 0) throw new Error("Deck has no closing body.");
  return out.slice(0, end) + payload + out.slice(end);
}

export async function buildStickmanDeck({ deckPath, storyboardPath, outPath, plan = cloudDeckPlan }) {
  const storyboard = JSON.parse(await fs.readFile(storyboardPath, "utf8"));
  const { resources, composed } = await composeDeckPerformance(plan);
  const { timeline, scenes, cueSlides, totalFrames } = deckTimeline(plan, storyboard, composed);
  const { dict, frames, roots } = await renderDeckFrames(plan, composed, resources, scenes);
  const continuity = { maxJointStep: composed.continuity.maxJointStep, limit: 14, footSlides: composed.continuity.footSlides?.length ?? 0 };
  const timing = { totalFrames, fps: FPS, seconds: Number((totalFrames / FPS).toFixed(2)), timeline,
    stickman: { continuity, bridges: composed.bridgeRecords.length, performanceFrames: composed.performance.frames } };
  const film = { provider: plan.provider, view: plan.view, scenes, cueSlides, dict, frames, roots };
  const client = await fs.readFile(path.join(here, "deck-provider-client.js"), "utf8");
  const html = injectDeck(await fs.readFile(deckPath, "utf8"), { timing, film, client });
  if (outPath) await fs.writeFile(outPath, html);
  return { html, timing, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const deckPath = arg("deck"), outPath = arg("out");
  if (!deckPath || !outPath) throw new Error("Use: node scripts/site/deck-provider.mjs --deck <deck.html> --out <file.html> [--storyboard examples/cloud-deck/storyboard.json]");
  const storyboardPath = arg("storyboard") ?? path.join(here, "..", "..", "examples", "cloud-deck", "storyboard.json");
  const { timing, bytes } = await buildStickmanDeck({ deckPath: path.resolve(deckPath), storyboardPath: path.resolve(storyboardPath), outPath: path.resolve(outPath) });
  console.log(JSON.stringify({ out: path.resolve(outPath), bytes, seconds: timing.seconds, totalFrames: timing.totalFrames, stickman: timing.stickman,
    timeline: timing.timeline.map(e => `${e.slide}/${e.beat}:${e.start}+${e.frames}`) }));
}
