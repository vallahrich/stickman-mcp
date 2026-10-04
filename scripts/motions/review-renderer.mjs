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

/** Samples one frame through the shipping engine (sampleClipMotion) exactly as compiler.ts does. */
export function engineSampledFrame(sampleClipMotion, clip, frameIndex, stage = { rootX: 160, groundY: 150, scale: 0.75 }) {
  const n = clip.frames.length;
  const progress = clip.loop ? frameIndex / n : frameIndex / Math.max(1, n - 1);
  const pose = sampleClipMotion({ clips: { [clip.name]: clip } }, { action: clip.name, clipId: clip.name, progress, startX: stage.rootX, endX: stage.rootX, groundY: stage.groundY, facing: 1, scale: stage.scale });
  return { timeMs: Math.round(frameIndex / clip.fps * 1000), action: clip.name, x: pose.rootX, groundY: stage.groundY, head: pose.headPoint, segments: pose.segments, prop: null, ...(pose.facing !== undefined ? { facing: pose.facing } : {}), ...(pose.articulated ? { articulated: true } : {}) };
}

export async function clipFrameToSampledFrame(clip, frameIndex) {
  const { sampleClipMotion } = await loadEngineRenderer();
  return engineSampledFrame(sampleClipMotion, clip, frameIndex);
}


/** Props are authored in engine local units (same space as poseKeys foot/hand targets): x forward from the root, y = bottom edge height above ground. */
function layoutProp(spec, propsCatalog, frameIndex = 0, stage = { rootX: 160, groundY: 150, scale: 0.75 }) {
  const type = spec.prop;
  if (!type) return null;
  const def = propsCatalog.props?.find((item) => item.type === type) ?? propsCatalog.props?.find((item) => item.type === (type === "bench" ? "chair" : type)) ?? { type, defaultSize: { w: 60, h: 40 } };
  const review = spec.review ?? {};
  const base = review.prop ?? {};
  const size = def.defaultSize ?? {};
  const w = base.w ?? size.w ?? (size.r ? size.r * 2 : 60);
  const h = base.h ?? size.h ?? (size.r ? size.r * 2 : 40);
  let x = base.x ?? 40;
  let y = base.y ?? 0;
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
  }
  const k = stage.scale;
  return { type: def.type ?? type, x: stage.rootX + x * k, y: stage.groundY - (y + h) * k, w: w * k, h: h * k, r: size.r, steps: base.steps ?? size.steps, rungs: base.rungs ?? size.rungs };
}

