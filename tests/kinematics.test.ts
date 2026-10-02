import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { compileAnimation, sampleAnimation, validateAnimation } from "../src/compiler.js";
import type { AnimationSpec, CompiledAnimation, SampledFrame, Segment } from "../src/contract.js";

const base: AnimationSpec = {
  version: "stickman.animation/v1",
  canvas: { width: 640, height: 360, fps: 30 },
  durationMs: 3200,
  actor: { x: 180, groundY: 290 },
  actions: []
};

function compile(spec: AnimationSpec): CompiledAnimation {
  const result = compileAnimation(spec);
  expect(result.diagnostics).toEqual([]);
  return result.program!;
}

function segment(frame: SampledFrame, id: string): Segment {
  return frame.segments.find((line) => line.id === id)!;
}

function length(line: Segment): number {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

function scenes(): AnimationSpec[] {
  const result: AnimationSpec[] = [];
  for (const action of ["walk", "run", "point"] as const) {
    for (const direction of [-1, 1]) result.push({
      ...base,
      actor: { x: 320, groundY: 290 },
      targets: { mark: { x: 320 + direction * 200, y: action === "point" ? 140 : 290 } },
      actions: [{ action, startMs: 100, durationMs: 2800, target: "mark" }]
    });
  }
  for (const action of ["wave", "jump"] as const) result.push({
    ...base, actions: [{ action, startMs: 100, durationMs: 2800 }]
  });
  for (const action of ["wave", "jump"] as const) result.push({
    ...base, targets: { left: { x: 60, y: 150 } },
    actions: [
      { action: "point", startMs: 0, durationMs: 1000, target: "left" },
      { action, startMs: 1000, durationMs: 2000 }
    ]
  });
  result.push({
    ...base, actor: { x: 105, groundY: 290 },
    prop: { id: "crate", x: 150, y: 240, width: 50, height: 50, toX: 240, handle: { x: 0, y: 18 } },
    actions: [{ action: "push", startMs: 100, durationMs: 2800, target: "crate" }]
  });
  return result;
}

describe("fixed adult-proportion skeleton", () => {
  it("keeps all nine bones within 0.1% of their authored lengths in every action and direction", () => {
    for (const spec of scenes()) {
      const program = compile(spec);
      for (let time = 0; time <= spec.durationMs; time += 7) {
        const frame = sampleAnimation(program, time);
        expect(frame.segments).toHaveLength(9);
        for (const line of frame.segments) {
          const expected = line.id === "torso" ? 45 : line.id.includes("arm") ? 28 : 36;
          expect(Math.abs(length(line) / expected - 1), `${spec.actions[0]!.action} ${time} ${line.id}`).toBeLessThanOrEqual(0.001);
          for (const coordinate of [line.x1, line.y1, line.x2, line.y2]) expect(Number.isFinite(coordinate)).toBe(true);
          expect(Math.max(line.y1, line.y2)).toBeLessThanOrEqual(frame.groundY + 1e-7);
        }
        const torso = segment(frame, "torso");
        for (const side of ["left", "right"]) {
          const arm = segment(frame, `${side}-upper-arm`);
          const forearm = segment(frame, `${side}-forearm`);
          const thigh = segment(frame, `${side}-thigh`);
          const shin = segment(frame, `${side}-shin`);
          expect([arm.x1, arm.y1]).toEqual([torso.x2, torso.y2]);
          expect([forearm.x1, forearm.y1]).toEqual([arm.x2, arm.y2]);
          expect([thigh.x1, thigh.y1]).toEqual([torso.x1, torso.y1]);
          expect([shin.x1, shin.y1]).toEqual([thigh.x2, thigh.y2]);
        }
        expect(Math.hypot(frame.head.x - torso.x2, frame.head.y - torso.y2)).toBeCloseTo(16.5, 8);
      }
    }
  });

  it("scales the whole rig consistently on a small canvas instead of clipping or shrinking individual limbs", () => {
    const program = compile({
      ...base, canvas: { width: 96, height: 80, fps: 30 },
      actor: { x: 48, groundY: 65 },
      actions: [{ action: "jump", startMs: 0, durationMs: 2800 }]
    });
    const scale = length(segment(sampleAnimation(program, 0), "torso")) / 45;
    expect(scale).toBeLessThan(0.5);
    for (let time = 0; time <= 3000; time += 5) {
      const frame = sampleAnimation(program, time);
      for (const line of frame.segments) {
        const expected = (line.id === "torso" ? 45 : line.id.includes("arm") ? 28 : 36) * scale;
        expect(length(line)).toBeCloseTo(expected, 8);
        for (const x of [line.x1, line.x2]) expect(x).toBeGreaterThan(0);
        for (const x of [line.x1, line.x2]) expect(x).toBeLessThan(96);
        for (const y of [line.y1, line.y2]) expect(y).toBeGreaterThan(0);
        expect(line.y2).toBeLessThanOrEqual(frame.groundY + 1e-8);
      }
      expect(frame.head.y - 13 * scale).toBeGreaterThan(0);
    }
  });

  it("raises, repeats moderately and returns a wave by joint rotation, with a stationary upper arm during the hold", () => {
    const program = compile({ ...base, actions: [{ action: "wave", startMs: 0, durationMs: 2800 }] });
    const rest = sampleAnimation(program, 0);
    const held = [0.25, 0.38, 0.5, 0.63, 0.75].map((p) => sampleAnimation(program, 2800 * p));
    for (const frame of held) {
      const hand = segment(frame, "right-forearm");
      const upper = segment(frame, "right-upper-arm");
      expect(hand.y2).toBeLessThan(upper.y1 - 25);
      expect(upper.x2).toBeCloseTo(segment(held[0]!, "right-upper-arm").x2, 6);
      expect(upper.y2).toBeCloseTo(segment(held[0]!, "right-upper-arm").y2, 6);
    }
    const hands = Array.from({ length: 157 }, (_, i) => segment(sampleAnimation(program, 616 + i * 10), "right-forearm").x2);
    expect(Math.max(...hands) - Math.min(...hands)).toBeGreaterThan(10);
    expect(sampleAnimation(program, 2800).segments).toEqual(rest.segments);
  });

  it.each([{ x: 80, y: 150 }, { x: 470, y: 120 }, { x: 180, y: 60 }, { x: 260, y: 300 }])(
    "points along the world target direction with a reachable elbow: %j", (mark) => {
      const program = compile({
        ...base, targets: { mark },
        actions: [{ action: "point", startMs: 0, durationMs: 2800, target: "mark" }]
      });
      const frame = sampleAnimation(program, 1400);
      const upper = segment(frame, "right-upper-arm");
      const hand = segment(frame, "right-forearm");
      const dx = mark.x - upper.x1;
      const dy = mark.y - upper.y1;
      const hx = hand.x2 - upper.x1;
      const hy = hand.y2 - upper.y1;
      expect(Math.abs(dx * hy - dy * hx) / (Math.hypot(dx, dy) * Math.hypot(hx, hy))).toBeLessThan(1e-8);
      expect(dx * hx + dy * hy).toBeGreaterThan(0);
      if (mark.x !== upper.x1) {
        const inactive = segment(frame, "left-upper-arm");
        expect((inactive.x2 - inactive.x1) * dx).toBeLessThan(0);
      }
      expect(Math.hypot(hx, hy)).toBeLessThan(56);
      expect(Math.hypot(hx, hy)).toBeGreaterThan(30);
      const start = sampleAnimation(program, 0);
      const end = sampleAnimation(program, 2800);
      for (let i = 0; i < 9; i++) expect(length(end.segments[i]!)).toBeCloseTo(length(start.segments[i]!), 8);
    }
  );

  it("routes overhead and near-overhead pointing joints around the head throughout raise/hold/retract", () => {
    const pointLineDistance = (head: { x: number; y: number }, line: Segment): number => {
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      const u = Math.max(0, Math.min(1, ((head.x - line.x1) * dx + (head.y - line.y1) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(head.x - line.x1 - u * dx, head.y - line.y1 - u * dy);
    };
    for (const angle of [-0.8, -0.5, -0.3, -0.1, 0, 0.1, 0.3, 0.5, 0.8]) {
      const program = compile({
        ...base, actor: { x: 320, groundY: 290 },
        targets: { mark: { x: 320 + Math.sin(angle) * 100, y: 175 - Math.cos(angle) * 100 } },
        actions: [{ action: "point", startMs: 0, durationMs: 2800, target: "mark" }]
      });
      for (let time = 0; time <= 2800; time += 5) {
        const frame = sampleAnimation(program, time);
        for (const id of ["right-upper-arm", "right-forearm"]) {
          expect(pointLineDistance(frame.head, segment(frame, id)), `${angle} ${time} ${id}`).toBeGreaterThanOrEqual(13);
        }
      }
    }
  });
});

describe("absolute-time motion authority", () => {
  it("has no instantaneous joint pops at turn, lift, place, launch, landing, grip or release", () => {
    for (const spec of scenes()) {
      const program = compile(spec);
      let maximum = 0;
      let last = sampleAnimation(program, 0);
      for (let time = 1; time <= spec.durationMs; time++) {
        const frame = sampleAnimation(program, time);
        for (let i = 0; i < 9; i++) {
          const a = last.segments[i]!;
          const b = frame.segments[i]!;
          maximum = Math.max(maximum, Math.hypot(b.x1 - a.x1, b.y1 - a.y1), Math.hypot(b.x2 - a.x2, b.y2 - a.y2));
        }
        last = frame;
      }
      expect(maximum, spec.actions.map((action) => action.action).join(" -> ")).toBeLessThan(1.5);
    }
  });

  it("is identical under shuffled seeking, replay and repeated samples", () => {
    for (const spec of scenes()) {
      const program = compile(spec);
      const times = Array.from({ length: 71 }, (_, i) => (i * 1031 + 17) % 3201);
      const expected = times.map((time) => sampleAnimation(program, time));
      for (let i = times.length - 1; i >= 0; i--) expect(sampleAnimation(program, times[i]!)).toEqual(expected[i]);
      for (let i = 0; i < times.length; i += 3) expect(sampleAnimation(program, times[i]!)).toEqual(expected[i]);
    }
  });

  it("executes the serialized sampler without access to imported helpers or ambient module state", () => {
    const programs = [compile(scenes().at(-1)!), compile({
      ...base, durationMs: 7800, actor: { x: 140, groundY: 290 },
      targets: { a: { x: 280, y: 290 }, b: { x: 360, y: 290 }, mark: { x: 520, y: 140 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 2200, target: "a" },
        { action: "run", startMs: 2200, durationMs: 1800, target: "b" },
        { action: "jump", startMs: 4000, durationMs: 1800 },
        { action: "point", startMs: 5800, durationMs: 2000, target: "mark" }
      ]
    })];
    const isolated = runInNewContext(`(${sampleAnimation.toString()})`, {}) as typeof sampleAnimation;
    for (const program of programs) {
      for (const time of [0, 172, 770, 1739, 2200, 2481, 3100, 4000, 5600, 5800, 6500]) {
        expect(JSON.parse(JSON.stringify(isolated(program, time)))).toEqual(sampleAnimation(program, time));
      }
    }
    const program = programs[0]!;
    expect(() => isolated(program, Number.NaN)).toThrow(/timeMs must be a finite number/);
    expect(() => Reflect.apply(isolated, undefined, [program, 0, "frozen"])).toThrow(/mode must be/);
  });

  it("keeps reduced and static playback at the same settled meaningful endpoint", () => {
    for (const spec of scenes()) {
      const program = compile(spec);
      const end = sampleAnimation(program, spec.durationMs);
      for (const mode of ["reduced", "static"] as const) {
        for (const time of [0, 1400, 9000]) expect(sampleAnimation(program, time, mode)).toEqual(end);
      }
    }
  });
});

describe("sampler runtime argument contract", () => {
  it.each(["normal", "reduced", "static"] as const)("throws explicit TypeError for non-finite time in %s mode", (mode) => {
    const program = compile(scenes()[0]!);
    for (const time of [Number.NaN, Infinity, -Infinity]) {
      expect(() => sampleAnimation(program, time, mode)).toThrow(TypeError);
      expect(() => sampleAnimation(program, time, mode)).toThrow(/timeMs must be a finite number/);
    }
  });

  it("rejects non-number JS times instead of coercing them or treating them as zero", () => {
    const program = compile(scenes()[0]!);
    for (const time of [undefined, null, "100", false, {}, []]) {
      expect(() => Reflect.apply(sampleAnimation, undefined, [program, time])).toThrow(TypeError);
      expect(() => Reflect.apply(sampleAnimation, undefined, [program, time])).toThrow(/timeMs must be a finite number/);
    }
  });

  it("rejects unsupported runtime modes, including null and non-string values", () => {
    const program = compile(scenes()[0]!);
    for (const mode of ["", "NORMAL", "reduced-motion", null, false, 17, {}]) {
      expect(() => Reflect.apply(sampleAnimation, undefined, [program, 100, mode])).toThrow(TypeError);
      expect(() => Reflect.apply(sampleAnimation, undefined, [program, 100, mode])).toThrow(/mode must be "normal", "reduced", or "static"/);
    }
  });

  it("retains finite-time clamping, fractional seeking and the default normal mode", () => {
    const program = compile(scenes()[0]!);
    expect(sampleAnimation(program, -Number.MAX_VALUE)).toEqual(sampleAnimation(program, 0));
    expect(sampleAnimation(program, Number.MAX_VALUE)).toEqual(sampleAnimation(program, program.spec.durationMs));
    expect(sampleAnimation(program, 177.25).timeMs).toBe(177.25);
    expect(sampleAnimation(program, 177.25)).toEqual(sampleAnimation(program, 177.25, "normal"));
    expect(Reflect.apply(sampleAnimation, undefined, [program, 177.25, undefined])).toEqual(sampleAnimation(program, 177.25));
  });
});

describe("validated structural narrowing", () => {
  it("keeps precise existing field diagnostics rather than hiding malformed input behind a cast or generic error", () => {
    const cases = [
      { input: { ...base, canvas: { ...base.canvas, width: "640" } }, path: "$.canvas.width", code: "out_of_range" },
      { input: { ...base, actor: { x: "180", groundY: 290 } }, path: "$.actor.x", code: "invalid_number" },
      { input: { ...base, targets: { mark: { x: 200, y: "290" } } }, path: "$.targets.mark", code: "invalid_target" },
      { input: { ...base, actions: [{ action: "wave", startMs: "0", durationMs: 1000 }] }, path: "$.actions[0].startMs", code: "invalid_time" },
      {
        input: {
          ...base,
          prop: { id: "crate", x: 150, y: 240, width: 50, height: 50, toX: 240, handle: { x: "0", y: 18 } },
          actions: [{ action: "push", startMs: 0, durationMs: 2800, target: "crate" }]
        },
        path: "$.prop.handle", code: "invalid_handle"
      }
    ];
    for (const { input, path, code } of cases) {
      const validation = validateAnimation(input);
      expect(validation.valid).toBe(false);
      expect(validation.diagnostics).toContainEqual(expect.objectContaining({ path, code }));
      expect(validation.diagnostics.map((item) => item.code)).not.toContain("invalid_structure");
      expect(compileAnimation(input).program).toBeUndefined();
    }
  });

  it("compiles valid narrowed data into an independent clone without changing the public program shape", () => {
    const input: AnimationSpec = {
      ...base, targets: { mark: { x: 470, y: 150 } },
      actions: [{ action: "point", startMs: 0, durationMs: 2800, target: "mark" }]
    };
    const program = compile(input);
    expect(Object.keys(program).sort()).toEqual(["contractVersion", "spec"]);
    expect(program.spec).toEqual(input);
    expect(program.spec).not.toBe(input);
    expect(program.spec.actions).not.toBe(input.actions);
    expect(program.spec.targets).not.toBe(input.targets);
  });
});
