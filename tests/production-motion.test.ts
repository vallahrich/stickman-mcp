import { expect, it } from "vitest";
import { compileAnimation, sampleAnimation, validateAnimation } from "../src/compiler.js";

it("rejects a reversal whose actual supported movement window cannot fit its cadence", () => {
  const result = validateAnimation({
    version: "stickman.animation/v1", canvas: { width: 640, height: 400, fps: 30 },
    actor: { x: 200, groundY: 310 }, durationMs: 1900,
    targets: { forward: { x: 240, y: 310 }, back: { x: 220, y: 310 } },
    actions: [
      { action: "run", startMs: 0, durationMs: 1400, target: "forward" },
      { action: "run", startMs: 1400, durationMs: 500, target: "back" }
    ]
  });
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    path: "$.actions[1].durationMs", code: "infeasible_cadence"
  }));
});

it("bounds a long leftward preparation rather than scaling its idle turn to the whole clip", () => {
  const compiled = compileAnimation({
    version: "stickman.animation/v1", canvas: { width: 640, height: 400, fps: 30 },
    actor: { x: 520, groundY: 310 }, durationMs: 7600,
    targets: { end: { x: 180, y: 310 } },
    actions: [{ action: "walk", startMs: 100, durationMs: 7000, target: "end" }]
  });
  expect(compiled.valid).toBe(true);
  const program = compiled.program!;
  expect(sampleAnimation(program, 900).x).toBeLessThan(515);
  const before = sampleAnimation(program, 340 - 1e-6);
  const after = sampleAnimation(program, 340 + 1e-6);
  for (let index = 0; index < before.segments.length; index++) {
    const a = before.segments[index]!, b = after.segments[index]!;
    expect(Math.hypot(a.x2 - b.x2, a.y2 - b.y2)).toBeLessThan(1e-4);
  }
  expect(sampleAnimation(program, 7100).x).toBe(180);
});

it("connects visible supported push compression to drive impulses without moving the grip", () => {
  const duration = 5400;
  const compiled = compileAnimation({
    version: "stickman.animation/v1", canvas: { width: 640, height: 400, fps: 30 },
    actor: { x: 195, groundY: 310 }, durationMs: 5800,
    prop: { id: "crate", x: 250, y: 234, width: 64, height: 76, toX: 400, handle: { x: 0, y: 22 } },
    actions: [{ action: "push", startMs: 200, durationMs: duration, target: "crate" }]
  });
  expect(compiled.valid).toBe(true);
  const program = compiled.program!;
  const phaseTime = (phase: number) => 200 + duration * (0.20 + 0.62 * phase / 6);
  const compression = sampleAnimation(program, phaseTime(2));
  const drive = sampleAnimation(program, phaseTime(2.5));
  expect(compression.segments[0]!.y1 - drive.segments[0]!.y1).toBeGreaterThan(6);
  const speedAt = (time: number) =>
    (sampleAnimation(program, time + 5).prop!.x - sampleAnimation(program, time - 5).prop!.x) / 10;
  expect(speedAt(phaseTime(2.5))).toBeGreaterThan(speedAt(phaseTime(2)) * 1.5);
  let previous = sampleAnimation(program, 200);
  for (let time = 200; time <= 200 + duration; time += 10) {
    const frame = sampleAnimation(program, time);
    expect(frame.prop!.x).toBeGreaterThanOrEqual(previous.prop!.x - 1e-7);
    if (time >= 200 + duration * 0.20 && time <= 200 + duration * 0.82) {
      for (const side of ["left", "right"] as const) {
        const arm = frame.segments.find(line => line.id === `${side}-forearm`)!;
        const gripY = frame.prop!.handleY + (side === "left" ? 4 : -4);
        expect(Math.hypot(arm.x2 - frame.prop!.handleX, arm.y2 - gripY)).toBeLessThan(0.25);
      }
    }
    previous = frame;
  }
  expect(sampleAnimation(program, 200 + duration).prop!.x).toBe(400);
});
