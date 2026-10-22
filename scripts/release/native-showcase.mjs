// Native playback shell, authored here. Never reads a rendered external deck.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { composePerformance, createPerformanceRenderer, performanceContinuity } from "../site/performance.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";
import { engineSampledFrame } from "../motions/review-renderer.mjs";
import { videoRecipes } from "../site/story-films.mjs";
import { createStoryRenderer, encodeVideo, loadShowcaseResources } from "../film/runtime.mjs";
import { repo, readMotion } from "../site/catalogue.mjs";

const sceneIds = ["question", "on-prem", "cloud", "evidence", "decision"];
// The workload has one fixed identity. Diagrams live on the same grid throughout.
const diagramScript = `
const labels={
question:["Should this workload move?","Compare demand, requirements and total cost before choosing a home."],
"on-prem":["Understand the current workload","Measure demand and capacity. Existing hosting remains a valid option."],
cloud:["Evaluate the cloud option","Match resources and controls to the same workload, not to a promise of savings."],
evidence:["Gather four pieces of evidence","Use a comparable baseline, requirements, total cost and a time-boxed pilot."],
decision:["Make a conditional decision","Move only if requirements and costs fit. Otherwise retain local hosting."]
};
const box=(x,y,w,h)=>'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="12" fill="var(--cp-surface)" stroke="var(--cp-border-strong)" stroke-width="2"/>';
const txt=(x,y,s,anchor="start",size=26)=>'<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" font-size="'+size+'" font-family="Segoe UI, Aptos, sans-serif" fill="var(--cp-text)">'+s+'</text>';
function diagram(slide,local){
  let out=box(270,30,660,76)+'<path d="M270 42a12 12 0 0 1 12-12h636a12 12 0 0 1 12 12v4H270Z" fill="var(--cp-accent)"/>'+txt(600,79,"Workload · same requirements", "middle",28);
  if(slide==="question"){
    out+='<path d="M425 106v44m350-44v44" stroke="var(--cp-border-strong)" stroke-width="3"/>';
    out+=box(270,150,310,200)+box(620,150,310,200);
    out+='<path d="M580 250h40" stroke="var(--cp-accent)" stroke-width="3" stroke-dasharray="6 6"/>';
    out+=txt(425,211,"Existing hosting","middle",28)+txt(425,269,"Measured baseline","middle",24);
    out+=txt(775,211,"Cloud option","middle",28)+txt(775,269,"Evidence required","middle",24);
  }else if(slide==="on-prem"){
    out+=box(270,150,660,200)+txt(310,201,"Current capacity", "start",28);
    out+='<path d="M300 245h280" stroke="var(--cp-border-strong)" stroke-width="2" stroke-dasharray="5 5"/>';
    const bars=[.28,.40,.58,.83,.44];
    bars.forEach((h,i)=>{const active=local>=i*30?1:.45;out+='<rect x="'+(310+i*56)+'" y="'+(321-h*94)+'" width="34" height="'+(h*94)+'" rx="4" fill="var(--cp-accent)" opacity="'+active+'"/>';});
    out+=txt(745,262,"Demand varies","middle",24)+txt(745,310,"Measure first","middle",24);
  }else if(slide==="cloud"){
    out+=box(270,150,660,200)+txt(310,201,"Choose resource capacity","start",28);
    out+='<path d="M470 275h24m160 0h24" stroke="var(--cp-border-strong)" stroke-width="3"/>';
    [0,1,2].forEach(i=>{
      const opacity=Math.max(0,Math.min(1,(local-(55+i*40))/20));
      out+='<g opacity="'+opacity+'">'+box(310+i*184,237,160,76)+txt(390+i*184,284,["Compute","Storage","Controls"][i],"middle",24)+'</g>';
    });
  }else if(slide==="evidence"){
    out+='<path d="M580 191h40M580 310h40M425 239v24M775 239v24" stroke="var(--cp-border-strong)" stroke-width="2"/>';
    [["Baseline",270,144],["Requirements",620,144],["Total cost",270,263],["Pilot results",620,263]].forEach(([s,x,y],i)=>{
      out+=box(x,y,310,95)+txt(x+155,y+58,s,"middle",26);
      if(local>=i*60)out+='<path d="M'+(x+22)+' '+(y+18)+'h56" stroke="var(--cp-accent)" stroke-width="5" stroke-linecap="round"/>';
    });
  }else{
    out+='<path d="M600 106v22H425v22M600 128h175v22" fill="none" stroke="var(--cp-accent)" stroke-width="3"/>';
    out+=box(270,150,310,200)+box(620,150,310,200);
    out+=txt(425,198,"Move if","middle",28)+txt(425,251,"Requirements fit","middle",24)+txt(425,295,"Costs support it","middle",24);
    out+=txt(775,198,"Retain if","middle",28)+txt(775,251,"Local fits better","middle",24)+txt(775,295,"Constraints remain","middle",24);
  }
  return out;
}
`;

