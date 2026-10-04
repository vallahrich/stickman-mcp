import { describe, expect, it } from "vitest";
import { markerEvents } from "../src/events.js";
import { renderHtml } from "../src/render.js";
import { compileAnimation } from "../src/compiler.js";
import type { AnimationSpec } from "../src/contract.js";
import type { MotionClipLibrary } from "../src/motion-clips.js";

const clip = (frames: number, loop: boolean, markers: Record<string, number>) => ({
  name: "x", fps: 30, loop, frames: Array.from({ length: frames }, () => ({})), markers,
  poseKeys: [{ frame: 0, pose: {} }], meta: { travel: "in-place", kind: loop ? "loop" : "oneshot" }
});
const library = {
  clips: {
    reveal: clip(31, false, { reveal: 15 }),
    "type-at-desk": clip(30, true, { key: 10 })
  }
} as unknown as MotionClipLibrary;

const spec = (actions: AnimationSpec["actions"], durationMs = 6000): AnimationSpec => ({
  version: "stickman.animation/v1", canvas: { width: 1600, height: 800, fps: 30 }, durationMs, actions
});

describe("motion marker events", () => {
  it("maps one-shot markers onto the action timeline", () => {
    const events = markerEvents(spec([{ action: "reveal", startMs: 1000, durationMs: 1000 }]), library);
    expect(events).toEqual([{ timeMs: 1500, actionIndex: 0, action: "reveal", marker: "reveal", frame: 15 }]);
  });

  it("repeats key-pose loop markers at the authored cadence", () => {
    // 30-frame loop = 1 s cycle, so a 3 s action plays 3 cycles → 3 key events.
    const events = markerEvents(spec([{ action: "type-at-desk", startMs: 0, durationMs: 3000 }]), library);
    expect(events.map((e) => e.timeMs)).toEqual([333, 1333, 2333]);
  });

  it("skips actions without markers and orders by time", () => {
    const events = markerEvents(spec([
      { action: "type-at-desk", startMs: 2000, durationMs: 1000 },
      { action: "walk", startMs: 0, durationMs: 1000 },
      { action: "reveal", startMs: 1000, durationMs: 1000 }
    ]), library);
    expect(events.map((e) => `${e.action}:${e.timeMs}`)).toEqual(["reveal:1500", "type-at-desk:2333"]);
  });

  it("the HTML player dispatches stickman:marker events", () => {
    const compiled = compileAnimation(spec([{ action: "idle", startMs: 0, durationMs: 1000 }], 1000));
    expect(compiled.valid).toBe(true);
    const html = renderHtml({ ...compiled.program!, events: [{ timeMs: 500, actionIndex: 0, action: "idle", marker: "m", frame: 1 }] });
    expect(html).toContain('new CustomEvent("stickman:marker"');
    expect(html).toContain('"marker":"m"');
  });
});
