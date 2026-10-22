import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { filmRecipeSchema } from "../../dist/film-schema.js";
import { composeFilm, createStoryRenderer, loadShowcaseResources, encodeVideo, continuityJoin } from "./runtime.mjs";
import { composePerformance, performanceContinuity, FILM_SCALE } from "../site/performance.mjs";
import { places } from "../site/story-films.mjs";
import { readMotion } from "../site/catalogue.mjs";
import { keyPoseGates } from "../motions/keypose.mjs";
import { overlayTypes } from "./overlays.mjs";
import { readJoinMatrix, checkJoin } from "./joins.mjs";
import { RUNTIME_MOTION_LIBRARY } from "../../dist/motion-library.js";

const validate = new AjvJsonSchemaValidator().getValidator(filmRecipeSchema);
export function normalizeRecipe(input) {
  const validation = validate(input);
  if (!validation.valid) throw new Error(`Invalid film recipe: ${validation.errorMessage}`);
  const recipe = structuredClone(validation.data);
  recipe.bridge ??= "auto";
  recipe.declarative = true;
  const ids = recipe.scenes.map(scene => scene.id);
  if (new Set(ids).size !== ids.length) throw new Error("Scene ids must be unique.");
  const normalizeItems = (items, label, lead = false) => {
    let started = false, relocated = false;
    const seenBeats = new Set();
    items.forEach((item, i) => {
      const location = `${label}/${i}`;
      if (item.beat && !ids.includes(item.beat)) throw new Error(`${location}: unknown scene reference ${item.beat}.`);
      if (!lead && item.beat) throw new Error(`${location}: supporting actor beats are not scene boundaries.`);
      if (item.beat && seenBeats.has(item.beat)) throw new Error(`${location}: duplicate scene beat ${item.beat}.`);
      if (item.beat) seenBeats.add(item.beat);
      if (item.headwear !== undefined) {
        if (item.laurel !== undefined) throw new Error(`${location}: use headwear or laurel, not both.`);
        item.laurel = item.headwear === "laurel";
        delete item.headwear;
      }
      const allowed = item.relocate !== undefined ? ["relocate", "beat"] : item.walk ? ["walk", "beat", "gap", "hold", "keep", "laurel", "fadeOut"] : ["motion", "root", "beat", "gap", "hold", "keep", "laurel", "fadeOut", "cycles", "until"];
      for (const key of Object.keys(item)) if (!allowed.includes(key)) throw new Error(`${location}: ${key} is not supported on this item kind.`);
      if (item.root !== undefined && (started || relocated)) throw new Error(`${location}: root only positions the first motion; use walk or relocate afterwards.`);
      if (item.relocate !== undefined) relocated = true;
      if (item.motion || item.walk) started = true;
    });
    if (!started || items.at(-1).relocate !== undefined) throw new Error(`${label}: performance must end in a motion, not relocate.`);
  };
  normalizeItems(recipe.performance, "performance", true);
  for (const scene of recipe.scenes) {
    scene.state ??= scene.id;
    for (const [i, cue] of scene.cues.entries()) {
      const words = cue.text.split(" ");
      const rows = []; let row = "";
      for (const word of words) {
        if (word.length > 50 || /[\r\n\x00-\x1f]/.test(word)) throw new Error(`${scene.id}/cues/${i}: text must fit two readable lines without control characters.`);
        if (row && row.length + word.length + 1 > 50) { rows.push(row); row = ""; }
        row += (row ? " " : "") + word;
      }
      if (row) rows.push(row);
      if (rows.length > 2) throw new Error(`${scene.id}/cues/${i}: text must fit two readable lines.`);
    }
  }
  for (const [i, extra] of (recipe.extras ?? []).entries()) {
    const start = ids.indexOf(extra.from), end = ids.indexOf(extra.until);
    if (start < 0 || end < 0 || end < start) throw new Error(`extras/${i}: from/until must reference known scenes in timeline order.`);
    extra.scale ??= 1;
    extra.delay ??= 0;
    if (extra.actor) normalizeItems(extra.actor, `extras/${i}/actor`);
    else if (extra.kit || extra.mirror !== undefined || extra.lift !== undefined) throw new Error(`extras/${i}: kit, mirror and lift require an actor performance.`);
  }
  return recipe;
}

