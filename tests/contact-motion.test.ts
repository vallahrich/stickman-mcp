import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
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
