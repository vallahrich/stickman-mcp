import { describe, expect, it } from "vitest";
import { MOTION_CLIP_LIBRARY, sampleClipMotion, sampleMotionClip, type MotionClip } from "../src/motion-clips.js";

const rad = (degrees: number): number => degrees * Math.PI / 180;
const wrap = (angle: number): number => ((angle + 180) % 360 + 360) % 360 - 180;
const dir = (angle: number): { x: number; y: number } => ({ x: Math.cos(rad(angle)), y: Math.sin(rad(angle)) });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function clipPose(clip: MotionClip, frameTime: number) {
  const { frame } = sampleMotionClip(clip, frameTime);
  const root = frame.root;
  const leg = (side: "l" | "r") => {
    const angles = frame.angles[`${side}Leg`];
    const thighAngle = frame.angles.torso + 180 + angles.thigh;
    const knee = { x: root.x + dir(thighAngle).x * clip.rig.thigh, y: root.y + dir(thighAngle).y * clip.rig.thigh };
    const shinAngle = thighAngle + angles.shin;
    const ankle = { x: knee.x + dir(shinAngle).x * clip.rig.shin, y: knee.y + dir(shinAngle).y * clip.rig.shin };
    const footAngle = shinAngle + angles.foot;
    const toe = { x: ankle.x + dir(footAngle).x * clip.rig.foot, y: ankle.y + dir(footAngle).y * clip.rig.foot };
    return { ankle, toe, contact: frame.contacts[side] };
  };
  return { root, left: leg("l"), right: leg("r") };
}

