import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import { Resvg } from "@resvg/resvg-js";
import { repo, readMotion, loadCatalogueRows, variants } from "../site/catalogue.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";
import { loadEngineRenderer } from "../motions/review-renderer.mjs";
import { RUNTIME_MOTION_LIBRARY } from "../../dist/motion-library.js";
import { composePerformance, createPerformanceRenderer, performanceContinuity, renderExtra, walkSpec, FILM_SCALE } from "../site/performance.mjs";
import { storyTimeline, renderStoryFrame, filmExtras } from "../site/story-films.mjs";
import { computeBridgeFramesFromDistance, measurePoseJoinDistance } from "./joins.mjs";

const fps = 30;
const rasterOptions = { font: { loadSystemFonts: false } };
const throwIfAborted = signal => {
  if (!signal?.aborted) return;
  const error = new Error("Film rendering was cancelled.");
  error.name = "AbortError";
  throw error;
};
const progress = async (callback, event) => { await callback?.(event); };

const STAND_POSE = {
  anchor: "both", lean: 1, neck: 0, bob: 0, facing: 1,
  rLeg: { hip: 4, knee: 12 }, lLeg: { hip: -5, knee: 12 },
  rArm: { shoulder: -8, elbow: 42 }, lArm: { shoulder: 8, elbow: 42 }
};