export async function listFilmAssets() {
  const resources = await loadShowcaseResources();
  const motions = [];
  for (const id of [...resources.approved].sort()) {
    const motion = await readMotion(id);
    if (!motion.spec.poseKeys?.length || !(await keyPoseGates(motion.clip, motion.spec)).passed) continue;
    motions.push({ id, frames: motion.clip.frames.length, kind: motion.clip.loop ? "loop" : motion.spec.kind === "travel" || (motion.spec.travel && motion.spec.travel !== "in-place") ? "travel" : "oneshot" });
  }
  const joinMatrix = await readJoinMatrix();
  return { motions, kits: ["legionary", "standard", "dagger"], headwear: ["none", "laurel"], places: Object.keys(places), overlays: overlayTypes,
    setTypes: resources.propsCatalog.props.map(prop => prop.type), fps: 30, showcaseMaxFrames: 1800, continuityLimit: 14,
    joinCount: joinMatrix.joins.length, recipeSchema: filmRecipeSchema };
}

function validateMotionOptions(recipe, composed, resources) {
  const propTypes = new Set(resources.propsCatalog.props.map(prop => prop.type));
  const checkItems = (items, label) => items.forEach((item, index) => {
    if (item.motion && item.cycles !== undefined && !composed.motions.get(item.motion).clip.loop) throw new Error(`${label}/${index}: cycles requires a loop motion.`);
    for (const type of item.keep ?? []) if (!propTypes.has(type)) throw new Error(`${label}/${index}: unknown keep prop type ${type}.`);
  });
  checkItems(recipe.performance, "performance");
  for (const [i, extra] of (recipe.extras ?? []).entries()) if (extra.actor) checkItems(extra.actor, `extras/${i}/actor`);
  for (const [i, item] of (recipe.set ?? []).entries()) {
    if (!item.types.length) throw new Error(`set/${i}: types must not be empty.`);
    for (const type of item.types) if (!propTypes.has(type)) throw new Error(`set/${i}: unknown prop type ${type}.`);
    for (const motion of item.hideDuring ?? []) if (!composed.motions.has(motion)) throw new Error(`set/${i}: unknown hideDuring motion ${motion}.`);
  }
}

const throwIfAborted = signal => {
  if (!signal?.aborted) return;
  const error = new Error("Film composition was cancelled.");
  error.name = "AbortError";
  throw error;
};
const progress = async (callback, event) => { await callback?.(event); };
export function estimateFilmWork(frames, width = 1280, qaFrames = 0) {
  const height = Math.round(width * 9 / 16);
  const frameCount = frames + 1 + qaFrames;
  const pixelsPerFrame = width * height;
  return { frameCount, pixelsPerFrame, totalRasterPixels: frameCount * pixelsPerFrame, width, height };
}
const filmWarnings = (frames, work) => [
  ...(frames > 1800 ? [`Film has ${frames} frames; the 1800-frame (60-second) limit applies to curated showcase assets only.`] : []),
  ...(work.totalRasterPixels > 90_000_000 ? [`Estimated raster work is ${work.totalRasterPixels} pixels; rendering may use significant CPU, memory, and disk.`] : [])
];