export async function nativeCloudHtml() {
  const resources = await loadShowcaseResources();
  if (!resources.approved.has("present")) throw new Error("Native story needs an approved presenter source.");
  const original = await readMotion("present");
  // Slow the approved gesture's key timing 4x, not its geometry, for a calm
  // co-presenter. No deck console taps, replant hops or moving workload glyph.
  const spec = { ...original.spec, id: "quiet-present", frames: (original.spec.frames - 1) * 4 + 1,
    poseKeys: original.spec.poseKeys.map(key => ({ ...key, frame: key.frame * 4 })), markers: {} };
  const neutral = original.clip.frames[0], clip = buildKeyPoseClip(spec, neutral);
  if (!(await keyPoseGates(clip, spec)).passed) throw new Error("Quiet presenter failed anatomy/contact gates.");
  const motions = new Map([["quiet-present", { sourceId: "present", spec, clip }]]);
  const performance = composePerformance(sceneIds.map((id, i) => ({
    motion: "quiet-present", ...(i === 0 ? { root: 400 } : { gap: 25 }), hold: 36, beat: id
  })), { motions, sampleClipMotion: resources.sampleClipMotion, neutral });
  const continuity = performanceContinuity(performance, resources.sampleClipMotion);
  if (continuity.maxJointStep > 14 || continuity.footSlides.length) throw new Error("Quiet presenter continuity failed.");
  const timeline = performance.segments.map((segment, i) => ({ id: sceneIds[i],
    startFrame: segment.gapStart, frames: segment.end - segment.gapStart + 1 }));
  if (performance.frames > 1800) throw new Error("Native cloud story exceeds one minute.");
  const render = createPerformanceRenderer(performance, { ...resources, motions, theme: svg =>
    svg.replace(/(fill|stroke)="(#[a-fA-F0-9]{3,8}|rgba?\([^"]+\))"/g, (_, attr, color) =>
      `${attr}="var(--cp-${/^#(?:fff|f\w{5}|e\w{5})$/i.test(color) ? "surface" : "text"})"`) });
  const dict = [], frames = [], seen = new Map();
  let maxStep = 0, maxAcceleration = 0, worstAccelerationFrame = 0, previous, previousVelocity;
  for (let frame = 0; frame < performance.frames; frame++) {
    const actor = `<g transform="translate(-100 120) scale(.5)">${(await render(frame)).actor}</g>`;
    if (!seen.has(actor)) { seen.set(actor, dict.length); dict.push(actor); }
    frames.push(seen.get(actor));
    const sample = engineSampledFrame(resources.sampleClipMotion, performance.clip, frame);
    const current = [sample.head, ...sample.segments.map(segment => ({ x: segment.x2, y: segment.y2 }))];
    if (previous) {
      const velocity = current.map((point, i) => ({ x: (point.x - previous[i].x) * .75 * performance.scale * .5,
        y: (point.y - previous[i].y) * .75 * performance.scale * .5 }));
      for (let i = 0; i < velocity.length; i++) {
        maxStep = Math.max(maxStep, Math.hypot(velocity[i].x, velocity[i].y));
        if (previousVelocity) {
          const acceleration = Math.hypot(velocity[i].x - previousVelocity[i].x, velocity[i].y - previousVelocity[i].y);
          if (acceleration > maxAcceleration) { maxAcceleration = acceleration; worstAccelerationFrame = frame; }
        }
      }
      previousVelocity = velocity;
    }
    previous = current;
  }
  // A stricter visible-scale check than the film's hard-join limit alone.
  if (maxStep > 4 || maxAcceleration > 2) throw new Error(`Native presenter too abrupt: step ${maxStep}, acceleration ${maxAcceleration} at frame ${worstAccelerationFrame}`);
  const data = { dict, frames, timeline, framesTotal: performance.frames };
  const css = await readFile(join(repo, "site/styles.css"), "utf8");
  const detection = (await readFile(join(repo, "site/index.html"), "utf8")).match(/<script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/)[0];
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Workload migration comparison · Native Stickman</title>
${detection}<style>${css}
body{margin:0;padding:16px;background:var(--cp-bg);color:var(--cp-text)}
main{max-width:1100px;margin:auto}h1{font-size:clamp(22px,4vw,36px);margin:8px 0}
.stage{width:100%;background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:16px}
.mobile-evidence{display:none}
@media(max-width:600px){.stage{display:none}.mobile-evidence{display:grid;gap:12px;padding:16px;border:1px solid var(--cp-border);border-radius:16px;background:var(--cp-surface)}.mobile-evidence li{font-size:18px;line-height:1.5}}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0}
input[type=range]{flex:1;min-width:160px;accent-color:var(--cp-accent)}
button{border:1px solid var(--cp-border-strong);border-radius:.625rem;padding:8px 16px;background:var(--cp-surface);color:var(--cp-text)}
</style></head><body><main><p class="eyebrow">Original native Stickman example</p>
<h1 id="heading">Should this workload move?</h1><p id="message" aria-live="polite"></p>
<svg id="stage" class="stage" viewBox="0 0 1000 420" role="img" aria-label="Stickman explains workload migration evidence"><g id="back"></g><g id="diagram"></g><g id="actor"></g><g id="front"></g></svg>
<ul id="mobileEvidence" class="mobile-evidence" aria-label="Workload comparison summary"></ul>
<div class="controls"><button id="play" type="button">Play</button><button id="restart" type="button">Restart</button>
<label for="seek">Position</label><input id="seek" type="range" min="0" max="${data.framesTotal - 1}" value="0" step="1"><output id="position" for="seek"></output></div>
<details><summary>About this example and sources</summary>
<p class="quiet">Illustrative workload only, not customer telemetry, pricing or a savings claim. Cloud is not automatically cheaper.
Time-box a pilot, measure requirements and total cost, retain rollback, then decide.</p>
<p class="quiet">This example uses only Stickman's own engine, diagrams, choreography and playback shell. No external presentation runtime.</p>
</details></main><script id="native-data" type="application/json">${json}</script><script>
"use strict";
const film=JSON.parse(document.getElementById("native-data").textContent);
const $=id=>document.getElementById(id);
${diagramScript}
let frame=0,playing=false,raf=0,t0=0,start=0,lastSlide="";
function draw(){
  frame=Math.max(0,Math.min(film.framesTotal-1,Math.floor(frame)));
  const entry=film.timeline.find(s=>frame>=s.startFrame&&frame<s.startFrame+s.frames)||film.timeline.at(-1);
  const slide=entry.id;
  $("diagram").innerHTML=diagram(slide,frame-entry.startFrame);
  $("actor").innerHTML=film.dict[film.frames[frame]];
  $("stage").setAttribute("data-frame",frame);$("stage").setAttribute("data-scene",slide);
  if(lastSlide!==slide){$("heading").textContent=labels[slide][0];$("message").textContent=labels[slide][1];lastSlide=slide;
    const summaries={question:["One workload, one set of requirements.","Existing hosting and cloud are both options."],"on-prem":["Measure demand and current capacity.","Use the same baseline for the comparison."],cloud:["Evaluate compute, storage and controls.","Resource flexibility does not guarantee lower cost."],evidence:["Baseline","Requirements","Total cost","Pilot results"],decision:["Move if requirements fit and costs support it.","Retain if local fits better or constraints remain."]};
    $("mobileEvidence").replaceChildren(...summaries[slide].map(s=>{const li=document.createElement("li");li.textContent=s;return li;}));}
  $("seek").value=frame;$("position").textContent=(frame/30).toFixed(1)+" / "+(film.framesTotal/30).toFixed(1)+" s";
  $("play").textContent=playing?"Pause":"Play";$("play").setAttribute("aria-pressed",String(playing));
}
function stop(){playing=false;cancelAnimationFrame(raf);draw();}
function tick(time){if(!playing)return;frame=start+(time-t0)*30/1000;if(frame>=film.framesTotal-1){frame=film.framesTotal-1;stop();return;}draw();raf=requestAnimationFrame(tick);}
$("play").onclick=()=>{if(playing){stop();return;}if(frame>=film.framesTotal-1)frame=0;start=frame;t0=performance.now();playing=true;draw();raf=requestAnimationFrame(tick);};
$("restart").onclick=()=>{frame=0;stop();};$("seek").oninput=()=>{frame=Number($("seek").value);stop();};
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change",()=>stop());
document.addEventListener("visibilitychange",()=>{if(document.hidden)stop();});
draw();
window.StickmanNative={seek(value){frame=Number(value);stop();},data:film,state(){return {frame,playing,scene:lastSlide};}};
</script></body></html>`;
  return { html, seconds: data.framesTotal / 30, continuity: { ...continuity, maxVisibleStep: maxStep,
    maxVisibleAcceleration: maxAcceleration, visibleLimits: { step: 4, acceleration: 2 } },
    contacts: [], sources: [{ id: "present", sha256: createHash("sha256").update(await readFile(join(repo, "motions/specs/present.json"))).digest("hex"),
      adaptation: "Original geometry, 4x key timing; native-only qualified derivative, not a new library approval." }] };
}

export async function buildNativeShowcase(output) {
  const directory = join(output, "showcase");
  await mkdir(directory, { recursive: true });
  const native = await nativeCloudHtml();
  await writeFile(join(directory, "on-prem-to-cloud.html"), native.html, { flag: "wx" });
  const resources = await loadShowcaseResources(), videos = [];
  for (const recipe of videoRecipes) {
    const { timeline, render, provenance } = await createStoryRenderer(recipe, resources);
    console.log(`Rendering original ${recipe.id} (${timeline.frames} frames)`);
    await writeFile(join(directory, `${recipe.id}.png`), (await render(recipe.poster ?? 150)).png, { flag: "wx" });
    await encodeVideo(join(directory, `${recipe.id}.mp4`), timeline.frames, async frame => (await render(frame)).png);
    const stamp = frame => {
      const ms = Math.round(frame / 30 * 1000);
      return `00:${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
    };
    await writeFile(join(directory, `${recipe.id}.vtt`), "WEBVTT\n\n" + timeline.scenes.flatMap(scene => scene.cues.map(cue =>
      `${stamp(scene.startFrame + cue.frame)} --> ${stamp(scene.startFrame + cue.endFrame)}\n${cue.text}\n`)).join("\n"), { flag: "wx" });
    const sha256 = createHash("sha256").update(await readFile(join(directory, `${recipe.id}.mp4`))).digest("hex");
    videos.push({ id: recipe.id, src: `${recipe.id}.mp4`, poster: `${recipe.id}.png`, captions: `${recipe.id}.vtt`,
      seconds: timeline.seconds, frames: timeline.frames, sha256, provenance, sources: recipe.sources });
  }
  const manifest = { slide: { title: "Native Stickman workload comparison", src: "on-prem-to-cloud.html",
    seconds: native.seconds, runtime: "stickman-native", continuity: native.continuity, contacts: native.contacts }, videos };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error("Use node scripts/release/native-showcase.mjs <fresh-site-output>");
  await buildNativeShowcase(resolve(process.argv[2]));
}
