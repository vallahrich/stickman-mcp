import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { buildKeyPoseClip, keyPoseGates } from "./keypose.mjs";
import { engineSampledFrame, loadEngineRenderer, renderStaticSvg } from "./review-renderer.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultSpecsDir = path.join(repo, "motions", "specs");
const libraryPath = path.join(repo, "motions", "poses", "poses.json");
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const jointPaths = new Set(["anchor", "lean", "neck", "bob", "dx", "dy", "facing", "rLeg.hip", "rLeg.knee", "rLeg.lift", "lLeg.hip", "lLeg.knee", "lLeg.lift", "rArm.shoulder", "rArm.elbow", "rArm.spread", "rArm.elbowSpread", "lArm.shoulder", "lArm.elbow", "lArm.spread", "lArm.elbowSpread", "rFoot.x", "rFoot.y", "lFoot.x", "lFoot.y"]);
const easingNames = new Set(["linear", "in", "out", "inOut", "hold"]);
const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));
const finite = (v, label) => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${label} must be finite.`); };

export async function loadPoseLibrary(file = libraryPath) {
  const library = await readJson(file);
  if (library.version !== 1 || !library.poses || typeof library.poses !== "object") throw new Error("Unsupported pose library format.");
  return library;
}
function applyOverrides(pose, overrides = {}, keyIndex = 0) {
  const value = structuredClone(pose);
  for (const [joint, next] of Object.entries(overrides)) {
    if (!jointPaths.has(joint)) throw new Error(`Unknown joint name \"${joint}\" at keys/${keyIndex}/overrides.`);
    if (joint === "anchor") {
      if (next !== null && !["both", "l", "r"].includes(next)) throw new Error(`Invalid anchor override at keys/${keyIndex}.`);
      value.anchor = next;
      continue;
    }
    finite(next, `Override ${joint}`);
    const parts = joint.split(".");
    let target = value;
    for (const part of parts.slice(0, -1)) target = target[part] ??= {};
    target[parts.at(-1)] = next;
  }
  return value;
}
function buildSpec(input, library) {
  if (!input || !idPattern.test(input.id ?? "")) throw new Error("id must match ^[a-z][a-z0-9-]{0,63}$.");
  if (typeof input.label !== "string" || !input.label.trim()) throw new Error("label is required.");
  if (!["oneshot", "loop"].includes(input.kind)) throw new Error("kind must be oneshot or loop.");
  if (!["side", "front", "three-quarter"].includes(input.view)) throw new Error("view must be side, front, or three-quarter.");
  if (!["in-place", "travel"].includes(input.travel)) throw new Error("travel must be in-place or travel.");
  if (!Array.isArray(input.keys) || input.keys.length < 2) throw new Error("keys must contain at least two pose keys.");
  if (input.easing !== undefined && !easingNames.has(input.easing)) throw new Error(`Unknown easing \"${input.easing}\".`);
  const keys = input.keys.map((key, index) => {
    if (!Number.isInteger(key.frame) || key.frame < 0) throw new Error(`keys/${index}/frame must be a non-negative integer.`);
    if (index && key.frame <= input.keys[index - 1].frame) throw new Error("keys must be in strictly increasing frame order.");
    const entry = library.poses[key.pose];
    if (!entry) throw new Error(`Unknown pose name \"${key.pose}\" at keys/${index}.`);
    const ease = key.easing ?? input.easing ?? entry.easing ?? "inOut";
    if (!easingNames.has(ease)) throw new Error(`Unknown easing \"${ease}\" at keys/${index}.`);
    return { frame: key.frame, pose: applyOverrides(entry.pose, key.overrides, index), ease };
  });
  if (keys[0].frame !== 0) throw new Error("The first pose key must be at frame 0.");
  const hold = input.hold ?? 0;
  if (!Number.isInteger(hold) || hold < 0 || hold > 1800) throw new Error("hold must be an integer from 0 to 1800.");
  let frames = input.frames ?? keys.at(-1).frame + 1 + hold;
  if (!Number.isInteger(frames) || frames < 2 || frames > 1800) throw new Error("frames must be an integer from 2 to 1800.");
  if (hold) {
    frames = Math.max(frames, keys.at(-1).frame + 1 + hold);
    keys.push({ frame: frames - 1, pose: structuredClone(keys.at(-1).pose), ease: "hold" });
  }
  if (keys.at(-1).frame !== frames - 1) throw new Error(`The last pose key must be at frame ${frames - 1}; set frames/hold accordingly.`);
  const props = input.props ?? [];
  if (!Array.isArray(props) || props.some(prop => typeof prop !== "string" || !prop.trim())) throw new Error("props must be an array of non-empty strings.");
  return {
    id: input.id, label: input.label.trim(), status: "draft",
    source: { dataset: "authored", file: "pose-library", subject: "pose-library", trial: input.id },
    kind: input.kind, travel: input.travel, view: input.view,
    expect: { pose: "author-defined", contacts: ["lFoot", "rFoot"], travel: input.travel, facingChange: 0 },
    contacts: ["lFoot", "rFoot"], prop: props[0] ?? null, aim: null, facingChange: 0, mirrorable: true,
    tags: [...new Set([...(input.tags ?? []), ...props])], notes: input.notes ?? "Authored from the reusable pose library.",
    approvedBaseline: false, frames, loop: input.kind === "loop", markers: {}, poseKeys: keys,
    gates: { maxJointStep: 14 }
  };
}

