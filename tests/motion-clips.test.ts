import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import { CONTRACT_VERSION, type AnimationSpec, type SampledFrame } from "../src/contract.js";
import { MOTION_CLIP_LIBRARY, hermiteDecayWeight, sampleClipMotion, sampleMotionClip, type MotionClip } from "../src/motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "../src/motion-library.js";
import { renderHtml } from "../src/render.js";

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

function framePoints(frame: SampledFrame): { x: number; y: number }[] {
  return [frame.head, ...frame.segments.flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }])];
}

function maxFrameStep(a: SampledFrame, b: SampledFrame): number {
  const pa = framePoints(a), pb = framePoints(b);
  return Math.max(...pa.map((pt, i) => Math.hypot(pt.x - pb[i]!.x, pt.y - pb[i]!.y)));
}

function expectClipFrameAnatomy(frame: SampledFrame): void {
  const torso = frame.segments.find((s) => s.id === "torso")!;
  const scale = Math.hypot(torso.x2 - torso.x1, torso.y2 - torso.y1) / 45;
  expect(scale).toBeGreaterThan(0.2);
  for (const seg of frame.segments) {
    expect(Math.max(seg.y1, seg.y2)).toBeLessThanOrEqual(frame.groundY + 1e-6);
    if (Math.abs(frame.facing ?? 1) > 0.97) {
      const expected = (seg.id === "torso" ? 45 : seg.id.includes("arm") ? 28 : 36) * scale;
      const actual = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.04);
    }
  }
}

