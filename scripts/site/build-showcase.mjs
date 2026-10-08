import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import ffmpeg from "ffmpeg-static";
import { Resvg } from "@resvg/resvg-js";
import { repo, readMotion, parseCatalogue, variants } from "./catalogue.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";
import { loadEngineRenderer } from "../motions/review-renderer.mjs";
import { RUNTIME_MOTION_LIBRARY } from "../../dist/motion-library.js";
import { composePerformance, createPerformanceRenderer, performanceContinuity, renderExtra, walkSpec, FILM_SCALE } from "./performance.mjs";
import { videoRecipes, storyTimeline, renderStoryFrame, filmExtras } from "./story-films.mjs";
export { videoRecipes } from "./story-films.mjs";

const fps = 30;
const rasterOptions = { font: { loadSystemFonts: false } };
export function storyMotionSample(clip, frame) {
  return clip.loop ? frame % clip.frames.length : Math.min(frame, clip.frames.length - 1);
}

export function inspectSlide(html) {
  const embedded = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!embedded) throw new Error("Supply the reviewed on-premises-to-cloud HTML with embedded timeline metadata.");
  const data = JSON.parse(embedded[1]);
  const duration = data.totalFrames / 30;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error("The slide must have a timeline longer than zero and no longer than 60 seconds.");
  if (!html.includes("Workload migration comparison")) throw new Error("The supplied file is not the reviewed on-premises-to-cloud slide.");
  return duration;
}

async function encodeVideo(filename, frameCount, render) {
  if (!ffmpeg) throw new Error("ffmpeg-static is required for the two showcase videos.");
  const encoder = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-threads", "2",
    "-f", "image2pipe", "-vcodec", "png", "-framerate", String(fps), "-i", "pipe:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-an", "-threads", "2", "-movflags", "+faststart", "-y", filename], { stdio: ["pipe", "ignore", "pipe"] });
  let diagnostics = "", inputError;
  encoder.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
  encoder.stdin.on("error", error => { inputError = error; });
  const completion = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", code => code === 0 ? resolve() : reject(new Error(`Video encoder failed (${code}): ${diagnostics}`)));
  });
  completion.catch(() => {});
  try {
    for (let frame = 0; frame < frameCount; frame++) {
      if (inputError) throw inputError;
      const png = await render(frame);
      if (!encoder.stdin.write(png)) await once(encoder.stdin, "drain");
      if (frame % 60 === 0) globalThis.gc?.();
    }
    encoder.stdin.end();
    await completion;
  } catch (error) {
    encoder.kill();
    await completion.catch(() => {});
    throw error;
  }
}

