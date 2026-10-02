import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation, validateAnimation } from "../src/compiler.js";
import type { AnimationSpec, CompiledAnimation, SampledFrame } from "../src/contract.js";

const base: AnimationSpec = {
  version: "stickman.animation/v1",
  canvas: { width: 640, height: 360, fps: 30 },
  durationMs: 3200,
  actor: { x: 320, groundY: 290 },
  actions: []
};

function compile(spec: AnimationSpec): CompiledAnimation {
  const result = compileAnimation(spec);
  expect(result.diagnostics).toEqual([]);
  return result.program!;
}

function travel(action: "walk" | "run", direction: number, distance = 200, duration = 2800): CompiledAnimation {
  return compile({
    ...base, durationMs: duration + 200,
    targets: { mark: { x: 320 + direction * distance, y: 290 } },
    actions: [{ action, startMs: 0, durationMs: duration, target: "mark" }]
  });
}

const foot = (frame: SampledFrame, side: string) => frame.segments.find((line) => line.id === `${side}-shin`)!;
const preparationMs = (duration: number, reversing = false): number => Math.min(duration * (reversing ? 0.16 : 0.08), reversing ? 240 : 120);
const settlementMs = (duration: number): number => Math.min(duration * 0.08, 200);
const atGait = (duration: number, q: number, reversing = false): number =>
  preparationMs(duration, reversing) + (duration - preparationMs(duration, reversing) - settlementMs(duration)) * q;