describe("canvas-independent clip routing and C1 inertialization seam blending", () => {
  it("routes unlocked catalog travel and gesture clips cleanly across 640x360, 800x450, and 1280x720 canvases", () => {
    for (const [width, height, groundY] of [[640, 360, 290], [800, 450, 360], [1280, 720, 580]] as const) {
      for (const action of ["walk-on", "walk-off", "jog", "walk-backwards", "sidestep", "stairs-up", "stairs-down"] as const) {
        const startX = Math.round(width * 0.22);
        const endX = Math.round(width * 0.62);
        const compiled = compileAnimation({
          version: CONTRACT_VERSION,
          canvas: { width, height, fps: 30 },
          durationMs: 2800,
          actor: { x: startX, groundY },
          targets: { dest: { x: endX, y: groundY } },
          actions: [{ action, startMs: 0, durationMs: 2600, target: "dest" }]
        });
        expect(compiled.diagnostics, `${action} on ${width}x${height}`).toEqual([]);
        const program = compiled.program!;
        expect(sampleAnimation(program, 0).x).toBeCloseTo(startX, 0);
        expect(sampleAnimation(program, 2600).x).toBeCloseTo(endX, 0);
        expectClipFrameAnatomy(sampleAnimation(program, 1300));
      }
    }
  });

  it("blends walk-on -> point -> think -> idea -> swipe-next -> cheer -> walk-off seamlessly on 800x450", () => {
    expect(hermiteDecayWeight(0)).toBe(1);
    expect(hermiteDecayWeight(0.5)).toBe(0.5);
    expect(hermiteDecayWeight(1)).toBe(0);

    const spec: AnimationSpec = {
      version: CONTRACT_VERSION,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 11200,
      actor: { x: 110, groundY: 360 },
      targets: { stage: { x: 310, y: 360 }, board: { x: 520, y: 180 }, exit: { x: 670, y: 360 } },
      actions: [
        { action: "walk-on", startMs: 0, durationMs: 2000, target: "stage" },
        { action: "point", startMs: 2000, durationMs: 1400, target: "board" },
        { action: "think", startMs: 3400, durationMs: 1500, target: "board" },
        { action: "idea", startMs: 4900, durationMs: 1500 },
        { action: "swipe-next", startMs: 6400, durationMs: 1400 },
        { action: "cheer", startMs: 7800, durationMs: 1600 },
        { action: "walk-off", startMs: 9400, durationMs: 1800, target: "exit" }
      ]
    };
    const compiled = compileAnimation(spec);
    expect(compiled.diagnostics).toEqual([]);
    const program = compiled.program!;

    for (const tb of [2000, 3400, 4900, 6400, 7800, 9400]) {
      expect(maxFrameStep(sampleAnimation(program, tb - 1e-4), sampleAnimation(program, tb + 1e-4))).toBeLessThan(0.01);
      expect(maxFrameStep(sampleAnimation(program, tb - 1), sampleAnimation(program, tb + 1))).toBeLessThanOrEqual(2.5);
      for (const offset of [0, 25, 70, 115, 140]) {
        expectClipFrameAnatomy(sampleAnimation(program, tb + offset));
      }
    }
    expect(sampleAnimation(program, 11200).x).toBeCloseTo(670, 0);
  });

  it("blends sit-down -> type-at-desk -> stand-up and walk -> posture -> walk-off chains without pops or floor penetration on 800x450", () => {
    const deskSpec: AnimationSpec = {
      version: CONTRACT_VERSION,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 6200,
      actor: { x: 360, groundY: 360 },
      actions: [
        { action: "sit-down", startMs: 200, durationMs: 1800 },
        { action: "type-at-desk", startMs: 2000, durationMs: 2000 },
        { action: "stand-up", startMs: 4000, durationMs: 1800 }
      ]
    };
    const deskCompiled = compileAnimation(deskSpec);
    expect(deskCompiled.diagnostics).toEqual([]);
    const deskProgram = deskCompiled.program!;

    for (const tb of [200, 2000, 4000]) {
      expect(maxFrameStep(sampleAnimation(deskProgram, tb - 1), sampleAnimation(deskProgram, tb + 1))).toBeLessThanOrEqual(2.5);
    }
    for (let t = 0; t <= 6200; t += 25) expectClipFrameAnatomy(sampleAnimation(deskProgram, t));
    const seatedHipY = sampleAnimation(deskProgram, 3000).segments[0]!.y1;
    const standingHipY = sampleAnimation(deskProgram, 5800).segments[0]!.y1;
    expect(seatedHipY - standingHipY).toBeGreaterThan(15);

    const unblended = compileAnimation({
      ...deskSpec,
      actions: [
        { action: "sit-down", startMs: 200, durationMs: 1800, blendMs: 0 },
        { action: "stand-up", startMs: 2000, durationMs: 1800, blendMs: 180 }
      ]
    });
    expect(unblended.diagnostics).toEqual([]);
    expect(maxFrameStep(sampleAnimation(unblended.program!, 199), sampleAnimation(unblended.program!, 200))).toBeGreaterThan(5);
    expect(maxFrameStep(sampleAnimation(unblended.program!, 1999), sampleAnimation(unblended.program!, 2001))).toBeLessThanOrEqual(2.5);
  });

  it("interpolates non-monotonic poseKeys travel smoothly without uClip division blowup and keeps import-clips.mjs safe", async () => {
    const baseIdle = MOTION_CLIP_LIBRARY.clips.idle!;
    const standPose = {
      anchor: "both" as const,
      lean: 2,
      neck: 0,
      bob: 0,
      rLeg: { hip: 5, knee: 12 },
      lLeg: { hip: -5, knee: 12 },
      rArm: { shoulder: -8, elbow: 40 },
      lArm: { shoulder: 8, elbow: 40 }
    };
    const outAndBackClip: MotionClip = {
      ...baseIdle,
      name: "out-and-back",
      loop: false,
      frames: baseIdle.frames.slice(0, 31),
      meta: {
        id: "out-and-back",
        label: "Out and Back",
        summary: "Walks forward to +80 then returns to +25.",
        kind: "oneshot",
        travel: "travel",
        facingChange: 0,
        contacts: ["lFoot", "rFoot"],
        markers: {},
        aim: null,
        prop: null,
        mirrorable: true,
        tags: [],
        durationS: 1,
        quality: { passed: true },
        source: "test",
        license: "MIT"
      },
      poseKeys: [
        { frame: 0, pose: { ...standPose, dx: 0, facing: 1 }, ease: "linear" },
        { frame: 15, pose: { ...standPose, dx: 80, facing: 1 }, ease: "linear" },
        { frame: 30, pose: { ...standPose, dx: 25, facing: 1 }, ease: "linear" }
      ]
    };
    const lib = { ...MOTION_CLIP_LIBRARY, clips: { ...MOTION_CLIP_LIBRARY.clips, "out-and-back": outAndBackClip } };
    const xs = [0, 0.25, 0.5, 0.75, 1].map((progress) =>
      sampleClipMotion(lib, {
        action: "out-and-back",
        clipId: "out-and-back",
        progress,
        startX: 200,
        endX: 180,
        groundY: 300,
        facing: 1,
        scale: 1
      }).rootX
    );
    expect(xs[0]).toBeCloseTo(200, 3);
    expect(xs[4]).toBeCloseTo(180, 3);
    expect(xs[2]).toBeGreaterThan(240);
    expect(xs[2]).toBeLessThan(285);

    const motionClipsSource = await readFile(resolve(process.cwd(), "src", "motion-clips.ts"), "utf8");
    const templateSource = await readFile(resolve(process.cwd(), "scripts", "motion-clips-template.ts"), "utf8");
    expect(
      motionClipsSource.replace(
        /^export const MOTION_CLIP_LIBRARY = \{.*\}(?: as MotionClipLibrary)?;$/m,
        "export const MOTION_CLIP_LIBRARY = __CLIP_DATA__;"
      )
    ).toBe(templateSource);

    const scratchDir = resolve(process.cwd(), `.import-clips-test-${randomUUID()}`);
    await mkdir(scratchDir, { recursive: true });
    try {
      const outPath = resolve(scratchDir, "motion-library.ts");
      const run = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts", "import-clips.mjs"), "--out", outPath],
        { encoding: "utf8", windowsHide: true, timeout: 15_000 }
      );
      expect(run.status).toBe(0);
      const generated = await readFile(outPath, "utf8");
      expect(generated).toContain("export const GENERATED_MOTION_LIBRARY");
      expect(await readFile(resolve(process.cwd(), "src", "motion-clips.ts"), "utf8")).toBe(motionClipsSource);
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});

describe("M1 monotone cubic spline, soft-knee two-bone IK, and grounded stance contacts", () => {
  it("maintains nonzero pass-through midpoint velocity with zero overshoot on a 3-key monotonic pose sequence", () => {
    const baseIdle = MOTION_CLIP_LIBRARY.clips.idle!;
    const pose0 = {
      anchor: "both" as const,
      lean: 0,
      neck: 0,
      bob: 0,
      dx: 0,
      facing: 1,
      rLeg: { hip: 5, knee: 13 },
      lLeg: { hip: -8, knee: 14 },
      rArm: { shoulder: 0, elbow: 40 },
      lArm: { shoulder: 0, elbow: 40 },
      rFoot: { x: 5, y: 0 },
      lFoot: { x: -7, y: 0 }
    };
    const clip: MotionClip = {
      ...baseIdle,
      name: "monotone-pass-through",
      loop: false,
      frames: baseIdle.frames.slice(0, 21),
      poseKeys: [
        { frame: 0, pose: pose0, ease: "inOut" },
        { frame: 10, pose: { ...pose0, lean: 10, dx: 24, rArm: { shoulder: 45, elbow: 40 }, rFoot: { x: 29, y: 0 }, lFoot: { x: 17, y: 0 } }, ease: "inOut" },
        { frame: 20, pose: { ...pose0, lean: 20, dx: 60, rArm: { shoulder: 90, elbow: 40 }, rFoot: { x: 65, y: 0 }, lFoot: { x: 53, y: 0 } }, ease: "inOut" }
      ]
    };
    const lib = { clips: { [clip.name]: clip } };
    const sampleAt = (p: number) => sampleClipMotion(lib, {
      action: clip.name, clipId: clip.name, progress: p, startX: 100, endX: 100, groundY: 300, facing: 1, scale: 1
    });
    const dt = 0.005;
    const midBefore = sampleAt(0.5 - dt);
    const midAfter = sampleAt(0.5 + dt);
    const durationS = (clip.frames.length - 1) / clip.fps;
    const midPelvisVel = (midAfter.joints!.pelvis.x - midBefore.joints!.pelvis.x) / (2 * dt * durationS);
    const midLeanVelDeg = ((midAfter.lean - midBefore.lean) * 180 / Math.PI) / (2 * dt * durationS);
    // Average velocity is 60 / (20/30) = 90 px/s and 30 deg/s; midpoint pass-through must flow briskly instead of stalling near 0.
    expect(midPelvisVel).toBeGreaterThan(60);
    expect(midLeanVelDeg).toBeGreaterThan(20);

    let prevX = -Infinity;
    let prevLean = -Infinity;
    for (let i = 0; i <= 80; i++) {
      const s = sampleAt(i / 80);
      const x = s.joints!.pelvis.x - 100;
      const leanDeg = s.lean * 180 / Math.PI;
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(60 + 1e-9);
      expect(x).toBeGreaterThanOrEqual(prevX - 1e-9);
      expect(leanDeg).toBeGreaterThanOrEqual(-1e-9);
      expect(leanDeg).toBeLessThanOrEqual(20 + 1e-9);
      expect(leanDeg).toBeGreaterThanOrEqual(prevLean - 1e-9);
      expect(s.joints!.leftAnkle.y).toBeCloseTo(300, 5);
      expect(s.joints!.rightAnkle.y).toBeCloseTo(300, 5);
      prevX = x;
      prevLean = leanDeg;
    }
  });

  it("samples look-around, put-down, phone-call, wave, sidestep, and vault smoothly with bounded angular velocity, exact bone lengths, and grounded stance feet", () => {
    const groundY = 150;
    const scale = 0.75;
    const segAngle = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.atan2(s.x2 - s.x1, s.y2 - s.y1) * 180 / Math.PI;
    for (const id of ["look-around", "put-down", "phone-call", "wave", "sidestep", "vault"] as const) {
      const clip = RUNTIME_MOTION_LIBRARY.clips[id]!;
      expect(clip, id).toBeDefined();
      const n = clip.frames.length;
      let maxBendVel = 0;
      let floatBothFrames = 0;
      let prevById: Record<string, { id: string; x1: number; y1: number; x2: number; y2: number }> | undefined;
      for (let f = 0; f < n; f++) {
        const pose = sampleClipMotion(RUNTIME_MOTION_LIBRARY, {
          action: id, clipId: id, progress: clip.loop ? f / n : f / Math.max(1, n - 1),
          startX: 160, endX: 160, groundY, facing: 1, scale
        });
        const byId = Object.fromEntries(pose.segments!.map((seg) => [seg.id, seg]));
        for (const seg of pose.segments!) {
          const expected = (seg.id === "torso" ? 45 : seg.id.includes("arm") ? 28 : 36) * scale;
          const actual = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
          expect(Math.max(seg.y1, seg.y2), `${id} f${f} ${seg.id} floor`).toBeLessThanOrEqual(groundY + 1e-6);
          const absFacing = Math.abs(pose.facing ?? 1);
          if (absFacing > 0.999) {
            expect(actual, `${id} f${f} ${seg.id} exact side bone`).toBeCloseTo(expected, 3);
          } else if (absFacing > 0.95) {
            expect(Math.abs(actual - expected) / expected, `${id} f${f} ${seg.id} near-side bone`).toBeLessThanOrEqual(1 - absFacing + 0.015);
          } else {
            expect(actual, `${id} f${f} ${seg.id} projected cap`).toBeLessThanOrEqual(expected * 1.05);
          }
        }
        const lClear = groundY - pose.joints!.leftAnkle.y;
        const rClear = groundY - pose.joints!.rightAnkle.y;
        if (lClear > 2.5 && rClear > 2.5) floatBothFrames++;
        if (prevById) {
          for (const [, u, l] of [
            ["lKnee", "left-thigh", "left-shin"],
            ["rKnee", "right-thigh", "right-shin"],
            ["lElbow", "left-upper-arm", "left-forearm"],
            ["rElbow", "right-upper-arm", "right-forearm"]
          ] as const) {
            const currBend = wrap(segAngle(byId[l]!) - segAngle(byId[u]!));
            const prevBend = wrap(segAngle(prevById[l]!) - segAngle(prevById[u]!));
            maxBendVel = Math.max(maxBendVel, Math.abs(wrap(currBend - prevBend)) * clip.fps);
          }
        }
        prevById = byId;
      }
      expect(maxBendVel, `${id} angular velocity`).toBeLessThan(4000);
      if (id === "put-down" || id === "phone-call" || id === "wave" || id === "sidestep") {
        expect(floatBothFrames, `${id} grounded stance`).toBe(0);
      }
    }
  });

  it("serializes sampleClipMotion cleanly inside standalone renderHtml scripts without external ReferenceErrors", () => {
    const compiled = compileAnimation({
      version: CONTRACT_VERSION,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 2000,
      actor: { x: 400, groundY: 360 },
      targets: { mark: { x: 620, y: 220 } },
      actions: [{ action: "look-around", startMs: 0, durationMs: 1800, target: "mark" }]
    });
    expect(compiled.diagnostics).toEqual([]);
    const html = renderHtml(compiled.program!);
    const script = /<script id="stickman-player">([\s\S]+?)<\/script>/.exec(html)![1]!;
    const nodes = new Map<string, {
      value: string; textContent: string; attributes: Map<string, string | number>;
      parentNode: { appendChild(): void };
      setAttribute(key: string, value: string | number): void;
      addEventListener(): void;
    }>();
    for (const id of ["mode", "seek", "toggle", "head", "stage-svg", "ground", "torso", "left-arm", "right-arm", "left-leg", "right-leg", "left-foot", "right-foot", "point-finger"]) {
      const attributes = new Map<string, string | number>();
      nodes.set(id, {
        value: "normal", textContent: "Pause", attributes, parentNode: { appendChild() {} },
        setAttribute: (k, v) => { attributes.set(k, v); },
        addEventListener: () => {}
      });
    }
    let tickFn: ((now: number) => void) | undefined;
    expect(() => runInNewContext(script, {
      document: {
        querySelector: (sel: string) => nodes.get(sel === "#stage svg" ? "stage-svg" : sel.slice(1)) ?? null,
        getElementById: (id: string) => nodes.get(id) ?? null,
        dispatchEvent: () => true
      },
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (cb: (now: number) => void) => { tickFn = cb; return 1; },
      cancelAnimationFrame: () => {},
      CustomEvent: class { detail: unknown; constructor(_t: string, init?: { detail?: unknown }) { this.detail = init?.detail; } }
    })).not.toThrow();
    expect(tickFn).toBeDefined();
    expect(() => tickFn!(600)).not.toThrow();
    expect(() => tickFn!(1200)).not.toThrow();
  });
});
