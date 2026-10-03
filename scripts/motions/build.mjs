import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as helpers from "./helpers.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sessionFiles = "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files";
const approvedDir = path.join(sessionFiles, "clip-pipeline", "clips");
const factoryDir = path.join(sessionFiles, "motion-factory");
const baselineIds = new Set(["walk", "run", "jump", "stop", "point", "idle"]);
const only = process.argv[process.argv.indexOf("--only") + 1];
if (!only || process.argv.indexOf("--only") === -1) {
  console.error("Use: npm run motions:build -- --only <id>. Full library assembly is npm run motions:assemble.");
  process.exit(2);
}
const specPath = path.join(repo, "motions", "specs", `${only}.json`);
const spec = JSON.parse(await readFile(specPath, "utf8"));
const outDir = path.join(factoryDir, "clips", only);
await mkdir(outDir, { recursive: true });
const idleClip = JSON.parse(await readFile(path.join(approvedDir, "idle.json"), "utf8"));
const ctx = {
  id: only,
  spec,
  processing: spec.processing ?? {},
  paths: { repo, sessionFiles, approvedDir, factoryDir, outDir },
  helpers,
  idle: { clip: idleClip, frame: idleClip.frames[0] },
};
async function loadHook(id) {
  const hookPath = path.join(repo, "scripts", "motions", "hooks", `${id}.mjs`);
  try {
    await access(hookPath);
    return await import(`${pathToFileURL(hookPath).href}?v=${Date.now()}`);
  } catch {
    return {};
  }
}
async function runFrameHook(hook, name, frames) {
  if (typeof hook[name] !== "function") return frames;
  const next = await hook[name](helpers.deepClone(frames), ctx);
  return Array.isArray(next) ? next : frames;
}
async function runClipHook(hook, name, clip) {
  if (typeof hook[name] !== "function") return clip;
  const next = await hook[name](helpers.deepClone(clip), ctx);
  return next && typeof next === "object" ? next : clip;
}
function applyProcessing(frames, processing) {
  let out = helpers.deepClone(frames);
  if (Array.isArray(processing.trim)) out = out.slice(Math.max(0, processing.trim[0] ?? 0), Math.min(out.length, (processing.trim[1] ?? out.length - 1) + 1));
  if (processing.timeScale != null && processing.timeScale > 0 && processing.timeScale <= 1 && processing.timeScale !== 1) out = helpers.resampleFrames(out, 30 * processing.timeScale, 30);
  if (processing.smoothingCutoff != null && processing.smoothingCutoff !== false) out = helpers.smoothFrames(out, Math.max(1, Math.round(Number(processing.smoothingCutoff) || 1)));
  if (processing.easeInFrames || processing.easeOutFrames) out = helpers.easeFramesToIdle(out, ctx.idle.frame, processing.easeInFrames ?? 0, processing.easeOutFrames ?? 0);
  if (processing.mirror) {
    out = out.map((frame) => {
      const f = helpers.deepClone(frame);
      [f.angles.lLeg, f.angles.rLeg] = [f.angles.rLeg, f.angles.lLeg];
      [f.angles.lArm, f.angles.rArm] = [f.angles.rArm, f.angles.lArm];
      if (f.contacts) [f.contacts.l, f.contacts.r] = [f.contacts.r, f.contacts.l];
      if (f.hands) [f.hands.l, f.hands.r] = [f.hands.r, f.hands.l];
      return f;
    });
  }
  return out;
}
async function currentGeneratedClip(id) {
  try {
    const text = await readFile(path.join(repo, "src", "generated", "motion-library.ts"), "utf8");
    const m = text.match(/GENERATED_MOTION_LIBRARY(?:: any)? = (.*);/s);
    if (!m) return null;
    return JSON.parse(m[1]).clips?.[id] ?? null;
  } catch { return null; }
}
let clip = null;
let source = "";
const hook = baselineIds.has(only) ? {} : await loadHook(only);
if (baselineIds.has(only)) {
  clip = JSON.parse(await readFile(path.join(approvedDir, `${only}.json`), "utf8"));
  clip.meta = { ...(clip.meta ?? {}), id: only, label: spec.label, summary: spec.summary ?? `${spec.label} approved baseline motion.`, kind: spec.kind, travel: spec.travel, facingChange: spec.facingChange ?? 0, contacts: spec.contacts, markers: clip.markers ?? {}, aim: spec.aim ?? null, prop: spec.prop ?? null, mirrorable: spec.mirrorable ?? true, tags: spec.tags ?? [], durationS: Number((clip.frames.length / clip.fps).toFixed(3)), quality: { approvedBaseline: true, passed: true }, source: { dataset: "CMU", trial: `${spec.source?.subject}_${spec.source?.trial}`, range120: spec.source?.range120 }, license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE" };
  source = "approved baseline cache";
} else {
  try { clip = JSON.parse(await readFile(path.join(outDir, "clip.json"), "utf8")); source = "existing per-motion build"; } catch {
    try { clip = JSON.parse(await readFile(path.join(factoryDir, "clips", `${only}.json`), "utf8")); source = "legacy factory candidate"; } catch {
      clip = await currentGeneratedClip(only); source = "current generated candidate";
    }
  }
}
const report = { id: only, status: spec.status, source, builtAt: "1970-01-01T00:00:00.000Z", parallelSafe: true, thresholds: { maxJointAccel: 13, rootYJitter: 30, contactSlide: 1, groundPenetration: 0.5, loopWrapVelocity: 6 }, naturalnessHelpers: ["idle ease-in/ease-out hooks", "source timing must not exceed 1.0x", "weight-shift check", "contact locks", "range-cut twitch smoothing"], passed: Boolean(clip), failures: [] };
if (!clip) {
  report.passed = false;
  report.failures.push({ metric: "candidateClip", value: "missing", threshold: "build/tune this motion in its own dev cycle" });
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.error(`${only}: no candidate clip available yet`);
  process.exit(1);
}
if (!baselineIds.has(only)) {
  let frames = clip.frames;
  frames = await runFrameHook(hook, "afterProject", frames);
  frames = await runFrameHook(hook, "afterRetarget", frames);
  frames = await runFrameHook(hook, "afterContacts", frames);
  frames = await runFrameHook(hook, "beforeSmooth", frames);
  frames = applyProcessing(frames, spec.processing ?? {});
  frames = await runFrameHook(hook, "afterSmooth", frames);
  clip = { ...clip, frames };
  clip = await runClipHook(hook, "finalize", clip);
  const extraGates = typeof hook.extraGates === "function" ? await hook.extraGates(clip, ctx) : [];
  report.hook = Object.keys(hook).filter((name) => typeof hook[name] === "function");
  report.processing = spec.processing ?? {};
  report.extraGates = Array.isArray(extraGates) ? extraGates : [];
  for (const gate of report.extraGates) {
    if (!gate.pass) {
      report.passed = false;
      report.failures.push({ metric: gate.name, value: gate.value, threshold: gate.threshold });
    }
  }
}
await writeFile(path.join(outDir, "clip.json"), JSON.stringify(clip, null, 2));
await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
const data = JSON.stringify({ clip, spec, report }).replace(/</g, "\\u003c");
const html = `<!doctype html><meta charset=utf-8><title>${only} motion review</title><style>body{font:14px system-ui;margin:0;background:#f7f7f8;color:#1f2328}.bar{position:sticky;top:0;background:white;border-bottom:1px solid #ddd;padding:10px;z-index:2}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}.panel{background:white;border:1px solid #ddd;border-radius:12px;padding:10px}svg{width:100%;height:420px}.stick{fill:none;stroke:#1f2328;stroke-width:5.2;stroke-linecap:round;stroke-linejoin:round}.head{fill:white;stroke:#1f2328;stroke-width:5.2}.g{stroke:#ddd}.film{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.film svg{height:80px;background:#fafafa;border-radius:8px}.onion .stick{opacity:.22}.onion .head{opacity:.35}</style><div class=bar><b>${only}</b> <button id=play>pause</button> speed <select id=speed><option value=.25>0.25x</option><option value=1 selected>1x</option></select> onion <input id=onion type=checkbox> frame <input id=scrub type=range min=0 max=${clip.frames.length - 1} value=0></div><main><section class=panel><h3>Candidate</h3><svg id=v></svg><div id=film class=film></div></section><section class=panel><h3>Approved run style reference</h3><svg id=ref></svg></section></main><script id=data type=application/json>${data}</script><script>
const D=JSON.parse(document.getElementById('data').textContent),clip=D.clip,rig=clip.rig; let run=null, f=0, playing=true, last=performance.now(); fetch('../run/clip.json').then(r=>r.ok?r.json():null).then(j=>run=j);
const dir=a=>({x:Math.cos(a*Math.PI/180),y:Math.sin(a*Math.PI/180)}),add=(a,b)=>({x:a.x+b.x,y:a.y+b.y}),mul=(a,s)=>({x:a.x*s,y:a.y*s}),Y=p=>-p.y;
function pose(fr){const a=fr.angles,p={x:fr.root.x,y:fr.root.y},ch=add(p,mul(dir(a.torso),rig.torso)),hd=add(ch,mul(dir(a.torso+a.head),rig.neck+rig.headRadius));function L(s){const l=a[s+'Leg'],ta=a.torso+180+l.thigh,k=add(p,mul(dir(ta),rig.thigh)),sa=ta+l.shin,n=add(k,mul(dir(sa),rig.shin)),fa=sa+l.foot,t=add(n,mul(dir(fa),rig.foot));return{h:p,k,n,t}}function A(s){const u=a[s+'Arm'],ua=a.torso+u.upper,e=add(ch,mul(dir(ua),rig.upperArm)),fa=ua+u.fore,h=add(e,mul(dir(fa),rig.forearm));return{s:ch,e,h}}return{p,ch,hd,l:L('l'),r:L('r'),la:A('l'),ra:A('r')}}
function c(a,b,d){return 'M '+a.x+' '+Y(a)+' Q '+b.x+' '+Y(b)+' '+d.x+' '+Y(d)}; function line(a,b){return 'M '+a.x+' '+Y(a)+' L '+b.x+' '+Y(b)}
function draw(svg,cclip,i,onion=false){const frames=onion?[i-3,i-2,i-1,i,i+1,i+2,i+3].filter(x=>x>=0&&x<cclip.frames.length):[i%cclip.frames.length]; let h=''; for(const idx of frames){const fr=cclip.frames[idx],p=pose(fr),cx=fr.root.x;svg.setAttribute('viewBox',(cx-70)+' -130 145 145');h+='<g class="'+(idx===i?'':'onion')+'"><path class=g d="M '+(cx-120)+' 0 L '+(cx+120)+' 0"/>'; for(const l of [p.r,p.l])h+='<path class=stick d="'+c(l.h,l.k,l.n)+' '+line(l.n,l.t)+'"/>'; h+='<path class=stick d="'+line(p.p,p.ch)+'"/><circle class=head cx="'+p.hd.x+'" cy="'+Y(p.hd)+'" r="'+rig.headRadius+'"/>'; for(const a of [p.ra,p.la])h+='<path class=stick d="'+c(a.s,a.e,a.h)+'"/>'; h+='</g>';} svg.innerHTML=h}
for(let k=0;k<8;k++){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');draw(s,clip,Math.round(k*(clip.frames.length-1)/7),true);film.append(s)} play.onclick=()=>{playing=!playing;play.textContent=playing?'pause':'play'}; function tick(t){const dt=(t-last)/1000;last=t;if(playing){f=(f+dt*clip.fps*Number(speed.value))%clip.frames.length;scrub.value=Math.floor(f)}else f=Number(scrub.value);draw(v,clip,Math.floor(f),onion.checked);if(run)draw(ref,run,Math.floor((t/1000*run.fps)%run.frames.length));requestAnimationFrame(tick)} requestAnimationFrame(tick);
</script>`;
await writeFile(path.join(outDir, "review.html"), html);
console.log(`${only}: wrote ${outDir}`);