function synthesizeBaselineSpec(id) {
  if (id === "walk") {
    const spec = walkSpec(240, 1, 18);
    return { ...spec, id: "walk", kind: "oneshot", travel: "travel" };
  }
  if (id === "run") {
    const spec = walkSpec(240, 1, 12);
    return {
      ...spec,
      id: "run",
      kind: "oneshot",
      travel: "travel",
      poseKeys: spec.poseKeys.map(k => ({
        ...k,
        pose: {
          ...k.pose,
          lean: Math.max(k.pose.lean ?? 3, 10),
          neck: -3,
          rArm: { shoulder: (k.pose.rArm?.shoulder ?? 0) * 1.45, elbow: 78 },
          lArm: { shoulder: (k.pose.lArm?.shoulder ?? 0) * 1.45, elbow: 78 }
        }
      }))
    };
  }
  if (id === "jump") {
    const planted = { rFoot: { x: 5, y: 0 }, lFoot: { x: -7, y: 0 } };
    const stand = { anchor: "both", lean: 2, neck: -1, bob: 0, facing: 1, rLeg: { hip: 6, knee: 14 }, lLeg: { hip: -8, knee: 14 }, rArm: { shoulder: -8, elbow: 45 }, lArm: { shoulder: 10, elbow: 45 }, ...planted };
    const crouch = { anchor: "both", lean: -3, neck: 3, bob: -12, facing: 1, rLeg: { hip: 38, knee: 74 }, lLeg: { hip: 28, knee: 68 }, rArm: { shoulder: -26, elbow: 60 }, lArm: { shoulder: -18, elbow: 60 }, ...planted };
    const take = { anchor: null, lean: 8, neck: -4, bob: 14, facing: 1, rLeg: { hip: -6, knee: 20, lift: 6 }, lLeg: { hip: 10, knee: 20, lift: 6 }, rArm: { shoulder: 64, elbow: 30 }, lArm: { shoulder: 52, elbow: 30 } };
    const apex = { anchor: null, lean: 6, neck: -2, bob: 42, facing: 1, rLeg: { hip: 30, knee: 68, lift: 16 }, lLeg: { hip: 14, knee: 58, lift: 14 }, rArm: { shoulder: 56, elbow: 54 }, lArm: { shoulder: 42, elbow: 54 } };
    const land = { anchor: "both", lean: 4, neck: -1, bob: -10, facing: 1, rLeg: { hip: 34, knee: 68 }, lLeg: { hip: 20, knee: 62 }, rArm: { shoulder: -14, elbow: 64 }, lArm: { shoulder: -4, elbow: 64 }, ...planted };
    return {
      id: "jump", frames: 74, loop: false, kind: "oneshot", travel: "in-place", prop: null, review: {},
      poseKeys: [
        { frame: 0, ease: "inOut", pose: stand },
        { frame: 14, ease: "inOut", pose: crouch },
        { frame: 25, ease: "inOut", pose: take },
        { frame: 37, ease: "inOut", pose: apex },
        { frame: 50, ease: "inOut", pose: land },
        { frame: 62, ease: "inOut", pose: stand },
        { frame: 73, ease: "inOut", pose: stand }
      ]
    };
  }
  if (id === "stop") {
    const lean = { anchor: "both", lean: 10, neck: -3, bob: -2, facing: 1, rLeg: { hip: 22, knee: 26 }, lLeg: { hip: -20, knee: 28 }, rArm: { shoulder: -24, elbow: 70 }, lArm: { shoulder: 26, elbow: 70 } };
    const brake = { anchor: "both", lean: -10, neck: 3, bob: -4, facing: 1, rLeg: { hip: 28, knee: 22 }, lLeg: { hip: -24, knee: 28 }, rArm: { shoulder: 24, elbow: 74 }, lArm: { shoulder: -20, elbow: 74 } };
    const plant = { anchor: "both", lean: -6, neck: 2, bob: -2, facing: 1, rLeg: { hip: 16, knee: 16 }, lLeg: { hip: -14, knee: 20 }, rArm: { shoulder: 10, elbow: 60 }, lArm: { shoulder: -8, elbow: 60 } };
    return {
      id: "stop", frames: 60, loop: false, kind: "oneshot", travel: "in-place", prop: null, review: {},
      poseKeys: [
        { frame: 0, ease: "inOut", pose: lean },
        { frame: 18, ease: "inOut", pose: brake },
        { frame: 38, ease: "inOut", pose: plant },
        { frame: 59, ease: "inOut", pose: STAND_POSE }
      ]
    };
  }
  if (id === "point") {
    const ant = { anchor: "both", lean: -4, neck: 4, bob: 0, facing: 1, rLeg: { hip: 10, knee: 16 }, lLeg: { hip: -10, knee: 16 }, rArm: { shoulder: -24, elbow: 54 }, lArm: { shoulder: 10, elbow: 46 } };
    const pt = { anchor: "both", lean: 6, neck: -5, bob: 0, facing: 1, rLeg: { hip: 8, knee: 14 }, lLeg: { hip: -10, knee: 14 }, rArm: { shoulder: 72, elbow: 4 }, lArm: { shoulder: -12, elbow: 48 } };
    return {
      id: "point", frames: 41, loop: false, kind: "oneshot", travel: "in-place", prop: null, review: {},
      poseKeys: [
        { frame: 0, ease: "inOut", pose: ant },
        { frame: 18, ease: "inOut", pose: pt },
        { frame: 40, ease: "inOut", pose: pt }
      ]
    };
  }
  if (id === "idle") {
    const breath = { ...STAND_POSE, lean: 1.8, neck: -0.6, bob: 0.6, rArm: { shoulder: -6, elbow: 44 }, lArm: { shoulder: 10, elbow: 44 } };
    return {
      id: "idle", frames: 60, loop: true, kind: "loop", travel: "in-place", prop: null, review: {},
      poseKeys: [
        { frame: 0, ease: "inOut", pose: STAND_POSE },
        { frame: 30, ease: "inOut", pose: breath }
      ]
    };
  }
  if (id === "static-pose") {
    return {
      id: "static-pose", frames: 12, loop: true, kind: "loop", travel: "in-place", prop: null, review: {},
      poseKeys: [
        { frame: 0, ease: "inOut", pose: STAND_POSE },
        { frame: 6, ease: "inOut", pose: STAND_POSE }
      ]
    };
  }
  return {
    id, frames: 12, loop: false, kind: "oneshot", travel: "in-place", prop: null, review: {},
    poseKeys: [
      { frame: 0, ease: "inOut", pose: STAND_POSE },
      { frame: 11, ease: "inOut", pose: STAND_POSE }
    ]
  };
}

