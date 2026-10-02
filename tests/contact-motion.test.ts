import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation, validateAnimation } from "../src/compiler.js";
import type { AnimationSpec, CompiledAnimation, SampledFrame, Segment } from "../src/contract.js";

const scene: AnimationSpec = {
  version: "stickman.animation/v1",
  canvas: { width: 640, height: 360, fps: 30 },
  durationMs: 3400,
  actor: { x: 105, groundY: 290 },
  prop: { id: "crate", x: 150, y: 240, width: 50, height: 50, toX: 240, handle: { x: 0, y: 18 } },
  actions: [{ action: "push", startMs: 100, durationMs: 3000, target: "crate" }]
};

function compile(spec: AnimationSpec): CompiledAnimation {
  const result = compileAnimation(spec);
  expect(result.diagnostics).toEqual([]);
  return result.program!;
}

const hand = (frame: SampledFrame, side: string) => frame.segments.find((line) => line.id === `${side}-forearm`)!;
const foot = (frame: SampledFrame, side: string) => frame.segments.find((line) => line.id === `${side}-shin`)!;
const grip = (frame: SampledFrame, side: string) => {
  const torso = frame.segments[0]!;
  const scale = Math.hypot(torso.x2 - torso.x1, torso.y2 - torso.y1) / 45;
  return { x: frame.prop!.handleX, y: frame.prop!.handleY + (side === "left" ? 4 : -4) * scale };
};
function intersectsCrateStroke(line: Segment, frame: SampledFrame): boolean {
  const prop = frame.prop!;
  const margin = 2.5;
  let lo = 0, hi = 1;
  for (const [a, b, min, max] of [
    [line.x1, line.x2, prop.x - margin, prop.x + prop.width + margin],
    [line.y1, line.y2, prop.y - margin, prop.y + prop.height + margin]
  ] as const) {
    const delta = b - a;
    if (Math.abs(delta) < 1e-9) { if (a < min || a > max) return false; }
    else {
      const t0 = (min - a) / delta, t1 = (max - a) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      if (lo > hi) return false;
    }
  }
  return true;
}