describe("world-space locomotion contacts", () => {
  it.each(["walk", "run"] as const)("%s plants both directions with cumulative stance drift <= 0.25px and no floor penetration", (action) => {
    for (const direction of [-1, 1]) {
      const program = travel(action, direction);
      let supportedTravel = 0;
      let flightSamples = 0;
      for (const side of ["left", "right"]) {
        let cumulativeDrift = 0;
        let liftCount = 0;
        let last = sampleAnimation(program, 0);
        for (let time = 2; time <= 3000; time += 2) {
          const frame = sampleAnimation(program, time);
          const a = foot(last, side);
          const b = foot(frame, side);
          const plantedBefore = Math.abs(a.y2 - 290) < 1e-7;
          const plantedNow = Math.abs(b.y2 - 290) < 1e-7;
          expect(b.y2).toBeLessThanOrEqual(290 + 1e-7);
          if (plantedBefore && plantedNow) {
            cumulativeDrift += Math.hypot(b.x2 - a.x2, b.y2 - a.y2);
            supportedTravel += Math.abs(frame.x - last.x);
          }
          if (plantedBefore && !plantedNow) liftCount++;
          if (side === "left" && foot(frame, "left").y2 < 289.9 && foot(frame, "right").y2 < 289.9) flightSamples++;
          last = frame;
        }
        expect(cumulativeDrift, `${action} ${direction} ${side}`).toBeLessThanOrEqual(0.25);
        expect(liftCount).toBeGreaterThanOrEqual(2);
      }
      // This must exercise a planted foot while the actor genuinely travels.
      expect(supportedTravel).toBeGreaterThan(100);
      expect(sampleAnimation(program, 2800).x).toBe(320 + direction * 200);
      expect(foot(sampleAnimation(program, 2800), "left").x2).toBeCloseTo(320 + direction * 200 - 9, 8);
      expect(foot(sampleAnimation(program, 2800), "right").x2).toBeCloseTo(320 + direction * 200 + 9, 8);
      if (action === "walk") expect(flightSamples).toBe(0);
      else expect(flightSamples * 2).toBeGreaterThan(200);
    }
  });

  it("ties step count to actual travel distance rather than playing the same sine cycle on every route", () => {
    const countLifts = (program: CompiledAnimation): number => {
      let count = 0;
      let last = sampleAnimation(program, 0);
      for (let time = 2; time <= program.spec.durationMs; time += 2) {
        const frame = sampleAnimation(program, time);
        for (const side of ["left", "right"]) {
          if (Math.abs(foot(last, side).y2 - 290) < 1e-7 && foot(frame, side).y2 < 290 - 1e-7) count++;
        }
        last = frame;
      }
      return count;
    };
    const short = countLifts(travel("walk", 1, 48, 1200));
    const long = countLifts(travel("walk", 1, 192, 3200));
    expect(short).toBe(2);
    expect(long).toBe(5);
  });

  it("keeps terminal run step pairs reachable on short and formerly odd-step routes in both directions", () => {
    for (const distance of [20, 70, 121, 180, 240]) {
      for (const direction of [-1, 1]) {
        const program = travel("run", direction, distance, 2000);
        for (let time = 0; time <= 2000; time += 3) {
          const frame = sampleAnimation(program, time);
          for (const line of frame.segments) {
            const expected = line.id === "torso" ? 45 : line.id.includes("arm") ? 28 : 36;
            expect(Math.hypot(line.x2 - line.x1, line.y2 - line.y1)).toBeCloseTo(expected, 8);
            expect(Math.max(line.y1, line.y2)).toBeLessThanOrEqual(290 + 1e-7);
          }
        }
        const final = sampleAnimation(program, 2000);
        expect(final.x).toBe(320 + direction * distance);
        expect(foot(final, "left").x2).toBeCloseTo(final.x - 9, 8);
        expect(foot(final, "right").x2).toBeCloseTo(final.x + 9, 8);
        expect(foot(final, "left").y2).toBeCloseTo(290, 8);
        expect(foot(final, "right").y2).toBeCloseTo(290, 8);
      }
    }
  });

  it.each(["walk", "run"] as const)("does not invent gait cycles for a zero-distance %s target", (action) => {
    const program = travel(action, 1, 0, 1000);
    const rest = sampleAnimation(program, 0);
    for (let time = 0; time <= 1200; time += 10) {
      const frame = sampleAnimation(program, time);
      expect(frame.x).toBe(320);
      expect(frame.segments).toEqual(rest.segments);
    }
  });

  it("makes run visibly different through lean, elbow drive, compression and real flight windows", () => {
    const walk = travel("walk", 1);
    const run = travel("run", 1);
    const maximumLean = (program: CompiledAnimation): number => Math.max(...Array.from({ length: 100 }, (_, i) => {
      const torso = sampleAnimation(program, i * 28).segments[0]!;
      return Math.atan2(torso.x2 - torso.x1, torso.y1 - torso.y2);
    }));
    expect(maximumLean(run)).toBeGreaterThan(maximumLean(walk) * 2.5);
    let window = 0;
    let longest = 0;
    let minimumHeight = Infinity;
    for (let time = 0; time <= 2800; time += 2) {
      const frame = sampleAnimation(run, time);
      minimumHeight = Math.min(minimumHeight, 290 - frame.segments[0]!.y1);
      if (foot(frame, "left").y2 < 289.9 && foot(frame, "right").y2 < 289.9) { window += 2; longest = Math.max(longest, window); }
      else window = 0;
    }
    expect(longest).toBeGreaterThan(40);
    expect(minimumHeight).toBeLessThan(64);
  });

  it("turns through connected poses and knee extension, not a facing multiplier through zero", () => {
    const program = travel("run", -1, 70, 1000);
    const midpoint = sampleAnimation(program, 80);
    const torso = midpoint.segments[0]!;
    const arms = midpoint.segments.filter((line) => line.id.includes("upper-arm"));
    expect(Math.abs(arms[0]!.x2 - arms[1]!.x2)).toBeGreaterThan(15);
    expect(Math.abs(foot(midpoint, "right").x2 - foot(midpoint, "left").x2)).toBe(18);
    expect(Math.hypot(torso.x2 - torso.x1, torso.y2 - torso.y1)).toBeCloseTo(45, 8);
    let last = sampleAnimation(program, 0);
    const bendOffset = (frame: SampledFrame, side: string): number => {
      const thigh = frame.segments.find((line) => line.id === `${side}-thigh`)!;
      const ankle = foot(frame, side);
      const dx = ankle.x2 - thigh.x1;
      const dy = ankle.y2 - thigh.y1;
      return (dx * (thigh.y2 - thigh.y1) - dy * (thigh.x2 - thigh.x1)) / Math.hypot(dx, dy);
    };
    for (let time = 1; time <= 160; time++) {
      const frame = sampleAnimation(program, time);
      for (const side of ["left", "right"]) {
        const a = bendOffset(last, side);
        const b = bendOffset(frame, side);
        if (a * b < 0) { expect(Math.abs(a)).toBeLessThan(0.5); expect(Math.abs(b)).toBeLessThan(0.5); }
      }
      for (let i = 0; i < frame.segments.length; i++) {
        expect(Math.hypot(frame.segments[i]!.x2 - last.segments[i]!.x2, frame.segments[i]!.y2 - last.segments[i]!.y2)).toBeLessThan(0.75);
      }
      last = frame;
    }
  });
});

