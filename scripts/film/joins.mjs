import fs from "node:fs/promises";
import path from "node:path";
import { repo, readMotion } from "../site/catalogue.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";
import { RUNTIME_MOTION_LIBRARY } from "../../dist/motion-library.js";
import { composePerformance, performanceJoinCosts, FILM_SCALE, walkSpec } from "../site/performance.mjs";
import { loadShowcaseResources } from "./runtime.mjs";

export const JOIN_LIMIT = 14;
const matrixPath = path.join(repo, "motions", "join-matrix.json");

export async function buildJoinMatrix() {
  const resources = await loadShowcaseResources();
  const motions = new Map();
  for (const id of [...resources.approved].sort()) {
    const motion = await readMotion(id);
    if (!motion.spec.poseKeys?.length || !(await keyPoseGates(motion.clip, motion.spec)).passed) continue;
    motions.set(id, motion);
  }
  const neutral = RUNTIME_MOTION_LIBRARY.clips.idle.frames[0];
  motions.set("walk", { sourceId: "walk", spec: walkSpec(240), clip: buildKeyPoseClip(walkSpec(240), neutral) });
  const ids = [...motions.keys()].sort();
  const joins = [];
  for (const from of ids) for (const to of ids) {
    const performance = composePerformance([{ motion: from, root: 400 }, { motion: to, gap: 1 }], {
      motions, sampleClipMotion: resources.sampleClipMotion, neutral, scale: FILM_SCALE
    });
    const cost = performanceJoinCosts(performance, resources.sampleClipMotion)[0]?.cost ?? 0;
    joins.push({ from, to, cost });
  }
  return { version: 1, scale: FILM_SCALE, limit: JOIN_LIMIT, motions: ids, joins };
}

export async function readJoinMatrix() {
  return JSON.parse(await fs.readFile(matrixPath, "utf8"));
}

export async function checkJoin(from, to) {
  const matrix = await readJoinMatrix();
  const entry = matrix.joins.find(join => join.from === from && join.to === to);
  if (!entry) throw new Error(`No approved join is available for ${from} -> ${to}.`);
  const bridgeFrames = Math.max(6, Math.min(24, Math.ceil(entry.cost / JOIN_LIMIT * 6)));
  return { ...entry, limit: JOIN_LIMIT, needsBridge: entry.cost > JOIN_LIMIT, bridgeFrames };
}

export async function writeJoinMatrix({ check = false } = {}) {
  const current = JSON.stringify(await buildJoinMatrix(), null, 2) + "\n";
  if (check) {
    const saved = await fs.readFile(matrixPath, "utf8");
    if (saved !== current) throw new Error("motions/join-matrix.json is stale; run npm run motions:joins.");
  } else await fs.writeFile(matrixPath, current);
}
