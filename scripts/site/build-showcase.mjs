import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { repo } from "./catalogue.mjs";
import { videoRecipes } from "./story-films.mjs";
export { videoRecipes } from "./story-films.mjs";
import { encodeVideo, loadShowcaseResources, createStoryRenderer } from "../film/runtime.mjs";
export { composeFilm, createStoryRenderer, loadShowcaseResources } from "../film/runtime.mjs";

const fps = 30;
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

const knownSlideApproval = new Map([
  ["0f490b0584cb10515618632d115ff86e20366942d3302408c0dd5cf227e440ea", "historical-gallery-asset"],
  ["083ffe6915a0f3e59c26c630fe6ecb93e0d7d610a18f1bfa9b6528b8479e40d0", "integration-preview-unapproved"]
]);
const rejectedSlidePrefix = "4499b85c";
export function inspectSlideMetadata(html) {
  const sha256 = createHash("sha256").update(html).digest("hex");
  if (sha256.startsWith(rejectedSlidePrefix)) throw new Error("Rejected slide replacement cannot enter the showcase.");
  const approvalStatus = knownSlideApproval.get(sha256);
  if (!approvalStatus) throw new Error(`Slide SHA-256 ${sha256} has no recorded showcase approval status.`);
  const embedded = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!embedded) throw new Error("Supply the reviewed on-premises-to-cloud HTML with embedded timeline metadata.");
  const data = JSON.parse(embedded[1]);
  const seconds = inspectSlide(html);
  const scenes = data.scenes?.length ?? data.storyboard?.scenes?.length ??
    (Array.isArray(data.timeline) ? new Set(data.timeline.map(entry => entry.slide).filter(Boolean)).size : undefined);
  const beats = data.beats?.length ?? data.timeline?.length ?? data.storyboard?.beats?.length ??
    data.scenes?.reduce((total, scene) => total + (scene.beats?.length ?? 0), 0);
  if (scenes !== 5 || beats !== 12) throw new Error(`The reviewed slide must have 5 scenes and 12 beats (got ${String(scenes)} and ${String(beats)}).`);
  return { sha256, seconds, frames: data.totalFrames, scenes, beats, approvalStatus };
}

export async function buildShowcase(slidePath) {
  let slide;
  let slideMetadata;
  if (slidePath) {
    slide = await fs.readFile(slidePath, "utf8");
    slideMetadata = inspectSlideMetadata(slide);
  } else {
    const { nativeCloudHtml } = await import("../release/native-showcase.mjs");
    const native = await nativeCloudHtml();
    slide = native.html;
    slideMetadata = {
      seconds: native.seconds,
      frames: Math.round(native.seconds * fps),
      runtime: "stickman-native",
      continuity: native.continuity,
      contacts: native.contacts
    };
  }
  const output = path.join(repo, "dist", "site", "showcase");
  await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, "manifest.json"), { force: true });
  const resources = await loadShowcaseResources();
  const videos = [];
  for (const recipe of videoRecipes) {
    const { timeline, render, provenance } = await createStoryRenderer(recipe, resources);
    const { scenes, frames: totalFrames, seconds } = timeline;
    if (totalFrames > 1800) throw new Error(`${recipe.id} exceeds the curated showcase limit (1800 frames).`);
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
    videos.push({ id: recipe.id, title: recipe.title, summary: recipe.summary, style: "silent-short-film", audio: false,
      playbackProfile: { fps, speed: 1, audio: false }, sha256, sources: recipe.sources, provenance, seconds, frames: totalFrames, fps, scenes,
      src: `${recipe.id}.mp4`, poster: `${recipe.id}.png`, captions: `${recipe.id}.vtt` });
  }
  await fs.writeFile(path.join(output, "on-prem-to-cloud.html"), slide);
  const manifest = { slide: { title: "On-premises to cloud", src: "on-prem-to-cloud.html", ...slideMetadata }, videos };
  await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const id of ["it-workplace", "expressive"]) for (const extension of ["mp4", "png", "vtt"]) await fs.rm(path.join(output, `${id}.${extension}`), { force: true });
  console.log(JSON.stringify({ output, ...manifest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 2) {
    await buildShowcase();
  } else if (process.argv.length === 4 && process.argv[2] === "--slide") {
    await buildShowcase(path.resolve(process.argv[3]));
  } else {
    throw new Error("Use site:showcase or site:showcase -- --slide <reviewed on-prem-to-cloud.html>");
  }
}
