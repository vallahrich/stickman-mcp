import { describe, expect, it } from "vitest";
import { compileAnimation, getFinalFrame, sampleAnimation, validateAnimation } from "../src/compiler.js";
import type { AnimationSpec, CompiledAnimation, SampledFrame, Segment } from "../src/contract.js";

const base: AnimationSpec = { version: "stickman.animation/v1", canvas: { width: 640, height: 360, fps: 30 }, durationMs: 3600, actor: { x: 140, groundY: 290, color: "#202124" }, actions: [] };
function compile(spec: AnimationSpec): CompiledAnimation { const r = compileAnimation(spec); expect(r.diagnostics).toEqual([]); return r.program!; }
const seg = (f: SampledFrame, id: string): Segment => f.segments.find(s => s.id === id)!;
const len = (s: Segment): number => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
function expectRig(frame: SampledFrame): void {
  const scale = len(seg(frame, "torso")) / 45;
  for (const id of ["left-upper-arm", "left-forearm", "right-upper-arm", "right-forearm"]) expect(len(seg(frame, id))).toBeCloseTo(28 * scale, 2);
  for (const id of ["left-thigh", "left-shin", "right-thigh", "right-shin"]) expect(len(seg(frame, id))).toBeCloseTo(36 * scale, 2);
  for (const line of frame.segments) expect(Math.max(line.y1, line.y2)).toBeLessThanOrEqual(frame.groundY + 1e-6);
}
const pushed: AnimationSpec = { ...base, actor: { x: 105, groundY: 210, color: "#202124" }, durationMs: 3000, prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } }, actions: [{ action: "push", startMs: 100, durationMs: 2600, target: "crate" }] };

describe("supported prop contact", () => {
  it("keeps prop still before grip, monotonic during drive, and still after release", () => {
    const p = compile(pushed); let prev = sampleAnimation(p, 0).prop!.x;
    expect(sampleAnimation(p, 350).prop!.x).toBeCloseTo(150, 4);
    for (let t = 650; t <= 2250; t += 50) { const x = sampleAnimation(p, t).prop!.x; expect(x).toBeGreaterThanOrEqual(prev - 1e-6); prev = x; }
    expect(sampleAnimation(p, 2600).prop!.x).toBeCloseTo(250, 3);
  });
  it.each(Array.from({ length: 8 }, (_, i) => 100 + i * 325))("preserves fixed rig and floor at %ims", (time) => expectRig(sampleAnimation(compile(pushed), time)));
  it.each([700, 1100, 1500, 1900, 2200])("keeps both hands near the crate handle during drive at %ims", (time) => {
    const f = sampleAnimation(compile(pushed), time); const sc = len(seg(f, "torso")) / 45;
    expect(Math.hypot(seg(f, "right-forearm").x2 - f.prop!.handleX, seg(f, "right-forearm").y2 - (f.prop!.handleY - 4 * sc))).toBeLessThan(2.5);
    expect(Math.hypot(seg(f, "left-forearm").x2 - f.prop!.handleX, seg(f, "left-forearm").y2 - (f.prop!.handleY + 4 * sc))).toBeLessThan(2.5);
  });
  it.each([0, 250, 500, 1000, 1750, 2600, 3000])( "is deterministic at %ims", (time) => expect(sampleAnimation(compile(pushed), time)).toEqual(sampleAnimation(compile(pushed), time)));
  it("validates unreachable push geometry", () => expect(compileAnimation({ ...pushed, actor: { x: 50, groundY: 210 } }).valid).toBe(false));
});

const pushedLeft: AnimationSpec = {
  ...base,
  actor: { x: 535, groundY: 210, color: "#202124" },
  durationMs: 3000,
  prop: { id: "crate", x: 440, y: 160, width: 50, height: 50, toX: 340, handle: { x: 45, y: 8 } },
  actions: [{ action: "push", startMs: 100, durationMs: 2600, target: "crate" }]
};

function maxBoundaryStep(a: SampledFrame, b: SampledFrame): number {
  const pts = (f: SampledFrame) => [f.head, ...f.segments.flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }])];
  const pa = pts(a), pb = pts(b);
  return Math.max(...pa.map((pt, i) => Math.hypot(pt.x - pb[i]!.x, pt.y - pb[i]!.y)));
}