function propMarkup(prop, strokeWidth, color) {
  if (!prop) return "";
  const sw = num(strokeWidth);
  const attrs = `fill="#fff" stroke="${xml(color)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const x = prop.x, y = prop.y, w = prop.w, h = prop.h;
  if (prop.type === "ball") return `<circle data-prop="ball" cx="${num(x + w / 2)}" cy="${num(y + h / 2)}" r="${num(w / 2)}" ${attrs}/>`;
  if (prop.type === "ladder") {
    const rungs = prop.rungs ?? 7;
    const rung = Array.from({ length: rungs }, (_, i) => {
      const yy = y + h * (i + 1) / (rungs + 1);
      return `<path d="${line({ x: x + w * 0.16, y: yy }, { x: x + w * 0.84, y: yy })}"/>`;
    }).join("");
    return `<g data-prop="ladder" ${attrs}><path d="${line({ x: x + w * 0.14, y }, { x: x + w * 0.14, y: y + h })}"/><path d="${line({ x: x + w * 0.86, y }, { x: x + w * 0.86, y: y + h })}"/>${rung}</g>`;
  }
  if (prop.type === "chair") return `<g data-prop="chair" ${attrs}><path d="M${num(x + w * 0.2)} ${num(y)}L${num(x + w * 0.2)} ${num(y + h * 0.58)}L${num(x + w * 0.82)} ${num(y + h * 0.58)}"/><path d="M${num(x + w * 0.28)} ${num(y + h * 0.58)}L${num(x + w * 0.18)} ${num(y + h)}"/><path d="M${num(x + w * 0.76)} ${num(y + h * 0.58)}L${num(x + w * 0.88)} ${num(y + h)}"/></g>`;
  if (prop.type === "platform" || prop.type === "ledge") return `<rect data-prop="${prop.type}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="3" ${attrs}/>`;
  if (prop.type === "stairs") {
    const steps = prop.steps ?? 4;
    const d = Array.from({ length: steps }, (_, i) => `H${num(x + w * (i + 1) / steps)}V${num(y + h * (1 - (i + 1) / steps))}`).join("");
    return `<path data-prop="stairs" d="M${num(x)} ${num(y + h)}${d}" ${attrs}/>`;
  }
  if (prop.type === "desk") {
    // Desk with a monitor (screen lines) and a keyboard on the front edge; x..x+w is the tabletop.
    const top = y + h * 0.42, mw = w * 0.46, mx = x + w * 0.5, my = y, mh = h * 0.3;
    return `<g data-prop="desk" ${attrs}><path d="${line({ x, y: top }, { x: x + w, y: top })}"/><path d="${line({ x: x + w * 0.08, y: top }, { x: x + w * 0.08, y: y + h })}"/><path d="${line({ x: x + w * 0.92, y: top }, { x: x + w * 0.92, y: y + h })}"/><rect x="${num(mx)}" y="${num(my)}" width="${num(mw)}" height="${num(mh)}" rx="2"/><path d="${line({ x: mx + mw / 2, y: my + mh }, { x: mx + mw / 2, y: top })}"/><path d="${line({ x: mx + mw * 0.15, y: my + mh * 0.3 }, { x: mx + mw * 0.7, y: my + mh * 0.3 })}" stroke-width="${num(strokeWidth * 0.5)}"/><path d="${line({ x: mx + mw * 0.15, y: my + mh * 0.55 }, { x: mx + mw * 0.55, y: my + mh * 0.55 })}" stroke-width="${num(strokeWidth * 0.5)}"/><path d="${line({ x: x + w * 0.04, y: top - strokeWidth }, { x: x + w * 0.38, y: top - strokeWidth })}"/></g>`;
  }
  if (prop.type === "board") {
    const bh = h * 0.62;
    return `<g data-prop="board" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(bh)}" rx="2"/><path d="${line({ x: x + w * 0.2, y: y + bh }, { x: x + w * 0.12, y: y + h })}"/><path d="${line({ x: x + w * 0.8, y: y + bh }, { x: x + w * 0.88, y: y + h })}"/><path d="${line({ x: x + w * 0.25, y: y + bh + strokeWidth }, { x: x + w * 0.75, y: y + bh + strokeWidth })}"/></g>`;
  }
  if (prop.type === "card") return `<g data-prop="card" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2"/><path d="${line({ x: x + w * 0.15, y: y + h * 0.35 }, { x: x + w * 0.8, y: y + h * 0.35 })}" stroke-width="${num(strokeWidth * 0.5)}"/><path d="${line({ x: x + w * 0.15, y: y + h * 0.62 }, { x: x + w * 0.6, y: y + h * 0.62 })}" stroke-width="${num(strokeWidth * 0.5)}"/></g>`;
  if (prop.type === "banner") return `<g data-prop="banner" ${attrs}><path d="${line({ x: x + w * 0.85, y: y + h }, { x: x + w * 0.85, y: y + h + 40 })}" stroke-width="${num(strokeWidth * 0.5)}"/><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2"/><path d="${line({ x: x + w * 0.12, y: y + h * 0.45 }, { x: x + w * 0.88, y: y + h * 0.45 })}"/><path d="${line({ x: x + w * 0.2, y: y + h * 0.7 }, { x: x + w * 0.7, y: y + h * 0.7 })}" stroke-width="${num(strokeWidth * 0.5)}"/></g>`;
  if (prop.type === "door") return `<g data-prop="door" ${attrs}><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2"/><circle cx="${num(x + w * 0.82)}" cy="${num(y + h * 0.52)}" r="${num(Math.max(2, strokeWidth))}"/></g>`;
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

/**
 * All props for a review frame: the main prop (optionally carried by a hand via review.prop.attach =
 * {hand:"r"|"l", from, to, dx, dy, hiddenBefore}) plus static review.extraProps [{type,x,y,w,h}].
 * handAt(frame, side) returns the world-space hand point; it is only needed for attached props.
 */
function layoutScene(spec, propsCatalog, frameIndex, handAt, stage = { rootX: 160, groundY: 150, scale: 0.75 }) {
  const out = [];
  const main = layoutProp(spec, propsCatalog, frameIndex, stage);
  const attach = spec.review?.prop?.attach;
  if (main && attach && handAt) {
    const from = attach.from ?? 0, to = attach.to ?? Infinity;
    if (!(frameIndex < from && attach.hiddenBefore)) {
      if (frameIndex >= from) {
        const hand = handAt(Math.min(frameIndex, to), attach.hand === "l" ? "left" : "right");
        main.x = hand.x - main.w / 2 + (attach.dx ?? 0) * stage.scale;
        main.y = hand.y - main.h / 2 - (attach.dy ?? 0) * stage.scale;
        main.front = true;
      }
      out.push(main);
    }
  } else if (main) out.push(main);
  for (const extra of spec.review?.extraProps ?? []) {
    const p = layoutProp({ prop: extra.type, review: { prop: extra } }, propsCatalog, frameIndex, stage);
    if (p) out.push(p);
  }
  return out;
}

function handFromSample(sample, side) {
  const fore = sample.segments.find((s) => s.id === `${side}-forearm`);
  return { x: fore.x2, y: fore.y2 };
}

function viewBoxFor(sample) {
  const torso = sample.segments.find((segment) => segment.id === "torso");
  const cx = torso ? (torso.x1 + torso.x2) / 2 : 160;
  return `${num(cx - 160)} -54 320 224`;
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
  const handAt = (ix, side) => handFromSample(engineSampledFrame(sampleClipMotion, clip, ix), side);
  const props = layoutScene(spec, propsCatalog, frameIndex, handAt);
  const back = props.filter((p) => !p.front).map((p) => propMarkup(p, geometry.strokeWidth, "#202124")).join("");
  const front = props.filter((p) => p.front).map((p) => propMarkup(p, geometry.strokeWidth, "#202124")).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBoxFor(sample)}" role="img" aria-label="${xml(clip.name)} frame ${frameIndex}"><rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff"/><path id="ground" d="M-10000 ${num(sample.groundY)}H10000" stroke="#d8dbe0" stroke-width="1"/>${back}${onionMarkup}${figureMarkup(sample, geometry)}${front}<text x="${num(Number(viewBoxFor(sample).split(" ")[0]) + 6)}" y="-42" font-size="9" fill="#888">${xml(clip.name)} f${frameIndex}</text></svg>`;
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
  return `const ENGINE_FRAME_GEOMETRY=${frameGeometry.toString()};
${sampleMotionClip.toString()}
${sampleClipMotion.toString()}
const engineSampledFrame=${engineSampledFrame.toString()};
const figureMarkup=${figureMarkup.toString()};
const layoutProp=${layoutProp.toString()};
const layoutScene=${layoutScene.toString()};
const handFromSample=${handFromSample.toString()};
const propMarkup=${propMarkup.toString()};
const xml=${xml.toString()}; const num=${num.toString()}; const line=${line.toString()};`;
}

export async function renderReviewHtml({ clip, spec, report, propsCatalog }) {
  const { frameGeometry, sampleMotionClip, sampleClipMotion } = await loadEngineRenderer();
  const runFrames = await shippingRunFrames();
  const data = JSON.stringify({ clip, spec, report, runFrames, propsCatalog }).replaceAll("<", "\\u003c");
  return `<!doctype html><html><meta charset="utf-8"><title>${xml(clip.name)} motion review</title><style>
body{font:14px system-ui;margin:0;background:#f7f7f8;color:#1f2328}.bar{position:sticky;top:0;background:white;border-bottom:1px solid #ddd;padding:10px;z-index:3}.bare .bar,.bare h3,.bare .film{display:none}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}.bare main{display:block;padding:0}.panel{background:white;border:1px solid #ddd;border-radius:12px;padding:10px}.bare .panel{border:0;border-radius:0;padding:0}svg.stage{width:100%;height:440px}.bare svg.stage{width:100vw;height:100vh}.film{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.film svg{height:90px;background:#fafafa;border-radius:8px}button,select,input{vertical-align:middle}</style><body><div class="bar"><b>${xml(clip.name)}</b> <button id="play">pause</button> speed <select id="speed"><option value=".1">0.1x</option><option value=".25">0.25x</option><option value=".5">0.5x</option><option value="1" selected>1x</option></select> onion <input id="onion" type="checkbox"> frame <input id="scrub" type="range" min="0" max="${clip.frames.length - 1}" value="0"> <span id="frameNo">0</span></div><main><section class="panel"><h3>Candidate (shipping engine)</h3><svg id="stage" class="stage"></svg><div id="film" class="film"></div></section><section class="panel" id="refPanel"><h3>Approved run (shipping engine)</h3><svg id="ref" class="stage"></svg></section></main><script id="data" type="application/json">${data}</script><script>
const ENGINE_FRAME_GEOMETRY=${frameGeometry.toString()};
${sampleMotionClip.toString()}
${sampleClipMotion.toString()}
const engineSampledFrame=${engineSampledFrame.toString()};
const figureMarkup=${figureMarkup.toString()};
const layoutProp=${layoutProp.toString()};
const layoutScene=${layoutScene.toString()};
const handFromSample=${handFromSample.toString()};
const propMarkup=${propMarkup.toString()};
const viewBoxFor=${viewBoxFor.toString()};
const xml=${xml.toString()}; const num=${num.toString()}; const line=${line.toString()};
const D=JSON.parse(document.getElementById('data').textContent),clip=D.clip,runFrames=D.runFrames,spec=D.spec,propsCatalog=D.propsCatalog; let f=0,playing=true,last=performance.now();
function drawRef(){const s=runFrames[Math.floor(performance.now()/1000*30)%runFrames.length],g=ENGINE_FRAME_GEOMETRY(s);ref.setAttribute('viewBox','200 '+num(s.groundY-260)+' 1200 330');ref.innerHTML='<rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff"/><path d="M-10000 '+num(s.groundY)+'H10000" stroke="#d8dbe0"/>'+figureMarkup(s,g);}
const params=new URLSearchParams(location.search); if(params.get('bare')==='1')document.body.classList.add('bare'); if(params.has('onion'))onion.checked=params.get('onion')!=='0'; if(params.has('frame')){f=Number(params.get('frame'))||0;playing=false;play.textContent='play';scrub.value=Math.max(0,Math.min(clip.frames.length-1,Math.round(f)));}
function drawSvg(svg,c,ix,onionMode,withProp){const sample=engineSampledFrame(sampleClipMotion,c,ix),g=ENGINE_FRAME_GEOMETRY(sample);svg.setAttribute('viewBox',viewBoxFor(sample));let h='<rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff"/><path d="M-10000 '+num(sample.groundY)+'H10000" stroke="#d8dbe0"/>';const scene=withProp?layoutScene(spec,propsCatalog,ix,(j,side)=>handFromSample(engineSampledFrame(sampleClipMotion,c,j),side)):[];for(const p of scene)if(!p.front)h+=propMarkup(p,g.strokeWidth,'#202124');if(onionMode){for(const d of [-6,-3,3,6]){const oi=ix+d;if(oi>=0&&oi<c.frames.length){const os=engineSampledFrame(sampleClipMotion,c,oi);h+=figureMarkup(os,ENGINE_FRAME_GEOMETRY(os),'#202124',.18);}}}h+=figureMarkup(sample,g);for(const p of scene)if(p.front)h+=propMarkup(p,g.strokeWidth,'#202124');svg.innerHTML=h;}
for(let k=0;k<8;k++){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');drawSvg(s,clip,Math.round(k*(clip.frames.length-1)/7),false,true);film.append(s)}play.onclick=()=>{playing=!playing;play.textContent=playing?'pause':'play'};scrub.oninput=()=>{playing=false;play.textContent='play';f=Number(scrub.value);draw()};function draw(){const ix=Math.max(0,Math.min(clip.frames.length-1,f));scrub.value=Math.floor(ix);frameNo.textContent=String(Math.floor(ix));drawSvg(stage,clip,ix,onion.checked,true);drawRef()}function tick(t){const dt=(t-last)/1000;last=t;if(playing){f=f+dt*clip.fps*Number(speed.value);if(f>clip.frames.length-1)f=clip.loop?f%clip.frames.length:(f>clip.frames.length-1+20?0:f);}draw();requestAnimationFrame(tick)}draw();if(params.get('bare')!=='1')requestAnimationFrame(tick);</script></body></html>`;
}