export async function loadShowcaseResources() {
  const propsCatalog = JSON.parse(await fs.readFile(path.join(repo, "motions", "review-props.json"), "utf8"));
  const approved = new Set(parseCatalogue(await fs.readFile(path.join(repo, "docs", "motion-catalog-plan.md"), "utf8"))
    .filter(row => row.status === "user-approved").flatMap(row => [row.id, ...(variants[row.id] ?? [])]));
  const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
  const colors = Object.fromEntries([...css.split('html[data-theme="dark"]')[0].matchAll(/--cp-([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const themeMotion = svg => svg.replace(/(fill|stroke)="(#[a-fA-F0-9]{3,8}|rgba?\([^"]+\))"/g, (_, attr, color) => {
    const pale = /^#(fff(?:fff)?|f[0-9a-f]{5}|e[0-9a-f]{5})$/i.test(color);
    const dark = /^#[0-4]/i.test(color);
    const neutral = /^#(?:([0-9a-f])\1\1|([0-9a-f]{2})\2\2|d8dbe0)$/i.test(color);
    return `${attr}="${pale ? colors.surface : dark ? colors.text : neutral ? colors["border-strong"] : colors.accent}"`;
  });
  const fonts = process.platform === "win32" ? { font: { loadSystemFonts: false,
    fontFiles: ["segoeui.ttf", "segoeuib.ttf"].map(file => path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", file)),
    defaultFontFamily: "Segoe UI" } } : undefined;
  const { sampleClipMotion, frameGeometry } = await loadEngineRenderer();
  return { propsCatalog, approved, colors, themeMotion, fonts, sampleClipMotion, frameGeometry };
}

export async function composeFilm(recipe, resources) {
  const { approved, sampleClipMotion } = resources;
  const ids = new Set([...recipe.performance.map(item => item.motion), ...(recipe.set ?? []).map(item => item.motion), ...(recipe.extras ?? []).flatMap(item => [item.motion, ...(item.actor ?? []).map(entry => entry.motion)])].filter(Boolean));
  const motions = new Map();
  for (const id of ids) {
    if (!approved.has(id)) throw new Error(`${id} is not user-approved.`);
    const motion = await readMotion(id);
    if (!motion.spec.poseKeys?.length) throw new Error(`${id} is a legacy fixture; films require current authored key-pose motions.`);
    if (!(await keyPoseGates(motion.clip, motion.spec)).passed) throw new Error(`${id} failed its mechanical motion gates.`);
    motions.set(id, motion);
  }
  const neutral = RUNTIME_MOTION_LIBRARY.clips.idle.frames[0];
  const performance = composePerformance(recipe.performance, { motions, sampleClipMotion, neutral });
  for (const seg of performance.segments.filter(item => item.kind === "walk"))
    if (!(await keyPoseGates(seg.clip, seg.spec)).passed) throw new Error(`${recipe.id}: a generated walk failed its mechanical gates.`);
  const continuity = performanceContinuity(performance, sampleClipMotion);
  if (continuity.maxJointStep > 14) throw new Error(`${recipe.id}: the performance pops ${continuity.maxJointStep} units at frame ${continuity.worstFrame}.`);
  const extraWalks = new Map(), extraActors = new Map();
  for (const extra of recipe.extras ?? []) if (extra.walk) {
    const spec = walkSpec(extra.walk, 1);
    extraWalks.set(extra, { spec, clip: buildKeyPoseClip(spec, neutral), sourceId: spec.id });
  } else if (extra.actor) {
    // A supporting actor is its own small continuous performance (soldier, conspirator), gated like the lead.
    const actor = composePerformance(extra.actor, { motions, sampleClipMotion, neutral, scale: FILM_SCALE * extra.scale });
    for (const seg of actor.segments.filter(item => item.kind === "walk"))
      if (!(await keyPoseGates(seg.clip, seg.spec)).passed) throw new Error(`${recipe.id}: a supporting actor's walk failed its mechanical gates.`);
    const check = performanceContinuity(actor, sampleClipMotion);
    if (check.maxJointStep > 14) throw new Error(`${recipe.id}: a supporting actor pops ${check.maxJointStep} units at frame ${check.worstFrame}.`);
    extraActors.set(extra, actor);
  }
  return { motions, performance, continuity, extraWalks, extraActors, timeline: storyTimeline(recipe, performance) };
}

export async function createStoryRenderer(recipe, resources) {
  const { propsCatalog, colors, themeMotion, fonts, sampleClipMotion, frameGeometry } = resources;
  const { motions, performance, continuity, extraWalks, extraActors, timeline } = await composeFilm(recipe, resources);
  const textCache = new Map();
  const outlineText = svg => svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, markup => {
    if (!textCache.has(markup)) {
      const outlined = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
        <g font-family="Segoe UI, Aptos, Calibri, sans-serif">${markup}</g></svg>`, fonts).toString();
      textCache.set(markup, outlined.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, ""));
    }
    return textCache.get(markup);
  });
  const laurel = geometry => {
    const { x, y } = geometry.head, radius = geometry.headRadius;
    return `<g fill="${colors.accent}" stroke="${colors.accent}" stroke-width="0.6" transform="translate(${x} ${y - radius * .65})">
      <path d="M${-radius} 3Q0 -5 ${radius} 3" fill="none"/>
      ${[-1, 1].flatMap(side => [0, 1, 2].map(i => `<ellipse cx="${side * (radius - i * 3)}" cy="${1 - i}" rx="3" ry="1.5" transform="rotate(${side * 35} ${side * (radius - i * 3)} ${1 - i})"/>`)).join("")}</g>`;
  };
  const actor = createPerformanceRenderer(performance, { sampleClipMotion, frameGeometry, propsCatalog, set: recipe.set ?? [], theme: themeMotion, laurel, motions });
  // Drawn kit for supporting actors, attached to the sampled skeleton (figure-local units).
  const kit = type => (geometry, sample) => {
    const seg = id => sample.segments.find(item => item.id === id);
    const torso = seg("torso"), hand = seg("right-forearm"), dagger = seg("left-forearm");
    const { x: hx, y: hy } = geometry.head, r = geometry.headRadius;
    const f = v => Number(v.toFixed(2));
    const helmet = `<path d="M${f(hx - r)} ${f(hy - 1)}A${f(r)} ${f(r)} 0 0 1 ${f(hx + r)} ${f(hy - 1)}Z" fill="${colors["border-strong"]}" stroke="${colors.text}" stroke-width="1.4"/>
      <path d="M${f(hx - r * .9)} ${f(hy - r - 1)}Q${f(hx)} ${f(hy - r - 8)} ${f(hx + r * .9)} ${f(hy - r - 1)}" fill="none" stroke="${colors.accent}" stroke-width="3.2" stroke-linecap="round"/>`;
    const midX = (torso.x1 + torso.x2) / 2 + 5, midY = (torso.y1 + torso.y2) / 2 + 2;
    const shield = `<rect x="${f(midX - 6)}" y="${f(midY - 13)}" width="12" height="26" rx="3" fill="${colors.accent}" stroke="${colors.text}" stroke-width="1.4"/>
      <circle cx="${f(midX)}" cy="${f(midY)}" r="2.2" fill="${colors.surface}"/>`;
    if (type === "dagger") {
      const dx = dagger.x2 - dagger.x1, dy = dagger.y2 - dagger.y1, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      return `<path d="M${f(dagger.x2 - uy * 2.5)} ${f(dagger.y2 + ux * 2.5)}L${f(dagger.x2 + uy * 2.5)} ${f(dagger.y2 - ux * 2.5)}" stroke="${colors.text}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M${f(dagger.x2)} ${f(dagger.y2)}L${f(dagger.x2 + ux * 11)} ${f(dagger.y2 + uy * 11)}" stroke="${colors["border-strong"]}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    if (type === "standard") return `${helmet}<path d="M${f(hand.x2)} ${f(hand.y2 + 14)}V${f(hand.y2 - 62)}" stroke="${colors.text}" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="${f(hand.x2 - 9)}" y="${f(hand.y2 - 48)}" width="18" height="15" fill="${colors.accent}"/>
      <text x="${f(hand.x2)}" y="${f(hand.y2 - 37)}" text-anchor="middle" font-size="6.5" font-weight="800" fill="${colors.surface}">SPQR</text>
      <path d="M${f(hand.x2 - 10)} ${f(hand.y2 - 66)}Q${f(hand.x2 - 4)} ${f(hand.y2 - 60)} ${f(hand.x2)} ${f(hand.y2 - 63)}Q${f(hand.x2 + 4)} ${f(hand.y2 - 60)} ${f(hand.x2 + 10)} ${f(hand.y2 - 66)}" fill="none" stroke="${colors.accent}" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="${f(hand.x2)}" cy="${f(hand.y2 - 65)}" r="2.6" fill="${colors.accent}"/>`;
    return `${helmet}${shield}<path d="M${f(hand.x2)} ${f(hand.y2 + 16)}V${f(hand.y2 - 44)}" stroke="${colors.text}" stroke-width="2" stroke-linecap="round"/>
      <path d="M${f(hand.x2 - 2.8)} ${f(hand.y2 - 42)}L${f(hand.x2)} ${f(hand.y2 - 50)}L${f(hand.x2 + 2.8)} ${f(hand.y2 - 42)}Z" fill="${colors["border-strong"]}"/>`;
  };
  const actors = new Map([...extraActors].map(([extra, cast]) => [extra, { cast, render: createPerformanceRenderer(cast, { sampleClipMotion, frameGeometry, propsCatalog,
    theme: themeMotion, adorn: extra.kit ? kit(extra.kit) : undefined, strip: ["glove", "palm", "box"], motions }) }]));
  const extraCache = new Map();
  const render = async frame => {
    const layers = await actor(frame);
    let extras = "";
    for (const extra of filmExtras(recipe, timeline, frame)) {
      if (extra.actor) {
        const { cast, render: play } = actors.get(extra.source);
        const local = Math.min(extra.frame, cast.frames - 1);
        const part = await play(local);
        let markup = part.back + part.actor + part.front;
        if (extra.mirror) markup = `<g transform="translate(1280 0) scale(-1 1)">${markup}</g>`;
        if (extra.lift) markup = `<g transform="translate(0 ${-extra.lift})">${markup}</g>`;
        extras += extra.opacity < .999 ? `<g opacity="${extra.opacity.toFixed(2)}">${markup}</g>` : markup;
        continue;
      }
      const motion = extra.walk ? extraWalks.get(extra.source) : motions.get(extra.motion);
      const sample = motion.clip.loop ? extra.frame % motion.clip.frames.length : Math.min(extra.frame, motion.clip.frames.length - 1);
      const key = `${extra.motion ?? extra.walk}:${extra.root}:${extra.scale}:${sample}`;
      if (!extraCache.has(key)) extraCache.set(key, await renderExtra({ motion, root: extra.root, frame: sample, scale: extra.scale, propsCatalog, theme: themeMotion }));
      extras += extra.opacity < .999 ? `<g opacity="${extra.opacity.toFixed(2)}">${extraCache.get(key)}</g>` : extraCache.get(key);
    }
    const svg = renderStoryFrame(recipe, timeline, frame, { ...layers, extras }, colors);
    return { svg, png: new Resvg(outlineText(svg), rasterOptions).render().asPng() };
  };
  const provenance = [...motions.values()].map(motion => ({ id: motion.sourceId, kind: "authored-key-pose", frames: motion.clip.frames.length, mechanicalCheck: "passed",
    specSha256: createHash("sha256").update(JSON.stringify(motion.spec)).digest("hex") }));
  const walks = performance.segments.filter(seg => seg.kind === "walk");
  const actorWalks = [...extraActors.values()].reduce((sum, cast) => sum + cast.segments.filter(seg => seg.kind === "walk").length, 0);
  if (walks.length || extraWalks.size || actorWalks) provenance.push({ id: "generated-walk", kind: "generated-from-walk-on-gait", count: walks.length + extraWalks.size + actorWalks, mechanicalCheck: "passed" });
  if (extraActors.size) provenance.push({ id: "supporting-actors", kind: "continuous-composite", count: extraActors.size,
    maxJointStep: Math.max(...[...extraActors.values()].map(cast => performanceContinuity(cast, sampleClipMotion).maxJointStep)), camera: "locked" });
  provenance.push({ id: "film-performance", kind: "continuous-composite", frames: performance.frames, maxJointStep: continuity.maxJointStep, camera: "locked" });
  return { timeline, render, performance, provenance };
}
export async function buildShowcase(slidePath) {
  const slide = await fs.readFile(slidePath, "utf8");
  const slideSeconds = inspectSlide(slide);
  const output = path.join(repo, "dist", "site", "showcase");
  await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, "manifest.json"), { force: true });
  const resources = await loadShowcaseResources();
  const videos = [];
  for (const recipe of videoRecipes) {
    const { timeline, render, provenance } = await createStoryRenderer(recipe, resources);
    const { scenes, frames: totalFrames, seconds } = timeline;
    await fs.writeFile(path.join(output, `${recipe.id}.png`), (await render(recipe.poster ?? 150)).png);
    const staging = path.join(output, `${recipe.id}.render.mp4`);
    try {
      await encodeVideo(staging, totalFrames, async frame => {
        const scene = scenes.find(beat => beat.startFrame === frame);
        if (scene) console.log(`${recipe.id}: ${scene.title}`);
        return (await render(frame)).png;
      });
      await fs.rename(staging, path.join(output, `${recipe.id}.mp4`));
    } finally {
      await fs.rm(staging, { force: true });
    }
    const stamp = frame => {
      const ms = Math.round(frame / fps * 1000);
      return `00:${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
    };
    await fs.writeFile(path.join(output, `${recipe.id}.vtt`), "WEBVTT\n\n" + scenes.flatMap(scene => scene.cues.map(cue =>
      `${stamp(scene.startFrame + cue.frame)} --> ${stamp(scene.startFrame + cue.endFrame)}\n${cue.text}\n`)).join("\n"));
    const sha256 = createHash("sha256").update(await fs.readFile(path.join(output, `${recipe.id}.mp4`))).digest("hex");
    videos.push({ id: recipe.id, title: recipe.title, summary: recipe.summary, style: "silent-short-film", audio: false, sha256, sources: recipe.sources, provenance, seconds, frames: totalFrames, fps, scenes, src: `${recipe.id}.mp4`, poster: `${recipe.id}.png`, captions: `${recipe.id}.vtt` });
  }
  await fs.writeFile(path.join(output, "on-prem-to-cloud.html"), slide);
  const manifest = { slide: { title: "On-premises to cloud", src: "on-prem-to-cloud.html", seconds: slideSeconds }, videos };
  await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const id of ["it-workplace", "expressive"]) for (const extension of ["mp4", "png", "vtt"]) await fs.rm(path.join(output, `${id}.${extension}`), { force: true });
  console.log(JSON.stringify({ output, ...manifest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== "--slide") throw new Error("Use site:showcase -- --slide <reviewed on-prem-to-cloud.html>");
  await buildShowcase(path.resolve(process.argv[3]));
}
