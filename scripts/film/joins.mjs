import fs from "node:fs/promises";
import path from "node:path";
import { repo, readMotion } from "../site/catalogue.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";
import { engineSampledFrame } from "../motions/review-renderer.mjs";
import { RUNTIME_MOTION_LIBRARY } from "../../dist/motion-library.js";
import { composePerformance, performanceJoinCosts, performanceSupportLift, FILM_SCALE, walkSpec } from "../site/performance.mjs";
import { loadShowcaseResources, resolveFilmMotion } from "./runtime.mjs";

export const JOIN_LIMIT = 14;
const UNIT = 0.75;
const matrixPath = path.join(repo, "motions", "join-matrix.json");

export function computeBridgeFramesFromDistance(maxJointDist) {
  if (!Number.isFinite(maxJointDist) || maxJointDist <= 0) return 8;
  return Math.max(8, Math.min(48, Math.ceil(maxJointDist / 10)));
}

/** Pose-space maximum joint distance (engine units) between clip A's actual exit frame and clip B's entry frame. */
export function measurePoseJoinDistance(performance, segment, sampleClipMotion) {
  if (!segment || segment.gapStart <= 0 || segment.relocated) return 0;
  const exitFrame = Math.max(0, segment.gapStart - 1);
  const entryFrame = Math.min(performance.frames - 1, segment.start);
  const { clip, rootTrack, scale: S } = performance;
  const pointsAt = frame => {
    const sample = engineSampledFrame(sampleClipMotion, clip, frame);
    const shift = (rootTrack[frame] - 640) / S;
    const supportLift = performanceSupportLift(performance, frame);
    return [sample.head, ...sample.segments.map(item => ({ x: item.x2, y: item.y2 }))]
      .map(point => ({ x: point.x + shift, y: point.y - supportLift }));
  };
  const exitPts = pointsAt(exitFrame);
  const entryPts = pointsAt(entryFrame);
  let maxDist = 0;
  for (let i = 0; i < exitPts.length && i < entryPts.length; i++) {
    const dist = Math.hypot(entryPts[i].x - exitPts[i].x, entryPts[i].y - exitPts[i].y) / UNIT;
    if (dist > maxDist) maxDist = dist;
  }
  return Number(maxDist.toFixed(2));
}

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
  if (entry) {
    const bridgeFrames = Math.max(6, Math.min(24, Math.ceil(entry.cost / JOIN_LIMIT * 6)));
    return { ...entry, limit: JOIN_LIMIT, needsBridge: entry.cost > JOIN_LIMIT, bridgeFrames };
  }
  const resources = await loadShowcaseResources();
  const neutral = RUNTIME_MOTION_LIBRARY.clips.idle.frames[0];
  let motionA, motionB;
  try {
    motionA = await resolveFilmMotion(from, resources.approved, neutral);
    motionB = await resolveFilmMotion(to, resources.approved, neutral);
  } catch {
    throw new Error(`No approved join is available for ${from} -> ${to}.`);
  }
  const motions = new Map([[from, motionA], [to, motionB]]);
  const performance = composePerformance([{ motion: from, root: 400 }, { motion: to, gap: 1 }], {
    motions, sampleClipMotion: resources.sampleClipMotion, neutral, scale: FILM_SCALE
  });
  const cost = performanceJoinCosts(performance, resources.sampleClipMotion)[0]?.cost ?? 0;
  const maxJointDist = measurePoseJoinDistance(performance, performance.segments[1], resources.sampleClipMotion);
  const bridgeFrames = Math.max(
    Math.max(6, Math.min(24, Math.ceil(cost / JOIN_LIMIT * 6))),
    computeBridgeFramesFromDistance(maxJointDist)
  );
  return { from, to, cost, limit: JOIN_LIMIT, needsBridge: cost > JOIN_LIMIT, bridgeFrames };
}

export async function writeJoinMatrix({ check = false } = {}) {
  const current = JSON.stringify(await buildJoinMatrix(), null, 2) + "\n";
  if (check) {
    const saved = await fs.readFile(matrixPath, "utf8");
    if (saved !== current) throw new Error("motions/join-matrix.json is stale; run npm run motions:joins.");
  } else await fs.writeFile(matrixPath, current);
}
