import { describe, expect, it } from "vitest";
import { compileAnimation, getFinalFrame, sampleAnimation, validateAnimation } from "../src/compiler.js";
import { PlaybackSession } from "../src/playback.js";
import { renderAnimatedSvg, renderHtml, renderSvgFrame } from "../src/render.js";
import type { AnimationSpec, CompiledAnimation } from "../src/contract.js";

function compile(spec: unknown): CompiledAnimation {
  const result = compileAnimation(spec);
  expect(result.diagnostics).toEqual([]);
  expect(result.program).toBeDefined();
  return result.program!;
}

const base = {
  version: "stickman.animation/v1",
  canvas: { width: 640, height: 360, fps: 30 },
  durationMs: 2400,
  actor: { x: 140, groundY: 290, color: "#202124" },
  actions: []
} satisfies AnimationSpec;

function expectFramesNear(a: ReturnType<typeof sampleAnimation>, b: ReturnType<typeof sampleAnimation>): void {
  expect(a.head.x).toBeCloseTo(b.head.x, 4);
  expect(a.head.y).toBeCloseTo(b.head.y, 4);
  for (let i = 0; i < a.segments.length; i++) {
    for (const coordinate of ["x1", "y1", "x2", "y2"] as const) {
      expect(a.segments[i]![coordinate]).toBeCloseTo(b.segments[i]![coordinate], 4);
    }
  }
}

