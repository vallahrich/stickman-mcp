#!/usr/bin/env node
// Builds a self-contained HTML slide deck that showcases the presentation motions as a live co-presenter.
// Each slide plays one motion through the shipping engine sampler at 30 fps and reacts to the motion's markers.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageKitSource, loadEngineRenderer } from "./review-renderer.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sessionFiles = process.env.STICKMAN_SESSION_FILES ?? process.env.MOTION_SESSION_FILES ?? "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files";
const factory = path.join(sessionFiles, "motion-factory");
const outFile = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(factory, "presentation-demo.html");

const motionIds = ["reveal", "type-at-desk", "present-card", "write-board", "tap-element", "idea", "pull-banner", "swipe-next"];

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const motions = {};
for (const id of motionIds) {
  const clip = await readJson(path.join(factory, "clips", id, "clip.json"));
  const spec = await readJson(path.join(repo, "motions", "specs", `${id}.json`));
  motions[id] = { clip, spec: { prop: spec.prop ?? null, review: spec.review ?? {}, markers: spec.markers ?? {} } };
}
const propsCatalog = await readJson(path.join(sessionFiles, "design", "props.json"));
const kit = await stageKitSource();

// Slide-to-slide transition: the approved shipping run (accelerate from a stand, brake back to a stand),
// compiled at rig scale 1 and drawn at the deck's stage scale through the viewBox.
async function transitionRunFrames() {
  const { compileAnimation, sampleAnimation, CONTRACT_VERSION } = await loadEngineRenderer();
  const durationMs = 1600, groundY = 640, x = 200;
  const result = compileAnimation({
    version: CONTRACT_VERSION, canvas: { width: 1600, height: 800, fps: 30 }, durationMs,
    actor: { x, groundY }, targets: { travel: { x: x + 500, y: groundY } },
    actions: [{ action: "run", startMs: 0, durationMs, target: "travel" }]
  });
  if (!result.program) throw new Error(`Transition run failed to compile: ${JSON.stringify(result.errors ?? result)}`);
  const frames = [];
  for (let t = 0; t <= durationMs + 1e-6; t += 1000 / 30) frames.push(sampleAnimation(result.program, t));
  return { frames, groundY, startX: x, endX: x + 500 };
}
const transition = await transitionRunFrames();
const data = JSON.stringify({ motions, propsCatalog, transition }).replaceAll("<", "\\u003c");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stickman co-presenter demo</title>
<script>
  (() => {
    const param = new URLSearchParams(window.location.search).get("scoutTheme");
    const theme =
      param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>
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
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--cp-bg); color: var(--cp-text); font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif; display: grid; place-items: center; overflow: hidden; }
.deck { position: relative; width: min(96vw, calc(88vh * 16 / 9)); aspect-ratio: 16 / 9; }
.slide { position: absolute; inset: 0; background: var(--cp-surface); border: 1px solid var(--cp-border); border-radius: 16px; box-shadow: 0 0 2px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.14); overflow: hidden; opacity: 0; pointer-events: none; transition: opacity .35s ease, transform .5s cubic-bezier(.6,0,.3,1); container-type: size; }
.slide.active { opacity: 1; pointer-events: auto; }
.slide.swipe-out { transform: translateX(-110%) rotate(-3deg); opacity: 0; }
.slide.swipe-in { transform: translateX(110%) rotate(3deg); }
.kicker { position: absolute; left: 5cqw; top: 5cqh; font-size: 1.6cqw; letter-spacing: .12em; text-transform: uppercase; color: var(--cp-accent); font-weight: 600; }
h1, h2 { margin: 0; font-weight: 650; letter-spacing: -.01em; }
.slide h2 { position: absolute; left: 5cqw; top: 9.5cqh; font-size: 3.6cqw; max-width: 88cqw; }
.actor { position: absolute; color: var(--cp-text); overflow: visible; }
.actor svg { width: 100%; height: 100%; overflow: visible; }
.mono { font-family: Consolas, "Courier New", Courier, monospace; }
.footer { position: absolute; right: 5cqw; bottom: 3.5cqh; font-size: 1.2cqw; color: var(--cp-text-soft); }
/* slide 1: reveal */
.title-big { position: absolute; left: 44cqw; top: 30cqh; width: 52cqw; transform: scale(.6); opacity: 0; transition: transform .6s cubic-bezier(.2,1.6,.4,1), opacity .4s; transform-origin: left center; }
.title-big h1 { font-size: 6cqw; line-height: 1.05; }
.title-big p { font-size: 1.9cqw; color: var(--cp-text-muted); margin: 2cqh 0 0; }
.title-big.on { transform: scale(1); opacity: 1; }
.sparks { position: absolute; inset: 0; pointer-events: none; }
.spark { position: absolute; width: 1cqw; height: 1cqw; border-radius: 50%; background: var(--cp-accent); opacity: 0; }
.spark.go { animation: spark .9s ease-out forwards; }
@keyframes spark { 0% { opacity: 1; transform: translate(0,0) scale(1); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.2); } }
/* slide 2: type */
.terminal { position: absolute; right: 5cqw; top: 22cqh; width: 46cqw; height: 58cqh; background: var(--cp-surface-soft); border: 1px solid var(--cp-border); border-radius: 0.625rem; padding: 2.4cqh 2cqw; font-size: 1.7cqw; line-height: 1.5; white-space: pre-wrap; }
.terminal .dots { display: flex; gap: .6cqw; margin-bottom: 1.6cqh; }
.terminal .dots i { width: 1cqw; height: 1cqw; border-radius: 50%; background: var(--cp-border-strong); display: block; }
.terminal .ok { color: var(--cp-success); }
.terminal .acc { color: var(--cp-accent); }
.caret { display: inline-block; width: .7cqw; height: 1.1em; vertical-align: text-bottom; background: var(--cp-accent); animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.screen-glow { position: absolute; pointer-events: none; }
/* slide 3: card */
.showcase { position: absolute; right: 5cqw; top: 22cqh; width: 52cqw; height: 64cqh; pointer-events: none; }
.bigcard { position: absolute; z-index: 5; box-sizing: border-box; background: var(--cp-surface); border: 2px solid var(--cp-accent); border-radius: 16px; padding: 5cqh 3.4cqw; box-shadow: var(--cp-shadow); transform-origin: 0 0; transition: transform .95s cubic-bezier(.3,1.22,.5,1); overflow: hidden; }
.bigcard b { display: block; color: var(--cp-accent); font-size: 10cqw; line-height: 1; letter-spacing: -.02em; }
.bigcard .t { font-size: 2.6cqw; font-weight: 600; margin-top: 1.4cqh; }
.bigcard ul { margin: 3cqh 0 0; padding-left: 2cqw; font-size: 1.8cqw; line-height: 1.7; color: var(--cp-text-muted); }
/* slide 4: board ink */
.ink path { fill: none; stroke: var(--cp-accent); stroke-linecap: round; stroke-linejoin: round; }
.ink .draw { transition: stroke-dashoffset .5s ease-out; }
.legend { position: absolute; right: 5cqw; top: 26cqh; width: 32cqw; font-size: 1.7cqw; color: var(--cp-text-muted); }
.legend li { opacity: .25; transition: opacity .4s, color .4s; margin-bottom: 1.4cqh; }
.legend li.on { opacity: 1; color: var(--cp-text); }
/* slide 5: tap */
.kpis { position: absolute; left: 39.5cqw; top: 74cqh; display: grid; grid-template-columns: repeat(4, 13cqw); gap: 1.4cqw; }
.kpi-note { position: absolute; left: 5cqw; top: 24cqh; width: 60cqw; font-size: 1.9cqw; color: var(--cp-text-muted); }
.kpi { background: var(--cp-surface-soft); border: 1px solid var(--cp-border); border-radius: 16px; padding: 2.4cqh 1.6cqw; position: relative; }
.kpi .v { font-size: 3.4cqw; font-weight: 700; }
.kpi .l { font-size: 1.1cqw; color: var(--cp-text-muted); }
.kpi.hit { animation: hit .6s ease-out; border-color: var(--cp-accent); }
.kpi.hit .v { color: var(--cp-accent); }
@keyframes hit { 0% { transform: scale(1); box-shadow: 0 0 0 0 var(--cp-highlight); } 30% { transform: scale(1.06); box-shadow: 0 0 0 1.4cqw var(--cp-highlight); } 100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; } }
.ripple { position: fixed; z-index: 10; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; border: 3px solid var(--cp-accent); pointer-events: none; animation: ripple .7s ease-out forwards; }
@keyframes ripple { to { transform: scale(9); opacity: 0; } }
/* slide 6: idea */
.bulb { position: absolute; left: 20cqw; top: 20cqh; width: 6cqw; opacity: 0; transform: translate(-50%, -100%) scale(.3); transform-origin: 50% 100%; transition: transform .45s cubic-bezier(.2,1.8,.4,1), opacity .2s, filter .3s; overflow: visible; }
.bulb .glass { fill: var(--cp-surface); stroke: var(--cp-text); stroke-width: 3; stroke-linejoin: round; transition: fill .25s; }
.bulb .filament { fill: none; stroke: var(--cp-text-muted); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
.bulb .base { stroke: var(--cp-text); stroke-width: 3.5; stroke-linecap: round; }
.bulb .rays { stroke: var(--cp-warning); stroke-width: 3.5; stroke-linecap: round; opacity: 0; transition: opacity .3s; }
.bulb.on { opacity: 1; transform: translate(-50%, -100%) scale(1); filter: drop-shadow(0 0 1.2cqw var(--cp-warning)); }
.bulb.on .glass { fill: var(--cp-warning); }
.bulb.on .filament { stroke: var(--cp-surface); }
.bulb.on .rays { opacity: 1; }
.insight { position: absolute; left: 48cqw; top: 30cqh; width: 46cqw; font-size: 2.4cqw; opacity: 0; transform: translateY(2cqh); transition: all .5s; }
.insight.on { opacity: 1; transform: none; }
.insight small { display: block; color: var(--cp-text-muted); font-size: 1.5cqw; margin-top: 1.6cqh; }
.thinking { position: absolute; left: 30cqw; top: 26cqh; transform: translateY(-100%); font-size: 3cqw; color: var(--cp-text-soft); opacity: 0; transition: opacity .3s; }
.thinking.on { opacity: 1; }
/* slide 7: banner */
.headline { position: absolute; left: 104cqw; top: 66cqh; width: 54cqw; box-sizing: border-box; background: var(--cp-accent); color: var(--cp-accent-fg); border-radius: 0.625rem; padding: 3cqh 2.4cqw; font-size: 3.4cqw; font-weight: 700; transform-origin: 0 50%; }
.headline small { display: block; font-size: 1.5cqw; font-weight: 500; opacity: .85; margin-top: 1cqh; }
.headline.settle { animation: settle .5s cubic-bezier(.3,1.6,.5,1); }
@keyframes settle { 0% { transform: translateX(-1.2cqw) scaleX(.97); } 100% { transform: none; } }
.rope { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.rope path { fill: none; stroke: var(--cp-text); stroke-width: 2.5; stroke-linecap: round; }
.traveller { position: absolute; z-index: 20; color: var(--cp-text); pointer-events: none; display: none; }
.traveller svg { width: 100%; height: 100%; overflow: visible; }
.deck.travelling { overflow: hidden; border-radius: 16px; }
.deck.travelling .slide { transition: none; }
.deck.travelling .slide .actor { visibility: hidden; }
/* slide 8 + 9 */
.agenda { position: absolute; right: 6cqw; top: 26cqh; font-size: 2.2cqw; line-height: 1.9; color: var(--cp-text-muted); }
.agenda b { color: var(--cp-text); }
.thanks { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
.thanks h1 { font-size: 7cqw; }
.thanks p { color: var(--cp-text-muted); font-size: 2cqw; }
.hud { position: fixed; left: 50%; bottom: 1.2vh; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; color: var(--cp-text-muted); font-size: 13px; }
.hud button { font: inherit; background: var(--cp-surface); color: var(--cp-text); border: 1px solid var(--cp-border); border-radius: 0.625rem; padding: 4px 12px; cursor: pointer; }
.hud button:hover { border-color: var(--cp-accent); color: var(--cp-accent); }
.marker-log { position: fixed; right: 12px; bottom: 1.2vh; font: 12px Consolas, "Courier New", Courier, monospace; color: var(--cp-text-soft); }
</style>
</head>
<body>
<div class="deck" id="deck">

  <section class="slide" data-motion="reveal" data-x="6">
    <div class="kicker">Customer briefing</div>
    <div class="sparks" id="sparks"></div>
    <div class="title-big" id="title"><h1>Cloud Modernisation<br>Roadmap 2025</h1><p>From legacy estate to an AI-ready platform in three waves</p></div>
    <div class="footer">Press → or click to advance · R to replay</div>
  </section>

  <section class="slide" data-motion="type-at-desk" data-x="9" data-loop="1">
    <div class="kicker">Live build</div>
    <h2>We script the landing zone — live</h2>
    <div class="terminal mono" id="term"><div class="dots"><i></i><i></i><i></i></div><span id="typed"></span><span class="caret"></span></div>
  </section>

  <section class="slide" data-motion="present-card" data-x="6.7">
    <div class="kicker">Business case</div>
    <h2>The number that matters</h2>
    <div class="showcase" id="showcase"></div>
  </section>

  <section class="slide" data-motion="write-board" data-x="12.3">
    <div class="kicker">Growth model</div>
    <h2>Consumption ramps as workloads land</h2>
    <ol class="legend" id="legend"><li>Baseline: today’s estate</li><li>Waves 1–3 migrate</li><li>+38% capacity headroom</li></ol>
  </section>

  <section class="slide" data-motion="tap-element" data-x="27.9">
    <div class="kicker">Results</div>
    <h2>Pilot outcomes</h2><p class="kpi-note">Six-week pilot across two business units — measured, not modelled.</p>
    <div class="kpis"><div class="kpi" id="kpi1"><div class="v" data-to="42">0</div><div class="l">% lower run cost</div></div><div class="kpi" id="kpi2"><div class="v" data-to="7">0</div><div class="l">min average deploy</div></div><div class="kpi"><div class="v">99.95</div><div class="l">% availability</div></div><div class="kpi"><div class="v">3</div><div class="l">regions active</div></div></div>
  </section>

  <section class="slide" data-motion="idea" data-x="8">
    <div class="kicker">The insight</div>
    <div class="thinking" id="thinking">…?</div>
    <svg class="bulb" id="bulb" viewBox="0 -4 80 88"><path class="rays" d="M40 8V0M56.1 13.1l4.5-6.6M23.9 13.1l-4.5-6.6M66.3 26.4l7.5-2.7M13.7 26.4l-7.5-2.7"/><path class="glass" d="M26.9 53.7A22 22 0 1 1 53.1 53.7C50.1 56.3 48.5 59.7 48.5 63H31.5C31.5 59.7 29.9 56.3 26.9 53.7Z"/><path class="filament" d="M35 63V54l2.5-6 2.5 6 2.5-6 2.5 6v9"/><path class="base" d="M31.5 68h17M32.5 73.5h15M36 79h8"/></svg>
    <div class="insight" id="insight"><b>Modernise the data layer first.</b><small>Every later wave gets cheaper once data is cloud-native.</small></div>
  </section>

  <section class="slide" data-motion="pull-banner" data-x="5.7">
    <div class="kicker">Announcement</div>
    <svg class="rope" id="rope"><path d=""/></svg><div class="headline" id="headline">Go-live: Q3 — on budget<small>All three waves green across the programme</small></div>
  </section>

  <section class="slide" data-motion="swipe-next" data-x="8">
    <div class="kicker">Wrap-up</div>
    <h2>Next steps</h2>
    <div class="agenda"><b>1.</b> Architecture workshop<br><b>2.</b> Pilot sign-off<br><b>3.</b> Wave 1 kickoff</div>
  </section>

  <section class="slide" data-motion="" data-final="1">
    <div class="thanks"><div><h1>Thank you</h1><p>Questions?</p></div></div>
  </section>
</div>
<div class="hud"><button id="prev">←</button><span id="pageNo">1 / 9</span><button id="next">→</button><button id="replay">Replay</button></div>
<div class="marker-log" id="mlog"></div>
<script id="data" type="application/json">${data}</script>
<script>
${kit}
const D = JSON.parse(document.getElementById("data").textContent);
const slides = [...document.querySelectorAll(".slide")];
const FPS = 30, STAGE = { rootX: 160, groundY: 150, scale: 0.75 };
// One co-presenter: the same actor box (and therefore the same figure size) on every slide; only x differs.
const ACTOR = { w: 28, h: 62, top: 34 };
let current = 0, frame = 0, lastT = 0, held = false, run = null, travelling = false, armed = false;

function themed(markup) { return markup.replaceAll('fill="#fff"', 'style="fill:var(--cp-surface)"'); }
function svgPointToScreen(svg, p) { const pt = svg.createSVGPoint(); pt.x = p.x; pt.y = p.y; const r = pt.matrixTransform(svg.getScreenCTM()); return { x: r.x, y: r.y }; }
function slideActor(slide) {
  let host = slide.querySelector(".actor");
  if (!host) {
    host = document.createElement("div"); host.className = "actor";
    Object.assign(host.style, { left: slide.dataset.x + "cqw", top: ACTOR.top + "cqh", width: ACTOR.w + "cqw", height: ACTOR.h + "cqh" });
    host.innerHTML = '<svg viewBox="70 -40 270 196" preserveAspectRatio="xMidYMax meet"></svg>';
    slide.append(host);
  }
  return host.querySelector("svg");
}

// --- per-slide marker reactions -------------------------------------------------
const typedText = [
  ['$ ', 'acc'], ['az deployment sub create \\\\\\n', ''], ['    --template landing-zone.bicep\\n', ''],
  ['▸ networking hub ', ''], ['✓\\n', 'ok'], ['▸ identity & policy ', ''], ['✓\\n', 'ok'], ['▸ monitoring ', ''], ['✓\\n', 'ok'],
  ['Deployed in 7m 12s', 'acc']
];
// ink in normalised board-panel coordinates (u across, v down); the panel is the top ~62% of the board prop
const boardInk = [
  [["M", .1, .1], ["L", .1, .9], ["L", .92, .9]],
  [["M", .24, .88], ["L", .24, .7], ["M", .42, .88], ["L", .42, .55], ["M", .6, .88], ["L", .6, .4], ["M", .78, .88], ["L", .78, .25]],
  [["M", .16, .74], ["Q", .5, .62], [null, .84, .16], ["M", .73, .15], ["L", .85, .14], ["L", .83, .27]]
];
const reactions = {
  "reveal": {
    reset(s) { s.querySelector("#title").classList.remove("on"); s.querySelector("#sparks").innerHTML = ""; },
    reveal(s) {
      s.querySelector("#title").classList.add("on");
      const box = s.querySelector("#sparks");
      for (let i = 0; i < 18; i++) { const e = document.createElement("i"); e.className = "spark"; const a = i / 18 * Math.PI * 2; e.style.left = "26cqw"; e.style.top = "30cqh"; e.style.setProperty("--dx", Math.cos(a) * 14 + "cqw"); e.style.setProperty("--dy", Math.sin(a) * 18 + "cqh"); box.append(e); requestAnimationFrame(() => e.classList.add("go")); }
    }
  },
  "type-at-desk": {
    state: { chunk: 0, char: 0 },
    reset(s) { this.state = { chunk: 0, char: 0 }; s.querySelector("#typed").innerHTML = ""; },
    any(s, name) {
      if (!name.startsWith("key")) return;
      const out = s.querySelector("#typed"); const st = this.state;
      for (let k = 0; k < 6 && st.chunk < typedText.length; k++) {
        const [text, cls] = typedText[st.chunk];
        let span = out.lastElementChild;
        if (!span || span.dataset.chunk !== String(st.chunk)) { span = document.createElement("span"); span.dataset.chunk = st.chunk; if (cls) span.className = cls; out.append(span); }
        span.textContent += text[st.char]; st.char++;
        if (st.char >= text.length) { st.chunk++; st.char = 0; }
      }
      if (st.chunk >= typedText.length) held = "after-loop";
    }
  },
  "present-card": {
    reset(s) { s.querySelectorAll(".bigcard").forEach((e) => e.remove()); this.flown = false; },
    // The hand-held card grows out of the hand into a full-size, readable card on the slide.
    cardPlaced(s, svg, sample) {
      this.flown = true;
      const sr = s.getBoundingClientRect(), target = s.querySelector("#showcase").getBoundingClientRect();
      const drawn = svg.querySelector('[data-prop="card"]');
      const hand = svgPointToScreen(svg, handFromSample(sample, "right"));
      const from = drawn ? drawn.getBoundingClientRect() : { left: hand.x - 20, top: hand.y - 14, width: 40, height: 28 };
      const card = document.createElement("div"); card.className = "bigcard";
      card.innerHTML = "<b>−31%</b><div class=\\"t\\">3-year total cost of ownership</div><ul><li>Reserved capacity −12%</li><li>Licence mobility −11%</li><li>Ops automation −8%</li></ul>";
      Object.assign(card.style, { left: target.left - sr.left + "px", top: target.top - sr.top + "px", width: target.width + "px", height: target.height + "px", transition: "none",
        transform: "translate(" + (from.left - target.left) + "px," + (from.top - target.top) + "px) scale(" + from.width / target.width + "," + from.height / target.height + ")" });
      s.append(card);
      requestAnimationFrame(() => requestAnimationFrame(() => { card.style.transition = ""; card.style.transform = "none"; }));
    },
    hideProp() { return this.flown; }
  },
  "write-board": {
    reset(s) { s.querySelectorAll("#legend li").forEach((li) => li.classList.remove("on")); },
    stroke1(s) { this.ink(s, 0); }, stroke2(s) { this.ink(s, 1); }, stroke3(s) { this.ink(s, 2); },
    ink(s, i) {
      s.querySelectorAll("#legend li")[i].classList.add("on");
      const p = s.querySelector('.ink path[data-i="' + i + '"]'); if (p) p.style.strokeDashoffset = "0";
    }
  },
  "tap-element": {
    reset(s) { s.querySelectorAll(".kpi").forEach((k) => k.classList.remove("hit")); s.querySelectorAll(".kpi .v[data-to]").forEach((v) => v.textContent = "0"); },
    tap(s) { this.hit(s, "#kpi1"); }, tap2(s) { this.hit(s, "#kpi2"); },
    hit(s, id) {
      const k = s.querySelector(id), v = k.querySelector(".v"), to = Number(v.dataset.to), r = k.getBoundingClientRect();
      k.classList.remove("hit"); void k.offsetWidth; k.classList.add("hit");
      const rp = document.createElement("div"); rp.className = "ripple"; rp.style.left = r.left + 24 + "px"; rp.style.top = r.top + r.height / 2 + "px"; document.body.append(rp); setTimeout(() => rp.remove(), 800);
      const t0 = performance.now(); (function count(t) { const p = Math.min(1, (t - t0) / 700); v.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(count); })(t0);
    }
  },
  "idea": {
    reset(s) { ["#bulb", "#insight", "#thinking"].forEach((q) => s.querySelector(q).classList.remove("on")); },
    hideProp() { return true; },
    think(s) { s.querySelector("#thinking").classList.add("on"); },
    idea(s) { s.querySelector("#thinking").classList.remove("on"); s.querySelector("#bulb").classList.add("on"); setTimeout(() => s.querySelector("#insight").classList.add("on"), 250); },
    // Keep the bulb and the thinking cue pinned just above the head as the body rises.
    frame(s, svg, sample) {
      const sr = s.getBoundingClientRect(), top = svgPointToScreen(svg, { x: sample.head.x, y: sample.head.y - 16.5 * STAGE.scale });
      const bulb = s.querySelector("#bulb"), th = s.querySelector("#thinking");
      bulb.style.left = top.x - sr.left + "px"; bulb.style.top = top.y - sr.top - sr.height * 0.015 + "px";
      th.style.left = top.x - sr.left + sr.width * 0.025 + "px"; th.style.top = top.y - sr.top + "px";
    }
  },
  "pull-banner": {
    reset(s) { const h = s.querySelector("#headline"); h.classList.remove("settle"); h.style.left = ""; h.style.top = ""; s.querySelector("#rope path").setAttribute("d", ""); this.done = false; },
    // The stickman hauls the headline in from the right edge on a rope at hand height; it stays where it lands.
    frame(s, svg, sample, ix) {
      if (this.done) return;
      const m = D.motions["pull-banner"].spec.markers, sr = s.getBoundingClientRect(), h = s.querySelector("#headline");
      const hr = handFromSample(sample, "right"), hl = handFromSample(sample, "left");
      const hand = svgPointToScreen(svg, { x: Math.max(hr.x, hl.x), y: (hr.y + hl.y) / 2 });
      const hx = hand.x - sr.left, hy = hand.y - sr.top;
      const p = Math.min(1, Math.max(0, (ix - m.grab) / (m.reveal - m.grab))), e = 1 - Math.pow(1 - p, 3);
      const start = sr.width * 1.04, land = hx + sr.width * 0.035;
      const left = start + (land - start) * e;
      h.style.left = left + "px"; h.style.top = hy - h.offsetHeight / 2 + "px";
      s.querySelector("#rope path").setAttribute("d", ix >= m.grab ? "M" + hx + " " + hy + " Q" + (hx + left) / 2 + " " + (hy + sr.height * 0.03 * (1 - e)) + " " + left + " " + hy : "");
    },
    release(s) { this.done = true; s.querySelector("#rope path").setAttribute("d", ""); s.querySelector("#headline").classList.add("settle"); },
    hideProp() { return true; }
  },
  "swipe-next": {
    reset() {},
    swipe() { setTimeout(() => go(current + 1, true), 120); }
  }
};

function drawActor(slide, ix) {
  const id = slide.dataset.motion; if (!id) return null;
  const { clip, spec } = D.motions[id];
  const svg = slideActor(slide);
  const sample = engineSampledFrame(sampleClipMotion, clip, ix, STAGE);
  const g = ENGINE_FRAME_GEOMETRY(sample);
  const react = reactions[id];
  const scene = (react.hideProp && react.hideProp()) ? [] : layoutScene(spec, D.propsCatalog, ix, (j, side) => handFromSample(engineSampledFrame(sampleClipMotion, clip, j, STAGE), side), STAGE);
  let h = "";
  for (const p of scene) if (!p.front) h += propMarkup(p, g.strokeWidth, "currentColor");
  if (id === "write-board") h += inkMarkup(g.strokeWidth, scene.find((p) => p.type === "board"));
  h += figureMarkup(sample, g, "currentColor");
  for (const p of scene) if (p.front) h += propMarkup(p, g.strokeWidth, "currentColor");
  // keep ink stroke progress across redraws
  const prevInk = ix === 0 ? [] : [...svg.querySelectorAll(".ink path")].map((p) => p.style.strokeDashoffset);
  svg.innerHTML = themed(h);
  svg.querySelectorAll(".ink path").forEach((p, i) => { p.style.strokeDashoffset = prevInk[i] ?? p.getAttribute("data-len"); });
  if (react.frame) react.frame(slide, svg, sample, ix);
  return { svg, sample };
}
function inkMarkup(sw, board) {
  if (!board) return "";
  // ink is squeezed into the band the writing hand actually reaches (u 0.14-0.6 of the panel)
  const ph = board.h * 0.62, pt = (u, v) => num(board.x + (0.12 + u * 0.5) * board.w) + " " + num(board.y + v * ph);
  const paths = boardInk.map((cmds) => cmds.map(([c, u, v]) => (c ? c + " " : "") + pt(u, v)).join(" "));
  return '<g class="ink" stroke-width="' + num(sw * 0.8) + '">' + paths.map((d, i) => '<path class="draw" data-i="' + i + '" data-len="400" d="' + d + '" stroke-dasharray="400" style="stroke-dashoffset:400"/>').join("") + "</g>";
}

function fire(slide, name, svg, sample) {
  const react = reactions[slide.dataset.motion];
  document.getElementById("mlog").textContent = "marker: " + slide.dataset.motion + " · " + name;
  document.dispatchEvent(new CustomEvent("stickman:marker", { detail: { action: slide.dataset.motion, marker: name } }));
  if (react.any) react.any(slide, name, svg, sample);
  if (typeof react[name] === "function") react[name](slide, svg, sample);
}

function start() {
  const slide = slides[current], id = slide.dataset.motion;
  frame = 0; held = false; lastT = performance.now();
  slides.forEach((s) => { const r = reactions[s.dataset.motion]; if (r) r.reset(s); });
  document.getElementById("mlog").textContent = "";
  if (id) drawActor(slide, 0);
  cancelAnimationFrame(run); run = requestAnimationFrame(tick);
}
function tick(t) {
  const slide = slides[current], id = slide.dataset.motion;
  if (!id) return;
  // swipe-next is the exit gesture: it waits on its first frame until the presenter presses next.
  if (id === "swipe-next" && !armed) { drawActor(slide, 0); return; }
  const { clip, spec } = D.motions[id];
  const n = clip.frames.length, prev = frame;
  if (held !== true) frame += (t - lastT) / 1000 * FPS;
  lastT = t;
  if (clip.loop) {
    if (Math.floor(frame / n) > Math.floor(prev / n) && held === "after-loop") { held = true; frame = Math.floor(frame / n) * n; }
  } else if (frame > n - 1) { frame = n - 1; held = true; }
  const ix = clip.loop ? Math.floor(frame) % n : Math.min(n - 1, Math.floor(frame));
  const drawn = drawActor(slide, ix);
  for (const [name, mf] of Object.entries(spec.markers)) {
    for (let k = Math.floor(prev / n); k <= Math.floor(frame / n); k++) {
      const at = clip.loop ? k * n + mf : mf;
      if (at > prev && at <= frame || (prev === 0 && at === 0 && frame > 0)) fire(slide, name, drawn.svg, drawn.sample);
      if (!clip.loop) break;
    }
  }
  if (held !== true || clip.loop) run = requestAnimationFrame(tick);
}
function setPage(i) {
  current = i;
  document.getElementById("pageNo").textContent = (i + 1) + " / " + slides.length;
  history.replaceState(null, "", "#" + (i + 1));
}
function go(i, swipe = false) {
  if (travelling || i < 0 || i >= slides.length || i === current) return;
  const from = slides[current], to = slides[i];
  if (!swipe && i === current + 1 && from.dataset.motion && to.dataset.motion) return travel(i);
  if (swipe) { from.classList.add("swipe-out"); to.classList.add("swipe-in"); requestAnimationFrame(() => requestAnimationFrame(() => to.classList.remove("swipe-in"))); setTimeout(() => from.classList.remove("swipe-out"), 600); }
  from.classList.remove("active"); to.classList.add("active");
  setPage(i); armed = false;
  start();
}
// The same stickman runs from one slide into the next; the slides scroll past like a side-scroller camera
// that follows the run's own speed profile, so the figure never changes size or identity between slides.
function travel(i) {
  travelling = true; cancelAnimationFrame(run);
  const deck = document.getElementById("deck"), from = slides[current], to = slides[i], T = D.transition, n = T.frames.length;
  const r = reactions[to.dataset.motion]; if (r) r.reset(to);
  let host = deck.querySelector(".traveller");
  if (!host) { host = document.createElement("div"); host.className = "traveller"; host.innerHTML = '<svg preserveAspectRatio="xMidYMax meet"></svg>'; deck.append(host); }
  Object.assign(host.style, { display: "block", top: ACTOR.top + "%", width: ACTOR.w + "%", height: ACTOR.h + "%" });
  const svg = host.querySelector("svg"), ax = Number(from.dataset.x), bx = Number(to.dataset.x), span = T.endX - T.startX, k = STAGE.scale;
  deck.classList.add("travelling"); to.classList.add("active");
  const t0 = performance.now();
  (function step(t) {
    const f = Math.min(n - 1, Math.max(0, Math.floor((t - t0) / 1000 * FPS))), s = T.frames[f], e = (s.x - T.startX) / span;
    from.style.transform = "translateX(" + (-100 * e) + "%)"; to.style.transform = "translateX(" + (100 - 100 * e) + "%)";
    host.style.left = ax + (bx - ax) * e + 9 * Math.sin(Math.PI * e) + "%";
    svg.setAttribute("viewBox", [s.x - (STAGE.rootX - 70) / k, T.groundY - (STAGE.groundY + 40) / k, 270 / k, 196 / k].join(" "));
    svg.innerHTML = themed(figureMarkup(s, ENGINE_FRAME_GEOMETRY(s), "currentColor"));
    if (f < n - 1) { run = requestAnimationFrame(step); return; }
    from.classList.remove("active"); from.style.transform = ""; to.style.transform = ""; host.style.display = "none";
    void deck.offsetWidth; deck.classList.remove("travelling");
    travelling = false; armed = false; setPage(i); start();
  })(t0);
}
function next() {
  if (travelling) return;
  const s = slides[current];
  if (s.dataset.motion === "swipe-next" && !armed) { armed = true; frame = 0; held = false; lastT = performance.now(); cancelAnimationFrame(run); run = requestAnimationFrame(tick); return; }
  go(current + 1);
}
document.getElementById("prev").onclick = () => go(current - 1);
document.getElementById("next").onclick = () => next();
document.getElementById("replay").onclick = () => { armed = false; start(); };
document.getElementById("deck").onclick = () => next();
addEventListener("keydown", (e) => {
  if (["ArrowRight", "PageDown", " "].includes(e.key)) next();
  if (["ArrowLeft", "PageUp"].includes(e.key)) go(current - 1);
  if (e.key === "r" || e.key === "R") { armed = false; start(); }
});
addEventListener("hashchange", () => go((Number(location.hash.slice(1)) || 1) - 1));
const startAt = Math.max(0, Math.min(slides.length - 1, (Number(location.hash.slice(1)) || 1) - 1));
slides[startAt].classList.add("active"); current = startAt;
document.getElementById("pageNo").textContent = (startAt + 1) + " / " + slides.length;
start();
</script>
</body>
</html>`;

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, html);
console.log(outFile);
