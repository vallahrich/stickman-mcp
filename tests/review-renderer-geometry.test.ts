import { describe, expect, it } from "vitest";
import { sampleClipMotion, type MotionClip, type PoseKey } from "../dist/motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "../dist/motion-library.js";
import { addonLifecycleState, clipFrameToSampledFrame, computeAddonFlightPoint, doorGeometry, renderStaticSvg, REVIEW_STAGE } from "../scripts/motions/review-renderer.mjs";
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

  it("computes add-on lifecycle visibility and pop scale", () => {
    const addOn = { enter: { frame: 10, style: "pop", dur: 8 }, exit: { frame: 30, style: "fade", dur: 6 } };
    expect(addonLifecycleState(addOn, 9).visible).toBe(false);
    expect(addonLifecycleState(addOn, 10).scale).toBeCloseTo(0, 5);
    expect(addonLifecycleState(addOn, 14).scale).toBeCloseTo(1.1, 5);
    expect(addonLifecycleState(addOn, 18).scale).toBeCloseTo(1, 5);
    expect(addonLifecycleState(addOn, 36).visible).toBe(false);
  });

  it("renders long-jump add-on types with lifecycle visibility", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const spec = {
      id: "long-jump-addons-test",
      review: {
        addons: [
          { id: "pit", type: "sand-pit", x: 30, y: 0, w: 80, h: 14, enter: { frame: 5, style: "fade", dur: 4 } },
          { id: "board", type: "board", x: 8, y: 0, w: 20, h: 5, enter: { frame: 5, style: "fade", dur: 4 } },
          { id: "impact", type: "sand-puff", x: 72, y: 6, w: 22, h: 16, enter: { frame: 8, style: "pop", dur: 6 }, exit: { frame: 16, style: "fade", dur: 4 } }
        ]
      }
    };
    const before = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 4 });
    expect(before).not.toContain('data-addon="sand-pit"');
    const during = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 10 });
    expect(during).toContain('data-addon="sand-pit"');
    expect(during).toContain('data-addon="board"');
    expect(during).toContain('data-addon="sand-puff"');
    expect(during).toContain("#e8c872");
  });

  it("renders attachable phone add-on with custom color", async () => {
    const clip = keyed([{ frame: 0, pose: { ...stand, rHand: { x: 24, y: 96 } } }, { frame: 20, pose: { ...stand, rHand: { x: 24, y: 96 } } }]);
    const spec = {
      id: "phone-addon-test",
      review: {
        addons: [
          { id: "phone", type: "phone", color: "#123456", attach: [{ to: "right-hand", from: 0, until: 20 }] }
        ]
      }
    };
    const svg = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 10 });
    expect(svg).toContain('data-addon="phone"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill="#dfe5ee"');
  });

  it("computes add-on flight parabola endpoints and apex", () => {
    const start = { x: 10, y: 100 };
    const end = { x: 70, y: 100 };
    const flight = { from: 20, to: 40, apex: 40, spin: 720 };
    expect(computeAddonFlightPoint(start, end, flight, 20, REVIEW_STAGE)).toMatchObject({ x: 10, y: 100, rot: 0 });
    expect(computeAddonFlightPoint(start, end, flight, 40, REVIEW_STAGE)).toMatchObject({ x: 70, y: 100, rot: 720 });
    const mid = computeAddonFlightPoint(start, end, flight, 30, REVIEW_STAGE);
    expect(mid.x).toBeCloseTo(40, 5);
    expect(mid.y).toBeLessThan(100);
  });

  it("keeps hinged door free edge inside frame when fully open", () => {
    const right = doorGeometry({ x: 42, y: 0, w: 67, h: 185, hinge: "right", open: 1 }, 4);
    expect(right.freeX).toBeGreaterThanOrEqual(right.x);
    expect(right.freeX).toBeLessThanOrEqual(right.x + right.w);
    expect(Math.abs(right.freeX - right.hingeX)).toBeLessThanOrEqual(right.w * 0.1);
    const left = doorGeometry({ x: 42, y: 0, w: 67, h: 185, hinge: "left", open: 1 }, 4);
    expect(left.freeX).toBeGreaterThanOrEqual(left.x);
    expect(left.freeX).toBeLessThanOrEqual(left.x + left.w);
    expect(Math.abs(left.freeX - left.hingeX)).toBeLessThanOrEqual(left.w * 0.1);
  });

  it("clips the figure to the doorway after clipFigureFrom without fading it", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: { ...stand, dx: 70 } }]);
    const spec = {
      id: "door-clip-test",
      prop: "door",
      review: { prop: { x: 42, y: 0, w: 67, h: 185, hinge: "right", clipFigureFrom: 5 } }
    };
    const before = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 4 });
    expect(before).not.toContain("<clipPath");
    const after = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 6 });
    expect(after).toContain("<clipPath");
    expect(after).toContain('clip-path="url(#door-figure-clip-6)"');
    expect(after).toContain('data-stickman="exact-pivot"');
    expect(after).toContain('opacity="1"');
  });
});
