import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anatomicalGates } from "./helpers.mjs";
import { keyPoseGates } from "./keypose.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDirIndex = process.argv.indexOf("--out-dir");
const reportDir = outDirIndex >= 0 ? process.argv[outDirIndex + 1] : null;

const ALIASES = {
  kick: "kick-ball",
  throw: "throw-ball",
  "pull-banner": "pull-banner-top"
};

const text = await readFile(path.join(repo, "src", "generated", "motion-library.ts"), "utf8");
const match = text.match(/GENERATED_MOTION_LIBRARY(?:: any)? = (.*);/s);
if (!match) throw new Error("Generated library not found; run npm run motions:assemble first.");
const lib = JSON.parse(match[1]);

const baselinesRaw = JSON.parse(await readFile(path.join(repo, "motions", "baselines.json"), "utf8"));
const baselineClips = baselinesRaw.clips ?? baselinesRaw;

const failures = [];
const baselineIds = ["walk", "run", "jump", "stop", "point", "idle"];
const baselineSet = new Set(baselineIds);

async function readSpec(id) {
  const sourceId = ALIASES[id] ?? id;
  try {
    return JSON.parse(await readFile(path.join(repo, "motions", "specs", `${sourceId}.json`), "utf8"));
  } catch {
    return {};
  }
}

function gateSummary(id, gates) {
  return gates
    .filter((gate) => !gate.pass)
    .map((gate) => `${id}: ${gate.name} failed at frame ${gate.frame ?? "n/a"}${gate.side ? ` (${gate.side})` : ""}: ${gate.value} vs ${gate.threshold}${gate.kneeAngle != null ? `, kneeAngle=${gate.kneeAngle}` : ""}`);
}

function keyPoseSummary(id, kpFailures) {
  return kpFailures.map((f) => `${id}: keyPoseGate ${f.metric} failed at frame ${f.frame}: ${f.value} (${f.threshold})`);
}

if (lib.version !== 1 || lib.fps !== 30) failures.push("library header must be version 1 at 30 fps");

const anatomyReport = { baselinesInfo: {}, generated: {}, keyPose: {} };
let keyPoseClipCount = 0;

for (const [id, clip] of Object.entries(lib.clips ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
  if (clip.name !== id) failures.push(`${id}: clip name mismatch`);
  if (clip.fps !== 30) failures.push(`${id}: fps must be 30`);
  if (!Array.isArray(clip.frames) || clip.frames.length < 3) failures.push(`${id}: too few frames`);
  if (!clip.meta?.quality?.passed) failures.push(`${id}: quality meta is not passed`);
  for (const [i, frame] of (clip.frames ?? []).entries()) {
    for (const key of ["root", "angles", "contacts"]) if (!(key in frame)) failures.push(`${id}[${i}]: missing ${key}`);
    if (frame.facing != null && (frame.facing < -1 || frame.facing > 1)) failures.push(`${id}[${i}]: facing out of range`);
  }
  const spec = await readSpec(id);
  const gates = anatomicalGates(clip, spec);
  if (baselineSet.has(id)) {
    anatomyReport.baselinesInfo[id] = gates;
  } else {
    anatomyReport.generated[id] = gates;
    failures.push(...gateSummary(id, gates));
  }
  if (Array.isArray(clip.poseKeys) && clip.poseKeys.length > 0) {
    keyPoseClipCount++;
    if (clip.meta?.kind && clip.meta.kind !== "hold" && (clip.meta.kind === "loop") !== Boolean(clip.loop)) {
      failures.push(`${id}: clip.loop (${Boolean(clip.loop)}) must match clip.meta.kind (${clip.meta.kind})`);
    }
    const kp = await keyPoseGates(clip, spec);
    anatomyReport.keyPose[id] = kp;
    if (!kp.passed) failures.push(...keyPoseSummary(id, kp.failures));
  }
}

if (Object.keys(lib.clips ?? {}).length < 6) {
  failures.push(`expected at least 6 assembled clips, got ${Object.keys(lib.clips ?? {}).length}`);
}

for (const id of baselineIds) {
  const assembled = lib.clips?.[id];
  const expected = baselineClips[id];
  if (!assembled) {
    failures.push(`missing approved baseline ${id}`);
  } else {
    if (!assembled.meta?.quality?.approvedBaseline) failures.push(`${id}: baseline must be marked approvedBaseline`);
    if (JSON.stringify(assembled.frames) !== JSON.stringify(expected?.frames)
      || assembled.strideLength !== expected?.strideLength) {
      failures.push(`${id}: baseline frames/strideLength drifted from motions/baselines.json`);
    }
  }
}

if (reportDir) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, "anatomy-report.json"), `${JSON.stringify(anatomyReport, null, 2)}\n`);
}

const baselineInfo = Object.entries(anatomyReport.baselinesInfo).flatMap(([id, gates]) => gateSummary(`baseline ${id}`, gates));
if (baselineInfo.length) console.warn(`Baseline anatomy info (exempt):\n${baselineInfo.join("\n")}`);

if (failures.length) {
  console.error(`Motion quality check failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`Motion quality check passed for ${Object.keys(lib.clips).length} clips (${keyPoseClipCount} key-pose clips, ${baselineIds.length} baselines).`);
