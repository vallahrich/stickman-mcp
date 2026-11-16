import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as helpers from "./helpers.mjs";
import { renderReviewHtml } from "./review-renderer.mjs";
import { buildKeyPoseClip, keyPoseGates } from "./keypose.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDirArgIndex = process.argv.indexOf("--out-dir");
const factoryDir = outDirArgIndex >= 0 && process.argv[outDirArgIndex + 1]
  ? path.resolve(process.argv[outDirArgIndex + 1])
  : path.resolve(process.env.MOTION_OUT_DIR ?? path.join(os.tmpdir(), "stickman-motion-factory"));
const baselinesPath = path.join(repo, "motions", "baselines.json");
const propsCatalogPath = path.join(repo, "motions", "props-catalog.json");
const baselineIds = new Set(["walk", "run", "jump", "stop", "point", "idle"]);
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
if (!only) {
  console.error("Use: npm run motions:build -- --only <id> [--out-dir <dir>]. Full library assembly is npm run motions:assemble.");
  process.exit(2);
}
const specPath = path.join(repo, "motions", "specs", `${only}.json`);
const spec = JSON.parse(await readFile(specPath, "utf8"));
const outDir = path.join(factoryDir, "clips", only);
await mkdir(outDir, { recursive: true });
const baselinesRaw = JSON.parse(await readFile(baselinesPath, "utf8"));
const baselineClips = baselinesRaw.clips ?? baselinesRaw;
const idleClip = baselineClips.idle;
const propsCatalog = JSON.parse(await readFile(propsCatalogPath, "utf8"));
const ctx = {
  id: only,
  spec,
  processing: spec.processing ?? {},
  paths: { repo, baselinesPath, propsCatalogPath, factoryDir, outDir },
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
if (Array.isArray(spec.poseKeys) && spec.poseKeys.length && !baselineIds.has(only)) {
  const clip = buildKeyPoseClip(spec, idleClip.frames[0]);
  const gates = await keyPoseGates(clip, spec);
  const report = { id: only, status: spec.status, source: "authored key poses (shipping engine)", builtAt: "1970-01-01T00:00:00.000Z", frames: clip.frames.length, keys: clip.poseKeys.length, passed: gates.passed, failures: gates.failures };
  await writeFile(path.join(outDir, "clip.json"), JSON.stringify(clip, null, 2));
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, "review.html"), await renderReviewHtml({ clip, spec, report, propsCatalog }));
  console.log(JSON.stringify({ id: only, passed: report.passed, failures: report.failures }, null, 1));
  process.exit(report.passed ? 0 : 1);
}
let clip = null;
let source = "";
const hook = baselineIds.has(only) ? {} : await loadHook(only);
if (baselineIds.has(only)) {
  clip = structuredClone(baselineClips[only]);
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
const html = await renderReviewHtml({ clip, spec, report, propsCatalog });
await writeFile(path.join(outDir, "review.html"), html);
console.log(`${only}: wrote ${outDir}`);
