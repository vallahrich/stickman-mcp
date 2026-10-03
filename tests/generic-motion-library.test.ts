import { describe, expect, it } from "vitest";
import { actionCatalog, compileAnimation, sampleAnimation } from "../src/index.js";
import { CONTRACT_VERSION, type SampledFrame } from "../src/contract.js";
import { animationSchema } from "../src/contract-schema.js";
import { RUNTIME_ACTION_NAMES } from "../src/motion-library.js";
import { MOTION_LIBRARY_FIXTURE } from "./fixtures/motion-library-fixture.js";

const base = {
  version: CONTRACT_VERSION,
  canvas: { width: 1600, height: 800, fps: 30 },
  durationMs: 5200,
  actor: { x: 220, groundY: 640 },
  targets: { travel: { x: 760, y: 640 }, aim: { x: 1040, y: 230 } },
  actions: []
};

function compile(actions: unknown[], durationMs = 2200) {
  const result = compileAnimation({ ...base, durationMs, actions });
  expect(result.diagnostics).toEqual([]);
  return result.program!;
}

function joints(frame: SampledFrame) {
  return [
    frame.head,
    ...frame.segments.flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }])
  ];
}

function maxJump(a: SampledFrame, b: SampledFrame): number {
  return Math.max(...joints(a).map((point, index) => Math.hypot(point.x - joints(b)[index]!.x, point.y - joints(b)[index]!.y)));
}

describe("generic generated motion library integration", () => {
  it("compiles and samples loop, oneshot, travel, hold, turn, and mirrored clips", () => {
    expect(MOTION_LIBRARY_FIXTURE.clips["turn-around"]).toBeDefined();
    const travel = compile([{ action: "walk", startMs: 0, durationMs: 3000, target: "travel" }], 3000);
    expect(sampleAnimation(travel, 3000).x).toBeCloseTo(760, 0);

    for (const action of ["wave", "jump", "hold-pose", "turn-around"] as const) {
      const program = compile([{ action, startMs: 0, durationMs: 1600, speed: 1 }], 1600);
      expect(sampleAnimation(program, 800).action).toBe(action);
    }

    const right = sampleAnimation(compile([{ action: "run", startMs: 0, durationMs: 2600, target: "travel" }], 2600), 700);
    const leftResult = compileAnimation({ ...base, durationMs: 2600, targets: { travel: { x: 80, y: 640 } }, actions: [{ action: "run", startMs: 0, durationMs: 2600, target: "travel" }] });
    expect(leftResult.diagnostics).toEqual([]);
    const left = sampleAnimation(leftResult.program!, 700);
    expect(right.segments[0]!.x2).toBeGreaterThan(right.segments[0]!.x1);
    expect(left.segments[0]!.x2).toBeLessThan(left.segments[0]!.x1);
    expect(left.segments).toHaveLength(right.segments.length);
  });

  it("keeps transitions between arbitrary clips continuous", () => {
    const program = compile([
      { action: "wave", startMs: 0, durationMs: 1200 },
      { action: "turn-around", startMs: 1200, durationMs: 900 },
      { action: "jump", startMs: 2100, durationMs: 1200 }
    ], 3300);
    let inClipMax = 0;
    for (let t = 33; t < 1100; t += 33) inClipMax = Math.max(inClipMax, maxJump(sampleAnimation(program, t - 33), sampleAnimation(program, t)));
    const boundary = Math.max(maxJump(sampleAnimation(program, 1199), sampleAnimation(program, 1200)), maxJump(sampleAnimation(program, 2099), sampleAnimation(program, 2100)));
    expect(boundary).toBeLessThanOrEqual(inClipMax + 1);
  });

  it("keeps front-view turns readable instead of collapsing to a pin", () => {
    const program = compile([{ action: "turn-around", startMs: 0, durationMs: 900 }], 900);
    const jointPoints = (frame: SampledFrame) => [
      frame.head,
      ...frame.segments.flatMap((segment) => [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }])
    ];
    const middle = sampleAnimation(program, 450);
    const leftFoot = middle.segments.find((segment) => segment.id === "left-shin")!;
    const rightFoot = middle.segments.find((segment) => segment.id === "right-shin")!;
    const torso = middle.segments.find((segment) => segment.id === "torso")!;
    const leftHand = middle.segments.find((segment) => segment.id === "left-forearm")!;
    const rightHand = middle.segments.find((segment) => segment.id === "right-forearm")!;
    const height = Math.hypot(torso.x2 - torso.x1, torso.y2 - torso.y1) / 45 * 144;
    expect(Math.abs(leftFoot.x2 - rightFoot.x2)).toBeGreaterThanOrEqual(0.12 * height);
    expect(Math.abs(leftHand.x2 - torso.x2)).toBeGreaterThanOrEqual(0.04 * height);
    expect(Math.abs(rightHand.x2 - torso.x2)).toBeGreaterThanOrEqual(0.04 * height);
    for (let time = 0; time <= 900; time += 100) {
      const xs = jointPoints(sampleAnimation(program, time)).map((point) => point.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.02 * height);
    }
  });

  it("derives schema enum and MCP catalog from library metadata", () => {
    const enumValues = animationSchema.properties.actions.items.properties.action.enum;
    expect(enumValues).toEqual(RUNTIME_ACTION_NAMES);
    for (const id of RUNTIME_ACTION_NAMES) {
      expect(actionCatalog.some((entry) => entry.action === id && entry.label && entry.summary)).toBe(true);
    }
  });

  it("lists close valid action ids for unknown action diagnostics", () => {
    const result = compileAnimation({ ...base, actions: [{ action: "turn-arond", startMs: 0, durationMs: 800 }] });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.find((d) => d.code === "unsupported_action")?.message).toContain("turn-around");
  });
});