function summarize(recipe, composed, resources, signal) {
  const { performance, timeline, extraActors } = composed;
  const ranges = (cast, items) => items.map((item, index) => {
    const seg = cast.segments.find(seg => seg.itemIndex === index);
    if (seg) return { index, motion: seg.id, kind: seg.kind, startFrame: seg.start, endFrame: seg.end, blendStartFrame: seg.gapStart, beat: seg.beat,
      ...(seg.bridge ? { generatedBridgeBefore: true } : {}) };
    const next = cast.segments.find(seg => seg.itemIndex > index);
    return { index, kind: "relocate", startFrame: next.start, endFrame: next.start, root: item.relocate, instantaneous: true, beat: item.beat ?? null };
  });
  const check = cast => {
    const report = performanceContinuity(cast, resources.sampleClipMotion, { signal });
    return { maxJointStep: report.maxJointStep, limit: 14, passed: report.maxJointStep <= 14, worstFrame: report.worstFrame,
      join: continuityJoin(cast, report.worstFrame), footSlides: report.footSlides, maxFootSlide: report.maxFootSlide,
      supportTransitions: report.supportTransitions };
  };
  const actors = [...extraActors].map(([extra, cast]) => ({ extraIndex: recipe.extras.indexOf(extra), kind: "actor", frames: cast.frames, items: ranges(cast, extra.actor), continuity: check(cast) }));
  for (const [extraIndex, extra] of (recipe.extras ?? []).entries()) if (extra.motion) {
    const cast = composePerformance([{ motion: extra.motion, root: extra.root }], {
      motions: composed.motions, sampleClipMotion: resources.sampleClipMotion,
      neutral: RUNTIME_MOTION_LIBRARY.clips.idle.frames[0], scale: FILM_SCALE * extra.scale, signal
    });
    const continuity = check(cast);
    if (!continuity.passed) throw new Error(`extras/${extraIndex}: continuity ${continuity.maxJointStep} exceeds limit 14 at offending join ${JSON.stringify(continuity.join)}.`);
    actors.push({ extraIndex, kind: "motion", frames: cast.frames, items: ranges(cast, [{ motion: extra.motion }]), continuity });
  }
  actors.sort((a, b) => a.extraIndex - b.extraIndex);
  for (const scene of timeline.scenes) {
    for (const [i, o] of (scene.overlays ?? []).entries()) {
      const fields = {
        text: ["text", "size"], label: ["text", "size"], bubble: ["text", "second", "width"],
        scroll: ["text", "width"], card: ["text", "width"], tick: [], "package-box": ["text"], "rect-plate": ["width", "height"]
      }[o.type];
      const allowed = new Set(["type", "x", "y", "from", "to", "fade", "scale", "tween", ...fields]);
      for (const key of Object.keys(o)) if (!allowed.has(key)) throw new Error(`${scene.id}/overlays/${i}: ${key} is not supported on ${o.type}.`);
      if (["text", "label", "bubble", "scroll", "card"].includes(o.type) && !o.text) throw new Error(`${scene.id}/overlays/${i}: ${o.type} requires text.`);
      for (const label of [o.text, o.second].filter(Boolean)) if (/[\x00-\x1f]/.test(label)) throw new Error(`${scene.id}/overlays/${i}: overlay text cannot contain control characters.`);
      if (o.from >= o.to || o.to > scene.frames || (o.fade ?? 12) * 2 > o.to - o.from) throw new Error(`${scene.id}/overlays/${i}: invalid visibility/fade window for ${scene.frames} local frames.`);
    }
  }
  for (const [i, extra] of (recipe.extras ?? []).entries()) {
    const start = timeline.scenes.find(scene => scene.id === extra.from).startFrame;
    const until = timeline.scenes.find(scene => scene.id === extra.until);
    if (extra.delay >= until.startFrame + until.frames - start) throw new Error(`extras/${i}: delay exceeds visibility window.`);
  }
  if (recipe.poster !== undefined && recipe.poster >= timeline.frames) throw new Error("Poster frame is outside the film timeline.");
  const estimatedWork = estimateFilmWork(timeline.frames);
  return { valid: true, id: recipe.id, frames: timeline.frames, seconds: timeline.seconds, fps: 30, scenes: timeline.scenes, items: ranges(performance, recipe.performance),
    bridges: composed.bridgeRecords ?? [], continuity: { lead: check(performance), actors },
    estimatedWork, warnings: filmWarnings(timeline.frames, estimatedWork) };
}

export async function composeRecipe(input, options = {}) {
  throwIfAborted(options.signal);
  await progress(options.onProgress, { phase: "compose", current: 0, total: 1 });
  const recipe = normalizeRecipe(input), resources = await loadShowcaseResources();
  const composed = await composeFilm(recipe, resources, options);
  validateMotionOptions(recipe, composed, resources);
  const result = summarize(recipe, composed, resources, options.signal);
  await progress(options.onProgress, { phase: "compose", current: 1, total: 1 });
  return result;
}