export async function resolveFilmMotion(id, approved, neutral, { allowRuntime = true } = {}) {
  const isKnownRuntime = allowRuntime && Boolean(RUNTIME_MOTION_LIBRARY.clips[id]);
  if (!approved.has(id) && !isKnownRuntime) throw new Error(`${id} is not user-approved.`);
  let motion = null;
  try {
    motion = await readMotion(id);
  } catch (error) {
    if (!isKnownRuntime) throw error;
  }
  if (motion?.spec?.poseKeys?.length) {
    if (!(await keyPoseGates(motion.clip, motion.spec)).passed) {
      throw new Error(`${id} failed its mechanical motion gates.`);
    }
    return motion;
  }
  if (!allowRuntime) {
    throw new Error(`${id} is a legacy fixture; films require current authored key-pose motions.`);
  }
  const spec = synthesizeBaselineSpec(id);
  const clip = buildKeyPoseClip(spec, neutral);
  if (!(await keyPoseGates(clip, spec)).passed) {
    throw new Error(`${id} failed its mechanical motion gates.`);
  }
  return { sourceId: id, spec, clip };
}

// Release/replant only joins where the measured blend actually slides a planted foot.
function addMeasuredSupportTransitions(items, performance, continuity) {
  const indices = new Set();
  for (const slide of continuity.footSlides) {
    const segment = performance.segments.find(candidate =>
      slide.frame >= candidate.gapStart && slide.frame <= candidate.start && !candidate.relocated);
    if (segment) indices.add(segment.itemIndex);
  }
  if (!indices.size) return items.map(item => ({ ...item }));
  return items.map((item, index) => {
    if (!indices.has(index)) return { ...item };
    const segment = performance.segments.find(candidate => candidate.itemIndex === index);
    const previous = performance.segments[performance.segments.indexOf(segment) - 1];
    return { ...item, _supportTransition: {
      from: previous?.id ?? null, to: segment.id, lift: 1.25, rampFrames: 4,
      joinSupport: segment.id === "fall-get-up" ? "fall-release" : "step-replant"
    } };
  });
}

function composeWithMeasuredSupport(items, options, sampleClipMotion, bridge, label) {
  const initial = composeWithAutomaticBridges(items, options, sampleClipMotion, bridge, label, { deferBridgeFootSlideCheck: true });
  if (!bridge) return initial;
  const supportedItems = addMeasuredSupportTransitions(items, initial.performance, initial.continuity);
  const hadNewSupport = !supportedItems.every((item, index) => !item._supportTransition || items[index]._supportTransition);
  if (!hadNewSupport) {
    for (const record of initial.bridgeRecords) {
      const footSlides = initial.continuity.footSlides.filter(slide => slide.frame >= record.startFrame && slide.frame <= record.endFrame);
      if (footSlides.length) throw new Error(`${label}: generated bridge ${record.from} -> ${record.to} slides a planted foot.`);
    }
    return initial;
  }
  return composeWithAutomaticBridges(supportedItems, options, sampleClipMotion, bridge, label);
}