describe("jump and action boundaries", () => {
  it.each([1, 0.5])("preloads run -> jump -> point without upright arrival/landing resets at rig scale %s", (scale) => {
    const ground = scale === 1 ? 290 : 100;
    for (const direction of [-1, 1]) {
      const program = compile({
        ...base, canvas: { width: 640 * scale, height: 360 * scale, fps: 30 }, durationMs: 6000,
        actor: { x: 140 * scale, groundY: ground },
        targets: {
          arrival: { x: 360 * scale, y: ground },
          element: { x: (360 + direction * 160) * scale, y: ground - 150 * scale }
        },
        actions: [
          { action: "run", startMs: 200, durationMs: 1800, target: "arrival" },
          { action: "jump", startMs: 2000, durationMs: 1800 },
          { action: "point", startMs: 3800, durationMs: 2000, target: "element" }
        ]
      });
      const arrival = sampleAnimation(program, 2000);
      const landing = sampleAnimation(program, 3800);
      expect(arrival.x).toBe(360 * scale);
      expect(ground - arrival.segments[0]!.y1).toBeCloseTo(54 * scale, 8);
      expect(arrival.segments[0]!.x2 - arrival.segments[0]!.x1).toBeGreaterThan(4 * scale);
      expect(ground - landing.segments[0]!.y1).toBeCloseTo(66 * scale, 8);
      const arm = landing.segments.find((line) => line.id === "right-forearm")!;
      expect(arm.y2).toBeLessThan(landing.segments[0]!.y2 + 50 * scale);
      for (const boundary of [2000, 3800]) {
        const before = sampleAnimation(program, boundary - 0.001);
        const at = sampleAnimation(program, boundary);
        const after = sampleAnimation(program, boundary + 0.001);
        for (let i = 0; i < 9; i++) {
          for (const key of ["x1", "y1", "x2", "y2"] as const) {
            expect(Math.abs(before.segments[i]![key] - at.segments[i]![key])).toBeLessThan(0.01);
            expect(Math.abs(after.segments[i]![key] - at.segments[i]![key])).toBeLessThan(0.01);
          }
        }
      }
      let last = sampleAnimation(program, 1500);
      let drift = 0;
      for (let time = 1501; time <= 4300; time++) {
        const frame = sampleAnimation(program, time);
        expect(frame.groundY).toBe(ground);
        if (time >= 2000) expect(frame.x).toBe(360 * scale);
        for (let i = 0; i < 9; i++) {
          const a = last.segments[i]!;
          const b = frame.segments[i]!;
          expect(Math.hypot(b.x2 - a.x2, b.y2 - a.y2)).toBeLessThan(1.5);
          const expected = (b.id === "torso" ? 45 : b.id.includes("arm") ? 28 : 36) * scale;
          expect(Math.abs(Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / expected - 1)).toBeLessThanOrEqual(0.001);
          expect(Math.max(b.y1, b.y2)).toBeLessThanOrEqual(ground + 1e-7);
        }
        for (const side of ["left", "right"]) {
          const a = foot(last, side);
          const b = foot(frame, side);
          if (Math.abs(a.y2 - ground) < 1e-7 && Math.abs(b.y2 - ground) < 1e-7) drift += Math.abs(a.x2 - b.x2);
        }
        last = frame;
      }
      expect(drift).toBeLessThanOrEqual(0.25);
      const times = [3799.999, 2000, 1600, 3900, 3200, 1900];
      const expected = times.map((time) => sampleAnimation(program, time));
      sampleAnimation(program, 5800);
      for (let i = times.length - 1; i >= 0; i--) expect(sampleAnimation(program, times[i]!)).toEqual(expected[i]);
    }
  });

  it("follows through the jump arm drive instead of holding a rigid V, with asymmetrical flight tuck and fixed landing anchors", () => {
    const program = compile({ ...base, actions: [{ action: "jump", startMs: 0, durationMs: 2800 }] });
    const launch = sampleAnimation(program, 840);
    const apex = sampleAnimation(program, 1428);
    const descent = sampleAnimation(program, 1900);
    const armAngle = (frame: SampledFrame) => {
      const upper = frame.segments.find((line) => line.id === "right-upper-arm")!;
      return Math.atan2(upper.x2 - upper.x1, upper.y2 - upper.y1);
    };
    expect(armAngle(launch) - armAngle(apex)).toBeGreaterThan(0.6);
    expect(armAngle(apex) - armAngle(descent)).toBeGreaterThan(0.15);
    expect(foot(apex, "right").y2 - foot(apex, "left").y2).toBeGreaterThan(8);
    expect(foot(apex, "right").x2 - foot(apex, "left").x2).toBeGreaterThan(30);
    for (const time of [0, 560, 840, 2016, 2408, 2800]) {
      const frame = sampleAnimation(program, time);
      expect(foot(frame, "left").x2).toBeCloseTo(311, 8);
      expect(foot(frame, "right").x2).toBeCloseTo(329, 8);
      expect(foot(frame, "left").y2).toBeCloseTo(290, 7);
      expect(foot(frame, "right").y2).toBeCloseTo(290, 7);
    }
  });

  it("crouches, launches, flies, absorbs and settles over an unchanged world floor", () => {
    const program = compile({ ...base, actions: [{ action: "jump", startMs: 0, durationMs: 2800 }] });
    const rest = sampleAnimation(program, 0);
    const crouch = sampleAnimation(program, 560);
    const apex = sampleAnimation(program, 1428);
    const absorb = sampleAnimation(program, 2408);
    expect(crouch.segments[0]!.y1).toBeGreaterThan(rest.segments[0]!.y1 + 12);
    expect(apex.head.y).toBeLessThan(rest.head.y - 45);
    expect(absorb.segments[0]!.y1).toBeGreaterThan(rest.segments[0]!.y1 + 18);
    expect(sampleAnimation(program, 2800).segments).toEqual(rest.segments);
    for (let time = 0; time <= 3000; time += 2) {
      const frame = sampleAnimation(program, time);
      expect(frame.groundY).toBe(290);
      for (const side of ["left", "right"]) {
        expect(foot(frame, side).y2).toBeLessThanOrEqual(290 + 1e-8);
        if (time <= 840 || time >= 2016) {
          expect(foot(frame, side).x2).toBeCloseTo(320 + (side === "left" ? -9 : 9), 8);
          expect(foot(frame, side).y2).toBeCloseTo(290, 7);
        }
      }
    }
  });

  describe("coordinated intention and touching travel", () => {
    it.each([1, -1])("shares contact phase and nonzero waypoint speed across unequal three-clip routes in direction %i", (direction) => {
      const start = direction === 1 ? 140 : 500;
      const program = compile({
        ...base, durationMs: 5200, actor: { x: start, groundY: 290 },
        targets: {
          a: { x: start + direction * 140, y: 290 },
          b: { x: start + direction * 320, y: 290 },
          c: { x: start + direction * 360, y: 290 }
        },
        actions: [
          { action: "walk", startMs: 0, durationMs: 1700, target: "a" },
          { action: "run", startMs: 1700, durationMs: 1900, target: "b" },
          { action: "walk", startMs: 3600, durationMs: 1400, target: "c" }
        ]
      });
      for (const [time, x] of [[1700, start + direction * 140], [3600, start + direction * 320]] as const) {
        const at = sampleAnimation(program, time);
        expect(at.x).toBe(x);
        const beforeVelocity = direction * (at.x - sampleAnimation(program, time - 1).x);
        const afterVelocity = direction * (sampleAnimation(program, time + 1).x - at.x);
        expect(Math.min(beforeVelocity, afterVelocity)).toBeGreaterThan(0.03);
        expect(afterVelocity / beforeVelocity).toBeCloseTo(1, 3);
      }
      let last = sampleAnimation(program, 0);
      let drift = 0;
      for (let time = 1; time <= 5200; time++) {
        const frame = sampleAnimation(program, time);
        for (let i = 0; i < 9; i++) {
          const a = last.segments[i]!;
          const b = frame.segments[i]!;
          expect(Math.hypot(b.x2 - a.x2, b.y2 - a.y2)).toBeLessThan(1.5);
          expect(Math.max(b.y1, b.y2)).toBeLessThanOrEqual(290 + 1e-7);
        }
        for (const side of ["left", "right"]) {
          const a = foot(last, side);
          const b = foot(frame, side);
          if (Math.abs(a.y2 - 290) < 1e-7 && Math.abs(b.y2 - 290) < 1e-7) drift += Math.abs(b.x2 - a.x2);
        }
        last = frame;
      }
      expect(drift).toBeLessThanOrEqual(0.25);
      expect(sampleAnimation(program, 5000).x).toBe(start + direction * 360);
      const times = [1699.999, 1700, 3100, 3600, 4200, 17];
      const frames = times.map((time) => sampleAnimation(program, time));
      for (let i = times.length - 1; i >= 0; i--) expect(sampleAnimation(program, times[i]!)).toEqual(frames[i]);
    });

    it("does not inherit a moving gait from a zero-distance travel or bridge an authored idle gap", () => {
      for (const gap of [0, 20]) {
        const program = compile({
          ...base, durationMs: 3300, actor: { x: 140, groundY: 290 },
          targets: { same: { x: 140, y: 290 }, end: { x: 280, y: 290 } },
          actions: [
            { action: "walk", startMs: 0, durationMs: 1000, target: "same" },
            { action: "run", startMs: 1000 + gap, durationMs: 2000, target: "end" }
          ]
        });
        expect(sampleAnimation(program, 1000 + gap).segments).toEqual(sampleAnimation(program, 0).segments);
        expect(sampleAnimation(program, 1080 + gap).x).toBe(140);
        expect(sampleAnimation(program, 3000 + gap).x).toBe(280);
      }
    });

    it("stages the two knee branch changes at separate near-extension events with a planted weight shift", () => {
      const program = travel("walk", -1, 160, 2400);
      const switchTimes: number[] = [];
      for (const side of ["left", "right"]) {
        let prior = 0;
        for (let time = 0; time < preparationMs(2400, true); time++) {
          const frame = sampleAnimation(program, time);
          const thigh = frame.segments.find((line) => line.id === `${side}-thigh`)!;
          const ankle = foot(frame, side);
          const dx = ankle.x2 - thigh.x1;
          const dy = ankle.y2 - thigh.y1;
          const pole = (dx * (thigh.y2 - thigh.y1) - dy * (thigh.x2 - thigh.x1)) / Math.hypot(dx, dy);
          if (prior * pole < 0) {
            expect(Math.abs(prior)).toBeLessThan(0.5);
            expect(Math.abs(pole)).toBeLessThan(0.5);
            switchTimes.push(time);
          }
          prior = pole;
          expect(ankle.y2).toBeCloseTo(290, 8);
        }
      }
      expect(switchTimes).toHaveLength(2);
      expect(Math.abs(switchTimes[0]! - switchTimes[1]!)).toBeGreaterThan(50);
      const early = sampleAnimation(program, 80);
      expect(Math.abs(early.segments[0]!.x1 - early.x)).toBeGreaterThan(0.5);
      expect(early.segments[0]!.x2).toBeLessThan(early.segments[0]!.x1 - 0.5);
    });

    it("begins the left point arm intention during the turn rather than waiting for the legs to finish", () => {
      const program = compile({
        ...base, targets: { mark: { x: 90, y: 150 } },
        actions: [{ action: "point", startMs: 0, durationMs: 2800, target: "mark" }]
      });
      const rest = sampleAnimation(program, 0);
      const early = sampleAnimation(program, 280);
      const startArm = rest.segments.find((line) => line.id === "right-forearm")!;
      const arm = early.segments.find((line) => line.id === "right-forearm")!;
      expect(arm.x2).toBeLessThan(startArm.x2 - 20);
      expect(arm.x2).toBeLessThan(early.segments[0]!.x2);
      expect(early.x).toBe(320);
      expect(foot(early, "left").y2).toBeCloseTo(290, 8);
      expect(foot(early, "right").y2).toBeCloseTo(290, 8);
    });

    it.each([
      ["walk", "walk", 1], ["walk", "run", 1], ["run", "walk", 1], ["run", "run", 1],
      ["walk", "walk", -1], ["run", "run", -1]
    ] as const)("joins touching %s -> %s with direction %i, exact waypoints and supported intention", (first, second, direction) => {
      const program = compile({
        ...base, durationMs: 5800, actor: { x: 140, groundY: 290 },
        targets: { a: { x: 320, y: 290 }, b: { x: 320 + direction * 180, y: 290 } },
        actions: [
          { action: first, startMs: 0, durationMs: 2800, target: "a" },
          { action: second, startMs: 2800, durationMs: 2800, target: "b" }
        ]
      });
      const boundary = sampleAnimation(program, 2800);
      expect(boundary.x).toBe(320);
      expect(Math.abs(boundary.segments[0]!.x2 - boundary.segments[0]!.x1)).toBeGreaterThan(3);
      expect(boundary.segments[0]!.y1).toBeGreaterThan(290 - 69);
      if (direction === 1) {
        const incomingVelocity = (boundary.x - sampleAnimation(program, 2780).x) / 20;
        const outgoingVelocity = (sampleAnimation(program, 2820).x - boundary.x) / 20;
        expect(incomingVelocity).toBeGreaterThan(0.04);
        expect(outgoingVelocity).toBeGreaterThan(0.04);
        expect(outgoingVelocity / incomingVelocity).toBeCloseTo(1, 2);
        // A waypoint is not a two-foot neutral stop or a new gait cycle.
        expect(Math.abs(foot(boundary, "left").x2 - (boundary.x - 9))
          + Math.abs(foot(boundary, "right").x2 - (boundary.x + 9))).toBeGreaterThan(15);
      }
      const before = sampleAnimation(program, 2799.999);
      const after = sampleAnimation(program, 2800.001);
      for (let i = 0; i < 9; i++) {
        for (const coordinate of ["x1", "y1", "x2", "y2"] as const) {
          expect(Math.abs(before.segments[i]![coordinate] - boundary.segments[i]![coordinate])).toBeLessThan(0.01);
          expect(Math.abs(after.segments[i]![coordinate] - boundary.segments[i]![coordinate])).toBeLessThan(0.01);
        }
      }
      let last = sampleAnimation(program, 2350);
      let drift = 0;
      for (let time = 2351; time <= 3500; time++) {
        const frame = sampleAnimation(program, time);
        for (let i = 0; i < 9; i++) {
          const a = last.segments[i]!;
          const b = frame.segments[i]!;
          expect(Math.hypot(a.x2 - b.x2, a.y2 - b.y2)).toBeLessThan(1.5);
          const expected = b.id === "torso" ? 45 : b.id.includes("arm") ? 28 : 36;
          expect(Math.hypot(b.x2 - b.x1, b.y2 - b.y1)).toBeCloseTo(expected, 8);
        }
        for (const side of ["left", "right"]) {
          const a = foot(last, side);
          const b = foot(frame, side);
          if (Math.abs(a.y2 - 290) < 1e-7 && Math.abs(b.y2 - 290) < 1e-7) drift += Math.hypot(a.x2 - b.x2, a.y2 - b.y2);
        }
        last = frame;
      }
      expect(drift).toBeLessThanOrEqual(0.25);
      expect(sampleAnimation(program, 5600).x).toBe(320 + direction * 180);
    });
  });

  it.each(["wave", "run", "point", "jump", "walk"] as const)("keeps a touching walk -> %s boundary continuous, including direction reversal", (next) => {
    const program = compile({
      ...base, durationMs: 5400,
      targets: { first: { x: 460, y: 290 }, second: { x: 260, y: next === "point" ? 130 : 290 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 2200, target: "first" },
        { action: next, startMs: 2200, durationMs: 2800, ...(["walk", "run", "point"].includes(next) ? { target: "second" } : {}) }
      ]
    });
    for (const boundary of [0, 2200, 5000]) {
      const before = sampleAnimation(program, boundary - 0.001);
      const at = sampleAnimation(program, boundary);
      const after = sampleAnimation(program, boundary + 0.001);
      for (let i = 0; i < at.segments.length; i++) {
        for (const coordinate of ["x1", "y1", "x2", "y2"] as const) {
          expect(Math.abs(before.segments[i]![coordinate] - at.segments[i]![coordinate])).toBeLessThan(0.01);
          expect(Math.abs(after.segments[i]![coordinate] - at.segments[i]![coordinate])).toBeLessThan(0.01);
        }
      }
    }
  });

  it("diagnoses a moving-floor target and infeasible cadence instead of silently changing timing or stretching", () => {
    const invalid = validateAnimation({
      ...base, targets: { mark: { x: 580, y: 150 } },
      actions: [{ action: "walk", startMs: 0, durationMs: 400, target: "mark" }]
    });
    expect(invalid.diagnostics.map((item) => item.code)).toContain("non_flat_ground");
    expect(invalid.diagnostics.map((item) => item.code)).toContain("infeasible_cadence");
  });
});

