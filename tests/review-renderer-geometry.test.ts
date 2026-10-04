import { describe, expect, it } from "vitest";
import { sampleClipMotion, type MotionClip, type PoseKey } from "../dist/motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "../dist/motion-library.js";
import { clipFrameToSampledFrame, REVIEW_STAGE } from "../scripts/motions/review-renderer.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../scripts/motions/keypose.mjs";

const stand: PoseKey = { anchor: "both", lean: 2, neck: -1, bob: 0, rLeg: { hip: 5, knee: 13 }, lLeg: { hip: -8, knee: 14 }, rArm: { shoulder: -8, elbow: 45 }, lArm: { shoulder: 8, elbow: 45 } };
const neutral = (RUNTIME_MOTION_LIBRARY.clips.idle as MotionClip).frames[0]!;

function keyed(poseKeys: { frame: number; pose: PoseKey }[], frames = 21): MotionClip {
  return buildKeyPoseClip({ id: "test-keyed", frames, poseKeys }, neutral) as MotionClip;
}

function engineAt(clip: MotionClip, frame: number) {
  const n = clip.frames.length;
  return sampleClipMotion({ clips: { [clip.name]: clip } }, { action: clip.name, clipId: clip.name, progress: clip.loop ? frame / n : frame / (n - 1), startX: REVIEW_STAGE.rootX, endX: REVIEW_STAGE.rootX, groundY: REVIEW_STAGE.groundY, facing: 1, scale: REVIEW_STAGE.scale });
}

describe("motion review renderer uses the shipping engine", () => {
  it("draws the approved run exactly as sampleClipMotion does", async () => {
    const run = RUNTIME_MOTION_LIBRARY.clips.run as MotionClip;
    for (const frame of [0, 5, 11, 17]) {
      const review = await clipFrameToSampledFrame(run, frame);
      const engine = engineAt(run, frame);
      expect(review.segments).toEqual(engine.segments);
      expect(review.head).toEqual(engine.headPoint);
    }
  });

  it("renders authored pose keys through the engine pose system", async () => {
    const lean = { ...stand, lean: 20 };
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 10, pose: lean }, { frame: 20, pose: stand }]);
    const mid = engineAt(clip, 10);
    const torso = mid.segments!.find(s => s.id === "torso")!;
    expect(Math.atan2(torso.x2 - torso.x1, torso.y1 - torso.y2) * 180 / Math.PI).toBeCloseTo(20, 4);
    const review = await clipFrameToSampledFrame(clip, 10);
    expect(review.segments).toEqual(mid.segments);
  });

  it("supports root offsets, raised foot plants, foot/hand targets and facing", () => {
    const up: PoseKey = { ...stand, anchor: "both", dx: 30, dy: 20, lPlant: 20, rPlant: 20, rHand: { x: 50, y: 120 }, facing: -1 };
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: up }]);
    const end = engineAt(clip, 20);
    const s = REVIEW_STAGE.scale;
    const lShin = end.segments!.find(x => x.id === "left-shin")!;
    expect(lShin.y2).toBeCloseTo(REVIEW_STAGE.groundY - 20 * s, 3);
    expect(end.joints!.rightHand.x).toBeCloseTo(REVIEW_STAGE.rootX - 50 * s, 3);
    expect(end.joints!.rightHand.y).toBeCloseTo(REVIEW_STAGE.groundY - 120 * s, 3);
    expect(end.joints!.pelvis.x).toBeCloseTo(REVIEW_STAGE.rootX - 30 * s, 3);
    expect(end.facing).toBe(-1);
    const footClip = keyed([{ frame: 0, pose: { ...stand, rFoot: { x: 20, y: 30 }, anchor: "l" } }, { frame: 20, pose: { ...stand, rFoot: { x: 20, y: 30 }, anchor: "l" } }]);
    const foot = engineAt(footClip, 10).segments!.find(x => x.id === "right-shin")!;
    expect(foot.x2).toBeCloseTo(REVIEW_STAGE.rootX + 20 * s, 3);
    expect(foot.y2).toBeCloseTo(REVIEW_STAGE.groundY - 30 * s, 3);
  });

  it("gates catch backward knees on the real engine output", async () => {
    const bad: PoseKey = { ...stand, anchor: null, bob: 20, rLeg: { hip: 0, knee: -40 } };
    const result = await keyPoseGates(keyed([{ frame: 0, pose: stand }, { frame: 10, pose: bad }, { frame: 20, pose: stand }]), { id: "t" });
    expect(result.failures.some((f: { metric: string }) => f.metric === "kneeBendsBackward")).toBe(true);
    const ok = await keyPoseGates(keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]), { id: "t" });
    expect(ok.passed).toBe(true);
  });
});
