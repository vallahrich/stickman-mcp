import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const text = await readFile(path.join(repo, "src", "generated", "motion-library.ts"), "utf8");
const match = text.match(/GENERATED_MOTION_LIBRARY(?:: any)? = (.*);/s);
if (!match) throw new Error("Generated library not found; run npm run motions:build first.");
const lib = JSON.parse(match[1]);
const failures = [];
const baselineIds = ["walk", "run", "jump", "stop", "point", "idle"];
if (lib.version !== 1 || lib.fps !== 30) failures.push("library header must be version 1 at 30 fps");
for (const [id, clip] of Object.entries(lib.clips ?? {})) {
  if (clip.name !== id) failures.push(`${id}: clip name mismatch`);
  if (clip.fps !== 30) failures.push(`${id}: fps must be 30`);
  if (!Array.isArray(clip.frames) || clip.frames.length < 3) failures.push(`${id}: too few frames`);
  if (!clip.meta?.quality?.passed) failures.push(`${id}: quality meta is not passed`);
  for (const [i, frame] of (clip.frames ?? []).entries()) {
    for (const key of ["root", "angles", "contacts"]) if (!(key in frame)) failures.push(`${id}[${i}]: missing ${key}`);
    if (frame.facing != null && (frame.facing < -1 || frame.facing > 1)) failures.push(`${id}[${i}]: facing out of range`);
  }
}
if (Object.keys(lib.clips ?? {}).length < 6) failures.push(`expected at least 6 assembled clips, got ${Object.keys(lib.clips ?? {}).length}`);
for (const id of baselineIds) {
  if (!lib.clips?.[id]) failures.push(`missing approved baseline ${id}`);
  else if (!lib.clips[id].meta?.quality?.approvedBaseline) failures.push(`${id}: baseline must be marked approvedBaseline`);
}
if (failures.length) { console.error(`Motion quality check failed:\n${failures.join("\n")}`); process.exit(1); }
console.log(`Motion quality check passed for ${Object.keys(lib.clips).length} clips.`);