describe("clean presentation locomotion profiles", () => {
  it.each(["walk", "run"] as const)("makes left/right %s equivalent near/far skeletal poses rather than bunching the left-facing limbs", (action) => {
    const duration = action === "run" ? 1600 : 3200;
    const distance = action === "run" ? 360 : 200;
    const right = compile({
      ...base, durationMs: duration + 200, actor: { x: 140, groundY: 290 },
      targets: { mark: { x: 140 + distance, y: 290 } },
      actions: [{ action, startMs: 0, durationMs: duration, target: "mark" }]
    });
    const left = compile({
      ...base, durationMs: duration + 200, actor: { x: 500, groundY: 290 },
      targets: { mark: { x: 500 - distance, y: 290 } },
      actions: [{ action, startMs: 0, durationMs: duration, target: "mark" }]
    });
    for (const q of [0.08, 0.15, 0.25, 0.45, 0.65, 0.80, 0.99]) {
      const a = sampleAnimation(right, atGait(duration, q));
      const b = sampleAnimation(left, atGait(duration, q, true));
      expect(a.x + b.x).toBeCloseTo(640, 7);
      for (const line of a.segments) {
        const oppositeId = line.id.startsWith("left-") ? line.id.replace("left-", "right-")
          : line.id.startsWith("right-") ? line.id.replace("right-", "left-") : line.id;
        const opposite = b.segments.find((item) => item.id === oppositeId)!;
        expect(line.x1 + opposite.x1, `${action} ${q} ${line.id}`).toBeCloseTo(640, 6);
        expect(line.x2 + opposite.x2, `${action} ${q} ${line.id}`).toBeCloseTo(640, 6);
        expect(line.y1).toBeCloseTo(opposite.y1, 6);
        expect(line.y2).toBeCloseTo(opposite.y2, 6);
      }
    }
  });

  it("carries loaded front-foot support and new torso intention through reversal, then pushes into the new route", () => {
    const program = compile({
      ...base, durationMs: 5800, actor: { x: 140, groundY: 290 },
      targets: { a: { x: 320, y: 290 }, b: { x: 140, y: 290 } },
      actions: [
        { action: "run", startMs: 0, durationMs: 2800, target: "a" },
        { action: "run", startMs: 2800, durationMs: 2800, target: "b" }
      ]
    });
    const plant = sampleAnimation(program, 2800);
    expect(plant.x).toBe(320);
    expect(290 - plant.segments[0]!.y1).toBeCloseTo(62, 8);
    expect(plant.segments[0]!.x1 - plant.x).toBeCloseTo(5, 8);
    expect(plant.segments[0]!.x2).toBeLessThan(plant.segments[0]!.x1 - 5);
    for (const side of ["left", "right"]) expect(foot(plant, side).y2).toBeCloseTo(290, 8);
    const transfer = sampleAnimation(program, 2800 + 400 * 0.72);
    expect(transfer.segments[0]!.x1).toBeLessThan(transfer.x - 4);
    expect(transfer.segments[0]!.x2).toBeLessThan(transfer.segments[0]!.x1 - 8);
    for (let time = 2800; time <= 3200; time += 5) {
      const frame = sampleAnimation(program, time);
      expect(290 - frame.segments[0]!.y1).toBeLessThanOrEqual(62.1);
      expect(frame.x).toBe(320);
      expect(Math.min(foot(frame, "left").y2, foot(frame, "right").y2)).toBeLessThanOrEqual(290 + 1e-7);
      expect(Math.max(foot(frame, "left").y2, foot(frame, "right").y2)).toBeCloseTo(290, 7);
    }
    expect(sampleAnimation(program, 3350).x).toBeLessThan(320);
  });

  it("retains counterbalance through arrival braking and drives the jump without a repeated full planted preparation", () => {
    const program = compile({
      ...base, durationMs: 4000, actor: { x: 140, groundY: 290 },
      targets: { arrival: { x: 360, y: 290 } },
      actions: [
        { action: "run", startMs: 200, durationMs: 1800, target: "arrival" },
        { action: "jump", startMs: 2000, durationMs: 1800 }
      ]
    });
    expect(sampleAnimation(program, 1900).x).toBeLessThan(360);
    for (const time of [1820, 1950, 2000, 2040, 2080]) {
      const frame = sampleAnimation(program, time);
      const hands = frame.segments.filter((line) => line.id.includes("forearm"));
      expect(Math.abs(hands[0]!.x2 - hands[1]!.x2)).toBeGreaterThan(30);
      if (time >= 2000) expect(frame.x).toBe(360);
    }
    const arrived = sampleAnimation(program, 2000);
    const loading = sampleAnimation(program, 2090);
    expect(loading.segments[0]!.y1).toBeGreaterThan(arrived.segments[0]!.y1 + 2);
    const driven = sampleAnimation(program, 2250);
    const hand = driven.segments.find((line) => line.id === "right-forearm")!;
    expect(hand.y2).toBeLessThan(driven.segments[0]!.y2 + 10);
    for (const side of ["left", "right"]) expect(foot(sampleAnimation(program, 2330), side).y2).toBeLessThan(289);
    for (let time = 2000; time <= 3800; time += 13) expect(sampleAnimation(program, time).x).toBe(360);
  });

  it.each(["walk", "run"] as const)("prepares a grounded weight shift before the %s root starts moving", (action) => {
    const duration = action === "walk" ? 3200 : 1600;
    const program = compile({
      ...base, canvas: { width: 640, height: 400, fps: 30 },
      actor: { x: 140, groundY: 310 }, durationMs: duration + 200,
      targets: { destination: { x: action === "walk" ? 420 : 500, y: 310 } },
      actions: [{ action, startMs: 0, durationMs: duration, target: "destination" }]
    });
    const rest = sampleAnimation(program, 0);
    const preparation = sampleAnimation(program, preparationMs(duration) * 0.9375);
    expect(preparation.x).toBe(140);
    expect(preparation.segments[0]!.y1 - rest.segments[0]!.y1).toBeGreaterThan(action === "walk" ? 1.5 : 4);
    expect(preparation.segments[0]!.x2).toBeGreaterThan(preparation.segments[0]!.x1 + (action === "walk" ? 1.5 : 5));
    for (const side of ["left", "right"]) {
      expect(foot(preparation, side).x2).toBeCloseTo(foot(rest, side).x2, 8);
      expect(foot(preparation, side).y2).toBeCloseTo(310, 8);
    }
    const before = sampleAnimation(program, preparationMs(duration) - 0.001);
    const after = sampleAnimation(program, preparationMs(duration) + 0.001);
    for (let i = 0; i < 9; i++) expect(Math.hypot(before.segments[i]!.x2 - after.segments[i]!.x2, before.segments[i]!.y2 - after.segments[i]!.y2)).toBeLessThan(0.01);
  });

  it.each([
    { action: "walk" as const, start: 140, end: 420, duration: 3200, steps: 7 },
    { action: "run" as const, start: 140, end: 500, duration: 1600, steps: 4 },
    { action: "run" as const, start: 500, end: 140, duration: 1600, steps: 4 }
  ])("preserves requested $action route/timing with adult strides, stable support and exact endpoints", ({ action, start, end, duration, steps }) => {
    const program = compile({
      ...base, canvas: { width: 640, height: 400, fps: 30 },
      actor: { x: start, groundY: 310 }, durationMs: duration + 200,
      targets: { destination: { x: end, y: 310 } },
      actions: [{ action, startMs: 0, durationMs: duration, target: "destination" }]
    });
    let last = sampleAnimation(program, 0);
    let liftCount = 0;
    let drift = 0;
    let flight = 0;
    let maximumJointStep = 0;
    let maximumClearance = 0;
    for (let time = 1; time <= duration + 200; time++) {
      const frame = sampleAnimation(program, time);
      for (const side of ["left", "right"]) {
        const a = foot(last, side);
        const b = foot(frame, side);
        const wasPlanted = Math.abs(a.y2 - 310) < 1e-7;
        const planted = Math.abs(b.y2 - 310) < 1e-7;
        if (wasPlanted && !planted) liftCount++;
        if (wasPlanted && planted) drift += Math.hypot(a.x2 - b.x2, a.y2 - b.y2);
        maximumClearance = Math.max(maximumClearance, 310 - b.y2);
      }
      if (foot(frame, "left").y2 < 309.9 && foot(frame, "right").y2 < 309.9) flight++;
      for (let i = 0; i < 9; i++) {
        const a = last.segments[i]!;
        const b = frame.segments[i]!;
        const length = b.id === "torso" ? 45 : b.id.includes("arm") ? 28 : 36;
        expect(Math.abs(Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / length - 1)).toBeLessThan(0.001);
        expect(Math.max(b.y1, b.y2)).toBeLessThanOrEqual(310 + 1e-7);
        maximumJointStep = Math.max(maximumJointStep, Math.hypot(a.x2 - b.x2, a.y2 - b.y2));
      }
      last = frame;
    }
    expect(liftCount).toBe(steps);
    expect(drift).toBeLessThanOrEqual(0.25);
    expect(maximumJointStep).toBeLessThan(2);
    expect(sampleAnimation(program, duration).x).toBe(end);
    expect(sampleAnimation(program, duration).segments).toEqual(sampleAnimation(program, duration + 200).segments);
    expect(program.spec.actions[0]!.durationMs).toBe(duration);
    if (action === "walk") expect(flight).toBe(0);
    else { expect(flight).toBeGreaterThan(150); expect(maximumClearance).toBeGreaterThan(25); }
  });

  it("rises over the supporting leg at passing and lowers at double support, not the reverse", () => {
    const program = compile({
      ...base, canvas: { width: 640, height: 400, fps: 30 },
      actor: { x: 140, groundY: 310 }, durationMs: 3400,
      targets: { destination: { x: 420, y: 310 } },
      actions: [{ action: "walk", startMs: 0, durationMs: 3200, target: "destination" }]
    });
    const atStep = (phase: number) => sampleAnimation(program, atGait(3200, phase / 7));
    const passing = atStep(1.5);
    const support = atStep(1.95);
    expect(foot(passing, "left").y2).toBeCloseTo(310, 8);
    expect(foot(passing, "right").y2).toBeLessThan(300);
    expect(foot(support, "left").y2).toBeCloseTo(310, 8);
    expect(foot(support, "right").y2).toBeCloseTo(310, 8);
    expect(support.segments[0]!.y1 - passing.segments[0]!.y1).toBeGreaterThan(3);
  });

  it("drives the opposite arm forward at alternating run foot contacts", () => {
    const program = compile({
      ...base, canvas: { width: 640, height: 400, fps: 30 },
      actor: { x: 140, groundY: 310 }, durationMs: 1800,
      targets: { destination: { x: 500, y: 310 } },
      actions: [{ action: "run", startMs: 0, durationMs: 1600, target: "destination" }]
    });
    // The final pair brakes into a narrow stance; grade reciprocal drive at
    // the two full-stride contacts rather than the delayed stopping contact.
    for (const [step, planted, forwardArm] of [[1, "left", "right"], [2, "right", "left"]] as const) {
      const frame = sampleAnimation(program, atGait(1600, step / 4));
      expect(foot(frame, planted).y2).toBeCloseTo(310, 7);
      const arm = frame.segments.find((line) => line.id === `${forwardArm}-forearm`)!;
      const other = frame.segments.find((line) => line.id === `${forwardArm === "left" ? "right" : "left"}-forearm`)!;
      expect(arm.x2 - other.x2).toBeGreaterThan(45);
    }
  });
});