export async function encodeVideo(filename, frameCount, render, frameRate = fps, { signal, onProgress } = {}) {
  if (!ffmpeg) throw new Error("ffmpeg-static is required for the two showcase videos.");
  throwIfAborted(signal);
  try { await fs.access(filename); throw new Error(`Video output already exists: ${filename}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const encoder = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-threads", "2",
    "-f", "image2pipe", "-vcodec", "png", "-framerate", String(frameRate), "-i", "pipe:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-an", "-threads", "2", "-movflags", "+faststart", "-n", filename], { stdio: ["pipe", "ignore", "pipe"] });
  let diagnostics = "", inputError;
  encoder.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
  encoder.stdin.on("error", error => { inputError = error; });
  const completion = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", code => code === 0 ? resolve() : reject(new Error(`Video encoder failed (${code}): ${diagnostics}`)));
  });
  completion.catch(() => {});
  const abort = () => encoder.kill();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (let frame = 0; frame < frameCount; frame++) {
      throwIfAborted(signal);
      if (inputError) throw inputError;
      const png = await render(frame);
      if (!encoder.stdin.write(png)) await once(encoder.stdin, "drain");
      await progress(onProgress, { phase: "encode", current: frame + 1, total: frameCount });
      if (frame % 60 === 0) globalThis.gc?.();
    }
    encoder.stdin.end();
    await completion;
  } catch (error) {
    encoder.kill();
    let terminationError;
    try { await completion; } catch (failure) { terminationError = failure; }
    try { await fs.rm(filename, { force: true }); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Video encoding failed and partial-output cleanup also failed."); }
    if (terminationError && terminationError !== error && error.name !== "AbortError") {
      throw new AggregateError([error, terminationError], `Video encoding failed: ${error.message}`);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function loadShowcaseResources() {
  const propsCatalog = JSON.parse(await fs.readFile(path.join(repo, "motions", "review-props.json"), "utf8"));
  const approved = new Set((await loadCatalogueRows())
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

function composeWithAutomaticBridges(items, options, sampleClipMotion, enabled, label, { deferBridgeFootSlideCheck = false } = {}) {
  const adjusted = items.map(item => ({ ...item }));
  const original = composePerformance(adjusted, options);
  const before = performanceContinuity(original, sampleClipMotion, { signal: options.signal });
  if (!enabled || before.maxJointStep <= 14) return { performance: original, continuity: before, bridgeRecords: [] };
  const bridgeByItem = new Map();
  let performance = original, continuity = before;
  for (let attempt = 0; attempt < 40 && continuity.maxJointStep > 14; attempt++) {
    const frame = continuity.worstFrame;
    const segment = performance.segments.find(seg => frame <= seg.end && frame >= seg.gapStart);
    if (!segment || segment.relocated) break;
    const segIndex = performance.segments.indexOf(segment);
    const item = adjusted[segment.itemIndex];
    if (!item || item.relocate !== undefined) break;
    const record = bridgeByItem.get(segment.itemIndex) ?? {
      from: performance.segments[segIndex - 1]?.id ?? null,
      to: segment.id,
      costBefore: continuity.maxJointStep,
      trimStart: 0,
      frames: 0
    };
    let trackBridge = segIndex > 0;
    if (frame < segment.start) {
      const current = segment.start - segment.gapStart + 1;
      if (current >= 49) break;
      const maxJointDist = measurePoseJoinDistance(performance, segment, sampleClipMotion);
      const scaledFrames = computeBridgeFramesFromDistance(maxJointDist);
      item.gap = Math.min(49, Math.max(current + 1, scaledFrames + 1));
      record.frames = Math.max(record.frames, item.gap - 1);
    } else if (segment.kind === "motion") {
      const motion = options.motions.get(item.motion);
      const sourceFrame = (item._trimStart ?? 0) + Math.max(0, frame - segment.start);
      const nextKey = motion?.spec.poseKeys?.find(key => key.frame > sourceFrame && key.frame <= (item._trimStart ?? 0) + 48);
      if (segIndex > 0 && nextKey && !motion?.clip?.loop) {
        item._trimStart = nextKey.frame;
        const current = segment.start - segment.gapStart + 1;
        const desired = Math.max(6, Math.min(24, Math.ceil(before.maxJointStep / 14 * 6)));
        item.gap = Math.max(current, Math.min(25, desired + 1));
        record.trimStart = item._trimStart;
        record.frames = Math.max(6, item.gap - 1);
      } else {
        const nextScale = Number(((item._timeScale ?? 1) + 0.15).toFixed(2));
        if (nextScale > 2.2) break;
        item._timeScale = nextScale;
        trackBridge = false;
      }
    } else break;
    if (trackBridge) {
      record.frames = Math.max(6, Math.min(48, record.frames || Math.ceil(before.maxJointStep / 14 * 6)));
      record.costAfter = continuity.maxJointStep;
      bridgeByItem.set(segment.itemIndex, record);
      item._bridge = record;
    }
    performance = composePerformance(adjusted, options);
    continuity = performanceContinuity(performance, sampleClipMotion, { signal: options.signal });
    if (trackBridge) record.costAfter = continuity.maxJointStep;
  }
  if (continuity.maxJointStep > 14) {
    throw new Error(`${label}: automatic bridge could not reduce continuity ${continuity.maxJointStep} below limit 14 (maximum bridge 48 frames).`);
  }
  const bridgeRecords = [...bridgeByItem].map(([itemIndex, record]) => {
    const segment = performance.segments.find(seg => seg.itemIndex === itemIndex);
    const startFrame = segment.gapStart, endFrame = segment.start - 1;
    const footSlides = continuity.footSlides.filter(slide => slide.frame >= startFrame && slide.frame <= endFrame);
    if (!deferBridgeFootSlideCheck && footSlides.length) throw new Error(`${label}: generated bridge ${record.from} -> ${record.to} slides a planted foot.`);
    return { ...record, itemIndex, startFrame, endFrame, frames: endFrame - startFrame + 1, feetLocked: footSlides.length === 0, kind: "generated-bridge" };
  });
  return { performance, continuity, bridgeRecords };
}

export async function composeFilm(recipe, resources, { signal } = {}) {
  const { approved, sampleClipMotion } = resources;
  const ids = new Set([...recipe.performance.map(item => item.motion), ...(recipe.set ?? []).map(item => item.motion), ...(recipe.extras ?? []).flatMap(item => [item.motion, ...(item.actor ?? []).map(entry => entry.motion)])].filter(Boolean));
  const neutral = RUNTIME_MOTION_LIBRARY.clips.idle.frames[0];
  const allowRuntime = Boolean(recipe.declarative);
  const motions = new Map();
  for (const id of ids) {
    throwIfAborted(signal);
    motions.set(id, await resolveFilmMotion(id, approved, neutral, { allowRuntime }));
  }
  const lead = composeWithMeasuredSupport(recipe.performance, { motions, sampleClipMotion, neutral, signal },
    sampleClipMotion, recipe.bridge !== "off", `${recipe.id}/lead`);
  const performance = lead.performance;
  for (const segment of performance.segments) if (segment.supportTransition) {
    const previous = performance.segments[performance.segments.indexOf(segment) - 1];
    if (previous?.id !== segment.supportTransition.from || segment.id !== segment.supportTransition.to)
      throw new Error(`${recipe.id}: support transition ${segment.itemIndex} no longer matches ${segment.supportTransition.from} -> ${segment.supportTransition.to}.`);
  }
  for (const seg of performance.segments.filter(item => item.kind === "walk"))
    if (!(await keyPoseGates(seg.clip, seg.spec)).passed) throw new Error(`${recipe.id}: a generated walk failed its mechanical gates.`);
  const continuity = lead.continuity;
  const requireContactSafe = recipe.id === "open-source" || recipe.id === "julius-caesar";
  assertContinuity(recipe.id + "/lead", performance, continuity, requireContactSafe);
  const extraWalks = new Map(), extraActors = new Map(), actorBridges = new Map();
  for (const extra of recipe.extras ?? []) if (extra.walk) {
    const spec = walkSpec(extra.walk, 1);
    extraWalks.set(extra, { spec, clip: buildKeyPoseClip(spec, neutral), sourceId: spec.id });
  } else if (extra.actor) {
    // A supporting actor is its own small continuous performance (soldier, conspirator), gated like the lead.
    const actorResult = composeWithMeasuredSupport(extra.actor, { motions, sampleClipMotion, neutral, scale: FILM_SCALE * extra.scale },
      sampleClipMotion, recipe.bridge !== "off", `${recipe.id}/extras/${recipe.extras.indexOf(extra)}`);
    const actor = actorResult.performance;
    actorBridges.set(extra, actorResult.bridgeRecords);
    for (const seg of actor.segments.filter(item => item.kind === "walk"))
      if (!(await keyPoseGates(seg.clip, seg.spec)).passed) throw new Error(`${recipe.id}: a supporting actor's walk failed its mechanical gates.`);
    const check = performanceContinuity(actor, sampleClipMotion, { signal });
    assertContinuity(`${recipe.id}/extras/${recipe.extras.indexOf(extra)}`, actor, check, requireContactSafe);
    extraActors.set(extra, actor);
  }
  const bridgeRecords = [...lead.bridgeRecords.map(record => ({ ...record, actor: "lead" })),
    ...[...actorBridges].flatMap(([extra, records]) => records.map(record => ({ ...record, actor: `extra-${recipe.extras.indexOf(extra)}` })))];
  return { motions, performance, continuity, extraWalks, extraActors, bridgeRecords, timeline: storyTimeline(recipe, performance) };
}

export async function createStoryRenderer(recipe, resources, composed, options = {}) {
  const { propsCatalog, colors, themeMotion, fonts, sampleClipMotion, frameGeometry } = resources;
  const { motions, performance, continuity, extraWalks, extraActors, bridgeRecords = [], timeline } = composed ?? await composeFilm(recipe, resources);
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
    throwIfAborted(options.signal);
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
    return { svg, png: new Resvg(outlineText(svg), options.width ? { ...rasterOptions, fitTo: { mode: "width", value: options.width } } : rasterOptions).render().asPng() };
  };
  const provenance = [...motions.values()].map(motion => ({ id: motion.sourceId, kind: "authored-key-pose", frames: motion.clip.frames.length, mechanicalCheck: "passed",
    specSha256: createHash("sha256").update(JSON.stringify(motion.spec)).digest("hex") }));
  const walks = performance.segments.filter(seg => seg.kind === "walk");
  const actorWalks = [...extraActors.values()].reduce((sum, cast) => sum + cast.segments.filter(seg => seg.kind === "walk").length, 0);
  if (walks.length || extraWalks.size || actorWalks) provenance.push({ id: "generated-walk", kind: "generated-from-walk-on-gait", count: walks.length + extraWalks.size + actorWalks, mechanicalCheck: "passed" });
  if (extraActors.size) provenance.push({ id: "supporting-actors", kind: "continuous-composite", count: extraActors.size,
    maxJointStep: Math.max(...[...extraActors.values()].map(cast => performanceContinuity(cast, sampleClipMotion).maxJointStep)), camera: "locked" });
  provenance.push(...bridgeRecords.map((bridge, index) => ({ id: `bridge-${index + 1}`, ...bridge })));
  provenance.push({ id: "film-performance", kind: "continuous-composite", frames: performance.frames, maxJointStep: continuity.maxJointStep, camera: "locked" });
  return { timeline, render, performance, provenance, bridgeRecords };
}

export function continuityJoin(performance, frame) {
  const index = performance.segments.findIndex(seg => frame <= seg.end);
  const seg = performance.segments[index];
  return { frame, from: performance.segments[index - 1]?.id ?? null, to: seg?.id ?? null, item: seg?.itemIndex ?? index, inBlend: !!seg && frame < seg.start };
}
function assertContinuity(label, performance, check, requireContactSafe = false) {
  if (check.maxJointStep > 14) throw new Error(`${label}: continuity ${check.maxJointStep} exceeds limit 14 at offending join ${JSON.stringify(continuityJoin(performance, check.worstFrame))}.`);
  if (requireContactSafe && check.footSlides.length > 0) throw new Error(`${label}: planted-foot slides exceed the 1.2-unit contact limit at ${JSON.stringify(check.footSlides[0])}; transitions=${JSON.stringify(check.supportTransitions)}.`);
}
