// Stickman motion provider for dynamic-presentations decks.
// Pre-composes one continuous stickman performance (approved motions, automatic bridges, continuity <= 14)
// across the deck's scene slides, renders it per frame, and injects an offline adapter-1.0 provider plus a
// timed autoplay wrapper into an already rendered deck HTML. The presentation MCP itself is never modified.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeFilm, loadShowcaseResources } from "../film/runtime.mjs";
import { createPerformanceRenderer } from "./performance.mjs";
import { engineSampledFrame } from "../motions/review-renderer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FPS = 30;
export const MAX_FRAMES = 1800;

/** The cloud-migration story: who does what on which slide and beat ("slide/beat"). */
export const cloudDeckPlan = {
  id: "cloud-deck",
  provider: "stickman",
  // A fixed camera and uniform stage projection keep the co-presenter ~122 px tall at 1440x900.
  view: { x: 0, y: 60, w: 1000, h: 595 },
  projection: { scale: 0.55, x: 0, y: 243 },
  reviewSlides: ["pilot-framing", "pilot-recommendation"],
  slides: ["question", "on-prem", "cloud", "evidence", "decision"].map(id => ({ id, scene: true })),
  performance: [
    { motion: "enter-door", root: 650, beat: "question/0" }, { motion: "think", until: 16 },
    { motion: "rack-server", until: 182, beat: "on-prem/0" },
    { motion: "shrug", until: 36, beat: "on-prem/1" },
    { motion: "idea", beat: "on-prem/2" },
    { walk: { to: 850, pace: 12 }, beat: "cloud/0" }, { motion: "present", until: 38 }, { motion: "sit-down" },
    { motion: "video-call", until: 69, beat: "cloud/1" }, { motion: "type-at-desk", cycles: 1 },
    { motion: "stand-up", beat: "cloud/2" },
    { walk: { to: 480, pace: 12 }, beat: "evidence/0" }, { motion: "present", until: 38 },
    { walk: { to: 780, pace: 12 }, beat: "evidence/1" },
    { walk: { to: 1080, pace: 12 }, beat: "evidence/2" },
    { walk: { to: 1380, pace: 12 }, beat: "evidence/3" }, { motion: "thumbs-up" },
    { motion: "basketball-shot", beat: "decision/0" }, { motion: "exit-door" }
  ],
  sets: { "on-prem": [{ motion: "rack-server", types: ["server-rack", "platform"], root: 650 }] }
};

const beatsOf = plan => plan.performance.filter(item => item.beat).map(item => item.beat);

// A tiny airborne replant during generated joins avoids dragging a planted stance.
// The same world-space offset is measured by the gate and applied to the actor SVG.
export function deckJoinLift(performance, frame) {
  const segment = performance.segments.find(seg => frame <= seg.end);
  if (!segment || frame >= segment.start || !segment.gapStart) return 0;
  const t = (frame - segment.gapStart + 1) / (segment.start - segment.gapStart + 1);
  return 3 * Math.sin(Math.PI * t);
}
export function deckContinuity(performance, sampleClipMotion) {
  let previous = null, maxJointStep = 0, worstFrame = 0;
  const footSlides = [];
  for (let frame = 0; frame < performance.frames; frame++) {
    const sample = engineSampledFrame(sampleClipMotion, performance.clip, frame);
    const shift = (performance.rootTrack[frame] - 640) / performance.scale;
    const lift = deckJoinLift(performance, frame) * .75;
    const points = [sample.head, ...sample.segments.map(part => ({ x: part.x2, y: part.y2, id: part.id }))]
      .map(point => ({ ...point, x: point.x + shift, y: point.y - lift }));
    if (previous) {
      points.forEach((point, i) => { const step = Math.hypot(point.x - previous[i].x, point.y - previous[i].y) / .75;
        if (step > maxJointStep) { maxJointStep = step; worstFrame = frame; } });
      for (const side of ["left", "right"]) {
        const a = points.find(point => point.id === side + "-shin"), b = previous.find(point => point.id === side + "-shin");
        if (a.y >= 149.5 && b.y >= 149.5 && Math.abs(a.x - b.x) / .75 > 1.2) footSlides.push({ frame, side });
      }
    }
    previous = points;
  }
  return { maxJointStep: Number(maxJointStep.toFixed(2)), worstFrame, footSlides };
}

