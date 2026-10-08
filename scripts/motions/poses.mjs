import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const specsDir = path.join(repo, "motions", "specs");
const output = path.join(repo, "motions", "poses", "poses.json");
const entries = {
  stand: ["bow", 0], "stand-arms-down": ["arms-crossed", 0], crouch: ["crouch", 23], "step-forward": ["kneel-down", 9], "kneel-lowering": ["kneel-down", 18], "kneel-contact": ["kneel-down", 25], kneel: ["kneel-down", 30],
  sit: ["sit-floor", 65], "lie-face-down": ["lie-down", 108], "reach-forward": ["beckon", 28], "reach-up": ["wave", 22],
  point: ["beckon", 28], strike: ["punch", 24], carry: ["lift-carry", 98], "hands-on-hips": ["think", 16],
  "arms-crossed": ["arms-crossed", 25], "wave-up": ["wave", 22], think: ["think", 41], bow: ["bow", 27]
};
const poses = {};
for (const [name, [id, frame]] of Object.entries(entries)) {
  const sourcePath = path.join(specsDir, `${id}.json`);
  const text = await fs.readFile(sourcePath, "utf8");
  const spec = JSON.parse(text);
  if (!spec.poseKeys?.length) throw new Error(`${id} has no authored pose keys for ${name}`);
  const key = spec.poseKeys.find(item => item.frame === frame);
  if (!key) throw new Error(`${id} has no key at frame ${frame} for ${name}`);
  poses[name] = { pose: structuredClone(key.pose), easing: key.ease ?? "inOut", provenance: {
    sourceSpec: id, sourceStatus: spec.status, keyFrame: frame,
    specSha256: createHash("sha256").update(text).digest("hex")
  } };
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify({ version: 1, poses }, null, 2)}\n`);
console.log(`Wrote ${Object.keys(poses).length} poses to ${path.relative(repo, output)}`);

