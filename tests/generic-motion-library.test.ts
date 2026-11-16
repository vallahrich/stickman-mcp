import { describe, expect, it } from "vitest";
import {
  actionCatalog,
  compileAnimation,
  describeAction,
  queryActionCatalog,
  sampleAnimation,
  type ActionCatalogFilter
} from "../src/index.js";
import { CONTRACT_VERSION, type SampledFrame } from "../src/contract.js";
import { animationSchema } from "../src/contract-schema.js";
import { RUNTIME_ACTION_NAMES, RUNTIME_MOTION_LIBRARY } from "../src/motion-library.js";
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
    expect(Array.isArray(actionCatalog)).toBe(true);
    expect(Object.keys(RUNTIME_MOTION_LIBRARY.clips).length).toBeGreaterThanOrEqual(60);
    expect(actionCatalog.length).toBeGreaterThanOrEqual(60);
    expect(actionCatalog.map((entry) => entry.action)).toEqual(RUNTIME_ACTION_NAMES);
    for (const id of RUNTIME_ACTION_NAMES) {
      expect(actionCatalog.some((entry) => entry.action === id && entry.label && entry.summary)).toBe(true);
    }
  });

  it("compiles and samples every discoverable clip cleanly", () => {
    for (const entry of actionCatalog) {
      const clip = RUNTIME_MOTION_LIBRARY.clips[entry.action];
      const durationMs = Math.max(2400, Math.ceil((clip?.frames.length ?? 60) / 30 * 1000) + 400);
      const spec = {
        version: CONTRACT_VERSION,
        canvas: { width: 1600, height: 800, fps: 30 },
        durationMs,
        actor: { x: 600, groundY: 640 },
        ...(entry.requiredBinding === "named target"
          ? { targets: { mark: entry.travel === "travel" ? { x: 840, y: 640 } : { x: 1040, y: 260 } } }
          : {}),
        ...(entry.requiredBinding === "bound visible prop handle"
          ? { prop: { id: "crate", x: 645, y: 590, width: 50, height: 50, toX: 745, handle: { x: 5, y: 8 } } }
          : {}),
        actions: [{
          action: entry.action,
          startMs: 0,
          durationMs,
          ...(entry.requiredBinding === "named target" ? { target: "mark" }
            : entry.requiredBinding === "bound visible prop handle" ? { target: "crate" }
            : {})
        }]
      };
      const compiled = compileAnimation(spec);
      expect(compiled.diagnostics, entry.action).toEqual([]);
      expect(compiled.program, entry.action).toBeDefined();
      for (const fraction of [0, 0.5, 1]) {
        const frame = sampleAnimation(compiled.program!, durationMs * fraction);
        expect(frame.segments, entry.action).toHaveLength(9);
        expect(Number.isFinite(frame.head.x), entry.action).toBe(true);
        expect(Number.isFinite(frame.head.y), entry.action).toBe(true);
      }
    }
  });

  it("resolves describeAction for both bare action names and exact versioned IDs", () => {
    const walkBare = describeAction("walk");
    const walkVersioned = describeAction("walk@1.0.0");
    expect(walkBare).toBeDefined();
    expect(walkBare).toEqual(walkVersioned);
    expect(walkBare?.id).toBe("walk@1.0.0");

    const ideaBare = describeAction("idea");
    const ideaVersioned = describeAction("idea@1.1.0");
    expect(ideaBare).toBeDefined();
    expect(ideaBare).toEqual(ideaVersioned);
    expect(ideaBare?.action).toBe("idea");

    expect(describeAction("walk@9.9.9")).toBeUndefined();
    expect(describeAction("idea@1.0.0")).toBeUndefined();
    expect(describeAction("nonexistent-motion")).toBeUndefined();
  });

  it("filters action catalog via queryActionCatalog by category, tag, prop, kind, travel, and search", () => {
    expect(Array.isArray(actionCatalog)).toBe(true);
    const all = queryActionCatalog();
    expect(all).toEqual(actionCatalog);
    const emptyFilter: ActionCatalogFilter = {};
    expect(queryActionCatalog(emptyFilter)).toEqual(actionCatalog);

    const presentation = queryActionCatalog({ category: "presentation" });
    expect(presentation.length).toBeGreaterThanOrEqual(8);
    expect(presentation.some((e) => e.action === "idea")).toBe(true);
    expect(presentation.some((e) => e.action === "walk")).toBe(false);
    expect(queryActionCatalog({ category: "Presentation" })).toEqual(presentation);

    const bulbActions = queryActionCatalog({ prop: "bulb" });
    expect(bulbActions.map((e) => e.action)).toEqual(["idea"]);

    const boxActions = queryActionCatalog({ prop: "box" });
    expect(boxActions.some((e) => e.action === "push")).toBe(true);
    expect(boxActions.every((e) => e.prop === "box")).toBe(true);

    const loops = queryActionCatalog({ kind: "loop" });
    expect(loops.length).toBeGreaterThan(0);
    expect(loops.every((e) => e.kind === "loop")).toBe(true);

    const travelClips = queryActionCatalog({ travel: "travel" });
    expect(travelClips.some((e) => e.action === "walk")).toBe(true);
    expect(travelClips.every((e) => e.travel === "travel")).toBe(true);

    const tagged = queryActionCatalog({ tag: "aha" });
    expect(tagged.map((e) => e.action)).toContain("idea");

    const searched = queryActionCatalog({ search: "bulb" });
    expect(searched.map((e) => e.action)).toContain("idea");

    const combined = queryActionCatalog({ category: "work", prop: "box", travel: "in-place" });
    expect(combined.map((e) => e.action)).toEqual(expect.arrayContaining(["pick-up", "put-down"]));
    expect(combined.every((e) => e.prop === "box" && e.travel === "in-place")).toBe(true);
  });

  it("lists close valid action ids for unknown action diagnostics", () => {
    const result = compileAnimation({ ...base, actions: [{ action: "turn-arond", startMs: 0, durationMs: 800 }] });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.find((d) => d.code === "unsupported_action")?.message).toContain("turn-around");
  });
});