/** Compose the lead performance through the shared film composer (approved gating, auto bridges). */
export async function composeDeckPerformance(plan = cloudDeckPlan, resources) {
  resources ??= await loadShowcaseResources();
  // Film captions are not shown: slide copy belongs to the presentation runtime.
  const scenes = [{ id: beatsOf(plan)[0], state: plan.id, cues: [{ frame: 0, text: "Workload migration comparison" }] }];
  const composed = await composeFilm({ id: plan.id, bridge: "auto", performance: plan.performance, scenes, set: [] }, resources);
  const replants = composed.performance.segments.slice(1).map(seg => ({ kind: "generated-replant", startFrame: seg.gapStart, endFrame: seg.start - 1, frames: seg.start - seg.gapStart }));
  composed.continuity = deckContinuity(composed.performance, resources.sampleClipMotion);
  if (composed.continuity.maxJointStep > 14 || composed.continuity.footSlides.length) throw new Error("Deck joins failed continuity or planted-foot gates: " + JSON.stringify(composed.continuity));
  composed.bridgeRecords.push(...replants);
  const starts = beatsOf(plan).map(id => {
    const segment = composed.performance.segments.find(seg => seg.beat === id);
    if (!segment) throw new Error("Missing deck performance beat " + id);
    return { id, startFrame: segment.gapStart };
  });
  composed.timeline.scenes = starts.map((scene, i) => ({ ...scene, frames: (starts[i + 1]?.startFrame ?? composed.performance.frames) - scene.startFrame }));
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
  .replace(/ (id|data-part)="([^"]*)"/g, (match, attr, id) => attr === "id" && svg.includes(`url(#${id})`) ? match : "")
  .replace(/-?\d+\.\d{2,}/g, value => String(Math.round(Number(value) * 100) / 100));

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
    // The deck clips its actor separately; nested figure wrappers break prop-layer extraction.
    if (!renderers.has(key)) renderers.set(key, createPerformanceRenderer(performance, { sampleClipMotion, frameGeometry, propsCatalog, set, theme: tokenTheme, motions, clipFigure: false }));
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
    const ownerSegment = performance.segments.find(seg => f <= seg.end);
    const local = f - ownerSegment.start;
    const door = ownerSegment.kind === "motion" ? ownerSegment.spec.review?.prop : null;
    if (ownerSegment.spec.prop === "door" && door && local >= (door.clipFigureFrom ?? Infinity) && (door.clipFigureUntil === undefined || local < door.clipFigureUntil)) {
      const unit = .75 * performance.scale, x = ownerSegment.root + door.x * unit, y = 540 - (door.y + door.h) * unit;
      layers.actor = ownerSegment.id === "exit-door" && local >= ownerSegment.spec.markers.clear ? "" :
        '<defs><clipPath id="deck-door-aperture"><rect x="' + x + '" y="' + y + '" width="' + door.w * unit + '" height="' + door.h * unit + '"/></clipPath></defs><g clip-path="url(#deck-door-aperture)">' + layers.actor + '</g>';
    }
    const project = markup => plan.projection && markup ? `<g transform="translate(${plan.projection.x} ${plan.projection.y}) scale(${plan.projection.scale})">${markup}</g>` : markup;
    frames.push([ref(project(layers.back)), ref(project(`<g transform="translate(0 ${-deckJoinLift(performance, f) * .75 * performance.scale})">${layers.actor}</g>`)), ref(project(layers.front))]);
    roots.push(Math.round(stagePosition(performance, f) * (plan.projection?.scale ?? 1) + (plan.projection?.x ?? 0)));
  }
  return { dict, frames, roots };
}

export function selectStorySlides(html, ids, reviewSlides = []) {
  if (!reviewSlides.length) return html;
  const match = html.match(/(<script[^>]*id="deck-data"[^>]*>)([\s\S]*?)(<\/script>)/);
  if (!match) throw new Error("Missing deck data.");
  const data = JSON.parse(match[2]);
  const unknown = data.slides.filter(slide => !ids.includes(slide.id) && !reviewSlides.includes(slide.id));
  if (unknown.length) throw new Error("Undeclared extra deck slides.");
  data.slides = data.slides.filter(slide => ids.includes(slide.id));
  if (data.slides.map(slide => slide.id).join() !== ids.join()) throw new Error("Story slide order mismatch.");
  let out = html.replace(match[0], match[1] + safeJson(data) + match[3]);
  for (const id of reviewSlides) {
    out = out.replace(new RegExp('<section class="slide" id="' + id + '"[\\s\\S]*?<\\/section>'), "");
    out = out.replace(new RegExp('<li>\\s*<button[^>]*data-goto="' + id + '"[\\s\\S]*?<\\/li>'), "");
  }
  return out.replace(/([·] )([1-5]) \/ 7/g, "$1$2 / 5");
}

const safeJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");

/** Inject provider, frames, timing metadata and autoplay controls into a rendered deck. */
export function injectDeck(html, { timing, film, client }) {
  if (!html.includes('id="deck-data"') || !html.includes('id="deck-toolbar"')) throw new Error("Not a dynamic-presentations deck.");
  if (html.includes('id="stickman-frames"')) throw new Error("Deck already has a stickman provider.");
  const controls = `\n<button type="button" id="play" aria-label="Play or pause the timed story">Play</button>` +
    `\n<input type="range" id="seek" min="0" max="${timing.totalFrames - 1}" step="1" value="0" aria-label="Story position (frames)">`;
  const style = `<style id="stickman-provider-style">.toolbar #seek{flex:0 1 180px;min-width:90px;accent-color:var(--cp-accent)}` +
    `body[data-view=present] figure.scene{background:transparent;border-color:transparent;border-radius:0;box-shadow:none}` +
    `.toolbar #play{min-width:72px;font-weight:600}.stickman-stage{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:hidden}.stickman-native-flow{position:absolute;left:130px;top:42px;width:calc(100% - 260px);height:128px;pointer-events:none}.scene[data-motion-active=true][data-flow-active=true] .stickman-native-flow .flow-ink{animation:flow-trace 580ms cubic-bezier(.2,.8,.2,1) both}.scene[data-motion-active=true][data-flow-active=true] .stickman-native-flow .flow-packet{animation:flow-travel-4 var(--stickman-flow-duration) ease-in-out both;opacity:1}.stickman-native-flow [data-step-complete=false] .flow-node{fill:var(--cp-surface);stroke:var(--cp-border-strong)}.stickman-native-flow [data-step-complete=false] .flow-label{fill:var(--cp-text)}.stickman-native-flow [data-step-complete=true] .flow-node{fill:var(--cp-accent);stroke:var(--cp-accent);stroke-width:3}.stickman-native-flow [data-step-complete=true] .flow-label{fill:var(--cp-accent-fg)}</style>`;
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
  const html = injectDeck(selectStorySlides(await fs.readFile(deckPath, "utf8"), plan.slides.map(slide => slide.id), plan.reviewSlides), { timing, film, client });
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