describe("mocap clip library", () => {
  it("samples loops across their seam with angle-aware interpolation", () => {
    for (const name of ["walk", "run", "idle"] as const) {
      const clip = MOTION_CLIP_LIBRARY.clips[name];
      const before = sampleMotionClip(clip, clip.frames.length - 0.15).frame;
      const after = sampleMotionClip(clip, 0.15).frame;
      expect(Math.abs(wrap(after.angles.torso - before.angles.torso))).toBeLessThan(18);
      expect(Math.abs(after.root.y - before.root.y)).toBeLessThan(5);
    }
  });

  it("keeps authored contact toe slide small in source clips", () => {
    for (const name of ["walk", "run", "idle"] as const) {
      const clip = MOTION_CLIP_LIBRARY.clips[name];
      const locked: Partial<Record<"left" | "right", { x: number; y: number }>> = {};
      let maxSlide = 0;
      for (let frame = 0; frame < clip.frames.length; frame++) {
        const pose = clipPose(clip, frame);
        for (const [side, foot] of [["left", pose.left], ["right", pose.right]] as const) {
          if (!foot.contact) {
            delete locked[side];
            continue;
          }
          locked[side] ??= foot.toe;
          maxSlide = Math.max(maxSlide, dist(locked[side]!, foot.toe));
        }
      }
      expect(maxSlide).toBeLessThanOrEqual(0.65);
    }
  });

  it("keeps the smoothed run loop low-jitter and seamless", () => {
    const clip = MOTION_CLIP_LIBRARY.clips.run;
    let maxJointAcceleration = 0;
    const poses = clip.frames.map((_, frame) => clipPose(clip, frame));
    for (let frame = 0; frame < clip.frames.length; frame++) {
      const prev = (frame - 1 + clip.frames.length) % clip.frames.length;
      const next = (frame + 1) % clip.frames.length;
      for (const side of ["left", "right"] as const) {
        for (const key of ["ankle", "toe"] as const) {
          const previous = poses[prev]![side][key];
          const current = poses[frame]![side][key];
          const following = poses[next]![side][key];
          const previousX = previous.x + (prev > frame ? -clip.strideLength : 0);
          const followingX = following.x + (next < frame ? clip.strideLength : 0);
          maxJointAcceleration = Math.max(maxJointAcceleration, Math.hypot(followingX - 2 * current.x + previousX, following.y - 2 * current.y + previous.y));
        }
      }
    }
    const velocities = clip.frames.map((frame, index) => {
      const next = (index + 1) % clip.frames.length;
      return {
        x: (next === 0 ? clip.frames[next]!.root.x + clip.strideLength : clip.frames[next]!.root.x) - frame.root.x,
        y: clip.frames[next]!.root.y - frame.root.y
      };
    });
    const velocityChanges = velocities.map((velocity, index) => dist(velocity, velocities[(index + 1) % velocities.length]!));
    const meanVelocityChange = velocityChanges.reduce((sum, value) => sum + value, 0) / velocityChanges.length;
    expect(maxJointAcceleration).toBeLessThan(5);
    expect(dist(velocities.at(-1)!, velocities[0]!)).toBeLessThan(meanVelocityChange);
  });

  it("stride-warps locomotion to the requested target within one unit", () => {
    for (const action of ["walk", "run"] as const) {
      const pose = sampleClipMotion(MOTION_CLIP_LIBRARY, {
        action, progress: 1, startX: 120, endX: 420, groundY: 290, facing: 1, scale: 1
      });
      expect(pose.rootX).toBeCloseTo(420, 0);
      expect(Math.abs(pose.strideScale - 1)).toBeLessThanOrEqual(0.15);
      expect(pose.cycles).toBeGreaterThanOrEqual(1);
    }
  });

  it.each([1, -1] as const)("accumulates authored loop travel continuously facing %s", (facing) => {
    const base = MOTION_CLIP_LIBRARY.clips.idle;
    const pose = {
      anchor: "both" as const, lean: 0, neck: 0, bob: 24,
      dx: 0, rLeg: { hip: 5, knee: 13 }, lLeg: { hip: -8, knee: 14 },
      rArm: { shoulder: -8, elbow: 45 }, lArm: { shoulder: 8, elbow: 45 },
      rFoot: { x: 10, y: 0 }, lFoot: { x: -10, y: 0 },
      rHand: { x: 15, y: 85 }, lHand: { x: -15, y: 85 }
    };
    const clip: MotionClip = {
      ...base, name: "travel-loop", frames: base.frames.slice(0, 4), loop: true, strideLength: 8,
      poseKeys: [
        { frame: 0, ease: "linear", pose },
        { frame: 3, ease: "linear", pose: {
          ...pose, dx: 6,
          rFoot: { x: 16, y: 0 }, lFoot: { x: -4, y: 0 },
          rHand: { x: 21, y: 85 }, lHand: { x: -9, y: 85 }
        } }
      ]
    };
    const sample = (frame: number, speed = 1) => sampleClipMotion({ clips: { [clip.name]: clip } }, {
      action: clip.name, progress: frame / 12, durationMs: 400, speed,
      startX: 100, endX: 100, groundY: 200, facing, scale: 0.75
    });
    for (const boundary of [4, 8, 12]) {
      const before = sample(boundary - 0.1), after = sample(boundary);
      for (const joint of ["pelvis", "leftAnkle", "rightAnkle", "leftHand", "rightHand"]) {
        expect(after.joints![joint]!.x - before.joints![joint]!.x).toBeCloseTo(facing * 0.15, 6);
        expect(after.joints![joint]!.y).toBeCloseTo(before.joints![joint]!.y, 6);
      }
    }
    expect(sample(12).joints!.pelvis.x - sample(0).joints!.pelvis.x).toBeCloseTo(facing * 18, 6);
    expect(sample(12, 2).joints!.pelvis.x - sample(0, 2).joints!.pelvis.x).toBeCloseTo(facing * 36, 6);
    const inPlace = { ...clip, strideLength: 0, poseKeys: [{ frame: 0, pose }] };
    const neutral = sampleClipMotion({ clips: { [clip.name]: inPlace } }, {
      action: clip.name, progress: 1, durationMs: 400, startX: 100, endX: 100, groundY: 200, facing, scale: 0.75
    });
    expect(neutral.joints!.pelvis.x).toBeCloseTo(100, 6);
  });

  it("never places sampled clip feet below the world floor", () => {
    for (const action of ["idle", "walk", "run", "jump", "point"] as const) {
      for (let i = 0; i <= 30; i++) {
        const pose = sampleClipMotion(MOTION_CLIP_LIBRARY, {
          action, progress: i / 30, startX: 100, endX: action === "run" ? 360 : 220, groundY: 290, facing: 1, scale: 1
        });
        expect(pose.leftFoot.y).toBeLessThanOrEqual(290);
        expect(pose.rightFoot.y).toBeLessThanOrEqual(290);
      }
    }
  });

  it("aims the point clip hand within ten degrees of the target", () => {
    const target = { x: 260, y: 120 };
    const pose = sampleClipMotion(MOTION_CLIP_LIBRARY, {
      action: "point", progress: 0.5, startX: 140, endX: 140, groundY: 290, facing: 1, scale: 1, pointTarget: target
    });
    const shoulder = { x: pose.rootX + Math.sin(pose.lean) * 45, y: 290 - pose.hipHeight - Math.cos(pose.lean) * 45 };
    const upper = pose.arms.right.upper - pose.lean;
    const elbow = { x: shoulder.x + Math.sin(upper) * 28, y: shoulder.y + Math.cos(upper) * 28 };
    const lower = upper + pose.arms.right.bend;
    const hand = { x: elbow.x + Math.sin(lower) * 28, y: elbow.y + Math.cos(lower) * 28 };
    const handAngle = Math.atan2(hand.y - shoulder.y, hand.x - shoulder.x);
    const targetAngle = Math.atan2(target.y - shoulder.y, target.x - shoulder.x);
    expect(Math.abs(Math.atan2(Math.sin(handAngle - targetAngle), Math.cos(handAngle - targetAngle))) * 180 / Math.PI).toBeLessThan(10);
  });

  it("projects authored arm spread in front view and removes it in side view", () => {
    const base = MOTION_CLIP_LIBRARY.clips.idle;
    const spreadClip: MotionClip = {
      ...base,
      name: "spread-test",
      loop: false,
      frames: base.frames.slice(0, 2),
      poseKeys: [{
        frame: 0,
        pose: {
          anchor: "both",
          lean: 0,
          neck: 0,
          bob: 0,
          facing: 0,
          rLeg: { hip: 5, knee: 13 },
          lLeg: { hip: -8, knee: 14 },
          rArm: { shoulder: 0, elbow: 0, spread: 60, elbowSpread: 10 },
          lArm: { shoulder: 0, elbow: 0, spread: 60, elbowSpread: 10 }
        }
      }]
    };
    const library = { ...MOTION_CLIP_LIBRARY, clips: { ...MOTION_CLIP_LIBRARY.clips, "spread-test": spreadClip } };
    const front = sampleClipMotion(library, { action: "spread-test", progress: 0, startX: 100, endX: 100, groundY: 290, facing: 1, scale: 1, clipId: "spread-test" });
    const sideClip = { ...spreadClip, poseKeys: [{ ...spreadClip.poseKeys![0]!, pose: { ...spreadClip.poseKeys![0]!.pose, facing: 1 } }] };
    const side = sampleClipMotion({ ...MOTION_CLIP_LIBRARY, clips: { ...MOTION_CLIP_LIBRARY.clips, "spread-test": sideClip } }, { action: "spread-test", progress: 0, startX: 100, endX: 100, groundY: 290, facing: 1, scale: 1, clipId: "spread-test" });
    expect(front.joints!.rightElbow.x - front.joints!.chest.x).toBeGreaterThan(30);
    expect(front.joints!.chest.x - front.joints!.leftElbow.x).toBeGreaterThan(30);
    expect(Math.abs(side.joints!.rightElbow.x - side.joints!.chest.x)).toBeLessThan(1);
    expect(Math.abs(side.joints!.leftElbow.x - side.joints!.chest.x)).toBeLessThan(1);
  });

  it("keeps authored headShift zero identical to the default pose", () => {
    const base = MOTION_CLIP_LIBRARY.clips.idle;
    const makeClip = (headShift?: number): MotionClip => ({
      ...base,
      name: "head-shift-test",
      loop: false,
      frames: base.frames.slice(0, 2),
      poseKeys: [{
        frame: 0,
        pose: {
          anchor: "both",
          lean: 0,
          neck: 0,
          bob: 0,
          facing: 0,
          ...(headShift !== undefined ? { headShift } : {}),
          rLeg: { hip: 5, knee: 13 },
          lLeg: { hip: -8, knee: 14 },
          rArm: { shoulder: -8, elbow: 45 },
          lArm: { shoulder: 8, elbow: 45 }
        }
      }]
    });
    const sample = (clip: MotionClip) => sampleClipMotion({ ...MOTION_CLIP_LIBRARY, clips: { ...MOTION_CLIP_LIBRARY.clips, "head-shift-test": clip } }, {
      action: "head-shift-test", progress: 0, startX: 100, endX: 100, groundY: 290, facing: 1, scale: 1.25, clipId: "head-shift-test"
    });
    expect(sample(makeClip(0))).toStrictEqual(sample(makeClip()));
  });

  it("moves authored headShift laterally in front view", () => {
    const base = MOTION_CLIP_LIBRARY.clips.idle;
    const makeClip = (headShift: number): MotionClip => ({
      ...base,
      name: "head-shift-test",
      loop: false,
      frames: base.frames.slice(0, 2),
      poseKeys: [{
        frame: 0,
        pose: {
          anchor: "both",
          lean: 0,
          neck: 0,
          bob: 0,
          facing: 0,
          headShift,
          rLeg: { hip: 5, knee: 13 },
          lLeg: { hip: -8, knee: 14 },
          rArm: { shoulder: -8, elbow: 45 },
          lArm: { shoulder: 8, elbow: 45 }
        }
      }]
    });
    const sample = (clip: MotionClip) => sampleClipMotion({ ...MOTION_CLIP_LIBRARY, clips: { ...MOTION_CLIP_LIBRARY.clips, "head-shift-test": clip } }, {
      action: "head-shift-test", progress: 0, startX: 100, endX: 100, groundY: 290, facing: 1, scale: 1.25, clipId: "head-shift-test"
    });
    const neutral = sample(makeClip(0));
    const shifted = sample(makeClip(8));
    expect(shifted.headPoint!.x - neutral.headPoint!.x).toBeCloseTo(8 * 1.25, 5);
  });

  it("places pointing about one body height before the target when requested", () => {
    const pose = sampleClipMotion(MOTION_CLIP_LIBRARY, {
      action: "point", progress: 0.5, startX: 120, endX: 120, groundY: 290, facing: 1, scale: 1,
      pointTarget: { x: 330, y: 140 }, placePointBeforeTarget: true
    });
    expect(pose.rootX).toBeGreaterThan(210);
    expect(pose.rootX).toBeLessThan(250);
  });

  it("uses amplified jump lift and tuck from the corrected prototype", () => {
    const crouch = sampleClipMotion(MOTION_CLIP_LIBRARY, {
      action: "jump", progress: 0.1, startX: 120, endX: 200, groundY: 290, facing: 1, scale: 1
    });
    const apex = sampleClipMotion(MOTION_CLIP_LIBRARY, {
      action: "jump", progress: 0.54, startX: 120, endX: 200, groundY: 290, facing: 1, scale: 1
    });
    expect(apex.hipHeight - crouch.hipHeight).toBeGreaterThan(35);
    expect(Math.min(apex.leftFoot.y, apex.rightFoot.y)).toBeLessThan(260);
  });
});
