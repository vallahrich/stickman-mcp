import { describe, expect, it } from "vitest";
import { GENERATED_MOTION_LIBRARY } from "../src/generated/motion-library.js";
// @ts-expect-error Authoring gate module is plain ESM.
import { buildKeyPoseClip, keyPoseGates } from "../scripts/motions/keypose.mjs";

const neutralFrame = GENERATED_MOTION_LIBRARY.clips.idle.frames[0];
const basePose = {
  anchor: "both" as const,
  lean: 2,
  neck: -1,
  bob: 0,
  dx: 0,
  facing: 1,
  rLeg: { hip: 5, knee: 13 },
  lLeg: { hip: -8, knee: 14 },
  rArm: { shoulder: -8, elbow: 45 },
  lArm: { shoulder: 8, elbow: 45 },
  rFoot: { x: 5, y: 0 },
  lFoot: { x: -7, y: 0 }
};

describe("generated motion library", () => {
  it("contains factory-quality 30 fps clips with metadata", () => {
    expect(GENERATED_MOTION_LIBRARY.version).toBe(1);
    expect(GENERATED_MOTION_LIBRARY.fps).toBe(30);
    const clips = Object.values(GENERATED_MOTION_LIBRARY.clips);
    expect(clips.length).toBeGreaterThanOrEqual(6);
    for (const id of ["walk", "run", "jump", "stop", "point", "idle"]) {
      expect(GENERATED_MOTION_LIBRARY.clips[id]).toBeDefined();
      expect(GENERATED_MOTION_LIBRARY.clips[id].meta.quality.approvedBaseline).toBe(true);
    }
    for (const clip of clips) {
      expect(clip.fps).toBe(30);
      expect(clip.frames.length).toBeGreaterThan(2);
      expect(clip.meta.quality.passed).toBe(true);
      expect(clip.meta.license).toContain("CMU mocap");
      for (const frame of clip.frames) {
        expect(Number.isFinite(frame.root.x)).toBe(true);
        expect(Number.isFinite(frame.root.y)).toBe(true);
        if ("facing" in frame) expect(frame.facing).toBeGreaterThanOrEqual(-1);
        if ("facing" in frame) expect(frame.facing).toBeLessThanOrEqual(1);
      }
    }
  });

  it("enforces loopSeam, groundedFloat, and jointAngularVelocity gates in keyPoseGates", async () => {
    const cleanLoopSpec = {
      id: "clean-loop-test",
      kind: "loop",
      travel: "in-place",
      frames: 12,
      loop: true,
      poseKeys: [
        { frame: 0, ease: "inOut", pose: basePose },
        { frame: 6, ease: "inOut", pose: { ...basePose, rArm: { shoulder: 18, elbow: 52 } } },
        { frame: 11, ease: "inOut", pose: basePose }
      ]
    };
    const cleanRes = await keyPoseGates(buildKeyPoseClip(cleanLoopSpec, neutralFrame), cleanLoopSpec);
    expect(cleanRes.passed, JSON.stringify(cleanRes.failures)).toBe(true);

    const brokenSeamSpec = {
      ...cleanLoopSpec,
      id: "broken-seam-test",
      poseKeys: [
        { frame: 0, ease: "linear", pose: basePose },
        { frame: 11, ease: "linear", pose: { ...basePose, rArm: { shoulder: 95, elbow: 20 } } }
      ]
    };
    const seamRes = await keyPoseGates(buildKeyPoseClip(brokenSeamSpec, neutralFrame), brokenSeamSpec);
    expect(seamRes.failures.some((f: { metric: string }) => f.metric === "loopSeam")).toBe(true);

    const floatingSpec = {
      id: "grounded-float-test",
      kind: "oneshot",
      travel: "in-place",
      frames: 10,
      loop: false,
      poseKeys: [
        { frame: 0, ease: "inOut", pose: basePose },
        { frame: 5, ease: "inOut", pose: { ...basePose, anchor: null, dy: 24, rFoot: { x: 5, y: 8 }, lFoot: { x: -7, y: 8 } } },
        { frame: 9, ease: "inOut", pose: basePose }
      ]
    };
    const floatRes = await keyPoseGates(buildKeyPoseClip(floatingSpec, neutralFrame), floatingSpec);
    expect(floatRes.failures.some((f: { metric: string }) => f.metric === "groundedFloat")).toBe(true);

    const snapSpec = {
      id: "ang-vel-snap-test",
      kind: "oneshot",
      travel: "in-place",
      frames: 6,
      loop: false,
      gates: { maxJointStep: 100 },
      poseKeys: [
        { frame: 0, ease: "linear", pose: basePose },
        { frame: 2, ease: "linear", pose: { ...basePose, rArm: { shoulder: -8, elbow: 10 } } },
        { frame: 3, ease: "linear", pose: { ...basePose, rArm: { shoulder: -8, elbow: 170 } } },
        { frame: 5, ease: "linear", pose: basePose }
      ]
    };
    const snapRes = await keyPoseGates(buildKeyPoseClip(snapSpec, neutralFrame), snapSpec);
    expect(snapRes.failures.some((f: { metric: string }) => f.metric === "jointAngularVelocity")).toBe(true);
  });
});