describe("bilateral (leftward and rightward) prop push", () => {
  it("supports standalone leftward push with monotonic prop translation, leftward lean, and locked grips", () => {
    const p = compile(pushedLeft);
    let prev = sampleAnimation(p, 0).prop!.x;
    expect(sampleAnimation(p, 350).prop!.x).toBeCloseTo(440, 4);
    for (let t = 950; t <= 2200; t += 50) {
      const f = sampleAnimation(p, t);
      expectRig(f);
      expect(f.prop!.x).toBeLessThanOrEqual(prev + 1e-6);
      prev = f.prop!.x;
      const sc = len(seg(f, "torso")) / 45;
      expect(seg(f, "torso").x2).toBeLessThan(seg(f, "torso").x1);
      expect(Math.hypot(seg(f, "right-forearm").x2 - f.prop!.handleX, seg(f, "right-forearm").y2 - (f.prop!.handleY - 4 * sc))).toBeLessThan(0.5);
      expect(Math.hypot(seg(f, "left-forearm").x2 - f.prop!.handleX, seg(f, "left-forearm").y2 - (f.prop!.handleY + 4 * sc))).toBeLessThan(0.5);
    }
    expect(sampleAnimation(p, 2600).prop!.x).toBeCloseTo(340, 3);
    expect(getFinalFrame(p).prop!.x).toBeCloseTo(340, 4);
  });

  it("supports walk -> leftward push and run -> leftward push with continuous boundaries", () => {
    for (const locomotion of ["walk", "run"] as const) {
      const dur = locomotion === "walk" ? 1000 : 900;
      const program = compile({
        ...base,
        actor: { x: 600, groundY: 210, color: "#202124" },
        durationMs: 4000,
        targets: { approach: { x: 535, y: 210 } },
        prop: { id: "crate", x: 440, y: 160, width: 50, height: 50, toX: 340, handle: { x: 45, y: 8 } },
        actions: [
          { action: locomotion, startMs: 0, durationMs: dur, target: "approach" },
          { action: "push", startMs: dur, durationMs: 2600, target: "crate" }
        ]
      });
      expect(maxBoundaryStep(sampleAnimation(program, dur - 1), sampleAnimation(program, dur + 1))).toBeLessThanOrEqual(2.5);
      expectRig(sampleAnimation(program, dur + 1200));
      expect(getFinalFrame(program).prop!.x).toBeCloseTo(340, 4);
    }
  });

  it("supports walk left -> rightward push with smooth turn and continuous boundary", () => {
    const program = compile({
      ...base,
      actor: { x: 295, groundY: 210, color: "#202124" },
      durationMs: 4200,
      targets: { approach: { x: 275, y: 210 } },
      prop: { id: "crate", x: 320, y: 160, width: 50, height: 50, toX: 420, handle: { x: 5, y: 8 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 1000, target: "approach" },
        { action: "push", startMs: 1000, durationMs: 2800, target: "crate" }
      ]
    });
    expect(maxBoundaryStep(sampleAnimation(program, 999), sampleAnimation(program, 1001))).toBeLessThanOrEqual(2.5);
    const driving = sampleAnimation(program, 2400);
    expectRig(driving);
    expect(seg(driving, "torso").x2).toBeGreaterThan(seg(driving, "torso").x1);
    expect(getFinalFrame(program).prop!.x).toBeCloseTo(420, 4);
  });

  it("rejects zero-distance, out-of-canvas, wrong-side handle/facing, overlap, and impossible cadence pushes", () => {
    const codes = (spec: AnimationSpec) => validateAnimation(spec).diagnostics.map((d) => d.code);
    expect(codes({ ...pushedLeft, prop: { ...pushedLeft.prop!, toX: 440 } })).toContain("zero_push_distance");
    expect(codes({ ...pushedLeft, prop: { ...pushedLeft.prop!, toX: -10 } })).toContain("prop_path_outside_canvas");
    expect(codes({ ...pushedLeft, prop: { ...pushedLeft.prop!, x: 610, toX: 500 } })).toContain("prop_path_outside_canvas");
    expect(codes({ ...pushedLeft, actor: { x: 380, groundY: 210 } })).toContain("unsupported_push_facing");
    expect(codes({ ...pushedLeft, prop: { ...pushedLeft.prop!, handle: { x: 5, y: 8 } } })).toContain("unreachable_contact");
    expect(codes({ ...pushed, prop: { ...pushed.prop!, handle: { x: 45, y: 8 } } })).toContain("unreachable_contact");
    expect(codes({ ...pushedLeft, actor: { x: 495, groundY: 210 } })).toContain("actor_prop_overlap");
    expect(codes({
      ...pushedLeft,
      prop: { ...pushedLeft.prop!, toX: 120 },
      actions: [{ action: "push", startMs: 100, durationMs: 500, target: "crate" }]
    })).toContain("infeasible_cadence");
  });
});
