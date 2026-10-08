import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import { Resvg } from "@resvg/resvg-js";
import { repo, readMotion, parseCatalogue, variants } from "../site/catalogue.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";
import { loadEngineRenderer } from "../motions/review-renderer.mjs";
import { RUNTIME_MOTION_LIBRARY } from "../../dist/motion-library.js";
import { composePerformance, createPerformanceRenderer, performanceContinuity, renderExtra, walkSpec, FILM_SCALE } from "../site/performance.mjs";
import { storyTimeline, renderStoryFrame, filmExtras } from "../site/story-films.mjs";

const fps = 30;
const rasterOptions = { font: { loadSystemFonts: false } };
export async function encodeVideo(filename, frameCount, render, frameRate = fps) {
  if (!ffmpeg) throw new Error("ffmpeg-static is required for the two showcase videos.");
  const encoder = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-threads", "2",
    "-f", "image2pipe", "-vcodec", "png", "-framerate", String(frameRate), "-i", "pipe:0",
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

function composeWithAutomaticBridges(items, options, sampleClipMotion, enabled, label) {
  const adjusted = items.map(item => ({ ...item }));
  const original = composePerformance(adjusted, options);
  const before = performanceContinuity(original, sampleClipMotion);
  if (!enabled || before.maxJointStep <= 14) return { performance: original, continuity: before, bridgeRecords: [] };
  const bridgeByItem = new Map();
  let performance = original, continuity = before;
  for (let attempt = 0; attempt < 32 && continuity.maxJointStep > 14; attempt++) {
    const frame = continuity.worstFrame;
    const segment = performance.segments.find(seg => frame <= seg.end && frame >= seg.start - 1);
    if (!segment || segment.relocated) break;
    const item = adjusted[segment.itemIndex];
    if (!item || item.relocate !== undefined) break;
    const record = bridgeByItem.get(segment.itemIndex) ?? { from: performance.segments[performance.segments.indexOf(segment) - 1]?.id ?? null,
      to: segment.id, costBefore: before.maxJointStep, trimStart: 0, frames: 0 };
    if (frame < segment.start) {
      const current = segment.start - segment.gapStart + 1;
      if (current >= 25) break;
      item.gap = Math.min(25, current + 1);
      record.frames = Math.max(record.frames, item.gap - 1);
    } else if (segment.kind === "motion") {
      const motion = options.motions.get(item.motion);
      const sourceFrame = (item._trimStart ?? 0) + Math.max(0, frame - segment.start);
      const nextKey = motion?.spec.poseKeys?.find(key => key.frame > sourceFrame && key.frame <= (item._trimStart ?? 0) + 48);
      if (!nextKey) break;
      item._trimStart = nextKey.frame;
      const current = segment.start - segment.gapStart + 1;
      const desired = Math.max(6, Math.min(24, Math.ceil(before.maxJointStep / 14 * 6)));
      item.gap = Math.max(current, Math.min(25, desired + 1));
      record.trimStart = item._trimStart;
      record.frames = Math.max(6, item.gap - 1);
    } else break;
    record.frames = Math.max(6, Math.min(24, record.frames || Math.ceil(before.maxJointStep / 14 * 6)));
    record.costAfter = continuity.maxJointStep;
    bridgeByItem.set(segment.itemIndex, record);
    item._bridge = record;
    performance = composePerformance(adjusted, options);
    continuity = performanceContinuity(performance, sampleClipMotion);
    record.costAfter = continuity.maxJointStep;
  }
  if (continuity.maxJointStep > 14) {
    throw new Error(`${label}: automatic bridge could not reduce continuity ${continuity.maxJointStep} below limit 14 (maximum bridge 24 frames).`);
  }
  const bridgeRecords = [...bridgeByItem].map(([itemIndex, record]) => {
    const segment = performance.segments.find(seg => seg.itemIndex === itemIndex);
    const startFrame = segment.gapStart, endFrame = segment.start - 1;
    const footSlides = continuity.footSlides.filter(slide => slide.frame >= startFrame && slide.frame <= endFrame);
    if (footSlides.length) throw new Error(`${label}: generated bridge ${record.from} -> ${record.to} slides a planted foot.`);
    return { ...record, itemIndex, startFrame, endFrame, frames: endFrame - startFrame + 1, feetLocked: true, kind: "generated-bridge" };
  });
  return { performance, continuity, bridgeRecords };
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
  const lead = composeWithAutomaticBridges(recipe.performance, { motions, sampleClipMotion, neutral }, sampleClipMotion, recipe.bridge === "auto", `${recipe.id}/lead`);
  const performance = lead.performance;
  for (const seg of performance.segments.filter(item => item.kind === "walk"))
    if (!(await keyPoseGates(seg.clip, seg.spec)).passed) throw new Error(`${recipe.id}: a generated walk failed its mechanical gates.`);
  const continuity = lead.continuity;
  assertContinuity(recipe.id + "/lead", performance, continuity);
  const extraWalks = new Map(), extraActors = new Map(), actorBridges = new Map();
  for (const extra of recipe.extras ?? []) if (extra.walk) {
    const spec = walkSpec(extra.walk, 1);
    extraWalks.set(extra, { spec, clip: buildKeyPoseClip(spec, neutral), sourceId: spec.id });
  } else if (extra.actor) {
    // A supporting actor is its own small continuous performance (soldier, conspirator), gated like the lead.
    const actorResult = composeWithAutomaticBridges(extra.actor, { motions, sampleClipMotion, neutral, scale: FILM_SCALE * extra.scale },
      sampleClipMotion, recipe.bridge === "auto", `${recipe.id}/extras/${recipe.extras.indexOf(extra)}`);
    const actor = actorResult.performance;
    actorBridges.set(extra, actorResult.bridgeRecords);
    for (const seg of actor.segments.filter(item => item.kind === "walk"))
      if (!(await keyPoseGates(seg.clip, seg.spec)).passed) throw new Error(`${recipe.id}: a supporting actor's walk failed its mechanical gates.`);
    const check = performanceContinuity(actor, sampleClipMotion);
    assertContinuity(`${recipe.id}/extras/${recipe.extras.indexOf(extra)}`, actor, check);
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
function assertContinuity(label, performance, check) {
  if (check.maxJointStep > 14) throw new Error(`${label}: continuity ${check.maxJointStep} exceeds limit 14 at offending join ${JSON.stringify(continuityJoin(performance, check.worstFrame))}.`);
}