export async function checkFilmJoin(motionA, motionB) {
  return checkJoin(motionA, motionB);
}

const stamp = frame => {
  const ms = Math.round(frame / 30 * 1000);
  return `00:${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
// destination is an exclusively-created, confined directory supplied by the TS adapter.
export async function renderRecipe(input, destination, options = {}) {
  throwIfAborted(options.signal);
  await progress(options.onProgress, { phase: "compose", current: 0, total: 1 });
  const recipe = normalizeRecipe(input), resources = await loadShowcaseResources();
  const composed = await composeFilm(recipe, resources, options);
  validateMotionOptions(recipe, composed, resources);
  const report = summarize(recipe, composed, resources, options.signal);
  const step = options.preview ? 2 : 1, width = options.preview ? 640 : 1280;
  const { render, timeline, provenance } = await createStoryRenderer(recipe, resources, composed, { width, signal: options.signal });
  const encodedFrames = Math.ceil(timeline.frames / step);
  const png = async frame => (await render(frame)).png;
  const files = { video: `${recipe.id}.mp4`, poster: `${recipe.id}.png`, captions: `${recipe.id}.vtt` };
  const created = [];
  const renderWork = estimateFilmWork(timeline.frames, width, options.qaFrames ?? 0);
  const warnings = filmWarnings(timeline.frames, renderWork);
  try {
    throwIfAborted(options.signal);
    await progress(options.onProgress, { phase: "compose", current: 1, total: 1 });
    created.push(files.poster);
    await fs.writeFile(path.join(destination, files.poster), await png(recipe.poster ?? Math.min(30, timeline.frames - 1)), { flag: "wx" });
    await progress(options.onProgress, { phase: "poster", current: 1, total: 1 });
    await encodeVideo(path.join(destination, files.video), encodedFrames, i => png(Math.min(i * step, timeline.frames - 1)), 30 / step, {
      signal: options.signal, onProgress: options.onProgress
    });
    created.push(files.video);
    throwIfAborted(options.signal);
    created.push(files.captions);
    await fs.writeFile(path.join(destination, files.captions), "WEBVTT\n\n" + timeline.scenes.flatMap(scene => scene.cues.map(cue =>
      `${stamp(scene.startFrame + cue.frame)} --> ${stamp(scene.startFrame + cue.endFrame)}\n${cue.text}\n`)).join("\n"), { flag: "wx" });
    const qaFrames = options.qaFrames ?? 0;
    if (qaFrames) {
      files.qa = `${recipe.id}-qa.png`;
      const columns = Math.min(4, qaFrames), rows = Math.ceil(qaFrames / columns);
      const cells = [];
      for (let i = 0; i < qaFrames; i++) {
        throwIfAborted(options.signal);
        const frame = qaFrames === 1 ? 0 : Math.round(i * (timeline.frames - 1) / (qaFrames - 1));
        cells.push(`<image x="${(i % columns) * 320}" y="${Math.floor(i / columns) * 180}" width="320" height="180" href="data:image/png;base64,${(await png(frame)).toString("base64")}"/>`);
        await progress(options.onProgress, { phase: "qa", current: i + 1, total: qaFrames });
      }
      created.push(files.qa);
      await fs.writeFile(path.join(destination, files.qa), new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns * 320}" height="${rows * 180}">${cells.join("")}</svg>`, { font: { loadSystemFonts: false } }).render().asPng(), { flag: "wx" });
    }
    const sha256 = createHash("sha256").update(await fs.readFile(path.join(destination, files.video))).digest("hex");
    await progress(options.onProgress, { phase: "complete", current: timeline.frames, total: timeline.frames });
    return { ...report, estimatedWork: renderWork, warnings, outputDir: destination, files, preview: !!options.preview, encodedFrames, encodedFps: 30 / step, width, height: width * 9 / 16, sha256, provenance };
  } catch (error) {
    await Promise.all(created.map(file => fs.rm(path.join(destination, file), { force: true })));
    throw error;
  }
}