async function clipForSpec(spec) {
  const { runtimeLibrary } = await loadEngineRenderer();
  return spec.poseKeys?.length ? buildKeyPoseClip(spec, runtimeLibrary.clips.idle.frames[0]) : runtimeLibrary.clips[spec.id];
}
export async function renderMotionStrip(spec, outputFile, { count = 8, width = 320, height = 224, clip: providedClip } = {}) {
  const clip = providedClip ?? await clipForSpec(spec);
  if (!clip) throw new Error(`No reproducible clip for ${spec.id}.`);
  const columns = Math.min(count, clip.frames.length), rows = Math.ceil(count / columns);
  const svgCells = [];
  for (let i = 0; i < count; i++) {
    const frameIndex = count === 1 ? 0 : Math.round(i * (clip.frames.length - 1) / (count - 1));
    const rendered = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex, width, height });
    const png = new Resvg(rendered).render().asPng();
    const x = (i % columns) * width, y = Math.floor(i / columns) * height;
    svgCells.push(`<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/png;base64,${png.toString("base64")}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * width}" height="${rows * height}">${svgCells.join("")}</svg>`;
  const png = new Resvg(svg).render().asPng();
  await fs.writeFile(outputFile, png, { flag: "wx" });
  return { file: outputFile, frames: clip.frames.length, samples: count, width: columns * width, height: rows * height };
}

export async function authorMotion(input, { specDir = defaultSpecsDir, outputFile, poseLibraryFile = libraryPath } = {}) {
  if (!outputFile) throw new Error("outputFile is required.");
  const library = await loadPoseLibrary(poseLibraryFile);
  const spec = buildSpec(input, library);
  const specPath = path.join(specDir, `${spec.id}.json`);
  await fs.mkdir(specDir, { recursive: true });
  let exists = false;
  try {
    const details = await fs.lstat(specPath);
    if (details.isSymbolicLink() || !details.isFile()) throw new Error(`Refusing to write non-regular motion spec path: ${specPath}.`);
    const existing = await readJson(specPath);
    exists = true;
    if (existing.status !== "draft") throw new Error(`Refusing to overwrite ${spec.id}: existing spec status is \"${existing.status}\" (only draft specs may be replaced).`);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const clip = await clipForSpec(spec);
  const gates = await keyPoseGates(clip, spec);
  const { sampleClipMotion } = await loadEngineRenderer();
  const unitScale = 2.4;
  let maxJointStep = 0;
  let previous = null;
  for (let frame = 0; frame < clip.frames.length + (clip.loop ? 1 : 0); frame++) {
    const sample = engineSampledFrame(sampleClipMotion, clip, frame);
    if (previous) {
      const points = [{ x: sample.head.x, y: sample.head.y }, ...sample.segments.map(segment => ({ x: segment.x2, y: segment.y2 }))];
      const before = [{ x: previous.head.x, y: previous.head.y }, ...previous.segments.map(segment => ({ x: segment.x2, y: segment.y2 }))];
      points.forEach((point, i) => { maxJointStep = Math.max(maxJointStep, Math.hypot(point.x - before[i].x, point.y - before[i].y) / 0.75 * unitScale); });
    }
    previous = sample;
  }
  const report = { passed: gates.passed && maxJointStep <= 14, mechanical: gates, maxJointStep: Number(maxJointStep.toFixed(2)), limit: 14, filmScale: unitScale };
  const contents = `${JSON.stringify(spec, null, 2)}\n`;
  if (!exists) await fs.writeFile(specPath, contents, { flag: "wx" });
  else {
    const replacement = path.join(specDir, `.${spec.id}.${randomUUID()}.tmp`);
    try { await fs.writeFile(replacement, contents, { flag: "wx" }); await fs.rename(replacement, specPath); }
    finally { await fs.rm(replacement, { force: true }); }
  }
  const preview = await renderMotionStrip(spec, outputFile, { clip });
  return { spec, specPath, preview, checks: report };
}

export async function previewMotion(id, { specDir = defaultSpecsDir, outputFile, count = 8 } = {}) {
  if (!idPattern.test(id ?? "")) throw new Error("id must match ^[a-z][a-z0-9-]{0,63}$.");
  if (!outputFile) throw new Error("outputFile is required.");
  const spec = await readJson(path.join(specDir, `${id}.json`));
  if (!["draft", "candidate", "approved", "user-approved"].includes(spec.status)) throw new Error(`Motion ${id} has unsupported status \"${spec.status}\".`);
  const clip = await clipForSpec(spec);
  if (!clip) throw new Error(`No reproducible clip for ${id}.`);
  const gates = spec.poseKeys?.length ? await keyPoseGates(clip, spec) : null;
  const preview = await renderMotionStrip(spec, outputFile, { count, clip });
  return { id, status: spec.status, preview, checks: gates };
}


