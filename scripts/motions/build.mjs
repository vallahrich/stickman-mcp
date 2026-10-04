import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as helpers from "./helpers.mjs";
import { renderReviewHtml } from "./review-renderer.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sessionFiles = process.env.STICKMAN_SESSION_FILES ?? process.env.MOTION_SESSION_FILES ?? "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files";
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
const runClip = JSON.parse(await readFile(path.join(approvedDir, "run.json"), "utf8"));
const propsCatalog = JSON.parse(await readFile(path.join(sessionFiles, "design", "props.json"), "utf8"));
const html = await renderReviewHtml({ clip, spec, report, runClip, propsCatalog });
await writeFile(path.join(outDir, "review.html"), html);
console.log(`${only}: wrote ${outDir}`);