describe("supported prop contact", () => {
  it("supports the clean 55px stand-off demo with a real crouch/hinge and no grip stretching", () => {
    const program = compile({
      ...scene, canvas: { width: 640, height: 400, fps: 30 }, durationMs: 3800,
      actor: { x: 195, groundY: 310 },
      prop: { id: "crate", x: 250, y: 234, width: 64, height: 76, toX: 400, handle: { x: 0, y: 22 } },
      actions: [{ action: "push", startMs: 0, durationMs: 3600, target: "crate" }]
    });
    const rest = sampleAnimation(program, 0);
    const contact = sampleAnimation(program, 720);
    expect(contact.x).toBe(195);
    expect(contact.prop!.x).toBe(250);
    const torso = contact.segments[0]!;
    expect(310 - torso.y1).toBeGreaterThanOrEqual(60);
    expect(310 - torso.y1).toBeLessThanOrEqual(64);
    expect(torso.y1 - rest.segments[0]!.y1).toBeGreaterThanOrEqual(6);
    expect(Math.atan2(torso.x2 - torso.x1, torso.y1 - torso.y2)).toBeGreaterThanOrEqual(0.58);
    expect(torso.x2 - torso.x1).toBeGreaterThan(24);
    let previous = contact;
    let drift = 0;
    let steps = 0;
    let minimumHipHeight = Infinity;
    let largestTrailingReach = 0;
    for (let time = 720; time <= 2952; time += 2) {
      const frame = sampleAnimation(program, time);
      minimumHipHeight = Math.min(minimumHipHeight, 310 - frame.segments[0]!.y1);
      for (const side of ["left", "right"]) {
        const arm = hand(frame, side);
        const assigned = grip(frame, side);
        expect(Math.hypot(arm.x2 - assigned.x, arm.y2 - assigned.y)).toBeLessThanOrEqual(0.25);
        const a = foot(previous, side);
        const b = foot(frame, side);
        if (Math.abs(a.y2 - 310) < 1e-7 && Math.abs(b.y2 - 310) < 1e-7) drift += Math.abs(a.x2 - b.x2);
        if (Math.abs(a.y2 - 310) < 1e-7 && b.y2 < 310 - 1e-7) steps++;
        if (Math.abs(b.y2 - 310) < 1e-7) largestTrailingReach = Math.max(largestTrailingReach, frame.segments[0]!.x1 - b.x2);
      }
      for (const line of frame.segments) {
        const expected = line.id === "torso" ? 45 : line.id.includes("arm") ? 28 : 36;
        expect(Math.abs(Math.hypot(line.x2 - line.x1, line.y2 - line.y1) / expected - 1)).toBeLessThanOrEqual(0.001);
        expect(Math.max(line.y1, line.y2)).toBeLessThanOrEqual(310 + 1e-7);
        if (line.id === "torso" || line.id.includes("thigh") || line.id.includes("shin")) expect(Math.max(line.x1, line.x2)).toBeLessThan(frame.prop!.x - 3);
      }
      previous = frame;
    }
    expect(drift).toBeLessThanOrEqual(0.25);
    expect(steps).toBe(6);
    // The current supported load stroke reserves seven units of compression.
    expect(minimumHipHeight).toBeGreaterThanOrEqual(57);
    expect(largestTrailingReach).toBeGreaterThan(25);
    expect(sampleAnimation(program, 3600).x).toBe(345);
    expect(sampleAnimation(program, 3600).prop!.x).toBe(400);
  });

  it("establishes a real crouch/hinge before translation, anchors both fixed arms during drive, then releases after braking", () => {
    const program = compile(scene);
    const rest = sampleAnimation(program, 100);
    const contact = sampleAnimation(program, 700);
    expect(contact.prop!.x).toBe(150);
    expect(contact.x).toBe(105);
    expect(contact.segments[0]!.y1).toBeGreaterThan(rest.segments[0]!.y1 + 7);
    expect(contact.segments[0]!.x2 - contact.segments[0]!.x1).toBeGreaterThan(15);
    let last = contact;
    let stanceDrift = 0;
    let lifts = 0;
    for (let time = 700; time <= 2560; time += 2) {
      const frame = sampleAnimation(program, time);
      expect(frame.x).toBeCloseTo(105 + frame.prop!.x - 150, 8);
      for (const side of ["left", "right"]) {
        const arm = hand(frame, side);
        const assigned = grip(frame, side);
        expect(Math.hypot(arm.x2 - assigned.x, arm.y2 - assigned.y)).toBeLessThanOrEqual(0.25);
        const upper = frame.segments.find((line) => line.id === `${side}-upper-arm`)!;
        expect(Math.hypot(upper.x2 - upper.x1, upper.y2 - upper.y1)).toBeCloseTo(28, 8);
        expect(Math.hypot(arm.x2 - arm.x1, arm.y2 - arm.y1)).toBeCloseTo(28, 8);
        const a = foot(last, side);
        const b = foot(frame, side);
        expect(b.y2).toBeLessThanOrEqual(290 + 1e-8);
        if (Math.abs(a.y2 - 290) < 1e-7 && Math.abs(b.y2 - 290) < 1e-7) stanceDrift += Math.abs(a.x2 - b.x2);
        if (Math.abs(a.y2 - 290) < 1e-7 && b.y2 < 290 - 1e-7) lifts++;
      }
      last = frame;
    }
    expect(stanceDrift).toBeLessThanOrEqual(0.25);
    expect(lifts).toBeGreaterThanOrEqual(4);
    const release = sampleAnimation(program, 2900);
    expect(release.prop!.x).toBe(240);
    expect(Math.hypot(hand(release, "right").x2 - release.prop!.handleX, hand(release, "right").y2 - release.prop!.handleY)).toBeGreaterThan(10);
    expect(sampleAnimation(program, 3100).x).toBe(195);
    expect(sampleAnimation(program, 3100).prop!.x).toBe(240);
  });

  it("has no drive before grip or after release, no leg/body inside the crate and no instant joint pops", () => {
    const program = compile(scene);
    let last = sampleAnimation(program, 0);
    let movingSamples = 0;
    for (let time = 1; time <= 3400; time++) {
      const frame = sampleAnimation(program, time);
      if (frame.prop!.x !== last.prop!.x) {
        movingSamples++;
        for (const side of ["left", "right"]) {
          const assigned = grip(frame, side);
          expect(Math.hypot(hand(frame, side).x2 - assigned.x, hand(frame, side).y2 - assigned.y)).toBeLessThan(0.25);
        }
      }
      for (const line of frame.segments) {
        // A stronger hinge may pass OVER the crate, but never through its
        // stroke-expanded rectangle or hide penetration by drawing order.
        if (line.id === "torso" || line.id.includes("thigh") || line.id.includes("shin")) {
          expect(intersectsCrateStroke(line, frame), `${time} ${line.id}`).toBe(false);
        }
        const previous = last.segments.find((old) => old.id === line.id)!;
        expect(Math.hypot(line.x2 - previous.x2, line.y2 - previous.y2)).toBeLessThan(1.5);
      }
      last = frame;
    }
    expect(movingSamples).toBeGreaterThan(1000);
  });

  it("resolves reach from the preceding root endpoint and joins walk-to-contact without relocation", () => {
    const spec: AnimationSpec = {
      ...scene, durationMs: 4700, actor: { x: 65, groundY: 290 },
      targets: { approach: { x: 105, y: 290 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 1300, target: "approach" },
        { action: "push", startMs: 1300, durationMs: 3000, target: "crate" }
      ]
    };
    const program = compile(spec);
    const before = sampleAnimation(program, 1299.999);
    const at = sampleAnimation(program, 1300);
    expect(at.x).toBe(105);
    expect(at.prop!.x).toBe(150);
    expect(at.segments[0]!.x2 - at.segments[0]!.x1).toBeGreaterThan(12);
    expect(at.segments[0]!.y1).toBeGreaterThan(290 - 68);
    const idleAtArrival = sampleAnimation(compile({
      version: scene.version, canvas: scene.canvas, durationMs: scene.durationMs,
      ...(scene.actor ? { actor: scene.actor } : {}), actions: []
    }), 0);
    const target = grip(at, "right");
    const distance = (frame: SampledFrame) => Math.hypot(hand(frame, "right").x2 - target.x, hand(frame, "right").y2 - target.y);
    expect(distance(at)).toBeLessThan(distance(idleAtArrival) - 4);
    for (let i = 0; i < at.segments.length; i++) {
      expect(Math.hypot(before.segments[i]!.x2 - at.segments[i]!.x2, before.segments[i]!.y2 - at.segments[i]!.y2)).toBeLessThan(0.01);
    }
    expect(sampleAnimation(program, 4700).x).toBe(195);
    const extended = validateAnimation({ ...spec, targets: { approach: { x: 65, y: 290 } } });
    expect(extended.valid).toBe(true);
    const away = validateAnimation({ ...spec, targets: { approach: { x: 35, y: 290 } } });
    expect(away.diagnostics.map((item) => item.code)).toContain("unreachable_contact");
  });

  it.each([18, 32, 48, 64, 74])("finds feasible posture for a grip at crate-local y=%i with unchanged root/timing", (height) => {
    const program = compile({
      ...scene, prop: { ...scene.prop!, y: 180, height: 110, handle: { x: 0, y: height } }
    });

    for (const time of [1060, 1510, 2190]) {
      const frame = sampleAnimation(program, time);
      const shoulder = frame.segments[0]!;
      const near = grip(frame, "right");
      const far = grip(frame, "left");
      const nearReach = Math.hypot(near.x - shoulder.x2, near.y - shoulder.y2);
      const farReach = Math.hypot(far.x - shoulder.x2, far.y - shoulder.y2);
      expect(nearReach).toBeLessThanOrEqual(56);
      expect(farReach).toBeLessThanOrEqual(56);
      expect(Math.abs(nearReach - farReach)).toBeGreaterThan(0.1);
      for (const side of ["left", "right"]) {
        const assigned = grip(frame, side);
        expect(Math.hypot(hand(frame, side).x2 - assigned.x, hand(frame, side).y2 - assigned.y)).toBeLessThan(0.25);
        for (const suffix of ["upper-arm", "forearm"]) {
          const bone = frame.segments.find((line) => line.id === `${side}-${suffix}`)!;
          expect(Math.hypot(bone.x2 - bone.x1, bone.y2 - bone.y1)).toBeCloseTo(28, 8);
        }
      }
      expect(frame.x - frame.prop!.x).toBeCloseTo(-45, 8);
    }
    expect(program.spec.actions[0]!.durationMs).toBe(3000);
    expect(program.spec.actor!.x).toBe(105);
  });

  it("rejects an extreme low grip that cannot reserve supported load transfer instead of freezing the brace", () => {
    const result = validateAnimation({
      ...scene, prop: { ...scene.prop!, y: 180, height: 110, handle: { x: 0, y: 80 } }
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unreachable_contact", path: "$.prop.handle" }));
    expect(result.diagnostics.find((item) => item.code === "unreachable_contact")!.message).toMatch(/near\/right grip error.*far\/left grip error/);
  });

  it("rejects inside-crate, excessively low and distant grips rather than stretching, relocating or retiming", () => {
    const overlapping = validateAnimation({ ...scene, actor: { x: 148, groundY: 290 } });
    expect(overlapping.diagnostics.map((item) => item.code)).toContain("actor_prop_overlap");
    const lowSpec = { ...scene, prop: { ...scene.prop!, handle: { x: 0, y: 45 } } };
    const low = validateAnimation(lowSpec);
    expect(low.diagnostics.map((item) => item.code)).toContain("unreachable_contact");
    const distant = validateAnimation({ ...scene, actor: { x: 35, groundY: 290 } });
    expect(distant.diagnostics.map((item) => item.code)).toContain("unreachable_contact");
    expect(low.valid).toBe(false);
    expect(compileAnimation(lowSpec).program).toBeUndefined();
  });

  it("diagnoses a levitating or buried crate instead of inventing a second floor", () => {
    for (const y of [230, 250]) {
      const result = validateAnimation({ ...scene, prop: { ...scene.prop!, y } });
      expect(result.diagnostics.map((item) => item.code)).toContain("ungrounded_prop");
    }
  });

  it("preloads the closing walk and carries reach/load across a touching push without early prop travel or a neutral reset", () => {
    const program = compile({
      ...scene, canvas: { width: 640, height: 400, fps: 30 }, durationMs: 5600,
      actor: { x: 125, groundY: 310 }, targets: { approach: { x: 195, y: 310 } },
      prop: { id: "crate", x: 250, y: 234, width: 64, height: 76, toX: 400, handle: { x: 0, y: 22 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 1800, target: "approach" },
        { action: "push", startMs: 1800, durationMs: 3600, target: "crate" }
      ]
    });
    const boundary = sampleAnimation(program, 1800);
    expect(boundary.x).toBe(195);
    expect(boundary.prop!.x).toBe(250);
    expect(Math.atan2(boundary.segments[0]!.x2 - boundary.segments[0]!.x1, boundary.segments[0]!.y1 - boundary.segments[0]!.y2)).toBeGreaterThan(0.30);
    expect(hand(boundary, "right").x2).toBeGreaterThan(boundary.segments[0]!.x2 + 15);
    let last = sampleAnimation(program, 1530);
    let drift = 0;
    for (let time = 1531; time <= 2520; time++) {
      const frame = sampleAnimation(program, time);
      expect(frame.prop!.x).toBe(250);
      if (time >= 1800) {
        expect(frame.x).toBe(195);
        expect(frame.segments[0]!.x2 - frame.segments[0]!.x1).toBeGreaterThan(15);
        expect(hand(frame, "right").x2).toBeGreaterThan(frame.segments[0]!.x2 + 15);
      }
      for (let i = 0; i < 9; i++) {
        const a = last.segments[i]!;
        const b = frame.segments[i]!;
        expect(Math.hypot(a.x2 - b.x2, a.y2 - b.y2)).toBeLessThan(1);
      }
      for (const side of ["left", "right"]) {
        const a = foot(last, side);
        const b = foot(frame, side);
        if (Math.abs(a.y2 - 310) < 1e-7 && Math.abs(b.y2 - 310) < 1e-7) drift += Math.hypot(a.x2 - b.x2, a.y2 - b.y2);
      }
      last = frame;
    }
    expect(drift).toBeLessThanOrEqual(0.25);
    expect(sampleAnimation(program, 5600).x).toBe(345);
    const held = sampleAnimation(program, 3000);
    for (const side of ["left", "right"]) {
      const assigned = grip(held, side);
      expect(Math.hypot(hand(held, side).x2 - assigned.x, hand(held, side).y2 - assigned.y)).toBeLessThanOrEqual(0.25);
    }
    const times = [1800, 1640, 2519, 1800, 4000, 1799.999, 3000];
    const expected = times.map((time) => sampleAnimation(program, time));
    sampleAnimation(program, 5400);
    for (let i = times.length - 1; i >= 0; i--) expect(sampleAnimation(program, times[i]!)).toEqual(expected[i]);
  });

  it("keeps the handle at the center of two exact wrists 8 scaled units apart, not at either wrist", () => {
    const program = compile(scene);
    for (let time = 700; time <= 2560; time += 7) {
      const frame = sampleAnimation(program, time);
      expect(hand(frame, "left").x2).toBeCloseTo(hand(frame, "right").x2, 8);
      expect(hand(frame, "left").y2 - hand(frame, "right").y2).toBeCloseTo(8, 8);
      expect(hand(frame, "left").y2 - frame.prop!.handleY).toBeCloseTo(4, 8);
      expect(hand(frame, "right").y2 - frame.prop!.handleY).toBeCloseTo(-4, 8);
      for (const side of ["left", "right"]) {
        const wrongCenterError = Math.hypot(hand(frame, side).x2 - frame.prop!.handleX, hand(frame, side).y2 - frame.prop!.handleY);
        expect(wrongCenterError).toBeGreaterThan(3.99);
      }
    }
  });

  it.each([
    { name: "low shipped crate", spec: scene },
    { name: "taller crate", spec: {
      ...scene, canvas: { width: 640, height: 400, fps: 30 }, actor: { x: 195, groundY: 310 },
      prop: { id: "crate", x: 250, y: 234, width: 64, height: 76, toX: 400, handle: { x: 0, y: 22 } }
    } }
  ])("transfers pelvis and torso load between supported stances with locked wrists: $name", ({ spec }) => {
    const program = compile(spec);
    const frames = Array.from({ length: 101 }, (_, i) => sampleAnimation(program, 1000 + i * 10));
    const offsets = frames.map((frame) => frame.segments[0]!.x1 - frame.x);
    const angles = frames.map((frame) => {
      const torso = frame.segments[0]!;
      return Math.atan2(torso.x2 - torso.x1, torso.y1 - torso.y2);
    });
    const shoulders = frames.map((frame) => frame.segments[0]!.x2 - frame.prop!.x);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(3.5);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(0.06);
    expect(Math.max(...shoulders) - Math.min(...shoulders)).toBeGreaterThan(3);
    for (const frame of frames) {
      expect(Math.min(Math.abs(foot(frame, "left").y2 - frame.groundY),
        Math.abs(foot(frame, "right").y2 - frame.groundY))).toBeLessThan(1e-7);
      for (const side of ["left", "right"]) {
        const assigned = grip(frame, side);
        expect(Math.hypot(hand(frame, side).x2 - assigned.x, hand(frame, side).y2 - assigned.y)).toBeLessThanOrEqual(0.25);
      }
    }
  });

  it("scales the assigned grip spacing with the complete small-canvas rig", () => {
    const program = compile({
      ...scene, canvas: { width: 96, height: 80, fps: 30 }, durationMs: 2200,
      actor: { x: 25, groundY: 65 },
      prop: { id: "crate", x: 48, y: 33, width: 27, height: 32, toX: 64, handle: { x: 0, y: 9 } },
      actions: [{ action: "push", startMs: 0, durationMs: 2000, target: "crate" }]
    });
    for (let time = 400; time <= 1640; time += 11) {
      const frame = sampleAnimation(program, time);
      const expectedSeparation = 8 * (65 - 4) / 145;
      expect(hand(frame, "left").y2 - hand(frame, "right").y2).toBeCloseTo(expectedSeparation, 8);
      for (const side of ["left", "right"]) {
        const assigned = grip(frame, side);
        expect(Math.hypot(hand(frame, side).x2 - assigned.x, hand(frame, side).y2 - assigned.y)).toBeLessThanOrEqual(0.25);
      }
    }
  });

  it("diagnoses either edge of the two-grip region crossing the prop boundary", () => {
    for (const y of [1, 49]) {
      const result = validateAnimation({ ...scene, prop: { ...scene.prop!, handle: { x: 0, y } } });
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        path: "$.prop.handle", code: "grip_region_outside_prop"
      }));
    }
  });
});