describe("strict animation contract", () => {
  it("reports unsupported instructions, unknown fields, and missing semantic targets", () => {
    const result = validateAnimation({
      ...base,
      unsafeCode: "alert(1)",
      actions: [{ action: "dance", startMs: 0, durationMs: 500 }]
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("unknown_field");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_action");

    const point = validateAnimation({ ...base, actions: [{ action: "point", startMs: 0, durationMs: 500 }] });
    expect(point.diagnostics).toContainEqual(expect.objectContaining({ path: "$.actions[0].target", code: "unbound_target" }));
  });

  it("rejects overlapping actions instead of silently reordering or truncating them", () => {
    const result = validateAnimation({
      ...base,
      actions: [
        { action: "wave", startMs: 0, durationMs: 900 },
        { action: "jump", startMs: 800, durationMs: 500 }
      ]
    });
    expect(result.diagnostics.map((item) => item.code)).toContain("overlapping_actions");
  });
});

describe("deterministic sampler and shared playhead", () => {
  it("replays identical connected-joint geometry at the same playhead time", () => {
    const program = compile({
      ...base,
      targets: { stop: { x: 450, y: 290 } },
      actions: [{ action: "run", startMs: 200, durationMs: 1600, target: "stop" }]
    });
    expect(sampleAnimation(program, 670)).toEqual(sampleAnimation(program, 670));
    expect(sampleAnimation(program, 670).segments).toHaveLength(9);
  });

  it("has continuous action boundaries and stable travel final state", () => {
    const program = compile({
      ...base,
      durationMs: 4600,
      targets: { stop: { x: 450, y: 290 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 2800, target: "stop" },
        { action: "wave", startMs: 2800, durationMs: 1400 }
      ]
    });
    const before = sampleAnimation(program, 2799);
    const boundary = sampleAnimation(program, 2800);
    expect(Math.abs(before.x - boundary.x)).toBeLessThan(0.01);
    expect(Math.abs(before.segments[0]!.x1 - boundary.segments[0]!.x1)).toBeLessThan(0.01);
    expect(getFinalFrame(program).x).toBeCloseTo(450, 3);
  });

  it.each(["walk", "run"] as const)("infers %s facing from either target without adding authoring fields", (action) => {
    const left = compile({
      ...base,
      durationMs: 3200,
      targets: { destination: { x: 60, y: 290 } },
      actions: [{ action, startMs: 0, durationMs: action === "walk" ? 2800 : 1600, target: "destination" }]
    });
    const right = compile({
      ...base,
      durationMs: 3200,
      targets: { destination: { x: 450, y: 290 } },
      actions: [{ action, startMs: 0, durationMs: action === "walk" ? 2800 : 1600, target: "destination" }]
    });
    const leftTorso = sampleAnimation(left, 500).segments[0]!;
    const rightTorso = sampleAnimation(right, 500).segments[0]!;
    expect(leftTorso.x2).toBeLessThan(leftTorso.x1);
    expect(rightTorso.x2).toBeGreaterThan(rightTorso.x1);
    expect(validateAnimation({
      ...base,
      targets: { destination: { x: 20, y: 290 } },
      facing: "left",
      actions: [{ action, startMs: 0, durationMs: 1000, target: "destination" }]
    }).diagnostics.map((item) => item.code)).toContain("unknown_field");
  });

  it("turns the rig toward a point target while the pointing hand stays bound in world space", () => {
    const program = compile({
      ...base,
      targets: { attention: { x: 20, y: 120 } },
      actions: [{ action: "point", startMs: 0, durationMs: 1000, target: "attention" }]
    });
    const frame = sampleAnimation(program, 500);
    const torso = frame.segments[0]!;
    const rearArm = frame.segments[1]!;
    const pointingHand = frame.segments.find((segment) => segment.id === "right-forearm")!;
    expect(rearArm.x2).toBeGreaterThan(torso.x2);
    expect(pointingHand.x2).toBeLessThan(torso.x2);
  });

  it.each(["run", "wave", "point", "jump"] as const)("settles %s continuously at action entry and exit", (action) => {
    const spec = {
      ...base,
      durationMs: 3000,
      targets: action === "run" || action === "point" ? { mark: { x: 500, y: action === "run" ? 290 : 110 } } : undefined,
      actions: [{ action, startMs: 200, durationMs: 2400, ...(action === "run" || action === "point" ? { target: "mark" } : {}) }]
    };
    const program = compile(spec);
    expectFramesNear(sampleAnimation(program, 199), sampleAnimation(program, 200));
    expectFramesNear(sampleAnimation(program, 2600), sampleAnimation(program, 2601));
  });

  it("supports pause, seek, reduced/static final pose, and cancellation without an extra ticker", () => {
    const program = compile({
      ...base,
      targets: { stop: { x: 420, y: 290 } },
      actions: [{ action: "walk", startMs: 0, durationMs: 2400, target: "stop" }]
    });
    const session = new PlaybackSession(program);
    session.play();
    session.advance(300);
    session.pause();
    expect(session.snapshot().frame.timeMs).toBe(300);
    session.seek(800);
    expect(session.snapshot().frame.timeMs).toBe(800);
    const reduced = session.setMode("reduced");
    expect(reduced.frame.timeMs).toBe(program.spec.durationMs);
    expect(reduced.frame.x).toBeCloseTo(420, 3);
    session.cancel();
    expect(session.play().cancelled).toBe(true);
  });
});

describe("bound contact and render parity", () => {
  const pushed = {
    ...base,
    actor: { x: 105, groundY: 210, color: "#202124" },
    durationMs: 3000,
    prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } },
    actions: [{ action: "push", startMs: 100, durationMs: 2600, target: "crate" }]
  };

  it("binds both hands to the visible prop handle throughout translation", () => {
    const program = compile(pushed);
    expectFramesNear(sampleAnimation(program, 99), sampleAnimation(program, 100));
    for (const time of [1000, 1500, 2000]) {
      const frame = sampleAnimation(program, time);
      const hand = frame.segments.find((segment) => segment.id === "right-forearm")!;
      expect(hand.x2).toBeCloseTo(frame.prop!.handleX, 5);
      expect(hand.y2).toBeCloseTo(frame.prop!.handleY, 5);
      const otherHand = frame.segments.find((segment) => segment.id === "left-forearm")!;
      expect(Math.hypot(otherHand.x2 - frame.prop!.handleX, otherHand.y2 - frame.prop!.handleY)).toBeLessThanOrEqual(3);
      expect(frame.x).toBeCloseTo(105 + frame.prop!.x - 150, 5);
    }
    expectFramesNear(sampleAnimation(program, 2700), sampleAnimation(program, 2701));
    expect(getFinalFrame(program).prop!.x).toBeCloseTo(250, 5);
  });

  it("rejects an unreachable or unbound prop interaction", () => {
    const unreachable = validateAnimation({ ...pushed, actor: { x: 50, groundY: 210, color: "#202124" } });
    expect(unreachable.diagnostics.map((item) => item.code)).toContain("unreachable_contact");
    const unbound = validateAnimation({ ...pushed, actions: [{ action: "push", startMs: 0, durationMs: 1000, target: "other" }] });
    expect(unbound.diagnostics.map((item) => item.code)).toContain("unbound_prop");
  });

  it("keeps the prop still through approach, makes contact before travel, and releases after the push", () => {
    const program = compile(pushed);
    const start = 100;
    const beforeContact = sampleAnimation(program, start + 260);
    expect(beforeContact.prop!.x).toBeCloseTo(150, 5);
    expect(beforeContact.x).toBeCloseTo(105, 5);
    expect(beforeContact.segments[0]!.x2).toBeGreaterThan(beforeContact.segments[0]!.x1);

    const contact = sampleAnimation(program, start + 520);
    expect(contact.prop!.x).toBeCloseTo(150, 5);
    const contactingHand = contact.segments.find((segment) => segment.id === "right-forearm")!;
    expect(contactingHand.x2).toBeCloseTo(contact.prop!.handleX, 5);
    expect(contactingHand.y2).toBeCloseTo(contact.prop!.handleY, 5);

    const drive = sampleAnimation(program, start + 1300);
    expect(drive.prop!.x).toBeGreaterThan(150);
    const drivingHand = drive.segments.find((segment) => segment.id === "right-forearm")!;
    expect(drivingHand.x2).toBeCloseTo(drive.prop!.handleX, 5);
    expect(drivingHand.y2).toBeCloseTo(drive.prop!.handleY, 5);

    const release = sampleAnimation(program, start + 2340);
    expect(release.prop!.x).toBeCloseTo(250, 5);
    const releasedHand = release.segments.find((segment) => segment.id === "right-forearm")!;
    expect(Math.hypot(releasedHand.x2 - release.prop!.handleX, releasedHand.y2 - release.prop!.handleY)).toBeGreaterThan(0);
  });

  it("validates push reach from the preceding walk endpoint and keeps their boundary continuous", () => {
    const walkToPush = {
      ...base,
      actor: { x: 40, groundY: 210, color: "#202124" },
      durationMs: 4000,
      targets: { approach: { x: 105, y: 210 } },
      prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } },
      actions: [
        { action: "walk", startMs: 0, durationMs: 1000, target: "approach" },
        { action: "push", startMs: 1000, durationMs: 2600, target: "crate" }
      ]
    } satisfies AnimationSpec;
    const program = compile(walkToPush);
    expectFramesNear(sampleAnimation(program, 999.99), sampleAnimation(program, 1000));
    expect(sampleAnimation(program, 1000).action).toBe("push");

    const walkingAway = validateAnimation({
      ...walkToPush,
      targets: { approach: { x: 50, y: 210 } }
    });
    expect(walkingAway.diagnostics.map((item) => item.code)).toContain("unreachable_contact");
  });

  it("exports identical SVG geometry and a self-contained HTML sampler", () => {
    const program = compile(pushed);
    expect(renderSvgFrame(program, 500)).toContain(`x1="${Number(sampleAnimation(program, 500).segments[0]!.x1.toFixed(3))}"`);
    expect(renderAnimatedSvg(program)).toContain("<animate");
    const html = renderHtml(program);
    expect(html).toContain("sampleAnimation");
    expect(html).toContain("stickman.animation/v1");
    expect(html).toContain("prefers-reduced-motion");
  });
});
