import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function loadEngineRenderer() {
  try {
    const [render, clips] = await Promise.all([
      import(pathToFileURL(path.join(repo, "dist", "render.js")).href),
      import(pathToFileURL(path.join(repo, "dist", "motion-clips.js")).href)
    ]);
    return { ...render, ...clips };
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

export async function clipFrameToSampledFrame(clip, frameIndex, options = {}) {
  const { sampleClipFrameAsSampledFrame } = await loadEngineRenderer();
  return sampleClipFrameAsSampledFrame(clip, { ...options, frameIndex });
}


function layoutProp(spec, propsCatalog, frameIndex = 0) {
  const type = spec.prop;
  if (!type) return null;
  const def = propsCatalog.props?.find((item) => item.type === type) ?? propsCatalog.props?.find((item) => item.type === (type === "bench" ? "chair" : type));
  if (!def) return null;
  const size = def.defaultSize ?? { w: 80, h: 60 };
  const review = spec.review ?? {};
  const base = review.prop ?? {};
  const w = base.w ?? size.w ?? (size.r ? size.r * 2 : 80);
  const h = base.h ?? size.h ?? (size.r ? size.r * 2 : 60);
  let x = base.x ?? 145;
  let y = base.y ?? 126 - h;
  const keys = review.propMotion;
  if (Array.isArray(keys) && keys.length) {
    const sorted = [...keys].sort((a, b) => a.frame - b.frame);
    let a = sorted[0], b = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) if (frameIndex >= sorted[i].frame && frameIndex <= sorted[i + 1].frame) { a = sorted[i]; b = sorted[i + 1]; break; }
    const t = b.frame === a.frame ? 0 : Math.max(0, Math.min(1, (frameIndex - a.frame) / (b.frame - a.frame)));
    x += (a.x ?? 0) + ((b.x ?? a.x ?? 0) - (a.x ?? 0)) * t;
    y += (a.y ?? 0) + ((b.y ?? a.y ?? 0) - (a.y ?? 0)) * t;
  }
  return { type: def.type, x, y, w, h, r: size.r, steps: size.steps, rungs: size.rungs };
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

export async function renderStaticSvg({ clip, spec, propsCatalog, frameIndex = 0, onion = false, width = 1000, height = 700 }) {
  const { frameGeometry, sampleClipFrameAsSampledFrame } = await loadEngineRenderer();
  const sample = sampleClipFrameAsSampledFrame(clip, { frameIndex });
  const geometry = frameGeometry(sample);
  const center = sample.segments.find((segment) => segment.id === "torso");
  const cx = center ? (center.x1 + center.x2) / 2 : 120;
  const viewBox = `${num(cx - 160)} 0 320 170`;
  const onionFrames = onion ? [-6, -3, 3, 6].map((delta) => frameIndex + delta).filter((ix) => ix >= 0 && ix < clip.frames.length) : [];
  const onionMarkup = onionFrames.map((ix) => {
    const f = sampleClipFrameAsSampledFrame(clip, { frameIndex: ix });
    return figureMarkup(f, frameGeometry(f), "#202124", 0.18);
  }).join("");
  const prop = layoutProp(spec, propsCatalog, frameIndex);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${xml(clip.name)} frame ${frameIndex}"><rect width="100%" height="100%" fill="#fff"/><path id="ground" d="M-10000 ${num(sample.groundY)}H10000" stroke="#d8dbe0" stroke-width="1"/>${propMarkup(prop, geometry.strokeWidth, "#202124")}${onionMarkup}${figureMarkup(sample, geometry)}</svg>`;
}

export async function assertReviewGeometryMatchesEngine(clip) {
  const { frameGeometry, sampleClipFrameAsSampledFrame } = await loadEngineRenderer();
  const sample = sampleClipFrameAsSampledFrame(clip, { frameIndex: 0 });
  const fromEngine = frameGeometry(sample);
  const fromReview = frameGeometry(sample);
  if (JSON.stringify(fromReview) !== JSON.stringify(fromEngine)) throw new Error("Review renderer geometry diverged from dist/render.js frameGeometry.");
}

export async function renderReviewHtml({ clip, spec, report, runClip, propsCatalog }) {
  await assertReviewGeometryMatchesEngine(clip);
  const { frameGeometry, sampleMotionClip, sampleClipFrameAsSampledFrame } = await loadEngineRenderer();
  const data = JSON.stringify({ clip, spec, report, runClip, propsCatalog }).replaceAll("<", "\\u003c");
  return `<!doctype html><html><meta charset="utf-8"><title>${xml(clip.name)} motion review</title><style>
body{font:14px system-ui;margin:0;background:#f7f7f8;color:#1f2328}.bar{position:sticky;top:0;background:white;border-bottom:1px solid #ddd;padding:10px;z-index:3}.bare .bar,.bare h3,.bare .film{display:none}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}.bare main{display:block;padding:0}.panel{background:white;border:1px solid #ddd;border-radius:12px;padding:10px}.bare .panel{border:0;border-radius:0;padding:0}svg.stage{width:100%;height:440px}.bare svg.stage{width:100vw;height:100vh}.film{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.film svg{height:90px;background:#fafafa;border-radius:8px}button,select,input{vertical-align:middle}</style><body><div class="bar"><b>${xml(clip.name)}</b> <button id="play">pause</button> speed <select id="speed"><option value=".1">0.1x</option><option value=".25">0.25x</option><option value=".5">0.5x</option><option value="1" selected>1x</option></select> onion <input id="onion" type="checkbox"> frame <input id="scrub" type="range" min="0" max="${clip.frames.length - 1}" value="0"> <span id="frameNo">0</span></div><main><section class="panel"><h3>Candidate</h3><svg id="stage" class="stage"></svg><div id="film" class="film"></div></section><section class="panel" id="refPanel"><h3>Approved run reference</h3><svg id="ref" class="stage"></svg></section></main><script id="data" type="application/json">${data}</script><script>
const ENGINE_FRAME_GEOMETRY=${frameGeometry.toString()};
const sampleMotionClip=${sampleMotionClip.toString()};
const sampleClipFrameAsSampledFrame=${sampleClipFrameAsSampledFrame.toString()};
const figureMarkup=${figureMarkup.toString()};
const layoutProp=${layoutProp.toString()};
const propMarkup=${propMarkup.toString()};
const xml=${xml.toString()}; const num=${num.toString()}; const line=${line.toString()};
const D=JSON.parse(document.getElementById('data').textContent),clip=D.clip,runClip=D.runClip,spec=D.spec,propsCatalog=D.propsCatalog; let f=0,playing=true,last=performance.now();
const params=new URLSearchParams(location.search); if(params.get('bare')==='1')document.body.classList.add('bare'); if(params.has('onion'))onion.checked=params.get('onion')!=='0'; if(params.has('frame')){f=Number(params.get('frame'))||0;playing=false;play.textContent='play';scrub.value=Math.max(0,Math.min(clip.frames.length-1,Math.round(f)));}
function drawSvg(svg,c,ix,onionMode=false){const sample=sampleClipFrameAsSampledFrame(c,{frameIndex:ix}),g=ENGINE_FRAME_GEOMETRY(sample),torso=sample.segments.find(s=>s.id==='torso'),cx=torso?(torso.x1+torso.x2)/2:120;svg.setAttribute('viewBox',(cx-160)+' 0 320 170');let h='<rect width="100%" height="100%" fill="#fff"/><path d="M-10000 '+num(sample.groundY)+'H10000" stroke="#d8dbe0"/>';const prop=layoutProp(spec,propsCatalog,ix);h+=propMarkup(prop,g.strokeWidth,'#202124');if(onionMode){for(const d of [-6,-3,3,6]){const oi=ix+d;if(oi>=0&&oi<c.frames.length){const os=sampleClipFrameAsSampledFrame(c,{frameIndex:oi});h+=figureMarkup(os,ENGINE_FRAME_GEOMETRY(os),'#202124',.18);}}}h+=figureMarkup(sample,g);svg.innerHTML=h;}
for(let k=0;k<8;k++){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');drawSvg(s,clip,Math.round(k*(clip.frames.length-1)/7),true);film.append(s)}play.onclick=()=>{playing=!playing;play.textContent=playing?'pause':'play'};scrub.oninput=()=>{playing=false;play.textContent='play';f=Number(scrub.value);draw()};function draw(){const ix=Math.max(0,Math.min(clip.frames.length-1,Math.floor(f)));scrub.value=ix;frameNo.textContent=String(ix);drawSvg(stage,clip,ix,onion.checked);drawSvg(ref,runClip,Math.floor((performance.now()/1000*runClip.fps)%runClip.frames.length),false)}function tick(t){const dt=(t-last)/1000;last=t;if(playing)f=(f+dt*clip.fps*Number(speed.value))%clip.frames.length;draw();requestAnimationFrame(tick)}draw();if(params.get('bare')!=='1')requestAnimationFrame(tick);</script></body></html>`;
}