describe("bounded motion validation", () => {
  it("promptly diagnoses bad headroom and a huge path without allocating million-sample fit coverage", () => {
    const input = {
      ...base, canvas: { width: 4096, height: 400, fps: 60 }, durationMs: 120000,
      actor: { x: 6, groundY: 1 }, targets: { destination: { x: 4090, y: 2 } },
      actions: [{ action: "walk", startMs: 0, durationMs: 120000, target: "destination" }]
    };
    const start = performance.now();
    const result = validateAnimation(input);
    const elapsed = performance.now() - start;
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["rig_too_small", "non_flat_ground", "infeasible_cadence"]));
    expect(result.diagnostics.find((item) => item.code === "rig_too_small")!.message).toMatch(/Increase groundY/);
    expect(elapsed).toBeLessThan(500);
    expect(compileAnimation(input).program).toBeUndefined();
  });

  it("rejects coverage beyond the fixed budget even when cadence and a small rig are otherwise feasible", () => {
    const start = performance.now();
    const result = validateAnimation({
      ...base, canvas: { width: 4096, height: 400, fps: 30 }, durationMs: 120000,
      actor: { x: 100, groundY: 33 }, targets: { destination: { x: 4040, y: 33 } },
      actions: [{ action: "run", startMs: 0, durationMs: 120000, target: "destination" }]
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).not.toContain("rig_too_small");
    expect(result.diagnostics.map((item) => item.code)).not.toContain("infeasible_cadence");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      path: "$.actions[0]", code: "validation_capacity_exceeded",
      message: expect.stringMatching(/limit is 4096.*Increase headroom/)
    }));
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("still validates and samples a long route when the rig and coverage budget are adequate", () => {
    const program = compile({
      ...base, canvas: { width: 4096, height: 400, fps: 30 }, durationMs: 60000,
      actor: { x: 100, groundY: 310 }, targets: { destination: { x: 3996, y: 310 } },
      actions: [{ action: "run", startMs: 0, durationMs: 60000, target: "destination" }]
    });
    expect(sampleAnimation(program, 60000).x).toBe(3996);
    expect(sampleAnimation(program, 30000).groundY).toBe(310);
  });
});
