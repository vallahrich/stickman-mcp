import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anatomicalGates } from "./helpers.mjs";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sessionFiles = "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files";
const factoryClipsDir = path.join(sessionFiles, "motion-factory", "clips");
const text = await readFile(path.join(repo, "src", "generated", "motion-library.ts"), "utf8");
const match = text.match(/GENERATED_MOTION_LIBRARY(?:: any)? = (.*);/s);
if (!match) throw new Error("Generated library not found; run npm run motions:build first.");
const lib = JSON.parse(match[1]);
const failures = [];
const baselineIds = ["walk", "run", "jump", "stop", "point", "idle"];
const baselineSet = new Set(baselineIds);
const requestedCandidates = new Set(["push", "climb-ladder", "turn-around", "step-up", "wave"]);
async function readSpec(id) {
  try { return JSON.parse(await readFile(path.join(repo, "motions", "specs", `${id}.json`), "utf8")); }
  catch { return {}; }
}
function gateSummary(id, gates) {
  return gates
    .filter((gate) => !gate.pass)
    .map((gate) => `${id}: ${gate.name} failed at frame ${gate.frame ?? "n/a"}${gate.side ? ` (${gate.side})` : ""}: ${gate.value} vs ${gate.threshold}${gate.kneeAngle != null ? `, kneeAngle=${gate.kneeAngle}` : ""}`);
}
if (lib.version !== 1 || lib.fps !== 30) failures.push("library header must be version 1 at 30 fps");
const anatomyReport = { baselinesInfo: {}, generated: {}, candidates: {} };
for (const [id, clip] of Object.entries(lib.clips ?? {})) {
  if (clip.name !== id) failures.push(`${id}: clip name mismatch`);
  if (clip.fps !== 30) failures.push(`${id}: fps must be 30`);
  if (!Array.isArray(clip.frames) || clip.frames.length < 3) failures.push(`${id}: too few frames`);
  if (!clip.meta?.quality?.passed) failures.push(`${id}: quality meta is not passed`);
  for (const [i, frame] of (clip.frames ?? []).entries()) {
    for (const key of ["root", "angles", "contacts"]) if (!(key in frame)) failures.push(`${id}[${i}]: missing ${key}`);
    if (frame.facing != null && (frame.facing < -1 || frame.facing > 1)) failures.push(`${id}[${i}]: facing out of range`);
  }
  const gates = anatomicalGates(clip, await readSpec(id));
  if (baselineSet.has(id)) anatomyReport.baselinesInfo[id] = gates;
  else {
    anatomyReport.generated[id] = gates;
    failures.push(...gateSummary(id, gates));
  }
}
if (Object.keys(lib.clips ?? {}).length < 6) failures.push(`expected at least 6 assembled clips, got ${Object.keys(lib.clips ?? {}).length}`);
for (const id of baselineIds) {
  if (!lib.clips?.[id]) failures.push(`missing approved baseline ${id}`);
  else if (!lib.clips[id].meta?.quality?.approvedBaseline) failures.push(`${id}: baseline must be marked approvedBaseline`);
}
try {
  for (const dirent of await readdir(factoryClipsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || baselineSet.has(dirent.name)) continue;
    const id = dirent.name;
    const clip = JSON.parse(await readFile(path.join(factoryClipsDir, id, "clip.json"), "utf8"));
    const gates = anatomicalGates(clip, await readSpec(id));
    anatomyReport.candidates[id] = gates;
    failures.push(...gateSummary(`candidate ${id}`, gates));
  }
} catch {
  // Candidate clip reports are optional; generated library checks above are authoritative.
}
await mkdir(path.join(sessionFiles, "motion-factory"), { recursive: true });
await writeFile(path.join(sessionFiles, "motion-factory", "anatomy-report.json"), JSON.stringify(anatomyReport, null, 2));
const baselineInfo = Object.entries(anatomyReport.baselinesInfo).flatMap(([id, gates]) => gateSummary(`baseline ${id}`, gates));
if (baselineInfo.length) console.warn(`Baseline anatomy info (exempt):\n${baselineInfo.join("\n")}`);
for (const id of requestedCandidates) {
  const gates = anatomyReport.candidates[id];
  if (!gates) console.warn(`Candidate ${id}: no per-motion clip found to anatomy-check`);
  else {
    const failed = gateSummary(`candidate ${id}`, gates);
    console.warn(failed.length ? failed.join("\n") : `candidate ${id}: anatomy gates passed`);
  }
}
if (failures.length) { console.error(`Motion quality check failed:\n${failures.join("\n")}`); process.exit(1); }
console.log(`Motion quality check passed for ${Object.keys(lib.clips).length} clips.`);
